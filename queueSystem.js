// ==========================================

// 🚦 QUEUE SYSTEM - Coda Cronologica

// EDIT DASHBOARD + GESTIONE GERARCHICA

// ==========================================

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');

const { QUEUE, RUOLI, HOUSING } = require('./config');

const db = require('./db');

const eventBus = require('./eventBus');

const { movePlayer, enterHouse } = require('./playerMovement');

const { getOccupants } = require('./helpers');


let clientRef = null;

let processing = false;


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
            
            // Trova TUTTE le case dove il player ha permessi
            const housesWithPerms = guild.channels.cache.filter(c =>
                c.parentId === HOUSING.CATEGORIA_CASE &&
                c.permissionOverwrites.cache.has(member.id)
            );

            // LOGICA: Se ho permessi in una casa diversa dalla mia HOME, sono lì.
            const guestHouse = housesWithPerms.find(h => h.id !== homeId);

            // Messaggio uscita PRIMA di togliere i permessi
            if (guestHouse) {
                await guestHouse.send({
                    content: `🚪 ${member} è uscito.`,
                    allowedMentions: { parse: [] }
                }).catch(() => {});
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
            
            // Cerca le case dove ho i permessi (escludendo quella dove sto andando)
            const candidates = guild.channels.cache.filter(c => 
                c.parentId === HOUSING.CATEGORIA_CASE && 
                c.permissionOverwrites.cache.has(member.id) &&
                c.id !== targetCh.id
            );

            // LOGICA DI USCITA DEDUTTIVA:
            // 1. Priorità: Se sono in una casa che NON è la mia Home, esco da lì.
            let oldHouse = candidates.find(c => c.id !== myHomeId);
            
            // 2. Fallback: Se non sono in giro, sono a casa mia.
            if (!oldHouse) oldHouse = candidates.find(c => c.id === myHomeId);
            
            
            // Invia messaggio di uscita (anche se è hidden mode, l'uscita si vede)
            if (oldHouse) {
                await oldHouse.send({
                    content: `🚪 ${member} è uscito.`,
                    allowedMentions: { parse: [] } 
                }).catch(() => {});
            }
            
            await targetCh.permissionOverwrites.edit(member.id, {
                ViewChannel: true, 
                SendMessages: true, 
                ReadMessageHistory: true
            });
            
            if (oldHouse) await oldHouse.permissionOverwrites.delete(member.id).catch(() => {});

            const msg = mode === 'mode_forced' 
                ? `<@&${RUOLI.ALIVE}> <@&${RUOLI.SPONSOR}> 🧨 ${member} ha sfondato la porta ed è entrato!` 
                : "";
            
            const silent = mode === 'mode_hidden';
            
            // Passiamo oldHouse a movePlayer/enterHouse solo per riferimento interno, ma il msg è già mandato
            await enterHouse(member, oldHouse, targetCh, msg, silent);
            return;
        }

        // --- VISITA NORMALE ---
        const occupants = getOccupants(targetCh, member.id);
        
        // Se casa vuota, entra subito
        if (occupants.size === 0) {
            const candidates = guild.channels.cache.filter(c => 
                c.parentId === HOUSING.CATEGORIA_CASE && 
                c.permissionOverwrites.cache.has(member.id) &&
                c.id !== targetCh.id
            );
            
            // LOGICA DEDUTTIVA
            let oldHouse = candidates.find(c => c.id !== myHomeId);
            if (!oldHouse) oldHouse = candidates.find(c => c.id === myHomeId);
            
            if (oldHouse) {
                await oldHouse.send({
                    content: `🚪 ${member} è uscito.`,
                    allowedMentions: { parse: [] }
                }).catch(() => {});
            }
            
            await targetCh.permissionOverwrites.edit(member.id, {
                ViewChannel: true, 
                SendMessages: true, 
                ReadMessageHistory: true
            });
            
            if (oldHouse) await oldHouse.permissionOverwrites.delete(member.id).catch(() => {});

            await enterHouse(member, oldHouse, targetCh, `👋 ${member} è entrato.`, false);
            return;
        }

        // --- TOC TOC (Richiede approvazione) ---
        const msg = await targetCh.send(`🔔 <@&${RUOLI.ALIVE}> <@&${RUOLI.SPONSOR}> **TOC TOC!** Qualcuno bussa.\n✅ Apri | ❌ Rifiuta`);
        await Promise.all([msg.react('✅'), msg.react('❌')]);
        await db.housing.setActiveKnock(member.id, targetChannelId);

        const filter = (r, u) => ['✅', '❌'].includes(r.emoji.name) && occupants.has(u.id);
        const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

        collector.on('collect', async (r) => {
            try {
                await db.housing.clearActiveKnock(member.id);
                if (r.emoji.name === '✅') {
                    await msg.reply({ content: "✅ Qualcuno ha aperto.", allowedMentions: { parse: [] } });
                    
                    const candidates = guild.channels.cache.filter(c => 
                        c.parentId === HOUSING.CATEGORIA_CASE && 
                        c.permissionOverwrites.cache.has(member.id) &&
                        c.id !== targetCh.id
                    );

                    // LOGICA DEDUTTIVA
                    let currentFrom = candidates.find(c => c.id !== myHomeId);
                    if (!currentFrom) currentFrom = candidates.find(c => c.id === myHomeId);
                    
                    if (currentFrom) {
                        await currentFrom.send({
                            content: `🚪 ${member} è uscito.`,
                            allowedMentions: { parse: [] }
                        }).catch(() => {});
                        await currentFrom.permissionOverwrites.delete(member.id).catch(() => {});
                    }
                    
                    await enterHouse(member, currentFrom, targetCh, `👋 ${member} è entrato.`, false, true);
                } else {
                    await msg.reply({ content: "❌ Qualcuno ha rifiutato.", allowedMentions: { parse: [] } });
                    
                    const candidates = guild.channels.cache.filter(c => 
                        c.parentId === HOUSING.CATEGORIA_CASE && 
                        c.permissionOverwrites.cache.has(member.id)
                    );
                    
                    // Notifica rifiuto dove si trova l'utente realmente
                    let currentFrom = candidates.find(c => c.id !== myHomeId);
                    if (!currentFrom) currentFrom = candidates.find(c => c.id === myHomeId);

                    if (currentFrom) {
                        currentFrom.send({
                            content: `⛔ ${member}, entrata rifiutata.`,
                            allowedMentions: { parse: [] }
                        }).catch(()=>{});
                    }
                }
            } catch (err) {
                console.error("❌ Errore nel collector.on('collect'):", err);
            }
        });

        collector.on('end', async (collected, reason) => {
            try {
                if (reason === 'time' && collected.size === 0) {
                    await db.housing.clearActiveKnock(member.id);
                    await msg.reply("⏱️ Tempo scaduto - Apertura automatica.");
                    
                    const candidates = guild.channels.cache.filter(c => 
                        c.parentId === HOUSING.CATEGORIA_CASE && 
                        c.permissionOverwrites.cache.has(member.id) &&
                        c.id !== targetCh.id
                    );
                    
                    let currentFrom = candidates.find(c => c.id !== myHomeId);
                    if (!currentFrom) currentFrom = candidates.find(c => c.id === myHomeId);
                    
                    if (currentFrom) {
                        await currentFrom.send({
                            content: `🚪 ${member} è uscito.`,
                            allowedMentions: { parse: [] }
                        }).catch(() => {});
                        await currentFrom.permissionOverwrites.delete(member.id).catch(() => {});
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
