const { Client, GatewayIntentBits, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');

// --- 🔧 CONFIGURAZIONE ID ---
const ID_SERVER_COMMAND = '1294619216447799376'; 
const ID_CANALE_LOG = '1294619216930013277';
const ID_SERVER_TARGET = '1463608688244822018';
const ID_CATEGORIA_TARGET = '1463608688991273015';
const ID_RUOLO_RESET = '1463619259728134299';
const ID_RUOLO_MEETING_1 = '1369800222448025711';
const ID_RUOLO_MEETING_2 = '1463689842285215764';

const meetingCounts = new Map();
const MAX_MEETINGS = 3;
const letturaCounts = new Map();
const MAX_LETTURE = 1;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ]
});

// EVENTO CORRETTO: 'ready'
client.once('ready', () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // !impostazioni
    if (message.content === '!impostazioni') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        const helpEmbed = new EmbedBuilder()
            .setTitle('🛠️ Pannello Comandi Bot')
            .setColor(0x0099FF)
            .setDescription("Lista comandi attivi.")
            .addFields(
                { name: '🟢 `!meeting @utente`', value: 'Crea chat privata.' },
                { name: '🛑 `!fine`', value: 'Archivia la chat.' },
                { name: '🕵️ `!lettura`', value: 'Entra come supervisore.' }
            );
        return message.channel.send({ embeds: [helpEmbed] });
    }

    // !azzeramento1
    if (message.content === '!azzeramento1') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.roles.cache.has(ID_RUOLO_RESET)) return message.reply("❌ No permessi.");
        meetingCounts.clear(); 
        return message.reply("🔄 Meeting resettati.");
    }

    // !azzeramento2
    if (message.content === '!azzeramento2') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.roles.cache.has(ID_RUOLO_RESET)) return message.reply("❌ No permessi.");
        letturaCounts.clear(); 
        return message.reply("🔄 Letture resettate.");
    }

    // !meeting
    if (message.content.startsWith('!meeting ')) {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        const hasRole1 = message.member.roles.cache.has(ID_RUOLO_MEETING_1);
        const hasRole2 = message.member.roles.cache.has(ID_RUOLO_MEETING_2);
        if (!hasRole1 && !hasRole2) return message.reply("❌ Non autorizzato.");

        const authorCountCheck = meetingCounts.get(message.author.id) || 0;
        if (authorCountCheck >= MAX_MEETINGS) return message.reply("❌ Limite raggiunto.");

        const userToInvite = message.mentions.users.first();
        if (!userToInvite || userToInvite.id === message.author.id) return message.reply("❌ Errore tag.");

        const durataMs = 3 * 60 * 60 * 1000;
        const scadenzaTimestamp = Math.floor((Date.now() + durataMs) / 1000);

        const proposalMsg = await message.channel.send(`🔔 <@${userToInvite.id}>, ${message.author} vuole un meeting. Scade <t:${scadenzaTimestamp}:R>`);
        await proposalMsg.react('✅');
        await proposalMsg.react('❌');

        const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && user.id === userToInvite.id;
        const collector = proposalMsg.createReactionCollector({ filter, time: durataMs, max: 1 });

        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅') {
                let countAuthor = meetingCounts.get(message.author.id) || 0;
                let countInvite = meetingCounts.get(userToInvite.id) || 0;
                if (countAuthor >= MAX_MEETINGS || countInvite >= MAX_MEETINGS) return message.reply("❌ Limite raggiunto.");
                
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
                            { id: userToInvite.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                        ],
                    });
                    await newChannel.send("🔒 Meeting avviato. Usa **!fine** per chiudere.");
                } catch (err) { console.error(err); }
            }
        });
    }

    // !fine
    if (message.content === '!fine') {
        if (message.guild.id !== ID_SERVER_TARGET || !message.channel.name.startsWith('meeting-')) return;
        await message.channel.send("🛑 Chat archiviata in sola lettura.");
        message.channel.permissionOverwrites.cache.forEach(async (overwrite) => {
            if (overwrite.id === client.user.id) return;
            await message.channel.permissionOverwrites.edit(overwrite.id, { SendMessages: false });
        });
    }
});

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GFe33d.9RgkeDdLwtKrQhi69vQFgMCVaR-hqvYkkI-hVg');
