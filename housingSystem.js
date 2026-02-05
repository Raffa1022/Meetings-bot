const mongoose = require('mongoose');
const { 
    ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    EmbedBuilder, ChannelType, PermissionsBitField, ButtonStyle, ButtonBuilder
} = require('discord.js');

// ==========================================
// ⚙️ CONFIGURAZIONE (IDs e Costanti)
// ==========================================
const PREFIX = '!';
const ID_CATEGORIA_CASE = '1460741413388947528';
const ID_CATEGORIA_CHAT_PRIVATE = '1460741414357827747'; 
const ID_CATEGORIA_CHAT_DIURNA = '1460741410599866413';

// PERMESSI NOTTE
const ID_CANALE_BLOCCO_TOTALE = '1460741488815247567'; 
const ID_CANALI_BLOCCO_PARZIALE = [
    '1464941042380837010', '1460741484226543840', 
    '1460741486290276456', '1460741488135635030'
];

const ID_CANALE_ANNUNCI = '1460741475804381184'; 
const ID_RUOLO_NOTIFICA_1 = '1460741403331268661'; 
const ID_RUOLO_NOTIFICA_2 = '1460741404497019002';
const ID_RUOLO_NOTIFICA_3 = '1460741405722022151';

const GIF_NOTTE_START = 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExbWl6d2w2NWhkM2QwZWR6aDZ5YW5pdmFwMjR4NGd1ZXBneGo4NmhvayZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/LMomqSiRZF3zi/giphy.gif'; 
const GIF_GIORNO_START = 'https://media.giphy.com/media/jxbtTiXsCUZQXOKP2M/giphy.gif';
const GIF_DISTRUZIONE = 'https://i.giphy.com/media/oe33xf3B50fsc/giphy.gif'; 
const GIF_RICOSTRUZIONE = 'https://i.giphy.com/media/3ohjUS0WqYBpczfTlm/giphy.gif'; 

const RUOLI_PUBBLICI = ['1460741403331268661', '1460741404497019002', '1460741405722022151'];
const RUOLI_PERMESSI = ['1460741403331268661', '1460741404497019002']; 
const DEFAULT_MAX_VISITS = 0;

let AbilityModel = null;
let dbCache = {}; 
let HousingModel = null;
let QueueSystem = null;
let QueueModel = null; // ← AGGIUNTO per accedere al DB della coda
let clientRef = null;
// pendingKnocks ora è dentro dbCache.pendingKnocks (array su MongoDB)

// ==========================================
// FUNZIONI DATABASE MONGO
// ==========================================

async function loadDB() {
    try {
        let data = await HousingModel.findOne({ id: 'main_housing' });
        if (!data) {
            data = new HousingModel({ id: 'main_housing' });
            await data.save();
        }
        dbCache = data.toObject();
        
        // Inizializza pendingKnocks se non esiste
        if (!dbCache.pendingKnocks) {
            dbCache.pendingKnocks = [];
        }
        console.log("💾 [Housing] Database caricato da MongoDB!");
    } catch (e) {
        console.error("❌ [Housing] Errore caricamento DB:", e);
    }
}

async function saveDB() {
    try {
        await HousingModel.findOneAndUpdate({ id: 'main_housing' }, dbCache, { upsert: true });
    } catch (e) {
        console.error("❌ [Housing] Errore salvataggio DB:", e);
    }
}

// ==========================================
// FUNZIONI LOGICA
// ==========================================

function applyLimitsForMode() {
    dbCache.playerVisits = {}; 
    
    const allUsers = new Set([
        ...Object.keys(dbCache.playerHomes || {}),
        ...Object.keys(dbCache.baseVisits || {}),
        ...Object.keys(dbCache.dayLimits || {})
    ]);

    allUsers.forEach(userId => {
        if (dbCache.currentMode === 'DAY') {
            const limits = (dbCache.dayLimits && dbCache.dayLimits[userId]) ? dbCache.dayLimits[userId] : { forced: 0, hidden: 0 };
            if (!dbCache.forcedVisits) dbCache.forcedVisits = {};
            if (!dbCache.hiddenVisits) dbCache.hiddenVisits = {};
            
            dbCache.forcedVisits[userId] = limits.forced;
            dbCache.hiddenVisits[userId] = limits.hidden;
        } else {
            if (!dbCache.forcedVisits) dbCache.forcedVisits = {};
            if (!dbCache.hiddenVisits) dbCache.hiddenVisits = {};
            
            dbCache.forcedVisits[userId] = (dbCache.forcedLimits && dbCache.forcedLimits[userId]) || 0;
            dbCache.hiddenVisits[userId] = (dbCache.hiddenLimits && dbCache.hiddenLimits[userId]) || 0;
        }
    });
}

async function cleanOldHome(userId, guild) {
    const oldHomeId = dbCache.playerHomes[userId];
    if (oldHomeId) {
        const oldChannel = guild.channels.cache.get(oldHomeId);
        if (oldChannel) {
            try {
                const pinnedMessages = await oldChannel.messages.fetchPinned();
                const keyMsg = pinnedMessages.find(m => m.content.includes("questa è la tua dimora privata"));
                if (keyMsg) await keyMsg.delete();
            } catch (err) {
                console.log("Errore rimozione pin vecchia casa:", err);
            }
        }
    }
}

function formatName(name) {
    return name.replace(/-/g, ' ').toUpperCase().substring(0, 25);
}

async function enterHouse(member, fromChannel, toChannel, entryMessage, isSilent) {
    const isForcedEntry = entryMessage.includes("ha sfondato la porta");
    
    if (!isSilent && !isForcedEntry) {
        const current = dbCache.playerVisits[member.id] || 0;
        dbCache.playerVisits[member.id] = current + 1;
        await saveDB();
    }
    await movePlayer(member, fromChannel, toChannel, entryMessage, isSilent);
}

