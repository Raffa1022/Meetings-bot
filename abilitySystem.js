
// ==========================================
// ✨ ABILITY SYSTEM
// ==========================================
const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { HOUSING, RUOLI } = require('./config');
const db = require('./db');
const eventBus = require('./eventBus');

module.exports = function initAbilitySystem(client) {
    console.log("✨ [Ability] Sistema caricato.");

    // Comando !abilità
    client.on('messageCreate', async message => {
        if (message.author.bot || message.content !== '!abilità') return;
        if (message.channel.id !== HOUSING.CATEGORIA_CHAT_PRIVATE &&
            message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE) return;
        if (!message.member.roles.cache.has(RUOLI.ABILITA))
            return message.reply("⛔ Non possiedi l'abilità necessaria.");

        // ✅ FIX: BLOCCO LISTA MORTI
        const markedForDeath = await db.moderation.isMarkedForDeath(message.author.id);
        if (markedForDeath) {
            return message.reply("☠️ **Sei nella lista morti!** Non puoi utilizzare comandi del bot fino al processamento.");
        }

        // 🔥 CHECK BLOCCO FASE PRESET
        const isPresetActive = await db.moderation.isPresetPhaseActive();
        if (isPresetActive) {
            return message.reply("⏳ **Ci sono dei preset in corso.** Attendi l'annuncio `!fine preset` per usare le abilità.");
        }

        // Check Roleblock
        const isRB = await db.moderation.isBlockedRB(message.author.id);
        if (isRB) return message.reply("🚫 Sei in **Roleblock**! Non puoi usare !abilità.");

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_open_ability')
                .setLabel('✍️ Scrivi Abilità')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✨')
        );
        await message.reply({ content: "Clicca qui sotto per descrivere la tua abilità:", components: [row] });
    });

    // Interazioni
    client.on('interactionCreate', async interaction => {
        // Apertura modal
        if (interaction.isButton() && interaction.customId === 'btn_open_ability') {
            if (!interaction.member.roles.cache.has(RUOLI.ABILITA))
                return interaction.reply({ content: "⛔ Non hai il ruolo.", ephemeral: true });

            // 🔥 CHECK BLOCCO FASE PRESET ANCHE SUL BOTTONE
            const isPresetActive = await db.moderation.isPresetPhaseActive();
            if (isPresetActive) {
                return interaction.reply({ content: "⏳ **Preset in corso.** Attendi l'annuncio `!fine preset`.", ephemeral: true });
            }

            const isRBBtn = await db.moderation.isBlockedRB(interaction.user.id);
            if (isRBBtn) return interaction.reply({ content: "🚫 Sei in **Roleblock**!", ephemeral: true });

            const modal = new ModalBuilder()
                .setCustomId('modal_ability_submit')
                .setTitle('Attivazione Abilità');

            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('input_ability_text')
                    .setLabel("Descrizione Azione")
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder("Scrivi qui cosa vuoi fare...")
                    .setRequired(true)
                    .setMaxLength(1000)
            ));
            await interaction.showModal(modal);
        }

        // Ricezione modal
        if (interaction.isModalSubmit() && interaction.customId === 'modal_ability_submit') {
            const text = interaction.fields.getTextInputValue('input_ability_text');

            // Salva abilità nel DB
            const newAbility = await db.ability.create(interaction.user.id, text);

            // Aggiungi alla coda
            eventBus.emit('queue:add', {
                type: 'ABILITY',
                userId: interaction.user.id,
                details: { text, mongoId: newAbility._id }
            });

            await interaction.reply({
                content: "✅ Abilità messa in **Coda Cronologica**. Attendi l'approvazione degli admin.",
                ephemeral: true
            });

            if (interaction.message) interaction.message.delete().catch(() => {});
        }
    });
};
