// ==========================================
// 🔄 CHANNEL REFRESH SYSTEM
// Sistema per forzare Discord client a ricaricare la cronologia messaggi
// ==========================================

/**
 * PROBLEMA:
 * Quando un canale passa da ViewChannel:false a ViewChannel:true,
 * il client Discord non carica automaticamente i messaggi scritti mentre
 * il canale era nascosto, anche se ReadMessageHistory:true è impostato.
 * 
 * SOLUZIONE:
 * Usiamo un "ping fantasma" - un messaggio che viene immediatamente cancellato
 * ma che forza il client Discord a sincronizzare completamente il canale,
 * caricando TUTTA la cronologia messaggi.
 */

const { EmbedBuilder } = require('discord.js');

/**
 * Forza il client Discord a ricaricare la cronologia di un canale
 * inviando un messaggio temporaneo che viene subito cancellato.
 * 
 * COME FUNZIONA:
 * 1. Invia un embed invisibile (colore nero, contenuto minimo)
 * 2. Il client riceve la notifica del nuovo messaggio
 * 3. Discord sincronizza il canale per mostrare il messaggio
 * 4. Durante la sync, carica TUTTA la cronologia
 * 5. Cancelliamo il messaggio prima che l'utente lo veda
 * 
 * @param {TextChannel} channel - Il canale da rinfrescare
 * @param {GuildMember} member - Il membro per cui rinfrescare (opzionale, per logging)
 * @returns {Promise<boolean>} - True se riuscito
 */
async function forceChannelRefresh(channel, member = null) {
    if (!channel || !channel.send) {
        console.error('❌ [ChannelRefresh] Canale non valido');
        return false;
    }

    try {
        const memberName = member ? member.displayName : 'Unknown';
        console.log(`🔄 [ChannelRefresh] Forzando refresh per ${memberName} in ${channel.name}`);

        // Strategia 1: Messaggio fantasma invisibile
        const ghostMessage = await channel.send({
            content: '⠀', // Carattere unicode invisibile (Braille blank)
            embeds: [
                new EmbedBuilder()
                    .setDescription('⠀') // Invisibile
                    .setColor(0x2b2d31) // Colore dello sfondo Discord (quasi invisibile)
            ]
        });

        // Attendi un momento per permettere al client di ricevere la notifica
        await new Promise(resolve => setTimeout(resolve, 150));

        // Cancella il messaggio fantasma
        await ghostMessage.delete().catch(() => {});

        console.log(`✅ [ChannelRefresh] Refresh completato per ${memberName} in ${channel.name}`);
        return true;

    } catch (error) {
        console.error(`❌ [ChannelRefresh] Errore refresh ${channel.name}:`, error.message);
        return false;
    }
}

/**
 * Forza il refresh con strategia multipla (fallback)
 * Se il primo metodo fallisce, prova con metodi alternativi.
 * 
 * @param {TextChannel} channel - Il canale da rinfrescare
 * @param {GuildMember} member - Il membro (opzionale)
 * @returns {Promise<boolean>}
 */
async function forceChannelRefreshRobust(channel, member = null) {
    try {
        // METODO 1: Messaggio fantasma (default)
        const success1 = await forceChannelRefresh(channel, member);
        if (success1) return true;

        console.log(`🔄 [ChannelRefresh] Metodo 1 fallito, provo metodo 2`);

        // METODO 2: Edit di un messaggio di sistema (se esiste)
        // Questo causa una sync del canale senza inviare un nuovo messaggio
        try {
            const messages = await channel.messages.fetch({ limit: 10 });
            const systemMsg = messages.find(m => m.author.id === channel.client.user.id && m.embeds.length > 0);
            
            if (systemMsg && systemMsg.editable) {
                // Edit minimale che non cambia visivamente nulla
                await systemMsg.edit({ embeds: systemMsg.embeds });
                console.log(`✅ [ChannelRefresh] Metodo 2 riuscito (edit messaggio esistente)`);
                return true;
            }
        } catch (err) {
            console.log(`⚠️ [ChannelRefresh] Metodo 2 fallito:`, err.message);
        }

        // METODO 3: Typing indicator
        // Discord sincronizza quando vede che qualcuno sta scrivendo
        await channel.sendTyping();
        await new Promise(resolve => setTimeout(resolve, 200));
        console.log(`✅ [ChannelRefresh] Metodo 3 completato (typing indicator)`);
        return true;

    } catch (error) {
        console.error(`❌ [ChannelRefresh] Tutti i metodi falliti:`, error.message);
        return false;
    }
}

/**
 * Versione speciale per quando un giocatore torna a casa.
 * Combina il refresh con un messaggio di benvenuto opzionale.
 * 
 * @param {TextChannel} channel - Canale casa
 * @param {GuildMember} member - Giocatore che torna
 * @param {Object} options - Opzioni
 * @param {boolean} options.showWelcome - Mostra messaggio di benvenuto (default: false)
 * @param {number} options.unreadCount - Numero di messaggi non letti (opzionale)
 */
async function refreshOnReturn(channel, member, options = {}) {
    const { showWelcome = false, unreadCount = 0 } = options;

    try {
        console.log(`🏠 [ChannelRefresh] Refresh per ritorno a casa di ${member.displayName}`);

        // Prima forza il refresh del canale
        await forceChannelRefreshRobust(channel, member);

        // Piccola pausa per assicurare che il refresh sia completato
        await new Promise(resolve => setTimeout(resolve, 300));

        // Se richiesto, mostra un messaggio di benvenuto con info sui messaggi persi
        if (showWelcome && unreadCount > 0) {
            const welcomeMsg = await channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setDescription(`🏠 **Bentornato ${member}!**\n📬 Hai **${unreadCount}** messaggi non letti.`)
                        .setColor('Green')
                        .setTimestamp()
                ]
            });

            // Cancella il messaggio dopo 5 secondi
            setTimeout(() => {
                welcomeMsg.delete().catch(() => {});
            }, 5000);
        }

        console.log(`✅ [ChannelRefresh] Refresh ritorno completato per ${member.displayName}`);
        return true;

    } catch (error) {
        console.error(`❌ [ChannelRefresh] Errore refresh ritorno:`, error.message);
        return false;
    }
}

/**
 * Conta i messaggi non letti in un canale da un certo timestamp
 * Utile per dire all'utente quanti messaggi ha perso
 * 
 * @param {TextChannel} channel - Il canale
 * @param {Date} since - Data da cui contare
 * @returns {Promise<number>} - Numero di messaggi
 */
async function countUnreadMessages(channel, since) {
    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const unread = messages.filter(m => m.createdAt > since && !m.author.bot);
        return unread.size;
    } catch (error) {
        console.error(`❌ [ChannelRefresh] Errore conteggio messaggi:`, error.message);
        return 0;
    }
}

module.exports = {
    forceChannelRefresh,
    forceChannelRefreshRobust,
    refreshOnReturn,
    countUnreadMessages
};
