{
type: uploaded file
fileName: presetSystem.js
fullContent:
// ==========================================
// ⏰ PRESET SYSTEM - Azioni Programmate
// ADMIN DASHBOARD + TIMER + NOTTE
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
// SCOPA ESCLUSA ESPLICITAMENTE
const SHOP_ITEMS_REF = [
    { id: 'lettera',    name: 'Lettera',              emoji: '✉️' },
    { id: 'scarpe',     name: 'Scarpe',               emoji: '👟' },
    { id: 'testamento', name: 'Testamento',           emoji: '📜' },
    { id: 'catene',     name: 'Catene',               emoji: '⛓️' }, 
    { id: 'fuochi',     name: 'Fuochi d\'artificio',  emoji: '🎆' },
    { id: 'tenda',      name: 'Tenda',                emoji: '⛺' },
    // Scopa rimossa volutamente
];

// ==========================================
// 🗄️ STORAGE TEMPORANEO PRESET IN CORSO
// ==========================================
const activePresetSessions = new Map(); // userId -> { presetType, triggerTime, ... }

// ==========================================
// 📊 PRIORITY ORDER (Gerarchia Visualizzazione)
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
        const { PresetNightModel } = require('./database');
        return PresetNightModel.create({
            userId, userName, type, category, details, timestamp: new Date()
        });
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
        const { PresetScheduledModel } = require('./database');
        return PresetScheduledModel.create({
            userId, userName, type, category, details, timestamp: new Date(), triggerTime
        });
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
// 📊 DASHBOARD ADMIN (NUOVO COMANDO !preset)
// ==========================================
async function showAdminDashboard(message) {
    const nightPresets = await presetDb.getAllNightPresets();
    const scheduledPresets = await presetDb.getAllScheduledPresets();

    // Combina tutto per visualizzazione gerarchica
    const allPresets = [];
    
    nightPresets.forEach(p => allPresets.push({ ...p, source: '🌙 NOTTE' }));
    scheduledPresets.forEach(p => allPresets.push({ ...p, source: `⏰ ${p.triggerTime}` }));

    if (allPresets.length === 0) {
        return message.channel.send("✅ **Nessun preset (Notturno o Timer) in attesa.**");
    }

    // Raggruppa per Categoria (Gerarchia)
    const grouped = {};
    for (const p of allPresets) {
        const cat = p.category || 'ALTRO';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(p);
    }

    // Ordina Categorie per Priorità
    const sortedCategories = Object.keys(grouped).sort((a, b) => {
        return (PRIORITY_ORDER[a] || 999) - (PRIORITY_ORDER[b] || 999);
    });

    let description = '';
    
    for (const cat of sortedCategories) {
        const icon = getCategoryIcon(cat);
        const catLabel = getCategoryLabel(cat);
        description += `\n**${icon} ${catLabel}**\n`;

        // Ordina interni per orario (se timer) o timestamp
        grouped[cat].sort((a, b) => {
            if (a.triggerTime && b.triggerTime) return a.triggerTime.localeCompare(b.triggerTime);
            return new Date(a.timestamp) - new Date(b.timestamp);
        });

        for (const p of grouped[cat]) {
            let details = '';
            if (p.type === 'KNOCK') {
                 // Recupera nome canale se possibile, altrimenti ID
                 const chName = message.guild.channels.cache.get(p.details.targetChannelId)?.name || p.details.targetChannelId;
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
        .setTitle('📋 Dashboard Preset Globale (Admin)')
        .setColor('Gold')
        .setDescription(description.substring(0, 4096))
        .setFooter({ text: 'Mostra tutti i preset Notturni e Timer attivi' })
        .setTimestamp();

    await message.channel.send({ embeds: [embed] });
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
// 🎮 GESTIONE COMANDO PRESET (UTENTE)
// ==========================================
async function handlePresetCommand(message, args, presetType, triggerTime = null) {
    const userId = message.author.id;
    const userName = message.member?.displayName || message.author.username;
    
    activePresetSessions.set(userId, {
        presetType: presetType,
        triggerTime: triggerTime,
        channelId: message.channel.id,
        userName: userName
    });

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
        ? '🌙 Notturno' 
        : `⏰ Timer (Esecuzione alle **${triggerTime}**)`;
    
    await message.reply({
        content: `**Creazione Preset ${typeLabel}**\nSeleziona la categoria dell'azione:`,
        components: [row, closeRow]
    });
}

// ==========================================
// 🔧 INTERACTION HANDLERS (LOGICA CORE)
// ==========================================
function registerPresetInteractions(client) {
    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu() && !interaction.isButton() && !interaction.isModalSubmit()) return;
        if (!interaction.customId.startsWith('preset_')) return;

        const userId = interaction.user.id;
        const session = activePresetSessions.get(userId);

        // CHIUDI
        if (interaction.customId === 'preset_close') {
            activePresetSessions.delete(userId);
            await interaction.update({ content: '❌ Operazione annullata.', components: [] });
            setTimeout(() => interaction.message.delete().catch(() => {}), 2000);
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

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('preset_close').setLabel('Annulla').setStyle(ButtonStyle.Danger).setEmoji('❌')
            );

            await interaction.update({
                content: '**Seleziona la categoria dell\'azione:**',
                components: [new ActionRowBuilder().addComponents(categorySelect), closeRow]
            });
            return;
        }

        // SELEZIONE CATEGORIA
        if (interaction.customId === 'preset_category') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });

            const category = interaction.values[0];
            session.category = category;

            // CASO 1: BUSSA
            if (category === 'KNOCK') {
                const modeSelect = new StringSelectMenuBuilder()
                    .setCustomId('preset_knock_mode')
                    .setPlaceholder('Scegli la modalità di visita...')
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel('Visita Normale').setValue('mode_normal').setEmoji('👋'),
                        new StringSelectMenuOptionBuilder().setLabel('Visita Forzata').setValue('mode_forced').setEmoji('🧨'),
                        new StringSelectMenuOptionBuilder().setLabel('Visita Nascosta').setValue('mode_hidden').setEmoji('🕵️')
                    );

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('preset_back_category').setLabel('Indietro').setStyle(ButtonStyle.Secondary).setEmoji('◀️')
                );

                await interaction.update({
                    content: '🎭 **Step 2: Scegli la modalità di visita:**',
                    components: [new ActionRowBuilder().addComponents(modeSelect), backRow]
                });
            }
            // CASO 2: SHOP (INVENTARIO)
            else if (category === 'SHOP') {
                const { econDb } = require('./economySystem');
                const inventory = await econDb.getInventory(userId);
                
                // Filtra oggetti validi (NO SCOPA)
                const validItems = SHOP_ITEMS_REF.filter(item => 
                    inventory[item.id] && inventory[item.id] > 0
                );

                if (validItems.length === 0) {
                    return interaction.update({
                        content: '❌ **Inventario vuoto o nessun oggetto utilizzabile via preset.** (La Scopa non è utilizzabile qui).',
                        components: []
                    });
                }

                const itemSelect = new StringSelectMenuBuilder()
                    .setCustomId('preset_shop_item')
                    .setPlaceholder('Seleziona l\'oggetto da usare...')
                    .addOptions(validItems.map(item => 
                        new StringSelectMenuOptionBuilder()
                            .setLabel(`${item.name} (x${inventory[item.id]})`)
                            .setValue(item.id)
                            .setEmoji(item.emoji)
                    ));

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('preset_back_category').setLabel('Indietro').setStyle(ButtonStyle.Secondary).setEmoji('◀️')
                );

                await interaction.update({
                    content: '🛒 **Step 2: Seleziona l\'oggetto:**',
                    components: [new ActionRowBuilder().addComponents(itemSelect), backRow]
                });
            }
            // CASO 3: ALTRO (Text)
            else {
                const modal = new ModalBuilder()
                    .setCustomId(`preset_modal_${category}`)
                    .setTitle(`Preset ${getCategoryLabel(category)}`);

                const targetInput = new TextInputBuilder()
                    .setCustomId('target')
                    .setLabel('Target (Nome giocatore, opzionale)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setPlaceholder('Es: Mario');

                const descInput = new TextInputBuilder()
                    .setCustomId('description')
                    .setLabel('Dettagli Azione')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setPlaceholder('Descrivi cosa vuoi fare...');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(targetInput),
                    new ActionRowBuilder().addComponents(descInput)
                );

                await interaction.showModal(modal);
            }
        }

        // KNOCK: MODE -> CASA
        if (interaction.customId === 'preset_knock_mode') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            session.knockMode = interaction.values[0];

            const houses = await getAvailableHouses(interaction.guild, userId);
            if (houses.length === 0) {
                return interaction.update({ content: '❌ Nessuna casa disponibile.', components: [] });
            }

            const houseSelect = new StringSelectMenuBuilder()
                .setCustomId('preset_house')
                .setPlaceholder('Scegli la casa...')
                .addOptions(houses.slice(0, 25).map(house => 
                    new StringSelectMenuOptionBuilder().setLabel(formatName(house.name)).setValue(house.id).setEmoji('🏠')
                ));

            const backRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('preset_back_category').setLabel('Ricomincia').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
            );

            await interaction.update({
                content: `🏠 **Step 3: Dove vuoi bussare?**`,
                components: [new ActionRowBuilder().addComponents(houseSelect), backRow]
            });
        }

        // KNOCK: SAVE
        if (interaction.customId === 'preset_house') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const targetChannelId = interaction.values[0];

            // NOTA: La visita verrà scalata nel momento in cui il preset viene ESEGUITO (spostato in Queue)
            // Questo vale sia per Timer che per Notte.

            const details = {
                targetChannelId,
                mode: session.knockMode,
                fromChannelId: session.channelId
            };
            await savePreset(interaction, session, 'KNOCK', 'KNOCK', details, session.userName);
        }

        // SHOP: ITEM
        if (interaction.customId === 'preset_shop_item') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const itemId = interaction.values[0];
            session.shopItemId = itemId;
            const itemDef = SHOP_ITEMS_REF.find(i => i.id === itemId);
            const itemsWithTarget = ['catene', 'lettera']; 

            if (itemsWithTarget.includes(itemId)) {
                const aliveMembers = await getAlivePlayers(interaction.guild, userId);
                const playerSelect = new StringSelectMenuBuilder()
                    .setCustomId('preset_item_target')
                    .setPlaceholder(`Scegli il target...`)
                    .addOptions(aliveMembers.slice(0, 25).map(p => 
                        new StringSelectMenuOptionBuilder().setLabel(p.name).setValue(p.id).setEmoji('👤')
                    ));

                await interaction.update({
                    content: `🎯 **Step 3: Target per ${itemDef.name}:**`,
                    components: [new ActionRowBuilder().addComponents(playerSelect)]
                });
            } else {
                // Rimuovi subito dall'inventario
                const { econDb } = require('./economySystem');
                await econDb.removeItem(userId, itemId, 1);
                const details = { subType: itemId, itemName: itemDef.name, responseChannelId: session.channelId };
                await savePreset(interaction, session, 'SHOP', 'SHOP', details, session.userName, 
                    `✅ Oggetto **${itemDef.name}** programmato e rimosso dall'inventario.`);
            }
        }

        // SHOP: SAVE WITH TARGET
        if (interaction.customId === 'preset_item_target') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const targetUserId = interaction.values[0];
            const itemId = session.shopItemId;
            const itemDef = SHOP_ITEMS_REF.find(i => i.id === itemId);
            const { econDb } = require('./economySystem');
            await econDb.removeItem(userId, itemId, 1);

            const details = { subType: itemId, itemName: itemDef.name, targetUserId, responseChannelId: session.channelId };
            await savePreset(interaction, session, 'SHOP', 'SHOP', details, session.userName,
                `✅ Oggetto **${itemDef.name}** su <@${targetUserId}> programmato e rimosso dall'inventario.`);
        }

        // ABILITY: MODAL
        if (interaction.customId.startsWith('preset_modal_')) {
            const category = interaction.customId.split('_')[2];
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });

            const target = interaction.fields.getTextInputValue('target');
            const desc = interaction.fields.getTextInputValue('description');

            const details = { target: target || null, text: desc };
            await savePreset(interaction, session, 'ABILITY', category, details, session.userName);
        }

        // LISTA: RIMUOVI
        if (interaction.customId === 'preset_list_select') {
            const presetId = interaction.values[0];
            const [type, id] = presetId.split('_');

            try {
                if (type === 'night') await presetDb.removeNightPreset(id);
                else await presetDb.removeScheduledPreset(id);

                await interaction.update({ content: '✅ Preset rimosso.', components: [] });
                setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
            } catch (error) {
                console.error(error);
                await interaction.reply({ content: '❌ Errore.', ephemeral: true });
            }
        }
    });
}

