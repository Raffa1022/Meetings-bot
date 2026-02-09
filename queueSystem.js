// ==========================================
// 🚦 QUEUE SYSTEM - Coda Cronologica
// Processa azioni in ordine, dashboard admin
// ==========================================
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { QUEUE, RUOLI, RUOLI_PERMESSI, HOUSING } = require('./config');
const db = require('./db');
const eventBus = require('./eventBus');
const { movePlayer, enterHouse } = require('./playerMovement');
const { getOccupants } = require('./helpers');
const { PermissionsBitField } = require('discord.js');

let clientRef = null;
let processing = false; // Lock per evitare esecuzioni parallele

// ==========================================
// 📊 DASHBOARD
// ==========================================
async function updateDashboard() {
    const channel = clientRef.channels.cache.get(QUEUE.CANALE_LOG);
    if (!channel) return;

    const queue = await db.queue.getPending();

    let description = queue.length === 0
        ? "✅ **Nessuna azione in attesa.**"
        : "";

    queue.forEach((item, index) => {
        const time = `<t:${Math.floor(new Date(item.timestamp).getTime() / 1000)}:T>`;
        const icons = { ABILITY: "✨", RETURN: "🏠", KNOCK: "✊", SHOP: "🛒" };
        const names = { ABILITY: "ABILITÀ", RETURN: "TORNA", KNOCK: "BUSSA", SHOP: "SHOP" };
        const pointer = index === 0 ? "👉 **IN CORSO:**" : `**#${index + 1}**`;
        let label = `${icons[item.type] || ""} \`${names[item.type] || item.type}\``;
        if (item.type === 'SHOP' && item.details?.subType) {
            const shopNames = { acquisto: '🛒 Acquisto', scopa: '🧹 Scopa', lettera: '✉️ Lettera', scarpe: '👟 Scarpe', testamento: '📜 Testamento', catene: '⛓️ Catene', fuochi: '🎆 Fuochi', tenda: '⛺ Tenda' };
            label = `\`${shopNames[item.details.subType] || item.details.subType}\``;
        }
        description += `${pointer} ${label} - <@${item.userId}> (${time})\n`;
    });

    const embed = new EmbedBuilder()
        .setTitle("📋 Coda Azioni Cronologica")
        .setColor(queue.length > 0 && queue[0].type === 'ABILITY' ? 'Yellow' : 'Green')
        .setDescription(description)
        .setFooter({ text: "Housing automatico | Abilità richiede approvazione" })
        .setTimestamp();

    let components = [];
    let contentText = null;

    if (queue.length > 0) {
        contentText = `<@&${RUOLI.ADMIN_QUEUE}> 🔔 **Nuova richiesta in coda!**`;
        if (queue[0].type === 'ABILITY') {
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`q_approve_${queue[0]._id}`).setLabel('✅ Approva & Esegui').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`q_reject_${queue[0]._id}`).setLabel('❌ Rifiuta & Rimuovi').setStyle(ButtonStyle.Danger),
            ));
            embed.addFields({ name: '📜 Dettaglio Abilità', value: queue[0].details?.text || "Nessun testo" });
        }
        if (queue[0].type === 'SHOP') {
            embed.addFields({ name: '🛒 Dettaglio Shop', value: queue[0].details?.text || "Nessun dettaglio" });
        }
    }

    // Pulisci vecchi messaggi
    try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMsgs = messages.filter(m => m.author.id === clientRef.user.id);
        if (botMsgs.size > 0) await channel.bulkDelete(botMsgs).catch(() => {});
    } catch {}

    await channel.send({ content: contentText, embeds: [embed], components });
}

