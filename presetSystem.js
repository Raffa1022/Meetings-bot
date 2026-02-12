// ==========================================
// ⏰ PRESET SYSTEM - Azioni Programmate
// DIURNO + NOTTURNO + TIMER + FIX PAGINAZIONE CASE
// 🔥 NUOVO: Visite scalate dalla fase SUCCESSIVA
// ==========================================
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, PermissionsBitField
} = require('discord.js');
const { HOUSING, RUOLI } = require('./config');
const db = require('./db');
const eventBus = require('./eventBus');
const { formatName } = require('./helpers');

// 🔥 LISTA OGGETTI LOCALE
const SHOP_ITEMS_REF = [
    { id: 'lettera',    name: 'Lettera',              emoji: '✉️' },
    { id: 'scarpe',     name: 'Scarpe',               emoji: '👟' },
    { id: 'testamento', name: 'Testamento',           emoji: '📜' },
    { id: 'catene',     name: 'Catene',               emoji: '⛓️' }, 
    { id: 'fuochi',     name: 'Fuochi d\'artificio',  emoji: '🎆' },
    { id: 'tenda',      name: 'Tenda',                emoji: '⛺' },
];

const activePresetSessions = new Map(); // userId -> session data

// ==========================================
// 📊 PRIORITY ORDER
// ==========================================
const PRIORITY_ORDER = {
    'SHOP': 1,
    'ROLEBLOCK': 2,
    'MANIPOLAZIONE': 3,
    'VISITBLOCK': 4,
    'CURA': 5,
    'ALTRO': 6,
    'TRASPORTO': 7,
    'POTENZIAMENTO': 8,
    'PROTEZIONE': 9,
    'COMUNICAZIONE': 10,
    'LETALE': 11,
    'INFORMAZIONE': 12,
    'KNOCK': 13,
};

const CATEGORIES = [
    { label: 'Bussa', value: 'KNOCK', emoji: '✊' },
    { label: 'Oggetti Shop', value: 'SHOP', emoji: '🛒' },
    { label: 'Protezione', value: 'PROTEZIONE', emoji: '🛡️' },
    { label: 'Letale', value: 'LETALE', emoji: '⚔️' },
    { label: 'Informazione', value: 'INFORMAZIONE', emoji: '🔍' },
    { label: 'Comunicazione', value: 'COMUNICAZIONE', emoji: '💬' },
    { label: 'Potenziamento', value: 'POTENZIAMENTO', emoji: '⚡' },
    { label: 'Trasporto', value: 'TRASPORTO', emoji: '🚗' },
    { label: 'Cura', value: 'CURA', emoji: '💊' },
    { label: 'Visitblock', value: 'VISITBLOCK', emoji: '🚫' },
    { label: 'Roleblock', value: 'ROLEBLOCK', emoji: '🔒' },
    { label: 'Manipolazione', value: 'MANIPOLAZIONE', emoji: '🎭' },
    { label: 'Altro', value: 'ALTRO', emoji: '❓' },
];