// ==========================================
// 💾 SALVATAGGIO
// ==========================================
async function savePreset(interaction, session, type, category, details, userName, customMsg = null) {
    try {
        if (session.presetType === 'night') {
            await presetDb.addNightPreset(interaction.user.id, userName, type, category, details);
        } else {
            // Salva nel DB Scheduled con l'orario trigger
            await presetDb.addScheduledPreset(interaction.user.id, userName, type, category, details, session.triggerTime);
        }

        activePresetSessions.delete(interaction.user.id);
        
        const msg = customMsg || `✅ **Preset Salvato!**\nTipo: ${session.presetType === 'night' ? 'Notturna' : 'Timer (' + session.triggerTime + ')'}\nCategoria: ${getCategoryLabel(category)}`;
        
        if (interaction.isModalSubmit()) await interaction.reply({ content: msg, ephemeral: true });
        else await interaction.update({ content: msg, components: [] });

    } catch (error) {
        console.error('Errore SavePreset:', error);
        if (interaction.deferred || interaction.replied) await interaction.followUp({ content: '❌ Errore.', ephemeral: true });
        else await interaction.reply({ content: '❌ Errore.', ephemeral: true });
    }
}

// ==========================================
// 🎯 HELPER PER CASE E GIOCATORI
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
            if (ow && ow.deny.has(PermissionsBitField.Flags.ViewChannel)) return false;
            return true;
        })
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map(ch => ({ id: ch.id, name: ch.name }));
}