async function movePlayer(member, oldChannel, newChannel, entryMessage, isSilent) {
    if (!member || !newChannel) return;

    let channelToLeave = oldChannel;
    
    if (oldChannel && oldChannel.parentId === ID_CATEGORIA_CHAT_PRIVATE) {
        const currentHouse = oldChannel.guild.channels.cache.find(c => 
            c.parentId === ID_CATEGORIA_CASE && 
            c.permissionsFor(member).has(PermissionsBitField.Flags.ViewChannel)
        );
        if (currentHouse) channelToLeave = currentHouse;
    }

    if (channelToLeave && channelToLeave.id !== newChannel.id) {
        if (channelToLeave.parentId === ID_CATEGORIA_CASE) {
            const prevMode = dbCache.playerModes ? dbCache.playerModes[member.id] : null;
            if (prevMode !== 'HIDDEN') {
                await channelToLeave.send(`🚪 ${member} è uscito.`);
            }
            await channelToLeave.permissionOverwrites.delete(member.id).catch(() => {});
        }
    }

   await newChannel.permissionOverwrites.create(member.id, { 
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true 
    });
    
    if (!dbCache.playerModes) dbCache.playerModes = {};
    dbCache.playerModes[member.id] = isSilent ? 'HIDDEN' : 'NORMAL';
    await saveDB();

    if (!isSilent) await newChannel.send(entryMessage);
}

// ==========================================
// EXPORT INIT
// ==========================================
// ==========================================
// 🎯 ESECUTORE AZIONI HOUSING PER CODA
// ==========================================
async function executeHousingAction(queueItem) {
    console.log(`🎯 [Housing Executor] Ricevuta azione: ${queueItem.type} da utente ${queueItem.userId}`);
    console.log(`📋 [Housing Executor] Dettagli:`, queueItem.details);
    
    // Trova il guild (server Discord)
    const guild = Object.values(dbCache.playerHomes).length > 0 
        ? (await clientRef.channels.fetch(Object.values(dbCache.playerHomes)[0]).catch(()=>null))?.guild
        : clientRef.guilds.cache.first();

    if (!guild) {
        console.error("❌ [Housing] Guild non trovata.");
        return;
    }
    
    const member = await guild.members.fetch(queueItem.userId).catch(() => null);
    if (!member) {
        console.error("❌ [Housing] Membro non trovato.");
        return;
    }
    
    const details = queueItem.details;
    
    // --- ESECUZIONE BASATA SUL TIPO ---
    switch (queueItem.type) {
        case 'KNOCK':
            await executeKnock(member, details, guild);
            break;
        
        case 'RETURN':
            await executeReturn(member, details, guild);
            break;
        
        case 'ABILITY':
            await executeAbility(member, details, guild);
            break;
        
        default:
            console.warn(`⚠️ [Housing] Tipo azione sconosciuto: ${queueItem.type}`);
    }
}

// --- ESECUTORI SPECIFICI ---

async function executeKnock(knocker, details, guild) {
    console.log(`🚪 [Housing] Eseguendo KNOCK per ${knocker.user.tag}`);
    
    const { targetChannelId, mode, fromChannelId } = details;
    const targetChannel = guild.channels.cache.get(targetChannelId);
    const fromChannel = fromChannelId ? guild.channels.cache.get(fromChannelId) : null;
    
    if (!targetChannel) {
        console.error("❌ [Housing] Canale target non trovato.");
        return;
    }
    
    // A. Ingressi immediati (Forzata/Nascosta)
    if (mode === 'mode_forced') {
        const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(', ');
        await enterHouse(knocker, fromChannel, targetChannel, `${roleMentions}, ${knocker} ha sfondato la porta ed è entrato`, false);
        return;
    } 
    
    if (mode === 'mode_hidden') {
        await enterHouse(knocker, fromChannel, targetChannel, "", true);
        return;
    }

    // B. Visita Normale -> TOC TOC
    const membersWithAccess = targetChannel.members.filter(m => 
        !m.user.bot && m.id !== knocker.id && m.roles.cache.hasAny(...RUOLI_PERMESSI)
    );

    // Se vuota, entra subito
    if (membersWithAccess.size === 0) {
        await enterHouse(knocker, fromChannel, targetChannel, `👋 ${knocker} è entrato.`, false);
        return;
    }

    // Se c'è gente, invia il messaggio TOC TOC
    const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(' ');
    const msg = await targetChannel.send(`🔔 **TOC TOC!** ${roleMentions}\nQualcuno sta bussando\n✅ = Apri | ❌ = Rifiuta`);
    await msg.react('✅'); 
    await msg.react('❌');

    const filter = (reaction, user) => 
        ['✅', '❌'].includes(reaction.emoji.name) && 
        membersWithAccess.has(user.id);
    
    const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

    collector.on('collect', async (reaction, user) => {
        if (reaction.emoji.name === '✅') {
            await msg.reply(`✅ Qualcuno ha aperto.`);
            await enterHouse(knocker, fromChannel, targetChannel, `👋 ${knocker} è entrato.`, false);
        } else {
            const currentRefused = dbCache.playerVisits[knocker.id] || 0;
            dbCache.playerVisits[knocker.id] = currentRefused + 1;
            await saveDB();

            await msg.reply(`❌ Qualcuno ha rifiutato.`);

            const presentPlayers = targetChannel.members
                .filter(m => !m.user.bot && m.id !== knocker.id && !m.permissions.has(PermissionsBitField.Flags.Administrator))
                .map(m => m.displayName)
                .join(', ');

            if (fromChannel) {
                await fromChannel.send(`⛔ ${knocker}, entrata rifiutata. I giocatori presenti in quella casa sono: ${presentPlayers || 'Nessuno'}`);
            }
        }
    });

    collector.on('end', async collected => {
        if (collected.size === 0) {
            await msg.reply('⏳ Nessuno ha risposto. La porta viene forzata.');
            await enterHouse(knocker, fromChannel, targetChannel, `👋 ${knocker} è entrato.`, false);
        }
    });
}

async function executeReturn(member, details, guild) {
    console.log(`🏠 [Housing] Eseguendo RETURN per ${member.user.tag}`);
    
    const { currentChannelId } = details;
    const userHouseId = dbCache.playerHomes[member.id];
    
    if (!userHouseId) {
        console.error("❌ [Housing] Casa non trovata per l'utente.");
        return;
    }
    
    const houseChannel = guild.channels.cache.get(userHouseId);
    const currentChannel = currentChannelId ? guild.channels.cache.get(currentChannelId) : null;
    
    if (!houseChannel) {
        console.error("❌ [Housing] Canale casa non trovato.");
        return;
    }
    
    await enterHouse(member, currentChannel, houseChannel, `🏠 ${member} è tornato a casa.`, false);
}

