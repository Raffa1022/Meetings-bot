const http = require('http');
const { Client, GatewayIntentBits, Partials, Options, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');

// 1. SERVER PER KOYEB
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is alive');
}).listen(8000);

// 2. CONFIGURAZIONE CLIENT
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User],
    makeCache: Options.cacheWithLimits({
        MessageManager: 10,
        PresenceManager: 0,
        GuildMemberManager: 100
    }),
});

// --- 🔧 CONFIGURAZIONE ID (METTI I TUOI QUI) ---
const ID_SERVER_COMMAND = '1294619216447799376'; 
const ID_CANALE_LOG = '1294619216930013277';
const ID_SERVER_TARGET = '1463608688244822018';
const ID_CATEGORIA_TARGET = '1463608688991273015';
const ID_RUOLO_RESET = '1463619259728134299';
const ID_RUOLO_MEETING_1 = '1369800222448025711';
const ID_RUOLO_MEETING_2 = '1463689842285215764';

// ID DEL CANALE CHE FUNGE DA DATABASE
const ID_CANALE_DATABASE = '1464707241394311282'; 

// --- 🔢 MEMORIA CONTEGGI ---
const meetingCounts = new Map(); 
const letturaCounts = new Map(); 
const MAX_MEETINGS = 3;
const MAX_LETTURE = 1;

// --- 📦 FUNZIONI DI MEMORIA (DISCORD DATABASE) ---
async function syncDatabase() {
    try {
        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        const dataString = JSON.stringify({
            meeting: Object.fromEntries(meetingCounts),
            lettura: Object.fromEntries(letturaCounts)
        });
        await dbChannel.send(`📦 **BACKUP_DATI**\n\`\`\`json\n${dataString}\n\`\`\``);
    } catch (e) { console.error("Errore salvataggio:", e); }
}

async function restoreDatabase() {
    try {
        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        const messages = await dbChannel.messages.fetch({ limit: 20 });
        const lastBackup = messages.find(m => m.content.includes('BACKUP_DATI'));
        if (lastBackup) {
            const jsonStr = lastBackup.content.split('```json\n')[1].split('\n```')[0];
            const data = JSON.parse(jsonStr);
            meetingCounts.clear();
            Object.entries(data.meeting || {}).forEach(([id, val]) => meetingCounts.set(id, val));
            letturaCounts.clear();
            Object.entries(data.lettura || {}).forEach(([id, val]) => letturaCounts.set(id, val));
            console.log("✅ Memoria ripristinata dal canale Discord.");
        }
    } catch (e) { console.log("ℹ️ Nessun backup trovato."); }
}

// 3. EVENTO READY
client.once('ready', async () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    await restoreDatabase(); // Recupera i dati appena si accende
});

// 4. GESTIONE REAZIONI (MESSAGGI VECCHI)
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) {
        try { await reaction.fetch(); } catch (e) { return; }
    }
});