async function getAlivePlayers(guild, excludeId) {
    const aliveRole = guild.roles.cache.get(RUOLI.ALIVE);
    if (!aliveRole) return [];
    const markedForDeath = await db.moderation.getMarkedForDeath();
    const deadIds = markedForDeath.map(m => m.userId);

    return aliveRole.members
        .filter(m => m.id !== excludeId && !m.user.bot && !deadIds.includes(m.id))
        .map(m => ({ id: m.id, name: m.displayName || m.user.username }));
}

// ==========================================
// 🚀 TRASFERIMENTO IN QUEUE (ESECUZIONE)
// ==========================================
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
                text: `[${getCategoryLabel(preset.category)}] ${preset.details.text}` + (preset.details.target ? ` (Target: ${preset.details.target})` : ''),
                category: preset.category
            }
        };
    }
    return null;
}

// Risoluzione Notte (!notte)
async function resolveNightPhase() {
    console.log('🌙 [Preset] Risoluzione NOTTURNA...');
    const presets = await presetDb.getAllNightPresets();
    await processAndClearPresets(presets, 'Night');
}

// Risoluzione Timer (Automatico)
async function resolveScheduledPhase(triggerTime) {
    console.log(`⏰ [Preset] Risoluzione TIMER (${triggerTime})...`);
    const presets = await presetDb.getScheduledPresetsAtTime(triggerTime);
    if (presets.length > 0) {
        await processAndClearPresets(presets, triggerTime);
        await presetDb.clearScheduledPresets(triggerTime);
    }
}

