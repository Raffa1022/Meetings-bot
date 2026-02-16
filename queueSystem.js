// ==========================================

// 🚦 QUEUE SYSTEM - Coda Cronologica

// EDIT DASHBOARD + GESTIONE GERARCHICA

// ==========================================

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');

const { QUEUE, RUOLI, HOUSING } = require('./config');

const db = require('./db');

const eventBus = require('./eventBus');

const { movePlayer, enterHouse } = require('./playerMovement');

const { getOccupants, hasPhysicalAccess } = require('./helpers');


let clientRef = null;

let processing = false;

// ✅ FIX: Mappa dei collector attivi per auto-apertura quando casa diventa vuota
const activeKnockCollectors = new Map(); // channelId -> { collector, knockerId }


// ==========================================
// ⚙️ PROCESSORE CODA (Aggiornato)
// ==========================================
async function processQueue() {
    if (processing) return;
    processing = true;

    try {
        const currentItem = await db.queue.getFirst();

        if (!currentItem) {
            await updateDashboard();
            processing = false;
            return;
        }

        console.log(`📌 [Queue] Processo: ${currentItem.type} di ${currentItem.userId}`);

        // ======= ABILITÀ =======
        if (currentItem.type === "ABILITY") {
            const isRB = await db.moderation.isBlockedRB(currentItem.userId);
            if (isRB) {
                await notifyUser(currentItem.userId, "🚫 **Abilità fallita:** Sei stato Rolebloccato!");
                await db.queue.remove(currentItem._id);
                processing = false;
                return processQueue();
            } else {
                await updateDashboard();
                processing = false;
                return;
            }
        }

        // ======= AUTOMAZIONI (Housing) =======
        if (currentItem.type === "RETURN" || currentItem.type === "KNOCK") {
            const isVB = await db.moderation.isBlockedVB(currentItem.userId);

            if (isVB) {
                const isRB = await db.moderation.isBlockedRB(currentItem.userId);
                const isUnprot = await db.moderation.isUnprotectable(currentItem.userId);
                const isCatene = isRB && isUnprot;

                const msg = isCatene
                    ? "⛓️ **Azione fallita:** Sei incatenato! (Visitblock + Roleblock attivo)"
                    : "🚫 **Azione fallita:** Sei in Visitblock.";

                await notifyUserInCategory(currentItem.userId, msg);

                if (currentItem.type === "KNOCK") {
                    await db.housing.removePendingKnock(currentItem.userId);
                }

                await db.queue.remove(currentItem._id);
            } else {
                if (currentItem.type === "KNOCK" && currentItem.details) {
                    const mode = currentItem.details.mode;
                    if (mode === "mode_forced") {
                        await db.housing.decrementForced(currentItem.userId);
                    } else if (mode === "mode_hidden") {
                        await db.housing.decrementHidden(currentItem.userId);
                    } else {
                        await db.housing.incrementVisit(currentItem.userId);
                    }
                }

                await executeHousingAction(currentItem);
                await db.queue.remove(currentItem._id);
            }
            processing = false;
            return processQueue();
        }

        // ======= SHOP =======
        if (currentItem.type === "SHOP") {
            const subType = currentItem.details ? currentItem.details.subType : undefined;
            if (subType && subType !== "acquisto") {
                const { shopEffects } = require("./economySystem");
                const handler = shopEffects[subType];
                if (handler) await handler(clientRef, currentItem.userId, currentItem.details);
            }
            await db.queue.remove(currentItem._id);
            processing = false;
            return processQueue();
        }

        // Tipo sconosciuto
        await db.queue.remove(currentItem._id);
        processing = false;
        return processQueue();

    } catch (err) {
        console.error("❌ Errore processQueue:", err);
        processing = false;
    }
}

// ==========================================

// 📊 DASHBOARD (EDIT MESSAGGIO)

// ==========================================

