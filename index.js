const http = require('http');
const { Client, GatewayIntentBits, Partials, Options, PermissionsBitField, ChannelType, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// --- 1. SERVER KEEP-ALIVE ---
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is alive - v5.1 (Fix Protezione Giocatore-Sponsor)');
}).listen(8000);

// --- 2. CONFIGURAZIONE CLIENT ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers 
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
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

const ID_CANALE_DATABASE = '1464940718933151839'; 
const ID_CATEGORIA_CHAT_RUOLO = '1460741414357827747'; 

// --- ID RUOLI AUTOMATICI ---
const ID_RUOLO_GIOCATORE_AUTO = '1460741403331268661'; 
const ID_RUOLO_SPONSOR_AUTO = '1460741404497019002';

const ID_RUOLO_ALT = '1460741402672758814'; 
const ID_CANALE_BENVENUTO = '1460740888450830501'; 
const ID_RUOLO_AUTO_JOIN = '1460741402672758814'; 

// --- 🔢 VARIABILI MEMORIA ---
const meetingCounts = new Map(); 
const letturaCounts = new Map(); 
const activeUsers = new Set(); 
const MAX_MEETINGS = 3;
const MAX_LETTURE = 1;

let isAutoRoleActive = false;

let activeTable = {
    limit: 0,
    slots: [], 
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

        const messages = await dbChannel.messages.fetch({ limit: 20 });
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
            console.log(`✅ Database ripristinato.`);
        }
        messages.forEach(m => {
            if(m.content.includes('BACKUP_DATI') && m.id !== dataMsg?.id) dbChannel.messages.delete(m.id).catch(() => {});
        }); 
    } catch (e) { console.log("ℹ️ Nessun backup trovato.", e); }
}

async function retrieveLatestTable() {
    if (activeTable.limit > 0 && activeTable.slots.length > 0) return activeTable;
    try {
        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        if (!dbChannel) return { slots: [] };
        const messages = await dbChannel.messages.fetch({ limit: 30 });
        const archiveMsg = messages.find(m => m.content.includes('ARCHIVIO_TABELLA'));
        if (archiveMsg) {
            const jsonStr = archiveMsg.content.split('```json\n')[1].split('\n```')[0];
            const data = JSON.parse(jsonStr);
            if (data.tableBackup) return data.tableBackup;
        }
    } catch (e) { console.error("Errore recupero tabella:", e); }
    return { slots: [] };
}

// --- AVVIO ---
client.once('ready', async () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    await restoreDatabase(); 
});

// --- INGRESSI ---
client.on('guildMemberAdd', async member => {
    try {
        const fetchedMember = await member.guild.members.fetch(member.id);
        if (fetchedMember.roles.cache.has(ID_RUOLO_ALT)) {
            const welcomeChannel = member.guild.channels.cache.get(ID_CANALE_BENVENUTO);
            if (welcomeChannel) await welcomeChannel.permissionOverwrites.create(member.id, { ViewChannel: false });
            return; 
        }
    } catch (e) {}
    if (isAutoRoleActive) try { await member.roles.add(ID_RUOLO_AUTO_JOIN); } catch (e) {}
});

// --- REAZIONI ---
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) try { await reaction.fetch(); } catch (error) { return; }
});