async function processAndClearPresets(presets, contextLabel) {
    if (presets.length === 0) return;

    // Ordina per priorità
    const sorted = presets.sort((a, b) => {
        const pA = PRIORITY_ORDER[a.category] || 999;
        const pB = PRIORITY_ORDER[b.category] || 999;
        if (pA !== pB) return pA - pB;
        return new Date(a.timestamp) - new Date(b.timestamp);
    });

    for (const preset of sorted) {
        // --- LOGICA DEDUZIONE VISITE ---
        if (preset.type === 'KNOCK') {
            const info = await db.housing.getVisitInfo(preset.userId);
            let canProceed = false;

            if (preset.details.mode === 'mode_forced') {
                if (info.forced > 0) {
                    await db.housing.decrementForced(preset.userId);
                    canProceed = true;
                }
            } else if (preset.details.mode === 'mode_hidden') {
                if (info.hidden > 0) {
                    await db.housing.decrementHidden(preset.userId);
                    canProceed = true;
                }
            } else {
                if (info.used < info.totalLimit) {
                    await db.housing.incrementVisit(preset.userId);
                    canProceed = true;
                }
            }

            if (!canProceed) {
                console.log(`🚫 [Preset] Salto KNOCK di ${preset.userName}: visite finite.`);
                continue; // Non aggiunge alla coda
            }
        }

        const queueItem = mapPresetToQueue(preset);
        if (queueItem) {
            eventBus.emit('queue:add', queueItem);
            console.log(`➡️ [Preset -> Queue] Spostato ${preset.type} di ${preset.userName}`);
        }
    }

    if (contextLabel === 'Night') {
        await presetDb.clearAllNightPresets();
    }
}

