// ==========================================
// 📜 MESSAGE RECAP SYSTEM
// Quando il proprietario torna a casa, il bot fa un fetch LIVE
// dal canale Discord e mostra i messaggi scritti durante l'assenza.
// I messaggi eliminati (scopa) NON appaiono: non esistono più su Discord.
// Il recap va nella CHAT PRIVATA (invisibile agli altri).
// ==========================================
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { HOUSING } = require('./config');
const db = require('./db');
const eventBus = require('./eventBus');

let clientRef = null;

// ==========================================
// 🚀 INIT
// ==========================================
function initMessageRecap(client) {
    clientRef = client;

    // --- Ascolta ritorno a casa ---
    eventBus.on('house:player-returned', async ({ userId, channelId }) => {
        try {
            await handleReturn(userId, channelId);
        } catch (err) {
            console.error('📜 [Recap] Errore handleReturn:', err.message);
        }
    });

    // --- Gestisci bottone Elimina ---
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('recap_dismiss_')) return;

        const targetUserId = interaction.customId.split('recap_dismiss_')[1];
        if (interaction.user.id !== targetUserId) {
            return interaction.reply({ content: '⛔ Solo il proprietario può eliminare questo messaggio.', ephemeral: true });
        }

        await interaction.message.delete().catch(() => {});
    });

    console.log('📜 MessageRecap System: Attivo');
}

// ==========================================
// 🏠 GESTIONE RITORNO
// ==========================================
async function handleReturn(userId, channelId) {
    // Salva timestamp di ritorno
    await db.housing.setReturnTime(userId);

    // Recupera timestamp di uscita
    const times = await db.housing.getDepartureTimes(userId);
    if (!times || !times.departed) return; // Mai uscito, niente da mostrare

    const channel = clientRef.channels.cache.get(channelId);
    if (!channel) return;

    // Fetch messaggi dal canale Discord scritti durante l'assenza
    const messages = await fetchMessagesSince(channel, times.departed, userId);
    if (messages.length === 0) return; // Nessun messaggio, niente recap

    // Trova la chat privata del giocatore
    const privateChannel = findPrivateChannel(channel.guild, userId);
    if (!privateChannel) {
        console.log(`📜 [Recap] Chat privata non trovata per ${userId}`);
        return;
    }

    // Costruisci e invia recap
    await sendRecapToPrivate(privateChannel, channel, messages, userId);
}

// ==========================================
// 📡 FETCH MESSAGGI DAL CANALE DISCORD
// Paginazione completa: legge tutti i messaggi dal più recente
// andando indietro fino al timestamp di uscita.
// I messaggi cancellati (scopa) NON compaiono.
// ==========================================
async function fetchMessagesSince(channel, sinceTimestamp, ownerId = null) {
    const collected = [];
    let beforeId = undefined;

    while (true) {
        const options = { limit: 100 };
        if (beforeId) options.before = beforeId;

        let batch;
        try {
            batch = await channel.messages.fetch(options);
        } catch {
            break;
        }
        if (batch.size === 0) break;

        let reachedStart = false;

        // La Collection è ordinata dal più nuovo al più vecchio
        for (const [, msg] of batch) {
            if (msg.createdTimestamp <= sinceTimestamp) {
                reachedStart = true;
                break;
            }
            collected.push(msg);
        }

        if (reachedStart || batch.size < 100) break;
        beforeId = batch.lastKey(); // ID del messaggio più vecchio nel batch
    }

    // Filtra: escludi embed recap e il messaggio di ritorno del PROPRIETARIO ATTUALE
    // (i messaggi di ritorno di ALTRI giocatori vengono MANTENUTI — sono info utili)
    const filtered = collected.filter(msg => {
        // Escludi recap del bot
        if (msg.author.bot && msg.embeds.length > 0 &&
            msg.embeds[0]?.title?.includes('Recap')) return false;
        // Escludi SOLO il messaggio "è ritornato" del proprietario attuale
        if (ownerId && msg.author.bot &&
            msg.content.includes('è ritornato') &&
            msg.content.includes(`<@${ownerId}>`)) return false;
        return true;
    });

    // Ordina dal più vecchio al più nuovo
    filtered.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    return filtered;
}

