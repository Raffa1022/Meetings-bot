const http = require('http');
const { Client, GatewayIntentBits, Partials, Options, PermissionsBitField, ChannelType, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// --- 1. SERVER KEEP-ALIVE ---
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is alive - Low Memory Mode v5.2 (Fix Impostazioni GUI)');
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

// --- 🔢 VARIABILI MEMORIA (Limiti impostati qui) ---
const meetingCounts = new Map(); 
const letturaCounts = new Map(); 
const activeUsers = new Set(); 
const MAX_MEETINGS = 3; // Massimo 3 meeting
const MAX_LETTURE = 1;  // Massima 1 lettura

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
        // Cancella il messaggio precedente (clean log) solo se non è un archivio storico
        sentMsg.channel.messages.cache.delete(sentMsg.id); 

    } catch (e) { console.error("Errore salvataggio DB:", e); }
}

async function restoreDatabase() {
    try {
        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        if (!dbChannel) return;

        // Aumentato limite fetch per trovare eventuali archivi vecchi
        const messages = await dbChannel.messages.fetch({ limit: 20 });
        
        // Cerca prima il Backup Standard
        let dataMsg = messages.find(m => m.content.includes('BACKUP_DATI'));
        
        if (dataMsg) {
            const jsonStr = dataMsg.content.split('```json\n')[1].split('\n```')[0];
            const data = JSON.parse(jsonStr);
            
            meetingCounts.clear();
            Object.entries(data.meeting || {}).forEach(([id, val]) => meetingCounts.set(id, val));
            letturaCounts.clear();
            Object.entries(data.lettura || {}).forEach(([id, val]) => letturaCounts.set(id, val));
            
            activeUsers.clear();
            (data.active || []).forEach(id => activeUsers.add(id));

            if (data.autorole !== undefined) isAutoRoleActive = data.autorole;
            
            console.log(`✅ Database ripristinato (Contatori e Utenti attivi).`);
        }
        
        // Pulizia vecchi messaggi di backup (ma NON degli archivi chiusura)
        messages.forEach(m => {
            if(m.content.includes('BACKUP_DATI') && m.id !== dataMsg?.id) {
                dbChannel.messages.delete(m.id).catch(() => {});
            }
        }); 

    } catch (e) { console.log("ℹ️ Nessun backup trovato.", e); }
}

// --- 🔥 NUOVA FUNZIONE: RECUPERO TABELLA INTELLIGENTE ---
async function retrieveLatestTable() {
    if (activeTable.limit > 0 && activeTable.slots.length > 0) {
        return activeTable;
    }
    try {
        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        if (!dbChannel) return { slots: [] };

        const messages = await dbChannel.messages.fetch({ limit: 30 });
        const archiveMsg = messages.find(m => m.content.includes('ARCHIVIO_TABELLA'));

        if (archiveMsg) {
            const jsonStr = archiveMsg.content.split('```json\n')[1].split('\n```')[0];
            const data = JSON.parse(jsonStr);
            if (data.tableBackup) {
                return data.tableBackup;
            }
        }
    } catch (e) {
        console.error("Errore recupero tabella archiviata:", e);
    }
    return { slots: [] }; 
}

// --- 3. EVENTO AVVIO ---
client.once('ready', async () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    await restoreDatabase(); 
});

