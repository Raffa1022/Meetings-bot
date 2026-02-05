const { 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');

// ==========================================
// ⚙️ CONFIGURAZIONE ABILITÀ
// ==========================================
const ID_CHAT_PRIVATA_CAT = '1460741414357827747'; // Categoria chat private
const ID_RUOLO_ABILITA = '1460741403331268661'; // Ruolo che può usare !abilità

let AbilityModel = null;
let QueueSystem = null;

module.exports = async (client, Model, QueueSys) => {
    AbilityModel = Model;
    QueueSystem = QueueSys;
    console.log("✨ [Ability] Sistema caricato (integrato con Queue).");

    // ==========================================
    // 1️⃣ COMANDO !abilità
    // ==========================================
    client.on('messageCreate', async message => {
        if (message.author.bot) return;
        if (message.content !== '!abilità') return;

        // Controllo Canale
        if (message.channel.id !== ID_CHAT_PRIVATA_CAT && 
            message.channel.parentId !== ID_CHAT_PRIVATA_CAT) {
            return;
        }

        // Controllo Ruolo
        if (!message.member.roles.cache.has(ID_RUOLO_ABILITA)) {
            return message.reply("⛔ Non possiedi l'abilità necessaria per usare questo comando.");
        }

        // Bottone per aprire il modal
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

    // ==========================================
    // 2️⃣ GESTIONE INTERAZIONI
    // ==========================================
    client.on('interactionCreate', async interaction => {
        
        // --- APERTURA MODAL ---
        if (interaction.isButton() && interaction.customId === 'btn_open_ability') {
            if (!interaction.member.roles.cache.has(ID_RUOLO_ABILITA)) {
                return interaction.reply({ 
                    content: "⛔ Non hai il ruolo necessario.", 
                    ephemeral: true 
                });
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

        // --- RICEZIONE DATI DAL MODAL ---
        if (interaction.isModalSubmit() && interaction.customId === 'modal_ability_submit') {
            const text = interaction.fields.getTextInputValue('input_ability_text');
            
            // 1. Salva nel DB per storico
            const newAbility = new AbilityModel({
                userId: interaction.user.id,
                content: text,
                status: 'QUEUED'
            });
            await newAbility.save();

            // 2. AGGIUNGI ALLA CODA
            if (QueueSystem) {
                await QueueSystem.add('ABILITY', interaction.user.id, {
                    text: text,
                    mongoId: newAbility._id
                });
                
                await interaction.reply({ 
                    content: "✅ Abilità messa in **Coda Cronologica**. Attendi l'approvazione degli admin.", 
                    ephemeral: true 
                });
            } else {
                console.error("❌ [Ability] QueueSystem non inizializzato!");
                await interaction.reply({ 
                    content: "❌ Errore interno: Sistema Coda non disponibile.", 
                    ephemeral: true 
                });
            }
            
            // Pulizia messaggio bottone
            if (interaction.message) {
                interaction.message.delete().catch(() => {});
            }
        }
    });
};
