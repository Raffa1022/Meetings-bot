// ==========================================
// 🚶 PLAYER MOVEMENT - Logica di spostamento
// Unica funzione centralizzata per muovere giocatori
// ==========================================
const { PermissionsBitField } = require('discord.js');
const { HOUSING, RUOLI } = require('./config');
const db = require('./db');
const { getSponsorsToMove } = require('./helpers');

/**
 * Wrapper: entra in casa (delegata a movePlayer)
 */
async function enterHouse(member, fromChannel, toChannel, entryMessage, isSilent, forceNarration = false) {
    return movePlayer(member, fromChannel, toChannel, entryMessage, isSilent, forceNarration);
}

/**
 * Sposta un giocatore da un canale a un altro.
 * Gestisce: uscita, ingresso, sponsor, permessi, narrazione.
 * FIX: Narrazione solo per giocatore principale (ALIVE/DEAD), mai per sponsor
 * @param {boolean} forceNarration - Se true, forza la narrazione anche per sponsor (usato dopo !cambio)
 */
async function movePlayer(member, oldChannel, newChannel, entryMessage, isSilent, forceNarration = false) {
    if (!member || !newChannel) return;

    const sponsors = await getSponsorsToMove(member, member.guild);
    let channelToLeave = oldChannel;

    // Se arriva da chat privata, cerca la casa attuale
    if (oldChannel && oldChannel.parentId === HOUSING.CATEGORIA_CHAT_PRIVATE) {
        const currentHouse = member.guild.channels.cache.find(c =>
            c.parentId === HOUSING.CATEGORIA_CASE &&
            c.permissionsFor(member).has(PermissionsBitField.Flags.ViewChannel) &&
            c.permissionOverwrites.cache.has(member.id)
        );
        if (currentHouse) channelToLeave = currentHouse;
    }

    // FIX: Determina chi è il giocatore principale per la narrazione
    // Solo ALIVE o DEAD devono narrare, mai SPONSOR o SPONSOR_DEAD (a meno che forceNarration = true)
    const isMainPlayer = forceNarration || member.roles.cache.has(RUOLI.ALIVE) || member.roles.cache.has(RUOLI.DEAD);

    // --- USCITA dal vecchio canale ---
    if (channelToLeave && channelToLeave.id !== newChannel.id && channelToLeave.parentId === HOUSING.CATEGORIA_CASE) {
        const hasPersonalPerms = channelToLeave.permissionOverwrites.cache.has(member.id);
        if (hasPersonalPerms) {
            // ✅ FIX: Controlla se eri entrato NASCOSTO in QUESTA casa specifica
            const wasHiddenEntry = await db.housing.isHiddenEntry(member.id, channelToLeave.id);
            console.log(`🔍 [DEBUG] User ${member.id} esce da ${channelToLeave.name}: wasHiddenEntry=${wasHiddenEntry}, isMainPlayer=${isMainPlayer}`);
            
            // FIX: Narrazione uscita solo per giocatore principale E NON se era entrato nascosto
            if (!wasHiddenEntry && isMainPlayer) {
                console.log(`✅ [DEBUG] Mostro narrazione uscita per ${member.displayName}`);
                await channelToLeave.send(`🚪 ${member} è uscito.`);
            } else {
                console.log(`❌ [DEBUG] SALTO narrazione uscita per ${member.displayName} (wasHiddenEntry=${wasHiddenEntry}, isMainPlayer=${isMainPlayer})`);
            }
            
            // Pulisci il flag hidden per questa casa
            if (wasHiddenEntry) {
                await db.housing.clearHiddenEntry(member.id, channelToLeave.id);
            }
            
            // ✅ Rimuovi sempre i permessi quando esci
            await channelToLeave.permissionOverwrites.delete(member.id).catch(() => {});
        }
        // Rimuovi sponsor dalla vecchia casa (senza narrazione)
        const sponsorDeletes = sponsors.map(s =>
            channelToLeave.permissionOverwrites.cache.has(s.id)
                ? channelToLeave.permissionOverwrites.delete(s.id).catch(() => {})
                : Promise.resolve()
        );
        await Promise.all(sponsorDeletes);
    }

    // --- INGRESSO nel nuovo canale ---
    const perms = { ViewChannel: true, SendMessages: true, ReadMessageHistory: true };

    // Player + Sponsor entrano in parallelo
    const enterOps = [
        newChannel.permissionOverwrites.create(member.id, perms),
        db.housing.setPlayerMode(member.id, isSilent ? 'HIDDEN' : 'NORMAL'),
        ...sponsors.map(s => newChannel.permissionOverwrites.create(s.id, perms)),
        ...sponsors.map(s => db.housing.setPlayerMode(s.id, isSilent ? 'HIDDEN' : 'NORMAL')),
    ];
    await Promise.all(enterOps);

    // --- CLEANUP GLOBALE: Rimuovi permessi RESIDUI da TUTTE le case tranne destinazione ---
    // Questo previene il bug "in due case contemporaneamente"
    const allCaseChannels = member.guild.channels.cache.filter(c =>
        c.parentId === HOUSING.CATEGORIA_CASE &&
        c.id !== newChannel.id // Tieni solo la destinazione
    );

    const cleanupOps = [];
    for (const [, house] of allCaseChannels) {
        // Pulisci permessi residui del giocatore
        if (house.permissionOverwrites.cache.has(member.id)) {
            cleanupOps.push(house.permissionOverwrites.delete(member.id).catch(() => {}));
        }
        // Pulisci permessi residui degli sponsor
        for (const s of sponsors) {
            if (house.permissionOverwrites.cache.has(s.id)) {
                cleanupOps.push(house.permissionOverwrites.delete(s.id).catch(() => {}));
            }
        }
    }
    if (cleanupOps.length > 0) await Promise.all(cleanupOps);

    // FIX: Narrazione ingresso solo per giocatore principale
    if (!isSilent && entryMessage && isMainPlayer) {
        await newChannel.send(entryMessage);
    }
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
