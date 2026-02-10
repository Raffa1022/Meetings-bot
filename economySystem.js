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

const economySettingsSchema = new mongoose.Schema({
    id: { type: String, default: 'main_economy_settings', index: true },
    classificaVisible: { type: Boolean, default: true }, // Classifica visibile ai giocatori
}, { minimize: false, versionKey: false });

const EconomyModel = mongoose.model('EconomyData', economySchema);
const EconomySettingsModel = mongoose.model('EconomySettings', economySettingsSchema);

// ==========================================
// 🛒 SHOP - OGGETTI DISPONIBILI
// ==========================================
const SHOP_ITEMS = [
    { id: 'scopa',      name: 'Scopa',                price: 25,  emoji: '🧹', description: 'Cancella messaggi in una casa (rispondi al msg da cui iniziare). Reagisci 🛡️ ai messaggi da proteggere.' },
    { id: 'lettera',    name: 'Lettera',               price: 90,  emoji: '✉️', description: 'Invia un messaggio anonimo (max 10 parole) a un giocatore.' },
    { id: 'scarpe',     name: 'Scarpe',                price: 125, emoji: '👟', description: 'Ottieni +1 visita base aggiuntiva.' },
    { id: 'testamento', name: 'Testamento',            price: 80,  emoji: '📜', description: 'Può essere comprato solo quando si è vivi. Quando usato durante la fase diurna sarete in grado di parlare per tutta la durata della fase e inoltre avrete la possibilità di cedere 1 vostra abilità non letale ad un giocatore attualmente vivo.' },
    { id: 'catene',     name: 'Catene',                price: 700, emoji: '⛓️', description: '(Visitblock + Roleblock) + nega ogni protezione ad un giocatore.' },
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

    // Impostazioni classifica
    async isClassificaVisible() {
        const doc = await EconomySettingsModel.findOne({ id: 'main_economy_settings' }).lean();
        return doc?.classificaVisible !== false; // Default: true
    },

    async setClassificaVisible(visible) {
        return EconomySettingsModel.findOneAndUpdate(
            { id: 'main_economy_settings' },
            { $set: { classificaVisible: visible } },
            { upsert: true, new: true }
        );
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

function emitShopAction(userId, subType, text, extraDetails = {}) {
    eventBus.emit('queue:add', {
        type: 'SHOP',
        userId,
        details: { subType, text, ...extraDetails }
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

                letteraCache.delete(`${senderUserId}_${targetUserId}`);

                // 📝 In coda — l'invio verrà eseguito dal processore
                emitShopAction(senderUserId, 'lettera', `👤 Destinatario: <@${targetUserId}>`, {
                    targetUserId, content,
                    responseChannelId: interaction.channelId,
                });

                await interaction.update({ content: "🔄 **Lettera in coda!** Verrà inviata quando sarà il tuo turno.", embeds: [], components: [] });
                if (interaction.message?.deletable) setTimeout(() => interaction.message.delete().catch(() => {}), 8000);
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

                // 📝 In coda — l'effetto verrà eseguito dal processore
                emitShopAction(senderUserId, 'catene', `🎯 Target: <@${targetUserId}>`, {
                    targetUserId,
                    responseChannelId: interaction.channelId,
                });

                await interaction.reply({ content: `🔄 **Catene in coda!** VB + RB verrà applicato a <@${targetUserId}> quando sarà il tuo turno.`, ephemeral: false });
                if (interaction.message?.deletable) interaction.message.delete().catch(() => {});
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
    emitShopAction(message.author.id, 'acquisto', `📦 Oggetto: ${item.emoji} ${item.name} x${quantity}\n🪙 Costo: ${totalCost} monete`);

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
    // Admin può usare !classifica si/no per controllare la visibilità
    if (isAdmin(message.member)) {
        const arg = message.content.split(/\s+/)[1]?.toLowerCase();
        if (arg === 'si' || arg === 'sì') {
            await econDb.setClassificaVisible(true);
            return message.reply("✅ Classifica ora **VISIBILE** ai giocatori.");
        }
        if (arg === 'no') {
            await econDb.setClassificaVisible(false);
            return message.reply("✅ Classifica ora **NASCOSTA** ai giocatori.");
        }
        // Se admin senza argomento, mostra la classifica
    }

    const canUse = message.member.roles.cache.hasAny(RUOLI.ALIVE, RUOLI.SPONSOR, RUOLI.DEAD, RUOLI.SPONSOR_DEAD) || isAdmin(message.member);
    if (!canUse) return message.reply("⛔ Non hai i permessi.");

    // Se non è admin, controlla se la classifica è visibile
    if (!isAdmin(message.member)) {
        const isVisible = await econDb.isClassificaVisible();
        if (!isVisible) {
            return message.reply("❌ La classifica non è attualmente disponibile.");
        }
    }

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

    await message.delete().catch(() => {});

    // 📝 In coda — l'effetto verrà eseguito dal processore
    emitShopAction(message.author.id, 'scopa', `🏠 Casa: ${formatName(message.channel.name)}`, {
        channelId: message.channel.id,
        referenceMessageId: refMsg.id,
    });

    const queueMsg = await message.channel.send("🔄 **Scopa in coda!** I messaggi verranno cancellati quando sarà il tuo turno.");
    setTimeout(() => queueMsg.delete().catch(() => {}), 10000);
}

// ==========================================
// ✉️ USA LETTERA (menu a tendina)
// ==========================================
async function useLettera(message, args) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
        return message.reply("❌ Usa la lettera solo nella tua chat privata!");

    try {
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
                .setLabel(m.displayName.slice(0, 100))
                .setValue(m.id)
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
    } catch (err) {
        console.error('❌ [Economy] Errore useLettera:', err);
        return message.reply("❌ Errore nel caricamento giocatori. Riprova.");
    }
}

// ==========================================
// 👟 USA SCARPE (auto +1 visita base)
// ==========================================
async function useScarpe(message) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
        return message.reply("❌ Usa le scarpe solo nella tua chat privata!");

    const removed = await econDb.removeItem(message.author.id, 'scarpe');
    if (!removed) return message.reply("❌ Errore.");

    // 📝 In coda — l'effetto verrà eseguito dal processore
    emitShopAction(message.author.id, 'scarpe', `📊 +1 visita base`, {
        responseChannelId: message.channel.id,
    });

    message.reply("🔄 **Scarpe in coda!** La visita extra verrà aggiunta quando sarà il tuo turno.");
}

// ==========================================
// 📜 USA TESTAMENTO (dead → accesso automatico canali diurni)
// ==========================================
async function useTestamento(message) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
        return message.reply("❌ Usa il testamento solo nella tua chat privata!");

    const removed = await econDb.removeItem(message.author.id, 'testamento');
    if (!removed) return message.reply("❌ Errore.");

    // 📝 In coda — l'effetto verrà eseguito dal processore
    emitShopAction(message.author.id, 'testamento', `📜 Testamento attivato`, {
        responseChannelId: message.channel.id,
    });

    message.reply("🔄 **Testamento in coda!** I permessi verranno attivati quando sarà il tuo turno.");
}

// ==========================================
// ⛓️ USA CATENE (menu a tendina → VB + RB su target + partner)
// ==========================================
async function useCatene(message, args) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
        return message.reply("❌ Usa le catene solo nella tua chat privata!");

    try {
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
                .setLabel(m.displayName.slice(0, 100))
                .setValue(m.id)
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
    } catch (err) {
        console.error('❌ [Economy] Errore useCatene:', err);
        return message.reply("❌ Si è verificato un errore. Riprova tra qualche secondo.");
    }
}

