const http = require('http');
const mongoose = require('mongoose');
const { 
    Client, GatewayIntentBits, Partials, Options, PermissionsBitField, 
    ChannelType, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, 
    ButtonBuilder, ButtonStyle 
} = require('discord.js');

// ==========================================
// 1. CONFIGURAZIONE & COSTANTI
// ==========================================

const CONFIG = {
    SERVER: {
        COMMAND_GUILD: '1460740887494787259',
        TARGET_GUILD:  '1463608688244822018',
        TARGET_CAT:    '1463608688991273015',
        ROLE_CHAT_CAT: '1460741414357827747'
    },
    CHANNELS: {
        LOG:       '1464941042380837010',
        WELCOME:   '1460740888450830501'
    },
    ROLES: {
        RESET:        '1460741401435181295',
        MEETING_1:    '1460741403331268661',
        MEETING_2:    '1460741402672758814',
        PLAYER_AUTO:  '1460741403331268661',
        SPONSOR_AUTO: '1460741404497019002',
        ALT_CHECK:    '1460741402672758814',
        AUTO_JOIN:    '1460741402672758814'
    },
    LIMITS: {
        MAX_MEETINGS: 3,
        MAX_READINGS: 1
    }
};

// ==========================================
// 2. SETUP MONGODB (Stateless)
// ==========================================
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connesso!'))
    .catch(err => console.error('❌ Errore MongoDB:', err));

// Schema
const botSchema = new mongoose.Schema({
    id: { type: String, default: 'main' },
    isAutoRoleActive: { type: Boolean, default: false },
    meetingCounts: { type: Object, default: {} }, // Oggetto ID -> Numero
    letturaCounts: { type: Object, default: {} }, // Oggetto ID -> Numero
    activeUsers: { type: Array, default: [] },    // Array di ID
    table: { 
        type: Object, 
        default: { limit: 0, slots: [], messageId: null } 
    },
    activeGameSlots: { type: Array, default: [] } // Array congelato
});

const BotModel = mongoose.model('BotData', botSchema);

// ==========================================
// 3. HELPER DATI (Niente cache locale)
// ==========================================

// Scarica SEMPRE i dati freschi dal DB
async function getData() {
    let data = await BotModel.findOne({ id: 'main' });
    if (!data) {
        data = new BotModel({ id: 'main' });
        await data.save();
    }
    return data;
}

// Trova lo sponsor dai dati DB (senza cache)
function findSponsor(data, playerId) {
    // Cerca nella tabella iscrizioni
    let slot = data.table.slots.find(s => s.player === playerId);
    if (slot && slot.sponsor) return slot.sponsor;

    // Cerca nella memoria di gioco attivo
    slot = data.activeGameSlots.find(s => s.player === playerId);
    if (slot && slot.sponsor) return slot.sponsor;

    return null;
}

// Genera testo tabella
function generateTableText(tableData) {
    let text = "**Giocatori** \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b| \u200b \u200b **Sponsor**\n------------------------------\n";
    if (!tableData || !tableData.slots) return text;
    
    tableData.slots.forEach((slot, i) => {
        text += `**#${i + 1}** ${slot.player ? `<@${slot.player}>` : "`(libero)`"} \u200b | \u200b ${slot.sponsor ? `<@${slot.sponsor}>` : "`(libero)`"}\n`;
    });
    return text;
}

// ==========================================
// 4. SERVER & CLIENT
// ==========================================

http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot Stateless - DB Only v7.0');
}).listen(8000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    makeCache: Options.cacheWithLimits({
        MessageManager: 10,       
        PresenceManager: 0,       
        GuildMemberManager: 10,   
        UserManager: 10,
        ReactionManager: 0,       
        ThreadManager: 0
    }),
});

client.once('ready', () => {
    console.log(`✅ Bot online: ${client.user.tag} (Mode: Stateless)`);
});

// ==========================================
// 5. GESTIONE EVENTI (Lettura diretta DB)
// ==========================================

