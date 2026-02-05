const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const ID_CANALE_LOG = '1465768646906220700';
const ID_RUOLO_ADMIN = '1460741401435181295'; // Ruolo da pingare per le abilità

let QueueModel = null;
let clientRef = null;
let housingExecutor = null; // Funzione per eseguire comandi housing

// Aggiorna il messaggio visibile nel canale log
async function updateDashboard() {
    const channel = clientRef.channels.cache.get(ID_CANALE_LOG);
    if (!channel) return;

    // Prende la coda (i più vecchi prima)
    const queue = await QueueModel.find({ status: 'PENDING' }).sort({ timestamp: 1 });

    let description = queue.length === 0 
        ? "✅ **Nessun comando in attesa.**" 
        : "";

    // Costruisce la lista visiva
    queue.forEach((item, index) => {
        const time = `<t:${Math.floor(new Date(item.timestamp).getTime() / 1000)}:T>`;
        let icon = "";
        let cmdName = "";

        if (item.type === 'ABILITY') { icon = "✨"; cmdName = "ABILITÀ"; }
        else if (item.type === 'RETURN') { icon = "🏠"; cmdName = "TORNA"; }
        else if (item.type === 'KNOCK') { icon = "✊"; cmdName = "BUSSA"; }

        const pointer = index === 0 ? "👉 **IN CORSO:**" : `**#${index + 1}**`;
        description += `${pointer} ${icon} \`${cmdName}\` - <@${item.userId}> (${time})\n`;
    });

    const embed = new EmbedBuilder()
        .setTitle("📋 Coda Azioni Cronologica")
        .setColor(queue.length > 0 && queue[0].type === 'ABILITY' ? 'Yellow' : 'Green')
        .setDescription(description)
        .setFooter({ text: "Housing automatico | Abilità richiede approvazione" })
        .setTimestamp();

    // Se il primo è un'ABILITÀ, aggiungiamo i bottoni per l'Admin
    let components = [];
    let contentText = null;

    if (queue.length > 0) {
        // Se c'è roba in coda, pinga gli admin
        contentText = `<@&${ID_RUOLO_ADMIN}> 🔔 **Nuova richiesta in coda!**`;
        
        if (queue[0].type === 'ABILITY') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`q_approve_${queue[0]._id}`).setLabel('Approva & Esegui').setStyle(ButtonStyle.Success).setEmoji('✅'),
                new ButtonBuilder().setCustomId(`q_reject_${queue[0]._id}`).setLabel('Rifiuta & Rimuovi').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
            );
            components.push(row);
            // Aggiungiamo i dettagli dell'abilità nell'embed per farla leggere all'admin
            embed.addFields({ name: '📜 Dettaglio Abilità', value: queue[0].details.text || "Nessun testo" });
        }
    }

    // Pulisce vecchi messaggi del bot
    try {
        const messages = await channel.messages.fetch({ limit: 5 });
        const botMsgs = messages.filter(m => m.author.id === clientRef.user.id);
        if (botMsgs.size > 0) await channel.bulkDelete(botMsgs);
    } catch(e) {}

    await channel.send({ content: contentText, embeds: [embed], components: components });
}

// Processa la coda
async function processQueue() {
    const queue = await QueueModel.find({ status: 'PENDING' }).sort({ timestamp: 1 });
    
    // Se vuota, aggiorna dashboard e stop
    if (queue.length === 0) return updateDashboard();

    const currentItem = queue[0];

    // 1. SE È UN'ABILITÀ: STOP.
    // Il sistema si ferma e aspetta l'admin.
    if (currentItem.type === 'ABILITY') {
        console.log(`⏸️ [Queue] Bloccato su Abilità di ${currentItem.userId}`);
        return updateDashboard();
    }

    // 2. SE È HOUSING (Torna/Bussa): ESEGUI E PROSEGUI
    if (currentItem.type === 'RETURN' || currentItem.type === 'KNOCK') {
        console.log(`▶️ [Queue] Eseguo ${currentItem.type} di ${currentItem.userId}`);
        
        if (housingExecutor) {
            try {
                // Esegue l'azione (sposta utente o manda messaggio toc-toc)
                await housingExecutor(currentItem);
            } catch (err) {
                console.error("Errore Housing Queue:", err);
            }
        }

        // Rimuove dalla coda
        await QueueModel.findByIdAndDelete(currentItem._id);
        
        // Ricorsione immediata: processa il prossimo
        return processQueue();
    }
}

// Funzione pubblica per aggiungere alla coda
async function addToQueue(type, userId, details) {
    const newItem = new QueueModel({ type, userId, details });
    await newItem.save();
    console.log(`➕ [Queue] Aggiunto ${type}`);
    processQueue(); // Tenta di processare
}

module.exports = {
    init: async (client, Model, executor) => {
        clientRef = client;
        QueueModel = Model;
        housingExecutor = executor;
        
        console.log("🚦 [Queue] Sistema Cronologico Attivo.");
        processQueue(); // Controllo avvio

        // Gestione Click Bottoni Admin (Solo per Abilità)
        client.on('interactionCreate', async interaction => {
            if (!interaction.isButton()) return;
            if (!interaction.customId.startsWith('q_')) return;

            const action = interaction.customId.startsWith('q_approve') ? 'APPROVE' : 'REJECT';
            const itemId = interaction.customId.split('_')[2];

            const item = await QueueModel.findById(itemId);
            if (!item) return interaction.reply({ content: "❌ Già gestita.", ephemeral: true });

            await QueueModel.findByIdAndDelete(itemId);
            
            await interaction.reply({ content: `✅ Richiesta gestita (${action}).`, ephemeral: true });
            processQueue(); // Sblocca la coda e passa al prossimo
        });
    },
    add: addToQueue
};