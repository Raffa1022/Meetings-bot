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
const { HOUSING, RUOLI, RUOLI_PUBBLICI, PREFIX, QUEUE } = require('./config');
const db = require('./db');
const { isAdmin, formatName, getSponsorsToMove } = require('./helpers');
const { cleanOldHome } = require('./playerMovement');

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
// 🛒 SHOP - OGGETTI DISPONIBILI (EMOJI SINGOLE + 🪙)
// ==========================================
const SHOP_ITEMS = [
    { id: 'scopa',      name: '🧹 Scopa',                price: 25,  emoji: '🧹', description: 'Cancella messaggi in una casa (rispondi al msg da cui iniziare). Reagisci 🛡️ ai messaggi da proteggere.' },
    { id: 'lettera',    name: '✉️ Lettera',               price: 90,  emoji: '✉️', description: 'Invia un messaggio anonimo (max 10 parole) a un giocatore.' },
    { id: 'scarpe',     name: '👟 Scarpe',                price: 125, emoji: '👟', description: 'Ottieni +1 visita base aggiuntiva.' },
    { id: 'testamento', name: '📜 Testamento',            price: 80,  emoji: '📜', description: 'Permette di inviare 1 messaggio nella chat diurna (solo dead).' },
    { id: 'catene',     name: '⛓️ Catene',                price: 500, emoji: '⛓️', description: 'Blocca un giocatore (Visitblock + Roleblock).' },
    { id: 'fuochi',     name: '🎆 Fuochi d\'artificio',   price: 100, emoji: '🎆', description: 'Annuncia la tua presenza in una casa nel canale annunci.' },
    { id: 'tenda',      name: '⛺ Tenda',                 price: 35,  emoji: '⛺', description: 'Trasferisciti nella casa dove ti trovi.' },
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
        // Ottieni i profili di entrambi i giocatori
        const [prof1, prof2] = await Promise.all([
            EconomyModel.findOne({ userId: p1Id }).lean(),
            EconomyModel.findOne({ userId: p2Id }).lean()
        ]);

        // Se uno dei due non esiste, crealo con valori vuoti
        if (!prof1) await econDb.ensureProfile(p1Id);
        if (!prof2) await econDb.ensureProfile(p2Id);

        // Estrai i dati da scambiare
        const data1 = {
            balance: prof1?.balance || 0,
            inventory: prof1?.inventory || {},
            totalEarned: prof1?.totalEarned || 0,
            totalSpent: prof1?.totalSpent || 0,
        };
        
        const data2 = {
            balance: prof2?.balance || 0,
            inventory: prof2?.inventory || {},
            totalEarned: prof2?.totalEarned || 0,
            totalSpent: prof2?.totalSpent || 0,
        };

        // Scambia i dati in modo atomico
        await Promise.all([
            EconomyModel.updateOne(
                { userId: p1Id },
                { 
                    $set: { 
                        balance: data2.balance,
                        inventory: data2.inventory,
                        totalEarned: data2.totalEarned,
                        totalSpent: data2.totalSpent
                    }
                },
                { upsert: true }
            ),
            EconomyModel.updateOne(
                { userId: p2Id },
                { 
                    $set: { 
                        balance: data1.balance,
                        inventory: data1.inventory,
                        totalEarned: data1.totalEarned,
                        totalSpent: data1.totalSpent
                    }
                },
                { upsert: true }
            )
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
// 📝 LOGGER AZIONI SHOP
// ==========================================
async function logShopAction(client, userId, userName, action, itemName, details = '') {
    try {
        const logChannel = client.channels.cache.get(QUEUE.CANALE_LOG);
        if (!logChannel) return;

        const timestamp = new Date().toLocaleString('it-IT', { 
            timeZone: 'Europe/Rome',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        let logMessage = '';
        switch(action) {
            case 'buy':
                logMessage = `🛒 **ACQUISTO** | ${timestamp}\n👤 ${userName} (<@${userId}>)\n📦 Oggetto: **${itemName}**${details ? `\n📝 ${details}` : ''}`;
                break;
            case 'use_scopa':
                logMessage = `🧹 **USO SCOPA** | ${timestamp}\n👤 ${userName} (<@${userId}>)\n${details}`;
                break;
            case 'use_lettera':
                logMessage = `✉️ **USO LETTERA** | ${timestamp}\n👤 Mittente: ${userName} (<@${userId}>)\n${details}`;
                break;
            case 'use_scarpe':
                logMessage = `👟 **USO SCARPE** | ${timestamp}\n👤 ${userName} (<@${userId}>)\n📊 +1 visita base`;
                break;
            case 'use_testamento':
                logMessage = `📜 **USO TESTAMENTO** | ${timestamp}\n👤 ${userName} (<@${userId}>)\n${details}`;
                break;
            case 'use_catene':
                logMessage = `⛓️ **USO CATENE** | ${timestamp}\n👤 ${userName} (<@${userId}>)\n${details}`;
                break;
            case 'use_fuochi':
                logMessage = `🎆 **USO FUOCHI** | ${timestamp}\n👤 ${userName} (<@${userId}>)\n${details}`;
                break;
            case 'use_tenda':
                logMessage = `⛺ **USO TENDA** | ${timestamp}\n👤 ${userName} (<@${userId}>)\n${details}`;
                break;
        }

        if (logMessage) {
            await logChannel.send(logMessage);
        }
    } catch (error) {
        console.error('Errore nel logging azione shop:', error);
    }
}

// ==========================================
// 💼 HANDLER COMANDI ECONOMIA
// ==========================================
function registerEconomyCommands(client) {
    client.on('messageCreate', async message => {
        if (message.author.bot || !message.content.startsWith(PREFIX)) return;
        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // ===================== MERCATO =====================
        if (command === 'mercato' || command === 'shop') {
            await showShop(message);
        }

        // ===================== BILANCIO =====================
        else if (command === 'bilancio' || command === 'bal' || command === 'soldi') {
            const targetUser = message.mentions.users.first() || message.author;
            if (targetUser.id !== message.author.id && !isAdmin(message.member)) {
                return message.reply("⛔ Non puoi vedere il bilancio di altri giocatori.");
            }
            await econDb.ensureProfile(targetUser.id);
            const balance = await econDb.getBalance(targetUser.id);
            message.reply(`🪙 **${targetUser.username}** ha **${balance} monete**.`);
        }

        // ===================== INVENTARIO =====================
        else if (command === 'inventario' || command === 'inv') {
            const targetUser = message.mentions.users.first() || message.author;
            if (targetUser.id !== message.author.id && !isAdmin(message.member)) {
                return message.reply("⛔ Non puoi vedere l'inventario di altri giocatori.");
            }
            await showInventory(message, targetUser);
        }

        // ===================== COMPRA =====================
        else if (command === 'compra' || command === 'buy') {
            const itemId = args[0]?.toLowerCase();
            if (!itemId) return message.reply("❌ Uso: `!compra [scopa/lettera/scarpe/testamento/catene/fuochi/tenda]`");
            await buyItem(message, itemId, client);
        }

        // ===================== DAI SOLDI (ADMIN) =====================
        else if ((command === 'dai' || command === 'give') && isAdmin(message.member)) {
            const targetUser = message.mentions.users.first();
            const amount = parseInt(args[1]);
            if (!targetUser || isNaN(amount)) return message.reply("❌ Uso: `!dai @Utente <importo>`");
            await econDb.addBalance(targetUser.id, amount);
            message.reply(`✅ Dato **${amount} 🪙** a ${targetUser}.`);
        }

        // ===================== TOGLI SOLDI (ADMIN) =====================
        else if ((command === 'togli' || command === 'remove') && isAdmin(message.member)) {
            const targetUser = message.mentions.users.first();
            const amount = parseInt(args[1]);
            if (!targetUser || isNaN(amount)) return message.reply("❌ Uso: `!togli @Utente <importo>`");
            const removed = await econDb.removeBalance(targetUser.id, amount);
            if (removed) message.reply(`✅ Rimosso **${amount} 🪙** a ${targetUser}.`);
            else message.reply("❌ Fondi insufficienti.");
        }

        // ===================== CLASSIFICA =====================
        else if (command === 'classifica' || command === 'top') {
            await showLeaderboard(message, client);
        }

        // ===================== USA =====================
        else if (command === 'usa' || command === 'use') {
            const itemId = args[0]?.toLowerCase();
            if (!itemId) return message.reply("❌ Uso: `!usa [scopa/lettera/scarpe/testamento/catene/fuochi/tenda]`");
            
            const hasItem = await econDb.hasItem(message.author.id, itemId);
            if (!hasItem) return message.reply(`❌ Non hai **${itemId}** nell'inventario!`);

            // Routing agli handler
            if (itemId === 'scopa') await useScopa(message, args, client);
            else if (itemId === 'lettera') await useLettera(message, args, client);
            else if (itemId === 'scarpe') await useScarpe(message, client);
            else if (itemId === 'testamento') await useTestamento(message);
            else if (itemId === 'catene') await useCatene(message, args, client);
            else if (itemId === 'fuochi') await useFuochi(message, client);
            else if (itemId === 'tenda') await useTenda(message, client);
            else message.reply("❌ Oggetto non valido.");
        }
    });

    // ==========================================
    // 🛍️ SHOP SELECT MENU HANDLER
    // ==========================================
    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu()) return;
        if (!interaction.customId.startsWith('shop_buy_')) return;

        const userId = interaction.customId.split('_')[2];
        if (interaction.user.id !== userId) 
            return interaction.reply({ content: "❌ Non è il tuo menu!", ephemeral: true });

        const itemId = interaction.values[0];
        const item = SHOP_ITEMS.find(i => i.id === itemId);
        if (!item) return interaction.reply({ content: "❌ Oggetto non trovato.", ephemeral: true });

        const balance = await econDb.getBalance(userId);
        if (balance < item.price) {
            return interaction.reply({ content: `❌ Fondi insufficienti! Ti servono **${item.price} 🪙**, hai solo **${balance} 🪙**.`, ephemeral: true });
        }

        const removed = await econDb.removeBalance(userId, item.price);
        if (!removed) return interaction.reply({ content: "❌ Errore nella transazione.", ephemeral: true });

        await econDb.addItem(userId, itemId);
        
        // Log acquisto
        await logShopAction(interaction.client, userId, interaction.user.tag, 'buy', item.name);
        
        await interaction.reply({ content: `✅ Hai comprato **${item.name}** per **${item.price} 🪙**!`, ephemeral: true });
        await interaction.message.delete().catch(() => {});
    });

    // ==========================================
    // ✉️ LETTERA SELECT MENU HANDLER
    // ==========================================
    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu()) return;
        if (!interaction.customId.startsWith('lettera_select_')) return;

        const userId = interaction.customId.split('_')[2];
        if (interaction.user.id !== userId) 
            return interaction.reply({ content: "❌ Non è il tuo menu!", ephemeral: true });

        const targetUserId = interaction.values[0];
        setLetteraCache(userId, targetUserId);

        const modal = new ModalBuilder()
            .setCustomId(`lettera_modal_${userId}`)
            .setTitle('Scrivi la tua lettera anonima');

        const textInput = new TextInputBuilder()
            .setCustomId('lettera_text')
            .setLabel('Messaggio (max 10 parole)')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(200)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(textInput));
        await interaction.showModal(modal);
    });

    // ==========================================
    // ✉️ LETTERA MODAL HANDLER
    // ==========================================
    client.on('interactionCreate', async interaction => {
        if (!interaction.isModalSubmit()) return;
        if (!interaction.customId.startsWith('lettera_modal_')) return;

        const userId = interaction.customId.split('_')[2];
        if (interaction.user.id !== userId) return;

        const text = interaction.fields.getTextInputValue('lettera_text');
        const words = text.trim().split(/\s+/);
        if (words.length > 10) {
            return interaction.reply({ content: "❌ Massimo 10 parole!", ephemeral: true });
        }

        const targetUserId = letteraCache.get(userId);
        if (!targetUserId) {
            return interaction.reply({ content: "❌ Sessione scaduta. Riprova.", ephemeral: true });
        }

        const removed = await econDb.removeItem(userId, 'lettera');
        if (!removed) return interaction.reply({ content: "❌ Errore.", ephemeral: true });

        const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
        if (!targetMember) {
            return interaction.reply({ content: "❌ Destinatario non trovato.", ephemeral: true });
        }

        // Trova la chat privata del destinatario
        const privateCat = interaction.guild.channels.cache.get(HOUSING.CATEGORIA_CHAT_PRIVATE);
        const targetPM = privateCat?.children.cache.find(c =>
            c.type === ChannelType.GuildText &&
            c.permissionsFor(targetMember).has(PermissionsBitField.Flags.ViewChannel)
        );

        if (!targetPM) {
            return interaction.reply({ content: "❌ Chat privata del destinatario non trovata.", ephemeral: true });
        }

        await targetPM.send({ embeds: [
            new EmbedBuilder().setColor('#9B59B6').setTitle('📬 Lettera Anonima')
                .setDescription(`*"${text}"*`).setTimestamp()
        ]});

        // Log invio lettera
        await logShopAction(interaction.client, userId, interaction.user.tag, 'use_lettera', 
            'Lettera', `👤 Destinatario: ${targetMember.user.tag} (<@${targetUserId}>)\n📝 Messaggio: "${text}"`);

        letteraCache.delete(userId);
        await interaction.reply({ content: "✉️ Lettera inviata con successo!", ephemeral: true });
    });

    // ==========================================
    // ⛓️ CATENE SELECT MENU HANDLER
    // ==========================================
    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu()) return;
        if (!interaction.customId.startsWith('catene_select_')) return;

        const userId = interaction.customId.split('_')[2];
        if (interaction.user.id !== userId) 
            return interaction.reply({ content: "❌ Non è il tuo menu!", ephemeral: true });

        const targetUserId = interaction.values[0];
        const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
        if (!targetMember) {
            return interaction.reply({ content: "❌ Giocatore non trovato.", ephemeral: true });
        }

        if (targetUserId === userId) {
            return interaction.reply({ content: "❌ Non puoi incatenarti da solo!", ephemeral: true });
        }

        // Verifica che non sia già bloccato
        const [alreadyVB, alreadyRB] = await Promise.all([
            db.moderation.isBlockedVB(targetUserId),
            db.moderation.isBlockedRB(targetUserId),
        ]);
        if (alreadyVB && alreadyRB) {
            return interaction.reply({ content: `⚠️ ${targetMember} è già bloccato (VB + RB).`, ephemeral: true });
        }

        const removed = await econDb.removeItem(userId, 'catene');
        if (!removed) return interaction.reply({ content: "❌ Errore.", ephemeral: true });

        // Trova partner
        let partnerId = null;
        if (targetMember.roles.cache.has(RUOLI.ALIVE)) {
            partnerId = await db.meeting.findSponsor(targetUserId);
        } else if (targetMember.roles.cache.has(RUOLI.SPONSOR)) {
            partnerId = await db.meeting.findPlayer(targetUserId);
        }

        const partnerMember = partnerId ? await interaction.guild.members.fetch(partnerId).catch(() => null) : null;
        const results = [];

        // Applica VB
        if (!alreadyVB) {
            await db.moderation.addBlockedVB(targetUserId, targetMember.user.tag);
            results.push(`🚫 **${targetMember.user.tag}** → Visitblock`);
            if (partnerMember && !(await db.moderation.isBlockedVB(partnerId))) {
                await db.moderation.addBlockedVB(partnerId, partnerMember.user.tag);
                results.push(`🚫 **${partnerMember.user.tag}** (partner) → Visitblock`);
            }
        }

        // Applica RB
        if (!alreadyRB) {
            await db.moderation.addBlockedRB(targetUserId, targetMember.user.tag);
            results.push(`🚫 **${targetMember.user.tag}** → Roleblock`);
            if (partnerMember && !(await db.moderation.isBlockedRB(partnerId))) {
                await db.moderation.addBlockedRB(partnerId, partnerMember.user.tag);
                results.push(`🚫 **${partnerMember.user.tag}** (partner) → Roleblock`);
            }
        }

        // Log uso catene
        await logShopAction(interaction.client, userId, interaction.user.tag, 'use_catene', 
            'Catene', `🎯 Target: ${targetMember.user.tag} (<@${targetUserId}>)\n` + results.join('\n'));

        await interaction.reply({ embeds: [
            new EmbedBuilder().setColor('#2C3E50').setTitle('⛓️ Catene Applicate!')
                .setDescription(results.join('\n')).setTimestamp()
        ], ephemeral: false });

        await interaction.message.delete().catch(() => {});
    });

    // ==========================================
    // 📜 TESTAMENTO CHANNEL SELECT HANDLER
    // ==========================================
    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu()) return;
        if (!interaction.customId.startsWith('testamento_channel_')) return;

        const userId = interaction.customId.split('_')[2];
        if (interaction.user.id !== userId) 
            return interaction.reply({ content: "❌ Non è il tuo menu!", ephemeral: true });

        const channelId = interaction.values[0];
        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) return interaction.reply({ content: "❌ Canale non trovato.", ephemeral: true });

        // Controlla se il testamento è già usato per questo canale
        const usedChannels = await econDb.getTestamentoChannels(userId);
        if (usedChannels.includes(channelId)) {
            return interaction.reply({ content: "❌ Hai già usato il testamento in questo canale!", ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId(`testamento_modal_${userId}_${channelId}`)
            .setTitle(`Messaggio per ${formatName(channel.name)}`);

        const textInput = new TextInputBuilder()
            .setCustomId('testamento_text')
            .setLabel('Il tuo messaggio')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(500)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(textInput));
        await interaction.showModal(modal);
    });

    // ==========================================
    // 📜 TESTAMENTO MODAL HANDLER
    // ==========================================
    client.on('interactionCreate', async interaction => {
        if (!interaction.isModalSubmit()) return;
        if (!interaction.customId.startsWith('testamento_modal_')) return;

        const parts = interaction.customId.split('_');
        const userId = parts[2];
        const channelId = parts[3];

        if (interaction.user.id !== userId) return;

        const text = interaction.fields.getTextInputValue('testamento_text');
        const channel = interaction.guild.channels.cache.get(channelId);
        if (!channel) return interaction.reply({ content: "❌ Canale non trovato.", ephemeral: true });

        // Verifica possesso testamento
        const hasItem = await econDb.hasItem(userId, 'testamento');
        if (!hasItem) return interaction.reply({ content: "❌ Non hai il testamento!", ephemeral: true });

        // Controlla se il testamento è già usato per questo canale
        const usedChannels = await econDb.getTestamentoChannels(userId);
        if (usedChannels.includes(channelId)) {
            return interaction.reply({ content: "❌ Hai già usato il testamento in questo canale!", ephemeral: true });
        }

        // Rimuovi testamento e aggiungi canale alla lista
        await Promise.all([
            econDb.removeItem(userId, 'testamento'),
            econDb.addTestamentoChannel(userId, channelId)
        ]);

        await channel.send({ embeds: [
            new EmbedBuilder().setColor('#8E44AD').setTitle('📜 Messaggio dal Testamento')
                .setDescription(`*"${text}"*`)
                .setFooter({ text: 'Messaggio anonimo' })
                .setTimestamp()
        ]});

        // Log uso testamento
        await logShopAction(interaction.client, userId, interaction.user.tag, 'use_testamento', 
            'Testamento', `📺 Canale: ${formatName(channel.name)}\n📝 Messaggio: "${text}"`);

        await interaction.reply({ content: "📜 Testamento inviato con successo!", ephemeral: true });
    });

    // ==========================================
    // ⛺ TENDA BUTTON HANDLERS
    // ==========================================
    client.on('interactionCreate', async interaction => {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('tenda_')) return;

        const [, action, requesterId] = interaction.customId.split('_');
        const ownerId = await db.housing.findOwner(interaction.channel.id);
        
        if (interaction.user.id !== ownerId) {
            return interaction.reply({ content: "❌ Solo il proprietario può rispondere!", ephemeral: true });
        }

        if (action === 'yes') {
            const requester = await interaction.guild.members.fetch(requesterId).catch(() => null);
            if (!requester) return interaction.update({ content: "❌ Richiedente non trovato.", components: [] });

            const sponsors = await getSponsorsToMove(requester, interaction.guild);
            await cleanOldHome(requesterId, interaction.guild);
            for (const s of sponsors) await cleanOldHome(s.id, interaction.guild);

            await db.housing.setHome(requesterId, interaction.channel.id);
            for (const s of sponsors) await db.housing.setHome(s.id, interaction.channel.id);

            await interaction.channel.permissionOverwrites.edit(requesterId, { ViewChannel: true, SendMessages: true });
            const pinnedMsg = await interaction.channel.send(`🔑 ${requester}, dimora assegnata (Comproprietario).`);
            await pinnedMsg.pin();

            // Log uso tenda
            await logShopAction(interaction.client, requesterId, requester.user.tag, 'use_tenda', 
                'Tenda', `🏠 Casa: ${formatName(interaction.channel.name)}\n✅ Accettato da: ${interaction.user.tag}`);

            await interaction.update({ content: "⛺ Trasferimento accettato!", embeds: [], components: [] });
        } else {
            await interaction.update({ content: "❌ Trasferimento rifiutato.", embeds: [], components: [] });
        }
    });
}

