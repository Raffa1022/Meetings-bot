const http = require('http');
const { Client, GatewayIntentBits, Partials, Options, PermissionsBitField, ChannelType, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// --- 1. SERVER KEEP-ALIVE ---
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is alive - Low Memory Mode v4.7 (Fixed Logic)');
}).listen(8000);

// --- 2. CONFIGURAZIONE CLIENT OTTIMIZZATA ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers // Necessario per assegnare i ruoli
    ],
    partials: [
        Partials.Message, 
        Partials.Channel, 
        Partials.Reaction, 
        Partials.User, 
        Partials.GuildMember
    ],
    // Cache aggressiva (Low Memory)
    makeCache: Options.cacheWithLimits({
        MessageManager: 10,       
        PresenceManager: 0,       
        GuildMemberManager: 10,   
        UserManager: 10,
        ReactionManager: 0,       
        ThreadManager: 0
    }),
});

// --- 🔧 CONFIGURAZIONE ID (INSERISCI I TUOI) ---
const ID_SERVER_COMMAND = '1460740887494787259'; 
const ID_CANALE_LOG = '1464941042380837010';
const ID_SERVER_TARGET = '1463608688244822018';
const ID_CATEGORIA_TARGET = '1463608688991273015';

const ID_RUOLO_RESET = '1460741401435181295'; 
const ID_RUOLO_MEETING_1 = '1460741403331268661';
const ID_RUOLO_MEETING_2 = '1460741402672758814';

// Canale Database
const ID_CANALE_DATABASE = '1464940718933151839'; 

// ID CATEGORIA CHAT RUOLO (#1, #2...)
const ID_CATEGORIA_CHAT_RUOLO = '1460741414357827747'; 

// --- ID RUOLI AUTOMATICI (TABELLA) ---
const ID_RUOLO_GIOCATORE_AUTO = '1460741403331268661'; 
const ID_RUOLO_SPONSOR_AUTO = '1460741404497019002';

// --- 👇 ID PER GESTIONE ALT (DA COMPILARE) 👇 ---
const ID_RUOLO_ALT = '1460741402672758814'; 
const ID_CANALE_BENVENUTO = '1460740888450830501'; 

// --- 🆕 NUOVO ID PER AUTO-JOIN (RUOLO ALL'INGRESSO STANDARD) ---
const ID_RUOLO_AUTO_JOIN = '1460741402672758814'; 

// --- 🔢 VARIABILI MEMORIA ---
const meetingCounts = new Map(); 
const letturaCounts = new Map(); 
const activeUsers = new Set(); 
const MAX_MEETINGS = 3;
const MAX_LETTURE = 1;

// Variabile stato Auto-Ruolo (False = spento di default)
let isAutoRoleActive = false;

// --- 📋 VARIABILI TABELLA ---
let activeTable = {
    limit: 0,
    slots: [], // Contiene { player: id, sponsor: id }
    messageId: null
};

// --- 📦 SISTEMA DATABASE ---
async function syncDatabase() {
    try {
        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        if (!dbChannel) return console.error("❌ Canale Database non trovato!");

        const dataString = JSON.stringify({
            meeting: Object.fromEntries(meetingCounts),
            lettura: Object.fromEntries(letturaCounts),
            active: Array.from(activeUsers),
            autorole: isAutoRoleActive 
        });

        const sentMsg = await dbChannel.send(`📦 **BACKUP_DATI**\n\`\`\`json\n${dataString}\n\`\`\``);
        sentMsg.channel.messages.cache.delete(sentMsg.id); 

    } catch (e) { console.error("Errore salvataggio DB:", e); }
}

