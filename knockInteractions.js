// ==========================================
// 🚪 KNOCK INTERACTIONS
// Gestisce tutti i menu di selezione per !bussa
// ==========================================
const {
    ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField
} = require('discord.js');
const { HOUSING, RUOLI_PERMESSI } = require('./config');
const db = require('./db');
const eventBus = require('./eventBus');
const { formatName, getOccupants } = require('./helpers');
const { enterHouse } = require('./playerMovement');

module.exports = function registerKnockInteractions(client) {

    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

        // ===================== BOTTONE CHIUDI =====================
        if (interaction.customId === 'knock_close') {
            if (!interaction.message.content.includes(interaction.user.id))
                return interaction.reply({ content: "Non è tuo.", ephemeral: true });
            await db.housing.removePendingKnock(interaction.user.id);
            await interaction.message.delete().catch(() => {});
        }

        // ===================== BOTTONE INDIETRO → MODALITÀ =====================
        else if (interaction.customId === 'knock_back_to_mode') {
            const isPending = await db.housing.isPendingKnock(interaction.user.id);
            if (!isPending) return interaction.reply({ content: "Non è tuo.", ephemeral: true });

            await interaction.update({
                content: `🎭 **${interaction.user}, scegli la modalità di visita:**`,
                components: [buildModeRow(), buildCloseRow()]
            });
        }

        // ===================== BOTTONE INDIETRO → PAGINE =====================
        else if (interaction.customId.startsWith('knock_back_to_pages_')) {
            const isPending = await db.housing.isPendingKnock(interaction.user.id);
            if (!isPending) return interaction.reply({ content: "Non è tuo.", ephemeral: true });

            const mode = interaction.customId.replace('knock_back_to_pages_', '');
            const { components, content } = buildPageSelect(interaction.guild, mode);
            await interaction.update({ content, components });
        }

        // ===================== SELEZIONE MODALITÀ =====================
        else if (interaction.customId === 'knock_mode_select') {
            if (!interaction.message.content.includes(interaction.user.id))
                return interaction.reply({ content: "Non è tuo.", ephemeral: true });

            const selectedMode = interaction.values[0];
            const { components, content } = buildPageSelect(interaction.guild, selectedMode);
            await interaction.update({ content, components });
        }

        // ===================== SELEZIONE PAGINA =====================
        else if (interaction.customId === 'knock_page_select') {
            const parts = interaction.values[0].split('_');
            const pageIndex = parseInt(parts[1]);
            const mode = parts.slice(2).join('_');

            const tutteLeCase = getSortedHouses(interaction.guild);
            const PAGE_SIZE = 25;
            const casePagina = [...tutteLeCase.values()].slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);

            if (casePagina.length === 0)
                return interaction.reply({ content: "❌ Nessuna casa in questa pagina.", ephemeral: true });

            const myHomeId = await db.housing.getHome(interaction.user.id);
            const destroyed = await db.housing.getDestroyedHouses();

            const houseOptions = casePagina
                .filter(ch => {
                    if (ch.id === myHomeId) return false;
                    if (destroyed.includes(ch.id)) return false;
                    // Controlla se ha REALMENTE accesso ViewChannel (previene ghost overwrites)
                    const ow = ch.permissionOverwrites.cache.get(interaction.user.id);
                    if (!ow) return true;
                    return !ow.allow.has(PermissionsBitField.Flags.ViewChannel);
                })
                .map(ch => new StringSelectMenuOptionBuilder()
                    .setLabel(formatName(ch.name))
                    .setValue(`${ch.id}_${mode}`)
                    .setEmoji('🏠')
                );

            if (houseOptions.length === 0)
                return interaction.reply({ content: "❌ Nessuna casa disponibile.", ephemeral: true });

            const selectHouse = new StringSelectMenuBuilder()
                .setCustomId('knock_house_select')
                .setPlaceholder('Scegli la casa specifica...')
                .addOptions(houseOptions);

            const backBtn = new ButtonBuilder()
                .setCustomId(`knock_back_to_pages_${mode}`)
                .setLabel('Indietro').setStyle(ButtonStyle.Secondary).setEmoji('◀️');

            await interaction.update({
                content: `🏘️ **Pagina ${pageIndex + 1}: Scegli dove bussare:**`,
                components: [
                    new ActionRowBuilder().addComponents(selectHouse),
                    new ActionRowBuilder().addComponents(backBtn),
                ]
            });
        }

        // ===================== SELEZIONE CASA =====================
        else if (interaction.customId === 'knock_house_select') {
            const parts = interaction.values[0].split('_');
            const targetChannelId = parts[0];
            const mode = parts[1] + '_' + parts[2];
            const knocker = interaction.member;

            // Anti-double
            const alreadyInQueue = await db.queue.getUserPending(knocker.id);
            if (alreadyInQueue) {
                await db.housing.removePendingKnock(knocker.id);
                return interaction.reply({
                    content: `⚠️ Hai già un'azione in corso! Usa \`!rimuovi\` per annullarla.`,
                    ephemeral: true
                });
            }

            // Controllo visite
            const info = await db.housing.getVisitInfo(knocker.id);
            if (!info) return interaction.reply({ content: "❌ Errore dati.", ephemeral: true });

            if (mode === 'mode_forced') {
                if (info.forced <= 0) return interaction.reply({ content: "⛔ Finite forzate.", ephemeral: true });
                await db.housing.decrementForced(knocker.id);
            } else if (mode === 'mode_hidden') {
                if (info.hidden <= 0) return interaction.reply({ content: "⛔ Finite nascoste.", ephemeral: true });
                await db.housing.decrementHidden(knocker.id);
            } else {
                if (info.used >= info.totalLimit) return interaction.reply({ content: "⛔ Visite finite!", ephemeral: true });
                await db.housing.incrementVisit(knocker.id);
            }

            // Pulisci menu e pending
            await Promise.all([
                interaction.message.delete().catch(() => {}),
                db.housing.removePendingKnock(knocker.id),
            ]);

            // Aggiungi alla coda
            eventBus.emit('queue:add', {
                type: 'KNOCK',
                userId: knocker.id,
                details: { targetChannelId, mode, fromChannelId: interaction.channel.id }
            });
            await interaction.reply({ content: "⏳ **Azione Bussa** messa in coda. Attendi...", ephemeral: true });
        }

        // ===================== MENU RIMUOVI =====================
        else if (interaction.customId === 'remove_action_select') {
            const action = interaction.values[0];

            if (action === 'remove_selecting') {
                await db.housing.removePendingKnock(interaction.user.id);
                await interaction.update({ content: '✅ Selezione casa annullata!', components: [] });
                setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
            }
            else if (action === 'remove_knock') {
                const removed = await db.queue.removeUserPending(interaction.user.id, 'KNOCK');
                if (removed) {
                    eventBus.emit('queue:process');
                    await interaction.update({ content: '✅ Bussa rimosso dalla coda!', components: [] });
                } else {
                    await interaction.update({ content: '❌ Errore nella rimozione.', components: [] });
                }
                setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
            }
            else if (action === 'remove_return') {
                const removed = await db.queue.removeUserPending(interaction.user.id, 'RETURN');
                if (removed) {
                    eventBus.emit('queue:process');
                    await interaction.update({ content: '✅ Torna rimosso dalla coda!', components: [] });
                } else {
                    await interaction.update({ content: '❌ Errore nella rimozione.', components: [] });
                }
                setTimeout(() => interaction.message.delete().catch(() => {}), 3000);
            }
            else if (action === 'remove_ability') {
                const removed = await db.queue.removeUserPending(interaction.user.id, 'ABILITY');
                if (removed && removed.details?.mongoId) {
                    await db.ability.updateStatus(removed.details.mongoId, 'CANCELLED');
                }
                if (removed) {
                    eventBus.emit('queue:process');
                    await interaction.update({ content: '✅ Abilità rimossa dalla coda!', components: [] });
                } else {
                    await interaction.update({ content: '❌ Errore nella rimozione.', components: [] });
                }
                setTimeout(() => interaction.message.delete().catch(() => {}), 5000);
            }
        }
    });
};

