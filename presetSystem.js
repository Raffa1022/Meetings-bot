
// ==========================================
// ⏰ PRESET SYSTEM - Azioni Programmate
// CORRETTO E OTTIMIZZATO (FIX INVENTARIO & ORARIO)
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

// 🔥 LISTA OGGETTI LOCALE (Per evitare bug di dipendenze circolari che rompono l'inventario)
const SHOP_ITEMS_REF = [
    // La scopa è esclusa dalla logica preset come richiesto
    { id: 'lettera',    name: 'Lettera',              emoji: '✉️' },
    { id: 'scarpe',     name: 'Scarpe',               emoji: '👟' },
    { id: 'testamento', name: 'Testamento',           emoji: '📜' },
    { id: 'catene',     name: 'Catene',               emoji: '⛓️' }, // Richiede Target
    { id: 'fuochi',     name: 'Fuochi d\'artificio',  emoji: '🎆' },
    { id: 'tenda',      name: 'Tenda',                emoji: '⛺' },
];

// ==========================================
// 🗄️ STORAGE TEMPORANEO PRESET IN CORSO
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
    { label: 'Oggetti Shop', value: 'SHOP', emoji: '🛒' }, // Apre l'inventario
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
// 📊 DASHBOARD PRESET
// ==========================================
let dashboardChannelId = null;
let clientRef = null;

async function updatePresetDashboard() {
    if (!dashboardChannelId || !clientRef) return;
    
    const channel = clientRef.channels.cache.get(dashboardChannelId);
    if (!channel) return;

    // Recupera i dati
    const nightPresets = await presetDb.getAllNightPresets();
    const scheduledPresets = await presetDb.getAllScheduledPresets();

    const grouped = {};
    
    // Raggruppa Notturni
    for (const preset of nightPresets) {
        const cat = preset.category || 'ALTRO';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({ ...preset, presetType: 'NIGHT' });
    }

    // Raggruppa Programmati
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
                const triggerInfo = preset.presetType === 'SCHEDULED' ? ` (**${preset.triggerTime}**)` : '';
                
                let detailStr = '';
                if (preset.type === 'KNOCK') {
                    const ch = clientRef.channels.cache.get(preset.details.targetChannelId);
                    const chName = ch ? formatName(ch.name) : 'Casa sconosciuta';
                    const modeMap = { 'mode_normal': 'Normale', 'mode_forced': 'Forzata', 'mode_hidden': 'Nascosta' };
                    detailStr = ` → 🏠 ${chName} (${modeMap[preset.details.mode] || 'Standard'})`;
                } else if (preset.type === 'SHOP') {
                    detailStr = ` → 🛒 ${preset.details.itemName}`;
                    if (preset.details.targetUserId) {
                        detailStr += ` su <@${preset.details.targetUserId}>`;
                    }
                } else if (preset.type === 'ABILITY') {
                    // Visualizza categoria e target
                    detailStr = ` → [${preset.category}] ${preset.details.target ? `su ${preset.details.target}` : ''}`;
                }

                description += `${typeEmoji} **${userName}**${detailStr}${triggerInfo}\n`;
            }
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('⏰ Dashboard Preset - Azioni Programmate')
        .setColor(nightPresets.length + scheduledPresets.length > 0 ? 'Orange' : 'Green')
        .setDescription(description)
        .setFooter({ text: 'Le azioni programmate passeranno automaticamente alla Coda (Queue) all\'orario stabilito' })
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
    
    // Validazione rigorosa Orario
    if (presetType === 'scheduled') {
        if (!triggerTime || !/^\d{2}:\d{2}$/.test(triggerTime)) {
             return message.reply("❌ Formato orario non valido. Usa HH:MM (es. 14:30).");
        }
    }

    // Inizializza sessione
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
        : `⏰ Programmato (Esecuzione alle **${triggerTime}**)`;
    
    await message.reply({
        content: `**Creazione Preset ${typeLabel}**\nSeleziona la categoria dell'azione:`,
        components: [row, closeRow]
    });
}