// ==========================================
// 🛒 MOSTRA SHOP
// ==========================================
async function showShop(message) {
    const description = SHOP_ITEMS.map(item =>
        `${item.emoji} **${item.name}** - ${item.price} 🪙\n${item.description}\nID: \`${item.id}\``
    ).join('\n\n');

    const options = SHOP_ITEMS.map(item =>
        new StringSelectMenuOptionBuilder()
            .setLabel(item.name)
            .setValue(item.id)
            .setDescription(`${item.price} 🪙`)
            .setEmoji(item.emoji)
    );

    const select = new StringSelectMenuBuilder()
        .setCustomId(`shop_buy_${message.author.id}`)
        .setPlaceholder('Scegli cosa comprare...')
        .addOptions(options);

    const embed = new EmbedBuilder()
        .setTitle('🛒 Mercato')
        .setDescription('**Oggetti disponibili:**\n\n' + description)
        .setColor('#3498DB')
        .setFooter({ text: 'Usa il menu qui sotto per acquistare!' })
        .setTimestamp();

    const msg = await message.channel.send({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(select)]
    });

    setTimeout(() => msg.delete().catch(() => {}), 120000);
}

// ==========================================
// 💼 MOSTRA INVENTARIO
// ==========================================
async function showInventory(message, user) {
    await econDb.ensureProfile(user.id);
    const inventory = await econDb.getInventory(user.id);
    
    if (!inventory || Object.keys(inventory).length === 0) {
        return message.channel.send(`📦 **${user.username}** non ha oggetti nell'inventario.`);
    }

    const items = Object.entries(inventory)
        .filter(([, qty]) => qty > 0)
        .map(([id, qty]) => {
            const item = SHOP_ITEMS.find(i => i.id === id);
            return item ? `${item.emoji} **${item.name}** x${qty}` : `❓ ${id} x${qty}`;
        })
        .join('\n');

    message.channel.send({ embeds: [
        new EmbedBuilder().setTitle(`📦 Inventario di ${user.username}`)
            .setDescription(items || 'Vuoto').setColor('#27AE60').setTimestamp()
    ]});
}