// --- 🆕 EVENTO: GESTIONE INGRESSI (ALT & AUTO-JOIN) ---
client.on('guildMemberAdd', async member => {
    try {
        const fetchedMember = await member.guild.members.fetch(member.id);
        if (fetchedMember.roles.cache.has(ID_RUOLO_ALT)) {
            console.log(`🚫 Utente Alt rilevato: ${member.user.tag}.`);
            const welcomeChannel = member.guild.channels.cache.get(ID_CANALE_BENVENUTO);
            if (welcomeChannel) {
                await welcomeChannel.permissionOverwrites.create(member.id, { ViewChannel: false });
            }
            return; 
        }
    } catch (e) { console.error("Errore verifica Alt:", e); }

    if (!isAutoRoleActive) return;
    try {
        await member.roles.add(ID_RUOLO_AUTO_JOIN);
    } catch (e) { console.error(`Errore assegnazione ruolo a ${member.user.tag}:`, e); }
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

    // --- COMANDO: !impostazioni ---
    if (message.content === '!impostazioni') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        
        const helpEmbed = new EmbedBuilder()
            .setTitle('⚙️ Pannello Gestione Bot')
            .setColor(0x2B2D31)
            .addFields(
                { name: '🔹 !meeting @giocatore (Giocatori)', value: 'Invita un altro giocatore.' },
                { name: '🛑 !fine (Giocatori)', value: 'Chiude la chat privata.' },
                { name: '👁️ !lettura (Giocatori)', value: 'Supervisione chat attiva.' }, 
                { name: '🚪 !entrata (Overseer)', value: `Auto-ruolo ingresso (Stato: ${isAutoRoleActive ? 'ON' : 'OFF'})` },
                { name: '📋 !tabella [num] (Overseer)', value: 'Crea nuova tabella iscrizioni.' },
                { name: '🚀 !assegna (Overseer)', value: 'Assegna stanze e ruoli.' },
                { name: '🔒 !chiusura (Overseer)', value: 'Archivia tabella nel DB.' },
                { name: '⚠️ !azzeramento1 / !azzeramento2', value: 'Reset meeting / Reset letture.' }
            )
            .setFooter({ text: 'Sistema v5.2 - Fix Cross-Role & GUI' });

        return message.channel.send({ embeds: [helpEmbed] });
    }

    // --- COMANDO: !entrata ---
    if (message.content === '!entrata') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        isAutoRoleActive = !isAutoRoleActive;
        await syncDatabase(); 
        const stato = isAutoRoleActive ? "✅ ATTIVO" : "🛑 DISATTIVO";
        message.reply(`🚪 **Auto-Ruolo Ingressi:** ${stato}.`);
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
            new StringSelectMenuBuilder().setCustomId('select_player').setPlaceholder('👤 Seleziona Slot Giocatore').addOptions(options)
        );
        const rowSponsor = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_sponsor').setPlaceholder('💰 Seleziona Slot Sponsor').addOptions(options)
        );
        const rowButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('leave_game').setLabel('🏃 Abbandona Gioco').setStyle(ButtonStyle.Danger)
        );

        const sentMsg = await message.channel.send({ embeds: [embed], components: [rowPlayer, rowSponsor, rowButton] });
        activeTable.messageId = sentMsg.id;
    }

    // --- COMANDO: !assegna ---
    if (message.content === '!assegna') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        if (activeTable.limit === 0) return message.reply("⚠️ Nessuna tabella attiva in memoria.");

        await message.reply("⏳ **Inizio configurazione Stanze e Ruoli...**");

        const category = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_RUOLO);
        let assegnati = 0;

        for (let i = 0; i < activeTable.limit; i++) {
            const slot = activeTable.slots[i];
            const channelName = `${i + 1}`; 
            const channel = message.guild.channels.cache.find(c => c.parentId === ID_CATEGORIA_CHAT_RUOLO && c.name === channelName);

            if (channel) {
                await channel.permissionOverwrites.set([{ id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]);
                
                const permessiSpeciali = {
                    ViewChannel: true, SendMessages: true, ManageMessages: true,        
                    CreatePrivateThreads: true, SendMessagesInThreads: true, CreatePublicThreads: false   
                };

                let utentiDaSalutare = [];

                if (slot.player) {
                    await channel.permissionOverwrites.edit(slot.player, permessiSpeciali);
                    utentiDaSalutare.push(`<@${slot.player}>`);
                    try { (await message.guild.members.fetch(slot.player)).roles.add(ID_RUOLO_GIOCATORE_AUTO); } catch (e) {}
                }
                if (slot.sponsor) {
                    await channel.permissionOverwrites.edit(slot.sponsor, permessiSpeciali);
                    utentiDaSalutare.push(`<@${slot.sponsor}>`);
                    try { (await message.guild.members.fetch(slot.sponsor)).roles.add(ID_RUOLO_SPONSOR_AUTO); } catch (e) {}
                }

                if (utentiDaSalutare.length > 0) {
                    await channel.send(`Benvenuti ${utentiDaSalutare.join(' ')}!`);
                }
                assegnati++;
            }
        }
        await message.channel.send(`✅ **Operazione completata!** Stanze configurate: ${assegnati}.`);
    }

    // --- COMANDO: !chiusura ---
    if (message.content === '!chiusura') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        if (dbChannel) {
            const dataToArchive = {
                tableBackup: activeTable,
                meeting: Object.fromEntries(meetingCounts),
                lettura: Object.fromEntries(letturaCounts),
                active: Array.from(activeUsers),
                autorole: isAutoRoleActive
            };
            const jsonStr = JSON.stringify(dataToArchive);
            await dbChannel.send(`📁 **ARCHIVIO_TABELLA** (Chiusura del ${new Date().toLocaleTimeString('it-IT')})\n\`\`\`json\n${jsonStr}\n\`\`\``);
        }

        activeTable = { limit: 0, slots: [], messageId: null };
        message.reply("🔒 **Tabella archiviata nel DB e memoria locale resettata.**");
    }

    // --- COMANDO: !meeting (CON MODIFICA RICHIESTA) ---
    if (message.content.startsWith('!meeting ')) {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        // La riga sotto impedisce già allo sponsor di *iniziare* il meeting, ma manteniamo il controllo extra per sicurezza
        if (!message.member.roles.cache.has(ID_RUOLO_GIOCATORE_AUTO)) return message.reply("❌ Solo i Giocatori possono gestire i meeting.");
        if (!message.member.roles.cache.has(ID_RUOLO_MEETING_1) && !message.member.roles.cache.has(ID_RUOLO_MEETING_2)) return message.reply("⛔ Non hai il ruolo autorizzato.");

        if (activeUsers.has(message.author.id)) return message.reply("⚠️ Hai già una chat attiva!");

        const authorCount = meetingCounts.get(message.author.id) || 0;
        if (authorCount >= MAX_MEETINGS) return message.reply(`⚠️ Limite raggiunto (${MAX_MEETINGS}).`);

        const userToInvite = message.mentions.users.first();
        if (!userToInvite || userToInvite.id === message.author.id) return message.reply("⚠️ Tagga un altro giocatore.");

        // --- 👇 INIZIO MODIFICA: CONTROLLO INCROCIO RUOLI 👇 ---
        try {
            // Recuperiamo l'oggetto GuildMember del target per controllare i ruoli
            const targetMember = await message.guild.members.fetch(userToInvite.id);
            
            const isAuthorPlayer = message.member.roles.cache.has(ID_RUOLO_GIOCATORE_AUTO);
            const isAuthorSponsor = message.member.roles.cache.has(ID_RUOLO_SPONSOR_AUTO);
            
            const isTargetPlayer = targetMember.roles.cache.has(ID_RUOLO_GIOCATORE_AUTO);
            const isTargetSponsor = targetMember.roles.cache.has(ID_RUOLO_SPONSOR_AUTO);

            // 1. Giocatore prova a invitare Sponsor
            if (isAuthorPlayer && isTargetSponsor) {
                return message.reply("⛔ **Azione Negata:** Un Giocatore non può invitare uno Sponsor.");
            }
            // 2. Sponsor prova a invitare Giocatore (anche se bloccato sopra, doppia sicurezza)
            if (isAuthorSponsor && isTargetPlayer) {
                return message.reply("⛔ **Azione Negata:** Uno Sponsor non può invitare un Giocatore.");
            }
        } catch (e) {
            console.error("Errore nel controllo ruoli meeting:", e);
            // Non blocchiamo se fallisce il fetch, procediamo (o puoi mettere return se vuoi essere restrittivo)
        }
        // --- 👆 FINE MODIFICA 👆 ---

        if (activeUsers.has(userToInvite.id)) return message.reply(`⚠️ ${userToInvite} è impegnato.`);

        const proposalMsg = await message.channel.send(`🔔 **Richiesta Meeting**\n👤 **Ospite:** ${userToInvite}\n📩 **Da:** ${message.author}\n\n*Reagisci per accettare/rifiutare*`);
        await proposalMsg.react('✅'); await proposalMsg.react('❌');

        const collector = proposalMsg.createReactionCollector({ 
            filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === userToInvite.id, 
            time: 3 * 60 * 60 * 1000, max: 1 
        });

        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅') {
                if (activeUsers.has(message.author.id) || activeUsers.has(userToInvite.id)) return reaction.message.reply("❌ Uno dei giocatori è ora occupato.");
                
                let cAuthor = meetingCounts.get(message.author.id) || 0;
                let cGuest = meetingCounts.get(userToInvite.id) || 0;
                if (cAuthor >= MAX_MEETINGS || cGuest >= MAX_MEETINGS) return reaction.message.reply("❌ Token finiti.");

                const tableData = await retrieveLatestTable();
                
                const sponsorAuthor = tableData.slots.find(s => s.player === message.author.id)?.sponsor;
                const sponsorGuest = tableData.slots.find(s => s.player === userToInvite.id)?.sponsor;

                meetingCounts.set(message.author.id, cAuthor + 1);
                meetingCounts.set(userToInvite.id, cGuest + 1);
                activeUsers.add(message.author.id);
                activeUsers.add(userToInvite.id);
                await syncDatabase();

                try {
                    const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
                    const permissions = [
                        { id: targetGuild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], deny: [PermissionsBitField.Flags.CreatePublicThreads] },
                        { id: userToInvite.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], deny: [PermissionsBitField.Flags.CreatePublicThreads] }
                    ];

                    if (sponsorAuthor) permissions.push({ id: sponsorAuthor, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], deny: [PermissionsBitField.Flags.CreatePublicThreads] });
                    if (sponsorGuest) permissions.push({ id: sponsorGuest, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], deny: [PermissionsBitField.Flags.CreatePublicThreads] });

                    const newChannel = await targetGuild.channels.create({
                        name: `meeting-${message.author.username}-${userToInvite.username}`,
                        type: ChannelType.GuildText, 
                        parent: ID_CATEGORIA_TARGET,
                        permissionOverwrites: permissions,
                    });

                    let participantsText = `${message.author} e ${userToInvite}`;
                    if (sponsorAuthor) participantsText += ` <@${sponsorAuthor}>`;
                    if (sponsorGuest) participantsText += ` <@${sponsorGuest}>`;

                    const welcomeEmbed = new EmbedBuilder().setTitle("👋 Meeting Avviato").setDescription(`Benvenuti!\nScrivete **!fine** per chiudere.`).setColor(0x00FFFF);
                    await newChannel.send({ content: `🔔 Benvenuti: ${participantsText}`, embeds: [welcomeEmbed] });

                    const logEmbed = new EmbedBuilder()
                        .setTitle('📂 Meeting Avviato')
                        .setColor(0x00FF00) 
                        .setDescription(`**Autore:** ${message.author.tag}\n**Ospite:** ${userToInvite.tag}\nℹ️ Rispondi con **!lettura** per osservare.`)
                        .setFooter({ text: `ID:${newChannel.id}` });
                    
                    await reaction.message.reply({ content: "✅ Meeting creato!", embeds: [logEmbed] });
                    reaction.message.channel.messages.cache.delete(reaction.message.id);

                } catch (e) { 
                    console.error("Errore creazione:", e);
                    activeUsers.delete(message.author.id);
                    activeUsers.delete(userToInvite.id);
                }
            } else { reaction.message.reply("❌ Richiesta rifiutata."); }
        });
    }

    // --- COMANDO: !lettura ---
    if (message.content === '!lettura') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.reference) return message.reply("⚠️ Rispondi al messaggio verde.");
        if (!message.member.roles.cache.has(ID_RUOLO_GIOCATORE_AUTO)) return message.reply("❌ Accesso Negato.");

        const currentRead = letturaCounts.get(message.author.id) || 0;
        if (currentRead >= MAX_LETTURE) return message.reply("⛔ Limite supervisioni raggiunto.");

        try {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            const targetEmbed = repliedMsg.embeds[0];
            if (targetEmbed.fields.some(f => f.name === '👮 Supervisore')) return message.reply("⛔ Supervisore già presente.");

            const channelId = targetEmbed.footer?.text.match(/ID:(\d+)/)?.[1];
            const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
            const targetChannel = await targetGuild.channels.fetch(channelId).catch(() => null);

            if (!targetChannel) return message.reply("❌ Canale inesistente.");
            if (targetChannel.permissionOverwrites.cache.has(message.author.id)) return message.reply("⚠️ Sei già dentro.");

            const tableData = await retrieveLatestTable();
            const supervisorSponsor = tableData.slots.find(s => s.player === message.author.id)?.sponsor;

            await targetChannel.permissionOverwrites.create(message.author.id, { ViewChannel: true, SendMessages: false });
            if (supervisorSponsor) {
                await targetChannel.permissionOverwrites.create(supervisorSponsor, { ViewChannel: true, SendMessages: false });
            }

            let supervisorText = `${message.author}`;
            if (supervisorSponsor) supervisorText += ` e il suo Sponsor <@${supervisorSponsor}>`;
            
            const participants = targetChannel.permissionOverwrites.cache
                .filter(o => o.id !== client.user.id && o.id !== message.author.id && o.id !== targetGuild.id && (supervisorSponsor ? o.id !== supervisorSponsor : true))
                .map(o => `<@${o.id}>`).join(' ');

            await targetChannel.send(`⚠️ ATTENZIONE ${participants}: ${supervisorText} è entrato per osservare.`);

            letturaCounts.set(message.author.id, currentRead + 1);
            await syncDatabase();

            const newEmbed = EmbedBuilder.from(targetEmbed)
                .setColor(0xFFA500)
                .spliceFields(0, 1, { name: 'Stato', value: '🟠 Supervisionato', inline: true })
                .addFields({ name: '👮 Supervisore', value: supervisorText, inline: true });

            await repliedMsg.edit({ embeds: [newEmbed] });
            message.reply("👁️ **Accesso Garantito**.");
            message.channel.messages.cache.delete(repliedMsg.id);

        } catch (e) { console.error(e); message.reply("❌ Errore tecnico."); }
    }

    // --- COMANDO: !fine ---
    if (message.content === '!fine') {
        if (message.guild.id !== ID_SERVER_TARGET) return;
        if (!message.channel.name.startsWith('meeting-')) return;

        message.channel.permissionOverwrites.cache.forEach((ow) => {
            if (ow.allow.has(PermissionsBitField.Flags.SendMessages)) activeUsers.delete(ow.id);
        });
        await syncDatabase(); 

        await message.channel.send("🛑 **Chat Chiusa.**");
        message.channel.permissionOverwrites.cache.forEach(async (overwrite) => {
            if (overwrite.id !== client.user.id) {
                await message.channel.permissionOverwrites.edit(overwrite.id, { SendMessages: false, AddReactions: false });
            }
        });
    }
});