// ==========================================
// 🎆 USA FUOCHI D'ARTIFICIO
// ==========================================
async function useFuochi(message) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CASE)
        return message.reply("❌ Usa i fuochi solo in una casa!");

    const removed = await econDb.removeItem(message.author.id, 'fuochi');
    if (!removed) return message.reply("❌ Errore.");

    const houseName = formatName(message.channel.name);

    // 📝 In coda — l'effetto verrà eseguito dal processore
    emitShopAction(message.author.id, 'fuochi', `🏠 Casa: ${houseName}`, {
        channelId: message.channel.id,
        houseName,
        responseChannelId: message.channel.id,
    });

    message.reply("🔄 **Fuochi in coda!** L'annuncio verrà pubblicato quando sarà il tuo turno.");
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

    // 📝 In coda — l'effetto verrà eseguito dal processore
    emitShopAction(message.author.id, 'tenda', `🏠 Casa: ${formatName(newHomeChannel.name)}`, {
        targetChannelId: newHomeChannel.id,
        responseChannelId: newHomeChannel.id,
    });

    message.reply("🔄 **Tenda in coda!** Il trasferimento avverrà quando sarà il tuo turno.");
}

// ==========================================
// 📤 EXPORT econDb per uso esterno (!cambio)
// ==========================================
module.exports.econDb = econDb;

