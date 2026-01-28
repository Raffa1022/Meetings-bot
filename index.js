const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder,
    EmbedBuilder,
    ChannelType,
    PermissionsBitField,
    Partials 
} = require('discord.js');

const express = require('express'); // Per Health Check Koyeb

// ==========================================
// ⚙️ CONFIGURAZIONE (MODIFICA QUI!)
// ==========================================

const TOKEN = 'MTQ2MzU5NDkwMTAzOTIyMjg3Nw.G2ZqJU.HRxjqWMs2fIwblzW2B2SUXcYhUZ8BkeWioLmss'; 
const PREFIX = '!';

// ID UTILI
const ID_CATEGORIA_CASE = '1460741413388947528';
const ID_CANALE_DB = '1465768646906220700'; // Canale privato dove il bot salva i dati

// [NUOVO] Inserisci qui l'ID della categoria delle chat private (OFF-RP/Generale)
const ID_CATEGORIA_CHAT_PRIVATE = '1460741414357827747'; 

// RUOLI CHE POSSONO RISPONDERE AL BUSSARE (ID Ruoli Discord)
// Inserisci qui gli ID dei ruoli che, se presenti in casa, devono approvare l'ingresso
// Questi ruoli sono anche quelli abilitati al comando !rimaste
const RUOLI_PERMESSI = [
    '1460741403331268661', 
    '1460741404497019002', 
    '1460741402672758814',
    '1460741405722022151' // <--- [MODIFICA] Aggiungi qui il 4° ID ruolo
]; 

const DEFAULT_MAX_VISITS = 3;

// ==========================================
// 🛡️ ANTI-CRASH & WEB SERVER (Koyeb Health Check)
// ==========================================

const app = express();
app.get('/', (req, res) => res.send('Bot is Alive!'));
app.listen(8000, () => console.log('🌍 Web Server pronto sulla porta 8000'));

