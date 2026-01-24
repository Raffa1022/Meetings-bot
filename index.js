const http = require('http');
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    Options, 
    PermissionsBitField, 
    ChannelType, 
    EmbedBuilder 
} = require('discord.js');

// 1. SERVER PER MANTENERE IL BOT SVEGLIO (Keep-alive per Koyeb)
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is alive');
}).listen(8000);

// 2. CONFIGURAZIONE DEL CLIENT DISCORD
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ],
    // Partials: permettono di leggere reazioni su messaggi vecchi
    partials: [Partials.Message, Partials.Reaction, Partials.User],
    
    // Cache: Ridotta per risparmiare RAM su Koyeb
    makeCache: Options.cacheWithLimits({
        MessageManager: 10,        // Ricorda solo gli ultimi 10 messaggi per canale
        PresenceManager: 0,       
        GuildMemberManager: 100    
    }),
});

// --- 🔧 CONFIGURAZIONE ID ---
const ID_SERVER_COMMAND = '1294619216447799376'; 
const ID_CANALE_LOG = '1294619216930013277';
const ID_SERVER_TARGET = '1463608688244822018';
const ID_CATEGORIA_TARGET = '1463608688991273015';
const ID_RUOLO_RESET = '1463619259728134299';
const ID_RUOLO_MEETING_1 = '1369800222448025711';
const ID_RUOLO_MEETING_2 = '1463689842285215764';

// --- 🔢 SISTEMI DI CONTEGGIO ---
const meetingCounts = new Map(); 
const MAX_MEETINGS = 3;
const letturaCounts = new Map(); 
const MAX_LETTURE = 1;

// 3. EVENTO: IL BOT È PRONTO
client.once('ready', () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    console.log("Sistema pronto: Ruoli meeting, Privacy e !impostazioni attivi.");
});

// 4. LOGICA GLOBALE REAZIONI (Gestisce i messaggi vecchi/partials)
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    // Recupera il messaggio se è vecchio (Partial)
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Errore recupero messaggio vecchio:', error);
            return;
        }
    }

    // Qui puoi aggiungere logica globale per le reazioni se necessario
});

// 5. GESTIONE COMANDI
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // !impostazioni
    if (message.content === '!impostazioni') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        const helpEmbed = new EmbedBuilder()
            .setTitle('🛠️ Pannello Comandi Bot')
            .setColor(0x0099FF)
            .setDescription("Lista comandi disponibili.")
            .addFields(
                { name: '🟢 `!meeting @utente`', value: 'Crea una chat privata.' },
                { name: '🛑 `!fine`', value: 'Archivia la chat.' },
                { name: '🕵️ `!lettura`', value: 'Entra come supervisore.' }
            );
        return message.channel.send({ embeds: [helpEmbed] });
    }

    // !azzeramento1 (Meeting)
    if (message.content === '!azzeramento1') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.roles.cache.has(ID_RUOLO_RESET)) return message.reply("❌ Non autorizzato.");
        meetingCounts.clear(); 
        return message.reply("🔄 Meeting azzerati (0/3).");
    }

    // !azzeramento2 (Letture)
    if (message.content === '!azzeramento2') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.roles.cache.has(ID_RUOLO_RESET)) return message.reply("❌ Non autorizzato.");
        letturaCounts.clear(); 
        return message.reply("🔄 Letture azzerate (0/1).");
    }

    // !meeting
    if (message.content.startsWith('!meeting ')) {
        if (message.guild.id !== ID_SERVER_COMMAND) return;

        const hasRole = message.member.roles.cache.has(ID_RUOLO_MEETING_1) || message.member.roles.cache.has(ID_RUOLO_MEETING_2);
        if (!hasRole) return message.reply("❌ Ruolo mancante.");

        const authorCount = meetingCounts.get(message.author.id) || 0;
        if (authorCount >= MAX_MEETINGS) return message.reply("❌ Limite 3 meeting raggiunto.");

        const userToInvite = message.mentions.users.first();
        if (!userToInvite || userToInvite.id === message.author.id) return message.reply("❌ Tagga un utente valido.");

        const scadenzaMs = 3 * 60 * 60 * 1000;
        const scadenzaUnix = Math.floor((Date.now() + scadenzaMs) / 1000);

        const proposalMsg = await message.channel.send(
            `🔔 **Richiesta Meeting**\n<@${userToInvite.id}>, ${message.author} vuole parlarti.\n⏳ Scadenza: <t:${scadenzaUnix}:R>`
        );
        
        await proposalMsg.react('✅');
        await proposalMsg.react('❌');

        const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && user.id === userToInvite.id;
        const collector = proposalMsg.createReactionCollector({ filter, time: scadenzaMs, max: 1 });

        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅') {
                let countAuthor = meetingCounts.get(message.author.id) || 0;
                let countInvite = meetingCounts.get(userToInvite.id) || 0;

                if (countAuthor >= MAX_MEETINGS || countInvite >= MAX_MEETINGS) {
                    return proposalMsg.reply("❌ Uno dei due ha raggiunto il limite.");
                }

                meetingCounts.set(message.author.id, countAuthor + 1);
                meetingCounts.set(userToInvite.id, countInvite + 1);

                try {
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

                    await newChannel.send(`🔒 Sessione avviata tra <@${message.author.id}> e <@${userToInvite.id}>. Scrivete **!fine** per chiudere.`);

                    const logChannel = await client.channels.fetch(ID_CANALE_LOG);
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('📂 Meeting Avviato')
                            .setColor(0x00FF00)
                            .setDescription(`Autore: ${message.author.tag}\nOspite: ${userToInvite.tag}`)
                            .setFooter({ text: `ID:${newChannel.id}` });
                        await logChannel.send({ embeds: [logEmbed] });
                    }
                } catch (e) { console.error(e); }
            } else {
                await proposalMsg.reply("❌ Rifiutato.");
            }
        });
    }

    // !lettura
    if (message.content === '!lettura') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.reference) return message.reply("❌ Rispondi al log verde.");

        const readCount = letturaCounts.get(message.author.id) || 0;
        if (readCount >= MAX_LETTURE) return message.reply("❌ Limite 1 lettura raggiunto.");

        try {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            const channelId = repliedMsg.embeds[0]?.footer?.text.match(/(\d{17,20})/)?.[1];
            if (!channelId) return message.reply("❌ ID non trovato.");

            const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
            const targetChannel = await targetGuild.channels.fetch(channelId);

            if (targetChannel.permissionOverwrites.cache.has(message.author.id)) {
                return message.reply("❌ Non puoi entrare nelle tue chat.");
            }

            await targetChannel.permissionOverwrites.create(message.author.id, { ViewChannel: true, SendMessages: false });
            letturaCounts.set(message.author.id, readCount + 1);
            message.reply("✅ Accesso supervisore attivato.");
        } catch (e) { console.error(e); }
    }

    // !fine
    if (message.content === '!fine') {
        if (message.guild.id !== ID_SERVER_TARGET || !message.channel.name.startsWith('meeting-')) return;

        await message.channel.send("🛑 Chat archiviata in sola lettura.");
        const overwrites = message.channel.permissionOverwrites.cache;
        for (const [id, overwrite] of overwrites) {
            if (id === client.user.id) continue;
            await message.channel.permissionOverwrites.edit(id, { SendMessages: false, AddReactions: false });
        }
    }
});

// LOGIN SICURO
client.login(process.env.TOKEN);