// --- GESTIONE INTERAZIONI ---
client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu() && (interaction.customId === 'select_player' || interaction.customId === 'select_sponsor')) {
        if (activeTable.limit === 0) return interaction.reply({ content: "⛔ Tabella chiusa.", ephemeral: true });

        const slotIndex = parseInt(interaction.values[0]);
        const type = interaction.customId === 'select_player' ? 'player' : 'sponsor';

        if (activeTable.slots[slotIndex][type]) return interaction.reply({ content: "❌ Posto occupato!", ephemeral: true });

        activeTable.slots.forEach(slot => {
            if (slot.player === interaction.user.id) slot.player = null;
            if (slot.sponsor === interaction.user.id) slot.sponsor = null;
        });

        activeTable.slots[slotIndex][type] = interaction.user.id;
        await interaction.update({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setDescription(generateTableText())] });
    }

    if (interaction.isButton() && interaction.customId === 'leave_game') {
        if (activeTable.limit === 0) return interaction.reply({ content: "⛔ Tabella chiusa.", ephemeral: true });
        
        let found = false;
        activeTable.slots.forEach(slot => {
            if (slot.player === interaction.user.id) { slot.player = null; found = true; }
            if (slot.sponsor === interaction.user.id) { slot.sponsor = null; found = true; }
        });

        if (!found) return interaction.reply({ content: "❌ Non eri iscritto.", ephemeral: true });
        await interaction.update({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setDescription(generateTableText())] });
    }
});

function generateTableText() {
    let text = "**Giocatori** \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b| \u200b \u200b **Sponsor**\n------------------------------\n";
    activeTable.slots.forEach((slot, i) => {
        text += `**#${i + 1}** ${slot.player ? `<@${slot.player}>` : "`(libero)`"} \u200b | \u200b ${slot.sponsor ? `<@${slot.sponsor}>` : "`(libero)`"}\n`;
    });
    return text;
}

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GFe33d.9RgkeDdLwtKrQhi69vQFgMCVaR-hqvYkkI-hVg');
