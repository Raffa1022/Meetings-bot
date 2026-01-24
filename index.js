const http = require('http');
const { Client, GatewayIntentBits, Partials, Options, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');

// --- 1. SERVER KEEP-ALIVE (Per hosting gratuiti) ---
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is alive - Low Memory Mode');
}).listen(8000);

// --- 2. CONFIGURAZIONE CLIENT OTTIMIZZATA ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ],
    // I Partials sono CRUCIALI per leggere messaggi vecchi/non in cache
    partials: [
        Partials.Message, 
        Partials.Channel, 
        Partials.Reaction, 
        Partials.User, 
        Partials.GuildMember
    ],
    // Gestione memoria aggressiva: ricorda solo gli ultimi 10 messaggi
    makeCache: Options.cacheWithLimits({
        MessageManager: 10,       
        PresenceManager: 0,       
        GuildMemberManager: 10,   
        UserManager: 10,
        ReactionManager: 0,       
        ThreadManager: 0
    }),
});

// --- 🔧 CONFIGURAZIONE ID (DA COMPILARE) ---
const ID_SERVER_COMMAND = '1294619216447799376'; 
const ID_CANALE_LOG = '1294619216930013277';
const ID_SERVER_TARGET = '1463608688244822018';
const ID_CATEGORIA_TARGET = '1463608688991273015';

const ID_RUOLO_RESET = '1463619259728134299'; // Ruolo Staff per reset
const ID_RUOLO_MEETING_1 = '1369800222448025711';
const ID_RUOLO_MEETING_2 = '1463689842285215764';

// Canale dove il bot salva i dati (deve essere un canale privato per lo staff/bot)
const ID_CANALE_DATABASE = '1464707241394311282'; 

// --- 🔢 VARIABILI MEMORIA ---
const meetingCounts = new Map(); 
const letturaCounts = new Map(); 
const MAX_MEETINGS = 3;
const MAX_LETTURE = 1;

// --- 📦 SISTEMA DATABASE (DISCORD BACKUP) ---
async function syncDatabase() {
    try {
        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        if (!dbChannel) return console.error("❌ Canale Database non trovato!");

        const dataString = JSON.stringify({
            meeting: Object.fromEntries(meetingCounts),
            lettura: Object.fromEntries(letturaCounts)
        });

        // Invia il backup
        const sentMsg = await dbChannel.send(`📦 **BACKUP_DATI**\n\`\`\`json\n${dataString}\n\`\`\``);
        
        // PULIZIA RAM: Rimuove subito il messaggio di backup dalla cache del bot
        sentMsg.channel.messages.cache.delete(sentMsg.id);

    } catch (e) { console.error("Errore salvataggio DB:", e); }
}

async function restoreDatabase() {
    try {
        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        if (!dbChannel) return;

        // Scarica solo gli ultimi 10 messaggi per trovare il backup
        const messages = await dbChannel.messages.fetch({ limit: 10 });
        const lastBackup = messages.find(m => m.content.includes('BACKUP_DATI'));
        
        if (lastBackup) {
            const jsonStr = lastBackup.content.split('```json\n')[1].split('\n```')[0];
            const data = JSON.parse(jsonStr);
            
            meetingCounts.clear();
            Object.entries(data.meeting || {}).forEach(([id, val]) => meetingCounts.set(id, val));
            
            letturaCounts.clear();
            Object.entries(data.lettura || {}).forEach(([id, val]) => letturaCounts.set(id, val));
            
            console.log("✅ Database ripristinato con successo.");
        }
        
        // PULIZIA RAM: Svuota la cache dei messaggi appena scaricati
        messages.forEach(m => dbChannel.messages.cache.delete(m.id));

    } catch (e) { console.log("ℹ️ Nessun backup trovato o Database vuoto."); }
}

// --- 3. EVENTO AVVIO ---
client.once('ready', async () => {
    console.log(`✅ Bot online come: ${client.user.tag}`);
    await restoreDatabase(); 
});