// ==========================================
// 🗄️ PRESET DATABASE REPOSITORY
// ==========================================
const presetDb = {
    // --- NIGHT ---
    async addNightPreset(userId, userName, type, category, details) {
        const { PresetNightModel } = require('./database');
        return PresetNightModel.create({ userId, userName, type, category, details, timestamp: new Date() });
    },
    async getAllNightPresets() {
        const { PresetNightModel } = require('./database');
        return PresetNightModel.find({}).sort({ timestamp: 1 }).lean();
    },
    async getUserNightPresets(userId) {
        const { PresetNightModel } = require('./database');
        return PresetNightModel.find({ userId }).sort({ timestamp: 1 }).lean();
    },
    async removeNightPreset(id) {
        const { PresetNightModel } = require('./database');
        return PresetNightModel.findByIdAndDelete(id);
    },
    async clearAllNightPresets() {
        const { PresetNightModel } = require('./database');
        return PresetNightModel.deleteMany({});
    },

    // --- DAY ---
    async addDayPreset(userId, userName, type, category, details) {
        const { PresetDayModel } = require('./database');
        return PresetDayModel.create({ userId, userName, type, category, details, timestamp: new Date() });
    },
    async getAllDayPresets() {
        const { PresetDayModel } = require('./database');
        return PresetDayModel.find({}).sort({ timestamp: 1 }).lean();
    },
    async getUserDayPresets(userId) {
        const { PresetDayModel } = require('./database');
        return PresetDayModel.find({ userId }).sort({ timestamp: 1 }).lean();
    },
    async removeDayPreset(id) {
        const { PresetDayModel } = require('./database');
        return PresetDayModel.findByIdAndDelete(id);
    },
    async clearAllDayPresets() {
        const { PresetDayModel } = require('./database');
        return PresetDayModel.deleteMany({});
    },
// --- GET BY ID (per recupero prima della rimozione) ---
async getNightPresetById(id) {
    const { PresetNightModel } = require('./database');
    return PresetNightModel.findById(id).lean();
},
async getDayPresetById(id) {
    const { PresetDayModel } = require('./database');
    return PresetDayModel.findById(id).lean();
},
async getScheduledPresetById(id) {
    const { PresetScheduledModel } = require('./database');
    return PresetScheduledModel.findById(id).lean();
},
    // --- SCHEDULED ---
    async addScheduledPreset(userId, userName, type, category, details, triggerTime) {
        const { PresetScheduledModel } = require('./database');
        return PresetScheduledModel.create({ userId, userName, type, category, details, timestamp: new Date(), triggerTime });
    },
    async getAllScheduledPresets() {
        const { PresetScheduledModel } = require('./database');
        return PresetScheduledModel.find({}).sort({ triggerTime: 1 }).lean();
    },
    async getUserScheduledPresets(userId) {
        const { PresetScheduledModel } = require('./database');
        return PresetScheduledModel.find({ userId }).sort({ triggerTime: 1 }).lean();
    },
    async removeScheduledPreset(id) {
        const { PresetScheduledModel } = require('./database');
        return PresetScheduledModel.findByIdAndDelete(id);
    },
    async clearScheduledPresets(triggerTime) {
        const { PresetScheduledModel } = require('./database');
        return PresetScheduledModel.deleteMany({ triggerTime });
    },
    async getScheduledPresetsAtTime(triggerTime) {
        const { PresetScheduledModel } = require('./database');
        return PresetScheduledModel.find({ triggerTime }).sort({ timestamp: 1 }).lean();
    },
};

