// ==========================================
// 💰 ECONOMY SYSTEM - Mercato & Inventario
// 100% Atomico - Zero .save(), solo $set/$inc/$pull
// Integrato con Housing, Moderazione, Meeting
// ==========================================
const mongoose = require('mongoose');
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    ChannelType, PermissionsBitField
} = require('discord.js');
const { HOUSING, RUOLI, RUOLI_PUBBLICI, PREFIX } = require('./config');
const db = require('./db');
const { isAdmin, formatName, getSponsorsToMove } = require('./helpers');
const { cleanOldHome } = require('./playerMovement');
const eventBus = require('./eventBus');

// ==========================================
// 📊 SCHEMA & MODELLO MONGODB
// ==========================================
const economySchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    balance: { type: Number, default: 0 },
    inventory: { type: Object, default: {} },       // { itemId: quantity } → $inc atomico
    totalEarned: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    testamentoActive: { type: Array, default: [] }, // [channelId] - canali diurni sbloccati
}, { minimize: false, versionKey: false });

const EconomyModel = mongoose.model('EconomyData', economySchema);

// ==========================================
// 🛒 SHOP - OGGETTI DISPONIBILI
// ==========================================
const SHOP_ITEMS = [
    { id: 'scopa',      name: 'Scopa',                price: 25,  emoji: '🧹', description: 'Cancella messaggi in una casa (rispondi al msg da cui iniziare). Reagisci 🛡️ ai messaggi da proteggere.' },
    { id: 'lettera',    name: 'Lettera',               price: 90,  emoji: '✉️', description: 'Invia un messaggio anonimo (max 10 parole) a un giocatore.' },
    { id: 'scarpe',     name: 'Scarpe',                price: 125, emoji: '👟', description: 'Ottieni +1 visita base aggiuntiva.' },
    { id: 'testamento', name: 'Testamento',            price: 80,  emoji: '📜', description: 'Permette di inviare 1 messaggio nella chat diurna (solo dead).' },
    { id: 'catene',     name: 'Catene',                price: 500, emoji: '⛓️', description: 'Blocca un giocatore (Visitblock + Roleblock).' },
    { id: 'fuochi',     name: 'Fuochi d\'artificio',   price: 100, emoji: '🎆', description: 'Annuncia la tua presenza in una casa nel canale annunci.' },
    { id: 'tenda',      name: 'Tenda',                 price: 35,  emoji: '⛺', description: 'Trasferisciti nella casa dove ti trovi.' },
];

// ==========================================
// 🗄️ REPOSITORY ECONOMIA - 100% ATOMICO
// ==========================================
const econDb = {
    // --- LETTURE ---
    async getProfile(userId) {
        return EconomyModel.findOne({ userId }).lean();
    },

    async getBalance(userId) {
        const doc = await EconomyModel.findOne({ userId }, { balance: 1 }).lean();
        return doc?.balance || 0;
    },

    async getInventory(userId) {
        const doc = await EconomyModel.findOne({ userId }, { inventory: 1 }).lean();
        return doc?.inventory || {};
    },

    async hasItem(userId, itemId, quantity = 1) {
        const doc = await EconomyModel.findOne(
            { userId, [`inventory.${itemId}`]: { $gte: quantity } },
            { _id: 1 }
        ).lean();
        return !!doc;
    },

    async getTestamentoChannels(userId) {
        const doc = await EconomyModel.findOne({ userId }, { testamentoActive: 1 }).lean();
        return doc?.testamentoActive || [];
    },

    // --- SCRITTURE ATOMICHE ---
    async ensureProfile(userId) {
        return EconomyModel.findOneAndUpdate(
            { userId },
            { $setOnInsert: { userId, balance: 0, inventory: {}, totalEarned: 0, totalSpent: 0, testamentoActive: [] } },
            { upsert: true, new: true, lean: true }
        );
    },

    async addBalance(userId, amount) {
        return EconomyModel.updateOne(
            { userId },
            {
                $inc: { balance: amount, totalEarned: amount },
                $setOnInsert: { userId, inventory: {}, totalSpent: 0, testamentoActive: [] }
            },
            { upsert: true }
        );
    },

    async removeBalance(userId, amount) {
        const result = await EconomyModel.updateOne(
            { userId, balance: { $gte: amount } },
            { $inc: { balance: -amount, totalSpent: amount } }
        );
        return result.modifiedCount > 0;
    },

    async setBalance(userId, amount) {
        return EconomyModel.updateOne(
            { userId },
            { $set: { balance: amount } },
            { upsert: true }
        );
    },

    async addItem(userId, itemId, quantity = 1) {
        return EconomyModel.updateOne(
            { userId },
            {
                $inc: { [`inventory.${itemId}`]: quantity },
                $setOnInsert: { userId, balance: 0, totalEarned: 0, totalSpent: 0, testamentoActive: [] }
            },
            { upsert: true }
        );
    },

    async removeItem(userId, itemId, quantity = 1) {
        const result = await EconomyModel.updateOne(
            { userId, [`inventory.${itemId}`]: { $gte: quantity } },
            { $inc: { [`inventory.${itemId}`]: -quantity } }
        );
        if (result.modifiedCount > 0) {
            // Cleanup: rimuovi chiave se quantity <= 0
            await EconomyModel.updateOne(
                { userId, [`inventory.${itemId}`]: { $lte: 0 } },
                { $unset: { [`inventory.${itemId}`]: '' } }
            );
            return true;
        }
        return false;
    },

    async addTestamentoChannel(userId, channelId) {
        return EconomyModel.updateOne(
            { userId },
            { $addToSet: { testamentoActive: channelId } }
        );
    },

    async removeTestamentoChannel(userId, channelId) {
        return EconomyModel.updateOne(
            { userId },
            { $pull: { testamentoActive: channelId } }
        );
    },

    async clearTestamento(userId) {
        return EconomyModel.updateOne(
            { userId },
            { $set: { testamentoActive: [] } }
        );
    },

    // Bulk: pagamento a tutti
    async bulkAddBalance(userIds, amount) {
        if (userIds.length === 0) return { ok: 0 };
        const ops = userIds.map(uid => ({
            updateOne: {
                filter: { userId: uid },
                update: {
                    $inc: { balance: amount, totalEarned: amount },
                    $setOnInsert: { userId: uid, inventory: {}, totalSpent: 0, testamentoActive: [] }
                },
                upsert: true
            }
        }));
        return EconomyModel.bulkWrite(ops);
    },

    // Classifica
    async getTopBalances(limit = 10) {
        return EconomyModel.find({}, { userId: 1, balance: 1 })
            .sort({ balance: -1 })
            .limit(limit)
            .lean();
    },

    // 🔄 SWAP ECONOMY DATA (per comando !cambio)
    async swapEconomyData(p1Id, p2Id) {
        const [prof1, prof2] = await Promise.all([
            EconomyModel.findOne({ userId: p1Id }).lean(),
            EconomyModel.findOne({ userId: p2Id }).lean()
        ]);
        const data1 = { balance: prof1?.balance || 0, inventory: prof1?.inventory || {}, totalEarned: prof1?.totalEarned || 0, totalSpent: prof1?.totalSpent || 0 };
        const data2 = { balance: prof2?.balance || 0, inventory: prof2?.inventory || {}, totalEarned: prof2?.totalEarned || 0, totalSpent: prof2?.totalSpent || 0 };
        await Promise.all([
            EconomyModel.updateOne({ userId: p1Id }, { $set: { balance: data2.balance, inventory: data2.inventory, totalEarned: data2.totalEarned, totalSpent: data2.totalSpent } }, { upsert: true }),
            EconomyModel.updateOne({ userId: p2Id }, { $set: { balance: data1.balance, inventory: data1.inventory, totalEarned: data1.totalEarned, totalSpent: data1.totalSpent } }, { upsert: true })
        ]);
    },
};

