const http = require('http');
const { Client, GatewayIntentBits, Partials, Options, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');

// --- 1. SERVER KEEP-ALIVE ---
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is alive - Low Memory Mode v3.8 Verified');
}).listen(8000);

// --- 2. CONFIGURAZIONE CLIENT OTTIMIZZATA ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
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
const ID_SERVER_COMMAND = '1294619216447799376'; 
const ID_CANALE_LOG = '1294619216930013277';
const ID_SERVER_TARGET = '1463608688244822018';
const ID_CATEGORIA_TARGET = '1463608688991273015';

const ID_RUOLO_RESET = '1463619259728134299'; 
const ID_RUOLO_MEETING_1 = '1369800222448025711';
const ID_RUOLO_MEETING_2 = '1463689842285215764';

// Canale Database
const ID_CANALE_DATABASE = '1464707241394311282'; 

// --- 🔢 VARIABILI MEMORIA ---
const meetingCounts = new Map(); 
const letturaCounts = new Map(); 
// Questa variabile tiene traccia di chi è IN QUESTO MOMENTO in una chat
const activeUsers = new Set(); 
const MAX_MEETINGS = 3;
const MAX_LETTURE = 1;

// --- 📦 SISTEMA DATABASE ---
async function syncDatabase() {
    try {
        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        if (!dbChannel) return console.error("❌ Canale Database non trovato!");

        const dataString = JSON.stringify({
            meeting: Object.fromEntries(meetingCounts),
            lettura: Object.fromEntries(letturaCounts),
            active: Array.from(activeUsers) // Salviamo anche chi è bloccato
        });

        const sentMsg = await dbChannel.send(`📦 **BACKUP_DATI**\n\`\`\`json\n${dataString}\n\`\`\``);
        sentMsg.channel.messages.cache.delete(sentMsg.id); // Pulizia RAM

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
            
            // Ripristino utenti attivi/bloccati
            activeUsers.clear();
            (data.active || []).forEach(id => activeUsers.add(id));
            
            console.log("✅ Database ripristinato.");
        }
        messages.forEach(m => dbChannel.messages.cache.delete(m.id)); // Pulizia RAM

    } catch (e) { console.log("ℹ️ Nessun backup trovato."); }
}