// --- COMANDI ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content === '!impostazioni') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        const helpEmbed = new EmbedBuilder()
            .setTitle('⚙️ Pannello Gestione Bot')
            .setColor(0x2B2D31)
            .addFields(
                { name: '🔹 !meeting @giocatore', value: 'Invita un altro giocatore (Sponsor bloccati).' },
                { name: '🛑 !fine', value: 'Chiude la chat.' },
                { name: '👁️ !lettura', value: 'Supervisione chat.' }, 
                { name: '🚪 !entrata', value: `Auto-ruolo (Status: ${isAutoRoleActive})` },
                { name: '📋 !tabella [num]', value: 'Crea tabella.' },
                { name: '🚀 !assegna', value: 'Assegna ruoli/stanze.' },
                { name: '🔒 !chiusura', value: 'Archivia e pulisce RAM.' },
                { name: '⚠️ !azzeramento1 / !azzeramento2', value: 'Reset vari.' }
            );
        return message.channel.send({ embeds: [helpEmbed] });
    }

    if (message.content === '!entrata') {
        if (message.guild.id !== ID_SERVER_COMMAND || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        isAutoRoleActive = !isAutoRoleActive;
        await syncDatabase(); 
        message.reply(`🚪 **Auto-Ruolo Ingressi:** ${isAutoRoleActive ? "✅ ATTIVO" : "🛑 DISATTIVO"}.`);
    }

    if (message.content === '!azzeramento1') {
        if (message.guild.id !== ID_SERVER_COMMAND || !message.member.roles.cache.has(ID_RUOLO_RESET)) return;
        meetingCounts.clear(); activeUsers.clear(); await syncDatabase();
        return message.reply("♻️ Meeting azzerati.");
    }

    if (message.content === '!azzeramento2') {
        if (message.guild.id !== ID_SERVER_COMMAND || !message.member.roles.cache.has(ID_RUOLO_RESET)) return;
        letturaCounts.clear(); await syncDatabase();
        return message.reply("♻️ Letture azzerate.");
    }

    if (message.content.startsWith('!tabella')) {
        if (message.guild.id !== ID_SERVER_COMMAND || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const num = parseInt(message.content.split(' ')[1]);
        if (!num || num > 25) return message.reply("Es: `!tabella 10`");

        activeTable.limit = num;
        activeTable.slots = Array(num).fill(null).map(() => ({ player: null, sponsor: null }));
        
        const sentMsg = await message.channel.send({ 
            embeds: [new EmbedBuilder().setTitle(`📋 Iscrizione`).setDescription(generateTableText()).setColor('Blue')], 
            components: [
                new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_player').setPlaceholder('👤 Seleziona Giocatore').addOptions(Array(num).fill().map((_, i) => ({ label: `N. ${i+1}`, value: `${i}` })))),
                new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_sponsor').setPlaceholder('💰 Seleziona Sponsor').addOptions(Array(num).fill().map((_, i) => ({ label: `N. ${i+1}`, value: `${i}` })))),
                new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('leave_game').setLabel('🏃 Esci').setStyle(ButtonStyle.Danger))
            ] 
        });
        activeTable.messageId = sentMsg.id;
    }

    if (message.content === '!assegna') {
        if (message.guild.id !== ID_SERVER_COMMAND || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        if (activeTable.limit === 0) return message.reply("⚠️ Tabella vuota.");
        await message.reply("⏳ Assegnazione in corso...");
        
        for (let i = 0; i < activeTable.limit; i++) {
            const slot = activeTable.slots[i];
            const channel = message.guild.channels.cache.find(c => c.parentId === ID_CATEGORIA_CHAT_RUOLO && c.name === `${i + 1}`);
            if (channel) {
                await channel.permissionOverwrites.set([{ id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]);
                const perms = { ViewChannel: true, SendMessages: true, ManageMessages: true, CreatePrivateThreads: true, SendMessagesInThreads: true, CreatePublicThreads: false };
                if (slot.player) {
                    await channel.permissionOverwrites.edit(slot.player, perms);
                    try { (await message.guild.members.fetch(slot.player)).roles.add(ID_RUOLO_GIOCATORE_AUTO); } catch (e) {}
                    await channel.send(`Benvenuto <@${slot.player}>!`);
                }
                if (slot.sponsor) {
                    await channel.permissionOverwrites.edit(slot.sponsor, perms);
                    try { (await message.guild.members.fetch(slot.sponsor)).roles.add(ID_RUOLO_SPONSOR_AUTO); } catch (e) {}
                    await channel.send(`Benvenuto Sponsor <@${slot.sponsor}>!`);
                }
            }
        }
        await message.channel.send(`✅ Assegnazione completata.`);
    }

    if (message.content === '!chiusura') {
        if (message.guild.id !== ID_SERVER_COMMAND || !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        if (dbChannel) {
            const dataToArchive = { tableBackup: activeTable, meeting: Object.fromEntries(meetingCounts), lettura: Object.fromEntries(letturaCounts), active: Array.from(activeUsers), autorole: isAutoRoleActive };
            await dbChannel.send(`📁 **ARCHIVIO_TABELLA**\n\`\`\`json\n${JSON.stringify(dataToArchive)}\n\`\`\``);
        }
        activeTable = { limit: 0, slots: [], messageId: null };
        message.reply("🔒 **Tabella archiviata e memoria resettata.**");
    }

    // --- 🛑 MODIFICA IMPORTANTE QUI SOTTO: CONTROLLO RUOLI MEETING ---
    if (message.content.startsWith('!meeting ')) {
        if (message.guild.id !== ID_SERVER_COMMAND) return;

        // 1. Controllo AUTORE (Deve essere Giocatore)
        if (!message.member.roles.cache.has(ID_RUOLO_GIOCATORE_AUTO)) {
            return message.reply("❌ **Solo i Giocatori** possono avviare un meeting (Gli Sponsor non possono).");
        }

        const authorCount = meetingCounts.get(message.author.id) || 0;
        if (authorCount >= MAX_MEETINGS) return message.reply(`⚠️ Limite meeting raggiunto.`);

        const userToInvite = message.mentions.users.first();
        if (!userToInvite || userToInvite.id === message.author.id) return message.reply("⚠️ Devi taggare un altro giocatore.");

        // 2. Controllo TARGET (Deve essere Giocatore e NON Sponsor)
        try {
            const targetMember = await message.guild.members.fetch(userToInvite.id);
            
            // Se l'invitato è uno SPONSOR -> BLOCCO
            if (targetMember.roles.cache.has(ID_RUOLO_SPONSOR_AUTO)) {
                return message.reply(`⛔ **Azione Negata:** Non puoi invitare <@${userToInvite.id}> perché è uno **Sponsor**.\nI meeting sono solo tra Giocatori.`);
            }

            // Se l'invitato NON ha il ruolo GIOCATORE -> BLOCCO
            if (!targetMember.roles.cache.has(ID_RUOLO_GIOCATORE_AUTO)) {
                return message.reply(`⛔ L'utente <@${userToInvite.id}> non è registrato come **Giocatore**.`);
            }

        } catch (e) {
            return message.reply("⚠️ Impossibile verificare i ruoli dell'utente taggato.");
        }

        if (activeUsers.has(message.author.id)) return message.reply("⚠️ Hai già una chat attiva!");
        if (activeUsers.has(userToInvite.id)) return message.reply(`⚠️ ${userToInvite} è impegnato.`);

        const proposalMsg = await message.channel.send(`🔔 **Richiesta Meeting**\n👤 **Ospite:** ${userToInvite}\n📩 **Da:** ${message.author}\n\n*Reagisci per accettare/rifiutare*`);
        await proposalMsg.react('✅'); await proposalMsg.react('❌');

        const collector = proposalMsg.createReactionCollector({ 
            filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === userToInvite.id, 
            time: 3 * 60 * 60 * 1000, max: 1 
        });

        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅') {
                if (activeUsers.has(message.author.id) || activeUsers.has(userToInvite.id)) return reaction.message.reply("❌ Utenti occupati.");
                
                let cAuthor = meetingCounts.get(message.author.id) || 0;
                let cGuest = meetingCounts.get(userToInvite.id) || 0;
                if (cAuthor >= MAX_MEETINGS || cGuest >= MAX_MEETINGS) return reaction.message.reply("❌ Token esauriti.");

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

                    const logEmbed = new EmbedBuilder().setTitle('📂 Meeting Avviato').setColor(0x00FF00).setDescription(`**Autore:** ${message.author.tag}\n**Ospite:** ${userToInvite.tag}`).setFooter({ text: `ID:${newChannel.id}` });
                    await reaction.message.reply({ content: "✅ Meeting creato!", embeds: [logEmbed] });
                    reaction.message.channel.messages.cache.delete(reaction.message.id);

                } catch (e) { 
                    console.error(e);
                    activeUsers.delete(message.author.id);
                    activeUsers.delete(userToInvite.id);
                }
            } else { reaction.message.reply("❌ Rifiutato."); }
        });
    }
    // ------------------------------------------------------------------------

    if (message.content === '!lettura') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.reference) return message.reply("⚠️ Rispondi al messaggio verde.");
        if (!message.member.roles.cache.has(ID_RUOLO_GIOCATORE_AUTO)) return message.reply("❌ Accesso Negato.");

        const currentRead = letturaCounts.get(message.author.id) || 0;
        if (currentRead >= MAX_LETTURE) return message.reply("⛔ Limite supervisioni raggiunto.");

        try {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            const targetEmbed = repliedMsg.embeds[0];
            const channelId = targetEmbed.footer?.text.match(/ID:(\d+)/)?.[1];
            const targetChannel = await client.guilds.cache.get(ID_SERVER_TARGET).channels.fetch(channelId).catch(() => null);

            if (!targetChannel) return message.reply("❌ Canale inesistente.");
            if (targetChannel.permissionOverwrites.cache.has(message.author.id)) return message.reply("⚠️ Sei già dentro.");

            const tableData = await retrieveLatestTable();
            const supervisorSponsor = tableData.slots.find(s => s.player === message.author.id)?.sponsor;

            await targetChannel.permissionOverwrites.create(message.author.id, { ViewChannel: true, SendMessages: false });
            if (supervisorSponsor) await targetChannel.permissionOverwrites.create(supervisorSponsor, { ViewChannel: true, SendMessages: false });

            let supervisorText = `${message.author}`;
            if (supervisorSponsor) supervisorText += ` e Sponsor <@${supervisorSponsor}>`;
            
            await targetChannel.send(`⚠️ ATTENZIONE: ${supervisorText} è entrato per osservare.`);
            letturaCounts.set(message.author.id, currentRead + 1);
            await syncDatabase();

            const newEmbed = EmbedBuilder.from(targetEmbed).setColor(0xFFA500).spliceFields(0, 1, { name: 'Stato', value: '🟠 Supervisionato', inline: true }).addFields({ name: '👮 Supervisore', value: supervisorText, inline: true });
            await repliedMsg.edit({ embeds: [newEmbed] });
            message.reply("👁️ **Accesso Garantito**.");
            message.channel.messages.cache.delete(repliedMsg.id);
        } catch (e) { console.error(e); message.reply("❌ Errore."); }
    }

    if (message.content === '!fine') {
        if (message.guild.id !== ID_SERVER_TARGET || !message.channel.name.startsWith('meeting-')) return;
        message.channel.permissionOverwrites.cache.forEach((ow) => { if (ow.allow.has(PermissionsBitField.Flags.SendMessages)) activeUsers.delete(ow.id); });
        await syncDatabase(); 
        await message.channel.send("🛑 **Chat Chiusa.**");
        message.channel.permissionOverwrites.cache.forEach(async (overwrite) => { if (overwrite.id !== client.user.id) await message.channel.permissionOverwrites.edit(overwrite.id, { SendMessages: false }); });
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu() && (interaction.customId === 'select_player' || interaction.customId === 'select_sponsor')) {
        if (activeTable.limit === 0) return interaction.reply({ content: "⛔ Tabella chiusa.", ephemeral: true });
        const slotIndex = parseInt(interaction.values[0]);
        const type = interaction.customId === 'select_player' ? 'player' : 'sponsor';
        if (activeTable.slots[slotIndex][type]) return interaction.reply({ content: "❌ Posto occupato!", ephemeral: true });
        
        activeTable.slots.forEach(slot => { if (slot.player === interaction.user.id) slot.player = null; if (slot.sponsor === interaction.user.id) slot.sponsor = null; });
        activeTable.slots[slotIndex][type] = interaction.user.id;
        await interaction.update({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setDescription(generateTableText())] });
    }
    if (interaction.isButton() && interaction.customId === 'leave_game') {
        if (activeTable.limit === 0) return interaction.reply({ content: "⛔ Tabella chiusa.", ephemeral: true });
        activeTable.slots.forEach(slot => { if (slot.player === interaction.user.id) slot.player = null; if (slot.sponsor === interaction.user.id) slot.sponsor = null; });
        await interaction.update({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setDescription(generateTableText())] });
    }
});

function generateTableText() {
    let text = "**Giocatori** \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b| \u200b \u200b **Sponsor**\n------------------------------\n";
    activeTable.slots.forEach((slot, i) => { text += `**#${i + 1}** ${slot.player ? `<@${slot.player}>` : "`(libero)`"} \u200b | \u200b ${slot.sponsor ? `<@${slot.sponsor}>` : "`(libero)`"}\n`; });
    return text;
}

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GFe33d.9RgkeDdLwtKrQhi69vQFgMCVaR-hqvYkkI-hVg');