async function executeAbility(member, details, guild) {
    console.log(`⚡ [Housing] Eseguendo ABILITY per ${member.user.tag}`);
    
    const { mongoId, targetUserId, fromChannelId } = details;
    
    // Recupera la richiesta dal DB
    const req = await AbilityModel.findById(mongoId);
    if (!req) {
        console.error("❌ [Housing] Richiesta abilità non trovata nel DB.");
        return;
    }
    
    const fromChannel = fromChannelId ? guild.channels.cache.get(fromChannelId) : null;
    
    // Esegui abilità in base al tipo
    switch (req.ability) {
        case 'Portale Domestico':
            await executePortaleDomestico(member, targetUserId, fromChannel, guild);
            break;
        
        case 'Esca':
            await executeEsca(member, targetUserId, fromChannel, guild);
            break;
        
        case 'Indagare':
            await executeIndagare(member, targetUserId, fromChannel);
            break;
        
        default:
            console.warn(`⚠️ [Housing] Abilità sconosciuta: ${req.ability}`);
    }
    
    // Segna come EXECUTED
    req.status = 'EXECUTED';
    await req.save();
}

// --- ABILITÀ SPECIFICHE ---

async function executePortaleDomestico(member, targetUserId, fromChannel, guild) {
    const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
    if (!targetMember) return;
    
    const targetHouseId = dbCache.playerHomes[targetUserId];
    if (!targetHouseId) return;
    
    const targetHouseChannel = guild.channels.cache.get(targetHouseId);
    if (!targetHouseChannel) return;
    
    await enterHouse(member, fromChannel, targetHouseChannel, `✨ ${member} è apparso tramite portale!`, false);
}

async function executeEsca(member, targetUserId, fromChannel, guild) {
    const targetMember = await guild.members.fetch(targetUserId).catch(() => null);
    if (!targetMember) return;
    
    const memberHouseId = dbCache.playerHomes[member.id];
    if (!memberHouseId) return;
    
    const memberHouseChannel = guild.channels.cache.get(memberHouseId);
    if (!memberHouseChannel) return;
    
    // Trova il canale corrente del target
    const targetCurrentChannel = guild.channels.cache.find(c => 
        c.parentId === ID_CATEGORIA_CASE && 
        c.permissionsFor(targetMember).has(PermissionsBitField.Flags.ViewChannel)
    );
    
    await enterHouse(targetMember, targetCurrentChannel, memberHouseChannel, `🪤 ${targetMember} è stato attirato qui da ${member}!`, false);
}

async function executeIndagare(member, targetUserId, fromChannel) {
    // Conta le visite del target
    const visits = dbCache.playerVisits[targetUserId] || 0;
    const baseVisits = dbCache.baseVisits[targetUserId] || 0;
    const totalVisits = visits + baseVisits;
    
    if (fromChannel) {
        await fromChannel.send(`🔍 ${member} ha investigato! Il target ha effettuato ${totalVisits} visite totali.`);
    }
}