process.on('unhandledRejection', (reason, p) => {
    console.error(' [ANTI-CRASH] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err, origin) => {
    console.error(' [ANTI-CRASH] Uncaught Exception:', err);
});
process.on('uncaughtExceptionMonitor', (err, origin) => {
    console.error(' [ANTI-CRASH] Uncaught Exception Monitor:', err);
});

// ==========================================
// 🤖 CLIENT DISCORD
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates, // Utile per sapere chi è nei canali
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ==========================================
// 💾 GESTORE DATABASE (DISCORD CHANNEL DB)
// ==========================================

let dbCache = {
    playerHomes: {},   // { userID: channelID }
    playerVisits: {},  // { userID: count }
    baseVisits: {},    // { userID: limit }
    extraVisits: {},   // { userID: extra }
    hiddenVisits: {},  // { userID: count } [NUOVO: Visite Nascoste Disponibili]
    playerModes: {},   // { userID: 'NORMAL' | 'HIDDEN' } [NUOVO: Traccia come è entrato l'utente]
    lastReset: null
};

// Set per tracciare chi sta bussando ed evitare spam
const pendingKnocks = new Set(); 

// Carica il DB all'avvio
async function loadDB() {
    try {
        const channel = await client.channels.fetch(ID_CANALE_DB);
        const messages = await channel.messages.fetch({ limit: 1 });
        if (messages.size > 0) {
            const lastMsg = messages.first();
            if (lastMsg.content.startsWith('```json')) {
                const jsonContent = lastMsg.content.replace(/```json|```/g, '');
                const data = JSON.parse(jsonContent);
                
                // Merge per compatibilità
                dbCache = { ...dbCache, ...data };
                // Inizializzazione campi se mancanti
                if (!dbCache.baseVisits) dbCache.baseVisits = dbCache.maxVisits || {};
                if (!dbCache.extraVisits) dbCache.extraVisits = {};
                if (!dbCache.hiddenVisits) dbCache.hiddenVisits = {};
                if (!dbCache.playerModes) dbCache.playerModes = {};
                
                console.log("💾 Database caricato con successo!");
            }
        }
    } catch (e) {
        console.error("❌ Errore caricamento DB:", e);
    }
}

// Salva il DB sul canale
async function saveDB() {
    try {
        const channel = await client.channels.fetch(ID_CANALE_DB);
        const jsonString = JSON.stringify(dbCache, null, 2);
        
        // Cancella vecchi messaggi per pulizia
        const messages = await channel.messages.fetch({ limit: 5 });
        if (messages.size > 0) await channel.bulkDelete(messages);

        await channel.send(`\`\`\`json\n${jsonString}\n\`\`\``);
    } catch (e) {
        console.error("❌ Errore salvataggio DB:", e);
    }
}

client.once('ready', async () => {
    console.log(`✅ Bot Online come ${client.user.tag}!`);
    await loadDB();
    
    // Controllo Reset Giornaliero
    const today = new Date().toDateString();
    if (dbCache.lastReset !== today) {
        dbCache.playerVisits = {};
        dbCache.extraVisits = {}; 
        // Nota: Le hiddenVisits NON si resettano giornalmente di solito, 
        // ma se vuoi resettarle scommenta la riga sotto:
        // dbCache.hiddenVisits = {}; 
        dbCache.lastReset = today;
        await saveDB();
        console.log("🔄 Contatori visite e extra resettati per nuovo giorno.");
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
        // ---------------------------------------------------------
        // 👮 COMANDI ADMIN
        // ---------------------------------------------------------

        if (command === 'assegnacasa') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            const targetChannel = message.mentions.channels.first();

            if (!targetUser || !targetChannel) return message.reply("❌ Uso: `!assegnacasa @Utente #canale`");

            dbCache.playerHomes[targetUser.id] = targetChannel.id;
            await saveDB();

            await targetChannel.permissionOverwrites.set([
                { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: targetUser.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels] }
            ]);

            message.reply(`✅ Casa assegnata a ${targetUser}.`);
            
            const pinnedMsg = await targetChannel.send(`🔑 **${targetUser}**, questa è la tua dimora privata.`);
            await pinnedMsg.pin();
        }

        if (command === 'base') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            const limit = parseInt(args[1]);

            if (!targetUser || isNaN(limit)) return message.reply("❌ Uso: `!base @Utente Numero`");
            
            dbCache.baseVisits[targetUser.id] = limit;
            await saveDB();
            message.reply(`✅ Visite **BASE** per **${targetUser.displayName}** impostate a **${limit}**.`);
        }

        if (command === 'aggiunta') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            const extra = parseInt(args[1]);

            if (!targetUser || isNaN(extra)) return message.reply("❌ Uso: `!aggiunta @Utente Numero`");
            
            const currentExtra = dbCache.extraVisits[targetUser.id] || 0;
            dbCache.extraVisits[targetUser.id] = currentExtra + extra;
            await saveDB();
            message.reply(`✅ Aggiunte **${extra}** visite a **${targetUser.displayName}**. (Totale Extra: ${currentExtra + extra})`);
        }

        // [NUOVO COMANDO] !nascosto @Utente numero
        if (command === 'nascosto') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            const hiddenCount = parseInt(args[1]);

            if (!targetUser || isNaN(hiddenCount)) return message.reply("❌ Uso: `!nascosto @Utente Numero`");
            
            const currentHidden = dbCache.hiddenVisits[targetUser.id] || 0;
            dbCache.hiddenVisits[targetUser.id] = currentHidden + hiddenCount;
            await saveDB();
            message.reply(`✅ Aggiunte **${hiddenCount}** visite NASCOSTE a **${targetUser.displayName}**. (Totale Nascoste: ${currentHidden + hiddenCount})`);
        }

        if (command === 'resetvisite') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            dbCache.playerVisits = {};
            dbCache.extraVisits = {}; 
            dbCache.hiddenVisits = {}; // [MODIFICA] Resetta anche le nascoste
            await saveDB();
            message.reply("🔄 Tutti i contatori resettati (visite usate, extra e nascoste). Si riparte dalle visite BASE.");
        }

        // ---------------------------------------------------------
        // 👤 COMANDI GIOCATORE
        // ---------------------------------------------------------

        if (command === 'rimaste') {
            if (message.member.roles.cache.hasAny(...RUOLI_PERMESSI)) {
                const base = dbCache.baseVisits[message.author.id] || DEFAULT_MAX_VISITS;
                const extra = dbCache.extraVisits[message.author.id] || 0;
                const hidden = dbCache.hiddenVisits[message.author.id] || 0;
                const totalLimit = base + extra;
                const used = dbCache.playerVisits[message.author.id] || 0;
                
                message.reply(`Visite Norm: ${used}/${totalLimit} (Base: ${base} + Extra: ${extra})\nVisite Nascoste disponibili: ${hidden}`);
            }
            return;
        }

        if (command === 'torna') {
            message.delete().catch(()=>{}); 

            const homeId = dbCache.playerHomes[message.author.id];
            if (!homeId) return message.reply("❌ Non hai una casa registrata."); 
            
            const homeChannel = message.guild.channels.cache.get(homeId);
            if (!homeChannel) return message.reply("❌ La tua casa non esiste più.");
            if (message.channel.id === homeId) return message.reply("🏠 Sei già a casa.");

            // Ritorno a casa (Modalità normale, quindi silent=false)
            await movePlayer(message.member, message.channel, homeChannel, `🏠 ${message.member} è ritornato.`, false);
        }

        if (command === 'bussa') {
            message.delete().catch(()=>{}); 

            // Controllo se sta già aspettando
            if (pendingKnocks.has(message.author.id)) {
                return message.channel.send(`${message.author}, stai già bussando o aspettando una risposta!`).then(m => setTimeout(() => m.delete(), 5000));
            }

            // [MODIFICA RICHIESTA] Prima selezione: Modalità
            const selectMode = new StringSelectMenuBuilder()
                .setCustomId('knock_mode_select')
                .setPlaceholder('Come vuoi entrare?')
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Visita Normale')
                        .setValue('mode_normal')
                        .setDescription('Bussi alla porta e attendi')
                        .setEmoji('👋'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Visita Nascosta')
                        .setValue('mode_hidden')
                        .setDescription('Entri senza farti vedere (Richiede Punti Nascosti)')
                        .setEmoji('🕵️')
                );

            await message.channel.send({ 
                content: `🎭 **${message.author}, scegli la modalità di visita:**`, 
                components: [new ActionRowBuilder().addComponents(selectMode)]
            });
        }

    } catch (error) {
        console.error("Errore nel comando:", error);
    }
});

