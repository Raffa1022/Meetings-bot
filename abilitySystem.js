const { 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField 
} = require('discord.js');

// ==========================================
// ⚙️ CONFIGURAZIONE ABILITÀ
// ==========================================
const ID_CHAT_PRIVATA_CAT = '1460741414357827747'; // La categoria/canale dove i player scrivono !abilità
const ID_RUOLO_ABILITA = '1460741403331268661'; // Ruolo che PUÒ usare il comando
const ID_CANALE_ADMIN_LOG = '1465768646906220700'; // Canale dove arrivano le richieste
const ID_RUOLO_ADMIN = '1460741401435181295'; // Ruolo che riceve il ping

let AbilityModel = null;

module.exports = async (client, Model) => {
    AbilityModel = Model;
    console.log("✨ [Ability] Sistema caricato.");

    // 1. COMANDO !abilità
    client.on('messageCreate', async message => {
        if (message.author.bot) return;
        if (message.content !== '!abilità') return;

        // Controllo Canale (Deve essere quello specifico o nella categoria specifica)
        if (message.channel.id !== ID_CHAT_PRIVATA_CAT && message.channel.parentId !== ID_CHAT_PRIVATA_CAT) return;

        // Controllo Ruolo
        if (!message.member.roles.cache.has(ID_RUOLO_ABILITA)) {
            return message.reply("⛔ Non possiedi l'abilità necessaria per usare questo comando.");
        }

        // Invio bottone per aprire la "tendina" (Modal)
        // Discord richiede un click per aprire un form di scrittura
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_open_ability')
                .setLabel('✍️ Scrivi Abilità')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('✨')
        );

        await message.reply({ 
            content: "Clicca qui sotto per descrivere la tua abilità:", 
            components: [row] 
        });
    });

    // 2. GESTIONE INTERAZIONI
    client.on('interactionCreate', async interaction => {
        
        // --- APERTURA MODALE (TENDINA) ---
        if (interaction.isButton() && interaction.customId === 'btn_open_ability') {
            if (!interaction.member.roles.cache.has(ID_RUOLO_ABILITA)) {
                return interaction.reply({ content: "⛔ Non hai il ruolo.", ephemeral: true });
            }

            const modal = new ModalBuilder()
                .setCustomId('modal_ability_submit')
                .setTitle('Attivazione Abilità');

            const inputContent = new TextInputBuilder()
                .setCustomId('input_ability_text')
                .setLabel("Descrizione Azione")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("Scrivi qui cosa vuoi fare...")
                .setRequired(true)
                .setMaxLength(1000);

            const firstActionRow = new ActionRowBuilder().addComponents(inputContent);
            modal.addComponents(firstActionRow);

            await interaction.showModal(modal);
        }

        // --- RICEZIONE DATI DALLA TENDINA ---
        if (interaction.isModalSubmit() && interaction.customId === 'modal_ability_submit') {
            const text = interaction.fields.getTextInputValue('input_ability_text');
            const adminChannel = client.channels.cache.get(ID_CANALE_ADMIN_LOG);

            if (!adminChannel) return interaction.reply({ content: "❌ Errore config: Canale Admin non trovato.", ephemeral: true });

            // Creazione Embed per Admin
            const embed = new EmbedBuilder()
                .setTitle('✨ Nuova Richiesta Abilità')
                .setColor('Purple')
                .setDescription(`**Giocatore:** <@${interaction.user.id}>\n**Azione:**\n${text}`)
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`ability_ok_${interaction.user.id}`).setLabel('Accetta').setStyle(ButtonStyle.Success).setEmoji('✅'),
                new ButtonBuilder().setCustomId(`ability_no_${interaction.user.id}`).setLabel('Rifiuta').setStyle(ButtonStyle.Danger).setEmoji('❌')
            );

            const msg = await adminChannel.send({ 
                content: `<@&${ID_RUOLO_ADMIN}>`, 
                embeds: [embed], 
                components: [row] 
            });

            // Salvataggio su Mongo
            const newAbility = new AbilityModel({
                userId: interaction.user.id,
                content: text,
                status: 'PENDING',
                adminMessageId: msg.id
            });
            await newAbility.save();

            await interaction.reply({ content: "✅ Richiesta inviata agli Admin!", ephemeral: true });
            // Pulizia messaggio bottone utente (opzionale)
            if (interaction.message) interaction.message.delete().catch(() => {});
        }

        // --- GESTIONE BOTTONI ADMIN ---
        if (interaction.isButton() && (interaction.customId.startsWith('ability_ok_') || interaction.customId.startsWith('ability_no_'))) {
            
            const action = interaction.customId.startsWith('ability_ok_') ? 'APPROVE' : 'REJECT';
            const msgId = interaction.message.id;

            // Aggiornamento DB
            const record = await AbilityModel.findOne({ adminMessageId: msgId });
            if (record) {
                record.status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
                await record.save();
            }

            if (action === 'APPROVE') {
                // ✅ CASO ACCETTATO: Cancella messaggio Admin
                await interaction.reply({ content: `✅ Abilità approvata ed eseguita. Log rimosso.`, ephemeral: true });
                await interaction.message.delete().catch(() => {});
            
            } else {
                // ❌ CASO RIFIUTATO: Il messaggio resta lì, ma togliamo i bottoni e lo segniamo rosso
                const oldEmbed = interaction.message.embeds[0];
                const newEmbed = EmbedBuilder.from(oldEmbed)
                    .setColor('Red')
                    .setTitle('❌ Richiesta Rifiutata')
                    .setFooter({ text: `Rifiutata da ${interaction.user.username}` });

                await interaction.update({ embeds: [newEmbed], components: [] });
            }
        }
    });
};