// ==========================================
// 📊 DASHBOARD ADMIN
// ==========================================
async function showAdminDashboard(message) {
    const nightPresets = await presetDb.getAllNightPresets();
    const dayPresets = await presetDb.getAllDayPresets();
    const scheduledPresets = await presetDb.getAllScheduledPresets();

    const allPresets = [];
    nightPresets.forEach(p => allPresets.push({ ...p, source: '🌙 NOTTE' }));
    dayPresets.forEach(p => allPresets.push({ ...p, source: '☀️ GIORNO' }));
    scheduledPresets.forEach(p => allPresets.push({ ...p, source: `⏰ ${p.triggerTime}` }));

    if (allPresets.length === 0) return message.channel.send("✅ **Nessun preset in attesa.**");

    const grouped = {};
    for (const p of allPresets) {
        const cat = p.category || 'ALTRO';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(p);
    }

    const sortedCategories = Object.keys(grouped).sort((a, b) => (PRIORITY_ORDER[a] || 999) - (PRIORITY_ORDER[b] || 999));

    let description = '';
    for (const cat of sortedCategories) {
        const icon = CATEGORIES.find(c => c.value === cat)?.emoji || '❓';
        description += `\n**${icon} ${cat}**\n`;
        
        grouped[cat].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        for (const p of grouped[cat]) {
            let details = '';
            if (p.type === 'KNOCK') {
                 const chName = message.guild.channels.cache.get(p.details.targetChannelId)?.name || 'Casa ???';
                 const mode = p.details.mode === 'mode_forced' ? '🧨' : (p.details.mode === 'mode_hidden' ? '🕵️' : '👋');
                 details = `→ 🏠 ${formatName(chName)} ${mode}`;
            } else if (p.type === 'SHOP') {
                details = `→ 🛒 ${p.details.itemName}` + (p.details.targetUserId ? ` su <@${p.details.targetUserId}>` : '');
            } else if (p.type === 'ABILITY') {
                details = `→ ${p.details.target ? `su ${p.details.target}` : 'generico'}`;
            }
            description += `\`[${p.source}]\` **${p.userName}** ${details}\n`;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('📋 Dashboard Preset Globale')
        .setColor('Gold')
        .setDescription(description.substring(0, 4096))
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
}

// ==========================================
// 🎮 GESTIONE COMANDO PRESET
// ==========================================
async function handlePresetCommand(message, args, presetType, triggerTime = null) {
    const userId = message.author.id;
    const userName = message.member?.displayName || message.author.username;
    
    activePresetSessions.set(userId, {
        presetType, triggerTime, channelId: message.channel.id, userName
    });

    const categorySelect = new StringSelectMenuBuilder()
        .setCustomId('preset_category')
        .setPlaceholder('Scegli la categoria...')
        .addOptions(CATEGORIES.map(cat => 
            new StringSelectMenuOptionBuilder().setLabel(cat.label).setValue(cat.value).setEmoji(cat.emoji)
        ));

    const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('preset_close').setLabel('Annulla').setStyle(ButtonStyle.Danger).setEmoji('❌')
    );

    let label = '❓';
    if (presetType === 'night') label = '🌙 Notturno';
    if (presetType === 'day') label = '☀️ Diurno';
    if (presetType === 'scheduled') label = `⏰ Timer (${triggerTime})`;

    await message.reply({
        content: `**Creazione Preset ${label}**\nSeleziona la categoria dell'azione:`,
        components: [new ActionRowBuilder().addComponents(categorySelect), closeRow]
    });
}

// ==========================================
// 🔧 INTERACTION HANDLERS
// ==========================================
function registerPresetInteractions(client) {
    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu() && !interaction.isButton() && !interaction.isModalSubmit()) return;
        if (!interaction.customId.startsWith('preset_')) return;

        const userId = interaction.user.id;
        const session = activePresetSessions.get(userId);

        // CLOSE
        if (interaction.customId === 'preset_close') {
            activePresetSessions.delete(userId);
            await interaction.update({ content: '❌ Annullato.', components: [] });
            return;
        }

        // INDIETRO
        if (interaction.customId === 'preset_back_category') {
             if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
             
             const categorySelect = new StringSelectMenuBuilder()
                .setCustomId('preset_category')
                .setPlaceholder('Scegli la categoria...')
                .addOptions(CATEGORIES.map(cat => 
                    new StringSelectMenuOptionBuilder().setLabel(cat.label).setValue(cat.value).setEmoji(cat.emoji)
                ));
            await interaction.update({
                content: '**Seleziona la categoria dell\'azione:**',
                components: [new ActionRowBuilder().addComponents(categorySelect)]
            });
            return;
        }

        // INDIETRO PAGINE
        if (interaction.customId === 'preset_back_to_pages') {
             if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
             const { components, content } = await buildPageSelect(interaction.guild, userId);
             await interaction.update({ content, components });
             return;
        }

        // SELEZIONE CATEGORIA
        if (interaction.customId === 'preset_category') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const category = interaction.values[0];
            session.category = category;

            // 1. KNOCK (Bussa)
            if (category === 'KNOCK') {
                const modeSelect = new StringSelectMenuBuilder()
                    .setCustomId('preset_knock_mode')
                    .setPlaceholder('Scegli la modalità...')
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel('Visita Normale').setValue('mode_normal').setEmoji('👋'),
                        new StringSelectMenuOptionBuilder().setLabel('Visita Forzata').setValue('mode_forced').setEmoji('🧨'),
                        new StringSelectMenuOptionBuilder().setLabel('Visita Nascosta').setValue('mode_hidden').setEmoji('🕵️')
                    );
                await interaction.update({
                    content: '🎭 **Step 2: Modalità visita:**',
                    components: [new ActionRowBuilder().addComponents(modeSelect)]
                });
            }
            // 2. SHOP
            else if (category === 'SHOP') {
                const { econDb } = require('./economySystem');
                const inventory = await econDb.getInventory(userId);
                const validItems = SHOP_ITEMS_REF.filter(item => inventory[item.id] > 0);

                if (validItems.length === 0) {
                    return interaction.update({ content: '❌ Inventario vuoto (NO Scopa).', components: [] });
                }

                const itemSelect = new StringSelectMenuBuilder()
                    .setCustomId('preset_shop_item')
                    .setPlaceholder('Seleziona oggetto...')
                    .addOptions(validItems.map(item => 
                        new StringSelectMenuOptionBuilder().setLabel(item.name).setValue(item.id).setEmoji(item.emoji)
                    ));
                await interaction.update({
                    content: '🛒 **Step 2: Oggetto:**',
                    components: [new ActionRowBuilder().addComponents(itemSelect)]
                });
            }
            // 3. GENERICO (Modal)
            else {
                const modal = new ModalBuilder().setCustomId(`preset_modal_${category}`).setTitle(`Preset ${category}`);
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('target').setLabel('Target (Opzionale)').setStyle(TextInputStyle.Short).setRequired(false)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Dettagli').setStyle(TextInputStyle.Paragraph).setRequired(true))
                );
                await interaction.showModal(modal);
            }
        }

        // KNOCK: MODE -> PAGE SELECTION (Step intermedio aggiunto)
        if (interaction.customId === 'preset_knock_mode') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            session.knockMode = interaction.values[0];

            // Mostra selezione pagine
            const { components, content } = await buildPageSelect(interaction.guild, userId);
            await interaction.update({ content, components });
        }

        // KNOCK: PAGE SELECTED -> HOUSE LIST
        if (interaction.customId === 'preset_page_select') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            
            const pageIndex = parseInt(interaction.values[0].split('_')[1]); // "page_0"
            const houses = await getAvailableHousesSorted(interaction.guild, userId);
            
            const PAGE_SIZE = 25;
            
            // FIX: Filtro per range numerico invece di slice
            const minRange = pageIndex * PAGE_SIZE + 1;
            const maxRange = (pageIndex + 1) * PAGE_SIZE;
            
            const casePagina = houses.filter(h => {
                const match = h.name.match(/(\w+)-(\d+)/); // Supporta: casa-10, taverna-5, villa-3, etc.
                if (!match) return false;
                const houseNum = parseInt(match[2]);
                return houseNum >= minRange && houseNum <= maxRange;
            });

            if (casePagina.length === 0)
                return interaction.reply({ content: "❌ Nessuna casa in questa pagina.", ephemeral: true });

            const houseSelect = new StringSelectMenuBuilder()
                .setCustomId('preset_house')
                .setPlaceholder('Scegli casa...')
                .addOptions(casePagina.map(h => 
                    new StringSelectMenuOptionBuilder().setLabel(formatName(h.name)).setValue(h.id).setEmoji('🏠')
                ));

            const backBtn = new ButtonBuilder()
                .setCustomId('preset_back_to_pages')
                .setLabel('Indietro').setStyle(ButtonStyle.Secondary).setEmoji('◀️');

            await interaction.update({
                content: `🏘️ **Pagina ${pageIndex + 1}: Scegli casa:**`,
                components: [
                    new ActionRowBuilder().addComponents(houseSelect),
                    new ActionRowBuilder().addComponents(backBtn),
                ]
            });
        }
        
                // HOUSE SELECTED (KNOCK) - 🔥 MODIFICATO: Controllo dinamico (senza scalare dal DB)
        if (interaction.customId === 'preset_house') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const targetChannelId = interaction.values[0];
                        // 🔥 NUOVO CONTROLLO: Impedisci doppio Bussa nel preset
            let currentPresets = [];
            if (session.presetType === 'night') currentPresets = await presetDb.getUserNightPresets(userId);
            else if (session.presetType === 'day') currentPresets = await presetDb.getUserDayPresets(userId);
            else currentPresets = await presetDb.getUserScheduledPresets(userId);

            if (currentPresets.some(p => p.type === 'KNOCK')) {
                return interaction.reply({ 
                    content: "⛔ **Hai già programmato un'azione 'Bussa'!**\nNon puoi inserire due visite nello stesso preset.", 
                    ephemeral: true 
                });
            }
            
            // 1. Recupera info limiti fase successiva
            // Se siamo in Giorno, ci darà i limiti della Notte. Se siamo in Notte, quelli del Giorno.
            const nextPhaseInfo = await db.housing.getNextPhaseVisitInfo(userId);
            if (!nextPhaseInfo) return interaction.reply({ content: "❌ Errore dati visite.", ephemeral: true });
            
            const mode = session.knockMode;
            const nextPhaseLabel = nextPhaseInfo.nextMode === 'DAY' ? 'diurne' : 'notturne';
            
            // 2. Conta i preset GIÀ salvati per la fase di destinazione
            let existingPresets = [];
            if (nextPhaseInfo.nextMode === 'NIGHT') {
                existingPresets = await presetDb.getUserNightPresets(userId);
            } else {
                existingPresets = await presetDb.getUserDayPresets(userId);
            }

            // Filtra per capire quanti slot sono già occupati
            const usedForced = existingPresets.filter(p => p.type === 'KNOCK' && p.details.mode === 'mode_forced').length;
            const usedHidden = existingPresets.filter(p => p.type === 'KNOCK' && p.details.mode === 'mode_hidden').length;
            const usedTotal = existingPresets.filter(p => p.type === 'KNOCK').length; // Totale visite (Normali + Speciali)

            // 3. Verifica disponibilità MATEMATICA (Limite Permanente - Preset Già Fatti)
            if (mode === 'mode_forced') {
                // Esempio: Limite 1 - Usate 1 = 0 (Errore se provi a farne un'altra)
                if (nextPhaseInfo.forcedLimit - usedForced <= 0) {
                    return interaction.reply({ 
                        content: `⛔ **Non hai visite forzate ${nextPhaseLabel} disponibili!**\nLimite totale: ${nextPhaseInfo.forcedLimit}\nGià programmate: ${usedForced}`, 
                        ephemeral: true 
                    });
                }
                // NON scaliamo nulla dal DB
            } else if (mode === 'mode_hidden') {
                if (nextPhaseInfo.hiddenLimit - usedHidden <= 0) {
                    return interaction.reply({ 
                        content: `⛔ **Non hai visite nascoste ${nextPhaseLabel} disponibili!**\nLimite totale: ${nextPhaseInfo.hiddenLimit}\nGià programmate: ${usedHidden}`, 
                        ephemeral: true 
                    });
                }
                // NON scaliamo nulla dal DB
            } else {
                // Visita normale (controlla il totale generale base+extra)
                if (nextPhaseInfo.totalLimit - usedTotal <= 0) {
                    return interaction.reply({ 
                        content: `⛔ **Non hai visite normali ${nextPhaseLabel} disponibili!**\nLimite totale: ${nextPhaseInfo.totalLimit}\nGià programmate: ${usedTotal}`, 
                        ephemeral: true 
                    });
                }
            }
            
            const details = { targetChannelId, mode: session.knockMode };
            // Salviamo il preset SENZA toccare i contatori permanenti e SENZA salvare visitPhaseScaled
            await savePreset(interaction, session, 'KNOCK', 'KNOCK', details, session.userName);
        }


        // SHOP: ITEM SELECT
        if (interaction.customId === 'preset_shop_item') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const itemId = interaction.values[0];
            session.shopItemId = itemId;
            const itemDef = SHOP_ITEMS_REF.find(i => i.id === itemId);

            if (itemId === 'lettera' || itemId === 'testamento') {
                if (itemId === 'testamento') {
                     // Testamento: rimuovi item e save diretto
                    const { econDb } = require('./economySystem');
                    const hasItem = await econDb.hasItem(userId, itemId, 1);
                    if (!hasItem) return interaction.update({ content: '❌ Non hai questo oggetto!', components: [] });
                    
                    await econDb.removeItem(userId, itemId, 1);
                    const details = { subType: itemId, itemName: itemDef.name };
                    await savePreset(interaction, session, 'SHOP', 'SHOP', details, session.userName, `✅ Testamento salvato in preset.`);
                } else {
                    // Lettera: chiedi target
                    const aliveMembers = await getAlivePlayers(interaction.guild, userId);
                    const playerSelect = new StringSelectMenuBuilder()
                        .setCustomId('preset_lettera_target')
                        .setPlaceholder('Destinatario lettera...')
                        .addOptions(aliveMembers.slice(0, 25).map(p => 
                            new StringSelectMenuOptionBuilder().setLabel(p.name).setValue(p.id).setEmoji('👤')
                        ));
                    
                    return interaction.update({
                        content: `✉️ **Step 3: A chi invii la lettera?**`,
                        components: [new ActionRowBuilder().addComponents(playerSelect)]
                    });
                }
            }

            else if (itemId === 'catene') {
                const aliveMembers = await getAlivePlayers(interaction.guild, userId);
                const playerSelect = new StringSelectMenuBuilder()
                    .setCustomId('preset_item_target')
                    .setPlaceholder('Chi vuoi incatenare?')
                    .addOptions(aliveMembers.slice(0, 25).map(p => 
                        new StringSelectMenuOptionBuilder().setLabel(p.name).setValue(p.id).setEmoji('⛓️')
                    ));
                return interaction.update({
                    content: `⛓️ **Step 3: Target Catene:**`,
                    components: [new ActionRowBuilder().addComponents(playerSelect)]
                });
            }

            else {
                // Scarpe, Fuochi, Tenda: verifica e rimuovi, poi salva
                const { econDb } = require('./economySystem');
                const hasItem = await econDb.hasItem(userId, itemId, 1);
                if (!hasItem) return interaction.update({ content: '❌ Non hai questo oggetto!', components: [] });
                
                await econDb.removeItem(userId, itemId, 1);
                // NON salviamo responseChannelId fisso, verrà calcolato dinamicamente quando il preset viene eseguito
                const details = { subType: itemId, itemName: itemDef.name };
                await savePreset(interaction, session, 'SHOP', 'SHOP', details, session.userName, 
                    `✅ Oggetto **${itemDef.name}** salvato in preset.`);
            }
        }

        // LETTERA: TARGET SELEZIONATO
        if (interaction.customId === 'preset_lettera_target') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            session.letteraTarget = interaction.values[0];

            const modal = new ModalBuilder()
                .setCustomId('preset_lettera_content')
                .setTitle('Scrivi il contenuto');
            
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('content').setLabel('Messaggio (max 10 parole)').setStyle(TextInputStyle.Paragraph).setRequired(true)
            ));
            
            await interaction.showModal(modal);
        }

        // LETTERA: CONTENUTO SALVATO
        if (interaction.customId === 'preset_lettera_content') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const content = interaction.fields.getTextInputValue('content');
            
            if (content.trim().split(/\s+/).length > 10) 
                return interaction.reply({ content: "❌ Massimo 10 parole!", ephemeral: true });

            const { econDb } = require('./economySystem');
            const hasItem = await econDb.hasItem(interaction.user.id, 'lettera', 1);
            if (!hasItem) return interaction.reply({ content: '❌ Non hai questo oggetto!', ephemeral: true });
            
            await econDb.removeItem(interaction.user.id, 'lettera', 1);

            const details = { 
                subType: 'lettera', 
                itemName: 'Lettera', 
                targetUserId: session.letteraTarget, 
                content: content
            };
            await savePreset(interaction, session, 'SHOP', 'SHOP', details, session.userName, "✅ Lettera salvata in preset.");
        }

                // CATENE: SAVE (Gestione Preset)
        if (interaction.customId === 'preset_item_target') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            
            const targetUserId = interaction.values[0];
            
            // 🔥 MODIFICA: Controllo se il target è nella lista "morti"
            const markedForDeath = await db.moderation.getMarkedForDeath();
            const isTargetDead = markedForDeath.some(m => m.userId === targetUserId);

            if (isTargetDead) {
                // ⛔ BLOCCO: Errore generico, NON rimuoviamo l'item, NON salviamo il preset
                return interaction.update({ 
                    content: "❌ Non è stato possibile programmare l'azione su questo giocatore.", 
                    components: [] 
                });
            }

            const { econDb } = require('./economySystem');
            
            // Controllo possesso oggetto
            const hasItem = await econDb.hasItem(interaction.user.id, session.shopItemId, 1);
            if (!hasItem) return interaction.update({ content: '❌ Non hai questo oggetto!', components: [] });
            
            // ✅ Se il giocatore è valido, RIMUOVIAMO l'oggetto e SALVIAMO il preset
            await econDb.removeItem(interaction.user.id, session.shopItemId, 1);

            const details = { subType: session.shopItemId, itemName: 'Catene', targetUserId };
            await savePreset(interaction, session, 'SHOP', 'SHOP', details, session.userName, "✅ Catene salvate in preset.");
        }


        // ABILITY: SAVE
        if (interaction.customId.startsWith('preset_modal_')) {
            const category = interaction.customId.split('_')[2];
            const target = interaction.fields.getTextInputValue('target');
            const desc = interaction.fields.getTextInputValue('description');
            await savePreset(interaction, session, 'ABILITY', category, { target, text: desc }, session.userName);
        }

                // REMOVE PRESET (LIST) - 🔥 MODIFICATO: Rimozione semplice (senza rimborsi)
        if (interaction.customId === 'preset_list_select') {
            const [type, id] = interaction.values[0].split('_');
            
            // Rimuovi il preset dal database
            if (type === 'night') await presetDb.removeNightPreset(id);
            else if (type === 'day') await presetDb.removeDayPreset(id);
            else await presetDb.removeScheduledPreset(id);
            
            await interaction.update({ content: '✅ Preset rimosso!', components: [] });
        }
        
    }); // End of client.on('interactionCreate')
} // End of registerPresetInteractions
// ==========================================
// ==========================================
// 💾 SAVE PRESET
// ==========================================
async function savePreset(interaction, session, type, category, details, userName, customMsg) {
    // 🔥 RIMOSSO: La logica su visitPhaseScaled non serve più
    
    if (session.presetType === 'night') {
        await presetDb.addNightPreset(interaction.user.id, userName, type, category, details);
    } else if (session.presetType === 'day') {
        await presetDb.addDayPreset(interaction.user.id, userName, type, category, details);
    } else {
        await presetDb.addScheduledPreset(interaction.user.id, userName, type, category, details, session.triggerTime);
    }
    activePresetSessions.delete(interaction.user.id);
    const msg = customMsg || `✅ **Preset Salvato!** (${category})`;
    if (interaction.isModalSubmit()) await interaction.reply({ content: msg, ephemeral: true });
    else await interaction.update({ content: msg, components: [] });
}

