

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

// ⚙️ PROCESSORE CODA

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


        // ======= ABILITÀ (Richiede Gestione Manuale Admin) =======

        if (currentItem.type === 'ABILITY') {

            const isRB = await db.moderation.isBlockedRB(currentItem.userId);


            if (isRB) {

                await notifyUser(currentItem.userId, '🚫 Abilità annullata: sei in Roleblock.');

                await db.queue.remove(currentItem._id);

                processing = false;

                return processQueue();

            } else {

                await updateDashboard();

                processing = false;

                return;

            }

        }


        // ======= AUTOMAZIONI (Shop, Knock, Return) =======


        // --- HOUSING ---

        if (currentItem.type === 'RETURN' || currentItem.type === 'KNOCK') {

            const isVB = await db.moderation.isBlockedVB(currentItem.userId);

            if (isVB) {

                await notifyUser(currentItem.userId, '🚫 Movimento annullato: sei in Visitblock.');

                if (currentItem.type === 'KNOCK') await db.housing.removePendingKnock(currentItem.userId);

                await db.queue.remove(currentItem._id);

            } else {

                await executeHousingAction(currentItem);

                await db.queue.remove(currentItem._id);

            }

            processing = false;

            return processQueue();

        }


        // --- SHOP ---

        if (currentItem.type === 'SHOP') {

            const subType = currentItem.details?.subType;

            if (subType && subType !== 'acquisto') {

                const { shopEffects } = require('./economySystem');

                const handler = shopEffects[subType];

                if (handler) await handler(clientRef, currentItem.userId, currentItem.details);

            }

            await db.queue.remove(currentItem._id);

            processing = false;

            return processQueue();

        }


        // Tipo sconosciuto: rimuovi e continua

        console.log(`⚠️ [Queue] Tipo sconosciuto: ${currentItem.type}, rimuovo.`);

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

        if (item.type === 'SHOP') label = item.details?.itemName || 'Shop';

        else if (item.type === 'ABILITY') label = item.details?.category || 'ABILITÀ';

        else if (item.type === 'KNOCK') {

             const mode = item.details?.mode || 'normal';

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


            const detailText = queue[0].details?.text || "Nessun dettaglio";

            embed.addFields({ name: '📜 Dettaglio Azione', value: detailText });

        }

    }


    try {

        const messages = await channel.messages.fetch({ limit: 10 });

        const existingMsg = messages.find(m => m.author.id === clientRef.user.id);

        if (existingMsg) await existingMsg.edit({ content: contentText, embeds: [embed], components });

        else await channel.send({ content: contentText, embeds: [embed], components });

    } catch (err) { console.error("Update Dashboard Err:", err); }

}


// ==========================================

// 🎯 HOUSING ACTION EXECUTOR

// ==========================================

async function executeHousingAction(queueItem) {

    let guild = clientRef.guilds.cache.first();

    if (!guild) return;


    const member = await guild.members.fetch(queueItem.userId).catch(() => null);

    if (!member) return;


    let { fromChannelId } = queueItem.details;

    if (!fromChannelId) {

        const currentHome = guild.channels.cache.find(c =>

            c.parentId === HOUSING.CATEGORIA_CASE &&

            c.permissionOverwrites.cache.has(member.id)

        );

        if (currentHome) fromChannelId = currentHome.id;

    }


    if (queueItem.type === 'RETURN') {

        const homeId = await db.housing.getHome(member.id);

        const destroyed = await db.housing.getDestroyedHouses();


        if (homeId && !destroyed.includes(homeId)) {

            const homeCh = guild.channels.cache.get(homeId);

            const fromCh = guild.channels.cache.get(fromChannelId);


            if (homeCh && fromCh && homeCh.id !== fromCh.id) {

                await movePlayer(member, fromCh, homeCh, `🏠 ${member} è ritornato.`, false);

            } else if (homeCh && !fromCh) {

                await movePlayer(member, null, homeCh, `🏠 ${member} è ritornato.`, false);

            }

        }

        return;

    }


    if (queueItem.type === 'KNOCK') {

        const { targetChannelId, mode } = queueItem.details;

        const targetCh = guild.channels.cache.get(targetChannelId);

        const fromCh = guild.channels.cache.get(fromChannelId);


        if (!targetCh) return;

        if (fromCh && fromCh.id === targetCh.id) return;


        if (mode === 'mode_forced' || mode === 'mode_hidden') {

            const msg = mode === 'mode_forced' ? `🧨 ${member} ha sfondato la porta!` : "";

            const silent = mode === 'mode_hidden';

            await enterHouse(member, fromCh, targetCh, msg, silent);

            return;

        }


        const occupants = getOccupants(targetCh, member.id);

        if (occupants.size === 0) {

            await enterHouse(member, fromCh, targetCh, `👋 ${member} è entrato.`, false);

            return;

        }


        const msg = await targetCh.send(`🔔 <@&${RUOLI.ALIVE}> <@&${RUOLI.SPONSOR}> **TOC TOC!** Qualcuno bussa.\n✅ Apri | ❌ Rifiuta`);

        await Promise.all([msg.react('✅'), msg.react('❌')]);

        await db.housing.setActiveKnock(member.id, targetChannelId);


        const filter = (r, u) => ['✅', '❌'].includes(r.emoji.name) && occupants.has(u.id);

        const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });


        collector.on('collect', async (r) => {

            await db.housing.clearActiveKnock(member.id);

            if (r.emoji.name === '✅') {

                await msg.reply("✅ Aperto.");

                const currentFrom = guild.channels.cache.find(c => c.parentId === HOUSING.CATEGORIA_CASE && c.permissionOverwrites.cache.has(member.id));

                await enterHouse(member, currentFrom, targetCh, `👋 ${member} è entrato.`, false, true);

            } else {

                await msg.reply("❌ Rifiutato.");

                const currentFrom = guild.channels.cache.find(c => c.parentId === HOUSING.CATEGORIA_CASE && c.permissionOverwrites.cache.has(member.id));

                if (currentFrom) currentFrom.send(`⛔ ${member}, entrata rifiutata.`).catch(()=>{});

            }

        });


        collector.on('end', async (collected, reason) => {

            if (reason === 'time' && collected.size === 0) {

                await db.housing.clearActiveKnock(member.id);

                await msg.reply("⏱️ Tempo scaduto - Apertura automatica.");

                const currentFrom = guild.channels.cache.find(c => c.parentId === HOUSING.CATEGORIA_CASE && c.permissionOverwrites.cache.has(member.id));

                await enterHouse(member, currentFrom, targetCh, `👋 ${member} è entrato.`, false, true);

            }

        });

    }

}


async function notifyUser(userId, text) {

    const user = await clientRef.users.fetch(userId).catch(() => null);

    if (user) user.send(text).catch(() => {});

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