async function restoreDatabase() {
    try {
        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        if (!dbChannel) return;

        const messages = await dbChannel.messages.fetch({ limit: 10 });
        const lastBackup = messages.find(m => m.content.includes('BACKUP_DATI'));
        
        if (lastBackup) {
            const jsonStr = lastBackup.content.split('```json\n')[1].split('\n```')[0];
            const data = JSON.parse(jsonStr);
            
            meetingCounts.clear();
            Object.entries(data.meeting || {}).forEach(([id, val]) => meetingCounts.set(id, val));
            letturaCounts.clear();
            Object.entries(data.lettura || {}).forEach(([id, val]) => letturaCounts.set(id, val));
            
            activeUsers.clear();
            (data.active || []).forEach(id => activeUsers.add(id));

            if (data.autorole !== undefined) isAutoRoleActive = data.autorole;
            
            console.log("✅ Database ripristinato.");
        }
        messages.forEach(m => dbChannel.messages.cache.delete(m.id)); 

    } catch (e) { console.log("ℹ️ Nessun backup trovato."); }
}

// --- 3. EVENTO AVVIO ---
client.once('ready', async () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    await restoreDatabase(); 
});

// --- 🆕 EVENTO: GESTIONE INGRESSI (ALT & AUTO-JOIN) ---
client.on('guildMemberAdd', async member => {
    
    // 1. Controllo ALT ACCOUNT
    try {
        const fetchedMember = await member.guild.members.fetch(member.id);
        
        if (fetchedMember.roles.cache.has(ID_RUOLO_ALT)) {
            console.log(`🚫 Utente Alt rilevato: ${member.user.tag}. Benvenuto e visibilità annullati.`);
            const welcomeChannel = member.guild.channels.cache.get(ID_CANALE_BENVENUTO);
            if (welcomeChannel) {
                await welcomeChannel.permissionOverwrites.create(member.id, {
                    ViewChannel: false 
                });
            }
            return; 
        }
    } catch (e) {
        console.error("Errore verifica Alt:", e);
    }

    // 2. Logica Standard (Se non è Alt)
    if (!isAutoRoleActive) return;

    try {
        await member.roles.add(ID_RUOLO_AUTO_JOIN);
        console.log(`Ruolo assegnato a ${member.user.tag}`);
    } catch (e) {
        console.error(`Errore assegnazione ruolo a ${member.user.tag}:`, e);
    }
});

// --- 4. REAZIONI ---
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) {
        try { await reaction.fetch(); } catch (error) { return; }
    }
});