// ==========================================
// 💰 ACQUISTA OGGETTO
// ==========================================
async function buyItem(message, itemId, client) {
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return message.reply("❌ Oggetto non valido.");

    const balance = await econDb.getBalance(message.author.id);
    if (balance < item.price) {
        return message.reply(`❌ Fondi insufficienti! Ti servono **${item.price} 🪙**, hai solo **${balance} 🪙**.`);
    }

    const removed = await econDb.removeBalance(message.author.id, item.price);
    if (!removed) return message.reply("❌ Errore nella transazione.");

    await econDb.addItem(message.author.id, itemId);
    
    // Log acquisto
    await logShopAction(client, message.author.id, message.author.tag, 'buy', item.name);
    
    message.reply(`✅ Hai comprato **${item.name}** per **${item.price} 🪙**!`);
}

// ==========================================
// 📊 CLASSIFICA
// ==========================================
async function showLeaderboard(message, client) {
    const top = await econDb.getTopBalances(10);
    if (top.length === 0) return message.reply("📊 Nessun dato disponibile.");

    const list = await Promise.all(top.map(async (entry, i) => {
        const user = await client.users.fetch(entry.userId).catch(() => null);
        const name = user ? user.username : 'Utente sconosciuto';
        return `**${i + 1}.** ${name} - ${entry.balance} 🪙`;
    }));

    message.channel.send({ embeds: [
        new EmbedBuilder().setTitle('🏆 Classifica Ricchezza')
            .setDescription(list.join('\n')).setColor('#F39C12').setTimestamp()
    ]});
}

