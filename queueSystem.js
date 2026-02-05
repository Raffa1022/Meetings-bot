// Sostituisci le funzioni updateDashboard, processQueue e l'init in queueSystem.js

async function updateDashboard() {
    const channel = clientRef.channels.cache.get(ID_CANALE_LOG);
    if (!channel) return;

    const queue = await QueueModel.find({ status: 'PENDING' }).sort({ timestamp: 1 });

    let description = queue.length === 0 ? "✅ **Nessun comando in attesa.**" : "";

    queue.forEach((item, index) => {
        const time = `<t:${Math.floor(new Date(item.timestamp).getTime() / 1000)}:T>`;
        let icon = item.type === 'ABILITY' ? "✨" : (item.type === 'RETURN' ? "🏠" : "✊");
        let cmdName = item.type;

        const pointer = index === 0 ? "👉 **IN ATTESA DI APPROVAZIONE:**" : `**#${index + 1}**`;
        description += `${pointer} ${icon} \`${cmdName}\` - <@${item.userId}> (${time})\n`;
    });

    const embed = new EmbedBuilder()
        .setTitle("📋 Dashboard Coda Cronologica")
        .setColor(queue.length > 0 ? 'Orange' : 'Green')
        .setDescription(description)
        .setFooter({ text: "Approvazione manuale richiesta per ogni azione" })
        .setTimestamp();

    let components = [];
    let contentText = null;

    if (queue.length > 0) {
        contentText = `<@&${ID_RUOLO_ADMIN}> 🔔 Nuova azione da gestire!`;
        
        // Aggiungiamo i bottoni per QUALSIASI tipo di azione in cima alla coda
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`q_approve_${queue[0]._id}`).setLabel('Approva ed Esegui').setStyle(ButtonStyle.Success).setEmoji('✅'),
            new ButtonBuilder().setCustomId(`q_reject_${queue[0]._id}`).setLabel('Rifiuta e Rimuovi').setStyle(ButtonStyle.Danger).setEmoji('❌')
        );
        components.push(row);

        // Dettagli dinamici nell'embed
        if (queue[0].type === 'ABILITY') {
            embed.addFields({ name: '📜 Dettaglio Abilità', value: queue[0].details.text || "Nessun testo" });
        } else if (queue[0].type === 'KNOCK') {
            embed.addFields({ name: '🚪 Destinazione Bussa', value: `<#${queue[0].details.targetChannelId}>` });
        }
    }

    try {
        const messages = await channel.messages.fetch({ limit: 5 });
        const botMsgs = messages.filter(m => m.author.id === clientRef.user.id);
        if (botMsgs.size > 0) await channel.bulkDelete(botMsgs).catch(() => {});
    } catch(e) {}

    await channel.send({ content: contentText, embeds: [embed], components: components });
}

async function processQueue() {
    // Ora processQueue si limita ad aggiornare la grafica. 
    // L'esecuzione vera avviene nell'interactionCreate sotto.
    await updateDashboard();
}

// Nel metodo init, modifichiamo il gestore dei bottoni:
// Cerca la sezione client.on('interactionCreate', ...) dentro module.exports.init
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton() || !interaction.customId.startsWith('q_')) return;

    const [prefix, action, itemId] = interaction.customId.split('_');
    const item = await QueueModel.findById(itemId);
    
    if (!item) return interaction.reply({ content: "❌ Azione non trovata o già gestita.", ephemeral: true });

    if (action === 'approve') {
        // Se è Housing, eseguiamo il movimento reale
        if (item.type === 'RETURN' || item.type === 'KNOCK') {
            if (housingExecutor) {
                await housingExecutor(item);
            }
        }
        // Se è Ability, non facciamo nulla (l'admin narra manualmente dopo aver approvato)
        await QueueModel.findByIdAndDelete(itemId);
        await interaction.reply({ content: `✅ Azione di <@${item.userId}> APPROVATA ed eseguita.`, ephemeral: true });
    } else {
        await QueueModel.findByIdAndDelete(itemId);
        await interaction.reply({ content: `❌ Azione di <@${item.userId}> RIFIUTATA.`, ephemeral: true });
    }
    
    processQueue(); // Aggiorna la lista per il prossimo utente
});
