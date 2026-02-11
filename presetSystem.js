// ==========================================
// ⏰ PRESET SYSTEM - Azioni Programmate
// Accumula azioni per fase notturna o timer
// ==========================================
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, PermissionsBitField
} = require('discord.js');
const { HOUSING, RUOLI, RUOLI_PERMESSI } = require('./config');
const db = require('./db');
const eventBus = require('./eventBus');
const { formatName } = require('./helpers');

// ==========================================
// 📊 PRIORITY ORDER (dal più basso al più alto)
// ==========================================
const PRIORITY_ORDER = {
    'SHOP': 1,           // Oggetti shop
    'ROLEBLOCK': 2,      // Roleblock
    'MANIPOLAZIONE': 3,  // Manipolazione
    'VISITBLOCK': 4,     // Visitblock
    'CURA': 5,           // Cura
    'ALTRO': 6,          // Altro
    'TRASPORTO': 7,      // Trasporto
    'POTENZIAMENTO': 8,  // Potenziamento
    'PROTEZIONE': 9,     // Protezione
    'COMUNICAZIONE': 10, // Comunicazione
    'LETALE': 11,        // Letale
    'INFORMAZIONE': 12,  // Informazione
    'KNOCK': 13,         // Bussa (massima priorità)
};

// ==========================================
// 📋 CATEGORIE DISPONIBILI
// ==========================================
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
    // --- PRESETS_NIGHT ---
    async addNightPreset(userId, userName, type, category, details) {
        const preset = {
            userId,
            userName,
            type,
            category,
            details,
            timestamp: new Date(),
        };
        const { PresetNightModel } = require('./database');
        return PresetNightModel.create(preset);
    },

    async getAllNightPresets() {
        const { PresetNightModel } = require('./database');
        return PresetNightModel.find({}).sort({ timestamp: 1 }).lean();
    },

    async getUserNightPresets(userId) {
        const { PresetNightModel } = require('./database');
        return PresetNightModel.find({ userId }).sort({ timestamp: 1 }).lean();
    },

    async removeNightPreset(presetId) {
        const { PresetNightModel } = require('./database');
        return PresetNightModel.findByIdAndDelete(presetId);
    },

    async clearAllNightPresets() {
        const { PresetNightModel } = require('./database');
        return PresetNightModel.deleteMany({});
    },

    // --- PRESETS_SCHEDULED ---
    async addScheduledPreset(userId, userName, type, category, details, triggerTime) {
        const preset = {
            userId,
            userName,
            type,
            category,
            details,
            timestamp: new Date(),
            triggerTime,
        };
        const { PresetScheduledModel } = require('./database');
        return PresetScheduledModel.create(preset);
    },

    async getAllScheduledPresets() {
        const { PresetScheduledModel } = require('./database');
        return PresetScheduledModel.find({}).sort({ triggerTime: 1 }).lean();
    },

    async getUserScheduledPresets(userId) {
        const { PresetScheduledModel } = require('./database');
        return PresetScheduledModel.find({ userId }).sort({ triggerTime: 1 }).lean();
    },

    async removeScheduledPreset(presetId) {
        const { PresetScheduledModel } = require('./database');
        return PresetScheduledModel.findByIdAndDelete(presetId);
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
// 📊 DASHBOARD PRESET (Real-time Admin View)
// ==========================================
let dashboardChannelId = null;
let clientRef = null;

async function updatePresetDashboard() {
    if (!dashboardChannelId || !clientRef) return;
    
    const channel = clientRef.channels.cache.get(dashboardChannelId);
    if (!channel) return;

    const nightPresets = await presetDb.getAllNightPresets();
    const scheduledPresets = await presetDb.getAllScheduledPresets();

    // Raggruppa per categoria
    const grouped = {};
    
    for (const preset of nightPresets) {
        const cat = preset.category || 'ALTRO';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({ ...preset, presetType: 'NIGHT' });
    }

    for (const preset of scheduledPresets) {
        const cat = preset.category || 'ALTRO';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({ ...preset, presetType: 'SCHEDULED' });
    }

    // Ordina categorie per priorità
    const sortedCategories = Object.keys(grouped).sort((a, b) => {
        return (PRIORITY_ORDER[a] || 999) - (PRIORITY_ORDER[b] || 999);
    });

    let description = '';

    if (sortedCategories.length === 0) {
        description = '✅ **Nessun preset in attesa.**';
    } else {
        for (const cat of sortedCategories) {
            const icon = getCategoryIcon(cat);
            const catLabel = getCategoryLabel(cat);
            description += `\n**${icon} ${catLabel}**\n`;
            
            for (const preset of grouped[cat]) {
                const typeEmoji = preset.presetType === 'NIGHT' ? '🌙' : '⏰';
                const userName = preset.userName || 'Sconosciuto';
                
                let targetInfo = '';
                if (preset.type === 'KNOCK') {
                    targetInfo = ` → <#${preset.details.targetChannelId}>`;
                } else if (preset.type === 'SHOP') {
                    targetInfo = ` | ${preset.details.itemName || 'Oggetto'}`;
                    if (preset.details.targetUserId) {
                        targetInfo += ` → <@${preset.details.targetUserId}>`;
                    }
                } else if (preset.type === 'ABILITY') {
                    targetInfo = preset.details.target ? ` | Target: ${preset.details.target}` : '';
                }

                const triggerInfo = preset.presetType === 'SCHEDULED' 
                    ? ` (${preset.triggerTime})`
                    : '';

                description += `${typeEmoji} **${userName}**${targetInfo}${triggerInfo}\n`;
            }
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('⏰ Dashboard Preset - Azioni Programmate')
        .setColor(nightPresets.length + scheduledPresets.length > 0 ? 'Orange' : 'Green')
        .setDescription(description)
        .setFooter({ text: 'Aggiornamento automatico in tempo reale' })
        .setTimestamp();

    // Pulisci vecchi messaggi
    try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMsgs = messages.filter(m => m.author.id === clientRef.user.id);
        if (botMsgs.size > 0) await channel.bulkDelete(botMsgs).catch(() => {});
    } catch {}

    await channel.send({ embeds: [embed] });
}

function getCategoryIcon(category) {
    const cat = CATEGORIES.find(c => c.value === category);
    return cat ? cat.emoji : '❓';
}

function getCategoryLabel(category) {
    const cat = CATEGORIES.find(c => c.value === category);
    return cat ? cat.label : category;
}

// ==========================================
// 🎮 GESTIONE GIOCATORE - UI A STEP
// ==========================================
async function handlePresetCommand(message, args, presetType) {
    const userId = message.author.id;
    const userName = message.member?.displayName || message.author.username;

    // Estrai triggerTime dal messaggio se è scheduled
    let triggerTime = null;
    if (presetType === 'scheduled') {
        const match = message.content.match(/\(trigger: (\d{2}:\d{2})\)/);
        if (match) {
            triggerTime = match[1];
        } else {
            return message.reply('⏰ **Errore interno nel recupero orario.**');
        }
    }

    // Step 1: Scelta Categoria
    const categorySelect = new StringSelectMenuBuilder()
        .setCustomId(`preset_category_${presetType}${triggerTime ? '_' + triggerTime : ''}`)
        .setPlaceholder('Scegli la categoria dell\'azione...')
        .addOptions(CATEGORIES.map(cat => 
            new StringSelectMenuOptionBuilder()
                .setLabel(cat.label)
                .setValue(cat.value)
                .setEmoji(cat.emoji)
        ));

    const row = new ActionRowBuilder().addComponents(categorySelect);
    const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('preset_close')
            .setLabel('Annulla')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
    );

    const typeLabel = presetType === 'night' ? 'notturno' : `programmato (${triggerTime})`;
    await message.reply({
        content: `⏰ **Creazione preset ${typeLabel}**\nStep 1: Seleziona la categoria dell'azione:`,
        components: [row, closeRow]
    });
}

// ==========================================
// 🔧 INTERACTION HANDLERS
// ==========================================
function registerPresetInteractions(client) {
    clientRef = client;

    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu() && !interaction.isButton() && !interaction.isModalSubmit()) return;

        // ===================== CHIUDI PRESET =====================
        if (interaction.customId === 'preset_close') {
            await interaction.update({ content: '❌ Operazione annullata.', components: [] });
            setTimeout(() => interaction.message.delete().catch(() => {}), 2000);
            return;
        }

        // ===================== SELEZIONE CATEGORIA =====================
        if (interaction.customId.startsWith('preset_category_')) {
            const parts = interaction.customId.split('_');
            const presetType = parts[2];
            const triggerTime = parts[3] || null;
            const category = interaction.values[0];

            // CASO 1: BUSSA → Mostra select modalità e case
            if (category === 'KNOCK') {
                const houses = await getAvailableHouses(interaction.guild, interaction.user.id);
                
                if (houses.length === 0) {
                    return interaction.update({
                        content: '❌ Nessuna casa disponibile per bussare.',
                        components: []
                    });
                }

                // Mostra select modalità visita
                const modeSelect = new StringSelectMenuBuilder()
                    .setCustomId(`preset_knock_mode_${presetType}${triggerTime ? '_' + triggerTime : ''}`)
                    .setPlaceholder('Scegli la modalità di visita...')
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel('Visita Normale').setValue('mode_normal').setEmoji('👋'),
                        new StringSelectMenuOptionBuilder().setLabel('Visita Forzata').setValue('mode_forced').setEmoji('🧨'),
                        new StringSelectMenuOptionBuilder().setLabel('Visita Nascosta').setValue('mode_hidden').setEmoji('🕵️')
                    );

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`preset_back_category_${presetType}${triggerTime ? '_' + triggerTime : ''}`)
                        .setLabel('Indietro')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('◀️')
                );

                await interaction.update({
                    content: '🎭 **Step 2: Scegli la modalità di visita:**',
                    components: [new ActionRowBuilder().addComponents(modeSelect), backRow]
                });
            }
            // CASO 2: SHOP → Mostra select inventario
            else if (category === 'SHOP') {
                const items = await getUserShopItems(interaction.user.id);

                if (items.length === 0) {
                    return interaction.update({
                        content: '❌ Non hai oggetti nel tuo inventario.',
                        components: []
                    });
                }

                // Filtra scopa dall'inventario
                const filteredItems = items.filter(item => item.id !== 'scopa');

                if (filteredItems.length === 0) {
                    return interaction.update({
                        content: '❌ Non hai oggetti utilizzabili nel preset (la scopa non può essere usata nei preset).',
                        components: []
                    });
                }

                const itemSelect = new StringSelectMenuBuilder()
                    .setCustomId(`preset_shop_item_${presetType}${triggerTime ? '_' + triggerTime : ''}`)
                    .setPlaceholder('Scegli l\'oggetto da usare...')
                    .addOptions(filteredItems.map(item => 
                        new StringSelectMenuOptionBuilder()
                            .setLabel(`${item.name} (${item.quantity}x)`)
                            .setValue(item.id)
                            .setEmoji(item.emoji)
                    ));

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`preset_back_category_${presetType}${triggerTime ? '_' + triggerTime : ''}`)
                        .setLabel('Indietro')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('◀️')
                );

                await interaction.update({
                    content: '🛒 **Step 2: Scegli l\'oggetto da usare:**',
                    components: [new ActionRowBuilder().addComponents(itemSelect), backRow]
                });
            }
            // CASO 3: Altre categorie → Mostra modale
            else {
                const modal = new ModalBuilder()
                    .setCustomId(`preset_modal_${category}_${presetType}${triggerTime ? '_' + triggerTime : ''}`)
                    .setTitle(`Preset ${getCategoryLabel(category)}`);

                const targetInput = new TextInputBuilder()
                    .setCustomId('target')
                    .setLabel('Target (opzionale)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('Nome giocatore o target specifico...');

                const descInput = new TextInputBuilder()
                    .setCustomId('description')
                    .setLabel('Descrizione abilità')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setPlaceholder('Descrivi dettagliatamente la tua azione...');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(targetInput),
                    new ActionRowBuilder().addComponents(descInput)
                );

                await interaction.showModal(modal);
            }
        }

        // ===================== TORNA INDIETRO CATEGORIA =====================
        if (interaction.customId.startsWith('preset_back_category_')) {
            const parts = interaction.customId.split('_');
            const presetType = parts[3];
            const triggerTime = parts[4] || null;
            
            const categorySelect = new StringSelectMenuBuilder()
                .setCustomId(`preset_category_${presetType}${triggerTime ? '_' + triggerTime : ''}`)
                .setPlaceholder('Scegli la categoria dell\'azione...')
                .addOptions(CATEGORIES.map(cat => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(cat.label)
                        .setValue(cat.value)
                        .setEmoji(cat.emoji)
                ));

            const row = new ActionRowBuilder().addComponents(categorySelect);
            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('preset_close')
                    .setLabel('Annulla')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌')
            );

            await interaction.update({
                content: '⏰ **Step 1: Seleziona la categoria dell\'azione:**',
                components: [row, closeRow]
            });
        }

        // ===================== SELEZIONE MODALITÀ KNOCK =====================
        if (interaction.customId.startsWith('preset_knock_mode_')) {
            const parts = interaction.customId.split('_');
            const presetType = parts[3];
            const triggerTime = parts[4] || null;
            const mode = interaction.values[0];

            const houses = await getAvailableHouses(interaction.guild, interaction.user.id);

            if (houses.length === 0) {
                return interaction.update({
                    content: '❌ Nessuna casa disponibile per bussare.',
                    components: []
                });
            }

            const houseSelect = new StringSelectMenuBuilder()
                .setCustomId(`preset_house_${presetType}_${mode}${triggerTime ? '_' + triggerTime : ''}`)
                .setPlaceholder('Scegli la casa dove bussare...')
                .addOptions(houses.slice(0, 25).map(house => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(formatName(house.name))
                        .setValue(house.id)
                        .setEmoji('🏠')
                ));

            const backRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`preset_back_knock_mode_${presetType}${triggerTime ? '_' + triggerTime : ''}`)
                    .setLabel('Indietro')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('◀️')
            );

            await interaction.update({
                content: '🏘️ **Step 3: Scegli la casa dove vuoi bussare:**',
                components: [new ActionRowBuilder().addComponents(houseSelect), backRow]
            });
        }

        // ===================== TORNA INDIETRO A MODALITÀ KNOCK =====================
        if (interaction.customId.startsWith('preset_back_knock_mode_')) {
            const parts = interaction.customId.split('_');
            const presetType = parts[4];
            const triggerTime = parts[5] || null;

            const modeSelect = new StringSelectMenuBuilder()
                .setCustomId(`preset_knock_mode_${presetType}${triggerTime ? '_' + triggerTime : ''}`)
                .setPlaceholder('Scegli la modalità di visita...')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Visita Normale').setValue('mode_normal').setEmoji('👋'),
                    new StringSelectMenuOptionBuilder().setLabel('Visita Forzata').setValue('mode_forced').setEmoji('🧨'),
                    new StringSelectMenuOptionBuilder().setLabel('Visita Nascosta').setValue('mode_hidden').setEmoji('🕵️')
                );

            const backRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`preset_back_category_${presetType}${triggerTime ? '_' + triggerTime : ''}`)
                    .setLabel('Indietro')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('◀️')
            );

            await interaction.update({
                content: '🎭 **Step 2: Scegli la modalità di visita:**',
                components: [new ActionRowBuilder().addComponents(modeSelect), backRow]
            });
        }

        // ===================== SELEZIONE CASA (BUSSA) =====================
        if (interaction.customId.startsWith('preset_house_')) {
            const parts = interaction.customId.split('_');
            const presetType = parts[2];
            const mode = parts[3];
            const triggerTime = parts[4] || null;
            const targetChannelId = interaction.values[0];
            const userId = interaction.user.id;
            const userName = interaction.member?.displayName || interaction.user.username;

            // NON consumare visite qui! Le visite vengono consumate quando il preset viene eseguito
            const details = {
                targetChannelId,
                mode,
                fromChannelId: interaction.channel.id
            };

            if (presetType === 'night') {
                await presetDb.addNightPreset(userId, userName, 'KNOCK', 'KNOCK', details);
                await interaction.update({
                    content: `✅ **Preset notturno salvato!** Bussata programmata per la fase notturna.\n*Le visite verranno consumate all'esecuzione del preset.*`,
                    components: []
                });
            } else {
                await presetDb.addScheduledPreset(userId, userName, 'KNOCK', 'KNOCK', details, triggerTime);
                await interaction.update({
                    content: `✅ **Preset programmato salvato!** Bussata eseguita alle ${triggerTime}.\n*Le visite verranno consumate all'esecuzione del preset.*`,
                    components: []
                });
            }

            setTimeout(() => interaction.message.delete().catch(() => {}), 5000);
            await updatePresetDashboard();
        }

        // ===================== SELEZIONE SHOP ITEM =====================
        if (interaction.customId.startsWith('preset_shop_item_')) {
            const parts = interaction.customId.split('_');
            const presetType = parts[3];
            const triggerTime = parts[4] || null;
            const itemId = interaction.values[0];

            // Verifica se l'oggetto richiede target
            const itemsRequiringTarget = ['catene'];
            
            if (itemsRequiringTarget.includes(itemId)) {
                const guild = interaction.guild;
                const aliveRole = guild.roles.cache.get(RUOLI.ALIVE);
                
                if (!aliveRole) {
                    return interaction.update({
                        content: '❌ Ruolo giocatori non trovato.',
                        components: []
                    });
                }

                const aliveMembers = aliveRole.members
                    .filter(m => m.id !== interaction.user.id && !m.user.bot)
                    .map(m => ({
                        id: m.id,
                        name: m.displayName || m.user.username
                    }));

                if (aliveMembers.length === 0) {
                    return interaction.update({
                        content: '❌ Nessun giocatore disponibile come target.',
                        components: []
                    });
                }

                const playerSelect = new StringSelectMenuBuilder()
                    .setCustomId(`preset_item_target_${itemId}_${presetType}${triggerTime ? '_' + triggerTime : ''}`)
                    .setPlaceholder(`Scegli il target per ${itemId}...`)
                    .addOptions(aliveMembers.slice(0, 25).map(player => 
                        new StringSelectMenuOptionBuilder()
                            .setLabel(player.name)
                            .setValue(player.id)
                            .setEmoji('👤')
                    ));

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`preset_back_category_${presetType}${triggerTime ? '_' + triggerTime : ''}`)
                        .setLabel('Indietro')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('◀️')
                );

                await interaction.update({
                    content: `⛓️ **Step 3: Scegli il target per ${itemId}:**`,
                    components: [new ActionRowBuilder().addComponents(playerSelect), backRow]
                });
            } else {
                // Oggetti che non richiedono target
                const userId = interaction.user.id;
                const userName = interaction.member?.displayName || interaction.user.username;
                const { SHOP_ITEMS } = require('./economySystem');
                const item = SHOP_ITEMS.find(i => i.id === itemId);

                // Verifica e rimuovi oggetto dall'inventario
                const econDb = require('./economySystem').econDb;
                const hasItem = await econDb.hasItem(userId, itemId, 1);
                
                if (!hasItem) {
                    return interaction.update({
                        content: '❌ Non possiedi questo oggetto nell\'inventario.',
                        components: []
                    });
                }

                await econDb.removeItem(userId, itemId, 1);

                const details = {
                    subType: itemId,
                    itemName: item?.name || itemId,
                    responseChannelId: interaction.channel.id
                };

                if (presetType === 'night') {
                    await presetDb.addNightPreset(userId, userName, 'SHOP', 'SHOP', details);
                    await interaction.update({
                        content: `✅ **Preset notturno salvato!** Oggetto "${item?.name}" programmato per la fase notturna e rimosso dall'inventario.`,
                        components: []
                    });
                } else {
                    await presetDb.addScheduledPreset(userId, userName, 'SHOP', 'SHOP', details, triggerTime);
                    await interaction.update({
                        content: `✅ **Preset programmato salvato!** Oggetto "${item?.name}" eseguito alle ${triggerTime} e rimosso dall'inventario.`,
                        components: []
                    });
                }

                setTimeout(() => interaction.message.delete().catch(() => {}), 5000);
                await updatePresetDashboard();
            }
        }

        // ===================== SELEZIONE TARGET ITEM =====================
        if (interaction.customId.startsWith('preset_item_target_')) {
            const parts = interaction.customId.split('_');
            const itemId = parts[3];
            const presetType = parts[4];
            const triggerTime = parts[5] || null;
            const targetUserId = interaction.values[0];
            const userId = interaction.user.id;
            const userName = interaction.member?.displayName || interaction.user.username;
            const { SHOP_ITEMS } = require('./economySystem');
            const item = SHOP_ITEMS.find(i => i.id === itemId);

            // Verifica e rimuovi oggetto dall'inventario
            const econDb = require('./economySystem').econDb;
            const hasItem = await econDb.hasItem(userId, itemId, 1);
            
            if (!hasItem) {
                return interaction.update({
                    content: '❌ Non possiedi questo oggetto nell\'inventario.',
                    components: []
                });
            }

            await econDb.removeItem(userId, itemId, 1);

            const details = {
                subType: itemId,
                itemName: item?.name || itemId,
                targetUserId,
                responseChannelId: interaction.channel.id
            };

            if (presetType === 'night') {
                await presetDb.addNightPreset(userId, userName, 'SHOP', 'SHOP', details);
                await interaction.update({
                    content: `✅ **Preset notturno salvato!** ${item?.name} su <@${targetUserId}> programmato per la fase notturna e rimosso dall'inventario.`,
                    components: []
                });
            } else {
                await presetDb.addScheduledPreset(userId, userName, 'SHOP', 'SHOP', details, triggerTime);
                await interaction.update({
                    content: `✅ **Preset programmato salvato!** ${item?.name} su <@${targetUserId}> eseguito alle ${triggerTime} e rimosso dall'inventario.`,
                    components: []
                });
            }

            setTimeout(() => interaction.message.delete().catch(() => {}), 5000);
            await updatePresetDashboard();
        }

        // ===================== SUBMIT MODALE (Altre categorie) =====================
        if (interaction.customId.startsWith('preset_modal_')) {
            const parts = interaction.customId.split('_');
            const category = parts[2];
            const presetType = parts[3];
            const triggerTime = parts[4] || null;

            const target = interaction.fields.getTextInputValue('target');
            const description = interaction.fields.getTextInputValue('description');

            const userId = interaction.user.id;
            const userName = interaction.member?.displayName || interaction.user.username;

            const details = {
                target: target || null,
                text: description
            };

            if (presetType === 'night') {
                await presetDb.addNightPreset(userId, userName, 'ABILITY', category, details);
                await interaction.reply({
                    content: `✅ **Preset notturno salvato!** Abilità categoria ${getCategoryLabel(category)} programmata per la fase notturna.`,
                    ephemeral: true
                });
            } else {
                await presetDb.addScheduledPreset(userId, userName, 'ABILITY', category, details, triggerTime);
                await interaction.reply({
                    content: `✅ **Preset programmato salvato!** Abilità categoria ${getCategoryLabel(category)} eseguita alle ${triggerTime}.`,
                    ephemeral: true
                });
            }

            await updatePresetDashboard();
        }

        // ===================== LISTA PRESET =====================
        if (interaction.customId === 'preset_list_select') {
            const presetId = interaction.values[0];
            const [type, id] = presetId.split('_');

            if (type === 'night') {
                await presetDb.removeNightPreset(id);
                await interaction.update({
                    content: '✅ Preset notturno rimosso!',
                    components: []
                });
            } else {
                await presetDb.removeScheduledPreset(id);
                await interaction.update({
                    content: '✅ Preset programmato rimosso!',
                    components: []
                });
            }

            setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
            await updatePresetDashboard();
        }
    });
}