// ==========================================
// 🧹 USA SCOPA
// ==========================================
async function useScopa(message, args, client) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CASE)
        return message.reply("❌ Usa la scopa solo in una casa!");

    if (!message.reference) return message.reply("❌ Rispondi al messaggio da cui iniziare la pulizia!");

    const refMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (!refMsg) return message.reply("❌ Messaggio di riferimento non trovato.");

    const removed = await econDb.removeItem(message.author.id, 'scopa');
    if (!removed) return message.reply("❌ Errore.");

    const messages = await message.channel.messages.fetch({ after: refMsg.id, limit: 100 });
    const toDelete = [];
    
    for (const [, msg] of messages) {
        const hasShield = msg.reactions.cache.has('🛡️');
        if (!hasShield) toDelete.push(msg);
    }

    if (!refMsg.reactions.cache.has('🛡️')) toDelete.push(refMsg);

    let deleted = 0;
    for (const msg of toDelete) {
        await msg.delete().catch(() => {});
        deleted++;
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Log uso scopa
    await logShopAction(client, message.author.id, message.author.tag, 'use_scopa', 
        'Scopa', `🏠 Casa: ${formatName(message.channel.name)}\n🗑️ Messaggi cancellati: ${deleted}`);

    const confirmMsg = await message.channel.send(`🧹 Pulizia completata! ${deleted} messaggi rimossi.`);
    setTimeout(() => confirmMsg.delete().catch(() => {}), 10000);
}