// ==========================================
// 🔧 INTERACTION HANDLERS (LOGICA CORE)
// ==========================================
function registerPresetInteractions(client) {
    clientRef = client;

    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu() && !interaction.isButton() && !interaction.isModalSubmit()) return;

        // Filtra solo ID relativi ai preset
        if (!interaction.customId.startsWith('preset_')) return;

        const userId = interaction.user.id;
        const session = activePresetSessions.get(userId);

        // ===================== CHIUDI =====================
        if (interaction.customId === 'preset_close') {
            activePresetSessions.delete(userId);
            await interaction.update({ content: '❌ Operazione annullata.', components: [] });
            setTimeout(() => interaction.message.delete().catch(() => {}), 2000);
            return;
        }

        // ===================== INDIETRO =====================
        if (interaction.customId === 'preset_back_category') {
             if (!session) return interaction.reply({ content: '❌ Sessione scaduta. Riscrivi il comando.', ephemeral: true });
             
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

        // ===================== SELEZIONE CATEGORIA =====================
        if (interaction.customId === 'preset_category') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta. Riscrivi il comando.', ephemeral: true });

            const category = interaction.values[0];
            session.category = category;

            // --- CASO 1: BUSSA (KNOCK) ---
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
            // --- CASO 2: SHOP (INVENTARIO REALE) ---
            else if (category === 'SHOP') {
                // Recupera inventario dal DB (fix dipendenza circolare usando require dentro la funzione)
                const { econDb } = require('./economySystem');
                const inventory = await econDb.getInventory(userId);
                
                // Mappa gli oggetti posseduti usando la lista locale SHOP_ITEMS_REF
                const validItems = SHOP_ITEMS_REF.filter(item => 
                    inventory[item.id] && inventory[item.id] > 0
                );

                if (validItems.length === 0) {
                    return interaction.update({
                        content: '❌ **Il tuo inventario è vuoto.** (Oppure non hai oggetti compatibili con i preset).\nAcquista qualcosa al mercato prima!',
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
                    content: '🛒 **Step 2: Seleziona l\'oggetto dal tuo inventario:**',
                    components: [new ActionRowBuilder().addComponents(itemSelect), backRow]
                });
            }
            // --- CASO 3: ABILITÀ / ALTRO ---
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

        // ===================== KNOCK: MODALITÀ -> SCELTA CASA =====================
        if (interaction.customId === 'preset_knock_mode') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });

            session.knockMode = interaction.values[0];

            // Recupera case valide (escluse distrutte)
            const houses = await getAvailableHouses(interaction.guild, userId);
            
            if (houses.length === 0) {
                return interaction.update({ content: '❌ Nessuna casa disponibile o visibile.', components: [] });
            }

            const houseSelect = new StringSelectMenuBuilder()
                .setCustomId('preset_house')
                .setPlaceholder('Scegli la casa...')
                .addOptions(houses.slice(0, 25).map(house => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(formatName(house.name))
                        .setValue(house.id)
                        .setEmoji('🏠')
                ));

            const backRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('preset_back_category').setLabel('Ricomincia').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
            );

            await interaction.update({
                content: `🏠 **Step 3: Dove vuoi bussare?** (${session.knockMode === 'mode_forced' ? 'Forzata' : 'Normale'})`,
                components: [new ActionRowBuilder().addComponents(houseSelect), backRow]
            });
        }

        // ===================== KNOCK: SALVATAGGIO =====================
        if (interaction.customId === 'preset_house') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });

            const targetChannelId = interaction.values[0];
            // Questo comando CONSUMERÀ la visita solo all'esecuzione, come richiesto dalla logica preset
            // Ma controlliamo se ne ha teoricamente
            
            const details = {
                targetChannelId,
                mode: session.knockMode,
                fromChannelId: session.channelId
            };

            await savePreset(interaction, session, 'KNOCK', 'KNOCK', details, session.userName);
        }

        // ===================== SHOP: ITEM -> TARGET O SALVA =====================
        if (interaction.customId === 'preset_shop_item') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });

            const itemId = interaction.values[0];
            session.shopItemId = itemId;
            const itemDef = SHOP_ITEMS_REF.find(i => i.id === itemId);

            // Oggetti che richiedono TASSATIVAMENTE un target
            const itemsWithTarget = ['catene', 'lettera']; 

            if (itemsWithTarget.includes(itemId)) {
                // Prendi giocatori vivi
                const aliveMembers = await getAlivePlayers(interaction.guild, userId);
                
                if (aliveMembers.length === 0) {
                    return interaction.update({ content: '❌ Nessun giocatore vivo disponibile come target.', components: [] });
                }

                const playerSelect = new StringSelectMenuBuilder()
                    .setCustomId('preset_item_target')
                    .setPlaceholder(`Scegli il target per ${itemDef.name}...`)
                    .addOptions(aliveMembers.slice(0, 25).map(p => 
                        new StringSelectMenuOptionBuilder().setLabel(p.name).setValue(p.id).setEmoji('👤')
                    ));

                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('preset_back_category').setLabel('Ricomincia').setStyle(ButtonStyle.Secondary).setEmoji('↩️')
                );

                await interaction.update({
                    content: `🎯 **Step 3: Seleziona il target per ${itemDef.emoji} ${itemDef.name}:**`,
                    components: [new ActionRowBuilder().addComponents(playerSelect), backRow]
                });

            } else {
                // Oggetti self-use o area (Tenda, Fuochi, Scarpe)
                const { econDb } = require('./economySystem');
                
                // RIMUOVI ORA DALL'INVENTARIO (come richiesto)
                await econDb.removeItem(userId, itemId, 1);

                const details = {
                    subType: itemId,
                    itemName: itemDef.name,
                    responseChannelId: session.channelId
                };

                await savePreset(interaction, session, 'SHOP', 'SHOP', details, session.userName, 
                    `✅ Oggetto **${itemDef.name}** programmato e rimosso dall'inventario.`);
            }
        }

        // ===================== SHOP: SALVATAGGIO CON TARGET =====================
        if (interaction.customId === 'preset_item_target') {
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });

            const targetUserId = interaction.values[0];
            const itemId = session.shopItemId;
            const itemDef = SHOP_ITEMS_REF.find(i => i.id === itemId);
            const { econDb } = require('./economySystem');

            // RIMUOVI ORA DALL'INVENTARIO
            await econDb.removeItem(userId, itemId, 1);

            const details = {
                subType: itemId,
                itemName: itemDef.name,
                targetUserId: targetUserId,
                responseChannelId: session.channelId
            };

            await savePreset(interaction, session, 'SHOP', 'SHOP', details, session.userName,
                `✅ Oggetto **${itemDef.name}** su <@${targetUserId}> programmato e rimosso dall'inventario.`);
        }

        // ===================== ABILITY: MODAL SUBMIT =====================
        if (interaction.customId.startsWith('preset_modal_')) {
            const category = interaction.customId.split('_')[2];
            if (!session) return interaction.reply({ content: '❌ Sessione scaduta.', ephemeral: true });

            const target = interaction.fields.getTextInputValue('target');
            const description = interaction.fields.getTextInputValue('description');

            const details = {
                target: target || null,
                text: description
            };

            await savePreset(interaction, session, 'ABILITY', category, details, session.userName);
        }

        // ===================== RIMOZIONE DALLA LISTA PRESET =====================
        if (interaction.customId === 'preset_list_select') {
            const presetId = interaction.values[0];
            const [type, id] = presetId.split('_');

            try {
                if (type === 'night') await presetDb.removeNightPreset(id);
                else await presetDb.removeScheduledPreset(id);

                await interaction.update({ content: '✅ Preset rimosso.', components: [] });
                await updatePresetDashboard();
                setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
            } catch (error) {
                console.error(error);
                await interaction.reply({ content: '❌ Errore durante la rimozione.', ephemeral: true });
            }
        }
    });
}