// ==========================================
// 🎯 HELPER FUNCTIONS
// ==========================================
async function getAvailableHouses(guild, userId) {
    const myHomeId = await db.housing.getHome(userId);
    const destroyed = await db.housing.getDestroyedHouses();

    return guild.channels.cache
        .filter(ch => {
            if (ch.parentId !== HOUSING.CATEGORIA_CASE) return false;
            if (ch.type !== ChannelType.GuildText) return false;
            if (ch.id === myHomeId) return false;
            if (destroyed.includes(ch.id)) return false;
            
            const ow = ch.permissionOverwrites.cache.get(userId);
            if (!ow) return true;
            return !ow.allow.has(PermissionsBitField.Flags.ViewChannel);
        })
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map(ch => ({ id: ch.id, name: ch.name }));
}

async function getUserShopItems(userId) {
    const econDb = require('./economySystem').econDb;
    const { SHOP_ITEMS } = require('./economySystem');
    const inventory = await econDb.getInventory(userId);

    return SHOP_ITEMS
        .filter(item => inventory[item.id] && inventory[item.id] > 0)
        .map(item => ({
            id: item.id,
            name: item.name,
            emoji: item.emoji,
            quantity: inventory[item.id]
        }));
}

// ==========================================
// 🚀 LOGICA DI ESECUZIONE
// ==========================================
async function resolveNightPhase() {
    console.log('⏰ [Preset] Risoluzione fase notturna...');

    const nightPresets = await presetDb.getAllNightPresets();
    if (nightPresets.length === 0) {
        console.log('⏰ [Preset] Nessun preset notturno da eseguire.');
        return;
    }

    // Ordina: prima per priorità, poi per timestamp
    const sorted = nightPresets.sort((a, b) => {
        const priorityA = PRIORITY_ORDER[a.category] || 999;
        const priorityB = PRIORITY_ORDER[b.category] || 999;
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }
        
        return new Date(a.timestamp) - new Date(b.timestamp);
    });

    // Trasforma e inserisci in coda
    for (const preset of sorted) {
        const queueItem = mapPresetToQueue(preset);
        if (queueItem) {
            eventBus.emit('queue:add', queueItem);
            console.log(`⏰ [Preset] Aggiunto ${preset.type} (${preset.category}) di ${preset.userName} alla coda.`);
        }
    }

    // Svuota i preset notturni
    await presetDb.clearAllNightPresets();
    console.log('⏰ [Preset] Preset notturni svuotati.');
    
    await updatePresetDashboard();
}