// ==========================================
// 🚀 RESOLVE PHASES (Transfer to Queue)
// ==========================================
async function resolveNightPhase() {
    console.log('🌙 [Preset] Risoluzione NOTTURNA...');
    const presets = await presetDb.getAllNightPresets();
    await processAndClearPresets(presets, 'Night');
}

async function resolveDayPhase() {
    console.log('☀️ [Preset] Risoluzione DIURNA...');
    const presets = await presetDb.getAllDayPresets();
    await processAndClearPresets(presets, 'Day');
}

async function resolveScheduledPhase(triggerTime) {
    console.log(`⏰ [Preset] Risoluzione TIMER (${triggerTime})...`);
    const presets = await presetDb.getScheduledPresetsAtTime(triggerTime);
    if (presets.length > 0) {
        await processAndClearPresets(presets, triggerTime);
        await presetDb.clearScheduledPresets(triggerTime);
    }
}


// ==========================================
// 📋 LISTA UTENTE
// ==========================================
async function showUserPresets(message) {
    const userId = message.author.id;
    const n = await presetDb.getUserNightPresets(userId);
    const d = await presetDb.getUserDayPresets(userId);
    const s = await presetDb.getUserScheduledPresets(userId);

    if (n.length === 0 && d.length === 0 && s.length === 0) return message.reply('📋 Nessun preset.');

    const options = [];
    n.forEach(p => options.push({ label: `🌙 ${p.category}`, value: `night_${p._id}`, desc: 'Notturno' }));
    d.forEach(p => options.push({ label: `☀️ ${p.category}`, value: `day_${p._id}`, desc: 'Diurno' }));
    s.forEach(p => options.push({ label: `⏰ ${p.triggerTime} ${p.category}`, value: `scheduled_${p._id}`, desc: 'Timer' }));

    const select = new StringSelectMenuBuilder()
        .setCustomId('preset_list_select')
        .setPlaceholder('Rimuovi...')
        .addOptions(options.slice(0, 25).map(o => 
            new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value).setDescription(o.desc)
        ));

    await message.reply({ content: '📋 **I tuoi preset:**', components: [new ActionRowBuilder().addComponents(select)] });
}

