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
            
            // ✅ FIX: Se è la propria casa, NASCONDI l'overwrite (ViewChannel: false)
            // invece di cancellarlo, per preservare ReadMessageHistory e la continuità Discord
            if (channelToLeave.id === myHomeId) {
                await channelToLeave.permissionOverwrites.edit(member.id, { ViewChannel: false, SendMessages: false }).catch(() => {});
            } else {
                // ✅ FIX CRONOLOGIA: Invece di cancellare, imposta sola lettura nascosta
                // Questo preserva ReadMessageHistory permettendo di leggere messaggi vecchi
                await channelToLeave.permissionOverwrites.edit(member.id, {
                    ViewChannel: false,
                    SendMessages: false,
                    ReadMessageHistory: true
                }).catch(() => {});
            }
            
            // ✅ FIX: Notifica che un occupante è uscito (per auto-apertura porte)
            eventBus.emit('house:occupant-left', { channelId: channelToLeave.id });
        }
        // Rimuovi sponsor dalla vecchia casa (senza narrazione)
        // ✅ FIX: Per sponsor sulla propria casa, nascondi overwrite come per il player
        const sponsorOps = sponsors.map(async (s) => {
            if (!channelToLeave.permissionOverwrites.cache.has(s.id)) return;
            const sponsorHomeId = await db.housing.getHome(s.id);
            if (channelToLeave.id === sponsorHomeId) {
                await channelToLeave.permissionOverwrites.edit(s.id, { ViewChannel: false, SendMessages: false }).catch(() => {});
            } else {
                // ✅ FIX CRONOLOGIA: Preserva ReadMessageHistory anche per sponsor
                await channelToLeave.permissionOverwrites.edit(s.id, {
                    ViewChannel: false,
                    SendMessages: false,
                    ReadMessageHistory: true
                }).catch(() => {});
            }
        });
        await Promise.all(sponsorOps);
    }

    // --- INGRESSO nel nuovo canale ---
    const perms = { ViewChannel: true, SendMessages: true, ReadMessageHistory: true };

    // ✅ FIX CRONOLOGIA MESSAGGI: Se stai tornando alla TUA home E l'overwrite esiste già
    // con ViewChannel:false, allora cancellalo e ricrealo. Questo forza Discord a "resettare"
    // lo stato del canale e caricare TUTTA la cronologia messaggi.
    //
    // PERCHÉ FUNZIONA: Quando un overwrite passa da ViewChannel:false → ViewChannel:true
    // tramite EDIT, Discord carica solo i messaggi dal momento dell'edit. Ma se CANCELLIAMO
    // l'overwrite (che aveva ViewChannel:false) e ne creiamo uno NUOVO (con ViewChannel:true),
    // Discord tratta l'accesso come completamente nuovo e carica tutta la cronologia.
    const isReturningHome = (newChannel.id === myHomeId);
    const existingOverwrite = newChannel.permissionOverwrites.cache.get(member.id);
    const hadViewChannelFalse = existingOverwrite && 
                                existingOverwrite.deny?.has(PermissionsBitField.Flags.ViewChannel);
    
    // Se stai tornando a casa E l'overwrite aveva ViewChannel:false, cancellalo
    if (isReturningHome && hadViewChannelFalse) {
        console.log(`🔄 [FIX] Cancello overwrite nascosto di ${member.displayName} su home ${newChannel.name} per forzare reload cronologia`);
        await newChannel.permissionOverwrites.delete(member.id).catch(() => {});
        // Cancella anche per gli sponsor
        for (const s of sponsors) {
            const sponsorHomeId = await db.housing.getHome(s.id);
            if (newChannel.id === sponsorHomeId) {
                const sponsorOw = newChannel.permissionOverwrites.cache.get(s.id);
                if (sponsorOw && sponsorOw.deny?.has(PermissionsBitField.Flags.ViewChannel)) {
                    await newChannel.permissionOverwrites.delete(s.id).catch(() => {});
                }
            }
        }
    }
    // Se NON è la tua home, cancella sempre (comportamento normale)
    else if (!isReturningHome) {
        const deleteOps = [newChannel.permissionOverwrites.delete(member.id).catch(() => {})];
        for (const s of sponsors) {
            deleteOps.push(newChannel.permissionOverwrites.delete(s.id).catch(() => {}));
        }
        await Promise.all(deleteOps);
    }
    // Se stai tornando a casa ma l'overwrite NON aveva ViewChannel:false, fai solo edit

    // Player + Sponsor entrano in parallelo
    const enterOps = [
        newChannel.permissionOverwrites.edit(member.id, perms),
        db.housing.setPlayerMode(member.id, isSilent ? 'HIDDEN' : 'NORMAL'),
        ...sponsors.map(s => newChannel.permissionOverwrites.edit(s.id, perms)),
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
            // ✅ FIX: Se è la propria casa, nascondi l'overwrite invece di cancellarlo
            if (house.id === myHomeId) {
                // Solo se ha ViewChannel allow (è "presente"), nascondilo
                if (hasPhysicalAccess(house, member.id)) {
                    cleanupOps.push(house.permissionOverwrites.edit(member.id, { ViewChannel: false, SendMessages: false }).catch(() => {}));
                }
                // Se è già nascosto (ViewChannel: false), non fare nulla
            } else {
                // ✅ FIX CRONOLOGIA: Preserva ReadMessageHistory invece di cancellare
                cleanupOps.push(house.permissionOverwrites.edit(member.id, {
                    ViewChannel: false,
                    SendMessages: false,
                    ReadMessageHistory: true
                }).catch(() => {}));
            }
            cleanedChannelIds.push(house.id);
        }
        // Pulisci permessi residui degli sponsor
        for (const s of sponsors) {
            if (house.permissionOverwrites.cache.has(s.id)) {
                // ✅ FIX: Stessa logica per gli sponsor
                const sponsorHomeId = await db.housing.getHome(s.id);
                if (house.id === sponsorHomeId) {
                    if (hasPhysicalAccess(house, s.id)) {
                        cleanupOps.push(house.permissionOverwrites.edit(s.id, { ViewChannel: false, SendMessages: false }).catch(() => {}));
                    }
                } else {
                    // ✅ FIX CRONOLOGIA: Preserva ReadMessageHistory anche per sponsor
                    cleanupOps.push(house.permissionOverwrites.edit(s.id, {
                        ViewChannel: false,
                        SendMessages: false,
                        ReadMessageHistory: true
                    }).catch(() => {}));
                }
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
