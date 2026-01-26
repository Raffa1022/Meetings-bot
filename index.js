const http = require('http');
const mongoose = require('mongoose'); //
const { 
    Client, GatewayIntentBits, Partials, Options, PermissionsBitField, 
    ChannelType, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, 
    ButtonBuilder, ButtonStyle 
} = require('discord.js');

// ==========================================
// 1. CONFIGURAZIONE & COSTANTI
// ==========================================

const CONFIG = {
    // ID Server e Categorie
    SERVER: {
        COMMAND_GUILD: '1460740887494787259',
        TARGET_GUILD:  '1463608688244822018',
        TARGET_CAT:    '1463608688991273015',
        ROLE_CHAT_CAT: '1460741414357827747'
    },
    // ID Canali
    CHANNELS: {
        LOG:       '1464941042380837010',
        DATABASE:  '1464940718933151839',
        WELCOME:   '1460740888450830501'
    },
    // ID Ruoli
    ROLES: {
        RESET:        '1460741401435181295',
        MEETING_1:    '1460741403331268661',
        MEETING_2:    '1460741402672758814',
        PLAYER_AUTO:  '1460741403331268661',
        SPONSOR_AUTO: '1460741404497019002',
        ALT_CHECK:    '1460741402672758814',
        AUTO_JOIN:    '1460741402672758814'
    },
    // Limiti
    LIMITS: {
        MAX_MEETINGS: 3,
        MAX_READINGS: 1
    }
};

// ==========================================
// SETUP MONGODB (Nuova aggiunta)
// ==========================================
// MODIFICA: Ora prende la password in sicurezza dalle impostazioni di Koyeb
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connesso!'))
    .catch(err => console.error('❌ Errore MongoDB:', err));

// Schema per salvare esattamente la struttura del tuo STATE
const botSchema = new mongoose.Schema({
    id: { type: String, default: 'main' },
    isAutoRoleActive: Boolean,
    meetingCounts: Object, // Salveremo le Map come Oggetti
    letturaCounts: Object,
    activeUsers: Array,    // Salveremo il Set come Array
    table: Object
});
const BotModel = mongoose.model('BotData', botSchema);

// ==========================================
// 2. STATO DEL BOT (MEMORIA)
// ==========================================

const STATE = {
    isAutoRoleActive: false,
    meetingCounts: new Map(),
    letturaCounts: new Map(),
    activeUsers: new Set(),
    table: {
        limit: 0,
        slots: [], // { player: id, sponsor: id }
        messageId: null
    }
};

// ==========================================
// 3. INIZIALIZZAZIONE CLIENT & SERVER
// ==========================================

// Server Keep-Alive
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is alive - MongoDB Edition v5.6');
}).listen(8000);

// Configurazione Client Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [
        Partials.Message, Partials.Channel, Partials.Reaction, 
        Partials.User, Partials.GuildMember
    ],
    makeCache: Options.cacheWithLimits({
        MessageManager: 10,       
        PresenceManager: 0,       
        GuildMemberManager: 10,   
        UserManager: 10,
        ReactionManager: 0,       
        ThreadManager: 0
    }),
});

// ==========================================
// 4. GESTIONE DATABASE (Aggiornato per Mongo)
// ==========================================

async function syncDatabase() {
    try {
        // Invece di mandare un messaggio, salviamo su Mongo
        await BotModel.findOneAndUpdate(
            { id: 'main' },
            {
                isAutoRoleActive: STATE.isAutoRoleActive,
                meetingCounts: Object.fromEntries(STATE.meetingCounts), // Converte Map in Oggetto
                letturaCounts: Object.fromEntries(STATE.letturaCounts),
                activeUsers: Array.from(STATE.activeUsers),             // Converte Set in Array
                table: STATE.table
            },
            { upsert: true } // Crea se non esiste
        );
        // Rimosso il codice che intasava il canale Discord
    } catch (e) { console.error("Errore salvataggio Mongo:", e); }
}

