// ==========================================
// 🚦 QUEUE SYSTEM - Coda Cronologica
// EDIT DASHBOARD + BLOCCO FASE PRESET
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
            return;
        }

        // ============================================================
        // 🔒 BLOCCO FASE PRESET (!fine preset)
        // Se la fase è attiva, le ABILITÀ rimangono in coda ma NON vengono eseguite/mostrate agli admin
        // ============================================================
        const isPresetPhaseActive = await db.moderation.isPresetPhaseActive();
        
        if (currentItem.type === 'ABILITY' && isPresetPhaseActive) {
            // Se è un'abilità e la fase è bloccata, STOP.
            // Non rimuoviamo l'item, semplicemente fermiamo il processore.
            // L'item rimane "Primo in coda" ma bloccato.
            // Aggiorniamo la dashboard dicendo che è in pausa.
            await updateDashboard(true); // true = paused state
            return;
        }

        console.log(`📌 [Queue] Processo: ${currentItem.type} di ${currentItem.userId}`);

        // ======= ABILITÀ → Check RB =======
        if (currentItem.type === 'ABILITY') {
            const isRB = await db.moderation.isBlockedRB(currentItem.userId);
            if (isRB) {
                await notifyUser(currentItem.userId, '🚫 Abilità annullata: sei in Roleblock.');
                await db.queue.remove(currentItem._id);
                // Riprocessa subito il prossimo
                processing = false; return processQueue();
            } else {
                // Abilità valida: Mostra dashboard per approvazione Admin
                await updateDashboard();
                return; // Aspetta input admin
            }
        }

        // ======= HOUSING =======
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
            processing = false; return processQueue();
        }

        // ======= SHOP =======
        if (currentItem.type === 'SHOP') {
            const subType = currentItem.details?.subType;
            if (subType && subType !== 'acquisto') {
                const { shopEffects } = require('./economySystem');
                const handler = shopEffects[subType];
                if (handler) await handler(clientRef, currentItem.userId, currentItem.details);
            }
            await db.queue.remove(currentItem._id);
            processing = false; return processQueue();
        }

    } catch (err) {
        console.error("❌ Errore processQueue:", err);
    } finally {
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
    
    // Se siamo in pausa (!fine preset non ancora dato), filtriamo visivamente o mostriamo avviso
    const isPhaseBlocked = await db.moderation.isPresetPhaseActive();

    let description = queue.length === 0 ? "✅ **Nessuna azione in attesa.**" : "";

    if (isPhaseBlocked && queue.length > 0 && queue[0].type === 'ABILITY') {
        description = "🔒 **FASE PRESET ATTIVA**\nLe abilità sono bloccate fino al comando `!fine preset`.\n\n";
    }

    queue.forEach((item, index) => {
        const time = `<t:${Math.floor(new Date(item.timestamp).getTime() / 1000)}:T>`;
        const icons = { ABILITY: "✨", RETURN: "🏠", KNOCK: "✊", SHOP: "🛒" };
        const label = item.type === 'SHOP' ? (item.details?.itemName || 'Shop') : item.type;
        const pointer = index === 0 ? "👉" : `**#${index + 1}**`;
        
        description += `${pointer} ${icons[item.type] || ""} \`${label}\` <@${item.userId}> (${time})\n`;
    });

    const embed = new EmbedBuilder()
        .setTitle("📋 Coda Azioni Cronologica")
        .setColor(isPhaseBlocked ? 'Orange' : (queue.length > 0 && queue[0].type === 'ABILITY' ? 'Yellow' : 'Green'))
        .setDescription(description)
        .setTimestamp();

    let components = [];
    let contentText = " ";

    if (queue.length > 0 && !isPhaseBlocked) {
        if (queue[0].type === 'ABILITY') {
            contentText = `<@&${RUOLI.ADMIN_QUEUE}> 🔔 **Nuova richiesta in coda!**`;
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`q_approve_${queue[0]._id}`).setLabel('✅ Approva').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`q_reject_${queue[0]._id}`).setLabel('❌ Rifiuta').setStyle(ButtonStyle.Danger),
            ));
            embed.addFields({ name: '📜 Dettaglio', value: queue[0].details?.text || "..." });
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
    const allHomes = await db.housing.getAllHomes();
    let guild = clientRef.guilds.cache.first(); 
    if (!guild) return;

    const member = await guild.members.fetch(queueItem.userId).catch(() => null);
    if (!member) return;

    if (queueItem.type === 'RETURN') {
        const homeId = await db.housing.getHome(member.id);
        const destroyed = await db.housing.getDestroyedHouses();
        if (homeId && !destroyed.includes(homeId)) {
            const homeCh = guild.channels.cache.get(homeId);
            const fromCh = guild.channels.cache.get(queueItem.details.fromChannelId);
            if (homeCh) await movePlayer(member, fromCh, homeCh, `🏠 ${member} è ritornato.`, false);
        }
        return;
    }

    if (queueItem.type === 'KNOCK') {
        const { targetChannelId, mode, fromChannelId } = queueItem.details;
        const targetCh = guild.channels.cache.get(targetChannelId);
        const fromCh = guild.channels.cache.get(fromChannelId);
        if (!targetCh) return;

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

        const msg = await targetCh.send(`🔔 **TOC TOC!** Qualcuno bussa.\n✅ Apri | ❌ Rifiuta`);
        await Promise.all([msg.react('✅'), msg.react('❌')]);
        await db.housing.setActiveKnock(member.id, targetChannelId);

        const filter = (r, u) => ['✅', '❌'].includes(r.emoji.name) && occupants.has(u.id);
        const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

        collector.on('collect', async (r) => {
            await db.housing.clearActiveKnock(member.id);
            if (r.emoji.name === '✅') {
                await msg.reply("✅ Aperto.");
                await enterHouse(member, fromCh, targetCh, `👋 ${member} è entrato.`, false, true);
            } else {
                await msg.reply("❌ Rifiutato.");
                if (fromCh) fromCh.send(`⛔ ${member}, entrata rifiutata.`).catch(()=>{});
            }
        });
        
        // Timeout handling... (come codice precedente)
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
        if (!i.isButton() || !i.customId.startsWith('q_')) return;
        
        const action = i.customId.includes('approve') ? 'APPROVE' : 'REJECT';
        const id = i.customId.split('_')[2];
        const item = await db.queue.findById(id);
        
        if (!item) return i.reply({ content: "❌ Già gestita.", ephemeral: true });

        // Double check RB su Approve
        if (action === 'APPROVE' && item.type === 'ABILITY') {
            if (await db.moderation.isBlockedRB(item.userId)) {
                await db.queue.remove(id);
                await i.reply("🚫 Annullata: Roleblock.");
                return processQueue();
            }
        }

        await db.queue.remove(id);
        await i.reply({ content: `✅ ${action === 'APPROVE' ? 'Approvata' : 'Rifiutata'}.`, ephemeral: true });
        processQueue();
    });

    processQueue();
};
