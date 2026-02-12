// ==========================================
// ⏰ PRESET SYSTEM - Azioni Programmate
// DIURNO + NOTTURNO + TIMER + FIX PAGINAZIONE CASE
// 🔥 NUOVO: Visite scalate dalla fase SUCCESSIVA
// 🔥 NUOVO: Controllo visite disponibili prima dell'esecuzione
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
        .setTitle('📊 Dashboard Preset - Tutti')
        .setDescription(description.slice(0, 4096))
        .setColor(0x3498db);

    await message.channel.send({ embeds: [embed] });
}

// ==========================================
// 🛠️ INTERACTION HANDLER
// ==========================================
function registerPresetInteractions(client) {
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return;

        const userId = interaction.user.id;
        const session = activePresetSessions.get(userId);

        // SELECT PAGE
        if (interaction.isStringSelectMenu() && interaction.customId === 'preset_page_select') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const pageNum = parseInt(interaction.values[0].replace('page_', ''));
            const houses = await getAvailableHousesSorted(interaction.guild, userId);
            const PAGE_SIZE = 25;
            const start = pageNum * PAGE_SIZE + 1;
            const end = (pageNum + 1) * PAGE_SIZE;
            const filtered = houses.filter(h => {
                const match = h.name.match(/(\w+)-(\d+)/);
                if (!match) return false;
                const num = parseInt(match[2]);
                return num >= start && num <= end;
            });
            if (filtered.length === 0) return interaction.reply({ content: '❌ Nessuna casa in questa zona.', ephemeral: true });
            const select = new StringSelectMenuBuilder()
                .setCustomId('preset_house_select')
                .setPlaceholder('Seleziona casa...')
                .addOptions(filtered.map(h => new StringSelectMenuOptionBuilder().setLabel(formatName(h.name)).setValue(h.id)));
            await interaction.update({ content: `🏠 **Step 4: Seleziona casa:**`, components: [new ActionRowBuilder().addComponents(select)] });
        }

        // SELECT HOUSE
        else if (interaction.isStringSelectMenu() && interaction.customId === 'preset_house_select') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const targetChannelId = interaction.values[0];
            const ch = interaction.guild.channels.cache.get(targetChannelId);
            if (!ch) return interaction.reply({ content: '❌ Casa non trovata.', ephemeral: true });

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('preset_knock_normal').setLabel('👋 Normale').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('preset_knock_forced').setLabel('🧨 Forzata').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('preset_knock_hidden').setLabel('🕵️ Nascosta').setStyle(ButtonStyle.Secondary)
            );
            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('preset_knock_cancel').setLabel('❌ Annulla').setStyle(ButtonStyle.Secondary)
            );

            activePresetSessions.set(userId, { ...session, targetChannelId });
            await interaction.update({ content: `🏠 **Casa:** ${formatName(ch.name)}\n🔔 **Modalità bussata:**`, components: [row1, row2] });
        }

        // KNOCK MODE
        else if (interaction.isButton() && interaction.customId.startsWith('preset_knock_')) {
            if (interaction.customId === 'preset_knock_cancel') {
                activePresetSessions.delete(userId);
                return interaction.update({ content: '❌ Operazione annullata.', components: [] });
            }

            if (!session || !session.targetChannelId) return interaction.reply({ content: '❌ Dati mancanti.', ephemeral: true });

            const mode = interaction.customId.replace('preset_knock_', '');
            const modeLabel = { normal: '👋 Normale', forced: '🧨 Forzata', hidden: '🕵️ Nascosta' }[mode];
            const ch = interaction.guild.channels.cache.get(session.targetChannelId);

            // 🔥 CONTROLLO VISITE DISPONIBILI PER LA FASE SUCCESSIVA
            const visitInfo = await db.housing.getNextPhaseVisitInfo(userId);
            if (!visitInfo) {
                activePresetSessions.delete(userId);
                return interaction.update({ content: '❌ Errore nel recupero delle visite.', components: [] });
            }

            // Controllo visita normale (base)
            if (mode === 'normal') {
                if (visitInfo.totalLimit <= 0) {
                    activePresetSessions.delete(userId);
                    return interaction.update({ 
                        content: `❌ **Non hai visite base disponibili per la fase ${visitInfo.nextMode === 'DAY' ? 'DIURNA' : 'NOTTURNA'}!**\nVisite base disponibili: ${visitInfo.base}\nVisite extra disponibili: ${visitInfo.extra}`, 
                        components: [] 
                    });
                }
                // Scala la visita base
                await db.housing.decrementNextPhaseBaseLimit(userId);
            }

            // Controllo visite forzate/nascoste
            if (mode === 'forced' || mode === 'hidden') {
                if (mode === 'forced') {
                    if (visitInfo.forcedLimit <= 0) {
                        activePresetSessions.delete(userId);
                        return interaction.update({ 
                            content: `❌ **Non hai visite forzate disponibili per la fase ${visitInfo.nextMode === 'DAY' ? 'DIURNA' : 'NOTTURNA'}!**\nVisite forzate disponibili: ${visitInfo.forcedLimit}`, 
                            components: [] 
                        });
                    }
                }

                if (mode === 'hidden') {
                    if (visitInfo.hiddenLimit <= 0) {
                        activePresetSessions.delete(userId);
                        return interaction.update({ 
                            content: `❌ **Non hai visite nascoste disponibili per la fase ${visitInfo.nextMode === 'DAY' ? 'DIURNA' : 'NOTTURNA'}!**\nVisite nascoste disponibili: ${visitInfo.hiddenLimit}`, 
                            components: [] 
                        });
                    }
                }

                // Scala le visite della fase successiva
                if (mode === 'forced') await db.housing.decrementNextPhaseForcedLimit(userId);
                if (mode === 'hidden') await db.housing.decrementNextPhaseHiddenLimit(userId);
            }

            const details = { targetChannelId: session.targetChannelId, mode: `mode_${mode}` };

            if (session.type === 'night') {
                await presetDb.addNightPreset(userId, interaction.user.displayName, 'KNOCK', 'KNOCK', details);
                activePresetSessions.delete(userId);
                await interaction.update({ content: `✅ **Preset notturno salvato!**\n🏠 Casa: ${formatName(ch.name)}\n🔔 Modalità: ${modeLabel}`, components: [] });
            } else if (session.type === 'day') {
                await presetDb.addDayPreset(userId, interaction.user.displayName, 'KNOCK', 'KNOCK', details);
                activePresetSessions.delete(userId);
                await interaction.update({ content: `✅ **Preset diurno salvato!**\n🏠 Casa: ${formatName(ch.name)}\n🔔 Modalità: ${modeLabel}`, components: [] });
            } else if (session.type === 'timer') {
                await presetDb.addScheduledPreset(userId, interaction.user.displayName, 'KNOCK', 'KNOCK', details, session.triggerTime);
                activePresetSessions.delete(userId);
                await interaction.update({ content: `✅ **Preset timer salvato!**\n⏰ Orario: ${session.triggerTime}\n🏠 Casa: ${formatName(ch.name)}\n🔔 Modalità: ${modeLabel}`, components: [] });
            }
        }

        // SELECT PLAYER
        else if (interaction.isStringSelectMenu() && interaction.customId === 'preset_player_select') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const targetUserId = interaction.values[0];
            const details = { subType: session.subType, itemName: session.itemName, targetUserId };
            const targetUser = interaction.guild.members.cache.get(targetUserId)?.displayName || 'Utente';

            if (session.type === 'night') {
                await presetDb.addNightPreset(userId, interaction.user.displayName, 'SHOP', 'SHOP', details);
                activePresetSessions.delete(userId);
                await interaction.update({ content: `✅ **Preset notturno salvato!**\n🛒 Oggetto: ${session.itemName}\n👤 Target: ${targetUser}`, components: [] });
            } else if (session.type === 'day') {
                await presetDb.addDayPreset(userId, interaction.user.displayName, 'SHOP', 'SHOP', details);
                activePresetSessions.delete(userId);
                await interaction.update({ content: `✅ **Preset diurno salvato!**\n🛒 Oggetto: ${session.itemName}\n👤 Target: ${targetUser}`, components: [] });
            } else if (session.type === 'timer') {
                await presetDb.addScheduledPreset(userId, interaction.user.displayName, 'SHOP', 'SHOP', details, session.triggerTime);
                activePresetSessions.delete(userId);
                await interaction.update({ content: `✅ **Preset timer salvato!**\n⏰ Orario: ${session.triggerTime}\n🛒 Oggetto: ${session.itemName}\n👤 Target: ${targetUser}`, components: [] });
            }
        }

        // SELECT SHOP ITEM
        else if (interaction.isStringSelectMenu() && interaction.customId === 'preset_shop_select') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const subType = interaction.values[0];
            const item = SHOP_ITEMS_REF.find(i => i.id === subType);
            if (!item) return interaction.reply({ content: '❌ Oggetto non trovato.', ephemeral: true });

            if (['lettera', 'scarpe'].includes(subType)) {
                const players = await getAlivePlayers(interaction.guild, userId);
                if (players.length === 0) return interaction.update({ content: '❌ Nessun giocatore vivo disponibile.', components: [] });

                const select = new StringSelectMenuBuilder()
                    .setCustomId('preset_player_select')
                    .setPlaceholder('Seleziona target...')
                    .addOptions(players.slice(0, 25).map(p => new StringSelectMenuOptionBuilder().setLabel(p.name).setValue(p.id)));

                activePresetSessions.set(userId, { ...session, subType, itemName: item.name });
                await interaction.update({ content: `🛒 **Oggetto:** ${item.name}\n👤 **Seleziona target:**`, components: [new ActionRowBuilder().addComponents(select)] });
            } else {
                const details = { subType, itemName: item.name };

                if (session.type === 'night') {
                    await presetDb.addNightPreset(userId, interaction.user.displayName, 'SHOP', 'SHOP', details);
                    activePresetSessions.delete(userId);
                    await interaction.update({ content: `✅ **Preset notturno salvato!**\n🛒 Oggetto: ${item.name}`, components: [] });
                } else if (session.type === 'day') {
                    await presetDb.addDayPreset(userId, interaction.user.displayName, 'SHOP', 'SHOP', details);
                    activePresetSessions.delete(userId);
                    await interaction.update({ content: `✅ **Preset diurno salvato!**\n🛒 Oggetto: ${item.name}`, components: [] });
                } else if (session.type === 'timer') {
                    await presetDb.addScheduledPreset(userId, interaction.user.displayName, 'SHOP', 'SHOP', details, session.triggerTime);
                    activePresetSessions.delete(userId);
                    await interaction.update({ content: `✅ **Preset timer salvato!**\n⏰ Orario: ${session.triggerTime}\n🛒 Oggetto: ${item.name}`, components: [] });
                }
            }
        }

        // SELECT CATEGORY
        else if (interaction.isStringSelectMenu() && interaction.customId === 'preset_category_select') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const cat = interaction.values[0];

            if (cat === 'KNOCK') {
                const result = await buildPageSelect(interaction.guild, userId);
                activePresetSessions.set(userId, { ...session, category: cat });
                await interaction.update(result);
            } else if (cat === 'SHOP') {
                const select = new StringSelectMenuBuilder()
                    .setCustomId('preset_shop_select')
                    .setPlaceholder('Seleziona oggetto...')
                    .addOptions(SHOP_ITEMS_REF.map(i => new StringSelectMenuOptionBuilder().setLabel(i.name).setValue(i.id).setEmoji(i.emoji)));
                activePresetSessions.set(userId, { ...session, category: cat });
                await interaction.update({ content: `🛒 **Step 3: Seleziona oggetto shop:**`, components: [new ActionRowBuilder().addComponents(select)] });
            } else {
                const modal = new ModalBuilder()
                    .setCustomId('preset_ability_modal')
                    .setTitle(`Abilità - ${CATEGORIES.find(c => c.value === cat)?.label}`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('ability_text').setLabel('Descrizione abilità').setStyle(TextInputStyle.Paragraph).setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('ability_target').setLabel('Target (opzionale)').setStyle(TextInputStyle.Short).setRequired(false)
                        )
                    );
                activePresetSessions.set(userId, { ...session, category: cat });
                await interaction.showModal(modal);
            }
        }

        // MODAL SUBMIT (ABILITY)
        else if (interaction.isModalSubmit() && interaction.customId === 'preset_ability_modal') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });
            const text = interaction.fields.getTextInputValue('ability_text');
            const target = interaction.fields.getTextInputValue('ability_target') || null;
            const details = { text, target };

            if (session.type === 'night') {
                await presetDb.addNightPreset(userId, interaction.user.displayName, 'ABILITY', session.category, details);
                activePresetSessions.delete(userId);
                await interaction.reply({ content: `✅ **Preset notturno salvato!**\n📝 Abilità: ${text}` + (target ? `\n🎯 Target: ${target}` : ''), ephemeral: false });
            } else if (session.type === 'day') {
                await presetDb.addDayPreset(userId, interaction.user.displayName, 'ABILITY', session.category, details);
                activePresetSessions.delete(userId);
                await interaction.reply({ content: `✅ **Preset diurno salvato!**\n📝 Abilità: ${text}` + (target ? `\n🎯 Target: ${target}` : ''), ephemeral: false });
            } else if (session.type === 'timer') {
                await presetDb.addScheduledPreset(userId, interaction.user.displayName, 'ABILITY', session.category, details, session.triggerTime);
                activePresetSessions.delete(userId);
                await interaction.reply({ content: `✅ **Preset timer salvato!**\n⏰ Orario: ${session.triggerTime}\n📝 Abilità: ${text}` + (target ? `\n🎯 Target: ${target}` : ''), ephemeral: false });
            }
        }

        // MODAL SUBMIT (TIME)
        else if (interaction.isModalSubmit() && interaction.customId === 'preset_time_modal') {
            const time = interaction.fields.getTextInputValue('trigger_time');
            if (!/^\d{2}:\d{2}$/.test(time)) return interaction.reply({ content: '❌ Formato orario non valido. Usa HH:MM.', ephemeral: true });

            const select = new StringSelectMenuBuilder()
                .setCustomId('preset_category_select')
                .setPlaceholder('Seleziona categoria...')
                .addOptions(CATEGORIES.map(c => new StringSelectMenuOptionBuilder().setLabel(c.label).setValue(c.value).setEmoji(c.emoji)));

            activePresetSessions.set(userId, { type: 'timer', triggerTime: time });
            await interaction.reply({ content: `⏰ **Step 2: Orario impostato - ${time}**\n📂 **Seleziona categoria:**`, components: [new ActionRowBuilder().addComponents(select)], ephemeral: false });
        }

        // LIST SELECT (DELETE)
        else if (interaction.isStringSelectMenu() && interaction.customId === 'preset_list_select') {
            const [source, id] = interaction.values[0].split('_');
            let deleted = null;
            if (source === 'night') deleted = await presetDb.removeNightPreset(id);
            else if (source === 'day') deleted = await presetDb.removeDayPreset(id);
            else if (source === 'scheduled') deleted = await presetDb.removeScheduledPreset(id);

            if (deleted) {
                await interaction.update({ content: '✅ **Preset rimosso!**', components: [] });
            } else {
                await interaction.update({ content: '❌ Preset non trovato.', components: [] });
            }
        }
    });
}