// --- 4. GESTIONE REAZIONI (PARTIALS) ---
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    // Se la reazione è su un messaggio "vecchio" (non in RAM), scaricalo
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
                { name: '🔹 !meeting @utente', value: 'Crea una chat privata (Max 3).' },
                { name: '👁️ !lettura', value: 'Rispondi al messaggio verde per entrare in supervisione (Max 1).' },
                { name: '⚠️ !azzeramento1', value: 'Resetta il conteggio dei Meeting.' },
                { name: '⚠️ !azzeramento2', value: 'Resetta il conteggio delle Letture.' }
            )
            .setFooter({ text: 'Sistema Low-Memory v2.0' });

        return message.channel.send({ embeds: [helpEmbed] });
    }

    // --- COMANDO: !azzeramento1 (Reset Meeting) ---
    if (message.content === '!azzeramento1') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.roles.cache.has(ID_RUOLO_RESET)) return message.reply("⛔ Non hai i permessi.");

        meetingCounts.clear();
        await syncDatabase();
        return message.reply("♻️ Conteggio **Meeting** azzerato per tutti.");
    }

    // --- COMANDO: !azzeramento2 (Reset Lettura) ---
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

        // Controllo Ruolo
        const hasRole = message.member.roles.cache.has(ID_RUOLO_MEETING_1) || message.member.roles.cache.has(ID_RUOLO_MEETING_2);
        if (!hasRole) return message.reply("⛔ Ruolo non autorizzato.");

        // Controllo Limite
        const authorCount = meetingCounts.get(message.author.id) || 0;
        if (authorCount >= MAX_MEETINGS) return message.reply(`⚠️ Hai raggiunto il limite di ${MAX_MEETINGS} meeting.`);

        // Controllo Tag Utente
        const userToInvite = message.mentions.users.first();
        if (!userToInvite || userToInvite.id === message.author.id) return message.reply("⚠️ Devi taggare un utente valido.");

        // Invio Proposta
        const proposalMsg = await message.channel.send(`🔔 **Richiesta Meeting**\n👤 **Ospite:** ${userToInvite}\n📩 **Da:** ${message.author}\n\n*Reagisci per accettare/rifiutare*`);
        await proposalMsg.react('✅'); await proposalMsg.react('❌');

        // Collector Reazioni
        const collector = proposalMsg.createReactionCollector({ 
            filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === userToInvite.id, 
            time: 3 * 60 * 60 * 1000, max: 1 
        });

        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅') {
                // Recupero messaggio completo se parziale
                if (reaction.message.partial) await reaction.message.fetch();

                let cAuthor = meetingCounts.get(message.author.id) || 0;
                if (cAuthor >= MAX_MEETINGS) {
                    return reaction.message.reply("❌ Meeting annullato: limite raggiunto.").then(m => setTimeout(() => m.delete(), 5000));
                }

                // Incremento e Salvo
                meetingCounts.set(message.author.id, cAuthor + 1);
                // meetingCounts.set(userToInvite.id, (meetingCounts.get(userToInvite.id) || 0) + 1); // Decommenta se vuoi contare anche per l'invitato
                await syncDatabase();

                try {
                    // Creazione Canale
                    const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
                    const newChannel = await targetGuild.channels.create({
                        name: `meeting-${message.author.username}-${userToInvite.username}`,
                        type: ChannelType.GuildText, 
                        parent: ID_CATEGORIA_TARGET,
                        permissionOverwrites: [
                            { id: targetGuild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                            { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                            { id: userToInvite.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                        ],
                    });
                    
                    await newChannel.send(`👋 Benvenuti!\nScrivete **!fine** per chiudere la chat.`);
                    
                    // Creazione LOG VERDE
                    const logEmbed = new EmbedBuilder()
                        .setTitle('📂 Meeting Avviato')
                        .setColor(0x00FF00) // VERDE
                        .setDescription(`**Autore:** ${message.author.tag} (${cAuthor+1}/${MAX_MEETINGS})\n**Ospite:** ${userToInvite.tag}`)
                        .addFields({ name: 'Stato', value: '🟢 Aperto (Nessun supervisore)', inline: true })
                        .setFooter({ text: `ID:${newChannel.id}` })
                        .setTimestamp();
                    
                    // Risposta e invio LOG
                    await reaction.message.reply({ content: "✅ Meeting creato!", embeds: [logEmbed] });

                    // 🔥 PULIZIA RAM: Dimentica il messaggio di richiesta ora che è servito
                    reaction.message.channel.messages.cache.delete(reaction.message.id);

                } catch (e) { 
                    console.error("Errore creazione meeting:", e);
                    reaction.message.channel.send("❌ Errore nella creazione del canale.");
                }
            } else {
                reaction.message.reply("❌ Richiesta rifiutata.");
            }
        });
    }

    // --- COMANDO: !lettura ---
    if (message.content === '!lettura') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        
        // Controllo "Rispondi a..."
        if (!message.reference) return message.reply("⚠️ Devi rispondere al messaggio verde 'Meeting Avviato'.");

        // Controllo Limite
        const currentRead = letturaCounts.get(message.author.id) || 0;
        if (currentRead >= MAX_LETTURE) return message.reply("⛔ Hai raggiunto il limite di supervisioni.");

        try {
            // 1. FETCH FORZATO: Recupera il messaggio originale anche se vecchio
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);

            // Validazioni Embed
            if (!repliedMsg.embeds.length) return message.reply("⚠️ Messaggio non valido.");
            const targetEmbed = repliedMsg.embeds[0];

            // Controllo se già preso
            const isAlreadyTaken = targetEmbed.fields.some(f => f.name === '👮 Supervisore');
            if (isAlreadyTaken) return message.reply("⛔ Supervisore già presente.");

            // Recupero ID Canale
            const channelId = targetEmbed.footer?.text.match(/ID:(\d+)/)?.[1];
            if (!channelId) return message.reply("⚠️ Impossibile trovare ID canale.");

            // Accesso al Canale
            const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
            const targetChannel = await targetGuild.channels.fetch(channelId).catch(() => null);

            if (!targetChannel) return message.reply("❌ Il canale non esiste più.");
            if (targetChannel.permissionOverwrites.cache.has(message.author.id)) return message.reply("⚠️ Sei già dentro.");

            // Modifica Permessi
            await targetChannel.permissionOverwrites.create(message.author.id, { 
                ViewChannel: true, 
                SendMessages: false 
            });

            // Aggiornamento Conteggi
            letturaCounts.set(message.author.id, currentRead + 1);
            await syncDatabase();

            // Aggiornamento Embed: VERDE -> ARANCIONE
            const newEmbed = EmbedBuilder.from(targetEmbed)
                .setColor(0xFFA500) // ARANCIONE
                .spliceFields(0, 1, { name: 'Stato', value: '🟠 Supervisionato', inline: true })
                .addFields({ name: '👮 Supervisore', value: `${message.author}`, inline: true });

            await repliedMsg.edit({ embeds: [newEmbed] });
            message.reply("👁️ **Accesso Garantito** in modalità lettura.");

            // 🔥 PULIZIA RAM: Dimentica il messaggio vecchio per liberare memoria
            message.channel.messages.cache.delete(repliedMsg.id);

        } catch (e) { 
            console.error(e);
            message.reply("❌ Errore tecnico (Controlla console).");
        }
    }

    // --- COMANDO: !fine ---
    if (message.content === '!fine') {
        if (message.guild.id !== ID_SERVER_TARGET) return;
        if (!message.channel.name.startsWith('meeting-')) return;

        await message.channel.send("🛑 **Chat Chiusa**. Archiviazione...");
        
        message.channel.permissionOverwrites.cache.forEach(async (overwrite) => {
            if (overwrite.id !== client.user.id) {
                await message.channel.permissionOverwrites.edit(overwrite.id, { 
                    SendMessages: false, 
                    AddReactions: false 
                });
            }
        });
    }
});

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GFe33d.9RgkeDdLwtKrQhi69vQFgMCVaR-hqvYkkI-hVg');