// ==========================================
// INIT
// ==========================================
module.exports.init = async (client, HousingModelParam, AbilityModelParam, QueueSystemParam, QueueModelParam) => {
    clientRef = client;
    HousingModel = HousingModelParam;
    AbilityModel = AbilityModelParam;
    QueueSystem = QueueSystemParam;
    QueueModel = QueueModelParam;

    await loadDB();
    console.log("🎮 [Housing System] Inizializzato!");

    // ==========================================
    // 🔧 COMANDI DI TESTO
    // ==========================================
    client.on('messageCreate', async message => {
        if (message.author.bot) return;
        if (!message.guild) return;
        if (!message.content.startsWith(PREFIX)) return;

        const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
        const cmd = args.shift().toLowerCase();

        // STAFF
        const isStaff = message.member.permissions.has(PermissionsBitField.Flags.Administrator);

        // ==========================================
        // 🏗️ !GENERA
        // ==========================================
        if (cmd === 'genera' && isStaff) {
            const channel = message.channel;
            const categoryId = channel.parentId;

            if (categoryId !== ID_CATEGORIA_CHAT_DIURNA && categoryId !== ID_CATEGORIA_CHAT_PRIVATE) {
                return message.reply("⛔ Usa !genera solo in categoria DIURNA o CHAT_PRIVATE.");
            }

            const roleId = args[0];
            const roleTitolo = args[1];
            const maxVisits = args[2] ? parseInt(args[2], 10) : DEFAULT_MAX_VISITS;

            if (!roleId || !roleTitolo) {
                return message.reply("⛔ Uso: `!genera <RUOLO> <TITOLO_BREVE> [MAX_VISITE]`");
            }

            const role = message.guild.roles.cache.get(roleId);
            if (!role) return message.reply("⛔ Ruolo non trovato!");

            const members = role.members.filter(m => !m.user.bot);
            if (members.size === 0) return message.reply("⛔ Nessun membro umano con quel ruolo.");

            let createdCount = 0;
            let skippedCount = 0;
            const casaCat = message.guild.channels.cache.get(ID_CATEGORIA_CASE);
            if (!casaCat) return message.reply("⛔ Categoria CASE non trovata!");

            const privateCat = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_PRIVATE);
            if (!privateCat) return message.reply("⛔ Categoria CHAT_PRIVATE non trovata!");

            for (const [memberId, m] of members) {
                if (dbCache.playerHomes && dbCache.playerHomes[memberId]) {
                    skippedCount++;
                    continue;
                }

                const channelName = formatName(m.displayName);

                const houseChannel = await message.guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: casaCat.id,
                    permissionOverwrites: [
                        { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: m.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ]
                });

                const privateChannel = await message.guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: privateCat.id,
                    permissionOverwrites: [
                        { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: m.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ]
                });

                const keyMsg = await houseChannel.send(`🔑 Ciao ${m}, questa è la tua dimora privata`);
                await keyMsg.pin();

                if (!dbCache.playerHomes) dbCache.playerHomes = {};
                if (!dbCache.privateChannels) dbCache.privateChannels = {};
                if (!dbCache.playerTitles) dbCache.playerTitles = {};
                if (!dbCache.maxVisits) dbCache.maxVisits = {};

                dbCache.playerHomes[memberId] = houseChannel.id;
                dbCache.privateChannels[memberId] = privateChannel.id;
                dbCache.playerTitles[memberId] = roleTitolo;
                dbCache.maxVisits[memberId] = maxVisits;

                if (!dbCache.baseVisits) dbCache.baseVisits = {};
                dbCache.baseVisits[memberId] = 0;

                if (dbCache.currentMode === 'DAY') {
                    if (!dbCache.dayLimits) dbCache.dayLimits = {};
                    dbCache.dayLimits[memberId] = { forced: 0, hidden: 0 };
                } else {
                    if (!dbCache.forcedLimits) dbCache.forcedLimits = {};
                    if (!dbCache.hiddenLimits) dbCache.hiddenLimits = {};
                    dbCache.forcedLimits[memberId] = 0;
                    dbCache.hiddenLimits[memberId] = 0;
                }

                createdCount++;
            }

            await saveDB();
            applyLimitsForMode();
            await saveDB();

            message.reply(`✅ Generazione completata!\nCreate: ${createdCount}\nSaltate (già presenti): ${skippedCount}`);
        }

        // ==========================================
        // 🌙 !NOTTE
        // ==========================================
        if (cmd === 'notte' && isStaff) {
            dbCache.currentMode = 'NIGHT';
            await saveDB();

            const catCase = message.guild.channels.cache.get(ID_CATEGORIA_CASE);
            if (catCase) {
                catCase.children.cache.forEach(async ch => {
                    await ch.permissionOverwrites.edit(message.guild.id, {
                        SendMessages: false,
                        ViewChannel: null
                    });
                });
            }

            const bloccoTotale = message.guild.channels.cache.get(ID_CANALE_BLOCCO_TOTALE);
            if (bloccoTotale) {
                await bloccoTotale.permissionOverwrites.edit(message.guild.id, {
                    SendMessages: false
                });
            }

            ID_CANALI_BLOCCO_PARZIALE.forEach(async canaleId => {
                const canale = message.guild.channels.cache.get(canaleId);
                if (canale) {
                    RUOLI_PUBBLICI.forEach(async roleId => {
                        await canale.permissionOverwrites.edit(roleId, { SendMessages: false });
                    });
                }
            });

            const embed = new EmbedBuilder()
                .setTitle("🌙 MODALITÀ NOTTE ATTIVATA")
                .setDescription("È sceso il buio! Le case sono accessibili solo in modalità nascosta.")
                .setImage(GIF_NOTTE_START)
                .setColor('#000080');

            const annunci = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunci) {
                const mention1 = `<@&${ID_RUOLO_NOTIFICA_1}>`;
                const mention2 = `<@&${ID_RUOLO_NOTIFICA_2}>`;
                const mention3 = `<@&${ID_RUOLO_NOTIFICA_3}>`;
                await annunci.send({ content: `${mention1} ${mention2} ${mention3}`, embeds: [embed] });
            }

            message.reply("🌙 Modalità **NOTTE** attivata!");
        }

        // ==========================================
        // 🌅 !GIORNO
        // ==========================================
        if (cmd === 'giorno' && isStaff) {
            dbCache.currentMode = 'DAY';

            const catCase = message.guild.channels.cache.get(ID_CATEGORIA_CASE);
            if (catCase) {
                catCase.children.cache.forEach(async ch => {
                    await ch.permissionOverwrites.edit(message.guild.id, {
                        SendMessages: true,
                        ViewChannel: null
                    });
                });
            }

            const bloccoTotale = message.guild.channels.cache.get(ID_CANALE_BLOCCO_TOTALE);
            if (bloccoTotale) {
                await bloccoTotale.permissionOverwrites.edit(message.guild.id, {
                    SendMessages: true
                });
            }

            ID_CANALI_BLOCCO_PARZIALE.forEach(async canaleId => {
                const canale = message.guild.channels.cache.get(canaleId);
                if (canale) {
                    RUOLI_PUBBLICI.forEach(async roleId => {
                        await canale.permissionOverwrites.edit(roleId, { SendMessages: true });
                    });
                }
            });

            applyLimitsForMode();
            await saveDB();

            const embed = new EmbedBuilder()
                .setTitle("🌅 MODALITÀ GIORNO ATTIVATA")
                .setDescription("È sorto il sole! Le visite notturne sono bloccate.")
                .setImage(GIF_GIORNO_START)
                .setColor('#FFD700');

            const annunci = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunci) {
                const mention1 = `<@&${ID_RUOLO_NOTIFICA_1}>`;
                const mention2 = `<@&${ID_RUOLO_NOTIFICA_2}>`;
                const mention3 = `<@&${ID_RUOLO_NOTIFICA_3}>`;
                await annunci.send({ content: `${mention1} ${mention2} ${mention3}`, embeds: [embed] });
            }

            message.reply("🌅 Modalità **GIORNO** attivata!");
        }

        // ==========================================
        // 🔄 !RICARICA
        // ==========================================
        if (cmd === 'ricarica' && isStaff) {
            await loadDB();
            applyLimitsForMode();
            await saveDB();
            message.reply("✅ Housing ricaricato da MongoDB!");
        }

        // ==========================================
        // 🔥 !DISTRUGGI
        // ==========================================
        if (cmd === 'distruggi' && isStaff) {
            const casaCat = message.guild.channels.cache.get(ID_CATEGORIA_CASE);
            const privateCat = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_PRIVATE);
            const channels = [
                ...(casaCat ? casaCat.children.cache.values() : []),
                ...(privateCat ? privateCat.children.cache.values() : [])
            ];

            let deleted = 0;
            for (const ch of channels) {
                try {
                    await ch.delete();
                    deleted++;
                } catch (e) {
                    console.error("Errore delete canale:", e);
                }
            }

            dbCache.playerHomes = {};
            dbCache.privateChannels = {};
            dbCache.playerTitles = {};
            dbCache.maxVisits = {};
            dbCache.baseVisits = {};
            dbCache.playerVisits = {};
            dbCache.playerModes = {};
            dbCache.forcedVisits = {};
            dbCache.hiddenVisits = {};
            dbCache.forcedLimits = {};
            dbCache.hiddenLimits = {};
            dbCache.dayLimits = {};
            dbCache.pendingKnocks = [];

            await saveDB();

            const embed = new EmbedBuilder()
                .setTitle("🔥 DISTRUZIONE COMPLETATA")
                .setDescription(`${deleted} canali eliminati e DB resettato.`)
                .setImage(GIF_DISTRUZIONE)
                .setColor('#FF4500');

            message.reply({ embeds: [embed] });
        }

        // ==========================================
        // 🛠️ !RICOSTRUISCI
        // ==========================================
        if (cmd === 'ricostruisci' && isStaff) {
            const roleId = args[0];
            const roleTitolo = args[1];
            const maxVisits = args[2] ? parseInt(args[2], 10) : DEFAULT_MAX_VISITS;

            if (!roleId || !roleTitolo) {
                return message.reply("⛔ Uso: `!ricostruisci <RUOLO> <TITOLO> [MAX_VISITE]`");
            }

            const role = message.guild.roles.cache.get(roleId);
            if (!role) return message.reply("⛔ Ruolo non trovato!");

            const members = role.members.filter(m => !m.user.bot);
            if (members.size === 0) return message.reply("⛔ Nessun membro umano con quel ruolo.");

            const casaCat = message.guild.channels.cache.get(ID_CATEGORIA_CASE);
            if (!casaCat) return message.reply("⛔ Categoria CASE non trovata!");

            const privateCat = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_PRIVATE);
            if (!privateCat) return message.reply("⛔ Categoria CHAT_PRIVATE non trovata!");

            let created = 0;

            for (const [memberId, m] of members) {
                await cleanOldHome(memberId, message.guild);

                const channelName = formatName(m.displayName);

                const houseChannel = await message.guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: casaCat.id,
                    permissionOverwrites: [
                        { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: m.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ]
                });

                const privateChannel = await message.guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: privateCat.id,
                    permissionOverwrites: [
                        { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: m.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ]
                });

                const keyMsg = await houseChannel.send(`🔑 Ciao ${m}, questa è la tua dimora privata`);
                await keyMsg.pin();

                dbCache.playerHomes[memberId] = houseChannel.id;
                dbCache.privateChannels[memberId] = privateChannel.id;
                dbCache.playerTitles[memberId] = roleTitolo;
                dbCache.maxVisits[memberId] = maxVisits;

                created++;
            }

            await saveDB();

            const embed = new EmbedBuilder()
                .setTitle("🛠️ RICOSTRUZIONE COMPLETATA")
                .setDescription(`${created} case ricostruite per il ruolo ${role.name}`)
                .setImage(GIF_RICOSTRUZIONE)
                .setColor('#32CD32');

            message.reply({ embeds: [embed] });
        }

        // ==========================================
        // 📊 !COUNTER
        // ==========================================
        if (cmd === 'counter') {
            const userId = message.author.id;
            const currentVisits = dbCache.playerVisits[userId] || 0;
            const baseVisits = dbCache.baseVisits[userId] || 0;
            const maxAllowed = dbCache.maxVisits[userId] || DEFAULT_MAX_VISITS;

            const totalVisits = currentVisits + baseVisits;
            const remaining = maxAllowed - totalVisits;

            const forcedVal = (dbCache.forcedVisits && dbCache.forcedVisits[userId]) || 0;
            const hiddenVal = (dbCache.hiddenVisits && dbCache.hiddenVisits[userId]) || 0;

            const embed = new EmbedBuilder()
                .setTitle("📊 CONTATORE VISITE")
                .setDescription(
                    `**Visite effettuate:** ${totalVisits}/${maxAllowed}\n` +
                    `**Rimaste:** ${remaining >= 0 ? remaining : 0}\n` +
                    `**Forzate disponibili:** ${forcedVal}\n` +
                    `**Nascoste disponibili:** ${hiddenVal}`
                )
                .setColor('#1E90FF');

            message.reply({ embeds: [embed] });
        }

        // ==========================================
        // 🏠 !TORNA
        // ==========================================
        if (cmd === 'torna') {
            const userId = message.author.id;
            const userHouseId = dbCache.playerHomes[userId];

            if (!userHouseId) {
                return message.reply("⛔ Non hai una casa assegnata!");
            }

            const houseChannel = message.guild.channels.cache.get(userHouseId);
            if (!houseChannel) {
                return message.reply("⛔ Canale casa non trovato!");
            }

            // --- MODIFICA CODA ---
            if (QueueSystem) {
                console.log(`➕ [Housing] Aggiungendo RETURN alla coda per ${message.author.tag}`);
                await QueueSystem.add('RETURN', message.author.id, {
                    currentChannelId: message.channel.id
                });
                return message.reply("⏳ **Azione Torna** messa in coda. Attendi...");
            } else {
                // Fallback esecuzione immediata
                await enterHouse(message.member, message.channel, houseChannel, `🏠 ${message.member} è tornato a casa.`, false);
            }
        }

        // ==========================================
        // 🚪 !BUSSA (TESTO)
        // ==========================================
        if (cmd === 'bussa') {
            const knocker = message.member;

            if (!dbCache.playerHomes || !dbCache.playerHomes[knocker.id]) {
                return message.reply("⛔ Non hai una casa assegnata!");
            }

            const mode = dbCache.currentMode;
            if (mode !== 'NIGHT' && mode !== 'DAY') {
                return message.reply("⛔ Sistema non inizializzato.");
            }

            // Lista case
            const options = [];
            const catCase = message.guild.channels.cache.get(ID_CATEGORIA_CASE);
            if (catCase) {
                catCase.children.cache
                    .filter(ch => ch.id !== dbCache.playerHomes[knocker.id])
                    .forEach(ch => {
                        const ownerId = Object.keys(dbCache.playerHomes).find(uid => dbCache.playerHomes[uid] === ch.id);
                        const titleLabel = ownerId ? (dbCache.playerTitles[ownerId] || 'Sconosciuto') : 'Sconosciuto';
                        options.push(
                            new StringSelectMenuOptionBuilder()
                                .setLabel(ch.name)
                                .setValue(ch.id)
                                .setDescription(titleLabel)
                        );
                    });
            }

            if (options.length === 0) {
                return message.reply("⛔ Nessuna casa disponibile!");
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('knock_select')
                .setPlaceholder('🚪 Scegli una casa')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            // Aggiungi knocker a pendingKnocks
            if (!dbCache.pendingKnocks) dbCache.pendingKnocks = [];
            if (!dbCache.pendingKnocks.includes(knocker.id)) {
                dbCache.pendingKnocks.push(knocker.id);
                await saveDB();
            }

            await message.reply({ content: "🚪 Seleziona la casa:", components: [row] });
        }

        // ==========================================
        // ❌ !RIMUOVI
        // ==========================================
        if (cmd === 'rimuovi') {
            const userId = message.author.id;
            const isSelectingHouse = (dbCache.pendingKnocks && dbCache.pendingKnocks.includes(userId));
            const hasKnockQueue = QueueModel ? await QueueModel.findOne({ type: 'KNOCK', userId, status: 'PENDING' }) : null;
            const hasReturnQueue = QueueModel ? await QueueModel.findOne({ type: 'RETURN', userId, status: 'PENDING' }) : null;
            const hasAbilityQueue = QueueModel ? await QueueModel.findOne({ type: 'ABILITY', userId, status: 'PENDING' }) : null;

            const options = [];
            if (isSelectingHouse) {
                options.push(
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Annulla selezione casa")
                        .setValue("remove_selecting")
                        .setDescription("Rimuovi il menu di scelta casa")
                );
            }
            if (hasKnockQueue) {
                options.push(
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Rimuovi Bussa")
                        .setValue("remove_knock")
                        .setDescription("Rimuovi dalla coda")
                );
            }
            if (hasReturnQueue) {
                options.push(
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Rimuovi Torna")
                        .setValue("remove_return")
                        .setDescription("Rimuovi dalla coda")
                );
            }
            if (hasAbilityQueue) {
                options.push(
                    new StringSelectMenuOptionBuilder()
                        .setLabel("Rimuovi Abilità")
                        .setValue("remove_ability")
                        .setDescription("Rimuovi dalla coda")
                );
            }

            if (options.length === 0) {
                return message.reply("⛔ Nessuna azione da rimuovere.");
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('remove_action_select')
                .setPlaceholder('❌ Cosa vuoi rimuovere?')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await message.reply({ content: "❌ Seleziona cosa rimuovere:", components: [row] });
        }

        // ==========================================
        // ➕ !AGGIUNGI (VISITE)
        // ==========================================
        if (cmd === 'aggiungi' && isStaff) {
            const mention = message.mentions.members.first();
            const tipo = args[1]?.toLowerCase();
            const valore = parseInt(args[2], 10);

            if (!mention || !tipo || isNaN(valore)) {
                return message.reply("⛔ Uso: `!aggiungi @utente <tipo> <numero>`\nTipi: `base`, `forced`, `hidden`");
            }

            const userId = mention.id;

            switch (tipo) {
                case 'base':
                    if (!dbCache.baseVisits) dbCache.baseVisits = {};
                    dbCache.baseVisits[userId] = (dbCache.baseVisits[userId] || 0) + valore;
                    break;
                case 'forced':
                    if (dbCache.currentMode === 'DAY') {
                        if (!dbCache.dayLimits) dbCache.dayLimits = {};
                        if (!dbCache.dayLimits[userId]) dbCache.dayLimits[userId] = { forced: 0, hidden: 0 };
                        dbCache.dayLimits[userId].forced = (dbCache.dayLimits[userId].forced || 0) + valore;
                    } else {
                        if (!dbCache.forcedLimits) dbCache.forcedLimits = {};
                        dbCache.forcedLimits[userId] = (dbCache.forcedLimits[userId] || 0) + valore;
                    }
                    break;
                case 'hidden':
                    if (dbCache.currentMode === 'DAY') {
                        if (!dbCache.dayLimits) dbCache.dayLimits = {};
                        if (!dbCache.dayLimits[userId]) dbCache.dayLimits[userId] = { forced: 0, hidden: 0 };
                        dbCache.dayLimits[userId].hidden = (dbCache.dayLimits[userId].hidden || 0) + valore;
                    } else {
                        if (!dbCache.hiddenLimits) dbCache.hiddenLimits = {};
                        dbCache.hiddenLimits[userId] = (dbCache.hiddenLimits[userId] || 0) + valore;
                    }
                    break;
                default:
                    return message.reply("⛔ Tipo sconosciuto. Usa `base`, `forced`, o `hidden`.");
            }

            applyLimitsForMode();
            await saveDB();
            message.reply(`✅ Aggiunto ${valore} al contatore ${tipo} di ${mention}.`);
        }

        // ==========================================
        // ➖ !SOTTRAI (VISITE)
        // ==========================================
        if (cmd === 'sottrai' && isStaff) {
            const mention = message.mentions.members.first();
            const tipo = args[1]?.toLowerCase();
            const valore = parseInt(args[2], 10);

            if (!mention || !tipo || isNaN(valore)) {
                return message.reply("⛔ Uso: `!sottrai @utente <tipo> <numero>`\nTipi: `base`, `forced`, `hidden`");
            }

            const userId = mention.id;

            switch (tipo) {
                case 'base':
                    if (!dbCache.baseVisits) dbCache.baseVisits = {};
                    dbCache.baseVisits[userId] = Math.max((dbCache.baseVisits[userId] || 0) - valore, 0);
                    break;
                case 'forced':
                    if (dbCache.currentMode === 'DAY') {
                        if (!dbCache.dayLimits) dbCache.dayLimits = {};
                        if (!dbCache.dayLimits[userId]) dbCache.dayLimits[userId] = { forced: 0, hidden: 0 };
                        dbCache.dayLimits[userId].forced = Math.max((dbCache.dayLimits[userId].forced || 0) - valore, 0);
                    } else {
                        if (!dbCache.forcedLimits) dbCache.forcedLimits = {};
                        dbCache.forcedLimits[userId] = Math.max((dbCache.forcedLimits[userId] || 0) - valore, 0);
                    }
                    break;
                case 'hidden':
                    if (dbCache.currentMode === 'DAY') {
                        if (!dbCache.dayLimits) dbCache.dayLimits = {};
                        if (!dbCache.dayLimits[userId]) dbCache.dayLimits[userId] = { forced: 0, hidden: 0 };
                        dbCache.dayLimits[userId].hidden = Math.max((dbCache.dayLimits[userId].hidden || 0) - valore, 0);
                    } else {
                        if (!dbCache.hiddenLimits) dbCache.hiddenLimits = {};
                        dbCache.hiddenLimits[userId] = Math.max((dbCache.hiddenLimits[userId] || 0) - valore, 0);
                    }
                    break;
                default:
                    return message.reply("⛔ Tipo sconosciuto. Usa `base`, `forced`, o `hidden`.");
            }

            applyLimitsForMode();
            await saveDB();
            message.reply(`✅ Sottratto ${valore} dal contatore ${tipo} di ${mention}.`);
        }
    }); // Chiude il client.on('messageCreate'...)

    // ==========================================
    // 🔧 GESTIONE INTERAZIONI (SELECT MENU)
    // ==========================================
    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu()) return;

        // ==========================================
        // GESTIONE MENU !BUSSA
        // ==========================================
        if (interaction.customId === 'knock_select') {
            const knocker = interaction.member;
            const targetChannelId = interaction.values[0];

            const mode = dbCache.currentMode;
            if (mode !== 'DAY' && mode !== 'NIGHT') {
                return interaction.reply({ content: "⛔ Sistema non inizializzato.", ephemeral: true });
            }

            const userLimit = dbCache.maxVisits[knocker.id] || DEFAULT_MAX_VISITS;
            const used = (dbCache.playerVisits[knocker.id] || 0) + (dbCache.baseVisits[knocker.id] || 0);

            const options = [];

            // Opzioni modalità
            if (mode === 'NIGHT') {
                const forcedAvailable = dbCache.forcedVisits[knocker.id] || 0;
                const hiddenAvailable = dbCache.hiddenVisits[knocker.id] || 0;

                if (forcedAvailable > 0) {
                    options.push(
                        new StringSelectMenuOptionBuilder()
                            .setLabel("Visita Forzata")
                            .setValue("mode_forced")
                            .setDescription(`Sfonda la porta (${forcedAvailable} rimaste)`)
                    );
                }
                if (hiddenAvailable > 0) {
                    options.push(
                        new StringSelectMenuOptionBuilder()
                            .setLabel("Visita Nascosta")
                            .setValue("mode_hidden")
                            .setDescription(`Entra di nascosto (${hiddenAvailable} rimaste)`)
                    );
                }
            } else {
                // DAY mode
                const forcedAvailable = dbCache.forcedVisits[knocker.id] || 0;
                const hiddenAvailable = dbCache.hiddenVisits[knocker.id] || 0;

                if (used < userLimit) {
                    options.push(
                        new StringSelectMenuOptionBuilder()
                            .setLabel("Visita Normale")
                            .setValue("mode_normal")
                            .setDescription(`Visite: ${used}/${userLimit}`)
                    );
                }
                if (forcedAvailable > 0) {
                    options.push(
                        new StringSelectMenuOptionBuilder()
                            .setLabel("Visita Forzata")
                            .setValue("mode_forced")
                            .setDescription(`Sfonda la porta (${forcedAvailable} rimaste)`)
                    );
                }
                if (hiddenAvailable > 0) {
                    options.push(
                        new StringSelectMenuOptionBuilder()
                            .setLabel("Visita Nascosta")
                            .setValue("mode_hidden")
                            .setDescription(`Entra di nascosto (${hiddenAvailable} rimaste)`)
                    );
                }
            }

            if (options.length === 0) {
                return interaction.reply({ content: "⛔ Nessuna modalità disponibile!", ephemeral: true });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('mode_select')
                .setPlaceholder('🔍 Scegli il tipo di visita')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await interaction.update({ content: "🔍 Scegli la modalità:", components: [row] });
        }

        // ==========================================
        // GESTIONE SELEZIONE MODALITÀ
        // ==========================================
        if (interaction.customId === 'mode_select') {
            const knocker = interaction.member;
            const mode = interaction.values[0];

            const pendingKnockMessage = await interaction.channel.messages.fetch(interaction.message.id).catch(() => null);
            if (!pendingKnockMessage) {
                return interaction.reply({ content: "⛔ Errore: messaggio non trovato.", ephemeral: true });
            }

            const originalComponents = pendingKnockMessage.components;
            if (!originalComponents || originalComponents.length === 0) {
                return interaction.reply({ content: "⛔ Errore: casa non trovata.", ephemeral: true });
            }

            const firstMenu = originalComponents[0].components[0];
            if (!firstMenu || !firstMenu.options) {
                return interaction.reply({ content: "⛔ Errore: menu non trovato.", ephemeral: true });
            }

            const selectedOption = firstMenu.options.find(opt => opt.data.default === true);
            const targetChannelId = selectedOption ? selectedOption.data.value : firstMenu.options[0].data.value;

            const userLimit = dbCache.maxVisits[knocker.id] || DEFAULT_MAX_VISITS;
            const used = (dbCache.playerVisits[knocker.id] || 0) + (dbCache.baseVisits[knocker.id] || 0);

            // Verifica limiti
            if (mode === 'mode_forced') {
                const forcedAvailable = dbCache.forcedVisits[knocker.id] || 0;
                if (forcedAvailable <= 0) return interaction.reply({ content: "⛔ Finite forzate.", ephemeral: true });
                dbCache.forcedVisits[knocker.id] = forcedAvailable - 1;
            } else if (mode === 'mode_hidden') {
                const hiddenAvailable = dbCache.hiddenVisits[knocker.id] || 0;
                if (hiddenAvailable <= 0) return interaction.reply({ content: "⛔ Finite nascoste.", ephemeral: true });
                dbCache.hiddenVisits[knocker.id] = hiddenAvailable - 1;
            } else {
                if (used >= userLimit) return interaction.reply({ content: `⛔ Visite finite!`, ephemeral: true });
                dbCache.playerVisits[knocker.id] = used + 1;
            }

            await saveDB();
            await interaction.message.delete().catch(()=>{});
            // Rimuovi da dbCache.pendingKnocks e salva
            if (dbCache.pendingKnocks) {
                dbCache.pendingKnocks = dbCache.pendingKnocks.filter(id => id !== knocker.id);
                await saveDB();
            }

            // --- MODIFICA CODA ---
            if (QueueSystem) {
                console.log(`➕ [Housing] Aggiungendo ${mode} alla coda per ${knocker.user.tag}`);
                await QueueSystem.add('KNOCK', knocker.id, {
                    targetChannelId: targetChannelId,
                    mode: mode,
                    fromChannelId: interaction.channel.id
                });
                await interaction.reply({ content: "⏳ **Azione Bussa** messa in coda. Attendi...", ephemeral: true });
            } else {
                // Fallback se coda non disponibile (esecuzione immediata)
                await interaction.reply({ content: "✅ Esecuzione immediata...", ephemeral: true });
                
                const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
                const fromChannel = interaction.channel;
                
                // A. Ingressi immediati (Forzata/Nascosta)
                if (mode === 'mode_forced') {
                    const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(', ');
                    await enterHouse(knocker, fromChannel, targetChannel, `${roleMentions}, ${knocker} ha sfondato la porta ed è entrato`, false);
                    return;
                } 
                if (mode === 'mode_hidden') {
                    await enterHouse(knocker, fromChannel, targetChannel, "", true);
                    return;
                }

                // B. Visita Normale -> TOC TOC
                const membersWithAccess = targetChannel.members.filter(m => 
                    !m.user.bot && m.id !== knocker.id && m.roles.cache.hasAny(...RUOLI_PERMESSI)
                );

                // Se vuota, entra subito
                if (membersWithAccess.size === 0) {
                    await enterHouse(knocker, fromChannel, targetChannel, `👋 ${knocker} è entrato.`, false);
                    return;
                }

                // Se c'è gente, invia il messaggio TOC TOC
                const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(' ');
                const msg = await targetChannel.send(`🔔 **TOC TOC!** ${roleMentions}\nQualcuno sta bussando\n✅ = Apri | ❌ = Rifiuta`);
                await msg.react('✅'); 
                await msg.react('❌');

                const filter = (reaction, user) => 
                    ['✅', '❌'].includes(reaction.emoji.name) && 
                    membersWithAccess.has(user.id);
                
                const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

                collector.on('collect', async (reaction, user) => {
                    if (reaction.emoji.name === '✅') {
                        await msg.reply(`✅ Qualcuno ha aperto.`);
                        await enterHouse(knocker, fromChannel, targetChannel, `👋 ${knocker} è entrato.`, false);
                    } else {
                        const currentRefused = dbCache.playerVisits[knocker.id] || 0;
                        dbCache.playerVisits[knocker.id] = currentRefused + 1;
                        await saveDB();

                        await msg.reply(`❌ Qualcuno ha rifiutato.`);

                        const presentPlayers = targetChannel.members
                            .filter(m => !m.user.bot && m.id !== knocker.id && !m.permissions.has(PermissionsBitField.Flags.Administrator))
                            .map(m => m.displayName)
                            .join(', ');

                        if (fromChannel) {
                            await fromChannel.send(`⛔ ${knocker}, entrata rifiutata. I giocatori presenti in quella casa sono: ${presentPlayers || 'Nessuno'}`);
                        }
                    }
                });

                collector.on('end', async collected => {
                    if (collected.size === 0) {
                        await msg.reply('⏳ Nessuno ha risposto. La porta viene forzata.');
                        await enterHouse(knocker, fromChannel, targetChannel, `👋 ${knocker} è entrato.`, false);
                    }
                });
            }
        } // ← AGGIUNTA QUESTA PARENTESI GRAFFA MANCANTE

        // ==========================================
        // GESTIONE MENU !RIMUOVI
        // ==========================================
        if (interaction.customId === 'remove_action_select') {
            const action = interaction.values[0];
            
            if (action === 'remove_selecting') {
                // Rimuovi da pendingKnocks
                if (dbCache.pendingKnocks) {
                    dbCache.pendingKnocks = dbCache.pendingKnocks.filter(id => id !== interaction.user.id);
                    await saveDB();
                }
                await interaction.update({ 
                    content: '✅ Selezione casa annullata!', 
                    components: [] 
                });
                setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
                return;
            }
            
            if (action === 'remove_knock') {
                if (QueueModel) {
                    const removed = await QueueModel.findOneAndDelete({
                        type: 'KNOCK',
                        userId: interaction.user.id,
                        status: 'PENDING'
                    });
                    
                    if (removed) {
                        if (QueueSystem) QueueSystem.process();
                        await interaction.update({ 
                            content: '✅ Bussa rimosso dalla coda!', 
                            components: [] 
                        });
                        setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
                        return;
                    }
                }
                await interaction.update({ 
                    content: '❌ Errore nella rimozione.', 
                    components: [] 
                });
                return;
            }
            
            if (action === 'remove_return') {
                if (QueueModel) {
                    const removed = await QueueModel.findOneAndDelete({
                        type: 'RETURN',
                        userId: interaction.user.id,
                        status: 'PENDING'
                    });
                    
                    if (removed) {
                        if (QueueSystem) QueueSystem.process();
                        await interaction.update({ 
                            content: '✅ Torna rimosso dalla coda!', 
                            components: [] 
                        });
                        setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
                        return;
                    }
                }
                await interaction.update({ 
                    content: '❌ Errore nella rimozione.', 
                    components: [] 
                });
                return;
            }
            
            if (action === 'remove_ability') {
                if (QueueModel) {
                    const removed = await QueueModel.findOneAndDelete({
                        type: 'ABILITY',
                        userId: interaction.user.id,
                        status: 'PENDING'
                    });
                    
                    if (removed) {
                        // Aggiorna DB abilità
                        if (AbilityModel && removed.details && removed.details.mongoId) {
                            await AbilityModel.findByIdAndUpdate(
                                removed.details.mongoId,
                                { status: 'CANCELLED' }
                            );
                        }
                        
                        if (QueueSystem) QueueSystem.process();
                        await interaction.update({ 
                            content: '✅ Abilità rimossa dalla coda!', 
                            components: [] 
                        });
                        setTimeout(() => interaction.message.delete().catch(() => {}), 5000);
                        return;
                    }
                }
                await interaction.update({ 
                    content: '❌ Errore nella rimozione.', 
                    components: [] 
                });
                return;
            }
        }
    }); // Chiude il client.on('interactionCreate'...)

    // Restituisci la funzione esecutore alla coda
    return executeHousingAction;
};