// ==========================================
// 📬 CACHE LETTERE (con auto-scadenza)
// ==========================================
const letteraCache = new Map();
function setLetteraCache(key, value) {
    letteraCache.set(key, value);
    setTimeout(() => letteraCache.delete(key), 5 * 60 * 1000); // 5 min
}

// ==========================================
// 🔧 HELPER: Trova partner (sponsor/player)
// ==========================================
async function findPartner(member, guild) {
    let partnerId = null;
    if (member.roles.cache.has(RUOLI.ALIVE) || member.roles.cache.has(RUOLI.DEAD)) {
        partnerId = await db.meeting.findSponsor(member.id);
    } else if (member.roles.cache.has(RUOLI.SPONSOR) || member.roles.cache.has(RUOLI.SPONSOR_DEAD)) {
        partnerId = await db.meeting.findPlayer(member.id);
    }
    if (!partnerId) return null;
    try { return await guild.members.fetch(partnerId); } catch { return null; }
}

// ==========================================
// 📝 LOG AZIONI SHOP → Coda cronologica (eventBus)
// ==========================================
let clientRef = null;

function emitShopAction(userId, subType, text) {
    eventBus.emit('queue:add', {
        type: 'SHOP',
        userId,
        details: { subType, text }
    });
}

// ==========================================
// 💰 MODULO PRINCIPALE
// ==========================================
module.exports = function initEconomySystem(client) {
    clientRef = client;
    console.log("💰 [Economy] Sistema caricato (100% atomico).");

    // --- COMANDI ---
    client.on('messageCreate', async message => {
        if (message.author.bot || !message.content.startsWith(PREFIX)) return;
        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        try {
            switch (command) {
                case 'pagamento':   return await handlePagamento(message, args);
                case 'bilancio':    return await handleBilancio(message, args);
                case 'inventario':  return await handleInventario(message);
                case 'paga':        return await handlePaga(message, args);
                case 'mercato':     return await handleMercato(message);
                case 'compra':      return await handleCompra(message, args);
                case 'usa':         return await handleUsa(message, args, client);
                case 'classifica':  return await handleClassifica(message);
                case 'ritira':      return await handleRitira(message, args);
                case 'regala':      return await handleRegala(message, args);
            }
        } catch (err) {
            console.error(`❌ [Economy] Errore comando ${command}:`, err);
            message.reply("❌ Errore interno economia.").catch(() => {});
        }
    });

    // --- INTERAZIONI (Lettera, Testamento) ---
    client.on('interactionCreate', async interaction => {
        try {
            // ========== BOTTONE LETTERA: APRI MODAL ==========
            if (interaction.isButton() && interaction.customId.startsWith('lettera_open_')) {
                const parts = interaction.customId.split('_');
                const targetUserId = parts[2];
                const senderUserId = parts[3];
                if (interaction.user.id !== senderUserId)
                    return interaction.reply({ content: "❌ Non è tuo.", ephemeral: true });

                const modal = new ModalBuilder()
                    .setCustomId(`lettera_write_${targetUserId}_${senderUserId}`)
                    .setTitle('✉️ Scrivi la tua Lettera');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('lettera_content')
                        .setLabel('Messaggio (max 10 parole)')
                        .setStyle(TextInputStyle.Paragraph)
                        .setMaxLength(200)
                        .setPlaceholder('Scrivi il tuo messaggio...')
                        .setRequired(true)
                ));
                await interaction.showModal(modal);
            }

            // ========== MODAL LETTERA: SUBMIT ==========
            else if (interaction.isModalSubmit() && interaction.customId.startsWith('lettera_write_')) {
                const parts = interaction.customId.split('_');
                const targetUserId = parts[2];
                const senderUserId = parts[3];
                if (interaction.user.id !== senderUserId)
                    return interaction.reply({ content: "❌ Errore.", ephemeral: true });

                const content = interaction.fields.getTextInputValue('lettera_content');
                if (content.trim().split(/\s+/).length > 10)
                    return interaction.reply({ content: `❌ Massimo 10 parole!`, ephemeral: true });

                setLetteraCache(`${senderUserId}_${targetUserId}`, content);

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`lettera_confirm_${targetUserId}_${senderUserId}`)
                        .setLabel('✅ Conferma Invio').setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('lettera_cancel')
                        .setLabel('❌ Annulla').setStyle(ButtonStyle.Danger)
                );
                const embed = new EmbedBuilder()
                    .setColor('#3498DB').setTitle('✉️ Anteprima Lettera')
                    .setDescription(`**Destinatario:** <@${targetUserId}>\n\n**Messaggio:**\n${content}`);
                await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
            }

            // ========== BOTTONE LETTERA: CONFERMA ==========
            else if (interaction.isButton() && interaction.customId.startsWith('lettera_confirm_')) {
                const parts = interaction.customId.split('_');
                const targetUserId = parts[2];
                const senderUserId = parts[3];
                if (interaction.user.id !== senderUserId)
                    return interaction.reply({ content: "❌ Non è tuo.", ephemeral: true });

                const content = letteraCache.get(`${senderUserId}_${targetUserId}`);
                if (!content)
                    return interaction.update({ content: "❌ Messaggio scaduto. Riprova.", embeds: [], components: [] });

                const removed = await econDb.removeItem(senderUserId, 'lettera');
                if (!removed)
                    return interaction.update({ content: "❌ Non possiedi più la lettera.", embeds: [], components: [] });

                // Trova chat privata del destinatario
                const catPriv = interaction.guild.channels.cache.get(HOUSING.CATEGORIA_CHAT_PRIVATE);
                const targetChannel = catPriv?.children.cache.find(ch =>
                    ch.type === ChannelType.GuildText &&
                    ch.permissionOverwrites.cache.some(p => p.id === targetUserId && p.allow.has(PermissionsBitField.Flags.ViewChannel))
                );

                if (!targetChannel)
                    return interaction.update({ content: "❌ Chat privata del destinatario non trovata.", embeds: [], components: [] });

                await targetChannel.send({ embeds: [
                    new EmbedBuilder().setColor('#E74C3C').setTitle('✉️ Lettera Anonima')
                        .setDescription(content).setFooter({ text: 'Mittente sconosciuto' }).setTimestamp()
                ]});

                letteraCache.delete(`${senderUserId}_${targetUserId}`);
                await interaction.update({ content: "✅ Lettera inviata!", embeds: [], components: [] });
                
                // 📝 Log uso lettera
                emitShopAction(senderUserId, '✉️ Lettera', `👤 Destinatario: <@${targetUserId}>
📝 Messaggio: "${content}"`);
                
                if (interaction.message?.deletable) setTimeout(() => interaction.message.delete().catch(() => {}), 5000);
            }

            // ========== BOTTONE LETTERA: ANNULLA ==========
            else if (interaction.isButton() && interaction.customId === 'lettera_cancel') {
                await interaction.update({ content: "❌ Invio annullato.", embeds: [], components: [] });
            }

            // ========== MENU LETTERA: SELEZIONE TARGET (TENDINA) ==========
            else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('lettera_target_')) {
                const senderUserId = interaction.customId.split('_')[2];
                if (interaction.user.id !== senderUserId)
                    return interaction.reply({ content: "❌ Non è tuo.", ephemeral: true });

                const targetUserId = interaction.values[0];
                // Apri modal per scrivere il messaggio
                const modal = new ModalBuilder()
                    .setCustomId(`lettera_write_${targetUserId}_${senderUserId}`)
                    .setTitle('✉️ Scrivi la tua Lettera');
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('lettera_content')
                        .setLabel('Messaggio (max 10 parole)')
                        .setStyle(TextInputStyle.Paragraph)
                        .setMaxLength(200)
                        .setPlaceholder('Scrivi il tuo messaggio...')
                        .setRequired(true)
                ));
                await interaction.showModal(modal);
                // Cancella menu tendina
                if (interaction.message?.deletable) interaction.message.delete().catch(() => {});
            }

            // ========== MENU TESTAMENTO: SELEZIONE CANALE ==========
            else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('testamento_channel_')) {
                const senderUserId = interaction.customId.split('_')[2];
                if (interaction.user.id !== senderUserId)
                    return interaction.reply({ content: "❌ Non è tuo.", ephemeral: true });

                const channelId = interaction.values[0];
                const channel = interaction.guild.channels.cache.get(channelId);
                if (!channel) return interaction.update({ content: "❌ Canale non trovato.", components: [] });

                // Rimuovi oggetto
                const removed = await econDb.removeItem(senderUserId, 'testamento');
                if (!removed) return interaction.update({ content: "❌ Non possiedi più il testamento.", components: [] });

                // Concedi permesso SendMessages (overwrite utente)
                await channel.permissionOverwrites.create(senderUserId, { SendMessages: true, ViewChannel: true });
                await econDb.addTestamentoChannel(senderUserId, channelId);

                await interaction.update({
                    content: `📜 Testamento attivato! Puoi inviare **1 messaggio** in ${channel}. Dopo verrà revocato.`,
                    components: []
                });

                // 📝 Log uso testamento
                emitShopAction(senderUserId, '📜 Testamento', `📺 Canale: ${formatName(channel.name)}`);

                // Listener: dopo 1 messaggio, revoca permesso
                const filter = m => m.author.id === senderUserId;
                const collector = channel.createMessageCollector({ filter, max: 1, time: 3600000 }); // 1h max

                collector.on('collect', async () => {
                    await channel.permissionOverwrites.delete(senderUserId).catch(() => {});
                    await econDb.removeTestamentoChannel(senderUserId, channelId);
                    channel.send(`📜 Il testamento di <@${senderUserId}> si è esaurito.`).catch(() => {});
                });

                collector.on('end', async (collected) => {
                    if (collected.size === 0) {
                        // Scaduto senza messaggi: revoca comunque
                        await channel.permissionOverwrites.delete(senderUserId).catch(() => {});
                        await econDb.removeTestamentoChannel(senderUserId, channelId);
                    }
                });
            }

            // ========== MENU CATENE: SELEZIONE TARGET (TENDINA) ==========
            else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('catene_target_')) {
                const senderUserId = interaction.customId.split('_')[2];
                if (interaction.user.id !== senderUserId)
                    return interaction.reply({ content: "❌ Non è tuo.", ephemeral: true });

                const targetUserId = interaction.values[0];
                if (targetUserId === senderUserId)
                    return interaction.reply({ content: "❌ Non puoi incatenarti da solo!", ephemeral: true });

                const target = await interaction.guild.members.fetch(targetUserId).catch(() => null);
                if (!target)
                    return interaction.reply({ content: "❌ Giocatore non trovato.", ephemeral: true });

                // Verifica che non sia già bloccato
                const [alreadyVB, alreadyRB] = await Promise.all([
                    db.moderation.isBlockedVB(targetUserId),
                    db.moderation.isBlockedRB(targetUserId),
                ]);
                if (alreadyVB && alreadyRB)
                    return interaction.reply({ content: `⚠️ ${target} è già bloccato (VB + RB).`, ephemeral: true });

                const removed = await econDb.removeItem(senderUserId, 'catene');
                if (!removed)
                    return interaction.reply({ content: "❌ Non possiedi più le catene.", ephemeral: true });

                const partner = await findPartner(target, interaction.guild);
                const results = [];

                if (!alreadyVB) {
                    await db.moderation.addBlockedVB(targetUserId, target.user.tag);
                    results.push(`🚫 **${target.user.tag}** → Visitblock`);
                    if (partner && !(await db.moderation.isBlockedVB(partner.id))) {
                        await db.moderation.addBlockedVB(partner.id, partner.user.tag);
                        results.push(`🚫 **${partner.user.tag}** (partner) → Visitblock`);
                    }
                }
                if (!alreadyRB) {
                    await db.moderation.addBlockedRB(targetUserId, target.user.tag);
                    results.push(`🚫 **${target.user.tag}** → Roleblock`);
                    if (partner && !(await db.moderation.isBlockedRB(partner.id))) {
                        await db.moderation.addBlockedRB(partner.id, partner.user.tag);
                        results.push(`🚫 **${partner.user.tag}** (partner) → Roleblock`);
                    }
                }

                await interaction.reply({ embeds: [
                    new EmbedBuilder().setColor('#2C3E50').setTitle('⛓️ Catene Applicate!')
                        .setDescription(results.join('\n')).setTimestamp()
                ]});
                if (interaction.message?.deletable) interaction.message.delete().catch(() => {});

                // 📝 Log uso catene
                emitShopAction(senderUserId, '⛓️ Catene', `🎯 Target: <@${targetUserId}>\n${results.join('\n')}`);
            }
        } catch (err) {
            console.error("❌ [Economy] Errore interazione:", err);
        }
    });
};