// ==========================================
// ⚙️ PROCESSORE CODA
// ==========================================
async function processQueue() {
    if (processing) return; // Evita esecuzioni parallele
    processing = true;

    try {
        const currentItem = await db.queue.getFirst();

        if (!currentItem) {
            await updateDashboard();
            return;
        }

        console.log(`📌 [Queue] Primo: ${currentItem.type} di ${currentItem.userId}`);

        // ABILITÀ → STOP, attendi admin
        if (currentItem.type === 'ABILITY') {
            await updateDashboard();
            return;
        }

        // HOUSING → Esegui automaticamente
        if (currentItem.type === 'RETURN' || currentItem.type === 'KNOCK') {
            try {
                await executeHousingAction(currentItem);
            } catch (err) {
                console.error(`❌ [Queue] Errore ${currentItem.type}:`, err);
            }
            await db.queue.remove(currentItem._id);
            await new Promise(r => setTimeout(r, 300)); // Anti-race
        }

        // SHOP → Esegui effetto automaticamente (come KNOCK/RETURN)
        if (currentItem.type === 'SHOP') {
            const subType = currentItem.details?.subType;
            console.log(`🛒 [Queue] Eseguo SHOP (${subType}) di ${currentItem.userId}`);

            // Acquisti: nessun effetto da eseguire (già processati)
            // Use actions: esegui l'effetto tramite shopEffects
            if (subType && subType !== 'acquisto') {
                try {
                    const { shopEffects } = require('./economySystem');
                    const handler = shopEffects[subType];
                    if (handler) await handler(clientRef, currentItem.userId, currentItem.details);
                } catch (err) {
                    console.error(`❌ [Queue] Errore SHOP ${subType}:`, err);
                }
            }

            await db.queue.remove(currentItem._id);
            await new Promise(r => setTimeout(r, 300));
        }
    } finally {
        processing = false;
    }

    // Ricorsione: processa il prossimo
    return processQueue();
}

// ==========================================
// 🎯 ESECUTORE HOUSING
// ==========================================
async function executeHousingAction(queueItem) {
    console.log(`🎯 [Housing] Eseguo ${queueItem.type} per ${queueItem.userId}`);

    // Trova il guild
    const allHomes = await db.housing.getAllHomes();
    let guild = null;
    const firstHomeId = Object.values(allHomes)[0];
    if (firstHomeId) {
        const ch = await clientRef.channels.fetch(firstHomeId).catch(() => null);
        guild = ch?.guild;
    }
    if (!guild) guild = clientRef.guilds.cache.first();
    if (!guild) return console.error("❌ [Housing] Guild non trovata.");

    const member = await guild.members.fetch(queueItem.userId).catch(() => null);
    if (!member) return console.warn(`⚠️ [Housing] Membro ${queueItem.userId} non trovato.`);

    // ========== TORNA ==========
    if (queueItem.type === 'RETURN') {
        const homeId = await db.housing.getHome(member.id);
        const destroyed = await db.housing.getDestroyedHouses();
        if (homeId && !destroyed.includes(homeId)) {
            const homeChannel = guild.channels.cache.get(homeId);
            const fromChannel = guild.channels.cache.get(queueItem.details.fromChannelId);
            if (homeChannel) {
                await movePlayer(member, fromChannel, homeChannel, `🏠 ${member} è ritornato.`, false);
                console.log(`✅ [Housing] ${member.user.tag} è tornato a casa.`);
            }
        }
        return;
    }

    // ========== BUSSA ==========
    if (queueItem.type === 'KNOCK') {
        const { targetChannelId, mode, fromChannelId } = queueItem.details;
        const targetChannel = guild.channels.cache.get(targetChannelId);
        const fromChannel = guild.channels.cache.get(fromChannelId);
        if (!targetChannel || !fromChannel) return console.error("❌ [Housing] Canali non trovati per KNOCK.");

        // A. Forzata
        if (mode === 'mode_forced') {
            const mentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(', ');
            await enterHouse(member, fromChannel, targetChannel, `${mentions}, ${member} ha sfondato la porta ed è entrato`, false);
            return;
        }

        // B. Nascosta
        if (mode === 'mode_hidden') {
            await enterHouse(member, fromChannel, targetChannel, "", true);
            return;
        }

        // C. Normale → TOC TOC
        const occupants = getOccupants(targetChannel, member.id);

        if (occupants.size === 0) {
            await enterHouse(member, fromChannel, targetChannel, `👋 ${member} è entrato.`, false);
            return;
        }

        const mentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(' ');
        const msg = await targetChannel.send(`🔔 **TOC TOC!** ${mentions}\nQualcuno sta bussando\n✅ = Apri | ❌ = Rifiuta`);
        await Promise.all([msg.react('✅'), msg.react('❌')]);

        // Segna bussata attiva: blocca !bussa e !torna finché non risolta
        await db.housing.setActiveKnock(member.id, targetChannelId);

        const filter = (reaction, user) =>
            ['✅', '❌'].includes(reaction.emoji.name) &&
            getOccupants(targetChannel, member.id).has(user.id);

        const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

        // Monitor: se tutti escono, entra
        const monitor = setInterval(() => {
            if (getOccupants(targetChannel, member.id).size === 0) {
                collector.stop('everyone_left');
            }
        }, 2000);

        collector.on('collect', async (reaction) => {
            clearInterval(monitor);
            // Pulisci activeKnock per il bussante E il partner (gestisce !cambio)
            await db.housing.clearActiveKnock(member.id);
            const partnerSponsor = await db.meeting.findSponsor(member.id);
            const partnerPlayer = await db.meeting.findPlayer(member.id);
            if (partnerSponsor) await db.housing.clearActiveKnock(partnerSponsor);
            if (partnerPlayer) await db.housing.clearActiveKnock(partnerPlayer);

            if (reaction.emoji.name === '✅') {
                await msg.reply("✅ Qualcuno ha aperto.");
                // FIX: Forza narrazione anche se il ruolo è cambiato (dopo !cambio)
                await enterHouse(member, fromChannel, targetChannel, `👋 ${member} è entrato.`, false, true);
            } else {
                await msg.reply("❌ Qualcuno ha rifiutato.");
                const present = [];
                targetChannel.permissionOverwrites.cache.forEach((ow, id) => {
                    if (ow.type === 1) {
                        const m = targetChannel.members.get(id);
                        if (m && !m.user.bot && m.id !== member.id && !m.permissions.has(PermissionsBitField.Flags.Administrator)
                            && m.roles.cache.has(RUOLI.ALIVE))
                            present.push(m.displayName);
                    }
                });
                if (fromChannel) {
                    await fromChannel.send(`⛔ ${member}, entrata rifiutata. Giocatori presenti: ${present.join(', ') || 'Nessuno'}`);
                }
            }
        });

        collector.on('end', async (collected, reason) => {
            clearInterval(monitor);
            // Pulisci activeKnock per il bussante E il partner (gestisce !cambio)
            await db.housing.clearActiveKnock(member.id);
            const partnerSponsor = await db.meeting.findSponsor(member.id);
            const partnerPlayer = await db.meeting.findPlayer(member.id);
            if (partnerSponsor) await db.housing.clearActiveKnock(partnerSponsor);
            if (partnerPlayer) await db.housing.clearActiveKnock(partnerPlayer);

            if (reason === 'everyone_left') {
                await msg.reply("🚪 La casa si è svuotata.");
                // FIX: Forza narrazione anche se il ruolo è cambiato (dopo !cambio)
                await enterHouse(member, fromChannel, targetChannel, `👋 ${member} è entrato (casa libera).`, false, true);
            } else if (collected.size === 0 && reason !== 'limit') {
                await msg.reply("⏳ Nessuno ha risposto. La porta viene forzata.");
                // FIX: Forza narrazione anche se il ruolo è cambiato (dopo !cambio)
                await enterHouse(member, fromChannel, targetChannel, `👋 ${member} è entrato.`, false, true);
            }
        });
    }
}

