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
            description += `\n**${icon} ${cat}**\n`;
            
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

    // Pulisci SOLO i messaggi della dashboard preset (non tutti i messaggi del bot)
    try {
        const messages = await channel.messages.fetch({ limit: 50 });
        const presetDashboardMsgs = messages.filter(m => 
            m.author.id === clientRef.user.id && 
            m.embeds.length > 0 && 
            m.embeds[0].title === '⏰ Dashboard Preset - Azioni Programmate'
        );
        if (presetDashboardMsgs.size > 0) await channel.bulkDelete(presetDashboardMsgs).catch(() => {});
    } catch {}

    await channel.send({ embeds: [embed] });
}

function getCategoryIcon(category) {
    const cat = CATEGORIES.find(c => c.value === category);
    return cat ? cat.emoji : '❓';
}

// ==========================================
// 🎮 GESTIONE GIOCATORE - UI A STEP
// ==========================================
async function handlePresetCommand(message, args, presetType) {
    const userId = message.author.id;
    const userName = message.member?.displayName || message.author.username;

    // Step 1: Scelta Categoria
    const categorySelect = new StringSelectMenuBuilder()
        .setCustomId(`preset_category_${presetType}`)
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

    const typeLabel = presetType === 'night' ? 'notturno' : `programmato (${args[0] || 'HH:MM'})`;
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
            await interaction.message.delete().catch(() => {});
            return;
        }

        // ===================== SELEZIONE CATEGORIA =====================
        if (interaction.customId.startsWith('preset_category_')) {
            const presetType = interaction.customId.split('_')[2];
            const category = interaction.values[0];

            // CASO 1: BUSSA → Mostra select case
            if (category === 'KNOCK') {
                const houses = await getAvailableHouses(interaction.guild, interaction.user.id);
                
                if (houses.length === 0) {
                    return interaction.reply({
                        content: '❌ Nessuna casa disponibile per bussare.',
                        ephemeral: true
                    });
                }

                const houseSelect = new StringSelectMenuBuilder()
                    .setCustomId(`preset_house_${presetType}`)
                    .setPlaceholder('Scegli la casa dove bussare...')
                    .addOptions(houses.slice(0, 25).map(house => 
                        new StringSelectMenuOptionBuilder()
                            .setLabel(formatName(house.name))
                            .setValue(house.id)
                            .setEmoji('🏠')
                    ));

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`preset_back_category_${presetType}`)
                        .setLabel('Indietro')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('◀️')
                );

                await interaction.update({
                    content: '🏘️ **Step 2: Scegli la casa dove vuoi bussare:**',
                    components: [new ActionRowBuilder().addComponents(houseSelect), backRow]
                });
            }
            // CASO 2: SHOP → Mostra select inventario
            else if (category === 'SHOP') {
                const items = await getUserShopItems(interaction.user.id);

                if (items.length === 0) {
                    return interaction.reply({
                        content: '❌ Non hai oggetti nel tuo inventario.',
                        ephemeral: true
                    });
                }

                const itemSelect = new StringSelectMenuBuilder()
                    .setCustomId(`preset_shop_item_${presetType}`)
                    .setPlaceholder('Scegli l\'oggetto da usare...')
                    .addOptions(items.map(item => 
                        new StringSelectMenuOptionBuilder()
                            .setLabel(`${item.name} (${item.quantity}x)`)
                            .setValue(item.id)
                            .setEmoji(item.emoji)
                    ));

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`preset_back_category_${presetType}`)
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
                    .setCustomId(`preset_modal_${category}_${presetType}`)
                    .setTitle(`Preset ${category}`);

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
            const presetType = interaction.customId.split('_')[3];
            
            const categorySelect = new StringSelectMenuBuilder()
                .setCustomId(`preset_category_${presetType}`)
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

        // ===================== SELEZIONE CASA (BUSSA) =====================
        if (interaction.customId.startsWith('preset_house_')) {
            const presetType = interaction.customId.split('_')[2];
            const targetChannelId = interaction.values[0];
            const userId = interaction.user.id;
            const userName = interaction.member?.displayName || interaction.user.username;

            const details = {
                targetChannelId,
                mode: 'mode_normal',
                fromChannelId: interaction.channel.id
            };

            if (presetType === 'night') {
                await presetDb.addNightPreset(userId, userName, 'KNOCK', 'KNOCK', details);
                await interaction.update({
                    content: '✅ **Preset notturno salvato!** Bussa programmata per la fase notturna.',
                    components: []
                });
            } else {
                // Per scheduled, recuperiamo il triggerTime dal messaggio
                const triggerTime = interaction.message.content.match(/\d{2}:\d{2}/)?.[0] || '00:00';
                await presetDb.addScheduledPreset(userId, userName, 'KNOCK', 'KNOCK', details, triggerTime);
                await interaction.update({
                    content: `✅ **Preset programmato salvato!** Bussa eseguita alle ${triggerTime}.`,
                    components: []
                });
            }

            setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
            await updatePresetDashboard();
        }

        // ===================== SELEZIONE SHOP ITEM =====================
        if (interaction.customId.startsWith('preset_shop_item_')) {
            const presetType = interaction.customId.split('_')[3];
            const itemId = interaction.values[0];

            // Verifica se l'oggetto è "catene" (richiede target)
            if (itemId === 'catene') {
                const guild = interaction.guild;
                const aliveRole = guild.roles.cache.get(RUOLI.ALIVE);
                
                if (!aliveRole) {
                    return interaction.reply({
                        content: '❌ Ruolo giocatori non trovato.',
                        ephemeral: true
                    });
                }

                const aliveMembers = aliveRole.members
                    .filter(m => m.id !== interaction.user.id && !m.user.bot)
                    .map(m => ({
                        id: m.id,
                        name: m.displayName || m.user.username
                    }));

                if (aliveMembers.length === 0) {
                    return interaction.reply({
                        content: '❌ Nessun giocatore disponibile come target.',
                        ephemeral: true
                    });
                }

                const playerSelect = new StringSelectMenuBuilder()
                    .setCustomId(`preset_catene_target_${presetType}`)
                    .setPlaceholder('Scegli il target per le catene...')
                    .addOptions(aliveMembers.slice(0, 25).map(player => 
                        new StringSelectMenuOptionBuilder()
                            .setLabel(player.name)
                            .setValue(player.id)
                            .setEmoji('👤')
                    ));

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`preset_back_category_${presetType}`)
                        .setLabel('Indietro')
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji('◀️')
                );

                await interaction.update({
                    content: '⛓️ **Step 3: Scegli il target per le catene:**',
                    components: [new ActionRowBuilder().addComponents(playerSelect), backRow]
                });
            } else {
                // Altri oggetti shop non richiedono target
                const userId = interaction.user.id;
                const userName = interaction.member?.displayName || interaction.user.username;
                const { SHOP_ITEMS } = require('./economySystem');
                const item = SHOP_ITEMS.find(i => i.id === itemId);

                const details = {
                    subType: itemId,
                    itemName: item?.name || itemId,
                    responseChannelId: interaction.channel.id
                };

                if (presetType === 'night') {
                    await presetDb.addNightPreset(userId, userName, 'SHOP', 'SHOP', details);
                    await interaction.update({
                        content: `✅ **Preset notturno salvato!** Oggetto "${item?.name}" programmato per la fase notturna.`,
                        components: []
                    });
                } else {
                    const triggerTime = interaction.message.content.match(/\d{2}:\d{2}/)?.[0] || '00:00';
                    await presetDb.addScheduledPreset(userId, userName, 'SHOP', 'SHOP', details, triggerTime);
                    await interaction.update({
                        content: `✅ **Preset programmato salvato!** Oggetto "${item?.name}" eseguito alle ${triggerTime}.`,
                        components: []
                    });
                }

                setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
                await updatePresetDashboard();
            }
        }

        // ===================== SELEZIONE TARGET CATENE =====================
        if (interaction.customId.startsWith('preset_catene_target_')) {
            const presetType = interaction.customId.split('_')[3];
            const targetUserId = interaction.values[0];
            const userId = interaction.user.id;
            const userName = interaction.member?.displayName || interaction.user.username;

            const details = {
                subType: 'catene',
                itemName: 'Catene',
                targetUserId,
                responseChannelId: interaction.channel.id
            };

            if (presetType === 'night') {
                await presetDb.addNightPreset(userId, userName, 'SHOP', 'SHOP', details);
                await interaction.update({
                    content: `✅ **Preset notturno salvato!** Catene su <@${targetUserId}> programmate per la fase notturna.`,
                    components: []
                });
            } else {
                const triggerTime = interaction.message.content.match(/\d{2}:\d{2}/)?.[0] || '00:00';
                await presetDb.addScheduledPreset(userId, userName, 'SHOP', 'SHOP', details, triggerTime);
                await interaction.update({
                    content: `✅ **Preset programmato salvato!** Catene su <@${targetUserId}> eseguite alle ${triggerTime}.`,
                    components: []
                });
            }

            setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
            await updatePresetDashboard();
        }

        // ===================== SUBMIT MODALE (Altre categorie) =====================
        if (interaction.customId.startsWith('preset_modal_')) {
            const parts = interaction.customId.split('_');
            const category = parts[2];
            const presetType = parts[3];

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
                    content: `✅ **Preset notturno salvato!** Abilità categoria ${category} programmata per la fase notturna.`,
                    ephemeral: true
                });
            } else {
                // CORREZIONE BUG: Recupera il triggerTime dal messaggio originale
                const triggerTime = interaction.message.content.match(/\d{2}:\d{2}/)?.[0] || '00:00';
                await presetDb.addScheduledPreset(userId, userName, 'ABILITY', category, details, triggerTime);
                await interaction.reply({
                    content: `✅ **Preset programmato salvato!** Abilità categoria ${category} eseguita alle ${triggerTime}.`,
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
        let label = `${icon} ${preset.category} (Notturno)`;
        
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
        let label = `${icon} ${preset.category} (${preset.triggerTime})`;
        
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
};
