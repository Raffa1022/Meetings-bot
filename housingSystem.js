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
// RUOLI SPECIFICI PER LOGICA SPONSOR
const ID_RUOLO_ALIVE = '1460741403331268661'; // @IDruolo1 - giocatore alive
const ID_RUOLO_SPONSOR = '1460741404497019002'; // @IDruolo2 - sponsor
const ID_RUOLO_DEAD = '1460741405722022151'; // @IDruolo3 - giocatore dead

let AbilityModel = null;
let dbCache = {}; 
let HousingModel = null;
let QueueSystem = null;
let QueueModel = null; // ← AGGIUNTO per accedere al DB della coda
let clientRef = null;
// pendingKnocks ora è dentro dbCache.pendingKnocks (array su MongoDB)
// privateChatLocks: traccia le chat private con azioni in corso
// Struttura: { channelId: { locked: true, userId: 'xxx', actionType: 'KNOCK|RETURN' } }

// ==========================================
// 🔧 HELPER: Fetch fresco case dal server
// ==========================================
async function getAllHouses(guild) {
    try {
        // Forza fetch di TUTTI i canali dal server Discord
        await guild.channels.fetch();
        
        // Filtra solo le case
        const houses = guild.channels.cache
            .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
            .sort((a, b) => a.rawPosition - b.rawPosition);
        
        console.log(`🏘️ [Housing] Fetched ${houses.size} case dal server`);
        return houses;
        
    } catch (error) {
        console.error("❌ [Housing] Errore fetch case:", error);
        // Fallback sulla cache se fetch fallisce
        return guild.channels.cache
            .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
            .sort((a, b) => a.rawPosition - b.rawPosition);
    }
}

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
        
        // Inizializza privateChatLocks se non esiste
        if (!dbCache.privateChatLocks) {
            dbCache.privateChatLocks = {};
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
// 🔒 FUNZIONI LOCK CHAT PRIVATA
// ==========================================

/**
 * Imposta il lock su una chat privata
 * @param {string} channelId - ID del canale chat privata
 * @param {string} userId - ID dell'utente che sta eseguendo l'azione
 * @param {string} actionType - Tipo di azione (KNOCK o RETURN)
 */
async function lockPrivateChat(channelId, userId, actionType) {
    if (!dbCache.privateChatLocks) dbCache.privateChatLocks = {};
    dbCache.privateChatLocks[channelId] = {
        locked: true,
        userId: userId,
        actionType: actionType,
        timestamp: Date.now()
    };
    await saveDB();
    console.log(`🔒 [Housing] Chat ${channelId} bloccata per ${actionType} di ${userId}`);
}

/**
 * Rimuove il lock da una chat privata
 * @param {string} channelId - ID del canale chat privata
 */
async function unlockPrivateChat(channelId) {
    if (!dbCache.privateChatLocks) dbCache.privateChatLocks = {};
    if (dbCache.privateChatLocks[channelId]) {
        delete dbCache.privateChatLocks[channelId];
        await saveDB();
        console.log(`🔓 [Housing] Chat ${channelId} sbloccata`);
    }
}

/**
 * Verifica se una chat privata è bloccata
 * @param {string} channelId - ID del canale chat privata
 * @returns {Object|null} Oggetto con info del lock se bloccato, null altrimenti
 */
function isPrivateChatLocked(channelId) {
    if (!dbCache.privateChatLocks) return null;
    return dbCache.privateChatLocks[channelId] || null;
}

// ==========================================
// 🤝 FUNZIONE SPONSOR: Trova sponsor da spostare
// ==========================================
/**
 * Trova gli sponsor (@IDruolo2) nella stessa chat privata di un giocatore alive/dead (@IDruolo1 o @IDruolo3)
 * @param {GuildMember} player - Il giocatore principale (deve avere @IDruolo1 o @IDruolo3)
 * @param {Guild} guild - Il server Discord
 * @returns {Array<GuildMember>} - Array di sponsor da spostare insieme al player
 */
function getSponsorsToMove(player, guild) {
    // Verifica che il player sia un giocatore alive (@IDruolo1) o dead (@IDruolo3)
    if (!player.roles.cache.has(ID_RUOLO_ALIVE) && !player.roles.cache.has(ID_RUOLO_DEAD)) {
        return []; // Non è né alive né dead, nessuno sponsor da spostare
    }
    
    // Trova il canale chat privata in cui si trova il player
    const privateChannel = guild.channels.cache.find(c => 
        c.parentId === ID_CATEGORIA_CHAT_PRIVATE && 
        c.type === ChannelType.GuildText &&
        c.permissionsFor(player).has(PermissionsBitField.Flags.ViewChannel)
    );
    
    if (!privateChannel) {
        return []; // Non è in una chat privata
    }
    
    // Trova tutti i membri della chat privata che hanno il ruolo sponsor (@IDruolo2)
    const sponsors = [];
    privateChannel.members.forEach(member => {
        if (member.id !== player.id && // Non il player stesso
            !member.user.bot && // Non bot
            member.roles.cache.has(ID_RUOLO_SPONSOR)) { // Ha ruolo sponsor
            sponsors.push(member);
        }
    });
    
    return sponsors;
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
                // Cerca il messaggio che menziona questo utente specifico
                // Può essere: "🔑 **@User**, questa è la tua dimora privata." (proprietario)
                // Oppure: "🔑 @User, dimora assegnata (Comproprietario)." (comproprietario)
                const keyMsg = pinnedMessages.find(m => 
                    (m.content.includes("questa è la tua dimora privata") || m.content.includes("dimora assegnata")) &&
                    m.content.includes(`<@${userId}>`)
                );
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
    // MODIFICA 1: Rimosso il conteggio visite qui (fix visite doppie)
    await movePlayer(member, fromChannel, toChannel, entryMessage, isSilent);
}

async function movePlayer(member, oldChannel, newChannel, entryMessage, isSilent) {
    if (!member || !newChannel) return;

    // 🤝 LOGICA SPONSOR: Se il member è un alive, trova i suoi sponsor da spostare
    const sponsors = getSponsorsToMove(member, member.guild);

    let channelToLeave = oldChannel;
    
    // Se arriva da chat privata, cerca la casa attuale
    if (oldChannel && oldChannel.parentId === ID_CATEGORIA_CHAT_PRIVATE) {
        const currentHouse = oldChannel.guild.channels.cache.find(c => 
            c.parentId === ID_CATEGORIA_CASE && 
            c.permissionsFor(member).has(PermissionsBitField.Flags.ViewChannel) &&
            c.permissionOverwrites.cache.has(member.id) 
        );
        if (currentHouse) channelToLeave = currentHouse;
    }

    // Gestione uscita dal vecchio canale
    if (channelToLeave && channelToLeave.id !== newChannel.id) {
        if (channelToLeave.parentId === ID_CATEGORIA_CASE) {
            // Verifica se l'utente è VERAMENTE dentro (ha permessi personalizzati) o è solo spettatore
            const hasPersonalPermissions = channelToLeave.permissionOverwrites.cache.has(member.id);
            
            // Invia messaggio di uscita SOLO se ha permessi personalizzati (è entrato fisicamente)
            if (hasPersonalPermissions) {
                const prevMode = dbCache.playerModes ? dbCache.playerModes[member.id] : null;
                if (prevMode !== 'HIDDEN') {
                    await channelToLeave.send(`🚪 ${member} è uscito.`);
                }

                // MODIFICA 2: Gestione uscita Casa Pubblica
                // Rimuovi sempre i permessi personalizzati quando esci
                // Se è pubblica, l'utente continuerà a vedere tramite ruolo pubblico (senza permessi personalizzati)
                // Se è privata, l'utente perde completamente l'accesso
                // Questo permette alle case pubbliche di rimanere visibili nel menu di selezione
                await channelToLeave.permissionOverwrites.delete(member.id).catch(() => {});
            }
            // Se non ha permessi personalizzati, è solo spettatore → non fare nulla
            
            // 🤝 Rimuovi anche i permessi degli sponsor dalla vecchia casa
            for (const sponsor of sponsors) {
                if (channelToLeave.permissionOverwrites.cache.has(sponsor.id)) {
                    await channelToLeave.permissionOverwrites.delete(sponsor.id).catch(() => {});
                }
            }
        }
    }

    // Ingresso nel nuovo canale del PLAYER PRINCIPALE
   await newChannel.permissionOverwrites.create(member.id, { 
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true 
    });
    
    if (!dbCache.playerModes) dbCache.playerModes = {};
    dbCache.playerModes[member.id] = isSilent ? 'HIDDEN' : 'NORMAL';
    
    // 🤝 Sposta anche gli SPONSOR nella nuova casa (SENZA narrazioni)
    for (const sponsor of sponsors) {
        await newChannel.permissionOverwrites.create(sponsor.id, { 
            ViewChannel: true, SendMessages: true, ReadMessageHistory: true 
        });
        // Imposta anche la modalità degli sponsor
        dbCache.playerModes[sponsor.id] = isSilent ? 'HIDDEN' : 'NORMAL';
    }
    
    await saveDB();

    // Narrazione SOLO per il player principale
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
        console.warn(`⚠️ [Housing] Membro ${queueItem.userId} non trovato.`);
        return;
    }

    // 1️⃣ GESTIONE "TORNA"
    if (queueItem.type === 'RETURN') {
        const homeId = dbCache.playerHomes[member.id];
        if (homeId && !dbCache.destroyedHouses.includes(homeId)) {
            const homeChannel = guild.channels.cache.get(homeId);
            const currentChannel = guild.channels.cache.get(queueItem.details.fromChannelId);
            if (homeChannel) {
                await movePlayer(member, currentChannel, homeChannel, `🏠 ${member.user.tag} è ritornato.`, false);
                console.log(`✅ [Housing] ${member.user.tag} è tornato a casa.`);
            }
        }
        
        // 🔓 SBLOCCA la chat privata
        await unlockPrivateChat(queueItem.details.fromChannelId);
        return; 
    }

    // 2️⃣ GESTIONE "BUSSA"
    if (queueItem.type === 'KNOCK') {
        const { targetChannelId, mode, fromChannelId } = queueItem.details;
        const targetChannel = guild.channels.cache.get(targetChannelId);
        const fromChannel = guild.channels.cache.get(fromChannelId);
        
        if (!targetChannel || !fromChannel) {
            console.error("❌ [Housing] Canali non trovati per KNOCK.");
            return;
        }

        // A. Ingressi immediati (Forzata/Nascosta)
        if (mode === 'mode_forced') {
            const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(', ');
            await enterHouse(member, fromChannel, targetChannel, `${roleMentions}, ${member} ha sfondato la porta ed è entrato`, false);
            console.log(`✅ [Housing] ${member.user.tag} ha sfondato la porta.`);
            
            // 🔓 SBLOCCA la chat privata
            await unlockPrivateChat(fromChannelId);
            return;
        } 
        if (mode === 'mode_hidden') {
            await enterHouse(member, fromChannel, targetChannel, "", true);
            console.log(`✅ [Housing] ${member.user.tag} è entrato nascosto.`);
            
            // 🔓 SBLOCCA la chat privata
            await unlockPrivateChat(fromChannelId);
            return;
        }

        // B. Visita Normale -> TOC TOC
        // Funzione helper per contare chi c'è dentro FISICAMENTE (ha permessi personalizzati)
        const getOccupants = () => {
            // In una casa pubblica, tutti vedono il canale tramite ruolo
            // Ma solo chi è FISICAMENTE dentro ha permessi personalizzati
            const physicallyInside = [];
            targetChannel.permissionOverwrites.cache.forEach((overwrite, id) => {
                // Salta ruoli, considera solo utenti
                if (overwrite.type === 1) { // Type 1 = Member
                    const m = targetChannel.members.get(id);
                    if (m && !m.user.bot && m.id !== member.id && m.roles.cache.hasAny(...RUOLI_PERMESSI)) {
                        physicallyInside.push(m);
                    }
                }
            });
            return new Map(physicallyInside.map(m => [m.id, m]));
        };

        const membersWithAccess = getOccupants();

        // Se vuota, entra subito
        if (membersWithAccess.size === 0) {
            await enterHouse(member, fromChannel, targetChannel, `👋 ${member} è entrato.`, false);
            console.log(`✅ [Housing] ${member.user.tag} è entrato (casa vuota).`);
            
            // 🔓 SBLOCCA la chat privata
            await unlockPrivateChat(fromChannelId);
            return;
        }

        // Se c'è gente, invia il messaggio TOC TOC
        const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(' ');
        const msg = await targetChannel.send(`🔔 **TOC TOC!** ${roleMentions}\nQualcuno sta bussando\n✅ = Apri | ❌ = Rifiuta`);
        await msg.react('✅'); 
        await msg.react('❌');
        console.log(`🔔 [Housing] ${member.user.tag} sta bussando...`);

        const filter = (reaction, user) => 
            ['✅', '❌'].includes(reaction.emoji.name) && 
            getOccupants().has(user.id); // Usa la funzione dinamica
        
        const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

        // --- MONITORAGGIO PRESENZE (AGGIUNTO) ---
        const monitorInterval = setInterval(() => {
            const currentOccupants = getOccupants();
            if (currentOccupants.size === 0) {
                collector.stop('everyone_left');
            }
        }, 2000); 

        collector.on('collect', async (reaction, user) => {
            clearInterval(monitorInterval);

            if (reaction.emoji.name === '✅') {
                // ACCETTATO
                await msg.reply(`✅ Qualcuno ha aperto.`);
                await enterHouse(member, fromChannel, targetChannel, `👋 ${member} è entrato.`, false);
                console.log(`✅ [Housing] ${member.user.tag} è stato fatto entrare.`);
                
                // 🔓 SBLOCCA la chat privata
                await unlockPrivateChat(fromChannelId);
            } else {
                // RIFIUTATO - la visita è già stata contata quando aggiunta alla coda
                await msg.reply(`❌ Qualcuno ha rifiutato.`);

                // Lista presenti FISICAMENTE (con permessi personalizzati, non solo spettatori)
                const presentPlayers = [];
                targetChannel.permissionOverwrites.cache.forEach((overwrite, id) => {
                    if (overwrite.type === 1) { // Type 1 = Member (non ruolo)
                        const m = targetChannel.members.get(id);
                        if (m && !m.user.bot && m.id !== member.id && !m.permissions.has(PermissionsBitField.Flags.Administrator)) {
                            presentPlayers.push(m.displayName);
                        }
                    }
                });

                if (fromChannel) {
                    await fromChannel.send(`⛔ ${member}, entrata rifiutata. I giocatori presenti in quella casa sono: ${presentPlayers.join(', ') || 'Nessuno'}`);
                }
                console.log(`❌ [Housing] ${member.user.tag} è stato rifiutato.`);
                
                // 🔓 SBLOCCA la chat privata
                await unlockPrivateChat(fromChannelId);
            }
        });

        collector.on('end', async (collected, reason) => {
            clearInterval(monitorInterval);

            // CASO: TUTTI SONO USCITI
            if (reason === 'everyone_left') {
                await msg.reply(`🚪 La casa si è svuotata.`);
                await enterHouse(member, fromChannel, targetChannel, `👋 ${member} è entrato (casa libera).`, false);
                console.log(`✅ [Housing] ${member.user.tag} è entrato (tutti usciti).`);
                
                // 🔓 SBLOCCA la chat privata
                await unlockPrivateChat(fromChannelId);
            }
            // CASO: Timeout classico
            else if (collected.size === 0 && reason !== 'limit') {
                await msg.reply('⏳ Nessuno ha risposto. La porta viene forzata.');
                await enterHouse(member, fromChannel, targetChannel, `👋 ${member} è entrato.`, false);
                console.log(`✅ [Housing] ${member.user.tag} è entrato (timeout).`);
                
                // 🔓 SBLOCCA la chat privata
                await unlockPrivateChat(fromChannelId);
            }
        });
    }
}
 module.exports = async (client, Model, QueueSys, QueueModelRef, AbilityModelRef) => {
    clientRef = client;
    HousingModel = Model;
    QueueSystem = QueueSys;
    QueueModel = QueueModelRef;    // ← AGGIUNGI
    AbilityModel = AbilityModelRef; // ← AGGIUNGI
    
    console.log(`🔧 [Housing] QueueSystem ricevuto:`, QueueSystem ? '✅ ATTIVO' : '❌ NON DISPONIBILE');
    if (QueueSystem) {
        console.log(`🔧 [Housing] QueueSystem.add disponibile:`, typeof QueueSystem.add === 'function' ? '✅ SÌ' : '❌ NO');
    }
    
    await loadDB();

    const today = new Date().toDateString();
    if (dbCache.lastReset !== today) {
        applyLimitsForMode();
        dbCache.lastReset = today;
        await saveDB();
        console.log("🔄 [Housing] Contatori ripristinati per nuovo giorno.");
    }

    client.on('messageCreate', async message => {
        if (message.author.bot || !message.content.startsWith(PREFIX)) return;

        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // ---------------------------------------------------------
        // 👮 COMANDI ADMIN
        // ---------------------------------------------------------

        if (command === 'assegnacasa') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            const targetUser = message.mentions.members.first();
            const targetChannel = message.mentions.channels.first();
            if (!targetUser || !targetChannel) return message.reply("❌ Uso: `!assegnacasa @Utente #canale`");

            dbCache.playerHomes[targetUser.id] = targetChannel.id;
            await saveDB();

            await targetChannel.permissionOverwrites.set([
                { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: targetUser.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels] }
            ]);
            message.reply(`✅ Casa assegnata a ${targetUser}.`);
            const pinnedMsg = await targetChannel.send(`🔑 **${targetUser}**, questa è la tua dimora privata.`);
            await pinnedMsg.pin();
        }

        if (command === 'visite') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            const targetUser = message.mentions.members.first();
            const baseInput = parseInt(args[1]);
            const forcedInput = parseInt(args[2]);
            const hiddenInput = parseInt(args[3]);

            if (!targetUser || isNaN(baseInput) || isNaN(forcedInput) || isNaN(hiddenInput)) return message.reply("❌ Uso: `!visite @Utente [Base] [Forzate] [Nascoste]`");

            if (!dbCache.baseVisits) dbCache.baseVisits = {};
            if (!dbCache.forcedLimits) dbCache.forcedLimits = {};
            if (!dbCache.hiddenLimits) dbCache.hiddenLimits = {};

            dbCache.baseVisits[targetUser.id] = baseInput;
            dbCache.forcedLimits[targetUser.id] = forcedInput;
            dbCache.hiddenLimits[targetUser.id] = hiddenInput;

            if (dbCache.currentMode === 'NIGHT') {
                dbCache.forcedVisits[targetUser.id] = forcedInput;
                dbCache.hiddenVisits[targetUser.id] = hiddenInput;
            }
            await saveDB();
            message.reply(`✅ Configurazione Notte/Standard salvata per ${targetUser}.`);
        }
        
        if (command === 'aggiunta') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const isDayAdd = args[0].toLowerCase() === 'giorno';
            const typeIndex = isDayAdd ? 1 : 0;
            const userIndex = isDayAdd ? 2 : 1;
            const amountIndex = isDayAdd ? 3 : 2;

            const type = args[typeIndex] ? args[typeIndex].toLowerCase() : null;
            const targetUser = message.mentions.members.first();
            const amount = parseInt(args[amountIndex]);

            if (!type || !targetUser || isNaN(amount) || !['base', 'nascosta', 'forzata'].includes(type)) {
                return message.reply(`❌ Uso:\n\`!aggiunta base/nascosta/forzata @Utente Num\`\n\`!aggiunta giorno base/nascosta/forzata @Utente Num\``);
            }
            
            if (isDayAdd) {
                if (!dbCache.extraVisitsDay) dbCache.extraVisitsDay = {};
                if (type === 'base') dbCache.extraVisitsDay[targetUser.id] = (dbCache.extraVisitsDay[targetUser.id] || 0) + amount;
                else if (type === 'nascosta') {
                    if (dbCache.currentMode === 'DAY') dbCache.hiddenVisits[targetUser.id] = (dbCache.hiddenVisits[targetUser.id] || 0) + amount;
                    else return message.reply("⚠ Puoi aggiungere visite Giorno solo se è attiva la modalità Giorno.");
                }
                else if (type === 'forzata') {
                    if (dbCache.currentMode === 'DAY') dbCache.forcedVisits[targetUser.id] = (dbCache.forcedVisits[targetUser.id] || 0) + amount;
                    else return message.reply("⚠ Puoi aggiungere visite Giorno solo se è attiva la modalità Giorno.");
                }
                message.reply(`✅ Aggiunte visite (GIORNO) a ${targetUser}.`);
            } else {
                if (!dbCache.extraVisits) dbCache.extraVisits = {};
                if (type === 'base') dbCache.extraVisits[targetUser.id] = (dbCache.extraVisits[targetUser.id] || 0) + amount;
                else if (type === 'nascosta') {
                    if (dbCache.currentMode === 'NIGHT') dbCache.hiddenVisits[targetUser.id] = (dbCache.hiddenVisits[targetUser.id] || 0) + amount;
                    else return message.reply("⚠ Puoi aggiungere visite Standard solo se è attiva la modalità Standard/Visite.");
                }
                else if (type === 'forzata') {
                    if (dbCache.currentMode === 'NIGHT') dbCache.forcedVisits[targetUser.id] = (dbCache.forcedVisits[targetUser.id] || 0) + amount;
                    else return message.reply("⚠ Puoi aggiungere visite Standard solo se è attiva la modalità Standard/Visite.");
                }
                message.reply(`✅ Aggiunte visite (STANDARD) a ${targetUser}.`);
            }
            await saveDB();
        }

        if (command === 'resetvisite') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            dbCache.extraVisits = {};      
            dbCache.extraVisitsDay = {};   
            dbCache.playerVisits = {};
            applyLimitsForMode();
            
            await saveDB();
            message.reply("♻️ **RESET GLOBALE COMPLETATO**");
            
}
                if (command === 'sblocca') {
            // Svuota la lista di chi sta bussando
            dbCache.pendingKnocks = [];
            await saveDB();
            message.reply("✅ **Sblocco effettuato!** Tutte le selezioni 'Bussa' pendenti sono state cancellate. Riprova ora.");
                    
}
        if (command === 'notte') {
             if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
             const numero = args[0];
             if (!numero) return message.reply("❌ Specifica numero notte.");

             dbCache.currentMode = 'NIGHT';
             applyLimitsForMode();
             await saveDB();

             const testoAnnuncio = `🌑 **NOTTE ${numero} HA INIZIO**`;
             const annunciChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
             if (annunciChannel) {
                 await annunciChannel.send({ content: `<@&${ID_RUOLO_NOTIFICA_1}> <@&${ID_RUOLO_NOTIFICA_2}>\n${testoAnnuncio}`, files: [GIF_NOTTE_START] });
             }
             
            const categoriaDiurna = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_DIURNA);
            if (categoriaDiurna) {
                const canaliDiurni = categoriaDiurna.children.cache.filter(c => c.type === ChannelType.GuildText);
                const ruoliDaBloccare = [ID_RUOLO_NOTIFICA_1, ID_RUOLO_NOTIFICA_2, ID_RUOLO_NOTIFICA_3];
                for (const [id, channel] of canaliDiurni) {
                    for (const r of ruoliDaBloccare) if (r) await channel.permissionOverwrites.edit(r, { SendMessages: false }).catch(() => {});
                }
            }
            message.reply(`✅ **Notte ${numero} avviata.**`);
        }

        if (command === 'giorno') {
             if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
             const arg1 = args[0];
             
             if (message.mentions.members.size > 0) {
                 const targetUser = message.mentions.members.first();
                 if(!dbCache.dayLimits) dbCache.dayLimits = {};
                 dbCache.dayLimits[targetUser.id] = { base: parseInt(args[1]), forced: parseInt(args[2]), hidden: parseInt(args[3]) };
                 if (dbCache.currentMode === 'DAY') {
                     dbCache.forcedVisits[targetUser.id] = parseInt(args[2]);
                     dbCache.hiddenVisits[targetUser.id] = parseInt(args[3]);
                 }
                 await saveDB();
                 return message.reply("✅ Config Giorno salvata.");
             }

             if (!arg1) return message.reply("❌ Specifica giorno.");
             
             dbCache.currentMode = 'DAY';
             applyLimitsForMode();
             await saveDB();

             const annunciChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
             if (annunciChannel) {
                 await annunciChannel.send({ content: `<@&${ID_RUOLO_NOTIFICA_1}> <@&${ID_RUOLO_NOTIFICA_2}> <@&${ID_RUOLO_NOTIFICA_3}>\n☀️ **GIORNO ${arg1}**`, files: [GIF_GIORNO_START] });
             }

             const categoriaDiurna = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_DIURNA);
             if (categoriaDiurna) {
                const canaliDiurni = categoriaDiurna.children.cache.filter(c => c.type === ChannelType.GuildText);
                const r1 = ID_RUOLO_NOTIFICA_1;
                for (const [id, channel] of canaliDiurni) {
                    if (channel.id === ID_CANALE_BLOCCO_TOTALE) { /* resta bloccato */ }
                    else if (ID_CANALI_BLOCCO_PARZIALE.includes(channel.id)) {
                         if (r1) await channel.permissionOverwrites.edit(r1, { SendMessages: true }).catch(() => {});
                    } else {
                         [ID_RUOLO_NOTIFICA_1, ID_RUOLO_NOTIFICA_2, ID_RUOLO_NOTIFICA_3].forEach(async r => {
                             if(r) await channel.permissionOverwrites.edit(r, { SendMessages: true }).catch(()=>{});
                         });
                    }
                    try { const msg = await channel.send(`☀️ **GIORNO ${arg1}**`); await msg.pin(); } catch(e){}
                }
             }
             message.reply(`✅ **Giorno ${arg1} avviato.**`);
        }

        if (command === 'distruzione') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetChannel = message.mentions.channels.first();
            if (!targetChannel || targetChannel.parentId !== ID_CATEGORIA_CASE) {
                return message.reply("❌ Devi menzionare un canale casa valido. Es: `!distruzione #canale-casa`");
            }

            if (!dbCache.destroyedHouses.includes(targetChannel.id)) {
                dbCache.destroyedHouses.push(targetChannel.id);
            }

            for (const roleId of RUOLI_PUBBLICI) {
                if (roleId) await targetChannel.permissionOverwrites.delete(roleId).catch(() => {});
            }
            await saveDB();

            const pinnedMessages = await targetChannel.messages.fetchPinned();
            const keyMsg = pinnedMessages.find(m => m.content.includes("questa è la tua dimora privata"));
            if (keyMsg) await keyMsg.delete();

            // Trova solo i giocatori FISICAMENTE presenti (con permessi personalizzati)
            const membersPhysicallyInside = [];
            targetChannel.permissionOverwrites.cache.forEach((overwrite, id) => {
                if (overwrite.type === 1) { // Type 1 = Member (non ruolo)
                    const member = targetChannel.members.get(id);
                    if (member && !member.user.bot && member.id !== message.member.id) {
                        membersPhysicallyInside.push(member);
                    }
                }
            });

            const ownerId = Object.keys(dbCache.playerHomes).find(key => dbCache.playerHomes[key] === targetChannel.id);

            for (const member of membersPhysicallyInside) {
                // Invia messaggio di uscita nella casa che viene distrutta
                const prevMode = dbCache.playerModes ? dbCache.playerModes[member.id] : null;
                if (prevMode !== 'HIDDEN') {
                    await targetChannel.send(`🚪 ${member} è uscito.`);
                }

                const isOwner = (ownerId === member.id);
                await targetChannel.permissionOverwrites.delete(member.id).catch(() => {});

                if (isOwner) {
                    const randomHouse = message.guild.channels.cache
                        .filter(c => c.parentId === ID_CATEGORIA_CASE && c.id !== targetChannel.id && !dbCache.destroyedHouses.includes(c.id))
                        .random();
                    if (randomHouse) await movePlayer(member, targetChannel, randomHouse, ` 👋 **${member}** è entrato.`, false);
              } else {
                    const homeId = dbCache.playerHomes[member.id];
                    const hasSafeHome = homeId && homeId !== targetChannel.id && !dbCache.destroyedHouses.includes(homeId);
                    
                    if (hasSafeHome) {
                        const homeChannel = message.guild.channels.cache.get(homeId);
                        if (homeChannel) await movePlayer(member, targetChannel, homeChannel, `🏠 ${member} è ritornato.`, false);
                    } else {
                        if (member.roles.cache.hasAny(...RUOLI_PERMESSI)) {
                            const randomHouse = message.guild.channels.cache
                                .filter(c => c.parentId === ID_CATEGORIA_CASE && c.id !== targetChannel.id && !dbCache.destroyedHouses.includes(c.id))
                                .random();
                            if (randomHouse) await movePlayer(member, targetChannel, randomHouse, `👋 **${member}** è entrato.`, false);
                        }
                    }
                }
            }

            message.reply(`🏚️ La casa ${targetChannel} è stata distrutta.`);
            const annunciChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunciChannel) {
                annunciChannel.send({ content: `<@&${ID_RUOLO_NOTIFICA_1}> <@&${ID_RUOLO_NOTIFICA_2}>\n🏡|${formatName(targetChannel.name)} casa è stata distrutta`, files: [GIF_DISTRUZIONE] });
            }
        }

        if (command === 'ricostruzione') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            const targetChannel = message.mentions.channels.first();
            if (!targetChannel || targetChannel.parentId !== ID_CATEGORIA_CASE) return message.reply("❌ Devi menzionare un canale casa valido.");

            dbCache.destroyedHouses = dbCache.destroyedHouses.filter(id => id !== targetChannel.id);
            const exOwners = Object.keys(dbCache.playerHomes).filter(uid => dbCache.playerHomes[uid] === targetChannel.id);
            for (const uid of exOwners) delete dbCache.playerHomes[uid];
            await saveDB();

            message.reply(`🏗️ La casa ${targetChannel} è stata ricostruita.`);
            const annunciChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunciChannel) {
                annunciChannel.send({ content: `<@&${ID_RUOLO_NOTIFICA_1}> <@&${ID_RUOLO_NOTIFICA_2}>\n:house_with_garden:|${formatName(targetChannel.name)} casa è stata ricostruita`, files: [GIF_RICOSTRUZIONE] });
            }
        }

        if (command === 'pubblico') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            if (message.channel.parentId !== ID_CATEGORIA_CASE) return message.reply("⛔ Usalo in una casa.");

            const channel = message.channel;
            if (dbCache.destroyedHouses.includes(channel.id)) return message.reply("❌ Questa casa è distrutta!");

            const isAlreadyPublic = channel.permissionOverwrites.cache.has(RUOLI_PUBBLICI[0]);
            if (isAlreadyPublic) {
                for (const roleId of RUOLI_PUBBLICI) if (roleId) await channel.permissionOverwrites.delete(roleId).catch(() => {});
                message.reply("🔒 La casa è tornata **PRIVATA**.");
            } else {
                for (const roleId of RUOLI_PUBBLICI) {
                    if (roleId) await channel.permissionOverwrites.create(roleId, { 
                        ViewChannel: true, 
                        SendMessages: false,
                        CreatePublicThreads: false,
                        CreatePrivateThreads: false,
                        AddReactions: false
                    });
                }
                const tag1 = `<@&${ID_RUOLO_NOTIFICA_1}>`;
                const tag2 = `<@&${ID_RUOLO_NOTIFICA_2}>`;
                message.channel.send(`📢 **LA CASA È ORA PUBBLICA!** ${tag1} ${tag2}`);
            }
        }

        if (command === 'sposta') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            const targetMembers = message.mentions.members.filter(m => !m.user.bot);
            const targetChannel = message.mentions.channels.first();

            if (!targetChannel || targetMembers.size === 0) return message.reply("❌ Uso: `!sposta @Utente1 @Utente2 ... #canale`");

            for (const [id, member] of targetMembers) {
                await movePlayer(member, message.channel, targetChannel, `👋 **${member}** è entrato.`, false);
            }
            message.reply(`✅ Spostati ${targetMembers.size} utenti in ${targetChannel}.`);
        }

        if (command === 'dove') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            if (!targetUser) return message.reply("❌ Uso: `!dove @Utente`");

            const locations = message.guild.channels.cache.filter(c => {
                if (c.parentId !== ID_CATEGORIA_CASE || c.type !== ChannelType.GuildText) return false;
                const overwrite = c.permissionOverwrites.cache.get(targetUser.id);
                return overwrite && overwrite.allow.has(PermissionsBitField.Flags.ViewChannel);
            });

            if (locations.size > 0) {
                const locList = locations.map(c => `🏠 ${c} (ID: ${c.id})`).join('\n');
                let warning = locations.size > 1 ? "\n\n⚠️ **ATTENZIONE:** Utente in più case!" : "";
                message.reply(`📍 **${targetUser.displayName}** si trova in:\n${locList}${warning}`);
            } else {
                message.reply(`❌ **${targetUser.displayName}** non è in nessuna casa.`);
            }
        }

        if (command === 'multipla') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            const targetUser = message.mentions.members.first();
            if (!targetUser) return message.reply("❌ Uso: `!multipla @Utente #casa1 si narra #casa2 no ...`");

            if (!dbCache.multiplaHistory) dbCache.multiplaHistory = {};
            if (!dbCache.multiplaHistory[targetUser.id]) dbCache.multiplaHistory[targetUser.id] = [];

            const rawArgs = message.content.slice(PREFIX.length + command.length).trim().split(/ +/);
            let currentWrite = false; 
            let currentNarra = false;
            let actions = [];

            for (const arg of rawArgs) {
                if (arg.includes(targetUser.id)) continue;
                let stateChanged = false;

                if (arg.toLowerCase() === 'si') { currentWrite = true; stateChanged = true; }
                else if (arg.toLowerCase() === 'no') { currentWrite = false; stateChanged = true; }
                else if (arg.toLowerCase() === 'narra') { currentNarra = true; stateChanged = true; }
                else if (arg.toLowerCase() === 'muto') { currentNarra = false; stateChanged = true; }

                if (stateChanged && actions.length > 0) {
                    actions[actions.length - 1].write = currentWrite;
                    actions[actions.length - 1].narra = currentNarra;
                    continue;
                }

                if (arg.match(/^<#(\d+)>$/)) {
                    const channelId = arg.replace(/\D/g, '');
                    const channel = message.guild.channels.cache.get(channelId);
                    if (channel && channel.parentId === ID_CATEGORIA_CASE) {
                        actions.push({ channel: channel, write: currentWrite, narra: currentNarra });
                    }
                }
            }

            let processedCount = 0;
            for (const action of actions) {
                if (!dbCache.multiplaHistory[targetUser.id].includes(action.channel.id)) {
                    dbCache.multiplaHistory[targetUser.id].push(action.channel.id);
                }
                await action.channel.permissionOverwrites.create(targetUser.id, {
                    ViewChannel: true, SendMessages: action.write, AddReactions: action.write, ReadMessageHistory: true
                });
                if (action.narra) await action.channel.send(`👋 **${targetUser.displayName}** è entrato.`);
                processedCount++;
            }
            await saveDB();
            message.reply(`✅ Applicate impostazioni a **${processedCount}** case per ${targetUser}.`);
        }

        if (command === 'ritirata') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetUser = message.mentions.members.first();
            if (!targetUser) return message.reply("❌ Uso: `!ritirata @Utente #casa1 narra ... [si/no]`");

            const rawArgs = message.content.slice(PREFIX.length + command.length).trim().split(/ +/);
            let currentNarra = false;
            let currentWrite = null; 
            let removalActions = [];
            
            for (const arg of rawArgs) {
                if (arg.includes(targetUser.id)) continue;
                let stateChanged = false;
                if (arg.toLowerCase() === 'narra') { currentNarra = true; stateChanged = true; }
                else if (arg.toLowerCase() === 'muto') { currentNarra = false; stateChanged = true; }
                else if (arg.toLowerCase() === 'si') { currentWrite = true; } 
                else if (arg.toLowerCase() === 'no') { currentWrite = false; } 

                if (stateChanged && removalActions.length > 0) {
                    removalActions[removalActions.length - 1].narra = currentNarra;
                    continue;
                }

                if (arg.match(/^<#(\d+)>$/)) {
                    const channelId = arg.replace(/\D/g, '');
                    const channel = message.guild.channels.cache.get(channelId);
                    if (channel) removalActions.push({ channel: channel, narra: currentNarra });
                }
            }

            let removedCount = 0;
            let channelsRemovedIds = [];
            for (const action of removalActions) {
                if (action.narra) await action.channel.send(`🚪 **${targetUser.displayName}** è uscito.`);
                await action.channel.permissionOverwrites.delete(targetUser.id).catch(() => {});
                channelsRemovedIds.push(action.channel.id);
                removedCount++;
            }

            if(!dbCache.multiplaHistory) dbCache.multiplaHistory = {};
            let history = dbCache.multiplaHistory[targetUser.id] || [];
            history = history.filter(hid => !channelsRemovedIds.includes(hid));
            dbCache.multiplaHistory[targetUser.id] = history;

            if (currentWrite !== null) {
                for (const hid of history) {
                    const ch = message.guild.channels.cache.get(hid);
                    if (ch) {
                        await ch.permissionOverwrites.create(targetUser.id, {
                            ViewChannel: true, SendMessages: currentWrite, AddReactions: currentWrite, ReadMessageHistory: true
                        });
                    }
                }
                const statusText = currentWrite ? "SCRITTURA (SI)" : "LETTURA (NO)";
                message.reply(`✅ Rimossi ${removedCount} canali. Restanti aggiornati a: **${statusText}**.`);
            } else {
                message.reply(`✅ Rimossi ${removedCount} canali.`);
            }
            await saveDB();
        }
       // ---------------------------------------------------------
        // 🔄 COMANDO CAMBIO IDENTITÀ
        // ---------------------------------------------------------
        if (command === 'cambio') {
            // 1. Controllo Canale (Solo Categoria Chat Private)
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return;

            // 2. Definizione Ruoli da scambiare
            const R1 = ID_RUOLO_NOTIFICA_1; // Ruolo 1
            const R2 = ID_RUOLO_NOTIFICA_2; // Ruolo 2

            // 3. Controllo Permessi Esecutore
            const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
            const hasRole1 = message.member.roles.cache.has(R1);
            const hasRole2 = message.member.roles.cache.has(R2);

            if (!isAdmin && !hasRole1 && !hasRole2) return message.reply("⛔ Non hai i permessi per usare questo comando.");

            // 4. Identificazione dei due giocatori nel canale
            // Cerchiamo nel canale membri che non siano bot e abbiano uno dei due ruoli
            const membersInChannel = message.channel.members.filter(m => !m.user.bot);
            const player1 = membersInChannel.find(m => m.roles.cache.has(R1));
            const player2 = membersInChannel.find(m => m.roles.cache.has(R2));

            if (!player1 || !player2) {
                return message.reply("❌ Errore: Non trovo entrambi i giocatori con i ruoli necessari in questa chat per effettuare lo scambio.");
            }

            // Se chi digita non è admin, deve essere uno dei due coinvolti
            if (!isAdmin && message.member.id !== player1.id && message.member.id !== player2.id) {
                return message.reply("⛔ Non sei coinvolto in questo scambio.");
            }

            // 🆕 LOGICA DI ACCETTAZIONE
            // Se è @IDruolo2 (sponsor) a fare il cambio, @IDruolo1 deve accettare
            // Se è @IDruolo1 o admin, lo scambio avviene immediatamente
            
            if (message.member.id === player2.id && !isAdmin) {
                // Lo sponsor ha richiesto il cambio - serve accettazione di player1
                const requestMsg = await message.channel.send(`🔄 **${player2}** ha richiesto lo scambio identità.\n${player1}, reagisci con ✅ per accettare o ❌ per rifiutare.`);
                await requestMsg.react('✅');
                await requestMsg.react('❌');
                
                const filter = (reaction, user) => {
                    return ['✅', '❌'].includes(reaction.emoji.name) && user.id === player1.id;
                };
                
                const collector = requestMsg.createReactionCollector({ filter, max: 1 });
                
                collector.on('collect', async (reaction) => {
                    if (reaction.emoji.name === '❌') {
                        await requestMsg.edit(`${requestMsg.content}\n\n❌ **Scambio rifiutato da ${player1}.**`);
                        setTimeout(() => requestMsg.delete().catch(() => {}), 10000);
                        return;
                    }
                    
                    // Accettato - procedi con lo scambio
                    await requestMsg.edit(`${requestMsg.content}\n\n✅ **Scambio accettato! Procedura in corso...**`);
                    
                    // 🛑 CONTROLLO: Se l'ex main player (@IDruolo1 che sta per diventare @IDruolo2) ha comandi pendenti, cancellarli
                    if (QueueModel) {
                        const pendingCommands = await QueueModel.find({
                            userId: player1.id,
                            status: 'PENDING',
                            type: { $in: ['KNOCK', 'RETURN'] }
                        });
                        
                        if (pendingCommands.length > 0) {
                            await QueueModel.deleteMany({
                                userId: player1.id,
                                status: 'PENDING',
                                type: { $in: ['KNOCK', 'RETURN'] }
                            });
                            
                            // Rimuovi da pendingKnocks se presente
                            if (dbCache.pendingKnocks && dbCache.pendingKnocks.includes(player1.id)) {
                                dbCache.pendingKnocks = dbCache.pendingKnocks.filter(id => id !== player1.id);
                                await saveDB();
                            }
                            
                            await message.channel.send(`⚠️ I comandi pendenti di ${player1} sono stati cancellati prima dello scambio.`);
                        }
                    }
                    
                    await performSwap();
                    setTimeout(() => requestMsg.delete().catch(() => {}), 15000);
                });

                
                return; // Esci dalla funzione, lo scambio avverrà nella callback
            }
            
            // È @IDruolo1 o admin - scambio immediato
            message.channel.send("🔄 **Inizio procedura di scambio identità...**");
            await performSwap();
            
            // Funzione helper per eseguire lo scambio
            async function performSwap() {
            try {
                // A. SCAMBIO DATI HOUSING (Database Locale dbCache)
                // Scambiamo tutti i contatori pertinenti tra ID P1 e ID P2
                const swapKeys = [
                    'playerVisits', 'baseVisits', 'forcedLimits', 'hiddenLimits', 
                    'dayLimits', 'forcedVisits', 'hiddenVisits', 'extraVisits', 'extraVisitsDay'
                ];

                swapKeys.forEach(key => {
                    if (!dbCache[key]) dbCache[key] = {};
                    const val1 = dbCache[key][player1.id];
                    const val2 = dbCache[key][player2.id];
                    
                    // Scambio
                    if (val1 === undefined) delete dbCache[key][player2.id];
                    else dbCache[key][player2.id] = val1;

                    if (val2 === undefined) delete dbCache[key][player1.id];
                    else dbCache[key][player1.id] = val2;
                });

                await saveDB(); // Salva Housing

                // B. SCAMBIO DATI MEETING (Database Mongoose Diretto)
                try {
                    const MeetingData = mongoose.model('MeetingData');
                    const meetingDB = await MeetingData.findOne({ id: 'main_meeting' });
                    
                    if (meetingDB) {
                        const meetingKeys = ['meetingCounts', 'letturaCounts'];
                        let modified = false;

                        meetingKeys.forEach(key => {
                            if (!meetingDB[key]) meetingDB[key] = {};
                            // Mongoose Map/Object manipulation
                            const val1 = meetingDB[key][player1.id];
                            const val2 = meetingDB[key][player2.id];

                            // Scambio
                            if (val1 === undefined) delete meetingDB[key][player2.id];
                            else meetingDB[key][player2.id] = val1;

                            if (val2 === undefined) delete meetingDB[key][player1.id];
                            else meetingDB[key][player1.id] = val2;
                            
                            modified = true;
                        });

                        if (modified) {
                            meetingDB.markModified('meetingCounts');
                            meetingDB.markModified('letturaCounts');
                            await meetingDB.save();
                        }
                    }
                } catch (err) {
                    console.error("Errore scambio Meeting:", err);
                    message.channel.send("⚠️ Errore nello scambio dati Meeting (i ruoli verranno comunque scambiati).");
                }

                // C. SCAMBIO RUOLI DISCORD
                // Rimuovi e aggiungi in parallelo per velocità
                await Promise.all([
                    player1.roles.remove(R1),
                    player1.roles.add(R2),
                    player2.roles.remove(R2),
                    player2.roles.add(R1)
                ]);

                message.channel.send(`✅ **Scambio Completato!**\n👤 ${player1} ora ha il ruolo <@&${R2}> e le relative stats.\n👤 ${player2} ora ha il ruolo <@&${R1}> e le relative stats.`);

            } catch (error) {
                console.error(error);
                message.channel.send("❌ Si è verificato un errore critico durante lo scambio.");
            }
            } // Fine funzione performSwap
        }
        // ---------------------------------------------------------
        // 👤 COMANDI GIOCATORE
        // ---------------------------------------------------------

        if (command === 'trasferimento') {
            if (message.channel.parentId !== ID_CATEGORIA_CASE) return message.delete().catch(()=>{});

            // 🛑 CONTROLLO: Gli sponsor non possono usare !trasferimento
            if (message.member.roles.cache.has(ID_RUOLO_SPONSOR)) {
                return message.channel.send(`⛔ Gli sponsor non possono usare il comando !trasferimento.`).then(m => setTimeout(() => m.delete(), 5000));
            }
            if (!message.member.roles.cache.has(ID_RUOLO_NOTIFICA_1)) return message.channel.send("⛔ Non hai il ruolo.").then(m => setTimeout(() => m.delete(), 5000));

            const requester = message.author;
            const newHomeChannel = message.channel;
            const ownerId = Object.keys(dbCache.playerHomes).find(key => dbCache.playerHomes[key] === message.channel.id);
            
            // MODIFICA: Controllo se il proprietario è già in casa sua
            if (ownerId === requester.id) {
                return message.reply("❌ Sei già a casa tua, non puoi trasferirti qui!");
            }

            if (!ownerId) {
                await cleanOldHome(requester.id, message.guild);
                dbCache.playerHomes[requester.id] = newHomeChannel.id;
                await saveDB();

                await newHomeChannel.permissionOverwrites.edit(requester.id, { ViewChannel: true, SendMessages: true });
                const pinnedMsg = await newHomeChannel.send(`🔑 **${requester}**, questa è la tua dimora privata.`);
                await pinnedMsg.pin();
                return message.reply("✅ Trasferimento completato!");
            }

            const owner = message.guild.members.cache.get(ownerId);
            if (!owner) return message.channel.send("❌ Proprietario non trovato.");

            const confirmEmbed = new EmbedBuilder()
                .setTitle("Richiesta di Trasferimento 📦")
                .setDescription(`${requester} vuole trasferirsi qui.\nAccetti?`)
                .setColor('Blue');

            const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`transfer_yes_${requester.id}`).setLabel('Accetta ✅').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`transfer_no_${requester.id}`).setLabel('Rifiuta ❌').setStyle(ButtonStyle.Danger)
            );

            const isOwnerHome = newHomeChannel.permissionsFor(owner).has(PermissionsBitField.Flags.ViewChannel);
            let msg;
            if (isOwnerHome) {
                msg = await newHomeChannel.send({ content: `🔔 Richiesta <@${owner.id}>`, embeds: [confirmEmbed], components: [row] });
            } else {
                const privateCategory = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_PRIVATE);
                const ownerPrivateChannel = privateCategory.children.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(owner).has(PermissionsBitField.Flags.ViewChannel));
                if (ownerPrivateChannel) {
                    msg = await ownerPrivateChannel.send({ content: `🔔 Richiesta Trasferimento <@${owner.id}>`, embeds: [confirmEmbed], components: [row] });
                    message.channel.send(`📩 Richiesta inviata in privato.`);
                } else {
                    return message.channel.send(`❌ Proprietario non raggiungibile.`);
                }
            }

            const collector = msg.createMessageComponentCollector({ filter: i => i.user.id === owner.id, max: 1 });
            collector.on('collect', async i => {
                if (i.customId === `transfer_yes_${requester.id}`) {
                    await i.update({ content: `✅ Accettato!`, embeds: [], components: [] });
                    await cleanOldHome(requester.id, message.guild);
                    dbCache.playerHomes[requester.id] = newHomeChannel.id;
                    await saveDB();
                    await newHomeChannel.permissionOverwrites.edit(requester.id, { ViewChannel: true, SendMessages: true });
                    const newKeyMsg = await newHomeChannel.send(`🔑 ${requester}, dimora assegnata (Comproprietario).`);
                    await newKeyMsg.pin();
                } else {
                    await i.update({ content: `❌ Rifiutato.`, embeds: [], components: [] });
                }
            });
        }

                    if (command === 'chi') {
            message.delete().catch(()=>{});
            
            const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
            let targetChannel = null;

            // Logica di selezione canale
            if (isAdmin && message.mentions.channels.size > 0) {
                // Se è admin e ha menzionato un canale, usa quello
                targetChannel = message.mentions.channels.first();
            } else {
                // Altrimenti usa il canale corrente se è una casa
                if (message.channel.parentId === ID_CATEGORIA_CASE) {
                    targetChannel = message.channel;
                }
            }

            // Controllo validità
            if (!targetChannel || targetChannel.parentId !== ID_CATEGORIA_CASE) {
                return message.channel.send("⛔ Devi essere in una casa o (se admin) specificare una casa valida.").then(m => setTimeout(() => m.delete(), 5000));
            }

            const ownerIds = Object.keys(dbCache.playerHomes).filter(key => dbCache.playerHomes[key] === targetChannel.id);
            const ownerMention = ownerIds.length > 0 ? ownerIds.map(id => `<@${id}>`).join(', ') : "Nessuno";
            
            // MODIFICA: Mostra solo chi è FISICAMENTE presente (ha permessi personalizzati)
            // Non conta gli spettatori delle case pubbliche
            const playersInHouse = targetChannel.members.filter(m => 
                !m.user.bot && 
                m.roles.cache.has(ID_RUOLO_NOTIFICA_1) &&
                targetChannel.permissionOverwrites.cache.has(m.id) // Ha permessi personalizzati = è entrato fisicamente
            );
            
            let description = playersInHouse.size > 0 ? playersInHouse.map(p => `👤 ${p}`).join('\n') : "Nessuno.";

            const embed = new EmbedBuilder().setTitle(`👥 Persone in casa`).setDescription(description).addFields({ name: '🔑 Proprietario', value: ownerMention });
            message.channel.send({ embeds: [embed] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 300000));
        }


        if (command === 'rimaste') {
            message.delete().catch(()=>{});
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return message.channel.send("⛔ Solo chat private!").then(m => setTimeout(() => m.delete(), 5000));

            if (message.member.roles.cache.hasAny(...RUOLI_PERMESSI)) {
                let base, extra, hidden, forced;
                if (dbCache.currentMode === 'DAY') {
                     const limits = dbCache.dayLimits[message.author.id] || { base: 0 };
                     base = limits.base;
                     extra = dbCache.extraVisitsDay ? (dbCache.extraVisitsDay[message.author.id] || 0) : 0;
                } else {
                     base = dbCache.baseVisits[message.author.id] || DEFAULT_MAX_VISITS;
                     extra = dbCache.extraVisits[message.author.id] || 0;
                }
                const totalLimit = base + extra;
                const used = dbCache.playerVisits[message.author.id] || 0;
                hidden = dbCache.hiddenVisits[message.author.id] || 0;
                forced = dbCache.forcedVisits[message.author.id] || 0;
                
                const modeStr = dbCache.currentMode === 'DAY' ? "☀️ GIORNO" : "🌙 NOTTE";
                message.channel.send(`📊 **Le tue visite (${modeStr}):**\n🏠 Normali: ${used}/${totalLimit}\n🧨 Forzate: ${forced}\n🕵️ Nascoste: ${hidden}`).then(m => setTimeout(() => m.delete(), 30000));
            }
        }


        if (command === 'ram' || command === 'memoria') {
            // Solo per admin
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return message.reply("⛔ Solo gli admin possono usare questo comando.");
            }
            
            try {
                const used = process.memoryUsage();
                const formatMemory = (bytes) => (bytes / 1024 / 1024).toFixed(2);
                
                // Ottieni informazioni su MongoDB
                let mongoStatus = "⚠️ Non disponibile";
                try {
                    if (mongoose.connection.readyState === 1) {
                        mongoStatus = "✅ Connesso";
                    } else {
                        mongoStatus = "❌ Disconnesso";
                    }
                } catch (e) {
                    mongoStatus = "❌ Errore";
                }
                
                const embed = new EmbedBuilder()
                    .setTitle("📊 Monitoraggio Server")
                    .setColor('#00ff00')
                    .addFields(
                        { name: '🧠 Heap Totale', value: `${formatMemory(used.heapTotal)} MB`, inline: true },
                        { name: '💾 Heap Usato', value: `${formatMemory(used.heapUsed)} MB`, inline: true },
                        { name: '📦 RSS', value: `${formatMemory(used.rss)} MB`, inline: true },
                        { name: '⚡ External', value: `${formatMemory(used.external)} MB`, inline: true },
                        { name: '🗄️ MongoDB', value: mongoStatus, inline: true },
                        { name: '⏱️ Uptime', value: `${Math.floor(process.uptime() / 60)} minuti`, inline: true }
                    )
                    .setTimestamp();
                
                message.reply({ embeds: [embed] });
            } catch (error) {
                console.error("Errore comando !ram:", error);
                message.reply("❌ Errore nel recupero delle informazioni sulla memoria.");
            }
        }

        if (command === 'torna') {
            message.delete().catch(()=>{}); 
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return;

            // 🛑 CONTROLLO: Gli sponsor non possono usare !torna
            if (message.member.roles.cache.has(ID_RUOLO_SPONSOR)) {
                return message.channel.send(`⛔ Gli sponsor non possono usare il comando !torna.`);
            }
            
            // 🔒 CONTROLLO: Verifica se la chat privata è bloccata da un'azione in corso
            const chatLock = isPrivateChatLocked(message.channel.id);
            if (chatLock) {
                const lockUser = message.guild.members.cache.get(chatLock.userId);
                const actionName = chatLock.actionType === 'KNOCK' ? 'bussa' : 'torna';
                return message.channel.send(`⚠️ C'è già un'azione "${actionName}" in corso in questa chat. Attendi che ${lockUser || 'l\'utente'} completi la sua azione.`);
            }

            const homeId = dbCache.playerHomes[message.author.id];
            if (!homeId) return message.channel.send("❌ **Non hai una casa!**"); 
            if (dbCache.destroyedHouses.includes(homeId)) return message.channel.send("🏚️ **Casa distrutta!**");

            const homeChannel = message.guild.channels.cache.get(homeId);
            if (!homeChannel) return message.channel.send("❌ Errore casa.");

            // Controlla se sei fisicamente presente in un'altra casa (hai permessi personalizzati)
            const isVisiting = message.guild.channels.cache.some(c => 
                c.parentId === ID_CATEGORIA_CASE && 
                c.type === ChannelType.GuildText && 
                c.id !== homeId && 
                c.permissionOverwrites.cache.has(message.author.id) // Ha permessi personalizzati = è fisicamente dentro
            );
            if (!isVisiting) return message.channel.send("🏠 Sei già a casa.");

            // 🛑 CONTROLLO 1: Non può fare !torna se HA GIÀ un KNOCK o RETURN in corso
            if (QueueModel) {
                const alreadyInQueue = await QueueModel.findOne({
                    userId: message.author.id,
                    status: 'PENDING',
                    type: { $in: ['RETURN', 'KNOCK'] }
                });

                if (alreadyInQueue) {
                    const actionType = alreadyInQueue.type === 'KNOCK' ? 'bussa' : 'torna';
                    return message.channel.send(`⚠️ Hai già un'azione "${actionType}" in corso! Completa prima quella o usa \`!rimuovi\` per annullarla.`);
                }
                
                // 🛑 CONTROLLO 2: Verifica se ALTRI utenti nella stessa chat privata hanno azioni in corso
                const privateChatChannel = message.channel;
                const membersInChat = privateChatChannel.members.filter(m => 
                    !m.user.bot && m.id !== message.author.id
                );
                
                for (const [memberId, member] of membersInChat) {
                    const otherUserPending = await QueueModel.findOne({
                        userId: memberId,
                        status: 'PENDING',
                        type: { $in: ['RETURN', 'KNOCK'] }
                    });
                    
                    if (otherUserPending) {
                        return message.channel.send(`⚠️ C'è già un'azione in corso in questa chat. Attendi che ${member} completi la sua azione.`);
                    }
                }
            }

            // --- MODIFICA CODA ---
            if (QueueSystem) {
                // 🔒 IMPOSTA LOCK sulla chat privata
                await lockPrivateChat(message.channel.id, message.author.id, 'RETURN');
                
                await QueueSystem.add('RETURN', message.author.id, {
                    fromChannelId: message.channel.id
                });
                await message.channel.send("⏳ **Azione Torna** messa in coda. Attendi...");
            } else {
                await movePlayer(message.member, message.channel, homeChannel, `🏠 ${message.member} è ritornato.`, false);
            }
        }

        if (command === 'rimuovi') {
            message.delete().catch(()=>{});
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return;

            // Controlla cosa può rimuovere
            const options = [];
            
            // Controlla se è in pendingKnocks (sta selezionando casa)
            const isSelectingHouse = dbCache.pendingKnocks && dbCache.pendingKnocks.includes(message.author.id);
            
            // Controlla cosa c'è in coda
            let queueItems = [];
            if (QueueModel) {
                queueItems = await QueueModel.find({
                    userId: message.author.id,
                    status: 'PENDING'
                });
            }
            
            // Aggiungi opzioni disponibili
            if (isSelectingHouse) {
                options.push(
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Annulla selezione casa (Bussa)')
                        .setValue('remove_selecting')
                        .setEmoji('🚫')
                        .setDescription('Annulla il menu di selezione casa attuale')
                );
            }
            
            for (const item of queueItems) {
                if (item.type === 'KNOCK') {
                    options.push(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Rimuovi Bussa dalla coda')
                            .setValue('remove_knock')
                            .setEmoji('🚪')
                            .setDescription('Annulla la visita in attesa')
                    );
                } else if (item.type === 'RETURN') {
                    options.push(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Rimuovi Torna dalla coda')
                            .setValue('remove_return')
                            .setEmoji('🏠')
                            .setDescription('Annulla il ritorno a casa')
                    );
                } else if (item.type === 'ABILITY') {
                    options.push(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Rimuovi Abilità dalla coda')
                            .setValue('remove_ability')
                            .setEmoji('✨')
                            .setDescription('Annulla l\'abilità in attesa')
                    );
                }
            }
            
            // Se non c'è nulla da rimuovere
            if (options.length === 0) {
                return message.channel.send("❌ Non hai nessuna azione in corso da rimuovere!")
                    .then(m => setTimeout(() => m.delete(), 5000));
            }
            
            // Crea il menu
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('remove_action_select')
                .setPlaceholder('Cosa vuoi rimuovere?')
                .addOptions(options);
            
            const row = new ActionRowBuilder().addComponents(selectMenu);
            
            const menuMsg = await message.channel.send({
                content: '🗑️ **Seleziona cosa vuoi rimuovere:**',
                components: [row]
            });
            
            // Auto-delete dopo 60 secondi
            setTimeout(() => menuMsg.delete().catch(() => {}), 60000);
        }


        if (command === 'bussa') {
            message.delete().catch(()=>{}); 
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return message.channel.send(`⛔ Solo chat private!`);

            // 🛑 CONTROLLO: Gli sponsor non possono usare !bussa
            if (message.member.roles.cache.has(ID_RUOLO_SPONSOR)) {
                return message.channel.send(`⛔ Gli sponsor non possono usare il comando !bussa.`);
            }
            
            // 🔒 CONTROLLO: Verifica se la chat privata è bloccata da un'azione in corso
            const chatLock = isPrivateChatLocked(message.channel.id);
            if (chatLock) {
                const lockUser = message.guild.members.cache.get(chatLock.userId);
                const actionName = chatLock.actionType === 'KNOCK' ? 'bussa' : 'torna';
                return message.channel.send(`⚠️ C'è già un'azione "${actionName}" in corso in questa chat. Attendi che ${lockUser || 'l\'utente'} completi la sua azione.`);
            }

            // 🛑 CONTROLLO 1: Non può bussare se HA GIÀ un'azione in corso
            if (QueueModel) {
                const alreadyInQueue = await QueueModel.findOne({
                    userId: message.author.id,
                    status: 'PENDING',
                    type: { $in: ['RETURN', 'KNOCK'] }
                });

                if (alreadyInQueue) {
                    // Pulisci pendingKnocks se presente
                    if (dbCache.pendingKnocks && dbCache.pendingKnocks.includes(message.author.id)) {
                        dbCache.pendingKnocks = dbCache.pendingKnocks.filter(id => id !== message.author.id);
                        await saveDB();
                    }
                    const actionType = alreadyInQueue.type === 'KNOCK' ? 'bussa' : 'torna';
                    return message.channel.send(`⚠️ Hai già un'azione "${actionType}" in corso! Completa prima quella o usa \`!rimuovi\` per annullarla.`);
                }
                
                // 🛑 CONTROLLO 2: Verifica se ALTRI utenti nella stessa chat privata hanno azioni in corso
                const privateChatChannel = message.channel;
                const membersInChat = privateChatChannel.members.filter(m => 
                    !m.user.bot && m.id !== message.author.id
                );
                
                for (const [memberId, member] of membersInChat) {
                    const otherUserPending = await QueueModel.findOne({
                        userId: memberId,
                        status: 'PENDING',
                        type: { $in: ['RETURN', 'KNOCK'] }
                    });
                    
                    if (otherUserPending) {
                        return message.channel.send(`⚠️ C'è già un'azione in corso in questa chat. Attendi che ${member} completi la sua azione.`);
                    }
                }
            }

            // Controlla se sta già bussando (menu aperto)
            if ((dbCache.pendingKnocks && dbCache.pendingKnocks.includes(message.author.id))) return message.channel.send(`${message.author}, stai già bussando!`);

            // Aggiungi a dbCache.pendingKnocks e salva su MongoDB
            if (!dbCache.pendingKnocks) dbCache.pendingKnocks = [];
            if (!dbCache.pendingKnocks.includes(message.author.id)) {
                dbCache.pendingKnocks.push(message.author.id);
                await saveDB();
            }

            const selectMode = new StringSelectMenuBuilder()
                .setCustomId('knock_mode_select')
                .setPlaceholder('Come vuoi entrare?')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Visita Normale').setValue('mode_normal').setEmoji('👋'),
                    new StringSelectMenuOptionBuilder().setLabel('Visita Forzata').setValue('mode_forced').setEmoji('🧨'),
                    new StringSelectMenuOptionBuilder().setLabel('Visita Nascosta').setValue('mode_hidden').setEmoji('🕵️')
                );

            const closeButton = new ButtonBuilder()
                .setCustomId('knock_close')
                .setLabel('Chiudi')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('❌');

            const menuMessage = await message.channel.send({ 
                content: `🎭 **${message.author}, scegli la modalità di visita:**`, 
                components: [
                    new ActionRowBuilder().addComponents(selectMode),
                    new ActionRowBuilder().addComponents(closeButton)
                ]
            });
            setTimeout(async () => {
                menuMessage.delete().catch(() => {});
                // Rimuovi da dbCache.pendingKnocks e salva
                if (dbCache.pendingKnocks) {
                    dbCache.pendingKnocks = dbCache.pendingKnocks.filter(id => id !== message.author.id);
                    await saveDB();
                }
            }, 60000); // 1 minuto invece di 5 minuti
        }

    });
    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;
        
        // Gestione bottone chiusura menu !bussa
        if (interaction.customId === 'knock_close') {
            if (!interaction.message.content.includes(interaction.user.id)) {
                return interaction.reply({ content: "Non è tuo.", ephemeral: true });
            }
            
            // Rimuovi da pendingKnocks
            if (dbCache.pendingKnocks) {
                dbCache.pendingKnocks = dbCache.pendingKnocks.filter(id => id !== interaction.user.id);
                await saveDB();
            }
            
            // Elimina il messaggio
            await interaction.message.delete().catch(() => {});
            return;
        }
        
        // Gestione bottone indietro: da selezione pagine a menu modalità
        if (interaction.customId === 'knock_back_to_mode') {
            // Verifica che l'utente sia il proprietario del menu (è in pendingKnocks)
            if (!dbCache.pendingKnocks || !dbCache.pendingKnocks.includes(interaction.user.id)) {
                return interaction.reply({ content: "Non è tuo.", ephemeral: true });
            }
            
            const selectMode = new StringSelectMenuBuilder()
                .setCustomId('knock_mode_select')
                .setPlaceholder('Come vuoi entrare?')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Visita Normale').setValue('mode_normal').setEmoji('👋'),
                    new StringSelectMenuOptionBuilder().setLabel('Visita Forzata').setValue('mode_forced').setEmoji('🧨'),
                    new StringSelectMenuOptionBuilder().setLabel('Visita Nascosta').setValue('mode_hidden').setEmoji('🕵️')
                );

            const closeButton = new ButtonBuilder()
                .setCustomId('knock_close')
                .setLabel('Chiudi')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('❌');

            await interaction.update({ 
                content: `🎭 **${interaction.user}, scegli la modalità di visita:**`, 
                components: [
                    new ActionRowBuilder().addComponents(selectMode),
                    new ActionRowBuilder().addComponents(closeButton)
                ]
            });
            return;
        }
        
        // Gestione bottone indietro: da selezione case a selezione pagine
        if (interaction.customId.startsWith('knock_back_to_pages_')) {
            // Verifica che l'utente sia il proprietario del menu (è in pendingKnocks)
            if (!dbCache.pendingKnocks || !dbCache.pendingKnocks.includes(interaction.user.id)) {
                return interaction.reply({ content: "Non è tuo.", ephemeral: true });
            }
            
            const mode = interaction.customId.replace('knock_back_to_pages_', '');
            
            // ✅ FIX: Fetch fresco dal server
            const tutteLeCase = await getAllHouses(interaction.guild);

            const PAGE_SIZE = 25;
            const totalPages = Math.ceil(tutteLeCase.size / PAGE_SIZE);
            const pageOptions = [];

            for (let i = 0; i < totalPages; i++) {
                const start = i * PAGE_SIZE + 1;
                const end = Math.min((i + 1) * PAGE_SIZE, tutteLeCase.size);
                pageOptions.push(new StringSelectMenuOptionBuilder()
                    .setLabel(`Case ${start} - ${end}`)
                    .setValue(`page_${i}_${mode}`)
                    .setEmoji('🏘️')
                );
            }
            
            const selectGroup = new StringSelectMenuBuilder().setCustomId('knock_page_select').addOptions(pageOptions);
            
            const backButton = new ButtonBuilder()
                .setCustomId('knock_back_to_mode')
                .setLabel('Indietro')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('◀️');
            
            await interaction.update({ 
                content: `🏘️ **Modalità scelta**. Seleziona zona:`, 
                components: [
                    new ActionRowBuilder().addComponents(selectGroup),
                    new ActionRowBuilder().addComponents(backButton)
                ]
            });
            return;
        }
        
        if (interaction.customId === 'knock_mode_select') {
             if (!interaction.message.content.includes(interaction.user.id)) return interaction.reply({ content: "Non è tuo.", ephemeral: true });
             const selectedMode = interaction.values[0]; 
             // ✅ FIX: Fetch fresco dal server invece di usare cache
             const tutteLeCase = await getAllHouses(interaction.guild);

             const PAGE_SIZE = 25;
             const totalPages = Math.ceil(tutteLeCase.size / PAGE_SIZE);
             const pageOptions = [];

             for (let i = 0; i < totalPages; i++) {
                const start = i * PAGE_SIZE + 1;
                const end = Math.min((i + 1) * PAGE_SIZE, tutteLeCase.size);
                pageOptions.push(new StringSelectMenuOptionBuilder()
                    .setLabel(`Case ${start} - ${end}`)
                    .setValue(`page_${i}_${selectedMode}`)
                    .setEmoji('🏘️')
                );
            }
            const selectGroup = new StringSelectMenuBuilder().setCustomId('knock_page_select').addOptions(pageOptions);
            
            const backButton = new ButtonBuilder()
                .setCustomId('knock_back_to_mode')
                .setLabel('Indietro')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('◀️');
            
            await interaction.update({ 
                content: `🏘️ **Modalità scelta**. Seleziona zona:`, 
                components: [
                    new ActionRowBuilder().addComponents(selectGroup),
                    new ActionRowBuilder().addComponents(backButton)
                ]
            });
        }
                // --- 🔴 PEZZO MANCANTE: GESTIONE SELEZIONE PAGINA ---
       // --- 🔴 PEZZO MODIFICATO: GESTIONE SELEZIONE PAGINA (CON FILTRO CASA PROPRIA) ---
        if (interaction.customId === 'knock_page_select') {
            const parts = interaction.values[0].split('_');
            const pageIndex = parseInt(parts[1]);
            const mode = parts.slice(2).join('_'); 
            
            // ✅ FIX: Fetch fresco dal server
            const tutteLeCase = await getAllHouses(interaction.guild);

            const PAGE_SIZE = 25;
            const start = pageIndex * PAGE_SIZE;
            const end = start + PAGE_SIZE;
            const casePagina = [...tutteLeCase.values()].slice(start, end);

            if (casePagina.length === 0) {
                return interaction.reply({ content: "❌ Nessuna casa in questa pagina.", ephemeral: true });
            }

            // Recupera ID casa di proprietà dell'utente
            const myHomeId = dbCache.playerHomes[interaction.user.id];

            // CREAZIONE OPZIONI (CON FILTRI)
            // ESCLUDI SOLO:
            // 1. La TUA casa di proprietà (channel.id !== myHomeId)
            // 2. Case dove sei FISICAMENTE presente (hai permessi personalizzati)
            // INCLUDI: Case pubbliche dove sei solo spettatore
            const houseOptions = casePagina
                .filter(channel => {
                    // Escludi casa propria
                    if (channel.id === myHomeId) return false;
                    
                    // Escludi solo se sei FISICAMENTE presente (hai permessi personalizzati)
                    // NON escludere se sei solo spettatore (vedi tramite ruolo pubblico)
                    const hasPersonalPermissions = channel.permissionOverwrites.cache.has(interaction.user.id);
                    if (hasPersonalPermissions) return false;
                    
                    // In tutti gli altri casi, mostra la casa
                    return true;
                }) 
                .map(channel => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(formatName(channel.name)) 
                        .setValue(`${channel.id}_${mode}`)  
                        .setEmoji('🏠')
                );

            if (houseOptions.length === 0) {
                return interaction.reply({ 
                    content: "❌ Nessuna casa disponibile in questa pagina (o sono la tua casa/dove sei già).", 
                    ephemeral: true 
                });
            }
            
            const selectHouse = new StringSelectMenuBuilder()
                .setCustomId('knock_house_select')
                .setPlaceholder('Scegli la casa specifica...')
                .addOptions(houseOptions);

            const backButton = new ButtonBuilder()
                .setCustomId(`knock_back_to_pages_${mode}`)
                .setLabel('Indietro')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('◀️');

            await interaction.update({ 
                content: `🏘️ **Pagina ${pageIndex + 1}: Scegli dove bussare:**`, 
                components: [
                    new ActionRowBuilder().addComponents(selectHouse),
                    new ActionRowBuilder().addComponents(backButton)
                ]
            });
        }
        // -----------------------------------------------------


       if (interaction.customId === 'knock_house_select') {
            const parts = interaction.values[0].split('_'); 
            const targetChannelId = parts[0];
            
            // ✅ CORREZIONE: Definito 'knocker' subito qui in alto
            const knocker = interaction.member;

            // 🛑 CONTROLLO CRITICO ANTI-DOUBLE-KNOCK
            if (QueueModel) {
                const alreadyInQueue = await QueueModel.findOne({
                    userId: knocker.id,
                    status: 'PENDING',
                    type: { $in: ['RETURN', 'KNOCK'] }
                });

                if (alreadyInQueue) {
                    // Pulisci pendingKnocks
                    if (dbCache.pendingKnocks) {
                        dbCache.pendingKnocks = dbCache.pendingKnocks.filter(id => id !== knocker.id);
                        await saveDB();
                    }
                    
                    const actionType = alreadyInQueue.type === 'KNOCK' ? 'bussa' : 'torna';
                    return interaction.reply({
                        content: `⚠️ Hai già un'azione "${actionType}" in corso! Usa \`!rimuovi\` per annullarla.`,
                        ephemeral: true
                    });
                }
            }
            
            const mode = parts[1] + '_' + parts[2]; 
            // const knocker = interaction.member; (Rimosso da qui perché spostato sopra)

            let base, extra;
            if (dbCache.currentMode === 'DAY') {
                const limits = dbCache.dayLimits[knocker.id] || { base: 0 };
                base = limits.base || 0;
                extra = dbCache.extraVisitsDay ? (dbCache.extraVisitsDay[knocker.id] || 0) : 0;
            } else {
                // Se non ha visite assegnate, considera 0 visite (non DEFAULT_MAX_VISITS)
                base = dbCache.baseVisits[knocker.id] !== undefined ? dbCache.baseVisits[knocker.id] : 0;
                extra = dbCache.extraVisits[knocker.id] || 0;
            }
            const userLimit = base + extra;
            const used = dbCache.playerVisits[knocker.id] || 0;

            if (mode === 'mode_forced') {
                const forcedAvailable = dbCache.forcedVisits[knocker.id] || 0;
                if (forcedAvailable <= 0) return interaction.reply({ content: "⛔ Finite forzate.", ephemeral: true });
                dbCache.forcedVisits[knocker.id] = forcedAvailable - 1;
            } else if (mode === 'mode_hidden') {
                const hiddenAvailable = dbCache.hiddenVisits[knocker.id] || 0;
                if (hiddenAvailable <= 0) return interaction.reply({ content: "⛔ Finite nascoste.", ephemeral: true });
                dbCache.hiddenVisits[knocker.id] = hiddenAvailable - 1;
            } else {
                // Visita normale: conta +1 quando viene eseguita
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
                
                // 🔒 IMPOSTA LOCK sulla chat privata
                await lockPrivateChat(interaction.channel.id, knocker.id, 'KNOCK');
                
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
        const getOccupants = () => {
            // In una casa pubblica, tutti vedono il canale tramite ruolo
            // Ma solo chi è FISICAMENTE dentro ha permessi personalizzati
            const physicallyInside = [];
            targetChannel.permissionOverwrites.cache.forEach((overwrite, id) => {
                // Salta ruoli, considera solo utenti
                if (overwrite.type === 1) { // Type 1 = Member
                    const m = targetChannel.members.get(id);
                    if (m && !m.user.bot && m.id !== knocker.id && m.roles.cache.hasAny(...RUOLI_PERMESSI)) {
                        physicallyInside.push(m);
                    }
                }
            });
            return new Map(physicallyInside.map(m => [m.id, m]));
        };

        const membersWithAccess = getOccupants();

        // Se la casa è GIÀ vuota in partenza, entra subito
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
            getOccupants().has(user.id); 
        
        const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

        // ⏱️ MONITORAGGIO PRESENZE
        const monitorInterval = setInterval(() => {
            const currentOccupants = getOccupants();
            if (currentOccupants.size === 0) {
                collector.stop('everyone_left');
            }
        }, 2000);

        collector.on('collect', async (reaction, user) => {
            clearInterval(monitorInterval);

            if (reaction.emoji.name === '✅') {
                await msg.reply(`✅ Qualcuno ha aperto.`);
                await enterHouse(knocker, fromChannel, targetChannel, `👋 ${knocker} è entrato.`, false);
            } else {
                // RIFIUTATO - la visita è già stata contata alla selezione (riga 1358)
                await msg.reply(`❌ Qualcuno ha rifiutato.`);
                
                // Lista presenti FISICAMENTE (con permessi personalizzati, non solo spettatori)
                const presentPlayers = [];
                targetChannel.permissionOverwrites.cache.forEach((overwrite, id) => {
                    if (overwrite.type === 1) { // Type 1 = Member (non ruolo)
                        const m = targetChannel.members.get(id);
                        if (m && !m.user.bot && m.id !== knocker.id && !m.permissions.has(PermissionsBitField.Flags.Administrator)) {
                            presentPlayers.push(m.displayName);
                        }
                    }
                });

                if (fromChannel) {
                    await fromChannel.send(`⛔ ${knocker}, entrata rifiutata. I giocatori presenti in quella casa sono: ${presentPlayers.join(', ') || 'Nessuno'}`);
                }
            }
        });

        collector.on('end', async (collected, reason) => {
            clearInterval(monitorInterval);

            // CASO 1: Tutti sono usciti
            if (reason === 'everyone_left') {
                await msg.reply(` ${knocker} è entrato.`);
                await enterHouse(knocker, fromChannel, targetChannel, `👋 ${knocker} è entrato (tutti usciti).`, false);
            }
            // CASO 2: Timeout classico
            else if (reason === 'time' && collected.size === 0) {
                await msg.reply('⏳ Nessuno ha risposto. La porta viene forzata.');
                await enterHouse(knocker, fromChannel, targetChannel, `👋 ${knocker} è entrato.`, false);
            }
        });
            }
        }
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
                        // 🔓 SBLOCCA la chat privata se c'era un lock
                        if (removed.details && removed.details.fromChannelId) {
                            await unlockPrivateChat(removed.details.fromChannelId);
                        }
                        
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
                        // 🔓 SBLOCCA la chat privata se c'era un lock
                        if (removed.details && removed.details.fromChannelId) {
                            await unlockPrivateChat(removed.details.fromChannelId);
                        }
                        
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