// ==========================================
// 🚀 INIT
// ==========================================
module.exports = function initQueueSystem(client) {
    clientRef = client;

    // Ascolta richieste di aggiunta alla coda
    eventBus.on('queue:add', async ({ type, userId, details }) => {
        await db.queue.add(type, userId, details);
        console.log(`➕ [Queue] Aggiunto ${type} per ${userId}`);
        processQueue();
    });

    // Ascolta richieste di processare
    eventBus.on('queue:process', () => processQueue());

    // Bottoni admin approve/reject
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('q_')) return;

        const action = interaction.customId.startsWith('q_approve') ? 'APPROVE' : 'REJECT';
        const itemId = interaction.customId.split('_')[2];

        const item = await db.queue.findById(itemId);
        if (!item) return interaction.reply({ content: "❌ Già gestita.", ephemeral: true });

        await db.queue.remove(itemId);
        await interaction.reply({
            content: `✅ Abilità ${action === 'APPROVE' ? 'approvata' : 'rifiutata'}. Elaboro le prossime...`,
            ephemeral: true
        });

        processQueue();
    });

    // Avvia processamento
    processQueue();
    console.log("🚦 [Queue] Sistema Cronologico Inizializzato.");

    // Check giornaliero reset
    checkDailyReset();
};

// ==========================================
// 🔄 RESET GIORNALIERO
// ==========================================
async function checkDailyReset() {
    const today = new Date().toDateString();
    const lastReset = await db.housing.getLastReset();
    if (lastReset !== today) {
        const mode = await db.housing.getMode();
        await db.housing.applyLimitsForMode(mode);
        await db.housing.setLastReset(today);
        console.log("🔄 [Housing] Contatori ripristinati per nuovo giorno.");
    }
}
