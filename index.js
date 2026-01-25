const http = require('http');
const { Client, GatewayIntentBits, Partials, Options, PermissionsBitField, ChannelType, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// --- 1. SERVER KEEP-ALIVE ---
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is alive - Version 4.6 Final (No Ghost Ping + Anti-Alt)');
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

// --- 🔧 CONFIGURAZIONE ID ---
const ID_SERVER_COMMAND = '1460740887494787259'; 
const ID_CANALE_LOG = '1464941042380837010';
const ID_SERVER_TARGET = '1463608688244822018';
const ID_CATEGORIA_TARGET = '1463608688991273015';

const ID_RUOLO_RESET = '1460741401435181295'; 
const ID_RUOLO_MEETING_1 = '1460741403331268661';
const ID_RUOLO_MEETING_2 = '1460741402672758814';
const ID_CANALE_DATABASE = '1464940718933151839'; 
const ID_CATEGORIA_CHAT_RUOLO = '1460741414357827747'; 

// ID RUOLI AUTOMATICI (TABELLA)
const ID_RUOLO_GIOCATORE_AUTO = '1460741403331268661'; 
const ID_RUOLO_SPONSOR_AUTO = '1460741404497019002';

// ID PER AUTO-JOIN
const ID_RUOLO_AUTO_JOIN = '1460741402672758814'; 

// --- 🆕 NUOVI ID PER IL BENVENUTO E GLI ALT ---
const ID_CANALE_BENVENUTO = '1460740888450830501'; 
const ID_RUOLO_ALT = '1460741402672758814'; 

// --- 🔢 VARIABILI MEMORIA ---
const meetingCounts = new Map(); 
const letturaCounts = new Map(); 
const activeUsers = new Set(); 
const MAX_MEETINGS = 3;
const MAX_LETTURE = 1;

let isAutoRoleActive = false;

// --- 📋 VARIABILI TABELLA ---
let activeTable = {
    limit: 0,
    slots: [], 
    messageId: null,
    locked: false 
};

// --- 📦 SISTEMA DATABASE SILENZIOSO (NO GHOST PING) ---
async function syncDatabase() {
    try {
        const dbChannel = await client.channels.fetch(ID_CANALE_DATABASE);
        if (!dbChannel) return;

        const dataString = JSON.stringify({
            meeting: Object.fromEntries(meetingCounts),
            lettura: Object.fromEntries(letturaCounts),
            active: Array.from(activeUsers),
            autorole: isAutoRoleActive
        });

        const content = `📦 **BACKUP_DATI**\n\`\`\`json\n${dataString}\n\`\`\``;

        // Cerca l'ultimo messaggio del bot
        const messages = await dbChannel.messages.fetch({ limit: 10 });
        const lastBackup = messages.find(m => m.author.id === client.user.id && m.content.includes('BACKUP_DATI'));

        if (lastBackup) {
            // MODIFICA il messaggio esistente (Nessuna notifica)
            if (lastBackup.content !== content) {
                await lastBackup.edit(content);
            }
        } else {
            // Se non esiste, ne crea uno nuovo
            await dbChannel.send(content);
        }

    } catch (e) { console.error("Errore DB:", e); }
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
    } catch (e) { console.log("ℹ️ Nessun backup trovato."); }
}

// --- AVVIO ---
client.once('ready', async () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    await restoreDatabase(); 
});

// --- GESTIONE BENVENUTO & AUTO-JOIN ---
client.on('guildMemberAdd', async member => {
    // 1. Assegnazione Ruolo Automatico
    if (isAutoRoleActive) {
        try { await member.roles.add(ID_RUOLO_AUTO_JOIN); } catch (e) {}
    }

    // 2. Controllo Alt per Benvenuto
    try {
        // Ricarichiamo il membro per essere sicuri di avere i ruoli aggiornati
        const fetchedMember = await member.fetch();
        const hasAltRole = fetchedMember.roles.cache.has(ID_RUOLO_ALT);

        // Se NON è un alt, manda il benvenuto
        if (!hasAltRole) {
            const welcomeChannel = member.guild.channels.cache.get(ID_CANALE_BENVENUTO);
            if (welcomeChannel) {
                await welcomeChannel.send(`Benvenuto ${member} nel server!`);
            }
        }
    } catch (e) { console.error("Errore Benvenuto:", e); }
});