// --- 5. GESTIONE COMANDI ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // --- COMANDO: !impostazioni (AGGIORNATO) ---
    if (message.content === '!impostazioni') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        
        const helpEmbed = new EmbedBuilder()
            .setTitle('⚙️ Pannello Gestione Bot')
            .setColor(0x2B2D31)
            .addFields(
                { name: '🔹 !meeting @giocatore (Solo Giocatori)', value: 'Invita un altro giocatore. I rispettivi Sponsor entrano in automatico.' },
                { name: '🛑 !fine (Giocatori)', value: 'Chiude la chat privata.' },
                { name: '👁️ !lettura (Solo Giocatori)', value: 'Supervisione chat attiva (Max 1). Sponsor esclusi.' }, 
                { name: '🚪 !entrata (Overseer)', value: `Attiva/Disattiva ruolo automatico all'ingresso. (Stato: ${isAutoRoleActive ? 'ON' : 'OFF'})` },
                { name: '📋 !tabella [num] (Overseer)', value: 'Crea la tabella iscrizioni (Es. !tabella 10).' },
                { name: '🚀 !assegna (Overseer)', value: 'Assegna stanze, ruoli e permessi avanzati.' },
                { name: '🔒 !chiusura (Overseer)', value: 'Chiude la tabella e resetta le iscrizioni.' },
                { name: '⚠️ !azzeramento1 (Overseer)', value: 'Resetta meeting e sblocca utenti.' },
                { name: '⚠️ !azzeramento2 (Overseer)', value: 'Resetta il conteggio delle Letture.' }
            )
            .setFooter({ text: 'Sistema v4.7 - Auto-Sponsor & Ghost Fix' });

        return message.channel.send({ embeds: [helpEmbed] });
    }

    // --- 🆕 NUOVO COMANDO: !entrata ---
    if (message.content === '!entrata') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return; // Solo admin

        // Inverte lo stato (da ON a OFF e viceversa)
        isAutoRoleActive = !isAutoRoleActive;
        await syncDatabase(); 

        const stato = isAutoRoleActive ? "✅ ATTIVO" : "🛑 DISATTIVO";
        message.reply(`🚪 **Auto-Ruolo Ingressi:** ${stato}.\n(Ruolo ID: ${ID_RUOLO_AUTO_JOIN})`);
    }

    // --- !azzeramento1 ---
    if (message.content === '!azzeramento1') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.roles.cache.has(ID_RUOLO_RESET)) return message.reply("⛔ Non hai i permessi.");

        meetingCounts.clear();
        activeUsers.clear(); 
        await syncDatabase();
        return message.reply("♻️ Conteggio **Meeting** azzerato e utenti sbloccati.");
    }

    // --- !azzeramento2 ---
    if (message.content === '!azzeramento2') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.roles.cache.has(ID_RUOLO_RESET)) return message.reply("⛔ Non hai i permessi.");

        letturaCounts.clear();
        await syncDatabase();
        return message.reply("♻️ Conteggio **Letture** azzerato per tutti.");
    }

    // --- COMANDO: !tabella ---
    if (message.content.startsWith('!tabella')) {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        const args = message.content.split(' ');
        const num = parseInt(args[1]);

        if (!num || num > 25) return message.reply("Specifica un numero di slot (max 25). Es: `!tabella 10`");

        activeTable.limit = num;
        activeTable.slots = Array(num).fill(null).map(() => ({ player: null, sponsor: null }));

        const description = generateTableText();

        const embed = new EmbedBuilder()
            .setTitle(`📋 Iscrizione Giocatori & Sponsor`)
            .setDescription(description)
            .setColor('Blue')
            .setFooter({ text: "Usa i menu qui sotto per iscriverti!" });

        const options = [];
        for (let i = 1; i <= num; i++) {
            options.push({ label: `Numero ${i}`, value: `${i - 1}` });
        }

        const rowPlayer = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_player')
                .setPlaceholder('👤 Seleziona Slot Giocatore')
                .addOptions(options)
        );

        const rowSponsor = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('select_sponsor')
                .setPlaceholder('💰 Seleziona Slot Sponsor')
                .addOptions(options)
        );

        const rowButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('leave_game')
                .setLabel('🏃 Abbandona Gioco')
                .setStyle(ButtonStyle.Danger)
        );

        const sentMsg = await message.channel.send({ embeds: [embed], components: [rowPlayer, rowSponsor, rowButton] });
        activeTable.messageId = sentMsg.id;
    }

    // --- COMANDO: !assegna ---
    if (message.content === '!assegna') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        if (activeTable.limit === 0) return message.reply("⚠️ Nessuna tabella attiva. Usa prima `!tabella`.");

        await message.reply("⏳ **Inizio configurazione Stanze, Ruoli e Permessi...** attendi.");

        const category = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_RUOLO);
        if (!category) return message.channel.send("❌ Errore: ID Categoria Chat Ruolo non trovato o non valido. Inseriscilo nel codice.");

        let assegnati = 0;
        let erroriRuolo = 0;

        for (let i = 0; i < activeTable.limit; i++) {
            const slot = activeTable.slots[i];
            const channelName = `${i + 1}`; 

            const channel = message.guild.channels.cache.find(c => c.parentId === ID_CATEGORIA_CHAT_RUOLO && c.name === channelName);

            if (channel) {
                // 1. Reset permessi stanza
                await channel.permissionOverwrites.set([
                    { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] } 
                ]);

                // Permessi avanzati
                const permessiSpeciali = {
                    ViewChannel: true,
                    SendMessages: true,
                    ManageMessages: true,        
                    CreatePrivateThreads: true,  
                    SendMessagesInThreads: true, 
                    CreatePublicThreads: false   
                };

                let utentiDaSalutare = [];

                // --- GESTIONE GIOCATORE ---
                if (slot.player) {
                    await channel.permissionOverwrites.edit(slot.player, permessiSpeciali);
                    utentiDaSalutare.push(`<@${slot.player}>`);
                    try {
                        const member = await message.guild.members.fetch(slot.player);
                        if (member) await member.roles.add(ID_RUOLO_GIOCATORE_AUTO);
                    } catch (e) { erroriRuolo++; }
                }

                // --- GESTIONE SPONSOR ---
                if (slot.sponsor) {
                    await channel.permissionOverwrites.edit(slot.sponsor, permessiSpeciali);
                    utentiDaSalutare.push(`<@${slot.sponsor}>`);
                    try {
                        const member = await message.guild.members.fetch(slot.sponsor);
                        if (member) await member.roles.add(ID_RUOLO_SPONSOR_AUTO);
                    } catch (e) { erroriRuolo++; }
                }

                // --- MESSAGGIO DI BENVENUTO ---
                if (utentiDaSalutare.length > 0) {
                    const saluto = utentiDaSalutare.length > 1 
                        ? `Benvenuti ${utentiDaSalutare.join(' ')}!` 
                        : `Benvenuto ${utentiDaSalutare[0]}!`;
                    await channel.send(saluto);
                }
                assegnati++;
            }
        }
        
        let msgFinale = `✅ **Operazione completata!** Stanze configurate: ${assegnati}.`;
        if (erroriRuolo > 0) msgFinale += `\n⚠️ Attenzione: ${erroriRuolo} utenti non hanno ricevuto il ruolo (controlla la gerarchia ruoli).`;

        await message.channel.send(msgFinale);
    }

    // --- COMANDO: !chiusura ---
    if (message.content === '!chiusura') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        activeTable = { limit: 0, slots: [], messageId: null };
        message.reply("🔒 **Tabella chiusa e memoria resettata.**");
    }

    // --- COMANDO: !meeting ---
    if (message.content.startsWith('!meeting ')) {
        if (message.guild.id !== ID_SERVER_COMMAND) return;

        // ⛔ CONTROLLO: Solo GIOCATORE può usare questo comando
        if (!message.member.roles.cache.has(ID_RUOLO_GIOCATORE_AUTO)) {
            return message.reply("❌ **Accesso Negato:** Solo i Giocatori possono gestire i meeting. Se sei uno Sponsor, aspetta che il tuo giocatore ti porti dentro.");
        }

        const hasRoleAuthor = message.member.roles.cache.has(ID_RUOLO_MEETING_1) || message.member.roles.cache.has(ID_RUOLO_MEETING_2);
        if (!hasRoleAuthor) return message.reply("⛔ Non hai il ruolo autorizzato per creare meeting.");

        if (activeUsers.has(message.author.id)) {
            return message.reply("⚠️ Hai già una chat attiva! Concludila con **!fine** prima di aprirne un'altra.");
        }

        const authorCount = meetingCounts.get(message.author.id) || 0;
        if (authorCount >= MAX_MEETINGS) return message.reply(`⚠️ Hai raggiunto il limite TOTALE di ${MAX_MEETINGS} meeting.`);

        const userToInvite = message.mentions.users.first();
        if (!userToInvite || userToInvite.id === message.author.id) return message.reply("⚠️ Devi taggare un altro giocatore.");

        try {
            const memberToInvite = await message.guild.members.fetch(userToInvite.id);
            // Verifica che anche l'invitato sia un giocatore abilitato
            const hasRoleGuest = memberToInvite.roles.cache.has(ID_RUOLO_MEETING_1) || memberToInvite.roles.cache.has(ID_RUOLO_MEETING_2);
            
            if (!hasRoleGuest) {
                return message.reply(`⛔ L'utente ${userToInvite} non è un giocatore valido per il meeting.`);
            }
        } catch (e) {
            return message.reply("⚠️ Impossibile verificare i permessi dell'utente invitato.");
        }

        if (activeUsers.has(userToInvite.id)) {
            return message.reply(`⚠️ L'utente ${userToInvite} è già impegnato in un'altra chat attiva.`);
        }

        // Invio richiesta di conferma tra GIOCATORI
        const proposalMsg = await message.channel.send(`🔔 **Richiesta Meeting**\n👤 **Ospite:** ${userToInvite}\n📩 **Da:** ${message.author}\n\n*Reagisci per accettare/rifiutare*`);
        await proposalMsg.react('✅'); await proposalMsg.react('❌');

        const collector = proposalMsg.createReactionCollector({ 
            filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === userToInvite.id, 
            time: 3 * 60 * 60 * 1000, max: 1 
        });

        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅') {
                if (reaction.message.partial) await reaction.message.fetch();

                if (activeUsers.has(message.author.id) || activeUsers.has(userToInvite.id)) {
                     return reaction.message.reply("❌ Meeting annullato: Uno dei giocatori risulta ora occupato.");
                }

                let cAuthor = meetingCounts.get(message.author.id) || 0;
                let cGuest = meetingCounts.get(userToInvite.id) || 0;

                if (cAuthor >= MAX_MEETINGS) return reaction.message.reply(`❌ Meeting annullato: ${message.author} ha finito i token.`);
                if (cGuest >= MAX_MEETINGS) return reaction.message.reply(`❌ Meeting annullato: ${userToInvite} ha finito i token.`);

                // --- RECUPERO SPONSOR AUTOMATICI DALLA TABELLA ---
                const sponsorAuthor = activeTable.slots.find(s => s.player === message.author.id)?.sponsor;
                const sponsorGuest = activeTable.slots.find(s => s.player === userToInvite.id)?.sponsor;
                
                // Aggiorna contatori
                meetingCounts.set(message.author.id, cAuthor + 1);
                meetingCounts.set(userToInvite.id, cGuest + 1);
                
                activeUsers.add(message.author.id);
                activeUsers.add(userToInvite.id);
                // Aggiungiamo anche gli sponsor alla lista "attivi" per evitare conflitti? 
                // Dipende se lo sponsor può stare in più chat. Per ora li lasciamo liberi ma li invitiamo.
                
                await syncDatabase();

                try {
                    const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
                    
                    // Creiamo i permessi
                    const permissions = [
                        { id: targetGuild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, // Block Everyone
                        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }, // Bot
                        // Giocatore 1 (Autore)
                        { 
                            id: message.author.id, 
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                            deny: [PermissionsBitField.Flags.CreatePublicThreads, PermissionsBitField.Flags.CreatePrivateThreads] 
                        },
                        // Giocatore 2 (Ospite)
                        { 
                            id: userToInvite.id, 
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                            deny: [PermissionsBitField.Flags.CreatePublicThreads, PermissionsBitField.Flags.CreatePrivateThreads]
                        }
                    ];

                    // Se c'è uno sponsor per il giocatore 1, aggiungilo
                    if (sponsorAuthor) {
                        permissions.push({
                            id: sponsorAuthor,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                            deny: [PermissionsBitField.Flags.CreatePublicThreads, PermissionsBitField.Flags.CreatePrivateThreads]
                        });
                    }

                    // Se c'è uno sponsor per il giocatore 2, aggiungilo
                    if (sponsorGuest) {
                        permissions.push({
                            id: sponsorGuest,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                            deny: [PermissionsBitField.Flags.CreatePublicThreads, PermissionsBitField.Flags.CreatePrivateThreads]
                        });
                    }

                    const newChannel = await targetGuild.channels.create({
                        name: `meeting-${message.author.username}-${userToInvite.username}`,
                        type: ChannelType.GuildText, 
                        parent: ID_CATEGORIA_TARGET,
                        permissionOverwrites: permissions,
                    });
                    
                    // Costruiamo la lista menzioni per il messaggio (solo visiva)
                    let participantsText = `${message.author} e ${userToInvite}`;
                    if (sponsorAuthor) participantsText += ` (con Sponsor <@${sponsorAuthor}>)`;
                    if (sponsorGuest) participantsText += ` (con Sponsor <@${sponsorGuest}>)`;

                    // --- 👻 FIX GHOST PING: Usa Embed ---
                    const welcomeEmbed = new EmbedBuilder()
                        .setTitle("👋 Meeting Avviato")
                        .setDescription(`Benvenuti nel canale privato!\n\n👤 **Partecipanti:**\n${participantsText}\n\nScrivete **!fine** per chiudere la chat.`)
                        .setColor(0x00FFFF);

                    await newChannel.send({ embeds: [welcomeEmbed] });
                    
                    const logEmbed = new EmbedBuilder()
                        .setTitle('📂 Meeting Avviato')
                        .setColor(0x00FF00) 
                        .setDescription(`**Autore:** ${message.author.tag} (${cAuthor+1}/${MAX_MEETINGS})\n**Ospite:** ${userToInvite.tag} (${cGuest+1}/${MAX_MEETINGS})\n\nℹ️ Rispondi con **!lettura** per osservare la chat.`)
                        .addFields({ name: 'Stato', value: '🟢 Aperto (Nessun supervisore)', inline: true })
                        .setFooter({ text: `ID:${newChannel.id}` })
                        .setTimestamp();
                    
                    await reaction.message.reply({ content: "✅ Meeting creato!", embeds: [logEmbed] });
                    reaction.message.channel.messages.cache.delete(reaction.message.id);

                } catch (e) { 
                    console.error("Errore creazione:", e);
                    reaction.message.channel.send("❌ Errore creazione canale.");
                    activeUsers.delete(message.author.id);
                    activeUsers.delete(userToInvite.id);
                }
            } else {
                reaction.message.reply("❌ Richiesta rifiutata.");
            }
        });
    }

    // --- COMANDO: !lettura ---
    if (message.content === '!lettura') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.reference) return message.reply("⚠️ Rispondi al messaggio verde.");

        // ⛔ CONTROLLO: Solo GIOCATORE può usare questo comando
        if (!message.member.roles.cache.has(ID_RUOLO_GIOCATORE_AUTO)) {
            return message.reply("❌ **Accesso Negato:** Solo chi ha il ruolo Giocatore può effettuare la lettura.");
        }

        const currentRead = letturaCounts.get(message.author.id) || 0;
        if (currentRead >= MAX_LETTURE) return message.reply("⛔ Limite supervisioni raggiunto.");

        try {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            if (!repliedMsg.embeds.length) return message.reply("⚠️ Messaggio non valido.");
            const targetEmbed = repliedMsg.embeds[0];

            if (targetEmbed.fields.some(f => f.name === '👮 Supervisore')) return message.reply("⛔ Supervisore già presente.");

            const channelId = targetEmbed.footer?.text.match(/ID:(\d+)/)?.[1];
            if (!channelId) return message.reply("⚠️ ID canale mancante.");

            const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
            const targetChannel = await targetGuild.channels.fetch(channelId).catch(() => null);

            if (!targetChannel) return message.reply("❌ Canale inesistente.");
            if (targetChannel.permissionOverwrites.cache.has(message.author.id)) return message.reply("⚠️ Sei già dentro.");

            await targetChannel.permissionOverwrites.create(message.author.id, { 
                ViewChannel: true, 
                SendMessages: false,
                AddReactions: false,          
                CreatePublicThreads: false,   
                CreatePrivateThreads: false   
            });

            const participants = targetChannel.permissionOverwrites.cache
                .filter(o => o.id !== client.user.id && o.id !== message.author.id && o.id !== targetGuild.id)
                .map(o => `<@${o.id}>`)
                .join(' ');

            await targetChannel.send(`⚠️ ATTENZIONE ${participants}: ${message.author} è entrato per osservare la vostra conversazione.`);

            letturaCounts.set(message.author.id, currentRead + 1);
            await syncDatabase();

            const newEmbed = EmbedBuilder.from(targetEmbed)
                .setColor(0xFFA500)
                .spliceFields(0, 1, { name: 'Stato', value: '🟠 Supervisionato', inline: true })
                .addFields({ name: '👮 Supervisore', value: `${message.author}`, inline: true });

            await repliedMsg.edit({ embeds: [newEmbed] });
            message.reply("👁️ **Accesso Garantito** (Utenti avvisati).");
            message.channel.messages.cache.delete(repliedMsg.id);

        } catch (e) { 
            console.error(e);
            message.reply("❌ Errore tecnico.");
        }
    }

    // --- COMANDO: !fine ---
    if (message.content === '!fine') {
        if (message.guild.id !== ID_SERVER_TARGET) return;
        if (!message.channel.name.startsWith('meeting-')) return;

        message.channel.permissionOverwrites.cache.forEach((ow) => {
            if (ow.allow.has(PermissionsBitField.Flags.SendMessages)) {
                activeUsers.delete(ow.id);
            }
        });
        await syncDatabase(); 

        await message.channel.send("🛑 **Chat Chiusa.**");
        
        message.channel.permissionOverwrites.cache.forEach(async (overwrite) => {
            if (overwrite.id !== client.user.id) {
                await message.channel.permissionOverwrites.edit(overwrite.id, { 
                    SendMessages: false, 
                    AddReactions: false,        
                    CreatePublicThreads: false, 
                    CreatePrivateThreads: false 
                });
            }
        });
    }
});