client.on('guildMemberAdd', async member => {
    // Controllo ALT
    try {
        const fetchedMember = await member.guild.members.fetch(member.id);
        if (fetchedMember.roles.cache.has(CONFIG.ROLES.ALT_CHECK)) {
            const welcomeChannel = member.guild.channels.cache.get(CONFIG.CHANNELS.WELCOME);
            if (welcomeChannel) await welcomeChannel.permissionOverwrites.create(member.id, { ViewChannel: false });
            return; 
        }
    } catch (e) {}

    // Auto Join - Legge DB
    const data = await getData();
    if (!data.isAutoRoleActive) return;
    
    try { await member.roles.add(CONFIG.ROLES.AUTO_JOIN); } 
    catch (e) { console.error(`Errore auto-role:`, e); }
});

// ==========================================
// 6. GESTIONE COMANDI
// ==========================================

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const content = message.content;
    const member = message.member;
    const guildId = message.guild.id;
    const isAdmin = member?.permissions.has(PermissionsBitField.Flags.Administrator);

    // --- COMANDO: !impostazioni ---
    if (content === '!impostazioni' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        const data = await getData(); // Solo per info stato
        const helpEmbed = new EmbedBuilder()
            .setTitle('⚙️ Pannello Gestione Bot (DB Mode)')
            .setColor(0x2B2D31)
            .addFields(
                { name: '🔹 !meeting @giocatore', value: 'Invita un altro giocatore.' },
                { name: '🛑 !fine', value: 'Chiude la chat privata.' },
                { name: '👁️ !lettura', value: 'Supervisione chat attiva.' }, 
                { name: '🚪 !entrata', value: `Auto-ruolo ingresso (Attuale: ${data.isAutoRoleActive ? 'ON' : 'OFF'})` },
                { name: '📋 !tabella [num]', value: 'Crea nuova tabella.' },
                { name: '🚀 !assegna', value: 'Assegna stanze e salva gioco.' },
                { name: '⚠️ !azzeramento', value: 'Reset totale database.' }
            );
        return message.channel.send({ embeds: [helpEmbed] });
    }

    // --- COMANDO: !entrata ---
    if (content === '!entrata' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        if (!isAdmin) return;
        const data = await getData();
        data.isAutoRoleActive = !data.isAutoRoleActive;
        await data.save(); // Salva su Mongo
        return message.reply(`🚪 **Auto-Ruolo Ingressi:** ${data.isAutoRoleActive ? "✅ ATTIVO" : "🛑 DISATTIVO"}.`);
    }

    // --- COMANDO: !azzeramento ---
    if (content === '!azzeramento' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        if (!member.roles.cache.has(CONFIG.ROLES.RESET)) return message.reply("⛔ Non hai i permessi.");
        
        // Reset totale su Mongo
        await BotModel.findOneAndUpdate({ id: 'main' }, {
            meetingCounts: {},
            activeUsers: [],
            letturaCounts: {},
            activeGameSlots: [],
            table: { limit: 0, slots: [], messageId: null }
        });
        
        return message.reply("♻️ **Reset DB effettuato.**");
    }

    // --- COMANDO: !tabella ---
    if (content.startsWith('!tabella') && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        if (!isAdmin) return;
        const num = parseInt(content.split(' ')[1]);
        if (!num || num > 50) return message.reply("Specifica numero (max 50).");

        // Costruisce la nuova struttura
        const newTable = {
            limit: num,
            slots: Array(num).fill(null).map(() => ({ player: null, sponsor: null })),
            messageId: null
        };

        const embed = new EmbedBuilder()
            .setTitle(`📋 Iscrizione Giocatori & Sponsor`)
            .setDescription(generateTableText(newTable))
            .setColor('Blue');

        // Generazione Menu
        const options = Array.from({ length: num }, (_, i) => ({ label: `Numero ${i + 1}`, value: `${i}` }));
        const components = [];
        const playerOptions1 = options.slice(0, 25);
        components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_player').setPlaceholder('👤 Giocatori 1-25').addOptions(playerOptions1)));
        
        if (num > 25) {
            const playerOptions2 = options.slice(25, 50);
            components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_player_2').setPlaceholder(`👤 Giocatori 26-${num}`).addOptions(playerOptions2)));
        }

        const sponsorOptions1 = options.slice(0, 25);
        components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_sponsor').setPlaceholder('💰 Sponsor 1-25').addOptions(sponsorOptions1)));

        if (num > 25) {
            const sponsorOptions2 = options.slice(25, 50);
            components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_sponsor_2').setPlaceholder(`💰 Sponsor 26-${num}`).addOptions(sponsorOptions2)));
        }

        components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('leave_game').setLabel('🏃 Abbandona').setStyle(ButtonStyle.Danger)));

        const sentMsg = await message.channel.send({ embeds: [embed], components: components });
        newTable.messageId = sentMsg.id;

        // Salva su Mongo resettando anche activeGameSlots
        const data = await getData();
        data.table = newTable;
        data.activeGameSlots = []; 
        await data.save();
    }

    // --- COMANDO: !assegna ---
    if (content === '!assegna' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        if (!isAdmin) return;
        const data = await getData(); // Scarica DB

        if (data.table.limit === 0) return message.reply("⚠️ Nessuna tabella attiva.");

        await message.reply("⏳ **Configurazione in corso...**");
        let assegnati = 0;

        for (let i = 0; i < data.table.limit; i++) {
            const slot = data.table.slots[i];
            const channelName = `${i + 1}`; 
            const channel = message.guild.channels.cache.find(c => c.parentId === CONFIG.SERVER.ROLE_CHAT_CAT && c.name === channelName);

            if (channel) {
                await channel.permissionOverwrites.set([{ id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]);
                const permessi = { ViewChannel: true, SendMessages: true, ManageMessages: true, CreatePrivateThreads: true, SendMessagesInThreads: true, CreatePublicThreads: false };

                let saluti = [];
                if (slot.player) {
                    await channel.permissionOverwrites.edit(slot.player, permessi);
                    saluti.push(`<@${slot.player}>`);
                    try { (await message.guild.members.fetch(slot.player)).roles.add(CONFIG.ROLES.PLAYER_AUTO); } catch (e) {}
                }
                if (slot.sponsor) {
                    await channel.permissionOverwrites.edit(slot.sponsor, permessi);
                    saluti.push(`<@${slot.sponsor}>`);
                    try { (await message.guild.members.fetch(slot.sponsor)).roles.add(CONFIG.ROLES.SPONSOR_AUTO); } catch (e) {}
                }

                if (saluti.length > 0) await channel.send(`Benvenuti ${saluti.join(' e ')}!`);
                assegnati++;
            }
        }

        // Salva su Mongo
        data.activeGameSlots = [...data.table.slots]; // Copia lo stato
        data.table = { limit: 0, slots: [], messageId: null }; // Chiude tabella
        await data.save();

        await message.channel.send(`✅ **Fatto!** Stanze: ${assegnati}. Salvato su DB.`);
    }

    // --- COMANDO: !meeting ---
    if (content.startsWith('!meeting ') && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        if (!member.roles.cache.has(CONFIG.ROLES.PLAYER_AUTO)) return message.reply("❌ Solo Giocatori.");
        if (!member.roles.cache.has(CONFIG.ROLES.MEETING_1) && !member.roles.cache.has(CONFIG.ROLES.MEETING_2)) return message.reply("⛔ Ruolo mancante.");
        
        // Verifica DB
        const data = await getData();
        if (data.activeUsers.includes(message.author.id)) return message.reply("⚠️ Hai già una chat attiva!");

        const cAuthor = data.meetingCounts[message.author.id] || 0;
        if (cAuthor >= CONFIG.LIMITS.MAX_MEETINGS) return message.reply("⚠️ Limite raggiunto.");

        const userToInvite = message.mentions.users.first();
        if (!userToInvite || userToInvite.id === message.author.id) return message.reply("⚠️ Tagga un giocatore.");

        if (data.activeUsers.includes(userToInvite.id)) return message.reply(`⚠️ ${userToInvite} è impegnato.`);

        const proposalMsg = await message.channel.send(`🔔 **Richiesta Meeting**\nDa: ${message.author}\nA: ${userToInvite}\n*Reagisci!*`);
        await proposalMsg.react('✅'); await proposalMsg.react('❌');

        const collector = proposalMsg.createReactionCollector({ 
            filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === userToInvite.id, 
            time: 3 * 60 * 60 * 1000, max: 1 
        });

        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅') {
                // Rilegge DB per sicurezza (concorrenza)
                const freshData = await getData();
                if (freshData.activeUsers.includes(message.author.id) || freshData.activeUsers.includes(userToInvite.id)) 
                    return reaction.message.reply("❌ Qualcuno si è occupato nel frattempo.");
                
                let ca = freshData.meetingCounts[message.author.id] || 0;
                let cg = freshData.meetingCounts[userToInvite.id] || 0;

                if (ca >= CONFIG.LIMITS.MAX_MEETINGS || cg >= CONFIG.LIMITS.MAX_MEETINGS) return reaction.message.reply("❌ Limite raggiunto.");

                // Trova sponsor dal DB
                const sponsorA = findSponsor(freshData, message.author.id);
                const sponsorB = findSponsor(freshData, userToInvite.id);

                // Aggiorna DB
                freshData.meetingCounts[message.author.id] = ca + 1;
                freshData.meetingCounts[userToInvite.id] = cg + 1;
                freshData.activeUsers.push(message.author.id);
                freshData.activeUsers.push(userToInvite.id);
                // Mongoose richiede markModified per oggetti/array misti
                freshData.markModified('meetingCounts');
                freshData.markModified('activeUsers');
                await freshData.save();

                // Creazione canale
                try {
                    const targetGuild = client.guilds.cache.get(CONFIG.SERVER.TARGET_GUILD);
                    const perms = [
                        { id: targetGuild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        { id: userToInvite.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ];
                    if (sponsorA) perms.push({ id: sponsorA, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });
                    if (sponsorB) perms.push({ id: sponsorB, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });

                    const newCh = await targetGuild.channels.create({
                        name: `meeting-${message.author.username}-${userToInvite.username}`,
                        type: ChannelType.GuildText, 
                        parent: CONFIG.SERVER.TARGET_CAT,
                        permissionOverwrites: perms
                    });

                    let pText = `${message.author} e ${userToInvite}`;
                    if (sponsorA) pText += ` (Sponsor: <@${sponsorA}>)`;
                    if (sponsorB) pText += ` (Sponsor: <@${sponsorB}>)`;

                    await newCh.send(`🔔 Meeting: ${pText}\nScrivete **!fine** per chiudere.`);
                    
                    await reaction.message.reply(`✅ **Meeting creato!** (ID: ${newCh.id})`);
                    reaction.message.channel.messages.cache.delete(reaction.message.id);

                } catch (e) {
                    // Rollback se fallisce
                    console.error(e);
                    const rollback = await getData();
                    rollback.activeUsers = rollback.activeUsers.filter(u => u !== message.author.id && u !== userToInvite.id);
                    await rollback.save();
                }
            } else { reaction.message.reply("❌ Rifiutato."); }
        });
    }

    // --- COMANDO: !lettura ---
    if (content === '!lettura' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
        if (!message.reference) return message.reply("⚠️ Rispondi al messaggio verde.");
        const data = await getData(); // Scarica DB

        const cRead = data.letturaCounts[message.author.id] || 0;
        if (cRead >= CONFIG.LIMITS.MAX_READINGS) return message.reply("⛔ Limite raggiunto.");

        try {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            const channelId = repliedMsg.embeds[0]?.description.match(/ID:(\d+)/)?.[1] || repliedMsg.content.match(/ID: (\d+)/)?.[1];
            
            if (!channelId) return message.reply("❌ ID canale non trovato.");
            const targetChannel = await client.channels.fetch(channelId).catch(() => null);

            if (!targetChannel) return message.reply("❌ Canale non esiste.");
            if (targetChannel.permissionOverwrites.cache.has(message.author.id)) return message.reply("⚠️ Già dentro.");

            const sponsor = findSponsor(data, message.author.id);
            
            await targetChannel.permissionOverwrites.create(message.author.id, { ViewChannel: true, SendMessages: false });
            if (sponsor) await targetChannel.permissionOverwrites.create(sponsor, { ViewChannel: true, SendMessages: false });

            let msg = sponsor ? `${message.author} e sponsor <@${sponsor}> osservano.` : `${message.author} osserva.`;
            await targetChannel.send(`⚠️ ATTENZIONE: ${msg}`);

            // Aggiorna DB
            data.letturaCounts[message.author.id] = cRead + 1;
            data.markModified('letturaCounts');
            await data.save();

            message.reply(`👁️ Accesso dato.`);
        } catch (e) { console.error(e); message.reply("❌ Errore."); }
    }

    // --- COMANDO: !fine ---
    if (content === '!fine' && guildId === CONFIG.SERVER.TARGET_GUILD) {
        if (!message.channel.name.startsWith('meeting-')) return;

        const data = await getData();
        const usersInChannel = message.channel.members.map(m => m.id);
        
        // Rimuove gli utenti dalla lista activeUsers del DB
        data.activeUsers = data.activeUsers.filter(uid => !usersInChannel.includes(uid));
        await data.save();

        await message.channel.send("🛑 **Chiuso.**");
        message.channel.permissionOverwrites.cache.forEach(async (ow) => {
            if (ow.id !== client.user.id) await message.channel.permissionOverwrites.edit(ow.id, { SendMessages: false });
        });
    }
});