// ==========================================
// 🖱️ GESTIONE INTERAZIONI
// ==========================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    try {
        // 1. SELEZIONE MODALITÀ (Normale vs Nascosta)
        if (interaction.customId === 'knock_mode_select') {
            if (interaction.message.content.includes(interaction.user.id) === false && !interaction.message.interaction) {
                return interaction.reply({ content: "Non è il tuo menu.", ephemeral: true });
            }

            const selectedMode = interaction.values[0]; // 'mode_normal' o 'mode_hidden'
            
            // Logica Paginazione Case
            const tutteLeCase = interaction.guild.channels.cache
                .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
                .sort((a, b) => a.rawPosition - b.rawPosition);

            if (tutteLeCase.size === 0) return interaction.reply({ content: "❌ Non ci sono case.", ephemeral: true });

            const PAGE_SIZE = 25;
            const totalPages = Math.ceil(tutteLeCase.size / PAGE_SIZE);
            const pageOptions = [];

            for (let i = 0; i < totalPages; i++) {
                const start = i * PAGE_SIZE + 1;
                const end = Math.min((i + 1) * PAGE_SIZE, tutteLeCase.size);
                pageOptions.push(new StringSelectMenuOptionBuilder()
                    .setLabel(`Case ${start} - ${end}`)
                    // Passiamo la modalità nella value della pagina per ricordarcela
                    .setValue(`page_${i}_${selectedMode}`) 
                    .setEmoji('🏘️')
                );
            }

            const selectGroup = new StringSelectMenuBuilder()
                .setCustomId('knock_page_select')
                .setPlaceholder('Seleziona zona...')
                .addOptions(pageOptions);

            await interaction.update({ 
                content: `🏘️ **Modalità: ${selectedMode === 'mode_normal' ? 'Normale' : 'Nascosta'}**. Scegli zona:`, 
                components: [new ActionRowBuilder().addComponents(selectGroup)]
            });
        }

        // 2. SELEZIONE PAGINA
        if (interaction.customId === 'knock_page_select') {
            const parts = interaction.values[0].split('_'); // ['page', '0', 'mode', 'normal']
            const pageIndex = parseInt(parts[1]);
            const currentMode = parts[2] + '_' + parts[3]; // 'mode_normal' o 'mode_hidden'

            const PAGE_SIZE = 25;
            const tutteLeCase = interaction.guild.channels.cache
                .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
                .sort((a, b) => a.rawPosition - b.rawPosition);

            const start = pageIndex * PAGE_SIZE;
            const caseSlice = Array.from(tutteLeCase.values()).slice(start, start + PAGE_SIZE);

            const selectHouse = new StringSelectMenuBuilder()
                .setCustomId('knock_house_select')
                .setPlaceholder('Dove vuoi andare?')
                .addOptions(caseSlice.map(c => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(formatName(c.name))
                        // Passiamo ID Casa + Modalità
                        .setValue(`${c.id}_${currentMode}`) 
                        .setEmoji(currentMode === 'mode_hidden' ? '🕵️' : '🚪')
                ));

            await interaction.update({ 
                content: `📂 **Scegli la casa (${currentMode === 'mode_hidden' ? 'Nascosta' : 'Normale'}):**`, 
                components: [new ActionRowBuilder().addComponents(selectHouse)] 
            });
        }

        // 3. BUSSATA E LOGICA INGRESSO
        if (interaction.customId === 'knock_house_select') {
            const parts = interaction.values[0].split('_'); // [ID_CASA, 'mode', 'normal/hidden']
            const targetChannelId = parts[0];
            const mode = parts[1] + '_' + parts[2]; // 'mode_normal' o 'mode_hidden'
            
            const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
            const knocker = interaction.member;

            if (!targetChannel) return interaction.reply({ content: "Casa inesistente.", ephemeral: true });

            // Controllo Dimora Privata
            const playerHomeId = dbCache.playerHomes[knocker.id];
            if (playerHomeId === targetChannelId) {
                return interaction.reply({ 
                    content: `⛔ **${formatName(targetChannel.name)}** è la tua dimora privata.`, 
                    ephemeral: true 
                });
            }

            // ==========================================
            // 🕵️ GESTIONE MODALITÀ NASCOSTA
            // ==========================================
            if (mode === 'mode_hidden') {
                const hiddenAvailable = dbCache.hiddenVisits[knocker.id] || 0;
                if (hiddenAvailable <= 0) {
                    return interaction.reply({ content: "⛔ Non hai visite nascoste disponibili! Chiedi a un admin o usa !rimaste.", ephemeral: true });
                }

                // Scala visita nascosta
                dbCache.hiddenVisits[knocker.id] = hiddenAvailable - 1;
                await saveDB();

                await interaction.message.delete().catch(()=>{});
                // Entra in modalità SILENZIOSA (true)
                await enterHouse(knocker, interaction.channel, targetChannel, "", true); 
                
                // Feedback effimero all'utente
                return interaction.channel.send({ content: `🕵️ ${knocker} sei entrato in modalità nascosta.` }).then(m => setTimeout(() => m.delete(), 3000));
            }

            // ==========================================
            // 👋 GESTIONE MODALITÀ NORMALE
            // ==========================================
            const base = dbCache.baseVisits[knocker.id] || DEFAULT_MAX_VISITS;
            const extra = dbCache.extraVisits[knocker.id] || 0;
            const userLimit = base + extra;
            const used = dbCache.playerVisits[knocker.id] || 0;
            
            if (used >= userLimit) return interaction.reply({ content: "⛔ Visite normali finite!", ephemeral: true });

            pendingKnocks.add(knocker.id);

            await interaction.message.delete().catch(()=>{});

            const membersWithAccess = targetChannel.members.filter(member => 
                !member.user.bot && 
                member.id !== knocker.id &&
                member.roles.cache.hasAny(...RUOLI_PERMESSI)
            );

            if (membersWithAccess.size === 0) {
                // --> NESSUNO IN CASA (Porta aperta)
                pendingKnocks.delete(knocker.id);
                await interaction.channel.send({ content: `🔓 La porta è aperta/incustodita. ${knocker} entra...` }).then(m => setTimeout(() => m.delete(), 5000));
                
                // [MODIFICA RICHIESTA] Messaggio con menzione (@utente)
                await enterHouse(knocker, interaction.channel, targetChannel, `👋 ${knocker} è entrato.`, false);
                
            } else {
                // --> QUALCUNO È IN CASA
                await interaction.channel.send({ content: `✊ ${knocker} ha bussato a **${formatName(targetChannel.name)}**. Aspetta una risposta...` });
                
                // [MODIFICA RICHIESTA] Tag Ruoli invece di Utenti
                const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(' ');
                
                // [MODIFICA RICHIESTA] Formattazione TOC TOC
                const msg = await targetChannel.send(
                    `🔔 **TOC TOC!** ${roleMentions}\n**Qualcuno** sta bussando!\nAvete **5 minuti** per rispondere.\n\n✅ = Apri | ❌ = Ignora`
                );
                await msg.react('✅');
                await msg.react('❌');

                const filter = (reaction, user) => {
                    return ['✅', '❌'].includes(reaction.emoji.name) && 
                           membersWithAccess.has(user.id);
                };

                const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

                collector.on('collect', async (reaction, user) => {
                    if (reaction.emoji.name === '✅') {
                        msg.edit(`✅ **${user.displayName}** ha aperto la porta.`);
                        pendingKnocks.delete(knocker.id);
                        
                        await enterHouse(knocker, interaction.channel, targetChannel, `👋 **${knocker}** è entrato.`, false);
                    } else {
                        msg.edit(`❌ **${user.displayName}** ha rifiutato l'ingresso.`);
                        pendingKnocks.delete(knocker.id);
                        const namesList = membersWithAccess.map(m => `${m} `).join(', ');
                        await interaction.channel.send(`⛔ ${knocker}, sei stato rifiutato da ${namesList} (membri presenti in casa).`);
                    }
                });

                collector.on('end', async (collected) => {
                    if (collected.size === 0) {
                        pendingKnocks.delete(knocker.id);
                        await targetChannel.send("⏳ Nessuno ha risposto in tempo. La porta viene forzata/aperta.");
                        await enterHouse(knocker, interaction.channel, targetChannel, `👋 **${knocker.displayName}** è entrato (porta forzata).`, false);
                    }
                });
            }
        }

    } catch (error) {
        console.error("Errore interazione:", error);
        if (interaction.member) pendingKnocks.delete(interaction.member.id);
    }
});