async function updateDashboard(isPaused = false) {

    const channel = clientRef.channels.cache.get(QUEUE.CANALE_LOG);

    if (!channel) return;


    const queue = await db.queue.getPending();

    const isPhaseBlocked = await db.moderation.isPresetPhaseActive();


    let description = queue.length === 0 ? "✅ **Nessuna azione in attesa.**" : "";


    if (isPhaseBlocked && queue.length > 0) {

        description = "ℹ️ **FASE PRESET IN CORSO** (Puoi gestire le azioni man mano)\n\n";

    }


    queue.forEach((item, index) => {

        const time = `<t:${Math.floor(new Date(item.timestamp).getTime() / 1000)}:T>`;

        const icons = { ABILITY: "✨", RETURN: "🏠", KNOCK: "✊", SHOP: "🛒" };


        let label = item.type;

        if (item.type === 'SHOP') label = (item.details && item.details.itemName) ? item.details.itemName : 'Shop';

        else if (item.type === 'ABILITY') label = (item.details && item.details.category) ? item.details.category : 'ABILITÀ';

        else if (item.type === 'KNOCK') {

             const mode = (item.details && item.details.mode) ? item.details.mode : 'normal';

             label = mode === 'mode_forced' ? 'SFONDAMENTO' : (mode === 'mode_hidden' ? 'INTRUSIONE' : 'BUSSA');

        }


        const pointer = index === 0 ? "👉" : `**#${index + 1}**`;

        description += `${pointer} ${icons[item.type] || ""} \`[${label}]\` <@${item.userId}> (${time})\n`;

    });


    const embed = new EmbedBuilder()

        .setTitle("📋 Coda Azioni Cronologica")

        .setColor(queue.length > 0 && queue[0].type === 'ABILITY' ? 'Yellow' : 'Green')

        .setDescription(description)

        .setTimestamp();


    let components = [];

    let contentText = " ";


    if (queue.length > 0) {

        if (queue[0].type === 'ABILITY') {

            contentText = `<@&${RUOLI.ADMIN_QUEUE}> 🔔 **Nuova richiesta in coda!**`;

            components.push(new ActionRowBuilder().addComponents(

                new ButtonBuilder().setCustomId(`q_done_${queue[0]._id}`).setLabel('✅ Gestita').setStyle(ButtonStyle.Success),

            ));


            const detailText = (queue[0].details && queue[0].details.text) ? queue[0].details.text : "Nessun dettaglio";

            embed.addFields({ name: '📜 Dettaglio Azione', value: detailText });

        }

    }


    try {

        const messages = await channel.messages.fetch({ limit: 10 });

        const existingMsg = messages.find(m => m.author.id === clientRef.user.id);

        if (existingMsg) await existingMsg.edit({ content: contentText, embeds: [embed], components });

        else await channel.send({ content: contentText, embeds: [embed], components });

    } catch (e) {

        console.error("Errore updateDashboard:", e);

    }

}

// ==========================================

// 🎯 HOUSING ACTION EXECUTOR

// ==========================================