// ==========================================
// 💰 COMANDO !pagamento [amount] / !pagamento @user amount
// ==========================================
async function handlePagamento(message, args) {
    if (!isAdmin(message.member)) return message.reply("⛔ Solo admin.");

    const mention = message.mentions.members.first();

    // !pagamento @user amount → pagamento singolo
    if (mention) {
        const amount = parseInt(args[1]);
        if (isNaN(amount) || amount <= 0) return message.reply("❌ Uso: `!pagamento @Utente <quantità>`");
        await econDb.addBalance(mention.id, amount);
        return message.reply(`✅ Aggiunte **${amount}** monete a ${mention}.`);
    }

    // !pagamento [amount] → pagamento globale (default 100)
    const amount = parseInt(args[0]) || 100;
    const allMembers = await message.guild.members.fetch();
    const aliveIds = allMembers.filter(m => !m.user.bot && m.roles.cache.has(RUOLI.ALIVE)).map(m => m.id);

    if (aliveIds.length === 0) return message.reply("❌ Nessun giocatore alive trovato.");

    await econDb.bulkAddBalance(aliveIds, amount);

    await message.reply({ embeds: [
        new EmbedBuilder().setColor('#00FF00').setTitle('🪙 Pagamento Eseguito')
            .setDescription(`Distribuite **${amount} monete** a **${aliveIds.length}** giocatori alive.`)
            .setTimestamp()
    ]});
}