// ==========================================
// 🛠️ FUNZIONI DI UTILITÀ
// ==========================================

function formatName(name) {
    return name.replace(/-/g, ' ').toUpperCase().substring(0, 25);
}

// Funzione unificata per entrare e scalare visite (Solo Normali)
// Le visite nascoste vengono scalate PRIMA di chiamare questa funzione
async function enterHouse(member, fromChannel, toChannel, entryMessage, isSilent) {
    // Se non è silent (quindi è normale), scala la visita normale
    if (!isSilent) {
        const current = dbCache.playerVisits[member.id] || 0;
        dbCache.playerVisits[member.id] = current + 1;
    }
    await saveDB();

    await movePlayer(member, fromChannel, toChannel, entryMessage, isSilent);
}

// Funzione Move Player aggiornata
async function movePlayer(member, oldChannel, newChannel, entryMessage, isSilent) {
    if (!member || !newChannel) return;

    let channelToLeave = oldChannel;

    // SE L'UTENTE DIGITA DALLA CATEGORIA PRIVATE
    if (oldChannel && oldChannel.parentId === ID_CATEGORIA_CHAT_PRIVATE) {
        const currentHouse = oldChannel.guild.channels.cache.find(c => 
            c.parentId === ID_CATEGORIA_CASE && 
            c.type === ChannelType.GuildText && 
            c.permissionsFor(member).has(PermissionsBitField.Flags.ViewChannel)
        );
        if (currentHouse) {
            channelToLeave = currentHouse;
        }
    }

    // Gestione uscita vecchio canale
    if (channelToLeave && channelToLeave.id !== newChannel.id) {
        if (channelToLeave.parentId === ID_CATEGORIA_CASE) {
            
            // [MODIFICA] Controlla se la modalità precedente era HIDDEN. 
            // Se era hidden, NON mandare messaggio di uscita.
            const prevMode = dbCache.playerModes[member.id];
            if (prevMode !== 'HIDDEN') {
                await channelToLeave.send(`🚪 ${member} è uscito.`);
            }
            
            await channelToLeave.permissionOverwrites.delete(member.id).catch(() => console.log("Impossibile togliere permessi o già tolti."));
        }
    }

    // Gestione entrata nuovo canale
    await newChannel.permissionOverwrites.create(member.id, { ViewChannel: true, SendMessages: true });

    // Salva la nuova modalità
    dbCache.playerModes[member.id] = isSilent ? 'HIDDEN' : 'NORMAL';
    await saveDB();

    // Se NON è silent, manda il messaggio
    if (!isSilent) {
        await newChannel.send(entryMessage);
    }

    // [MODIFICA RICHIESTA] Rimosso il Ghost Ping (p.delete)
}

client.login(TOKEN);