async function resolveScheduledPhase(triggerTime) {
    console.log(`⏰ [Preset] Risoluzione preset programmati per ${triggerTime}...`);

    const scheduledPresets = await presetDb.getScheduledPresetsAtTime(triggerTime);
    if (scheduledPresets.length === 0) {
        console.log('⏰ [Preset] Nessun preset programmato da eseguire.');
        return;
    }

    // Ordina: prima per priorità, poi per timestamp
    const sorted = scheduledPresets.sort((a, b) => {
        const priorityA = PRIORITY_ORDER[a.category] || 999;
        const priorityB = PRIORITY_ORDER[b.category] || 999;
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }
        
        return new Date(a.timestamp) - new Date(b.timestamp);
    });

    // Trasforma e inserisci in coda
    for (const preset of sorted) {
        const queueItem = mapPresetToQueue(preset);
        if (queueItem) {
            eventBus.emit('queue:add', queueItem);
            console.log(`⏰ [Preset] Aggiunto ${preset.type} (${preset.category}) di ${preset.userName} alla coda.`);
        }
    }

    // Svuota i preset con quel trigger time
    await presetDb.clearScheduledPresets(triggerTime);
    console.log(`⏰ [Preset] Preset programmati per ${triggerTime} svuotati.`);
    
    await updatePresetDashboard();
}