// --- PULIZIA MEMORIA SE CANALE CANCELLATO MANUALMENTE ---
client.on('channelDelete', async channel => {
    if (channel.parentId === ID_CATEGORIA_TARGET && channel.name.startsWith('meeting-')) {
        // Rimuove gli utenti attivi se il canale viene eliminato a mano
        let changes = false;
        channel.permissionOverwrites.cache.forEach(ow => {
            if (activeUsers.has(ow.id)) {
                activeUsers.delete(ow.id);
                changes = true;
            }
        });
        if (changes) await syncDatabase();
    }
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) { try { await reaction.fetch(); } catch (error) { return; } }
});

// --- GESTIONE COMANDI ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // !impostazioni
    if (message.content === '!impostazioni') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        const helpEmbed = new EmbedBuilder()
            .setTitle('⚙️ Pannello Gestione Bot')
            .setColor(0x2B2D31)
            .addFields(
                { name: '🔹 !meeting @utente (Giocatori)', value: 'Crea chat privata (Inclusi Sponsor).' },
                { name: '🛑 !fine (Giocatori)', value: 'Chiude la chat.' },
                { name: '👁️ !lettura (Giocatori)', value: 'Supervisione chat (+ Sponsor).' }, 
                { name: '🚪 !entrata (Overseer)', value: `Auto-Ruolo Ingresso. (Stato: ${isAutoRoleActive ? 'ON' : 'OFF'})` },
                { name: '📋 !tabella [num] (Overseer)', value: 'Crea tabella iscrizioni.' },
                { name: '🚀 !assegna (Overseer)', value: 'Assegna stanze e ruoli.' },
                { name: '🔒 !chiusura (Overseer)', value: 'Blocca iscrizioni (Dati mantenuti).' },
                { name: '⚠️ !azzeramento1/2 (Overseer)', value: 'Reset contatori.' }
            )
            .setFooter({ text: 'Sistema v4.6 - Final' });
        return message.channel.send({ embeds: [helpEmbed] });
    }

    // !entrata
    if (message.content === '!entrata') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return; 
        isAutoRoleActive = !isAutoRoleActive;
        await syncDatabase(); 
        message.reply(`🚪 **Auto-Ruolo Ingressi:** ${isAutoRoleActive ? "✅ ATTIVO" : "🛑 DISATTIVO"}.`);
    }

    // !azzeramenti
    if (message.content === '!azzeramento1') {
        if (!message.member.roles.cache.has(ID_RUOLO_RESET)) return message.reply("⛔ Non hai i permessi.");
        meetingCounts.clear(); activeUsers.clear(); await syncDatabase();
        return message.reply("♻️ Conteggio **Meeting** azzerato.");
    }
    if (message.content === '!azzeramento2') {
        if (!message.member.roles.cache.has(ID_RUOLO_RESET)) return message.reply("⛔ Non hai i permessi.");
        letturaCounts.clear(); await syncDatabase();
        return message.reply("♻️ Conteggio **Letture** azzerato.");
    }

    // !tabella
    if (message.content.startsWith('!tabella')) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const num = parseInt(message.content.split(' ')[1]);
        if (!num || num > 25) return message.reply("Max 25 slot.");

        activeTable = { limit: num, slots: Array(num).fill(null).map(() => ({ player: null, sponsor: null })), messageId: null, locked: false };
        
        const options = [];
        for (let i = 1; i <= num; i++) options.push({ label: `Numero ${i}`, value: `${i - 1}` });

        const rows = [
            new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_player').setPlaceholder('👤 Slot Giocatore').addOptions(options)),
            new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_sponsor').setPlaceholder('💰 Slot Sponsor').addOptions(options)),
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('leave_game').setLabel('🏃 Abbandona').setStyle(ButtonStyle.Danger))
        ];

        const sentMsg = await message.channel.send({ 
            embeds: [new EmbedBuilder().setTitle(`📋 Iscrizione`).setDescription(generateTableText()).setColor('Blue')], 
            components: rows 
        });
        activeTable.messageId = sentMsg.id;
    }

    // !assegna
    if (message.content === '!assegna') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        if (activeTable.limit === 0) return message.reply("⚠️ Nessuna tabella.");
        await message.reply("⏳ Configurazione in corso...");
        
        let assegnati = 0;
        const category = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_RUOLO);
        if (!category) return message.channel.send("❌ ID Categoria errato.");

        for (let i = 0; i < activeTable.limit; i++) {
            const slot = activeTable.slots[i];
            const channel = message.guild.channels.cache.find(c => c.parentId === ID_CATEGORIA_CHAT_RUOLO && c.name === `${i + 1}`);
            if (channel) {
                await channel.permissionOverwrites.set([{ id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]);
                const perms = { ViewChannel: true, SendMessages: true, ManageMessages: true, CreatePrivateThreads: true, SendMessagesInThreads: true, CreatePublicThreads: false };
                let saluti = [];

                if (slot.player) {
                    await channel.permissionOverwrites.edit(slot.player, perms);
                    saluti.push(`<@${slot.player}>`);
                    try { const m = await message.guild.members.fetch(slot.player); await m.roles.add(ID_RUOLO_GIOCATORE_AUTO); } catch(e){}
                }
                if (slot.sponsor) {
                    await channel.permissionOverwrites.edit(slot.sponsor, perms);
                    saluti.push(`<@${slot.sponsor}>`);
                    try { const m = await message.guild.members.fetch(slot.sponsor); await m.roles.add(ID_RUOLO_SPONSOR_AUTO); } catch(e){}
                }
                if (saluti.length > 0) await channel.send(`Benvenuti ${saluti.join(' ')}!`);
                assegnati++;
            }
        }
        await message.channel.send(`✅ Fatto! Stanze configurate: ${assegnati}.`);
    }

    // !chiusura (Smart)
    if (message.content === '!chiusura') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        activeTable.locked = true;
        if (activeTable.messageId) {
            try {
                const msg = await message.channel.messages.fetch(activeTable.messageId);
                await msg.edit({ components: [] }); 
            } catch (e) {}
        }
        message.reply("🔒 **Iscrizioni Chiuse.** Menu rimossi, dati meeting mantenuti.");
    }

    // !meeting (Sponsor Auto-Add)
    if (message.content.startsWith('!meeting ')) {
        const hasRole = message.member.roles.cache.has(ID_RUOLO_MEETING_1) || message.member.roles.cache.has(ID_RUOLO_MEETING_2);
        if (!hasRole) return message.reply("⛔ Non hai il ruolo autorizzato.");

        if (activeUsers.has(message.author.id)) return message.reply("⚠️ Hai già una chat attiva.");
        if ((meetingCounts.get(message.author.id) || 0) >= MAX_MEETINGS) return message.reply("⚠️ Limite meeting raggiunto.");

        const guest = message.mentions.users.first();
        if (!guest || guest.id === message.author.id) return message.reply("⚠️ Tagga un utente.");
        
        try {
            const mGuest = await message.guild.members.fetch(guest.id);
            const gRole = mGuest.roles.cache.has(ID_RUOLO_MEETING_1) || mGuest.roles.cache.has(ID_RUOLO_MEETING_2);
            if (!gRole) return message.reply("⛔ L'ospite non ha i permessi.");
        } catch (e) { return message.reply("⚠️ Errore controllo ospite."); }

        if (activeUsers.has(guest.id)) return message.reply("⚠️ Ospite occupato.");

        const msg = await message.channel.send(`🔔 **Richiesta Meeting**\nDa: ${message.author}\nA: ${guest}\n\n✅ Accetta | ❌ Rifiuta`);
        await msg.react('✅'); await msg.react('❌');

        const coll = msg.createReactionCollector({ filter: (r, u) => ['✅','❌'].includes(r.emoji.name) && u.id === guest.id, max: 1, time: 300000 });
        
        coll.on('collect', async r => {
            if (r.emoji.name === '✅') {
                if (activeUsers.has(message.author.id) || activeUsers.has(guest.id)) return msg.reply("❌ Qualcuno è occupato.");
                
                meetingCounts.set(message.author.id, (meetingCounts.get(message.author.id)||0)+1);
                meetingCounts.set(guest.id, (meetingCounts.get(guest.id)||0)+1);
                
                // SPONSOR CHECK
                let sponsorHost = null, sponsorGuest = null;
                activeTable.slots.forEach(slot => {
                    if (slot.player === message.author.id) sponsorHost = slot.sponsor;
                    if (slot.player === guest.id) sponsorGuest = slot.sponsor;
                });

                activeUsers.add(message.author.id); activeUsers.add(guest.id);
                if (sponsorHost) activeUsers.add(sponsorHost);
                if (sponsorGuest) activeUsers.add(sponsorGuest);

                await syncDatabase();

                try {
                    const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
                    const perms = [
                        { id: ID_SERVER_TARGET, deny: ['ViewChannel'] },
                        { id: message.author.id, allow: ['ViewChannel', 'SendMessages'], deny: ['CreatePublicThreads'] },
                        { id: guest.id, allow: ['ViewChannel', 'SendMessages'], deny: ['CreatePublicThreads'] },
                        { id: client.user.id, allow: ['ViewChannel', 'SendMessages'] }
                    ];
                    if (sponsorHost) perms.push({ id: sponsorHost, allow: ['ViewChannel', 'SendMessages'], deny: ['CreatePublicThreads'] });
                    if (sponsorGuest) perms.push({ id: sponsorGuest, allow: ['ViewChannel', 'SendMessages'], deny: ['CreatePublicThreads'] });

                    const ch = await targetGuild.channels.create({
                        name: `meeting-${message.author.username}-${guest.username}`,
                        type: ChannelType.GuildText, parent: ID_CATEGORIA_TARGET, permissionOverwrites: perms
                    });

                    let w = `👋 Benvenuti ${message.author} ${guest}`;
                    if (sponsorHost) w += ` (Sponsor: <@${sponsorHost}>)`;
                    if (sponsorGuest) w += ` (Sponsor: <@${sponsorGuest}>)`;
                    await ch.send(w + "!\nScrivete **!fine** per chiudere.");

                    const embed = new EmbedBuilder().setTitle('📂 Meeting Avviato').setColor(0x00FF00)
                        .setDescription(`Host: ${message.author.tag}\nGuest: ${guest.tag}\nSponsors: ${sponsorHost ? 'Sì' : 'No'} / ${sponsorGuest ? 'Sì' : 'No'}`)
                        .setFooter({ text: `ID:${ch.id}` });
                    
                    msg.reply({ content: "✅ Creato!", embeds: [embed] });
                    msg.delete().catch(()=>{});

                } catch (e) {
                    activeUsers.delete(message.author.id); activeUsers.delete(guest.id);
                    if (sponsorHost) activeUsers.delete(sponsorHost);
                    if (sponsorGuest) activeUsers.delete(sponsorGuest);
                    msg.reply("❌ Errore creazione.");
                }
            } else msg.reply("❌ Rifiutata.");
        });
    }

    // --- !lettura (SOLO GIOCATORI + SPONSOR) ---
    if (message.content === '!lettura') {
        if (!message.reference) return message.reply("⚠️ Rispondi al messaggio verde.");

        if (!message.member.roles.cache.has(ID_RUOLO_GIOCATORE_AUTO) && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply("⛔ Solo i **Giocatori** possono usare questo comando.");
        }

        const c = letturaCounts.get(message.author.id) || 0;
        if (c >= MAX_LETTURE) return message.reply("⛔ Limite raggiunto.");
        
        try {
            const ref = await message.channel.messages.fetch(message.reference.messageId);
            const chId = ref.embeds[0]?.footer?.text.match(/ID:(\d+)/)?.[1];
            if (!chId) return;
            const tGuild = client.guilds.cache.get(ID_SERVER_TARGET);
            const ch = await tGuild.channels.fetch(chId);
            if (ch.permissionOverwrites.cache.has(message.author.id)) return message.reply("⚠️ Sei già dentro.");
            
            // 1. Aggiungi il Giocatore
            await ch.permissionOverwrites.create(message.author.id, { ViewChannel: true, SendMessages: false });
            
            // 2. Cerca e aggiungi lo Sponsor (se esiste)
            let sponsorId = null;
            activeTable.slots.forEach(slot => {
                if (slot.player === message.author.id) sponsorId = slot.sponsor;
            });
            
            let extraText = "";
            if (sponsorId) {
                 await ch.permissionOverwrites.create(sponsorId, { ViewChannel: true, SendMessages: false });
                 extraText = ` (e il suo sponsor <@${sponsorId}>)`;
            }

            await ch.send(`⚠️ ${message.author}${extraText} sta osservando.`);
            letturaCounts.set(message.author.id, c + 1); await syncDatabase();
            message.reply("👁️ Accesso dato.");
        } catch (e) { message.reply("❌ Errore."); }
    }

    // --- !fine ---
    if (message.content === '!fine' && message.guild.id === ID_SERVER_TARGET) {
        message.channel.permissionOverwrites.cache.forEach(ow => {
            if (ow.allow.has(PermissionsBitField.Flags.SendMessages)) activeUsers.delete(ow.id);
        });
        await syncDatabase();
        message.channel.send("🛑 Chiusa.");
        message.channel.permissionOverwrites.cache.forEach(ow => {
            if (ow.id !== client.user.id) message.channel.permissionOverwrites.edit(ow.id, { SendMessages: false });
        });
    }
});