// 5. COMANDI
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // !impostazioni
    if (message.content === '!impostazioni') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        const helpEmbed = new EmbedBuilder()
            .setTitle('🛠️ Pannello Comandi')
            .setColor(0x0099FF)
            .addFields(
                { name: '🟢 !meeting @utente', value: 'Crea chat (Max 3)' },
                { name: '🕵️ !lettura', value: 'Supervisione (Max 1)' },
                { name: '🔄 !azzeramento1 / !azzeramento2', value: 'Reset Staff' }
            );
        return message.channel.send({ embeds: [helpEmbed] });
    }

    // !azzeramento1
    if (message.content === '!azzeramento1') {
        if (message.guild.id !== ID_SERVER_COMMAND || !message.member.roles.cache.has(ID_RUOLO_RESET)) return;
        meetingCounts.clear();
        await syncDatabase(); // Salva lo svuotamento
        return message.reply("🔄 Meeting azzerati e salvati.");
    }

    // !azzeramento2
    if (message.content === '!azzeramento2') {
        if (message.guild.id !== ID_SERVER_COMMAND || !message.member.roles.cache.has(ID_RUOLO_RESET)) return;
        letturaCounts.clear();
        await syncDatabase(); // Salva lo svuotamento
        return message.reply("🔄 Letture azzerate e salvate.");
    }

    // !meeting
    if (message.content.startsWith('!meeting ')) {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        const hasRole = message.member.roles.cache.has(ID_RUOLO_MEETING_1) || message.member.roles.cache.has(ID_RUOLO_MEETING_2);
        if (!hasRole) return message.reply("❌ Ruolo non autorizzato.");

        const authorCount = meetingCounts.get(message.author.id) || 0;
        if (authorCount >= MAX_MEETINGS) return message.reply("❌ Limite 3 meeting raggiunto.");

        const userToInvite = message.mentions.users.first();
        if (!userToInvite || userToInvite.id === message.author.id) return message.reply("❌ Tagga un utente valido.");

        const proposalMsg = await message.channel.send(`🔔 Richiesta Meeting per <@${userToInvite.id}> da ${message.author}. ✅/❌`);
        await proposalMsg.react('✅'); await proposalMsg.react('❌');

        const collector = proposalMsg.createReactionCollector({ 
            filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === userToInvite.id, 
            time: 3 * 60 * 60 * 1000, max: 1 
        });

        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅') {
                let cAuthor = meetingCounts.get(message.author.id) || 0;
                let cInvite = meetingCounts.get(userToInvite.id) || 0;
                if (cAuthor >= MAX_MEETINGS || cInvite >= MAX_MEETINGS) return proposalMsg.reply("❌ Limite raggiunto.");

                meetingCounts.set(message.author.id, cAuthor + 1);
                meetingCounts.set(userToInvite.id, cInvite + 1);
                await syncDatabase(); // <--- SALVA IL NUOVO CONTEGGIO

                try {
                    const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
                    const newChannel = await targetGuild.channels.create({
                        name: `meeting-${message.author.username}-${userToInvite.username}`,
                        type: ChannelType.GuildText, parent: ID_CATEGORIA_TARGET,
                        permissionOverwrites: [
                            { id: targetGuild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                            { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                            { id: userToInvite.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                        ],
                    });
                    await newChannel.send(`🔒 Benvenuti! Scrivete **!fine** per chiudere.`);
                    const logChannel = await client.channels.fetch(ID_CANALE_LOG);
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder().setTitle('📂 Meeting Avviato').setColor(0x00FF00)
                            .setDescription(`Autore: ${message.author.tag} (${cAuthor+1}/3)\nOspite: ${userToInvite.tag} (${cInvite+1}/3)`)
                            .setFooter({ text: `ID:${newChannel.id}` });
                        await logChannel.send({ embeds: [logEmbed] });
                    }
                } catch (e) { console.error(e); }
            }
        });
    }

    // !lettura
    if (message.content === '!lettura') {
        if (message.guild.id !== ID_SERVER_COMMAND || !message.reference) return;
        const currentRead = letturaCounts.get(message.author.id) || 0;
        if (currentRead >= MAX_LETTURE) return message.reply("❌ Limite 1 lettura raggiunto.");

        try {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            const channelId = repliedMsg.embeds[0]?.footer?.text.match(/(\d{17,20})/)?.[1];
            const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
            const targetChannel = await targetGuild.channels.fetch(channelId);

            if (targetChannel.permissionOverwrites.cache.has(message.author.id)) return message.reply("❌ Non puoi supervisionare le tue chat.");

            await targetChannel.permissionOverwrites.create(message.author.id, { ViewChannel: true, SendMessages: false });
            letturaCounts.set(message.author.id, currentRead + 1);
            await syncDatabase(); // <--- SALVA LA LETTURA USATA

            const newEmbed = EmbedBuilder.from(repliedMsg.embeds[0]).setColor(0xFFA500).addFields({ name: '👮‍♂️ Supervisore', value: `${message.author.tag}` });
            await repliedMsg.edit({ embeds: [newEmbed] });
            message.reply("✅ Accesso supervisore attivato.");
        } catch (e) { console.error(e); }
    }

    // !fine
    if (message.content === '!fine') {
        if (message.guild.id !== ID_SERVER_TARGET || !message.channel.name.startsWith('meeting-')) return;
        await message.channel.send("🛑 Chat archiviata.");
        message.channel.permissionOverwrites.cache.forEach(async (o) => {
            if (o.id !== client.user.id) await message.channel.permissionOverwrites.edit(o.id, { SendMessages: false, AddReactions: false });
        });
    }
});

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GFe33d.9RgkeDdLwtKrQhi69vQFgMCVaR-hqvYkkI-hVg');