async function restoreDatabase() {
    try {
        // Legge da Mongo invece che dal canale
        const data = await BotModel.findOne({ id: 'main' });
        
        if (data) {
            STATE.isAutoRoleActive = data.isAutoRoleActive;
            
            // Ripristina Map e Set
            STATE.meetingCounts = new Map(Object.entries(data.meetingCounts || {}));
            STATE.letturaCounts = new Map(Object.entries(data.letturaCounts || {}));
            STATE.activeUsers = new Set(data.activeUsers || []);
            STATE.table = data.table || { limit: 0, slots: [], messageId: null };

            console.log(`✅ Database MongoDB ripristinato.`);
        }
    } catch (e) { console.log("ℹ️ Errore restore Mongo:", e); }
}

async function retrieveLatestTable() {
    // Helper semplice: restituisce la tabella attuale in memoria (che è sincronizzata con Mongo)
    // Non serve più cercare messaggi vecchi "ARCHIVIO_TABELLA"
    return STATE.table;
}

function generateTableText() {
    let text = "**Giocatori** \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b| \u200b \u200b **Sponsor**\n------------------------------\n";
    STATE.table.slots.forEach((slot, i) => {
        text += `**#${i + 1}** ${slot.player ? `<@${slot.player}>` : "`(libero)`"} \u200b | \u200b ${slot.sponsor ? `<@${slot.sponsor}>` : "`(libero)`"}\n`;
    });
    return text;
}

// ==========================================
// 5. GESTIONE EVENTI PRINCIPALI
// ==========================================

client.once('ready', async () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    await restoreDatabase(); 
});

client.on('guildMemberAdd', async member => {
    // Controllo ALT
    try {
        const fetchedMember = await member.guild.members.fetch(member.id);
        if (fetchedMember.roles.cache.has(CONFIG.ROLES.ALT_CHECK)) {
            console.log(`🚫 Utente Alt rilevato: ${member.user.tag}`);
            const welcomeChannel = member.guild.channels.cache.get(CONFIG.CHANNELS.WELCOME);
            if (welcomeChannel) await welcomeChannel.permissionOverwrites.create(member.id, { ViewChannel: false });
            return; 
        }
    } catch (e) { console.error("Errore verifica Alt:", e); }

    // Auto Join
    if (!STATE.isAutoRoleActive) return;
    try { await member.roles.add(CONFIG.ROLES.AUTO_JOIN); } 
    catch (e) { console.error(`Errore auto-role ${member.user.tag}:`, e); }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) {
        try { await reaction.fetch(); } catch (error) { return; }
    }
});