// ==========================================
// ✉️ USA LETTERA (con menu a tendina)
// ==========================================
async function useLettera(message, args, client) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
        return message.reply("❌ Usa la lettera solo nella tua chat privata!");

    // Ottieni tutti i giocatori con ruolo ALIVE che non sono nella lista morti
    const markedForDeath = await db.moderation.getMarkedForDeath();
    const deadUserIds = markedForDeath.map(m => m.userId);
    
    const allMembers = await message.guild.members.fetch();
    const aliveMembers = allMembers.filter(m => 
        !m.user.bot && 
        m.roles.cache.has(RUOLI.ALIVE) && 
        !deadUserIds.includes(m.id) &&
        m.id !== message.author.id
    );

    if (aliveMembers.size === 0) {
        return message.reply("❌ Nessun giocatore disponibile per inviare la lettera.");
    }

    // Crea menu a tendina con i nomi visualizzati
    const options = aliveMembers.map(m => 
        new StringSelectMenuOptionBuilder()
            .setLabel(m.displayName)
            .setValue(m.id)
            .setEmoji('👤')
    ).slice(0, 25); // Max 25 opzioni

    const select = new StringSelectMenuBuilder()
        .setCustomId(`lettera_select_${message.author.id}`)
        .setPlaceholder('Seleziona il destinatario...')
        .addOptions(options);

    const msg = await message.reply({
        content: '✉️ **Seleziona a chi vuoi inviare la lettera:**',
        components: [new ActionRowBuilder().addComponents(select)]
    });

    setTimeout(() => msg.delete().catch(() => {}), 120000);
}