// ==========================================
// 🎯 HOUSING ACTION EXECUTOR (Aggiornato)
// ==========================================
async function executeHousingAction(queueItem) {
    let guild = clientRef.guilds.cache.first();
    if (!guild) return;

    const member = await guild.members.fetch(queueItem.userId).catch(() => null);
    if (!member) return;

  // --- RETURN ---
    if (queueItem.type === 'RETURN') {
        const homeId = await db.housing.getHome(member.id);
        const destroyed = await db.housing.getDestroyedHouses();

        if (homeId && !destroyed.includes(homeId)) {
            const homeCh = guild.channels.cache.get(homeId);
            
            // Trova TUTTE le case dove il player ha accesso FISICO (ViewChannel: true)
            // ✅ FIX: Usa hasPhysicalAccess per ignorare overwrite nascosti del proprietario
            const housesWithPerms = guild.channels.cache.filter(c =>
                c.parentId === HOUSING.CATEGORIA_CASE &&
                hasPhysicalAccess(c, member.id)
            );

            // LOGICA: Se ho permessi in una casa diversa dalla mia HOME, sono lì.
            const guestHouse = housesWithPerms.find(h => h.id !== homeId);

            // Recupera la modalità se presente (per sapere se era hidden)
            const mode = (queueItem.details && queueItem.details.mode) ? queueItem.details.mode : 'normal';

            // Messaggio uscita PRIMA di togliere i permessi
            // Controlla nel database se era entrato in modalità hidden
            if (guestHouse) {
                const wasHidden = await db.housing.isHiddenEntry(member.id, guestHouse.id);
                
                if (!wasHidden) {
                    await guestHouse.send({
                        content: `🚪 ${member} è uscito.`,
                        allowedMentions: { parse: [] }
                    }).catch(() => {});
                } else {
                    // Pulisco il flag hidden
                    await db.housing.clearHiddenEntry(member.id, guestHouse.id);
                }
            }

            // Assegna permessi HOME
            if (homeCh) {
                await homeCh.permissionOverwrites.edit(member.id, { 
                    ViewChannel: true, 
                    SendMessages: true, 
                    ReadMessageHistory: true
                });
            }

            // Rimuovi permessi da tutte le case tranne home
            for (const [houseId, house] of housesWithPerms) {
                if (houseId !== homeId) {
                    await house.permissionOverwrites.delete(member.id).catch(() => {});
                    // ✅ FIX: Notifica uscita per auto-apertura porte
                    eventBus.emit('house:occupant-left', { channelId: houseId });
                }
            }

            // MovePlayer gestisce l'entrata nella Home
            if (homeCh && guestHouse) {
                await movePlayer(member, guestHouse, homeCh, `🏠 ${member} è ritornato.`, false);
            } else if (homeCh && !guestHouse) {
                await movePlayer(member, null, homeCh, `🏠 ${member} è ritornato.`, false);
            }
        }
        return;
    }

// --- KNOCK ---
    if (queueItem.type === 'KNOCK') {
        if (!queueItem.details) return;
        
        const { targetChannelId, mode } = queueItem.details;
        const targetCh = guild.channels.cache.get(targetChannelId);
        // NOTA: Ignoriamo fromChannelId del comando per l'uscita, usiamo i permessi

        if (!targetCh) return;
        
        // Recupera Home ID
        const myHomeId = await db.housing.getHome(member.id);

        // --- FORZATA / NASCOSTA ---
        if (mode === 'mode_forced' || mode === 'mode_hidden') {
            
            // Cerca le case dove ho accesso FISICO (escludendo quella dove sto andando)
            // ✅ FIX: Usa hasPhysicalAccess per ignorare overwrite nascosti del proprietario
            const candidates = guild.channels.cache.filter(c => 
                c.parentId === HOUSING.CATEGORIA_CASE && 
                hasPhysicalAccess(c, member.id) &&
                c.id !== targetCh.id
            );

            // LOGICA DI USCITA DEDUTTIVA:
            // 1. Priorità: Se sono in una casa che NON è la mia Home, esco da lì.
            let oldHouse = candidates.find(c => c.id !== myHomeId);
            
            // 2. Fallback: Se non sono in giro, sono a casa mia.
            if (!oldHouse) oldHouse = candidates.find(c => c.id === myHomeId);
            
            const msg = mode === 'mode_forced' 
                ? `<@&${RUOLI.ALIVE}> <@&${RUOLI.SPONSOR}> 🧨 ${member} ha sfondato la porta ed è entrato!` 
                : "";
            
            const silent = mode === 'mode_hidden';
            
            // ✅ Salva che è entrato in modalità hidden PRIMA di chiamare enterHouse
            if (mode === 'mode_hidden') {
                await db.housing.setHiddenEntry(member.id, targetCh.id);
            }
            
            // ✅ enterHouse gestisce TUTTO: uscita (con controllo hidden), ingresso, permessi
            await enterHouse(member, oldHouse, targetCh, msg, silent);
            return;
        }

        // --- VISITA NORMALE ---
        const occupants = getOccupants(targetCh, member.id);
        
        // Se casa vuota, entra subito
        if (occupants.size === 0) {
            // ✅ FIX: Usa hasPhysicalAccess per ignorare overwrite nascosti
            const candidates = guild.channels.cache.filter(c => 
                c.parentId === HOUSING.CATEGORIA_CASE && 
                hasPhysicalAccess(c, member.id) &&
                c.id !== targetCh.id
            );
            
            // LOGICA DEDUTTIVA
            let oldHouse = candidates.find(c => c.id !== myHomeId);
            if (!oldHouse) oldHouse = candidates.find(c => c.id === myHomeId);
            
            if (oldHouse) {
                // Controlla se era entrato in modalità hidden
                const wasHidden = await db.housing.isHiddenEntry(member.id, oldHouse.id);
                
                if (!wasHidden) {
                    await oldHouse.send({
                        content: `🚪 ${member} è uscito.`,
                        allowedMentions: { parse: [] }
                    }).catch(() => {});
                } else {
                    // Pulisco il flag hidden
                    await db.housing.clearHiddenEntry(member.id, oldHouse.id);
                }
            }
            
            await targetCh.permissionOverwrites.edit(member.id, {
                ViewChannel: true, 
                SendMessages: true, 
                ReadMessageHistory: true
            });
            
            if (oldHouse) {
                // ✅ FIX: Se è la propria casa, nascondi overwrite invece di cancellarlo
                if (oldHouse.id === myHomeId) {
                    await oldHouse.permissionOverwrites.edit(member.id, { ViewChannel: false, SendMessages: false }).catch(() => {});
                } else {
                    await oldHouse.permissionOverwrites.delete(member.id).catch(() => {});
                }
                // ✅ FIX: Notifica uscita per auto-apertura porte su altre case
                eventBus.emit('house:occupant-left', { channelId: oldHouse.id });
            }

            await enterHouse(member, oldHouse, targetCh, `👋 ${member} è entrato.`, false);
            return;
        }

        // --- TOC TOC (Richiede approvazione) ---
        const msg = await targetCh.send(`🔔 <@&${RUOLI.ALIVE}> <@&${RUOLI.SPONSOR}> **TOC TOC!** Qualcuno bussa.\n✅ Apri | ❌ Rifiuta`);
        await Promise.all([msg.react('✅'), msg.react('❌')]);
        await db.housing.setActiveKnock(member.id, targetChannelId);

        const filter = (r, u) => ['✅', '❌'].includes(r.emoji.name) && occupants.has(u.id);
        const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

        // ✅ FIX: Salva il collector per auto-apertura quando casa diventa vuota
        activeKnockCollectors.set(targetChannelId, { collector, knockerId: member.id });

        collector.on('collect', async (r) => {
            try {
                // ✅ FIX: Rimuovi dal map quando il collector raccoglie una reazione
                activeKnockCollectors.delete(targetChannelId);
                
                // ✅ FIX: Controlla se il giocatore è stato VB nel frattempo
                const isVBNow = await db.moderation.isBlockedVB(member.id);
                if (isVBNow) {
                    await db.housing.clearActiveKnock(member.id);
                    await msg.reply({ content: "🚫 La bussata è stata annullata (Visitblock).", allowedMentions: { parse: [] } });
                    return;
                }
                
                await db.housing.clearActiveKnock(member.id);
                if (r.emoji.name === '✅') {
                    await msg.reply({ content: "✅ Qualcuno ha aperto.", allowedMentions: { parse: [] } });
                    
                    const candidates = guild.channels.cache.filter(c => 
                        c.parentId === HOUSING.CATEGORIA_CASE && 
                        hasPhysicalAccess(c, member.id) &&
                        c.id !== targetCh.id
                    );

                    // LOGICA DEDUTTIVA
                    let currentFrom = candidates.find(c => c.id !== myHomeId);
                    if (!currentFrom) currentFrom = candidates.find(c => c.id === myHomeId);
                    
                    if (currentFrom) {
                        // Controlla se era entrato in modalità hidden
                        const wasHidden = await db.housing.isHiddenEntry(member.id, currentFrom.id);
                        
                        if (!wasHidden) {
                            await currentFrom.send({
                                content: `🚪 ${member} è uscito.`,
                                allowedMentions: { parse: [] }
                            }).catch(() => {});
                        } else {
                            // Pulisco il flag hidden
                            await db.housing.clearHiddenEntry(member.id, currentFrom.id);
                        }
                        // ✅ FIX: Se è la propria casa, nascondi overwrite
                        if (currentFrom.id === myHomeId) {
                            await currentFrom.permissionOverwrites.edit(member.id, { ViewChannel: false, SendMessages: false }).catch(() => {});
                        } else {
                            await currentFrom.permissionOverwrites.delete(member.id).catch(() => {});
                        }
                        // ✅ FIX: Notifica uscita per auto-apertura porte su altre case
                        eventBus.emit('house:occupant-left', { channelId: currentFrom.id });
                    }
                    
                    await enterHouse(member, currentFrom, targetCh, `👋 ${member} è entrato.`, false, true);
                } else {
                    await msg.reply({ content: "❌ Qualcuno ha rifiutato.", allowedMentions: { parse: [] } });
                    
                    // Recupera i giocatori fisicamente presenti nella casa (esclusi quelli da !pubblico)
                    const presentPlayers = [];
                    for (const [id, overwrite] of targetCh.permissionOverwrites.cache) {
                        if (overwrite.type !== 1) continue; // Solo Member, non Role
                        if (id === member.id) continue; // Escludi chi ha bussato
                        try {
                            const m = await guild.members.fetch(id);
                            if (m && !m.user.bot && m.roles.cache.has(RUOLI.ALIVE)) {
                                presentPlayers.push(m);
                            }
                        } catch {}
                    }
                    
                    const playerList = presentPlayers.length > 0 
                        ? presentPlayers.map(p => `${p}`).join(', ')
                        : 'Nessuno';
                    
                    // Invia il messaggio nella chat privata dell'utente (categoria CHAT_PRIVATE)
                    const privateCategory = guild.channels.cache.get(HOUSING.CATEGORIA_CHAT_PRIVATE);
                    if (privateCategory) {
                        const userPrivateChannel = privateCategory.children.cache.find(ch =>
                            ch.type === 0 &&
                            ch.permissionOverwrites.cache.some(p => p.id === member.id && p.allow.has('ViewChannel'))
                        );
                        if (userPrivateChannel) {
                            userPrivateChannel.send({
                                content: `⛔ ${member}, entrata rifiutata.\n👥 Giocatori presenti: ${playerList}`,
                            }).catch(() => {});
                        }
                    }
                }
            } catch (err) {
                console.error("❌ Errore nel collector.on('collect'):", err);
            }
        });

        collector.on('end', async (collected, reason) => {
            try {
                // ✅ FIX: Rimuovi dal map quando il collector termina
                activeKnockCollectors.delete(targetChannelId);
                
                if ((reason === 'time' || reason === 'house_empty') && collected.size === 0) {
                    // ✅ FIX: Controlla se il giocatore è stato VB nel frattempo
                    const isVBNow = await db.moderation.isBlockedVB(member.id);
                    if (isVBNow) {
                        await db.housing.clearActiveKnock(member.id);
                        await msg.reply("🚫 La bussata è stata annullata (Visitblock).");
                        return;
                    }
                    
                    await db.housing.clearActiveKnock(member.id);
                    
                    // ✅ FIX: Messaggio diverso in base al motivo
                    if (reason === 'house_empty') {
                        await msg.reply("🏠 La casa è ora vuota - Apertura automatica.");
                    } else {
                        await msg.reply("⏱️ Tempo scaduto - Apertura automatica.");
                    }
                    
                    // ✅ FIX: Usa hasPhysicalAccess per ignorare overwrite nascosti
                    const candidates = guild.channels.cache.filter(c => 
                        c.parentId === HOUSING.CATEGORIA_CASE && 
                        hasPhysicalAccess(c, member.id) &&
                        c.id !== targetCh.id
                    );
                    
                    let currentFrom = candidates.find(c => c.id !== myHomeId);
                    if (!currentFrom) currentFrom = candidates.find(c => c.id === myHomeId);
                    
                    if (currentFrom) {
                        // Controlla se era entrato in modalità hidden
                        const wasHidden = await db.housing.isHiddenEntry(member.id, currentFrom.id);
                        
                        if (!wasHidden) {
                            await currentFrom.send({
                                content: `🚪 ${member} è uscito.`,
                                allowedMentions: { parse: [] }
                            }).catch(() => {});
                        } else {
                            // Pulisco il flag hidden
                            await db.housing.clearHiddenEntry(member.id, currentFrom.id);
                        }
                        // ✅ FIX: Se è la propria casa, nascondi overwrite
                        if (currentFrom.id === myHomeId) {
                            await currentFrom.permissionOverwrites.edit(member.id, { ViewChannel: false, SendMessages: false }).catch(() => {});
                        } else {
                            await currentFrom.permissionOverwrites.delete(member.id).catch(() => {});
                        }
                        // ✅ FIX: Notifica uscita per auto-apertura porte su altre case
                        eventBus.emit('house:occupant-left', { channelId: currentFrom.id });
                    }

                    await enterHouse(member, currentFrom, targetCh, `👋 ${member} è entrato.`, false, true);
                }
            } catch (err) {
                console.error("❌ Errore nel collector.on('end'):", err);
            }
        }); 
    }
}