// ==========================================
// 💵 COMANDO !bilancio [@user]
// ==========================================
async function handleBilancio(message, args) {
    const mention = message.mentions.members.first();

    // Admin può vedere bilancio altrui
    if (mention && isAdmin(message.member)) {
        const profile = await econDb.ensureProfile(mention.id);
        return message.reply({ embeds: [
            new EmbedBuilder().setColor('#FFD700').setTitle(`🪙 Bilancio di ${mention.displayName}`)
                .addFields(
                    { name: '💵 Saldo', value: `**${profile.balance}** monete`, inline: true },
                    { name: '📈 Guadagnato', value: `${profile.totalEarned}`, inline: true },
                    { name: '📉 Speso', value: `${profile.totalSpent}`, inline: true }
                ).setTimestamp()
        ]});
    }

    if (!message.member.roles.cache.has(RUOLI.ALIVE)) return message.reply("❌ Solo giocatori alive.");

    const profile = await econDb.ensureProfile(message.author.id);
    message.reply({ embeds: [
        new EmbedBuilder().setColor('#FFD700').setTitle('🪙 Il Tuo Bilancio')
            .addFields(
                { name: '💵 Saldo', value: `**${profile.balance}** monete`, inline: true },
                { name: '📈 Guadagnato', value: `${profile.totalEarned}`, inline: true },
                { name: '📉 Speso', value: `${profile.totalSpent}`, inline: true }
            ).setFooter({ text: message.author.tag }).setTimestamp()
    ]});
}

