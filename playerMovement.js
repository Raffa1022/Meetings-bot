// ==========================================
// 🚶 PLAYER MOVEMENT - Logica di spostamento
// Unica funzione centralizzata per muovere giocatori
// ==========================================
const { PermissionsBitField } = require('discord.js');
const { HOUSING, RUOLI } = require('./config');
const db = require('./db');
const { getSponsorsToMove, hasPhysicalAccess } = require('./helpers');
const eventBus = require('./eventBus');

/**
 * Wrapper: entra in casa (delegata a movePlayer)
 */
async function enterHouse(member, fromChannel, toChannel, entryMessage, isSilent, forceNarration = false) {
    return movePlayer(member, fromChannel, toChannel, entryMessage, isSilent, forceNarration);
}

/**
 * Sposta un giocatore da un canale a un altro.
 * MODIFICA: Logica unificata "stile BUSSA".
 * Non esistono più eccezioni per la "propria casa". Uscire = Cancellazione Permesso.
 */
async function movePlayer(member, oldChannel, newChannel, entryMessage, isSilent, forceNarration = false) {
    if (!member || !newChannel) return;

    const sponsors = await getSponsorsToMove(member, member.guild);
    let channelToLeave = oldChannel;

    // Recupera la home (serve solo per info, non per cambiare logica permessi)
    const myHomeId = await db.housing.getHome(member.id);

    // Se non arriva da una casa, cerca la casa attuale dove ha i permessi
    if (!oldChannel || oldChannel.parentId !== HOUSING.CATEGORIA_CASE) {
        const currentHouse = member.guild.channels.cache.find(c =>
            c.parentId === HOUSING.CATEGORIA_CASE &&
            c.permissionsFor(member).has(PermissionsBitField.Flags.ViewChannel) &&
            c.permissionOverwrites.cache.has(member.id)
        );
        if (currentHouse) channelToLeave = currentHouse;
    }

    const isMainPlayer = forceNarration || member.roles.cache.has(RUOLI.ALIVE) || member.roles.cache.has(RUOLI.DEAD);

    // --- 1. USCITA (Logica unificata: CANCELLAZIONE) ---
    if (channelToLeave && channelToLeave.id !== newChannel.id && channelToLeave.parentId === HOUSING.CATEGORIA_CASE) {
        const hasPersonalPerms = channelToLeave.permissionOverwrites.cache.has(member.id);
        if (hasPersonalPerms) {
            const wasHiddenEntry = await db.housing.isHiddenEntry(member.id, channelToLeave.id);
            
            // Narrazione uscita
            if (!wasHiddenEntry && isMainPlayer) {
                await channelToLeave.send(`🚪 ${member} è uscito.`);
            }
            
            if (wasHiddenEntry) {
                await db.housing.clearHiddenEntry(member.id, channelToLeave.id);
            }
            
            // 🔥 QUI STA LA MAGIA DI "!BUSSA":
            // Cancelliamo SEMPRE l'overwrite, anche se è casa tua (channelToLeave.id === myHomeId).
            // Prima qui c'era un IF che faceva solo "ViewChannel: false". ORA NO.
            await channelToLeave.permissionOverwrites.delete(member.id).catch(() => {});
            
            eventBus.emit('house:occupant-left', { channelId: channelToLeave.id });
        }
        
        // Stessa cosa per gli sponsor: cancellazione totale
        const sponsorOps = sponsors.map(async (s) => {
            if (channelToLeave.permissionOverwrites.cache.has(s.id)) {
                await channelToLeave.permissionOverwrites.delete(s.id).catch(() => {});
            }
        });
        await Promise.all(sponsorOps);
    }

    // --- 2. INGRESSO (Logica standard) ---
    const perms = { 
        ViewChannel: true, 
        SendMessages: true, 
        ReadMessageHistory: true 
    };

    // Pulizia preventiva (giusto per sicurezza, rimuove eventuali residui)
    if (newChannel.permissionOverwrites.cache.has(member.id)) {
        await newChannel.permissionOverwrites.delete(member.id).catch(() => {});
    }
    for (const s of sponsors) {
        if (newChannel.permissionOverwrites.cache.has(s.id)) {
            await newChannel.permissionOverwrites.delete(s.id).catch(() => {});
        }
    }

    // Una micro-pausa tecnica è sempre utile quando si cancella e ricrea subito dopo
    await new Promise(r => setTimeout(r, 200));

    // Creazione dei permessi (essendo stati cancellati prima, è un "nuovo ingresso" per Discord)
    const enterOps = [
        newChannel.permissionOverwrites.create(member.id, perms),
        db.housing.setPlayerMode(member.id, isSilent ? 'HIDDEN' : 'NORMAL'),
        ...sponsors.map(s => newChannel.permissionOverwrites.create(s.id, perms)),
        ...sponsors.map(s => db.housing.setPlayerMode(s.id, isSilent ? 'HIDDEN' : 'NORMAL')),
    ];
    await Promise.all(enterOps);


    // --- 3. CLEANUP GLOBALE (Rimuove permessi residui ovunque) ---
    const allCaseChannels = member.guild.channels.cache.filter(c =>
        c.parentId === HOUSING.CATEGORIA_CASE &&
        c.id !== newChannel.id 
    );

    const cleanupOps = [];
    const cleanedChannelIds = []; 
    for (const [, house] of allCaseChannels) {
        // Pulisci player
        if (house.permissionOverwrites.cache.has(member.id)) {
            // 🔥 ANCHE QUI: Cancellazione totale, mai nascondere
            cleanupOps.push(house.permissionOverwrites.delete(member.id).catch(() => {}));
            cleanedChannelIds.push(house.id);
        }
        // Pulisci sponsor
        for (const s of sponsors) {
            if (house.permissionOverwrites.cache.has(s.id)) {
                cleanupOps.push(house.permissionOverwrites.delete(s.id).catch(() => {}));
            }
        }
    }
    
    if (cleanupOps.length > 0) {
        await Promise.all(cleanupOps);
        for (const chId of cleanedChannelIds) {
            eventBus.emit('house:occupant-left', { channelId: chId });
        }
    }

    // Narrazione ingresso
    if (!isSilent && entryMessage && isMainPlayer) {
        await newChannel.send(entryMessage);
    }

    // Forza fetch messaggi (utile per svegliare la cache)
    try {
        await newChannel.messages.fetch({ limit: 5 });
    } catch (err) {}
}

/**
 * Pulisci la vecchia casa (rimuovi messaggio pinnato)
 */
async function cleanOldHome(userId, guild) {
    const homeId = await db.housing.getHome(userId);
    if (!homeId) return;

    const oldChannel = guild.channels.cache.get(homeId);
    if (!oldChannel) return;

    try {
        const pinnedMessages = await oldChannel.messages.fetchPinned();
        const keyMsg = pinnedMessages.find(m =>
            (m.content.includes("questa è la tua dimora privata") || m.content.includes("dimora assegnata")) &&
            m.content.includes(`<@${userId}>`)
        );
        if (keyMsg) await keyMsg.delete();
    } catch (err) {
        console.log("⚠️ Errore rimozione pin:", err.message);
    }
}

module.exports = { movePlayer, enterHouse, cleanOldHome };