// ==========================================
// 💬 INVIA RECAP NELLA CHAT PRIVATA
// ==========================================
async function sendRecapToPrivate(privateChannel, houseChannel, messages, ownerId) {
    const MAX_EMBED_CHARS = 3800;
    const MAX_PER_EMBED = 40;
    const houseName = houseChannel.name.replace(/-/g, ' ').toUpperCase();

    // Conta messaggi giocatori vs sistema (bot)
    const playerMsgs = messages.filter(m => !m.author.bot);
    const systemMsgs = messages.filter(m => m.author.bot);

    // Formatta ogni messaggio come riga
    const lines = messages.map(msg => {
        const ts = `<t:${Math.floor(msg.createdTimestamp / 1000)}:t>`;

        if (msg.author.bot) {
            // Messaggio di sistema (entrate, uscite, sfondamenti)
            // Mantieni il testo originale con i tag
            const text = msg.content.length > 250
                ? msg.content.substring(0, 250) + '…'
                : msg.content;
            return `${ts} ${text}`;
        }

        // Messaggio di un giocatore
        const mention = `<@${msg.author.id}>`;
        const attachments = msg.attachments.size > 0
            ? ` 📎 *[${msg.attachments.map(a => a.name || 'file').join(', ')}]*`
            : '';
        const content = msg.content
            ? (msg.content.length > 250 ? msg.content.substring(0, 250) + '…' : msg.content)
            : (msg.attachments.size > 0 ? '' : '*[embed/reazione]*');

        return `${ts} ${mention}: ${content}${attachments}`;
    });

    // Dividi in chunk per gli embed
    const chunks = [];
    let currentChunk = '';
    let count = 0;
    let overflow = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] + '\n';
        if ((currentChunk.length + line.length > MAX_EMBED_CHARS) || count >= MAX_PER_EMBED) {
            chunks.push(currentChunk);
            currentChunk = '';
            count = 0;
            if (chunks.length >= 3) {
                // Max 3 embed, il resto va in !log
                overflow = true;
                break;
            }
        }
        currentChunk += line;
        count++;
    }
    if (currentChunk && !overflow) chunks.push(currentChunk);

    if (chunks.length === 0) return;

    // --- HEADER ---
    const parts = [];
    if (playerMsgs.length > 0) parts.push(`💬 ${playerMsgs.length} messaggi`);
    if (systemMsgs.length > 0) parts.push(`🔔 ${systemMsgs.length} eventi`);
    const subtitle = parts.join(' · ');

    // Invia embed
    for (let i = 0; i < chunks.length; i++) {
        const embed = new EmbedBuilder()
            .setColor('#2B82D1')
            .setDescription(chunks[i]);

        if (i === 0) {
            embed.setTitle(`📜 Recap ${houseName} — ${subtitle}`);
        }

        if (chunks.length > 1) {
            embed.setFooter({ text: `Pagina ${i + 1}/${chunks.length}` });
        }

        // Ultimo embed: timestamp e bottone
        if (i === chunks.length - 1) {
            embed.setTimestamp();

            if (overflow) {
                embed.setFooter({
                    text: `⚠️ Ci sono altri ${lines.length - (chunks.length * MAX_PER_EMBED)} messaggi. Usa !log per il registro completo.`
                });
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`recap_dismiss_${ownerId}`)
                    .setLabel('🗑️ Elimina Recap')
                    .setStyle(ButtonStyle.Secondary)
            );

            await privateChannel.send({ embeds: [embed], components: [row] });
        } else {
            await privateChannel.send({ embeds: [embed] });
        }
    }

    console.log(`📜 [Recap] Inviato recap a ${ownerId}: ${messages.length} messaggi da ${houseChannel.name}`);
}

// ==========================================
// 📁 GENERA FILE .TXT PER !log
// ==========================================
async function generateLogFile(guild, userId) {
    // Recupera timestamps
    const times = await db.housing.getDepartureTimes(userId);
    if (!times || !times.departed) return null;

    // Recupera casa
    const homeId = await db.housing.getHome(userId);
    if (!homeId) return null;

    const channel = guild.channels.cache.get(homeId);
    if (!channel) return null;

    // Usa il timestamp di ritorno se presente, altrimenti adesso
    const untilTimestamp = times.returned || Date.now();

    // Fetch messaggi
    const messages = await fetchMessagesSince(channel, times.departed, userId);
    if (messages.length === 0) return null;

    // Formatta come testo leggibile
    const houseName = channel.name.replace(/-/g, ' ').toUpperCase();
    const departDate = new Date(times.departed).toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
    const returnDate = new Date(untilTimestamp).toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

    let text = '';
    text += '═══════════════════════════════════════════\n';
    text += `  REGISTRO MESSAGGI — ${houseName}\n`;
    text += `  Da: ${departDate}\n`;
    text += `  A:  ${returnDate}\n`;
    text += '═══════════════════════════════════════════\n\n';

    for (const msg of messages) {
        const time = new Date(msg.createdTimestamp).toLocaleString('it-IT', {
            timeZone: 'Europe/Rome',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const date = new Date(msg.createdTimestamp).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });

        if (msg.author.bot) {
            text += `[${date} ${time}] 🔔 ${msg.content}\n`;
        } else {
            const name = msg.member?.displayName || msg.author.username;
            const tag = msg.author.tag || msg.author.username;
            const attachments = msg.attachments.size > 0
                ? ` [Allegati: ${msg.attachments.map(a => a.name || 'file').join(', ')}]`
                : '';
            const content = msg.content || '[nessun testo]';
            text += `[${date} ${time}] ${name} (${tag}): ${content}${attachments}\n`;
        }
    }

    text += '\n═══════════════════════════════════════════\n';
    text += `  Totale: ${messages.length} messaggi\n`;
    text += '═══════════════════════════════════════════\n';

    // Crea file
    const buffer = Buffer.from(text, 'utf-8');
    const fileName = `log_${channel.name}_${Date.now()}.txt`;
    const attachment = new AttachmentBuilder(buffer, { name: fileName });

    return { attachment, messageCount: messages.length, houseName };
}

// ==========================================
// 🔍 TROVA CHAT PRIVATA DEL GIOCATORE
// ==========================================
function findPrivateChannel(guild, userId) {
    const category = guild.channels.cache.get(HOUSING.CATEGORIA_CHAT_PRIVATE);
    if (!category) return null;

    return category.children.cache.find(ch =>
        ch.type === 0 && // GuildText
        ch.permissionOverwrites.cache.some(p => p.id === userId && p.allow.has('ViewChannel'))
    ) || null;
}

module.exports = { initMessageRecap, generateLogFile };
