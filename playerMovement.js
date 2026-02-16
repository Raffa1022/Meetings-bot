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
 * USA LA TECNICA "BLIND STEP" (Ingresso Cieco) per forzare il refresh della cronologia.
 */
async function movePlayer(member, oldChannel, newChannel, entryMessage, isSilent, forceNarration = false) {
    if (!member || !newChannel) return;

    const sponsors = await getSponsorsToMove(member, member.guild);
    let channelToLeave = oldChannel;

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

    // --- 1. USCITA (Cancellazione Totale) ---
    if (channelToLeave && channelToLeave.id !== newChannel.id && channelToLeave.parentId === HOUSING.CATEGORIA_CASE) {
        const hasPersonalPerms = channelToLeave.permissionOverwrites.cache.has(member.id);
        if (hasPersonalPerms) {
            const wasHiddenEntry = await db.housing.isHiddenEntry(member.id, channelToLeave.id);
            
            if (!wasHiddenEntry && isMainPlayer) {
                await channelToLeave.send(`🚪 ${member} è uscito.`);
            }
            if (wasHiddenEntry) {
                await db.housing.clearHiddenEntry(member.id, channelToLeave.id);
            }
            
            // Cancellazione secca overwrite
            await channelToLeave.permissionOverwrites.delete(member.id).catch(() => {});
            eventBus.emit('house:occupant-left', { channelId: channelToLeave.id });
        }
        
        const sponsorOps = sponsors.map(async (s) => {
            if (channelToLeave.permissionOverwrites.cache.has(s.id)) {
                await channelToLeave.permissionOverwrites.delete(s.id).catch(() => {});
            }
        });
        await Promise.all(sponsorOps);
    }

    // --- 2. INGRESSO (Tecnica "Blind Step") ---
    // Questa procedura forza il client a resettare la cache visiva.

    // A. PULIZIA PREVENTIVA (Rimuovi tutto)
    const cleanupOps = [];
    if (newChannel.permissionOverwrites.cache.has(member.id)) cleanupOps.push(newChannel.permissionOverwrites.delete(member.id).catch(() => {}));
    for (const s of sponsors) {
        if (newChannel.permissionOverwrites.cache.has(s.id)) cleanupOps.push(newChannel.permissionOverwrites.delete(s.id).catch(() => {}));
    }
    await Promise.all(cleanupOps);

    // ⏳ PAUSA 1 (300ms): Assicura che Discord registri "Nessun accesso"
    await new Promise(r => setTimeout(r, 300));

    // B. STEP 1: Entra ma "CIECO" (Vedi il canale, ma cronologia BLOCCATA)
    // Il client carica il canale vuoto. Questo resetta la cache.
    const blindPerms = { 
        ViewChannel: true, 
        SendMessages: true, 
        ReadMessageHistory: false // ❌ VIETATO
    };
    
    const stepOneOps = [
        newChannel.permissionOverwrites.create(member.id, blindPerms),
        ...sponsors.map(s => newChannel.permissionOverwrites.create(s.id, blindPerms))
    ];
    await Promise.all(stepOneOps);

    // ⏳ PAUSA 2 (800ms): Tempo sufficiente al client per rendere il canale "vuoto"
    await new Promise(r => setTimeout(r, 800));

    // C. STEP 2: Sblocca la cronologia
    // Il client vede il permesso cambiare e scarica i messaggi.
    const finalPerms = { 
        ViewChannel: true, 
        SendMessages: true, 
        ReadMessageHistory: true // ✅ PERMESSO
    };

    const stepTwoOps = [
        newChannel.permissionOverwrites.edit(member.id, finalPerms),
        db.housing.setPlayerMode(member.id, isSilent ? 'HIDDEN' : 'NORMAL'),
        ...sponsors.map(s => newChannel.permissionOverwrites.edit(s.id, finalPerms)),
        ...sponsors.map(s => db.housing.setPlayerMode(s.id, isSilent ? 'HIDDEN' : 'NORMAL')),
    ];
    await Promise.all(stepTwoOps);


    // --- 3. CLEANUP GLOBALE (Rimuovi permessi residui) ---
    const allCaseChannels = member.guild.channels.cache.filter(c =>
        c.parentId === HOUSING.CATEGORIA_CASE &&
        c.id !== newChannel.id 
    );

    const globalCleanupOps = [];
    const cleanedChannelIds = []; 
    for (const [, house] of allCaseChannels) {
        if (house.permissionOverwrites.cache.has(member.id)) {
            // Cancellazione sempre totale
            globalCleanupOps.push(house.permissionOverwrites.delete(member.id).catch(() => {}));
            cleanedChannelIds.push(house.id);
        }
        for (const s of sponsors) {
            if (house.permissionOverwrites.cache.has(s.id)) {
                globalCleanupOps.push(house.permissionOverwrites.delete(s.id).catch(() => {}));
            }
        }
    }
    if (globalCleanupOps.length > 0) {
        await Promise.all(globalCleanupOps);
        for (const chId of cleanedChannelIds) {
            eventBus.emit('house:occupant-left', { channelId: chId });
        }
    }

    // Narrazione
    if (!isSilent && entryMessage && isMainPlayer) {
        // Un piccolo delay extra per essere sicuri che la narrazione arrivi DOPO che l'utente vede la chat
        setTimeout(() => {
             newChannel.send(entryMessage).catch(() => {});
        }, 500);
    }

    // Fetch finale per sicurezza
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