// ==========================================
// 7. INTERAZIONI (DB Diretto)
// ==========================================

client.on('interactionCreate', async interaction => {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_')) {
        const data = await getData(); // Scarica DB

        if (data.table.limit === 0) return interaction.reply({ content: "⛔ Chiuso.", ephemeral: true });

        const slotIndex = parseInt(interaction.values[0]);
        const type = interaction.customId.includes('player') ? 'player' : 'sponsor';

        if (data.table.slots[slotIndex][type]) return interaction.reply({ content: "❌ Occupato.", ephemeral: true });

        // Pulisce vecchie posizioni
        data.table.slots.forEach(s => {
            if (s.player === interaction.user.id) s.player = null;
            if (s.sponsor === interaction.user.id) s.sponsor = null;
        });

        data.table.slots[slotIndex][type] = interaction.user.id;
        data.markModified('table'); // Importante per Mongoose
        await data.save();

        await interaction.update({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setDescription(generateTableText(data.table))] });
    }

    if (interaction.isButton() && interaction.customId === 'leave_game') {
        const data = await getData();
        if (data.table.limit === 0) return interaction.reply({ content: "⛔ Chiuso.", ephemeral: true });

        let found = false;
        data.table.slots.forEach(s => {
            if (s.player === interaction.user.id) { s.player = null; found = true; }
            if (s.sponsor === interaction.user.id) { s.sponsor = null; found = true; }
        });

        if (!found) return interaction.reply({ content: "❌ Non iscritto.", ephemeral: true });

        data.markModified('table');
        await data.save();
        await interaction.update({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setDescription(generateTableText(data.table))] });
    }
});

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.G5f3KX.jSoE3kJ35DzPIAVbigJ6sor0qAgY4c6ukMokJ4');
