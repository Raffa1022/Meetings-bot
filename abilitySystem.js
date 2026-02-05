const { 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField 
} = require('discord.js');

// ==========================================
// ⚙️ CONFIGURAZIONE ABILITÀ
// ==========================================
const ID_CHAT_PRIVATA_CAT = '1460741414357827747'; // La categoria/canale dove i player scrivono !abilità
const ID_RUOLO_ABILITA = '1460741403331268661'; // Ruolo che PUÒ usare il comando

let AbilityModel = null;
let QueueSystem = null; // Variabile per il sistema coda

module.exports = async (client, Model, QueueSys) => {
    AbilityModel = Model;
    QueueSystem = QueueSys; // Salviamo il riferimento al sistema coda
    console.log("✨ [Ability] Sistema caricato (Mode: Queue).");

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

        // --- RICEZIONE DATI DALLA TENDINA E INVIO ALLA CODA ---
        if (interaction.isModalSubmit() && interaction.customId === 'modal_ability_submit') {
            const text = interaction.fields.getTextInputValue('input_ability_text');
            
            // 1. Salva nel DB Abilità per storico (status QUEUED)
            const newAbility = new AbilityModel({
                userId: interaction.user.id,
                content: text,
                status: 'QUEUED'
            });
            await newAbility.save();

            // 2. AGGIUNGI ALLA CODA (Il cuore del nuovo sistema)
            if (QueueSystem) {
                await QueueSystem.add('ABILITY', interaction.user.id, {
                    text: text, // Il testo che leggerà l'admin nella dashboard
                    mongoId: newAbility._id
                });
                
                await interaction.reply({ content: "✅ Abilità messa in **Coda Cronologica**. Attendi che gli admin la elaborino.", ephemeral: true });
            } else {
                console.error("❌ Errore: QueueSystem non inizializzato in abilitySystem.");
                await interaction.reply({ content: "❌ Errore interno: Sistema Coda non disponibile.", ephemeral: true });
            }
            
            // Cancella il messaggio col bottone originale per pulizia
            if (interaction.message) interaction.message.delete().catch(() => {});
        }
    });
};