// --- 3. EVENTO AVVIO ---
client.once('ready', async () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    await restoreDatabase(); 
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
                { name: '🔹 !meeting @utente', value: 'Crea una chat privata (Max 3).\n*Non puoi crearne una nuova se non finisci quella attiva.*' },
                { name: '👁️ !lettura', value: 'Rispondi al messaggio verde per supervisionare (Max 1).' },
                { name: '🛑 !fine', value: 'Chiude la chat privata.' },
                { name: '⚠️ !azzeramento1', value: 'Resetta meeting e sblocca utenti.' },
                { name: '⚠️ !azzeramento2', value: 'Resetta il conteggio delle Letture.' }
            )
            .setFooter({ text: 'Sistema v3.8 - Low Memory Verified' });

        return message.channel.send({ embeds: [helpEmbed] });
    }

    // --- !azzeramento1 ---
    if (message.content === '!azzeramento1') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.roles.cache.has(ID_RUOLO_RESET)) return message.reply("⛔ Non hai i permessi.");

        meetingCounts.clear();
        activeUsers.clear(); // Sblocca tutti gli utenti "incastrati"
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

    // --- COMANDO: !meeting ---
    if (message.content.startsWith('!meeting ')) {
        if (message.guild.id !== ID_SERVER_COMMAND) return;

        // CONTROLLO 1: L'autore ha il ruolo?
        const hasRoleAuthor = message.member.roles.cache.has(ID_RUOLO_MEETING_1) || message.member.roles.cache.has(ID_RUOLO_MEETING_2);
        if (!hasRoleAuthor) return message.reply("⛔ Non hai il ruolo autorizzato per creare meeting.");

        // CHECK 2: Autore già impegnato?
        if (activeUsers.has(message.author.id)) {
            return message.reply("⚠️ Hai già una chat attiva! Concludila con **!fine** prima di aprirne un'altra.");
        }

        const authorCount = meetingCounts.get(message.author.id) || 0;
        if (authorCount >= MAX_MEETINGS) return message.reply(`⚠️ Hai raggiunto il limite TOTALE di ${MAX_MEETINGS} meeting.`);

        const userToInvite = message.mentions.users.first();
        if (!userToInvite || userToInvite.id === message.author.id) return message.reply("⚠️ Devi taggare un utente valido.");

        // --- NUOVO CONTROLLO: L'ospite ha il ruolo? ---
        try {
            const memberToInvite = await message.guild.members.fetch(userToInvite.id);
            const hasRoleGuest = memberToInvite.roles.cache.has(ID_RUOLO_MEETING_1) || memberToInvite.roles.cache.has(ID_RUOLO_MEETING_2);
            
            if (!hasRoleGuest) {
                return message.reply(`⛔ L'utente ${userToInvite} non ha il ruolo necessario per partecipare ai meeting.`);
            }
        } catch (e) {
            return message.reply("⚠️ Impossibile verificare i permessi dell'utente invitato.");
        }
        // ----------------------------------------------

        // CHECK 3: Ospite già impegnato?
        if (activeUsers.has(userToInvite.id)) {
            return message.reply(`⚠️ L'utente ${userToInvite} è già impegnato in un'altra chat attiva.`);
        }

        const proposalMsg = await message.channel.send(`🔔 **Richiesta Meeting**\n👤 **Ospite:** ${userToInvite}\n📩 **Da:** ${message.author}\n\n*Reagisci per accettare/rifiutare*`);
        await proposalMsg.react('✅'); await proposalMsg.react('❌');

        const collector = proposalMsg.createReactionCollector({ 
            filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === userToInvite.id, 
            time: 3 * 60 * 60 * 1000, max: 1 
        });

        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅') {
                if (reaction.message.partial) await reaction.message.fetch();

                // CHECK 4: Controllo finale anti-spam
                if (activeUsers.has(message.author.id) || activeUsers.has(userToInvite.id)) {
                     return reaction.message.reply("❌ Meeting annullato: Uno dei partecipanti risulta ora occupato.");
                }

                let cAuthor = meetingCounts.get(message.author.id) || 0;
                let cGuest = meetingCounts.get(userToInvite.id) || 0;

                if (cAuthor >= MAX_MEETINGS) return reaction.message.reply(`❌ Meeting annullato: ${message.author} ha finito i token.`);
                if (cGuest >= MAX_MEETINGS) return reaction.message.reply(`❌ Meeting annullato: ${userToInvite} ha finito i token.`);

                meetingCounts.set(message.author.id, cAuthor + 1);
                meetingCounts.set(userToInvite.id, cGuest + 1);
                
                // BLOCCO UTENTI
                activeUsers.add(message.author.id);
                activeUsers.add(userToInvite.id);
                
                await syncDatabase();

                try {
                    const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
                    const newChannel = await targetGuild.channels.create({
                        name: `meeting-${message.author.username}-${userToInvite.username}`,
                        type: ChannelType.GuildText, 
                        parent: ID_CATEGORIA_TARGET,
                        permissionOverwrites: [
                            { id: targetGuild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                            // AUTORE (Blocco Thread)
                            { 
                                id: message.author.id, 
                                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                                deny: [PermissionsBitField.Flags.CreatePublicThreads, PermissionsBitField.Flags.CreatePrivateThreads] 
                            },
                            // OSPITE (Blocco Thread)
                            { 
                                id: userToInvite.id, 
                                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                                deny: [PermissionsBitField.Flags.CreatePublicThreads, PermissionsBitField.Flags.CreatePrivateThreads]
                            },
                            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                        ],
                    });
                    
                    await newChannel.send(`👋 Benvenuti ${message.author} ${userToInvite}!\nScrivete **!fine** per chiudere la chat.`);
                    
                    const logEmbed = new EmbedBuilder()
                        .setTitle('📂 Meeting Avviato')
                        .setColor(0x00FF00) // VERDE
                        .setDescription(`**Autore:** ${message.author.tag} (${cAuthor+1}/${MAX_MEETINGS})\n**Ospite:** ${userToInvite.tag} (${cGuest+1}/${MAX_MEETINGS})\n\nℹ️ Rispondi con **!lettura** per osservare la chat.`)
                        .addFields({ name: 'Stato', value: '🟢 Aperto (Nessun supervisore)', inline: true })
                        .setFooter({ text: `ID:${newChannel.id}` })
                        .setTimestamp();
                    
                    await reaction.message.reply({ content: "✅ Meeting creato!", embeds: [logEmbed] });
                    reaction.message.channel.messages.cache.delete(reaction.message.id);

                } catch (e) { 
                    console.error("Errore creazione:", e);
                    reaction.message.channel.send("❌ Errore creazione canale.");
                    // ROLLBACK: Sblocca utenti se fallisce
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

            // Aggiungi Supervisore (NO Thread, NO Scrittura, NO Reazioni)
            await targetChannel.permissionOverwrites.create(message.author.id, { 
                ViewChannel: true, 
                SendMessages: false,
                AddReactions: false,          
                CreatePublicThreads: false,   
                CreatePrivateThreads: false   
            });

            // Tag Utenti
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

        // SBLOCCO UTENTI: Rimuove dal Set chi aveva permesso di scrivere (Autore e Ospite)
        message.channel.permissionOverwrites.cache.forEach((ow) => {
            if (ow.allow.has(PermissionsBitField.Flags.SendMessages)) {
                activeUsers.delete(ow.id);
            }
        });
        await syncDatabase(); // Salva lo stato sbloccato

        // MODIFICA QUI: Rimosso "Archiviazione..."
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

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GFe33d.9RgkeDdLwtKrQhi69vQFgMCVaR-hqvYkkI-hVg');