function mapPresetToQueue(preset) {
    if (preset.type === 'KNOCK') {
        return {
            type: 'KNOCK',
            userId: preset.userId,
            details: preset.details
        };
    }
    
    if (preset.type === 'SHOP') {
        return {
            type: 'SHOP',
            userId: preset.userId,
            details: preset.details
        };
    }
    
    if (preset.type === 'ABILITY') {
        return {
            type: 'ABILITY',
            userId: preset.userId,
            details: {
                text: preset.details.text,
                target: preset.details.target,
                category: preset.category
            }
        };
    }

    return null;
}

// ==========================================
// 📋 LISTA PRESET UTENTE
// ==========================================
async function showUserPresets(message) {
    const userId = message.author.id;
    const nightPresets = await presetDb.getUserNightPresets(userId);
    const scheduledPresets = await presetDb.getUserScheduledPresets(userId);

    if (nightPresets.length === 0 && scheduledPresets.length === 0) {
        return message.reply('📋 Non hai preset attivi.');
    }

    const options = [];

    for (const preset of nightPresets) {
        const icon = getCategoryIcon(preset.category);
        const catLabel = getCategoryLabel(preset.category);
        let label = `${icon} ${catLabel} (Notturno)`;
        
        if (preset.type === 'KNOCK') {
            label += ` - Bussa`;
        } else if (preset.type === 'SHOP') {
            label += ` - ${preset.details.itemName}`;
        }

        options.push(
            new StringSelectMenuOptionBuilder()
                .setLabel(label.substring(0, 100))
                .setValue(`night_${preset._id}`)
                .setDescription(`Creato: ${new Date(preset.timestamp).toLocaleString('it-IT')}`.substring(0, 100))
        );
    }

    for (const preset of scheduledPresets) {
        const icon = getCategoryIcon(preset.category);
        const catLabel = getCategoryLabel(preset.category);
        let label = `${icon} ${catLabel} (${preset.triggerTime})`;
        
        if (preset.type === 'KNOCK') {
            label += ` - Bussa`;
        } else if (preset.type === 'SHOP') {
            label += ` - ${preset.details.itemName}`;
        }

        options.push(
            new StringSelectMenuOptionBuilder()
                .setLabel(label.substring(0, 100))
                .setValue(`scheduled_${preset._id}`)
                .setDescription(`Creato: ${new Date(preset.timestamp).toLocaleString('it-IT')}`.substring(0, 100))
        );
    }

    if (options.length === 0) {
        return message.reply('📋 Non hai preset attivi.');
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId('preset_list_select')
        .setPlaceholder('Seleziona un preset da rimuovere...')
        .addOptions(options.slice(0, 25));

    const row = new ActionRowBuilder().addComponents(select);

    await message.reply({
        content: '📋 **I tuoi preset attivi:**\nSeleziona un preset per rimuoverlo:',
        components: [row]
    });
}

// ==========================================
// ⏰ TIMER AUTOMATICO PRESET INTERMEDI
// ==========================================
function startPresetTimer() {
    // Controlla ogni minuto se ci sono preset da eseguire
    setInterval(async () => {
        const now = new Date();
        
        // Converti ora italiana (UTC+1 o UTC+2 in estate)
        const italianTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
        const hours = String(italianTime.getHours()).padStart(2, '0');
        const minutes = String(italianTime.getMinutes()).padStart(2, '0');
        const currentTime = `${hours}:${minutes}`;

        console.log(`⏰ [Preset Timer] Controllo preset per ${currentTime}...`);

        // Controlla se ci sono preset schedulati per questo orario
        const scheduledPresets = await presetDb.getScheduledPresetsAtTime(currentTime);
        
        if (scheduledPresets.length > 0) {
            console.log(`⏰ [Preset Timer] Trovati ${scheduledPresets.length} preset per ${currentTime}. Esecuzione...`);
            await resolveScheduledPhase(currentTime);
        }
    }, 60000); // Controlla ogni 60 secondi

    console.log('⏰ [Preset Timer] Sistema timer automatico avviato (controllo ogni minuto)');
}

// ==========================================
// 🚀 INIT & EXPORT
// ==========================================
module.exports = {
    registerPresetInteractions,
    handlePresetCommand,
    resolveNightPhase,
    resolveScheduledPhase,
    showUserPresets,
    updatePresetDashboard,
    setDashboardChannel: (channelId) => { dashboardChannelId = channelId; },
    startPresetTimer,
};