// 🔥 MODIFICATO: Le visite vengono scalate all'esecuzione del preset (qui)
async function processAndClearPresets(presets, contextLabel) {
    if (presets.length === 0) return;

    // --- FIX: itemId -> subType ---
    // Nel DB salvi come 'subType', quindi devi filtrare per 'subType'
    const fuochiPresets = presets.filter(p => p.type === 'SHOP' && p.details.subType === 'fuochi');
    const otherPresets = presets.filter(p => !(p.type === 'SHOP' && p.details.subType === 'fuochi'));
    // ------------------------------

    // Ordina per priorità solo gli altri preset
    const sorted = otherPresets.sort((a, b) => {
        const pA = PRIORITY_ORDER[a.category] || 999;
        const pB = PRIORITY_ORDER[b.category] || 999;
        if (pA !== pB) return pA - pB;
        return new Date(a.timestamp) - new Date(b.timestamp);
    });

    let delayCounter = 0;
    let processedCount = 0;

    // Processo prima tutti gli altri preset
    for (const preset of sorted) {
             // 🔥 FIX: Scaliamo la visita ORA.
        // Dato che non la scaliamo più alla creazione, dobbiamo farlo qui, 
        // altrimenti la visita risulta "gratis" e il conteggio resta sempre 0/2.
        if (preset.type === 'KNOCK') {
            const mode = preset.details.mode;
            if (mode === 'mode_forced') await db.housing.decrementForced(preset.userId);
            else if (mode === 'mode_hidden') await db.housing.decrementHidden(preset.userId);
            else await db.housing.incrementVisit(preset.userId);
        }

        const queueItem = {
            type: preset.type,
            userId: preset.userId,
            // Passiamo i dettagli così come sono. 
            // NOTA: fromChannelId non c'è, ma ora queueSystem lo calcola da solo!
            details: preset.type === 'ABILITY' ? { 
                text: `[${CATEGORIES.find(c=>c.value===preset.category)?.label}] ${preset.details.text}` + (preset.details.target ? ` (Target: ${preset.details.target})` : ''),
                category: preset.category 
            } : preset.details
        };

        setTimeout(() => {
            eventBus.emit('queue:add', queueItem);
        }, delayCounter * 200); 
        
        delayCounter++;
        processedCount++;
    }

    // FIX: Delay fuochi d'artificio
    const fuochiDelay = (delayCounter * 200) + 3000; // 3 secondi dopo l'ultimo preset
    
    for (const preset of fuochiPresets) {
        const queueItem = {
            type: preset.type,
            userId: preset.userId,
            details: preset.details
        };

        setTimeout(() => {
            eventBus.emit('queue:add', queueItem);
        }, fuochiDelay);
        
        processedCount++;
    }

    if (contextLabel === 'Night') await presetDb.clearAllNightPresets();
    else if (contextLabel === 'Day') await presetDb.clearAllDayPresets();

    console.log(`✅ [Preset] ${processedCount} preset aggiunti alla coda per ${contextLabel}`);
}