// ==========================================
// 👟 USA SCARPE
// ==========================================
async function useScarpe(message, client) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
        return message.reply("❌ Usa le scarpe solo nella tua chat privata!");

    const removed = await econDb.removeItem(message.author.id, 'scarpe');
    if (!removed) return message.reply("❌ Errore.");

    await db.housing.addExtraVisit(message.author.id, 'base', 1, false);
    const info = await db.housing.getVisitInfo(message.author.id);

    // Log uso scarpe
    await logShopAction(client, message.author.id, message.author.tag, 'use_scarpe', 'Scarpe');

    message.channel.send({ embeds: [
        new EmbedBuilder().setColor('#E74C3C').setTitle('👟 Scarpe Utilizzate!')
            .setDescription('Hai ottenuto **+1 visita base**!')
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
// ⛓️ USA CATENE (auto VB + RB su target + partner con menu a tendina)
// ==========================================
async function useCatene(message, args, client) {
    if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
        return message.reply("❌ Usa le catene solo nella tua chat privata!");

    // Ottieni tutti i giocatori con ruolo ALIVE che non sono nella lista morti
    const markedForDeath = await db.moderation.getMarkedForDeath();
    const deadUserIds = markedForDeath.map(m => m.userId);
    
    const allMembers = await message.guild.members.fetch();
    const aliveMembers = allMembers.filter(m => 
        !m.user.bot && 
        m.roles.cache.has(RUOLI.ALIVE) && 
        !deadUserIds.includes(m.id) &&
        m.id !== message.author.id
    );

    if (aliveMembers.size === 0) {
        return message.reply("❌ Nessun giocatore disponibile per usare le catene.");
    }

    // Crea menu a tendina con i nomi visualizzati
    const options = aliveMembers.map(m => 
        new StringSelectMenuOptionBuilder()
            .setLabel(m.displayName)
            .setValue(m.id)
            .setEmoji('⛓️')
    ).slice(0, 25); // Max 25 opzioni

    const select = new StringSelectMenuBuilder()
        .setCustomId(`catene_select_${message.author.id}`)
        .setPlaceholder('Seleziona chi bloccare...')
        .addOptions(options);

    const msg = await message.reply({
        content: '⛓️ **Seleziona il giocatore da bloccare (VB + RB):**',
        components: [new ActionRowBuilder().addComponents(select)]
    });

    setTimeout(() => msg.delete().catch(() => {}), 120000);
}

// Helper per trovare partner
async function findPartner(member, guild) {
    let partnerId = null;
    if (member.roles.cache.has(RUOLI.ALIVE)) {
        partnerId = await db.meeting.findSponsor(member.id);
    } else if (member.roles.cache.has(RUOLI.SPONSOR)) {
        partnerId = await db.meeting.findPlayer(member.id);
    }
    return partnerId ? await guild.members.fetch(partnerId).catch(() => null) : null;
}

// ==========================================
// 🎆 USA FUOCHI D'ARTIFICIO
// ==========================================
async function useFuochi(message, client) {
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

    // Log uso fuochi
    await logShopAction(client, message.author.id, message.author.tag, 'use_fuochi', 
        'Fuochi d\'artificio', `🏠 Casa: ${houseName}`);

    message.reply(`🎆 Fuochi lanciati! Annuncio pubblicato.`);
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

        // Log uso tenda
        await logShopAction(client, message.author.id, message.author.tag, 'use_tenda', 
            'Tenda', `🏠 Casa: ${formatName(newHomeChannel.name)}\n✅ Trasferimento diretto (casa senza proprietario)`);

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
        } else {
            await i.update({ content: "❌ Trasferimento rifiutato.", embeds: [], components: [] });
        }
    });
}

// Export principale: funzione init (compatibile con app.js)
// + econDb e SHOP_ITEMS per uso esterno (es. !cambio)
module.exports = registerEconomyCommands;
module.exports.econDb = econDb;
module.exports.SHOP_ITEMS = SHOP_ITEMS;