// ==========================================
// 🎒 COMANDO !inventario
// ==========================================
async function handleInventario(message) {
    if (!message.member.roles.cache.has(RUOLI.ALIVE) && !message.member.roles.cache.has(RUOLI.DEAD))
        return message.reply("❌ Solo giocatori.");

    const inv = await econDb.getInventory(message.author.id);
    const items = Object.entries(inv).filter(([, qty]) => qty > 0);

    const desc = items.length > 0
        ? items.map(([id, qty]) => {
            const s = SHOP_ITEMS.find(i => i.id === id);
            return `${s?.emoji || '📦'} **${s?.name || id}** x${qty}`;
        }).join('\n')
        : '*Inventario vuoto.*';

    message.reply({ embeds: [
        new EmbedBuilder().setColor('#9B59B6').setTitle('🎒 Inventario')
            .setDescription(desc)
            .setFooter({ text: `${message.author.tag} | Totale: ${items.reduce((s, [, q]) => s + q, 0)} oggetti` })
            .setTimestamp()
    ]});
}

// ==========================================
// 💸 COMANDO !paga @utente quantità
// ==========================================
async function handlePaga(message, args) {
    if (!message.member.roles.cache.has(RUOLI.ALIVE)) return message.reply("❌ Solo giocatori alive.");

    const target = message.mentions.users.first();
    if (!target) return message.reply("❌ Uso: `!paga @utente <quantità>`");
    if (target.id === message.author.id) return message.reply("❌ Non puoi pagare te stesso!");

    const amount = parseInt(args[1]);
    if (isNaN(amount) || amount <= 0) return message.reply("❌ Quantità non valida.");

    const removed = await econDb.removeBalance(message.author.id, amount);
    if (!removed) {
        const bal = await econDb.getBalance(message.author.id);
        return message.reply(`❌ Saldo insufficiente! Hai **${bal}** monete.`);
    }

    await econDb.addBalance(target.id, amount);

    message.reply({ embeds: [
        new EmbedBuilder().setColor('#00FF00').setTitle('💸 Trasferimento')
            .setDescription(`**${amount} monete** trasferite a ${target}`)
            .addFields(
                { name: 'Da', value: `${message.author}`, inline: true },
                { name: 'A', value: `${target}`, inline: true },
            ).setTimestamp()
    ]});
}

// ==========================================
// 🛒 COMANDO !mercato
// ==========================================
async function handleMercato(message) {
    if (!message.member.roles.cache.has(RUOLI.ALIVE)) return message.reply("❌ Solo giocatori alive.");

    message.reply({ embeds: [
        new EmbedBuilder().setColor('#3498DB').setTitle('🛒 Mercato')
            .setDescription('Oggetti disponibili:')
            .addFields(SHOP_ITEMS.map(i => ({
                name: `${i.emoji} ${i.name}`,
                value: `🪙 **${i.price}** monete\n${i.description}\nID: \`${i.id}\``,
                inline: true
            })))
            .setFooter({ text: '!compra <id> [quantità]' }).setTimestamp()
    ]});
}

// ==========================================
// 🛍️ COMANDO !compra <id> [quantità]
// ==========================================
async function handleCompra(message, args) {
    if (!message.member.roles.cache.has(RUOLI.ALIVE)) return message.reply("❌ Solo giocatori alive.");
    if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE) return message.reply("⛔ Solo nelle chat private!");

    const itemId = args[0]?.toLowerCase();
    const quantity = parseInt(args[1]) || 1;
    if (!itemId) return message.reply("❌ Uso: `!compra <id> [quantità]`");
    if (quantity <= 0) return message.reply("❌ Quantità non valida.");

    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return message.reply("❌ Oggetto non trovato. Usa `!mercato`.");

    const totalCost = item.price * quantity;
    const removed = await econDb.removeBalance(message.author.id, totalCost);
    if (!removed) {
        const bal = await econDb.getBalance(message.author.id);
        return message.reply(`❌ Servono **${totalCost}** monete, hai **${bal}**.`);
    }

    await econDb.addItem(message.author.id, itemId, quantity);

    const newBal = await econDb.getBalance(message.author.id);
    
    // 📝 Log acquisto
    emitShopAction(message.author.id, '🛒 Acquisto', `📦 Oggetto: ${item.emoji} ${item.name} x${quantity}\n🪙 Costo: ${totalCost} monete`);

    message.reply({ embeds: [
        new EmbedBuilder().setColor('#00FF00').setTitle('✅ Acquisto')
            .setDescription(`Hai comprato **${quantity}x ${item.emoji} ${item.name}**`)
            .addFields(
                { name: 'Costo', value: `${totalCost} monete`, inline: true },
                { name: 'Saldo', value: `${newBal} monete`, inline: true }
            ).setTimestamp()
    ]});
}

// ==========================================
// 🏆 COMANDO !classifica
// ==========================================
async function handleClassifica(message) {
    const canUse = message.member.roles.cache.hasAny(RUOLI.ALIVE, RUOLI.SPONSOR, RUOLI.DEAD, RUOLI.SPONSOR_DEAD) || isAdmin(message.member);
    if (!canUse) return message.reply("⛔ Non hai i permessi.");

    const top = await econDb.getTopBalances(15);
    if (top.length === 0) return message.reply("📊 Nessun profilo economia trovato.");

    const desc = top.map((p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
        return `${medal} <@${p.userId}> — **${p.balance}** monete`;
    }).join('\n');

    message.reply({ embeds: [
        new EmbedBuilder().setColor('#FFD700').setTitle('🏆 Classifica Ricchezza')
            .setDescription(desc).setTimestamp()
    ]});
}