// ==========================================
// 🎮 COMMAND HANDLER
// ==========================================
async function handlePresetCommand(message, args) {
    const cmd = args[0]?.toLowerCase();

    if (cmd === 'notturno' || cmd === 'notte') {
        const select = new StringSelectMenuBuilder()
            .setCustomId('preset_category_select')
            .setPlaceholder('Seleziona categoria...')
            .addOptions(CATEGORIES.map(c => new StringSelectMenuOptionBuilder().setLabel(c.label).setValue(c.value).setEmoji(c.emoji)));

        activePresetSessions.set(message.author.id, { type: 'night' });
        await message.reply({ content: '🌙 **Step 1: Preset NOTTURNO**\n📂 **Seleziona categoria:**', components: [new ActionRowBuilder().addComponents(select)] });
    }

    else if (cmd === 'diurno' || cmd === 'giorno') {
        const select = new StringSelectMenuBuilder()
            .setCustomId('preset_category_select')
            .setPlaceholder('Seleziona categoria...')
            .addOptions(CATEGORIES.map(c => new StringSelectMenuOptionBuilder().setLabel(c.label).setValue(c.value).setEmoji(c.emoji)));

        activePresetSessions.set(message.author.id, { type: 'day' });
        await message.reply({ content: '☀️ **Step 1: Preset DIURNO**\n📂 **Seleziona categoria:**', components: [new ActionRowBuilder().addComponents(select)] });
    }

    else if (cmd === 'timer' || cmd === 'orario') {
        const modal = new ModalBuilder()
            .setCustomId('preset_time_modal')
            .setTitle('Preset Timer - Imposta Orario')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('trigger_time').setLabel('Orario (HH:MM)').setStyle(TextInputStyle.Short).setPlaceholder('Es: 14:30').setRequired(true)
                )
            );

        await message.reply({ content: '⏰ Apri il modal per impostare l\'orario...' });
        
        const filter = i => i.user.id === message.author.id && i.customId === 'preset_time_modal';
        const collector = message.channel.createMessageComponentCollector({ filter, time: 60000 });
        
        collector.on('collect', async i => {
            await i.showModal(modal);
        });
    }

    else if (cmd === 'lista' || cmd === 'list') {
        await showUserPresets(message);
    }

    else if (cmd === 'dashboard' || cmd === 'dash') {
        await showAdminDashboard(message);
    }

    else {
        await message.reply('❓ **Comandi disponibili:**\n`!preset notturno/notte` - Preset fase notturna\n`!preset diurno/giorno` - Preset fase diurna\n`!preset timer` - Preset con orario specifico\n`!preset lista` - I tuoi preset\n`!preset dashboard` - Dashboard admin');
    }
}