// --- GESTIONE INTERAZIONI (MENU & BOTTONI) ---
client.on('interactionCreate', async interaction => {
    // Gestione Menu a Tendina (Iscrizione)
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'select_player' || interaction.customId === 'select_sponsor') {
            if (activeTable.limit === 0) return interaction.reply({ content: "⛔ Tabella chiusa.", ephemeral: true });

            const slotIndex = parseInt(interaction.values[0]);
            const userId = interaction.user.id;
            const type = interaction.customId === 'select_player' ? 'player' : 'sponsor';

            if (activeTable.slots[slotIndex][type]) {
                return interaction.reply({ content: "❌ Posto occupato!", ephemeral: true });
            }

            // Rimuove l'utente da altri slot per evitare duplicati
            activeTable.slots.forEach(slot => {
                if (slot.player === userId) slot.player = null;
                if (slot.sponsor === userId) slot.sponsor = null;
            });

            activeTable.slots[slotIndex][type] = userId;

            const newDescription = generateTableText();
            const originalEmbed = interaction.message.embeds[0];
            const newEmbed = new EmbedBuilder(originalEmbed).setDescription(newDescription);
            
            await interaction.update({ embeds: [newEmbed] });
        }
    }

    // Gestione Bottone (Abbandona Gioco)
    if (interaction.isButton()) {
        if (interaction.customId === 'leave_game') {
            if (activeTable.limit === 0) return interaction.reply({ content: "⛔ Tabella chiusa.", ephemeral: true });

            const userId = interaction.user.id;
            let found = false;

            activeTable.slots.forEach(slot => {
                if (slot.player === userId) { slot.player = null; found = true; }
                if (slot.sponsor === userId) { slot.sponsor = null; found = true; }
            });

            if (!found) {
                return interaction.reply({ content: "❌ Non eri iscritto in nessuna lista.", ephemeral: true });
            }

            const newDescription = generateTableText();
            const originalEmbed = interaction.message.embeds[0];
            const newEmbed = new EmbedBuilder(originalEmbed).setDescription(newDescription);

            await interaction.update({ embeds: [newEmbed] });
        }
    }
});

function generateTableText() {
    let text = "**Giocatori** \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b| \u200b \u200b **Sponsor**\n";
    text += "------------------------------\n";

    activeTable.slots.forEach((slot, i) => {
        const pName = slot.player ? `<@${slot.player}>` : "`(libero)`";
        const sName = slot.sponsor ? `<@${slot.sponsor}>` : "`(libero)`";
        text += `**#${i + 1}** ${pName} \u200b | \u200b ${sName}\n`;
    });
    return text;
}

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GFe33d.9RgkeDdLwtKrQhi69vQFgMCVaR-hqvYkkI-hVg');