// ==========================================
// 💸 COMANDO !ritira @user amount (ADMIN)
// ==========================================
async function handleRitira(message, args) {
    if (!isAdmin(message.member)) return message.reply("⛔ Solo admin.");

    const mention = message.mentions.members.first();
    const amount = parseInt(args[1]);
    if (!mention || isNaN(amount) || amount <= 0)
        return message.reply("❌ Uso: `!ritira @Utente <quantità>`");

    const removed = await econDb.removeBalance(mention.id, amount);
    if (!removed) return message.reply(`❌ ${mention} non ha abbastanza monete.`);

    message.reply(`✅ Ritirate **${amount}** monete da ${mention}.`);
}

// ==========================================
// 🎁 COMANDO !regala @user itemId [qty] (ADMIN)
// ==========================================
async function handleRegala(message, args) {
    if (!isAdmin(message.member)) return message.reply("⛔ Solo admin.");

    const mention = message.mentions.members.first();
    const itemId = args[1]?.toLowerCase();
    const quantity = parseInt(args[2]) || 1;
    if (!mention || !itemId) return message.reply("❌ Uso: `!regala @Utente <oggetto> [quantità]`");

    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return message.reply("❌ Oggetto non trovato.");

    await econDb.addItem(mention.id, itemId, quantity);
    message.reply(`🎁 Regalati **${quantity}x ${item.emoji} ${item.name}** a ${mention}.`);
}

// ==========================================
// 🎯 COMANDO !usa <oggetto> [args]
// ==========================================
async function handleUsa(message, args, client) {
    // Alive per tutti tranne testamento (dead)
    const itemId = args[0]?.toLowerCase();
    if (!itemId) return message.reply("❌ Uso: `!usa <oggetto>`");

    // Testamento: richiede DEAD
    if (itemId === 'testamento') {
        if (!message.member.roles.cache.has(RUOLI.DEAD))
            return message.reply("❌ Solo i giocatori dead possono usare il testamento!");
    } else {
        if (!message.member.roles.cache.has(RUOLI.ALIVE))
            return message.reply("❌ Solo giocatori alive.");
    }

    const has = await econDb.hasItem(message.author.id, itemId);
    if (!has) return message.reply("❌ Non possiedi questo oggetto.");

    switch (itemId) {
        case 'scopa':       return useScopa(message);
        case 'lettera':     return useLettera(message, args);
        case 'scarpe':      return useScarpe(message);
        case 'testamento':  return useTestamento(message);
        case 'catene':      return useCatene(message, args);
        case 'fuochi':      return useFuochi(message);
        case 'tenda':       return useTenda(message, client);
        default:            return message.reply("❌ Oggetto non utilizzabile.");
    }
}

// ==========================================
// 🧹 USA SCOPA
// Cancella messaggi in una casa. Proteggi con 🛡️
// ==========================================
async function useScopa(message) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CASE)
        return message.reply("❌ Usa la scopa solo in una casa!");
    if (!message.reference)
        return message.reply("❌ Rispondi al messaggio da cui iniziare a cancellare!");

    const refMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (!refMsg) return message.reply("❌ Messaggio di riferimento non trovato.");

    const removed = await econDb.removeItem(message.author.id, 'scopa');
    if (!removed) return message.reply("❌ Errore: oggetto non disponibile.");

    // Cancella il comando subito
    await message.delete().catch(() => {});

    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    let totalDeleted = 0;
    let totalProtected = 0;

    // 🚀 LOOP INFINITO: fetch 1000 → cancella → ripeti finché non finiscono
    while (true) {
        // Fetch 1000 messaggi (10 batch da 100)
        const batch1000 = [];
        let lastId = refMsg.id;
        for (let i = 0; i < 10; i++) {
            const fetched = await message.channel.messages.fetch({ after: lastId, limit: 100 });
            if (fetched.size === 0) break;
            batch1000.push(...fetched.values());
            lastId = fetched.sort((a, b) => b.createdTimestamp - a.createdTimestamp).first().id;
            if (fetched.size < 100) break;
        }

        if (batch1000.length === 0) break;

        // Separa: cancellare vs protetti
        const toDelete = [];
        for (const msg of batch1000) {
            const hasShield = msg.reactions.cache.has('🛡️') || msg.reactions.cache.has('🛡');
            if (hasShield || msg.pinned) {
                totalProtected++;
                // Cleanup 🛡️
                if (hasShield) msg.reactions.cache.forEach(r => {
                    if (r.emoji.name === '🛡️' || r.emoji.name === '🛡') r.remove().catch(() => {});
                });
                continue;
            }
            toDelete.push(msg);
        }

        if (toDelete.length === 0) break;

        // Recenti → bulkDelete a chunk da 100 in parallelo
        const recent = toDelete.filter(m => m.createdTimestamp > twoWeeksAgo);
        const old = toDelete.filter(m => m.createdTimestamp <= twoWeeksAgo);

        if (recent.length > 0) {
            const chunks = [];
            for (let i = 0; i < recent.length; i += 100) chunks.push(recent.slice(i, i + 100));
            await Promise.all(chunks.map(c => message.channel.bulkDelete(c, true).catch(() => {})));
        }

        // Vecchi → parallelo a blocchi da 10
        if (old.length > 0) {
            for (let i = 0; i < old.length; i += 10) {
                await Promise.all(old.slice(i, i + 10).map(m => m.delete().catch(() => {})));
            }
        }

        totalDeleted += toDelete.length;

        // Se ha fetchato meno di 1000, non ce ne sono altri
        if (batch1000.length < 1000) break;
    }

    const confirmMsg = await message.channel.send({ embeds: [
        new EmbedBuilder().setColor('#00FF00').setTitle('🧹 Scopa Usata')
            .setDescription(`Cancellati **${totalDeleted}** messaggi.\nProtetti: **${totalProtected}** (🛡️ o pinnati).`)
            .setTimestamp()
    ]});

    // 📝 Log uso scopa
    emitShopAction(message.author.id, '🧹 Scopa', `🏠 Casa: ${formatName(message.channel.name)}\n🗑️ Cancellati: ${totalDeleted} | Protetti: ${totalProtected}`);

    setTimeout(() => confirmMsg.delete().catch(() => {}), 8000);
}

