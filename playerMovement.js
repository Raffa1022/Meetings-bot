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
 * Gestisce: uscita, ingresso, sponsor, permessi, narrazione.
 * FIX: Narrazione solo per giocatore principale (ALIVE/DEAD), mai per sponsor
 * @param {boolean} forceNarration - Se true, forza la narrazione anche per sponsor (usato dopo !cambio)
 */
async function movePlayer(member, oldChannel, newChannel, entryMessage, isSilent, forceNarration = false) {
    if (!member || !newChannel) return;

    const sponsors = await getSponsorsToMove(member, member.guild);
    let channelToLeave = oldChannel;

    // ✅ FIX: Recupera la home del giocatore per preservare l'overwrite
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
            
            // 🔥 MODIFICA UNICA: Cancellazione Totale
            // Invece di nascondere (ViewChannel: false), cancelliamo il permesso.
            // Questo costringe Discord a ricaricare la cronologia al prossimo ingresso.
            await channelToLeave.permissionOverwrites.delete(member.id).catch(() => {});
            
            // ✅ FIX: Notifica che un occupante è uscito (per auto-apertura porte)
            eventBus.emit('house:occupant-left', { channelId: channelToLeave.id });
        }
        // Rimuovi sponsor dalla vecchia casa (senza narrazione)
        const sponsorOps = sponsors.map(async (s) => {
            if (channelToLeave.permissionOverwrites.cache.has(s.id)) {
                // Cancellazione totale anche per gli sponsor
                await channelToLeave.permissionOverwrites.delete(s.id).catch(() => {});
            }
        });
        await Promise.all(sponsorOps);
    }

    // --- INGRESSO nel nuovo canale ---
    const perms = { ViewChannel: true, SendMessages: true, ReadMessageHistory: true };

    // 🔥 PULIZIA PREVENTIVA: Assicura che non ci siano permessi residui
    const cleanupEntryOps = [];
    if (newChannel.permissionOverwrites.cache.has(member.id)) {
        cleanupEntryOps.push(newChannel.permissionOverwrites.delete(member.id).catch(() => {}));
    }
    for (const s of sponsors) {
        if (newChannel.permissionOverwrites.cache.has(s.id)) {
            cleanupEntryOps.push(newChannel.permissionOverwrites.delete(s.id).catch(() => {}));
        }
    }
    if (cleanupEntryOps.length > 0) await Promise.all(cleanupEntryOps);

    // ⏳ BREVE PAUSA TECNICA (150ms)
    // Necessaria per dire all'API di Discord: "L'utente è uscito. Ora sta rientrando."
    await new Promise(r => setTimeout(r, 150));

    // Player + Sponsor entrano in parallelo (Creazione permessi da zero)
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
    const cleanedChannelIds = []; // ✅ FIX: Track cleaned channels for knock auto-open
    for (const [, house] of allCaseChannels) {
        // Pulisci permessi residui del giocatore
        if (house.permissionOverwrites.cache.has(member.id)) {
            // 🔥 MODIFICA UNICA: Cancellazione Totale anche nel cleanup
            cleanupOps.push(house.permissionOverwrites.delete(member.id).catch(() => {}));
            cleanedChannelIds.push(house.id);
        }
        // Pulisci permessi residui degli sponsor
        for (const s of sponsors) {
            if (house.permissionOverwrites.cache.has(s.id)) {
                cleanupOps.push(house.permissionOverwrites.delete(s.id).catch(() => {}));
            }
        }
    }
    if (cleanupOps.length > 0) {
        await Promise.all(cleanupOps);
        // ✅ FIX: Notifica uscita per ogni casa pulita (per auto-apertura porte)
        for (const chId of cleanedChannelIds) {
            eventBus.emit('house:occupant-left', { channelId: chId });
        }
    }

    // FIX: Narrazione ingresso solo per giocatore principale
    if (!isSilent && entryMessage && isMainPlayer) {
        await newChannel.send(entryMessage);
    }

    // ✅ FIX: Forza Discord a caricare tutta la cronologia dei messaggi
    try {
        await newChannel.messages.fetch({ limit: 1 });
    } catch (err) {
        // Ignora errori (es. canale vuoto)
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