// ==========================================
// 📋 LISTA UTENTE
// ==========================================
async function showUserPresets(message) {
    const userId = message.author.id;
    const night = await presetDb.getUserNightPresets(userId);
    const scheduled = await presetDb.getUserScheduledPresets(userId);

    if (night.length === 0 && scheduled.length === 0) {
        return message.reply('📋 Non hai preset attivi.');
    }

    const options = [];

    // Notturni
    for (const p of night) {
        let label = `🌙 ${getCategoryLabel(p.category)}`;
        if (p.type === 'SHOP') label += ` (${p.details.itemName})`;
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(label.substring(0, 100))
            .setValue(`night_${p._id}`)
            .setDescription('Notturno - Clicca per rimuovere')
        );
    }

    // Timer
    for (const p of scheduled) {
        let label = `⏰ ${p.triggerTime} - ${getCategoryLabel(p.category)}`;
        if (p.type === 'SHOP') label += ` (${p.details.itemName})`;
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(label.substring(0, 100))
            .setValue(`scheduled_${p._id}`)
            .setDescription(`Timer ${p.triggerTime} - Clicca per rimuovere`)
        );
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId('preset_list_select')
        .setPlaceholder('Seleziona un preset da rimuovere...')
        .addOptions(options.slice(0, 25));

    await message.reply({
        content: '📋 **I tuoi preset attivi:**\nSeleziona per eliminare:',
        components: [new ActionRowBuilder().addComponents(select)]
    });
}

// ==========================================
// ⏰ TIMER
// ==========================================
function startPresetTimer() {
    setInterval(async () => {
        const now = new Date();
        const options = { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false };
        const currentTime = now.toLocaleTimeString('it-IT', options).slice(0, 5); // "HH:MM"

        const scheduledPresets = await presetDb.getScheduledPresetsAtTime(currentTime);
        
        if (scheduledPresets.length > 0) {
            await resolveScheduledPhase(currentTime);
        }
    }, 60000); // Check ogni minuto

    console.log('⏰ [Preset] Timer avviato (Europe/Rome).');
}

module.exports = {
    registerPresetInteractions,
    handlePresetCommand,
    resolveNightPhase,
    resolveScheduledPhase,
    showUserPresets,
    showAdminDashboard,
    startPresetTimer,
};
}