// ==========================================
// 🛠️ HELPER BUILDERS
// ==========================================
function buildModeRow() {
    const select = new StringSelectMenuBuilder()
        .setCustomId('knock_mode_select')
        .setPlaceholder('Come vuoi entrare?')
        .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('Visita Normale').setValue('mode_normal').setEmoji('👋'),
            new StringSelectMenuOptionBuilder().setLabel('Visita Forzata').setValue('mode_forced').setEmoji('🧨'),
            new StringSelectMenuOptionBuilder().setLabel('Visita Nascosta').setValue('mode_hidden').setEmoji('🕵️'),
        );
    return new ActionRowBuilder().addComponents(select);
}

function buildCloseRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('knock_close').setLabel('Chiudi').setStyle(ButtonStyle.Danger).setEmoji('❌')
    );
}

function getSortedHouses(guild) {
    // Ordino le case per numero estratto dal nome, così rimangono sempre fisse nelle loro posizioni
    const houses = guild.channels.cache
        .filter(c => c.parentId === HOUSING.CATEGORIA_CASE && c.type === ChannelType.GuildText);
    
    return new Map(
        Array.from(houses.values())
            .map(ch => {
                const match = ch.name.match(/casa-(\d+)/);
                const number = match ? parseInt(match[1]) : 999999;
                return { ch, number };
            })
            .sort((a, b) => a.number - b.number)
            .map(({ ch }) => [ch.id, ch])
    );
}

function buildPageSelect(guild, mode) {
    const tutteLeCase = getSortedHouses(guild);
    const PAGE_SIZE = 25;
    const totalPages = Math.ceil(tutteLeCase.size / PAGE_SIZE);
    const pageOptions = [];

    for (let i = 0; i < totalPages; i++) {
        const start = i * PAGE_SIZE + 1;
        const end = Math.min((i + 1) * PAGE_SIZE, tutteLeCase.size);
        pageOptions.push(new StringSelectMenuOptionBuilder()
            .setLabel(`Case ${start} - ${end}`)
            .setValue(`page_${i}_${mode}`)
            .setEmoji('🏘️')
        );
    }

    const select = new StringSelectMenuBuilder().setCustomId('knock_page_select').addOptions(pageOptions);
    const backBtn = new ButtonBuilder()
        .setCustomId('knock_back_to_mode').setLabel('Indietro').setStyle(ButtonStyle.Secondary).setEmoji('◀️');

    return {
        content: `🏘️ **Modalità scelta**. Seleziona zona:`,
        components: [
            new ActionRowBuilder().addComponents(select),
            new ActionRowBuilder().addComponents(backBtn),
        ]
    };
}