// ==========================================
// ⚙️ PHASE RESOLVERS
// ==========================================
async function resolveNightPhase() {
    const presets = await presetDb.getAllNightPresets();
    if (presets.length > 0) {
        await processAndClearPresets(presets, 'Night');
    }
}

async function resolveDayPhase() {
    const presets = await presetDb.getAllDayPresets();
    if (presets.length > 0) {
        await processAndClearPresets(presets, 'Day');
    }
}

async function resolveScheduledPhase(triggerTime) {
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

// 🔥 MODIFICATO: Controllo visite disponibili prima dell'esecuzione
async function processAndClearPresets(presets, contextLabel) {
    if (presets.length === 0) return;

    const fuochiPresets = presets.filter(p => p.type === 'SHOP' && p.details.subType === 'fuochi');
    const otherPresets = presets.filter(p => !(p.type === 'SHOP' && p.details.subType === 'fuochi'));

    const sorted = otherPresets.sort((a, b) => {
        const pA = PRIORITY_ORDER[a.category] || 999;
        const pB = PRIORITY_ORDER[b.category] || 999;
        if (pA !== pB) return pA - pB;
        return new Date(a.timestamp) - new Date(b.timestamp);
    });

    let delayCounter = 0;
    let processedCount = 0;
    let skippedCount = 0;

    // Processo prima tutti gli altri preset
    for (const preset of sorted) {
        // 🔥 CONTROLLO: Verifica se ha visite disponibili per qualsiasi tipo di KNOCK
        if (preset.type === 'KNOCK') {
            const visitInfo = await db.housing.getVisitInfo(preset.userId);
            
            if (!visitInfo) {
                console.log(`⚠️ [Preset] ${preset.userName} - Impossibile recuperare info visite, preset SALTATO`);
                skippedCount++;
                continue;
            }

            // Controllo visita normale
            if (preset.details.mode === 'mode_normal') {
                if (visitInfo.totalLimit <= 0) {
                    console.log(`⚠️ [Preset] ${preset.userName} - Nessuna visita base disponibile (base: ${visitInfo.base}, extra: ${visitInfo.extra}), preset SALTATO`);
                    skippedCount++;
                    continue;
                }
            }

            // Controllo visita forzata
            if (preset.details.mode === 'mode_forced') {
                if (visitInfo.forced <= 0) {
                    console.log(`⚠️ [Preset] ${preset.userName} - Nessuna visita forzata disponibile (${visitInfo.forced}), preset SALTATO`);
                    skippedCount++;
                    continue;
                }
            }

            // Controllo visita nascosta
            if (preset.details.mode === 'mode_hidden') {
                if (visitInfo.hidden <= 0) {
                    console.log(`⚠️ [Preset] ${preset.userName} - Nessuna visita nascosta disponibile (${visitInfo.hidden}), preset SALTATO`);
                    skippedCount++;
                    continue;
                }
            }
        }

        const queueItem = {
            type: preset.type,
            userId: preset.userId,
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
    const fuochiDelay = (delayCounter * 200) + 3000;
    
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

    console.log(`✅ [Preset] ${processedCount} preset aggiunti alla coda per ${contextLabel}${skippedCount > 0 ? ` (${skippedCount} saltati per mancanza visite)` : ''}`);
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
    const deadIds = (await db.moderation.getMarkedForDeath()).map(m => m.userId);
    return aliveRole.members.filter(m => m.id !== excludeId && !m.user.bot && !deadIds.includes(m.id))
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