// ==========================================
// 🎯 HELPERS & EXPORT
// ==========================================

// FIX: Helper per ottenere case ordinate per NUMERO (consistente con knockInteractions)
async function getAvailableHousesSorted(guild, userId) {
    const myHomeId = await db.housing.getHome(userId);
    const destroyed = await db.housing.getDestroyedHouses();
    
    // Filtra e ordina per NUMERO estratto dal nome
    const houses = guild.channels.cache
        .filter(ch => 
            ch.parentId === HOUSING.CATEGORIA_CASE && 
            ch.type === ChannelType.GuildText && 
            ch.id !== myHomeId && 
            !destroyed.includes(ch.id) &&
            !ch.permissionOverwrites.cache.get(userId)?.deny.has(PermissionsBitField.Flags.ViewChannel)
        );
    
    return Array.from(houses.values())
        .map(ch => {
            const match = ch.name.match(/(\w+)-(\d+)/); // Supporta: casa-10, taverna-5, villa-3, etc.
            const number = match ? parseInt(match[2]) : 999999;
            return { ch, number };
        })
        .sort((a, b) => a.number - b.number)
        .map(({ ch }) => ({ id: ch.id, name: ch.name }));
}

// FIX: Builder per la selezione pagina basata su NUMERI (consistente con knockInteractions)
async function buildPageSelect(guild, userId) {
    const houses = await getAvailableHousesSorted(guild, userId);
    
    if (houses.length === 0) return { content: '❌ Nessuna casa disponibile.', components: [] };
    
    const PAGE_SIZE = 25;
    
    // Estraggo i numeri reali delle case
    const houseNumbers = houses.map(h => {
        const match = h.name.match(/(\w+)-(\d+)/); // Supporta: casa-10, taverna-5, villa-3, etc.
        return match ? parseInt(match[2]) : 0;
    }).filter(n => n > 0);
    
    if (houseNumbers.length === 0) return { content: '❌ Nessuna casa disponibile.', components: [] };
    
    const maxHouse = Math.max(...houseNumbers);
    const totalPages = Math.ceil(maxHouse / PAGE_SIZE);
    const pageOptions = [];

    for (let i = 0; i < totalPages; i++) {
        const start = i * PAGE_SIZE + 1;
        const end = Math.min((i + 1) * PAGE_SIZE, maxHouse);
        pageOptions.push(new StringSelectMenuOptionBuilder()
            .setLabel(`Case ${start} - ${end}`)
            .setValue(`page_${i}`)
            .setEmoji('🏘️')
        );
    }

    const select = new StringSelectMenuBuilder().setCustomId('preset_page_select').addOptions(pageOptions);
    
    return {
        content: `🏘️ **Step 3: Seleziona zona case:**`,
        components: [new ActionRowBuilder().addComponents(select)]
    };
}

async function getAlivePlayers(guild, excludeId) {
    const aliveRole = guild.roles.cache.get(RUOLI.ALIVE);
    if (!aliveRole) return [];
    
    // MODIFICA: Mostra TUTTI i giocatori con ruolo ALIVE (rimosso filtro morti)
    return aliveRole.members.filter(m => m.id !== excludeId && !m.user.bot)
        .map(m => ({ id: m.id, name: m.displayName }));
}

function startPresetTimer() {
    setInterval(async () => {
        const time = new Date().toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
        await resolveScheduledPhase(time);
    }, 60000);
}

module.exports = {
    registerPresetInteractions,
    handlePresetCommand,
    resolveNightPhase,
    resolveDayPhase,
    resolveScheduledPhase,
    showUserPresets,
    showAdminDashboard,
    startPresetTimer,
    db: presetDb
};
