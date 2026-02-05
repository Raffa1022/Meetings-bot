const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ==========================================
// ⚙️ CONFIGURAZIONE
// ==========================================
const ID_CANALE_LOG = '1465768646906220700'; // Canale dove appare la dashboard
const ID_RUOLO_ADMIN = '1460741401435181295'; // Ruolo da pingare

let QueueModel = null;
let clientRef = null;
let housingExecutor = null; // Funzione che esegue TORNA/BUSSA

// ==========================================
// 📊 DASHBOARD - Aggiorna il messaggio visivo
// ==========================================
async function updateDashboard() {
    const channel = clientRef.channels.cache.get(ID_CANALE_LOG);
    if (!channel) {
        console.error("❌ [Queue] Canale log non trovato!");
        return;
    }

    // Prendi la coda ordinata per timestamp (più vecchi prima)
    const queue = await QueueModel.find({ status: 'PENDING' }).sort({ timestamp: 1 });

    let description = queue.length === 0 
        ? "✅ **Nessuna azione in attesa.**" 
        : "";

    // Costruisci la lista visiva
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

    // Se il primo è un'ABILITÀ, mostra i bottoni
    let components = [];
    let contentText = null;

    if (queue.length > 0) {
        contentText = `<@&${ID_RUOLO_ADMIN}> 🔔 **Nuova richiesta in coda!**`;
        
        if (queue[0].type === 'ABILITY') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`q_approve_${queue[0]._id}`)
                    .setLabel('✅ Approva & Esegui')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`q_reject_${queue[0]._id}`)
                    .setLabel('❌ Rifiuta & Rimuovi')
                    .setStyle(ButtonStyle.Danger)
            );
            components.push(row);
            
            // Mostra il dettaglio dell'abilità
            embed.addFields({ 
                name: '📜 Dettaglio Abilità', 
                value: queue[0].details.text || "Nessun testo" 
            });
        }
    }

    // Pulisci vecchi messaggi del bot
    try {
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMsgs = messages.filter(m => m.author.id === clientRef.user.id);
        if (botMsgs.size > 0) await channel.bulkDelete(botMsgs);
    } catch(e) {
        console.log("⚠️ [Queue] Impossibile pulire vecchi messaggi:", e.message);
    }

    await channel.send({ 
        content: contentText, 
        embeds: [embed], 
        components: components 
    });
}

// ==========================================
// ⚙️ PROCESSORE CODA - Il cuore del sistema
// ==========================================
async function processQueue() {
    console.log("🔄 [Queue] Inizio elaborazione coda...");
    
    const queue = await QueueModel.find({ status: 'PENDING' }).sort({ timestamp: 1 });
    
    // Se vuota, aggiorna solo la dashboard
    if (queue.length === 0) {
        console.log("✅ [Queue] Coda vuota.");
        return updateDashboard();
    }

    const currentItem = queue[0];
    console.log(`📌 [Queue] Primo in coda: ${currentItem.type} di ${currentItem.userId}`);

    // 1️⃣ SE È UN'ABILITÀ: STOP E ATTENDI ADMIN
    if (currentItem.type === 'ABILITY') {
        console.log(`⏸️ [Queue] Abilità in attesa di approvazione. Sistema in pausa.`);
        return updateDashboard();
    }

    // 2️⃣ SE È HOUSING (TORNA/BUSSA): ESEGUI AUTOMATICAMENTE
    if (currentItem.type === 'RETURN' || currentItem.type === 'KNOCK') {
        console.log(`▶️ [Queue] Eseguo ${currentItem.type} per ${currentItem.userId}...`);
        
        if (!housingExecutor) {
            console.error("❌ [Queue] ERRORE: housingExecutor non disponibile!");
            // Rimuovi comunque per non bloccare la coda
            await QueueModel.findByIdAndDelete(currentItem._id);
            return processQueue();
        }

        try {
            // Esegue l'azione (sposta player o invia TOC TOC)
            await housingExecutor(currentItem);
            console.log(`✅ [Queue] ${currentItem.type} completato con successo!`);
        } catch (err) {
            console.error(`❌ [Queue] Errore esecuzione ${currentItem.type}:`, err);
        }

        // Rimuovi dalla coda
        await QueueModel.findByIdAndDelete(currentItem._id);
        console.log(`🗑️ [Queue] ${currentItem.type} rimosso dalla coda.`);
        
        // Piccolo delay per evitare race conditions
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Ricorsione: processa il prossimo
        return processQueue();
    }

    // Se arriviamo qui, c'è qualcosa di strano
    console.warn(`⚠️ [Queue] Tipo sconosciuto: ${currentItem.type}`);
    await QueueModel.findByIdAndDelete(currentItem._id);
    return processQueue();
}

// ==========================================
// ➕ FUNZIONE PUBBLICA: Aggiungi alla coda
// ==========================================
async function addToQueue(type, userId, details = {}) {
    const newItem = new QueueModel({ 
        type, 
        userId, 
        details,
        status: 'PENDING'
    });
    await newItem.save();
    console.log(`➕ [Queue] Aggiunto ${type} per utente ${userId}`);
    
    // Tenta subito di processare
    processQueue();
}

// ==========================================
// 🚀 INIZIALIZZAZIONE
// ==========================================
module.exports = {
    init: async (client, Model, executor) => {
        clientRef = client;
        QueueModel = Model;
        housingExecutor = executor;
        
        console.log("🚦 [Queue] Sistema Cronologico Inizializzato.");
        
        // Verifica che executor sia stato passato
        if (!housingExecutor) {
            console.warn("⚠️ [Queue] ATTENZIONE: housingExecutor non fornito!");
        }
        
        // Avvio controllo coda
        processQueue();

        // ==========================================
        // 🎛️ GESTIONE CLICK BOTTONI ADMIN
        // ==========================================
        client.on('interactionCreate', async interaction => {
            if (!interaction.isButton()) return;
            if (!interaction.customId.startsWith('q_')) return;

            const action = interaction.customId.startsWith('q_approve') ? 'APPROVE' : 'REJECT';
            const itemId = interaction.customId.split('_')[2];

            // Trova l'item in coda
            const item = await QueueModel.findById(itemId);
            if (!item) {
                return interaction.reply({ 
                    content: "❌ Questa richiesta è già stata gestita.", 
                    ephemeral: true 
                });
            }

            console.log(`🎯 [Queue] Admin ${action} abilità di ${item.userId}`);

            // Rimuovi l'abilità dalla coda
            await QueueModel.findByIdAndDelete(itemId);
            
            // Rispondi all'admin
            await interaction.reply({ 
                content: `✅ Abilità ${action === 'APPROVE' ? 'approvata' : 'rifiutata'}. Elaboro le prossime azioni in coda...`, 
                ephemeral: true 
            });
            
            // IMPORTANTE: Riprendi l'elaborazione della coda
            console.log("🔄 [Queue] Riprendo elaborazione dopo decisione admin...");
            processQueue();
        });
    },
    
    // Esporta la funzione per aggiungere alla coda
    add: addToQueue,
    
    // Esporta anche processQueue per eventuali chiamate manuali
    process: processQueue
};

