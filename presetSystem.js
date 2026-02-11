// ==========================================
// ⏰ PRESET SYSTEM - Azioni Programmate
// VERSIONE SEMPLIFICATA E ROBUSTA
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
// 🗄️ STORAGE TEMPORANEO PRESET IN CORSO
// Tiene traccia dei preset mentre l'utente li sta creando
// ==========================================
const activePresetSessions = new Map(); // userId -> { presetType, triggerTime, ... }

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
// 📊 DASHBOARD PRESET
// ==========================================
let dashboardChannelId = null;
let clientRef = null;

async function updatePresetDashboard() {
    if (!dashboardChannelId || !clientRef) return;
    
    const channel = clientRef.channels.cache.get(dashboardChannelId);
    if (!channel) return;

    const nightPresets = await presetDb.getAllNightPresets();
    const scheduledPresets = await presetDb.getAllScheduledPresets();

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
// 🎮 GESTIONE COMANDO PRESET
// ==========================================
async function handlePresetCommand(message, args, presetType, triggerTime = null) {
    const userId = message.author.id;
    const userName = message.member?.displayName || message.author.username;

    // Crea sessione preset per questo utente
    activePresetSessions.set(userId, {
        presetType: presetType,
        triggerTime: triggerTime,
        channelId: message.channel.id
    });

    // Step 1: Scelta Categoria
    const categorySelect = new StringSelectMenuBuilder()
        .setCustomId('preset_category')
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

    const typeLabel = presetType === 'night' 
        ? 'notturno' 
        : `programmato (${triggerTime})`;
    
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

        const userId = interaction.user.id;
        const session = activePresetSessions.get(userId);

        // ===================== CHIUDI PRESET =====================
        if (interaction.customId === 'preset_close') {
            activePresetSessions.delete(userId);
            await interaction.update({ 
                content: '❌ Operazione annullata.', 
                components: [] 
            });
            setTimeout(() => interaction.message.delete().catch(() => {}), 2000);
            return;
        }

        // ===================== SELEZIONE CATEGORIA =====================
        if (interaction.customId === 'preset_category') {
            if (!session) {
                return interaction.reply({ 
                    content: '❌ Sessione scaduta. Ricomincia con !preset', 
                    ephemeral: true 
                });
            }

            const category = interaction.values[0];

            // CASO 1: BUSSA
            if (category === 'KNOCK') {
                const houses = await getAvailableHouses(interaction.guild, userId);
                
                if (houses.length === 0) {
                    activePresetSessions.delete(userId);
                    return interaction.update({
                        content: '❌ Nessuna casa disponibile per bussare.',
                        components: []
                    });
                }

                const modeSelect = new StringSelectMenuBuilder()
                    .setCustomId('preset_knock_mode')
                    .setPlaceholder('Scegli la modalità di visita...')
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel('Visita Normale').setValue('mode_normal').setEmoji('👋'),
                        new StringSelectMenuOptionBuilder().setLabel('Visita Forzata').setValue('mode_forced').setEmoji('🧨'),
                        new StringSelectMenuOptionBuilder().setLabel('Visita Nascosta').setValue('mode_hidden').setEmoji('🕵️')
                    );

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('preset_back_category')
                        .setLabel('Indietro')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('◀️')
                );

                await interaction.update({
                    content: '🎭 **Step 2: Scegli la modalità di visita:**',
                    components: [new ActionRowBuilder().addComponents(modeSelect), backRow]
                });
            }
            // CASO 2: SHOP
            else if (category === 'SHOP') {
                const items = await getUserShopItems(userId);

                if (items.length === 0) {
                    activePresetSessions.delete(userId);
                    return interaction.update({
                        content: '❌ Non hai oggetti nel tuo inventario.',
                        components: []
                    });
                }

                const filteredItems = items.filter(item => item.id !== 'scopa');

                if (filteredItems.length === 0) {
                    activePresetSessions.delete(userId);
                    return interaction.update({
                        content: '❌ Non hai oggetti utilizzabili nel preset (la scopa non può essere usata).',
                        components: []
                    });
                }

                const itemSelect = new StringSelectMenuBuilder()
                    .setCustomId('preset_shop_item')
                    .setPlaceholder('Scegli l\'oggetto da usare...')
                    .addOptions(filteredItems.map(item => 
                        new StringSelectMenuOptionBuilder()
                            .setLabel(`${item.name} (${item.quantity}x)`)
                            .setValue(item.id)
                            .setEmoji(item.emoji)
                    ));

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('preset_back_category')
                        .setLabel('Indietro')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('◀️')
                );

                await interaction.update({
                    content: '🛒 **Step 2: Scegli l\'oggetto da usare:**',
                    components: [new ActionRowBuilder().addComponents(itemSelect), backRow]
                });
            }
            // CASO 3: Altre categorie
            else {
                const modal = new ModalBuilder()
                    .setCustomId(`preset_modal_${category}`)
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
        if (interaction.customId === 'preset_back_category') {
            if (!session) {
                return interaction.reply({ 
                    content: '❌ Sessione scaduta. Ricomincia con !preset', 
                    ephemeral: true 
                });
            }

            const categorySelect = new StringSelectMenuBuilder()
                .setCustomId('preset_category')
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
        if (interaction.customId === 'preset_knock_mode') {
            if (!session) {
                return interaction.reply({ 
                    content: '❌ Sessione scaduta. Ricomincia con !preset', 
                    ephemeral: true 
                });
            }

            const mode = interaction.values[0];
            session.knockMode = mode; // Salva nella sessione

            const houses = await getAvailableHouses(interaction.guild, userId);

            if (houses.length === 0) {
                activePresetSessions.delete(userId);
                return interaction.update({
                    content: '❌ Nessuna casa disponibile.',
                    components: []
                });
            }

            const houseSelect = new StringSelectMenuBuilder()
                .setCustomId('preset_house')
                .setPlaceholder('Scegli la casa dove bussare...')
                .addOptions(houses.slice(0, 25).map(house => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(formatName(house.name))
                        .setValue(house.id)
                        .setEmoji('🏠')
                ));

            const backRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('preset_back_knock_mode')
                    .setLabel('Indietro')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('◀️')
            );

            await interaction.update({
                content: '🏘️ **Step 3: Scegli la casa dove vuoi bussare:**',
                components: [new ActionRowBuilder().addComponents(houseSelect), backRow]
            });
        }

        // ===================== TORNA A MODALITÀ KNOCK =====================
        if (interaction.customId === 'preset_back_knock_mode') {
            if (!session) {
                return interaction.reply({ 
                    content: '❌ Sessione scaduta. Ricomincia con !preset', 
                    ephemeral: true 
                });
            }

            const modeSelect = new StringSelectMenuBuilder()
                .setCustomId('preset_knock_mode')
                .setPlaceholder('Scegli la modalità di visita...')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Visita Normale').setValue('mode_normal').setEmoji('👋'),
                    new StringSelectMenuOptionBuilder().setLabel('Visita Forzata').setValue('mode_forced').setEmoji('🧨'),
                    new StringSelectMenuOptionBuilder().setLabel('Visita Nascosta').setValue('mode_hidden').setEmoji('🕵️')
                );

            const backRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('preset_back_category')
                    .setLabel('Indietro')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('◀️')
            );

            await interaction.update({
                content: '🎭 **Step 2: Scegli la modalità di visita:**',
                components: [new ActionRowBuilder().addComponents(modeSelect), backRow]
            });
        }

        // ===================== SELEZIONE CASA =====================
        if (interaction.customId === 'preset_house') {
            if (!session) {
                return interaction.reply({ 
                    content: '❌ Sessione scaduta. Ricomincia con !preset', 
                    ephemeral: true 
                });
            }

            const targetChannelId = interaction.values[0];
            const userName = interaction.member?.displayName || interaction.user.username;

            const details = {
                targetChannelId,
                mode: session.knockMode,
                fromChannelId: session.channelId
            };

            try {
                if (session.presetType === 'night') {
                    await presetDb.addNightPreset(userId, userName, 'KNOCK', 'KNOCK', details);
                    await interaction.update({
                        content: `✅ **Preset notturno salvato!**\nBussata programmata per la fase notturna.\n*Le visite verranno consumate all'esecuzione.*`,
                        components: []
                    });
                } else {
                    await presetDb.addScheduledPreset(userId, userName, 'KNOCK', 'KNOCK', details, session.triggerTime);
                    await interaction.update({
                        content: `✅ **Preset programmato salvato!**\nBussata eseguita alle ${session.triggerTime}.\n*Le visite verranno consumate all'esecuzione.*`,
                        components: []
                    });
                }

                activePresetSessions.delete(userId);
                await updatePresetDashboard();
                
                setTimeout(() => {
                    interaction.message.delete().catch(() => {});
                }, 5000);
            } catch (error) {
                console.error('Errore salvataggio preset KNOCK:', error);
                await interaction.followUp({
                    content: '❌ Errore nel salvataggio del preset.',
                    ephemeral: true
                });
            }
        }

        // ===================== SELEZIONE SHOP ITEM =====================
        if (interaction.customId === 'preset_shop_item') {
            if (!session) {
                return interaction.reply({ 
                    content: '❌ Sessione scaduta. Ricomincia con !preset', 
                    ephemeral: true 
                });
            }

            const itemId = interaction.values[0];

            // Oggetti che richiedono target
            if (itemId === 'catene') {
                const guild = interaction.guild;
                const aliveRole = guild.roles.cache.get(RUOLI.ALIVE);
                
                if (!aliveRole) {
                    activePresetSessions.delete(userId);
                    return interaction.update({
                        content: '❌ Ruolo giocatori non trovato.',
                        components: []
                    });
                }

                const aliveMembers = aliveRole.members
                    .filter(m => m.id !== userId && !m.user.bot)
                    .map(m => ({
                        id: m.id,
                        name: m.displayName || m.user.username
                    }));

                if (aliveMembers.length === 0) {
                    activePresetSessions.delete(userId);
                    return interaction.update({
                        content: '❌ Nessun giocatore disponibile come target.',
                        components: []
                    });
                }

                // Salva itemId nella sessione
                session.shopItemId = itemId;

                const playerSelect = new StringSelectMenuBuilder()
                    .setCustomId('preset_item_target')
                    .setPlaceholder(`Scegli il target per ${itemId}...`)
                    .addOptions(aliveMembers.slice(0, 25).map(player => 
                        new StringSelectMenuOptionBuilder()
                            .setLabel(player.name)
                            .setValue(player.id)
                            .setEmoji('👤')
                    ));

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('preset_back_category')
                        .setLabel('Indietro')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('◀️')
                );

                await interaction.update({
                    content: `⛓️ **Step 3: Scegli il target per ${itemId}:**`,
                    components: [new ActionRowBuilder().addComponents(playerSelect), backRow]
                });
            } else {
                // Oggetti senza target
                const userName = interaction.member?.displayName || interaction.user.username;
                const { SHOP_ITEMS } = require('./economySystem');
                const item = SHOP_ITEMS.find(i => i.id === itemId);

                const econDb = require('./economySystem').econDb;
                const hasItem = await econDb.hasItem(userId, itemId, 1);
                
                if (!hasItem) {
                    activePresetSessions.delete(userId);
                    return interaction.update({
                        content: '❌ Non possiedi questo oggetto nell\'inventario.',
                        components: []
                    });
                }

                try {
                    await econDb.removeItem(userId, itemId, 1);

                    const details = {
                        subType: itemId,
                        itemName: item?.name || itemId,
                        responseChannelId: session.channelId
                    };

                    if (session.presetType === 'night') {
                        await presetDb.addNightPreset(userId, userName, 'SHOP', 'SHOP', details);
                        await interaction.update({
                            content: `✅ **Preset notturno salvato!**\nOggetto "${item?.name}" programmato per la fase notturna.\nRimosso dall'inventario.`,
                            components: []
                        });
                    } else {
                        await presetDb.addScheduledPreset(userId, userName, 'SHOP', 'SHOP', details, session.triggerTime);
                        await interaction.update({
                            content: `✅ **Preset programmato salvato!**\nOggetto "${item?.name}" eseguito alle ${session.triggerTime}.\nRimosso dall'inventario.`,
                            components: []
                        });
                    }

                    activePresetSessions.delete(userId);
                    await updatePresetDashboard();
                    
                    setTimeout(() => {
                        interaction.message.delete().catch(() => {});
                    }, 5000);
                } catch (error) {
                    console.error('Errore salvataggio preset SHOP:', error);
                    await interaction.followUp({
                        content: '❌ Errore nel salvataggio del preset.',
                        ephemeral: true
                    });
                }
            }
        }

        // ===================== SELEZIONE TARGET ITEM =====================
        if (interaction.customId === 'preset_item_target') {
            if (!session) {
                return interaction.reply({ 
                    content: '❌ Sessione scaduta. Ricomincia con !preset', 
                    ephemeral: true 
                });
            }

            const targetUserId = interaction.values[0];
            const userName = interaction.member?.displayName || interaction.user.username;
            const itemId = session.shopItemId;
            const { SHOP_ITEMS } = require('./economySystem');
            const item = SHOP_ITEMS.find(i => i.id === itemId);

            const econDb = require('./economySystem').econDb;
            const hasItem = await econDb.hasItem(userId, itemId, 1);
            
            if (!hasItem) {
                activePresetSessions.delete(userId);
                return interaction.update({
                    content: '❌ Non possiedi questo oggetto nell\'inventario.',
                    components: []
                });
            }

            try {
                await econDb.removeItem(userId, itemId, 1);

                const details = {
                    subType: itemId,
                    itemName: item?.name || itemId,
                    targetUserId,
                    responseChannelId: session.channelId
                };

                if (session.presetType === 'night') {
                    await presetDb.addNightPreset(userId, userName, 'SHOP', 'SHOP', details);
                    await interaction.update({
                        content: `✅ **Preset notturno salvato!**\n${item?.name} su <@${targetUserId}> programmato per la fase notturna.\nRimosso dall'inventario.`,
                        components: []
                    });
                } else {
                    await presetDb.addScheduledPreset(userId, userName, 'SHOP', 'SHOP', details, session.triggerTime);
                    await interaction.update({
                        content: `✅ **Preset programmato salvato!**\n${item?.name} su <@${targetUserId}> eseguito alle ${session.triggerTime}.\nRimosso dall'inventario.`,
                        components: []
                    });
                }

                activePresetSessions.delete(userId);
                await updatePresetDashboard();
                
                setTimeout(() => {
                    interaction.message.delete().catch(() => {});
                }, 5000);
            } catch (error) {
                console.error('Errore salvataggio preset SHOP con target:', error);
                await interaction.followUp({
                    content: '❌ Errore nel salvataggio del preset.',
                    ephemeral: true
                });
            }
        }

        // ===================== SUBMIT MODALE =====================
        if (interaction.customId.startsWith('preset_modal_')) {
            const category = interaction.customId.split('_')[2];
            
            if (!session) {
                return interaction.reply({ 
                    content: '❌ Sessione scaduta. Ricomincia con !preset', 
                    ephemeral: true 
                });
            }

            const target = interaction.fields.getTextInputValue('target');
            const description = interaction.fields.getTextInputValue('description');
            const userName = interaction.member?.displayName || interaction.user.username;

            const details = {
                target: target || null,
                text: description
            };

            try {
                if (session.presetType === 'night') {
                    await presetDb.addNightPreset(userId, userName, 'ABILITY', category, details);
                    await interaction.reply({
                        content: `✅ **Preset notturno salvato!**\nAbilità categoria ${getCategoryLabel(category)} programmata per la fase notturna.`,
                        ephemeral: true
                    });
                } else {
                    await presetDb.addScheduledPreset(userId, userName, 'ABILITY', category, details, session.triggerTime);
                    await interaction.reply({
                        content: `✅ **Preset programmato salvato!**\nAbilità categoria ${getCategoryLabel(category)} eseguita alle ${session.triggerTime}.`,
                        ephemeral: true
                    });
                }

                activePresetSessions.delete(userId);
                await updatePresetDashboard();
            } catch (error) {
                console.error('Errore salvataggio preset ABILITY:', error);
                await interaction.followUp({
                    content: '❌ Errore nel salvataggio del preset.',
                    ephemeral: true
                });
            }
        }

        // ===================== LISTA PRESET =====================
        if (interaction.customId === 'preset_list_select') {
            const presetId = interaction.values[0];
            const [type, id] = presetId.split('_');

            try {
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

                await updatePresetDashboard();
                setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
            } catch (error) {
                console.error('Errore rimozione preset:', error);
                await interaction.followUp({
                    content: '❌ Errore nella rimozione del preset.',
                    ephemeral: true
                });
            }
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

    const sorted = nightPresets.sort((a, b) => {
        const priorityA = PRIORITY_ORDER[a.category] || 999;
        const priorityB = PRIORITY_ORDER[b.category] || 999;
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }
        
        return new Date(a.timestamp) - new Date(b.timestamp);
    });

    for (const preset of sorted) {
        const queueItem = mapPresetToQueue(preset);
        if (queueItem) {
            eventBus.emit('queue:add', queueItem);
            console.log(`⏰ [Preset] Aggiunto ${preset.type} (${preset.category}) di ${preset.userName} alla coda.`);
        }
    }

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

    const sorted = scheduledPresets.sort((a, b) => {
        const priorityA = PRIORITY_ORDER[a.category] || 999;
        const priorityB = PRIORITY_ORDER[b.category] || 999;
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }
        
        return new Date(a.timestamp) - new Date(b.timestamp);
    });

    for (const preset of sorted) {
        const queueItem = mapPresetToQueue(preset);
        if (queueItem) {
            eventBus.emit('queue:add', queueItem);
            console.log(`⏰ [Preset] Aggiunto ${preset.type} (${preset.category}) di ${preset.userName} alla coda.`);
        }
    }

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
// ⏰ TIMER AUTOMATICO
// ==========================================
function startPresetTimer() {
    setInterval(async () => {
        const now = new Date();
        const italianTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));
        const hours = String(italianTime.getHours()).padStart(2, '0');
        const minutes = String(italianTime.getMinutes()).padStart(2, '0');
        const currentTime = `${hours}:${minutes}`;

        console.log(`⏰ [Preset Timer] Controllo preset per ${currentTime}...`);

        const scheduledPresets = await presetDb.getScheduledPresetsAtTime(currentTime);
        
        if (scheduledPresets.length > 0) {
            console.log(`⏰ [Preset Timer] Trovati ${scheduledPresets.length} preset per ${currentTime}. Esecuzione...`);
            await resolveScheduledPhase(currentTime);
        }
    }, 60000);

    console.log('⏰ [Preset Timer] Sistema timer automatico avviato (controllo ogni minuto)');
}

// ==========================================
// 🚀 EXPORT
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