// ==========================================
// ✉️ USA LETTERA (menu a tendina)
// ==========================================
async function useLettera(message, args) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
        return message.reply("❌ Usa la lettera solo nella tua chat privata!");

    // Ottieni giocatori ALIVE non nella lista morti
    const markedForDeath = await db.moderation.getMarkedForDeath();
    const deadIds = new Set(markedForDeath.map(m => m.userId));

    const allMembers = await message.guild.members.fetch();
    const aliveMembers = allMembers.filter(m =>
        !m.user.bot &&
        m.roles.cache.has(RUOLI.ALIVE) &&
        !deadIds.has(m.id) &&
        m.id !== message.author.id
    );

    if (aliveMembers.size === 0)
        return message.reply("❌ Nessun giocatore disponibile.");

    const options = [...aliveMembers.values()].slice(0, 25).map(m =>
        new StringSelectMenuOptionBuilder()
            .setLabel(m.displayName)
            .setValue(m.id)
            .setEmoji('👤')
    );

    const select = new StringSelectMenuBuilder()
        .setCustomId(`lettera_target_${message.author.id}`)
        .setPlaceholder('Seleziona il destinatario...')
        .addOptions(options);

    const msg = await message.reply({
        content: '✉️ **A chi vuoi inviare la lettera?**',
        components: [new ActionRowBuilder().addComponents(select)]
    });
    setTimeout(() => msg.delete().catch(() => {}), 120000);
}

// ==========================================
// 👟 USA SCARPE (auto +1 visita base)
// ==========================================
async function useScarpe(message) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
        return message.reply("❌ Usa le scarpe solo nella tua chat privata!");

    const removed = await econDb.removeItem(message.author.id, 'scarpe');
    if (!removed) return message.reply("❌ Errore.");

    // Determina modalità attuale e aggiungi visita base
    const mode = await db.housing.getMode();
    const isDay = mode === 'DAY';
    await db.housing.addExtraVisit(message.author.id, 'base', 1, isDay);

    // Aggiungi anche allo sponsor (se abbinato)
    const sponsor = await findPartner(message.member, message.guild);
    if (sponsor) {
        await db.housing.addExtraVisit(sponsor.id, 'base', 1, isDay);
    }

    const info = await db.housing.getVisitInfo(message.author.id);
    
    // 📝 Log uso scarpe
    emitShopAction(message.author.id, '👟 Scarpe', `📊 +1 visita base (${isDay ? 'Giorno' : 'Notte'})`);

    message.reply({ embeds: [
        new EmbedBuilder().setColor('#00FF00').setTitle('👟 Scarpe Usate')
            .setDescription(`Hai ottenuto **+1 visita base** (${isDay ? '☀️ Giorno' : '🌙 Notte'})!`)
            .addFields({ name: 'Visite attuali', value: `${info?.used || 0}/${info?.totalLimit || 0}`, inline: true })
            .setTimestamp()
    ]});
}

// ==========================================
// 📜 USA TESTAMENTO (dead → 1 msg in chat diurna)
// ==========================================
async function useTestamento(message) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
        return message.reply("❌ Usa il testamento solo nella tua chat privata!");

    // Trova canali diurni disponibili
    const catDiurna = message.guild.channels.cache.get(HOUSING.CATEGORIA_CHAT_DIURNA);
    if (!catDiurna) return message.reply("❌ Categoria diurna non trovata.");

    const channels = catDiurna.children.cache
        .filter(c => c.type === ChannelType.GuildText && c.id !== HOUSING.CANALE_BLOCCO_TOTALE)
        .sort((a, b) => a.rawPosition - b.rawPosition);

    if (channels.size === 0) return message.reply("❌ Nessun canale diurno disponibile.");

    const options = channels.map(ch =>
        new StringSelectMenuOptionBuilder()
            .setLabel(formatName(ch.name))
            .setValue(ch.id)
            .setEmoji('💬')
    );

    const select = new StringSelectMenuBuilder()
        .setCustomId(`testamento_channel_${message.author.id}`)
        .setPlaceholder('Scegli dove scrivere...')
        .addOptions(options.slice(0, 25));

    const msg = await message.reply({
        content: '📜 **Scegli il canale diurno dove vuoi inviare il tuo messaggio:**',
        components: [new ActionRowBuilder().addComponents(select)]
    });
    setTimeout(() => msg.delete().catch(() => {}), 120000);
}

// ==========================================
// ⛓️ USA CATENE (menu a tendina → VB + RB su target + partner)
// ==========================================
async function useCatene(message, args) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
        return message.reply("❌ Usa le catene solo nella tua chat privata!");

    // Ottieni giocatori ALIVE non nella lista morti
    const markedForDeath = await db.moderation.getMarkedForDeath();
    const deadIds = new Set(markedForDeath.map(m => m.userId));

    const allMembers = await message.guild.members.fetch();
    const aliveMembers = allMembers.filter(m =>
        !m.user.bot &&
        m.roles.cache.has(RUOLI.ALIVE) &&
        !deadIds.has(m.id) &&
        m.id !== message.author.id
    );

    if (aliveMembers.size === 0)
        return message.reply("❌ Nessun giocatore disponibile.");

    const options = [...aliveMembers.values()].slice(0, 25).map(m =>
        new StringSelectMenuOptionBuilder()
            .setLabel(m.displayName)
            .setValue(m.id)
            .setEmoji('⛓️')
    );

    const select = new StringSelectMenuBuilder()
        .setCustomId(`catene_target_${message.author.id}`)
        .setPlaceholder('Seleziona chi bloccare...')
        .addOptions(options);

    const msg = await message.reply({
        content: '⛓️ **Seleziona il giocatore da bloccare (VB + RB):**',
        components: [new ActionRowBuilder().addComponents(select)]
    });
    setTimeout(() => msg.delete().catch(() => {}), 120000);
}