// ==========================================
// 🔧 SHOP EFFECTS — Eseguiti dal processore coda
// Ogni funzione riceve (client, userId, details)
// ==========================================
const shopEffects = {
    // 🧹 SCOPA: cancella messaggi in una casa
    async scopa(client, userId, details) {
        const channel = client.channels.cache.get(details.channelId);
        if (!channel) return;

        const refMsg = await channel.messages.fetch(details.referenceMessageId).catch(() => null);
        if (!refMsg) return;

        const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
        let totalDeleted = 0;
        let totalProtected = 0;

        while (true) {
            const batch1000 = [];
            let lastId = refMsg.id;
            for (let i = 0; i < 10; i++) {
                const fetched = await channel.messages.fetch({ after: lastId, limit: 100 });
                if (fetched.size === 0) break;
                batch1000.push(...fetched.values());
                lastId = fetched.sort((a, b) => b.createdTimestamp - a.createdTimestamp).first().id;
                if (fetched.size < 100) break;
            }
            if (batch1000.length === 0) break;

            const toDelete = [];
            for (const msg of batch1000) {
                const hasShield = msg.reactions.cache.has('🛡️') || msg.reactions.cache.has('🛡');
                if (hasShield || msg.pinned) {
                    totalProtected++;
                    if (hasShield) msg.reactions.cache.forEach(r => {
                        if (r.emoji.name === '🛡️' || r.emoji.name === '🛡') r.remove().catch(() => {});
                    });
                    continue;
                }
                toDelete.push(msg);
            }
            if (toDelete.length === 0) break;

            const recent = toDelete.filter(m => m.createdTimestamp > twoWeeksAgo);
            const old = toDelete.filter(m => m.createdTimestamp <= twoWeeksAgo);

            if (recent.length > 0) {
                const chunks = [];
                for (let i = 0; i < recent.length; i += 100) chunks.push(recent.slice(i, i + 100));
                await Promise.all(chunks.map(c => channel.bulkDelete(c, true).catch(() => {})));
            }
            if (old.length > 0) {
                for (let i = 0; i < old.length; i += 10) {
                    await Promise.all(old.slice(i, i + 10).map(m => m.delete().catch(() => {})));
                }
            }

            totalDeleted += toDelete.length;
            if (batch1000.length < 1000) break;
        }

        // NON inviare nessun messaggio nella casa — i visitatori successivi non devono sapere nulla
        // Conferma solo nella chat privata dell'utente
        try {
            const guild = client.guilds.cache.first();
            if (guild) {
                const catPriv = guild.channels.cache.get(HOUSING.CATEGORIA_CHAT_PRIVATE);
                const privChannel = catPriv?.children.cache.find(ch =>
                    ch.type === ChannelType.GuildText &&
                    ch.permissionOverwrites.cache.some(p => p.id === userId && p.allow.has(PermissionsBitField.Flags.ViewChannel))
                );
                if (privChannel) {
                    await privChannel.send({ embeds: [
                        new EmbedBuilder().setColor('#00FF00').setTitle('🧹 Scopa Usata')
                            .setDescription(`Cancellati **${totalDeleted}** messaggi in **${channel.name}**.\nProtetti: **${totalProtected}** (🛡️ o pinnati).`)
                            .setTimestamp()
                    ]}).catch(() => {});
                }
            }
        } catch {}
    },

    // ✉️ LETTERA: invia messaggio anonimo
    async lettera(client, userId, details) {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        const catPriv = guild.channels.cache.get(HOUSING.CATEGORIA_CHAT_PRIVATE);
        const targetChannel = catPriv?.children.cache.find(ch =>
            ch.type === ChannelType.GuildText &&
            ch.permissionOverwrites.cache.some(p => p.id === details.targetUserId && p.allow.has(PermissionsBitField.Flags.ViewChannel))
        );
        if (!targetChannel) return;

        // Invia la lettera con tag al destinatario
        await targetChannel.send({
            content: `📬 <@${details.targetUserId}> Hai ricevuto una lettera!`,
            embeds: [
                new EmbedBuilder().setColor('#E74C3C').setTitle('✉️ Lettera Anonima')
                    .setDescription(details.content).setFooter({ text: 'Mittente sconosciuto' }).setTimestamp()
            ]
        });

        // Conferma al mittente
        const responseChannel = client.channels.cache.get(details.responseChannelId);
        if (responseChannel) responseChannel.send(`✅ <@${userId}> La tua lettera è stata consegnata!`).catch(() => {});
    },

    // 👟 SCARPE: +1 visita base
    async scarpe(client, userId, details) {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        const mode = await db.housing.getMode();
        const isDay = mode === 'DAY';
        await db.housing.addExtraVisit(userId, 'base', 1, isDay);

        // Sponsor
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
            const sponsor = await findPartner(member, guild);
            if (sponsor) await db.housing.addExtraVisit(sponsor.id, 'base', 1, isDay);
        }

        const info = await db.housing.getVisitInfo(userId);
        const responseChannel = client.channels.cache.get(details.responseChannelId);
        if (responseChannel) {
            responseChannel.send({ embeds: [
                new EmbedBuilder().setColor('#00FF00').setTitle('👟 Scarpe Usate')
                    .setDescription(`<@${userId}> ha ottenuto **+1 visita base** (${isDay ? '☀️ Giorno' : '🌙 Notte'})!`)
                    .addFields({ name: 'Visite attuali', value: `${info?.used || 0}/${info?.totalLimit || 0}`, inline: true })
                    .setTimestamp()
            ]}).catch(() => {});
        }
    },

    // 📜 TESTAMENTO: permesso di scrivere nei canali diurni fino a !notte
    async testamento(client, userId, details) {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        // Canali specifici per R3 (DEAD) e R4 (SPONSOR_DEAD)
        const DEAD_CHANNELS = ['1460741481420558469', '1460741482876239944'];
        
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        const hasDeadRole = member.roles.cache.has('1460741405722022151'); // DEAD (R3)
        const hasSponsorDeadRole = member.roles.cache.has('1469862321563238502'); // SPONSOR_DEAD (R4)

        if (!hasDeadRole && !hasSponsorDeadRole) {
            const responseChannel = client.channels.cache.get(details.responseChannelId);
            if (responseChannel) {
                responseChannel.send(`❌ <@${userId}> Il testamento può essere usato solo da giocatori morti.`).catch(() => {});
            }
            return;
        }

        // Controlla se siamo in modalità GIORNO
        const mode = await db.housing.getMode();
        if (mode !== 'DAY') {
            const responseChannel = client.channels.cache.get(details.responseChannelId);
            if (responseChannel) {
                responseChannel.send(`❌ <@${userId}> Il testamento può essere usato solo durante la fase GIORNO!`).catch(() => {});
            }
            return;
        }

        // Trova il partner (sponsor dead)
        const partner = await findPartner(member, guild);

        // Attiva permessi di scrittura nei canali morti per il giocatore
        for (const channelId of DEAD_CHANNELS) {
            const channel = guild.channels.cache.get(channelId);
            if (channel) {
                await channel.permissionOverwrites.create(userId, { 
                    SendMessages: true, 
                    ViewChannel: true,
                    AddReactions: true,
                    CreatePublicThreads: false,
                    CreatePrivateThreads: false 
                });
                await econDb.addTestamentoChannel(userId, channelId);
            }
        }

        // Attiva permessi di scrittura anche per il partner (sponsor dead)
        if (partner) {
            for (const channelId of DEAD_CHANNELS) {
                const channel = guild.channels.cache.get(channelId);
                if (channel) {
                    await channel.permissionOverwrites.create(partner.id, { 
                        SendMessages: true, 
                        ViewChannel: true,
                        AddReactions: true,
                        CreatePublicThreads: false,
                        CreatePrivateThreads: false 
                    });
                    await econDb.addTestamentoChannel(partner.id, channelId);
                }
            }
        }

        const responseChannel = client.channels.cache.get(details.responseChannelId);
        if (responseChannel) {
            let response = `📜 <@${userId}> Testamento attivato! Puoi scrivere nei canali diurni fino al comando !notte.`;
            if (partner) {
                response += `\n📜 Anche <@${partner.id}> (partner) ha ottenuto l'accesso ai canali diurni.`;
            }
            responseChannel.send(response).catch(() => {});
        }
    },

    // ⛓️ CATENE: VB + RB su target + partner + nega protezione
    async catene(client, userId, details) {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        const target = await guild.members.fetch(details.targetUserId).catch(() => null);
        if (!target) return;

        const [alreadyVB, alreadyRB] = await Promise.all([
            db.moderation.isBlockedVB(details.targetUserId),
            db.moderation.isBlockedRB(details.targetUserId),
        ]);

        const partner = await findPartner(target, guild);
        const results = [];

        if (!alreadyVB) {
            await db.moderation.addBlockedVB(details.targetUserId, target.user.tag);
            results.push(`🚫 **${target.user.tag}** → Visitblock`);
            if (partner && !(await db.moderation.isBlockedVB(partner.id))) {
                await db.moderation.addBlockedVB(partner.id, partner.user.tag);
                results.push(`🚫 **${partner.user.tag}** (partner) → Visitblock`);
            }
        }
        if (!alreadyRB) {
            await db.moderation.addBlockedRB(details.targetUserId, target.user.tag);
            results.push(`🚫 **${target.user.tag}** → Roleblock`);
            if (partner && !(await db.moderation.isBlockedRB(partner.id))) {
                await db.moderation.addBlockedRB(partner.id, partner.user.tag);
                results.push(`🚫 **${partner.user.tag}** (partner) → Roleblock`);
            }
        }

        // Aggiungi alla lista di chi non può essere protetto
        const alreadyUnprotectable = await db.moderation.isUnprotectable(details.targetUserId);
        if (!alreadyUnprotectable) {
            await db.moderation.addUnprotectable(details.targetUserId, target.user.tag);
            results.push(`⛓️ **${target.user.tag}** → Non può essere protetto`);
        }
        if (partner) {
            const partnerUnprotectable = await db.moderation.isUnprotectable(partner.id);
            if (!partnerUnprotectable) {
                await db.moderation.addUnprotectable(partner.id, partner.user.tag);
                results.push(`⛓️ **${partner.user.tag}** (partner) → Non può essere protetto`);
            }
        }

        const responseChannel = client.channels.cache.get(details.responseChannelId);
        if (responseChannel) {
            responseChannel.send({ embeds: [
                new EmbedBuilder().setColor('#2C3E50').setTitle('⛓️ Catene Applicate!')
                    .setDescription(results.join('\n') || 'Target già bloccato.').setTimestamp()
            ]}).catch(() => {});
        }
    },

    // 🎆 FUOCHI: annuncio
    async fuochi(client, userId, details) {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        const annunciChannel = guild.channels.cache.get(HOUSING.CANALE_ANNUNCI);
        if (!annunciChannel) return;

        await annunciChannel.send({ embeds: [
            new EmbedBuilder().setColor('#FF6B6B').setTitle('🎆 FUOCHI D\'ARTIFICIO! 🎆')
                .setDescription(`**Attenzione!** <@${userId}> è nella casa **${details.houseName}**!`)
                .setImage('https://media.giphy.com/media/26tOZ42Mg6pbTUPHW/giphy.gif')
                .setTimestamp()
        ]});

        const responseChannel = client.channels.cache.get(details.responseChannelId);
        if (responseChannel) responseChannel.send(`🎆 <@${userId}> Fuochi lanciati! Annuncio pubblicato.`).catch(() => {});
    },

    // ⛺ TENDA: trasferimento
    async tenda(client, userId, details) {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        const newHomeChannel = guild.channels.cache.get(details.targetChannelId);
        if (!newHomeChannel) return;

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;

        const ownerId = await db.housing.findOwner(newHomeChannel.id);

        if (!ownerId) {
            // Casa senza proprietario → trasferimento diretto
            const sponsors = await getSponsorsToMove(member, guild);
            await cleanOldHome(userId, guild);
            for (const s of sponsors) await cleanOldHome(s.id, guild);

            await db.housing.setHome(userId, newHomeChannel.id);
            for (const s of sponsors) await db.housing.setHome(s.id, newHomeChannel.id);

            await newHomeChannel.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true });
            const pinnedMsg = await newHomeChannel.send(`🔑 **${member}**, questa è la tua dimora privata.`);
            await pinnedMsg.pin();

            newHomeChannel.send("⛺ Tenda montata! Trasferimento completato.").catch(() => {});
            return;
        }

        // Casa con proprietario → richiesta
        const owner = await guild.members.fetch(ownerId).catch(() => null);
        if (!owner) return;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tenda_yes_${userId}`).setLabel('✅ Accetta').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`tenda_no_${userId}`).setLabel('❌ Rifiuta').setStyle(ButtonStyle.Danger),
        );

        const requestMsg = await newHomeChannel.send({
            content: `🔔 <@${owner.id}>`,
            embeds: [new EmbedBuilder().setColor('Blue').setTitle('⛺ Richiesta Trasferimento')
                .setDescription(`${member} vuole trasferirsi qui con una tenda.\nAccetti?`)],
            components: [row]
        });

        const collector = requestMsg.createMessageComponentCollector({
            filter: i => i.user.id === owner.id, max: 1, time: 300000
        });

        collector.on('collect', async i => {
            if (i.customId === `tenda_yes_${userId}`) {
                const sponsors = await getSponsorsToMove(member, guild);
                await cleanOldHome(userId, guild);
                for (const s of sponsors) await cleanOldHome(s.id, guild);

                await db.housing.setHome(userId, newHomeChannel.id);
                for (const s of sponsors) await db.housing.setHome(s.id, newHomeChannel.id);

                await newHomeChannel.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true });
                const pinnedMsg = await newHomeChannel.send(`🔑 ${member}, dimora assegnata (Comproprietario).`);
                await pinnedMsg.pin();

                await i.update({ content: "⛺ Trasferimento accettato!", embeds: [], components: [] });
            } else {
                await i.update({ content: "❌ Trasferimento rifiutato.", embeds: [], components: [] });
            }
        });
    },
};

module.exports.shopEffects = shopEffects;