async function notifyUser(userId, text) {
    const user = await clientRef.users.fetch(userId).catch(() => null);
    if (user) user.send(text).catch(() => {});
}

async function notifyUserInCategory(userId, text) {
    const guild = clientRef.guilds.cache.first();
    if (!guild) return;
    
    const category = guild.channels.cache.get('1460741414357827747');
    if (!category) return;
    
    const userChannel = category.children.cache.find(ch =>
        ch.type === 0 && // GuildText
        ch.permissionOverwrites.cache.some(p => p.id === userId && p.allow.has('ViewChannel'))
    );
    
    if (userChannel) {
        userChannel.send(text).catch(() => {});
    }
}

// ==========================================
// 🚀 INIT
// ==========================================
module.exports = function initQueueSystem(client) {
    clientRef = client;

    eventBus.on('queue:add', async (data) => {
        await db.queue.add(data.type, data.userId, data.details);
        processQueue();
    });

    eventBus.on('queue:process', () => processQueue());

    // ✅ FIX: Ascolta evento vb:applied per cancellare knock attivi/in coda
    eventBus.on('vb:applied', async (userId) => {
        try {
            // 1. Rimuovi knock dalla coda (non ancora processati = visita NON consumata)
            const pendingKnock = await db.queue.getUserPending(userId, ['KNOCK']);
            if (pendingKnock) {
                await db.queue.removeUserPending(userId, 'KNOCK');
                await db.housing.removePendingKnock(userId);
                await notifyUserInCategory(userId, "⛔ La tua bussata è stata annullata perché sei stato visitbloccato. La visita non è stata scalata.");
                console.log(`🚫 [VB] Knock in coda rimosso per ${userId} (visita NON scalata)`);
            }
            
            // 2. Se ha un activeKnock (collector in corso), la visita è già stata consumata → refund
            const doc = await db.housing.getActiveKnock(userId);
            if (doc) {
                // Determina il tipo di visita per il refund
                const knockDetails = pendingKnock?.details;
                const mode = knockDetails?.mode || 'normal';
                
                if (mode === 'mode_forced') {
                    await db.housing.refundForcedVisit(userId);
                } else if (mode === 'mode_hidden') {
                    await db.housing.refundHiddenVisit(userId);
                } else {
                    await db.housing.refundNormalVisit(userId);
                }
                
                await db.housing.clearActiveKnock(userId);
                await notifyUserInCategory(userId, "⛔ La tua bussata è stata annullata perché sei stato visitbloccato. La visita non è stata scalata.");
                console.log(`🚫 [VB] ActiveKnock cancellato per ${userId} (visita rimborsata)`);
            }
        } catch (err) {
            console.error(`❌ [VB] Errore cancellazione knock per ${userId}:`, err);
        }
    });

    // ✅ FIX: Ascolta quando un occupante esce da una casa per auto-aprire la porta
    eventBus.on('house:occupant-left', async ({ channelId }) => {
        try {
            const knockData = activeKnockCollectors.get(channelId);
            if (!knockData) return; // Nessun knock attivo su questa casa
            
            const channel = clientRef.channels.cache.get(channelId);
            if (!channel) return;
            
            // Controlla se la casa è ora vuota (escludendo chi ha bussato)
            const occupants = getOccupants(channel, knockData.knockerId);
            if (occupants.size === 0) {
                console.log(`🚪 [AutoOpen] Casa ${channel.name} vuota durante knock di ${knockData.knockerId} - apertura automatica`);
                knockData.collector.stop('house_empty');
            }
        } catch (err) {
            console.error(`❌ [AutoOpen] Errore house:occupant-left per ${channelId}:`, err);
        }
    });

    client.on('interactionCreate', async i => {
        if (!i.isButton() || !i.customId.startsWith('q_done_')) return;

        const id = i.customId.split('_')[2];
        const item = await db.queue.findById(id);

        if (!item) return i.reply({ content: "❌ Già gestita.", ephemeral: true });

        if (item.type === 'ABILITY') {
            if (await db.moderation.isBlockedRB(item.userId)) {
                await db.queue.remove(id);
                await i.reply("🚫 Annullata: Roleblock.");
                processing = false;
                return processQueue();
            }
        }

        await db.queue.remove(id);
        await i.reply({ content: `✅ Gestita.`, ephemeral: true });
        
        processing = false;
        processQueue();
    });

    processQueue();
};