// ==========================================
// 🎆 USA FUOCHI D'ARTIFICIO
// ==========================================
async function useFuochi(message) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CASE)
        return message.reply("❌ Usa i fuochi solo in una casa!");

    const removed = await econDb.removeItem(message.author.id, 'fuochi');
    if (!removed) return message.reply("❌ Errore.");

    const annunciChannel = message.guild.channels.cache.get(HOUSING.CANALE_ANNUNCI);
    if (!annunciChannel) return message.reply("❌ Canale annunci non trovato.");

    const houseName = formatName(message.channel.name);
    await annunciChannel.send({ embeds: [
        new EmbedBuilder().setColor('#FF6B6B').setTitle('🎆 FUOCHI D\'ARTIFICIO! 🎆')
            .setDescription(`**Attenzione!** ${message.author} è nella casa **${houseName}**!`)
            .setImage('https://media.giphy.com/media/26tOZ42Mg6pbTUPHW/giphy.gif')
            .setTimestamp()
    ]});

    message.reply(`🎆 Fuochi lanciati! Annuncio pubblicato.`);

    // 📝 Log uso fuochi
    emitShopAction(message.author.id, '🎆 Fuochi', `🏠 Casa: ${houseName}`);
}

// ==========================================
// ⛺ USA TENDA (auto trasferimento)
// ==========================================
async function useTenda(message, client) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CASE)
        return message.reply("❌ Usa la tenda solo in una casa!");

    // Stesse verifiche di !trasferimento
    if (message.member.roles.cache.has(RUOLI.SPONSOR) || message.member.roles.cache.has(RUOLI.SPONSOR_DEAD))
        return message.reply("⛔ Gli sponsor non possono usare la tenda.");
    if (!message.member.roles.cache.has(RUOLI.ALIVE))
        return message.reply("⛔ Solo giocatori alive.");

    const newHomeChannel = message.channel;
    const ownerId = await db.housing.findOwner(newHomeChannel.id);

    if (ownerId === message.author.id)
        return message.reply("❌ Sei già a casa tua!");

    const removed = await econDb.removeItem(message.author.id, 'tenda');
    if (!removed) return message.reply("❌ Errore.");

    if (!ownerId) {
        // Casa senza proprietario → trasferimento diretto
        const sponsors = await getSponsorsToMove(message.member, message.guild);
        await cleanOldHome(message.author.id, message.guild);
        for (const s of sponsors) await cleanOldHome(s.id, message.guild);

        await db.housing.setHome(message.author.id, newHomeChannel.id);
        for (const s of sponsors) await db.housing.setHome(s.id, newHomeChannel.id);

        await newHomeChannel.permissionOverwrites.edit(message.author.id, { ViewChannel: true, SendMessages: true });
        const pinnedMsg = await newHomeChannel.send(`🔑 **${message.author}**, questa è la tua dimora privata.`);
        await pinnedMsg.pin();

        // 📝 Log uso tenda (diretto)
        emitShopAction(message.author.id, '⛺ Tenda', `🏠 Casa: ${formatName(newHomeChannel.name)} (trasferimento diretto)`);

        return message.reply("⛺ Tenda montata! Trasferimento completato.");
    }

    // Casa con proprietario → richiesta
    const owner = await message.guild.members.fetch(ownerId).catch(() => null);
    if (!owner) return message.reply("❌ Proprietario non trovato.");

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tenda_yes_${message.author.id}`).setLabel('✅ Accetta').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`tenda_no_${message.author.id}`).setLabel('❌ Rifiuta').setStyle(ButtonStyle.Danger),
    );

    const requestMsg = await newHomeChannel.send({
        content: `🔔 <@${owner.id}>`,
        embeds: [new EmbedBuilder().setColor('Blue').setTitle('⛺ Richiesta Trasferimento')
            .setDescription(`${message.author} vuole trasferirsi qui con una tenda.\nAccetti?`)],
        components: [row]
    });

    const collector = requestMsg.createMessageComponentCollector({
        filter: i => i.user.id === owner.id, max: 1, time: 300000
    });

    collector.on('collect', async i => {
        if (i.customId === `tenda_yes_${message.author.id}`) {
            const sponsors = await getSponsorsToMove(message.member, message.guild);
            await cleanOldHome(message.author.id, message.guild);
            for (const s of sponsors) await cleanOldHome(s.id, message.guild);

            await db.housing.setHome(message.author.id, newHomeChannel.id);
            for (const s of sponsors) await db.housing.setHome(s.id, newHomeChannel.id);

            await newHomeChannel.permissionOverwrites.edit(message.author.id, { ViewChannel: true, SendMessages: true });
            const pinnedMsg = await newHomeChannel.send(`🔑 ${message.author}, dimora assegnata (Comproprietario).`);
            await pinnedMsg.pin();

            await i.update({ content: "⛺ Trasferimento accettato!", embeds: [], components: [] });
            
            // 📝 Log uso tenda (accettata)
            emitShopAction(message.author.id, '⛺ Tenda', `🏠 Casa: ${formatName(newHomeChannel.name)} (accettata dal proprietario)`);
        } else {
            await i.update({ content: "❌ Trasferimento rifiutato.", embeds: [], components: [] });
        }
    });
}

// ==========================================
// 📤 EXPORT econDb per uso esterno (!cambio)
// ==========================================
module.exports.econDb = econDb;