// ==========================================
// 6. GESTIONE COMANDI (MessageCreate)
// ==========================================

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const content = message.content;
    const member = message.member;
    const guildId = message.guild.id;
    const isAdmin = member?.permissions.has(PermissionsBitField.Flags.Administrator);

    // --- COMANDO: !impostazioni ---
    if (content === '!impostazioni' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        const helpEmbed = new EmbedBuilder()
            .setTitle('⚙️ Pannello Gestione Bot')
            .setColor(0x2B2D31)
            .addFields(
                { name: '🔹 !meeting @giocatore (Giocatori)', value: 'Invita un altro giocatore.' },
                { name: '🛑 !fine (Giocatori)', value: 'Chiude la chat privata.' },
                { name: '👁️ !lettura (Giocatori)', value: 'Supervisione chat attiva.' }, 
                { name: '🚪 !entrata (Overseer)', value: `Auto-ruolo ingresso (Stato: ${STATE.isAutoRoleActive ? 'ON' : 'OFF'})` },
                { name: '📋 !tabella [num] (Overseer)', value: 'Crea nuova tabella iscrizioni (Max 50).' },
                { name: '🚀 !assegna (Overseer)', value: 'Assegna stanze, ruoli e ARCHIVIA tabella.' },
                { name: '⚠️ !azzeramento (Overseer)', value: 'Reset totale (meeting + letture).' }
            )
            .setFooter({ text: 'Sistema v5.5 Split-Menu' });
        return message.channel.send({ embeds: [helpEmbed] });
    }

    // --- COMANDO: !entrata (Admin) ---
    if (content === '!entrata' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        if (!isAdmin) return;
        STATE.isAutoRoleActive = !STATE.isAutoRoleActive;
        await syncDatabase(); 
        return message.reply(`🚪 **Auto-Ruolo Ingressi:** ${STATE.isAutoRoleActive ? "✅ ATTIVO" : "🛑 DISATTIVO"}.`);
    }

    // --- COMANDO: !azzeramento (Admin & Ruolo Reset) ---
    if (content === '!azzeramento' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        if (!member.roles.cache.has(CONFIG.ROLES.RESET)) return message.reply("⛔ Non hai i permessi.");
        
        STATE.meetingCounts.clear();
        STATE.activeUsers.clear(); 
        STATE.letturaCounts.clear();
        
        await syncDatabase();
        return message.reply("♻️ **Reset Completo effettuato:** Conteggio Meeting, Letture e Stati Utenti azzerati.");
    }

    // --- COMANDO: !tabella (Admin) ---
    if (content.startsWith('!tabella') && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        if (!isAdmin) return;

        const args = content.split(' ');
        const num = parseInt(args[1]);

        // MODIFICA: Limite aumentato a 50
        if (!num || num > 50) return message.reply("Specifica un numero di slot (max 50). Es: `!tabella 40`");

        STATE.table.limit = num;
        STATE.table.slots = Array(num).fill(null).map(() => ({ player: null, sponsor: null }));

        const embed = new EmbedBuilder()
            .setTitle(`📋 Iscrizione Giocatori & Sponsor`)
            .setDescription(generateTableText())
            .setColor('Blue')
            .setFooter({ text: "Usa i menu qui sotto per iscriverti!" });

        // Creazione Opzioni (0 a 49)
        const options = Array.from({ length: num }, (_, i) => ({ label: `Numero ${i + 1}`, value: `${i}` }));

        const components = [];

        // MODIFICA: Split dei menu Player (Max 25 per menu)
        const playerOptions1 = options.slice(0, 25);
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_player').setPlaceholder('👤 Giocatori 1-25').addOptions(playerOptions1)
        ));

        if (num > 25) {
            const playerOptions2 = options.slice(25, 50);
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('select_player_2').setPlaceholder(`👤 Giocatori 26-${num}`).addOptions(playerOptions2)
            ));
        }

        // MODIFICA: Split dei menu Sponsor
        const sponsorOptions1 = options.slice(0, 25);
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId('select_sponsor').setPlaceholder('💰 Sponsor 1-25').addOptions(sponsorOptions1)
        ));

        if (num > 25) {
            const sponsorOptions2 = options.slice(25, 50);
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('select_sponsor_2').setPlaceholder(`💰 Sponsor 26-${num}`).addOptions(sponsorOptions2)
            ));
        }

        // Bottone Leave
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('leave_game').setLabel('🏃 Abbandona Gioco').setStyle(ButtonStyle.Danger)
        ));

        // Invio messaggio con componenti multipli
        const sentMsg = await message.channel.send({ embeds: [embed], components: components });
        STATE.table.messageId = sentMsg.id;
    }

    // --- COMANDO: !assegna (Admin) ---
    if (content === '!assegna' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        if (!isAdmin) return;
        if (STATE.table.limit === 0) return message.reply("⚠️ Nessuna tabella attiva in memoria.");

        await message.reply("⏳ **Inizio configurazione e archiviazione...**");
        let assegnati = 0;

        // 1. Assegnazione Stanze
        for (let i = 0; i < STATE.table.limit; i++) {
            const slot = STATE.table.slots[i];
            const channelName = `${i + 1}`; 
            const channel = message.guild.channels.cache.find(c => c.parentId === CONFIG.SERVER.ROLE_CHAT_CAT && c.name === channelName);

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
                    try { (await message.guild.members.fetch(slot.player)).roles.add(CONFIG.ROLES.PLAYER_AUTO); } catch (e) {}
                }
                if (slot.sponsor) {
                    await channel.permissionOverwrites.edit(slot.sponsor, permessiSpeciali);
                    utentiDaSalutare.push(`<@${slot.sponsor}>`);
                    try { (await message.guild.members.fetch(slot.sponsor)).roles.add(CONFIG.ROLES.SPONSOR_AUTO); } catch (e) {}
                }

                if (utentiDaSalutare.length > 0) {
                     const saluto = utentiDaSalutare.length === 1 ? 'Benvenuto' : 'Benvenuti';
                     await channel.send(`${saluto} ${utentiDaSalutare.join(' e ')}!`);
                }
                assegnati++;
            }
        }

        // 2. Archiviazione
        const dbChannel = await client.channels.fetch(CONFIG.CHANNELS.DATABASE);
        if (dbChannel) {
            const dataToArchive = {
                tableBackup: STATE.table,
                meeting: Object.fromEntries(STATE.meetingCounts),
                lettura: Object.fromEntries(STATE.letturaCounts),
                active: Array.from(STATE.activeUsers),
                autorole: STATE.isAutoRoleActive
            };
            await dbChannel.send(`📁 **ARCHIVIO_TABELLA** (Chiusura del ${new Date().toLocaleTimeString('it-IT')})\n\`\`\`json\n${JSON.stringify(dataToArchive)}\n\`\`\``);
        }

        // Reset locale
        STATE.table = { limit: 0, slots: [], messageId: null };
        await message.channel.send(`✅ **Operazione completata!**\n- Stanze configurate: ${assegnati}\n- Tabella archiviata nel DB\n- Memoria locale resettata.`);
    }

    // --- COMANDO: !meeting ---
    if (content.startsWith('!meeting ') && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        if (!member.roles.cache.has(CONFIG.ROLES.PLAYER_AUTO)) return message.reply("❌ Solo i Giocatori possono gestire i meeting.");
        if (!member.roles.cache.has(CONFIG.ROLES.MEETING_1) && !member.roles.cache.has(CONFIG.ROLES.MEETING_2)) return message.reply("⛔ Non hai il ruolo autorizzato.");
        if (STATE.activeUsers.has(message.author.id)) return message.reply("⚠️ Hai già una chat attiva!");

        const authorCount = STATE.meetingCounts.get(message.author.id) || 0;
        if (authorCount >= CONFIG.LIMITS.MAX_MEETINGS) return message.reply(`⚠️ Limite raggiunto (${CONFIG.LIMITS.MAX_MEETINGS}).`);

        const userToInvite = message.mentions.users.first();
        if (!userToInvite || userToInvite.id === message.author.id) return message.reply("⚠️ Tagga un altro giocatore valido.");

        // Controllo Ruoli Incrociati
        try {
            const targetMember = await message.guild.members.fetch(userToInvite.id);
            const isAuthorPlayer = member.roles.cache.has(CONFIG.ROLES.PLAYER_AUTO);
            const isTargetSponsor = targetMember.roles.cache.has(CONFIG.ROLES.SPONSOR_AUTO);
            const isAuthorSponsor = member.roles.cache.has(CONFIG.ROLES.SPONSOR_AUTO);
            const isTargetPlayer = targetMember.roles.cache.has(CONFIG.ROLES.PLAYER_AUTO);

            if (isAuthorPlayer && isTargetSponsor) return message.reply("⛔ **Azione Negata:** Un Giocatore non può invitare uno Sponsor.");
            if (isAuthorSponsor && isTargetPlayer) return message.reply("⛔ **Azione Negata:** Uno Sponsor non può invitare un Giocatore.");
        } catch (e) { /* Fallback silenzioso */ }

        if (STATE.activeUsers.has(userToInvite.id)) return message.reply(`⚠️ ${userToInvite} è impegnato.`);

        const proposalMsg = await message.channel.send(`🔔 **Richiesta Meeting**\n👤 **Ospite:** ${userToInvite}\n📩 **Da:** ${message.author}\n\n*Reagisci per accettare/rifiutare*`);
        await proposalMsg.react('✅'); await proposalMsg.react('❌');

        // MODIFICA: Consigliabile ridurre il tempo se si hanno molti utenti per risparmiare RAM (qui è ancora 3h)
        const collector = proposalMsg.createReactionCollector({ 
            filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === userToInvite.id, 
            time: 3 * 60 * 60 * 1000, max: 1 
        });

        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅') {
                if (STATE.activeUsers.has(message.author.id) || STATE.activeUsers.has(userToInvite.id)) return reaction.message.reply("❌ Uno dei giocatori è ora occupato.");
                
                let cAuthor = STATE.meetingCounts.get(message.author.id) || 0;
                let cGuest = STATE.meetingCounts.get(userToInvite.id) || 0;
                
                if (cAuthor >= CONFIG.LIMITS.MAX_MEETINGS || cGuest >= CONFIG.LIMITS.MAX_MEETINGS) return reaction.message.reply("❌ Token finiti.");

                const tableData = await retrieveLatestTable();
                const sponsorAuthor = tableData.slots.find(s => s.player === message.author.id)?.sponsor;
                const sponsorGuest = tableData.slots.find(s => s.player === userToInvite.id)?.sponsor;

                // Aggiornamento contatori
                const newAuthorCount = cAuthor + 1;
                const newGuestCount = cGuest + 1;
                STATE.meetingCounts.set(message.author.id, newAuthorCount);
                STATE.meetingCounts.set(userToInvite.id, newGuestCount);
                STATE.activeUsers.add(message.author.id);
                STATE.activeUsers.add(userToInvite.id);
                await syncDatabase();

                // Creazione Canale
                try {
                    const targetGuild = client.guilds.cache.get(CONFIG.SERVER.TARGET_GUILD);
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
                        parent: CONFIG.SERVER.TARGET_CAT,
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
                    
                    await reaction.message.reply({ 
                        content: `✅ **Meeting creato!**\n📊 **Stato Meeting:**\n👤 ${message.author.username}: **${newAuthorCount}/${CONFIG.LIMITS.MAX_MEETINGS}**\n👤 ${userToInvite.username}: **${newGuestCount}/${CONFIG.LIMITS.MAX_MEETINGS}**`, 
                        embeds: [logEmbed] 
                    });
                    reaction.message.channel.messages.cache.delete(reaction.message.id);

                } catch (e) { 
                    console.error("Errore creazione:", e);
                    STATE.activeUsers.delete(message.author.id);
                    STATE.activeUsers.delete(userToInvite.id);
                }
            } else { reaction.message.reply("❌ Richiesta rifiutata."); }
        });
    }

    // --- COMANDO: !lettura ---
    if (content === '!lettura' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        if (!message.reference) return message.reply("⚠️ Rispondi al messaggio verde.");
        if (!member.roles.cache.has(CONFIG.ROLES.PLAYER_AUTO)) return message.reply("❌ Accesso Negato.");

        const currentRead = STATE.letturaCounts.get(message.author.id) || 0;
        if (currentRead >= CONFIG.LIMITS.MAX_READINGS) return message.reply("⛔ Limite supervisioni raggiunto (1/1).");

        try {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            const targetEmbed = repliedMsg.embeds[0];
            if (targetEmbed.fields.some(f => f.name === '👮 Supervisore')) return message.reply("⛔ Supervisore già presente.");

            const channelId = targetEmbed.footer?.text.match(/ID:(\d+)/)?.[1];
            const targetGuild = client.guilds.cache.get(CONFIG.SERVER.TARGET_GUILD);
            const targetChannel = await targetGuild.channels.fetch(channelId).catch(() => null);

            if (!targetChannel) return message.reply("❌ Canale inesistente.");
            if (targetChannel.permissionOverwrites.cache.has(message.author.id)) return message.reply("⚠️ Sei già dentro.");

            const tableData = await retrieveLatestTable();
            const supervisorSponsor = tableData.slots.find(s => s.player === message.author.id)?.sponsor;

            const readPerms = { 
                ViewChannel: true, 
                SendMessages: false, 
                CreatePublicThreads: false, 
                CreatePrivateThreads: false,
                AddReactions: false 
            };
            
            await targetChannel.permissionOverwrites.create(message.author.id, readPerms);
            if (supervisorSponsor) await targetChannel.permissionOverwrites.create(supervisorSponsor, readPerms);

            let notificationMsg = supervisorSponsor 
                ? `${message.author} e il suo Sponsor <@${supervisorSponsor}> sono entrati ad osservare.`
                : `${message.author} è entrato ad osservare.`;

            const participants = targetChannel.permissionOverwrites.cache
                .filter(o => ![client.user.id, message.author.id, targetGuild.id, supervisorSponsor].includes(o.id))
                .map(o => `<@${o.id}>`).join(' ');

            await targetChannel.send(`⚠️ ATTENZIONE ${participants}: ${notificationMsg}`);

            const newReadCount = currentRead + 1;
            STATE.letturaCounts.set(message.author.id, newReadCount);
            await syncDatabase();

            const newEmbed = EmbedBuilder.from(targetEmbed)
                .setColor(0xFFA500)
                .spliceFields(0, 1, { name: 'Stato', value: '🟠 Supervisionato', inline: true })
                .addFields({ name: '👮 Supervisore', value: notificationMsg, inline: true });

            await repliedMsg.edit({ embeds: [newEmbed] });
            message.reply(`👁️ **Accesso Garantito (${newReadCount}/${CONFIG.LIMITS.MAX_READINGS})**.`);
            message.channel.messages.cache.delete(repliedMsg.id);

        } catch (e) { console.error(e); message.reply("❌ Errore tecnico."); }
    }

    // --- COMANDO: !fine ---
    if (content === '!fine' && guildId === CONFIG.SERVER.TARGET_GUILD) {
        if (!message.channel.name.startsWith('meeting-')) return;

        message.channel.permissionOverwrites.cache.forEach((ow) => {
            if (ow.allow.has(PermissionsBitField.Flags.SendMessages)) STATE.activeUsers.delete(ow.id);
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

// ==========================================
// 7. GESTIONE INTERAZIONI (Menu & Bottoni)
// ==========================================

client.on('interactionCreate', async interaction => {
    // MODIFICA: Riconoscimento di ID multipli (select_player_2, etc.)
    if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('select_player') || interaction.customId.startsWith('select_sponsor'))) {
        if (STATE.table.limit === 0) return interaction.reply({ content: "⛔ Tabella chiusa.", ephemeral: true });

        const slotIndex = parseInt(interaction.values[0]);
        // Identifica il tipo basandosi sulla prima parte dell'ID
        const type = interaction.customId.startsWith('select_player') ? 'player' : 'sponsor';

        if (STATE.table.slots[slotIndex][type]) return interaction.reply({ content: "❌ Posto occupato!", ephemeral: true });

        // Rimuove l'utente se era già in un altro slot
        STATE.table.slots.forEach(slot => {
            if (slot.player === interaction.user.id) slot.player = null;
            if (slot.sponsor === interaction.user.id) slot.sponsor = null;
        });

        STATE.table.slots[slotIndex][type] = interaction.user.id;
        await interaction.update({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setDescription(generateTableText())] });
    }

    // Gestione Abbandono
    if (interaction.isButton() && interaction.customId === 'leave_game') {
        if (STATE.table.limit === 0) return interaction.reply({ content: "⛔ Tabella chiusa.", ephemeral: true });
        
        let found = false;
        STATE.table.slots.forEach(slot => {
            if (slot.player === interaction.user.id) { slot.player = null; found = true; }
            if (slot.sponsor === interaction.user.id) { slot.sponsor = null; found = true; }
        });

        if (!found) return interaction.reply({ content: "❌ Non eri iscritto.", ephemeral: true });
        await interaction.update({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setDescription(generateTableText())] });
    }
});

// ==========================================
// 8. LOGIN
// ==========================================
client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GFe33d.9RgkeDdLwtKrQhi69vQFgMCVaR-hqvYkkI-hVg');