// ==========================================
// 💾 FUNZIONE SALVATAGGIO (GENERICA)
// ==========================================
async function savePreset(interaction, session, type, category, details, userName, customMsg = null) {
    try {
        // Salvataggio su DB
        if (session.presetType === 'night') {
            await presetDb.addNightPreset(interaction.user.id, userName, type, category, details);
        } else {
            await presetDb.addScheduledPreset(interaction.user.id, userName, type, category, details, session.triggerTime);
        }

        activePresetSessions.delete(interaction.user.id);
        await updatePresetDashboard();

        const msg = customMsg || `✅ **Preset Salvato!**\nModalità: ${session.presetType === 'night' ? 'Notturna' : 'Programmata (' + session.triggerTime + ')'}\nCategoria: ${getCategoryLabel(category)}`;
        
        // Risposta sicura (evita interazione fallita)
        if (interaction.isModalSubmit()) {
            await interaction.reply({ content: msg, ephemeral: true });
        } else {
            await interaction.update({ content: msg, components: [] });
        }

        // Auto-delete messaggio di conferma
        if (!interaction.isModalSubmit()) {
            setTimeout(() => interaction.message.delete().catch(() => {}), 5000);
        }

    } catch (error) {
        console.error('Errore SavePreset:', error);
        if (interaction.deferred || interaction.replied) await interaction.followUp({ content: '❌ Errore salvataggio.', ephemeral: true });
        else await interaction.reply({ content: '❌ Errore salvataggio.', ephemeral: true });
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
            if (ch.id === myHomeId) return false; // Non bussare a casa tua
            if (destroyed.includes(ch.id)) return false; // Non bussare a case distrutte
            
            // Verifica permessi ViewChannel
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
        .map(m => ({
            id: m.id,
            name: m.displayName || m.user.username
        }));
}

// ==========================================
// 🚀 LOGICA DI ESECUZIONE (SPOSTAMENTO IN QUEUE)
// ==========================================
function mapPresetToQueue(preset) {
    // 1. KNOCK -> Bussa
    if (preset.type === 'KNOCK') {
        return {
            type: 'KNOCK',
            userId: preset.userId,
            details: preset.details // { targetChannelId, mode, fromChannelId }
        };
    }
    
    // 2. SHOP -> Gestione oggetti (incluso Catene)
    if (preset.type === 'SHOP') {
        return {
            type: 'SHOP',
            userId: preset.userId,
            details: preset.details // { subType, targetUserId, etc }
        };
    }
    
    // 3. ABILITY -> Gestione generica
    if (preset.type === 'ABILITY') {
        return {
            type: 'ABILITY',
            userId: preset.userId,
            details: {
                // Aggiunge la categoria al testo visibile agli admin
                text: `[${getCategoryLabel(preset.category)}] ${preset.details.text}` + (preset.details.target ? ` (Target: ${preset.details.target})` : ''),
                category: preset.category
            }
        };
    }

    return null;
}

// Chiamata da !notte
async function resolveNightPhase() {
    console.log('🌙 [Preset] Risoluzione NOTTURNA...');
    const presets = await presetDb.getAllNightPresets();
    await processAndClearPresets(presets, 'Night');
}

// Chiamata dal Timer
async function resolveScheduledPhase(triggerTime) {
    console.log(`⏰ [Preset] Risoluzione PROGRAMMATA (${triggerTime})...`);
    const presets = await presetDb.getScheduledPresetsAtTime(triggerTime);
    
    if (presets.length > 0) {
        await processAndClearPresets(presets, triggerTime);
        await presetDb.clearScheduledPresets(triggerTime); // Pulisci db specifico
    }
}

async function processAndClearPresets(presets, contextLabel) {
    if (presets.length === 0) return;

    // Ordina per priorità (Shop prima di tutto, poi Roleblock, etc)
    const sorted = presets.sort((a, b) => {
        const pA = PRIORITY_ORDER[a.category] || 999;
        const pB = PRIORITY_ORDER[b.category] || 999;
        if (pA !== pB) return pA - pB;
        return new Date(a.timestamp) - new Date(b.timestamp);
    });

    // Sposta in QUEUE (EventBus)
    for (const preset of sorted) {
        const queueItem = mapPresetToQueue(preset);
        if (queueItem) {
            eventBus.emit('queue:add', queueItem);
            console.log(`➡️ [Preset -> Queue] Spostato ${preset.type} di ${preset.userName}`);
        }
    }

    // Se Notturno, svuota tutto il db notturno
    if (contextLabel === 'Night') {
        await presetDb.clearAllNightPresets();
    }
    
    await updatePresetDashboard();
}

// ==========================================
// 📋 LISTA PRESET UTENTE (Visualizza/Elimina)
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

    // Programmati
    for (const p of scheduled) {
        let label = `⏰ ${p.triggerTime} - ${getCategoryLabel(p.category)}`;
        if (p.type === 'SHOP') label += ` (${p.details.itemName})`;
        options.push(new StringSelectMenuOptionBuilder()
            .setLabel(label.substring(0, 100))
            .setValue(`scheduled_${p._id}`)
            .setDescription(`Programmato alle ${p.triggerTime} - Clicca per rimuovere`)
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
// ⏰ TIMER AUTOMATICO (FIX TIMEZONE ITALIANA)
// ==========================================
function startPresetTimer() {
    setInterval(async () => {
        // CORREZIONE TIMEZONE: Ottieni HH:MM stringa diretta da locale italiano
        const now = new Date();
        const options = { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false };
        const currentTime = now.toLocaleTimeString('it-IT', options).slice(0, 5); // Assicura "14:30"

        // console.log(`DEBUG TIME: ${currentTime}`); // Scommenta se vuoi vedere l'orario in console

        const scheduledPresets = await presetDb.getScheduledPresetsAtTime(currentTime);
        
        if (scheduledPresets.length > 0) {
            console.log(`⏰ [Timer] Trovati ${scheduledPresets.length} preset per ${currentTime}. Esecuzione...`);
            await resolveScheduledPhase(currentTime);
        }
    }, 60000); // Check ogni minuto

    console.log('⏰ [Preset] Timer avviato (Europe/Rome).');
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