// --- INTERAZIONI ---
client.on('interactionCreate', async i => {
    if ((i.isStringSelectMenu() && ['select_player','select_sponsor'].includes(i.customId)) || (i.isButton() && i.customId === 'leave_game')) {
        if (activeTable.locked) return i.reply({ content: "🔒 Tabella chiusa.", ephemeral: true });

        if (i.customId === 'leave_game') {
            let found = false;
            activeTable.slots.forEach(s => { if(s.player===i.user.id){s.player=null; found=true;} if(s.sponsor===i.user.id){s.sponsor=null; found=true;} });
            if(!found) return i.reply({content:"❌ Non eri iscritto.", ephemeral:true});
        } else {
            const idx = parseInt(i.values[0]);
            const type = i.customId === 'select_player' ? 'player' : 'sponsor';
            if (activeTable.slots[idx][type]) return i.reply({ content: "❌ Occupato!", ephemeral: true });
            
            activeTable.slots.forEach(s => { if(s.player===i.user.id)s.player=null; if(s.sponsor===i.user.id)s.sponsor=null; });
            activeTable.slots[idx][type] = i.user.id;
        }
        i.update({ embeds: [new EmbedBuilder(i.message.embeds[0]).setDescription(generateTableText())] });
    }
});

function generateTableText() {
    let t = "**Giocatori** \u200b \u200b | \u200b \u200b **Sponsor**\n---\n";
    activeTable.slots.forEach((s, i) => t += `**#${i+1}** ${s.player?`<@${s.player}>`:'(libero)'} | ${s.sponsor?`<@${s.sponsor}>`:'(libero)'}\n`);
    return t;
}

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GFe33d.9RgkeDdLwtKrQhi69vQFgMCVaR-hqvYkkI-hVg');
