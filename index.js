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
// [MODIFICATO] Rimossi 2 ID come richiesto
const RUOLI_PERMESSI = [
    '1460741403331268661', 
    '1460741404497019002'
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
    playerVisits: {},  // { userID: count (visite normali usate) }
    baseVisits: {},    // { userID: limit }
    extraVisits: {},   // { userID: extra }
    hiddenVisits: {},  // { userID: count } [Visite Nascoste Disponibili]
    forcedVisits: {},  // { userID: count } [NUOVO: Visite Forzate Disponibili]
    playerModes: {},   // { userID: 'NORMAL' | 'HIDDEN' }
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
                if (!dbCache.forcedVisits) dbCache.forcedVisits = {}; // [NUOVO]
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
        // Le visite Nascoste e Forzate non si resettano automaticamente (cumulabili)
        // Se vuoi resettarle, scommenta:
        // dbCache.hiddenVisits = {}; 
        // dbCache.forcedVisits = {};
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

        // [NUOVO COMANDO UNICO] !visite @utente base forzate nascoste
        if (command === 'visite') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            // args[0] è il tag utente, quindi i numeri partono da 1
            const baseInput = parseInt(args[1]);
            const forcedInput = parseInt(args[2]);
            const hiddenInput = parseInt(args[3]);

            if (!targetUser || isNaN(baseInput) || isNaN(forcedInput) || isNaN(hiddenInput)) {
                return message.reply("❌ Uso: `!visite @Utente [Base] [Forzate] [Nascoste]` (es: `!visite @tizio 3 2 1`)");
            }

            dbCache.baseVisits[targetUser.id] = baseInput;
            dbCache.forcedVisits[targetUser.id] = forcedInput;
            dbCache.hiddenVisits[targetUser.id] = hiddenInput;
            
            await saveDB();
            message.reply(`✅ Impostate per **${targetUser.displayName}**:\n🏠 Base: ${baseInput}\n🧨 Forzate: ${forcedInput}\n🕵️ Nascoste: ${hiddenInput}`);
        }

        // [MODIFICATO] !aggiunta tipo @utente numero
        if (command === 'aggiunta') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const type = args[0] ? args[0].toLowerCase() : null;
            const targetUser = message.mentions.members.first();
            const amount = parseInt(args[2]);

            if (!type || !targetUser || isNaN(amount) || !['base', 'nascosta', 'forzata'].includes(type)) {
                return message.reply("❌ Uso: `!aggiunta base/nascosta/forzata @Utente Numero`");
            }
            
            if (type === 'base') {
                // "Aggiunta base" qui intendo come Extra visite normali giornaliere
                const current = dbCache.extraVisits[targetUser.id] || 0;
                dbCache.extraVisits[targetUser.id] = current + amount;
                message.reply(`✅ Aggiunte **${amount}** visite EXTRA a **${targetUser.displayName}**.`);
            } 
            else if (type === 'nascosta') {
                const current = dbCache.hiddenVisits[targetUser.id] || 0;
                dbCache.hiddenVisits[targetUser.id] = current + amount;
                message.reply(`✅ Aggiunte **${amount}** visite NASCOSTE a **${targetUser.displayName}**.`);
            }
            else if (type === 'forzata') {
                const current = dbCache.forcedVisits[targetUser.id] || 0;
                dbCache.forcedVisits[targetUser.id] = current + amount;
                message.reply(`✅ Aggiunte **${amount}** visite FORZATE a **${targetUser.displayName}**.`);
            }

            await saveDB();
        }

        if (command === 'resetvisite') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            dbCache.playerVisits = {};
            dbCache.extraVisits = {}; 
            dbCache.hiddenVisits = {}; 
            dbCache.forcedVisits = {}; // Resetta anche le forzate
            await saveDB();
            message.reply("🔄 Tutti i contatori resettati (base usate, extra, nascoste e forzate).");
        }

        // ---------------------------------------------------------
        // 👤 COMANDI GIOCATORE
        // ---------------------------------------------------------

        if (command === 'rimaste') {
            if (message.member.roles.cache.hasAny(...RUOLI_PERMESSI)) {
                const base = dbCache.baseVisits[message.author.id] || DEFAULT_MAX_VISITS;
                const extra = dbCache.extraVisits[message.author.id] || 0;
                const totalLimit = base + extra;
                const used = dbCache.playerVisits[message.author.id] || 0;

                const hidden = dbCache.hiddenVisits[message.author.id] || 0;
                const forced = dbCache.forcedVisits[message.author.id] || 0;
                
                message.reply(`📊 **Le tue visite:**\n🏠 Normali: ${used}/${totalLimit}\n🧨 Forzate: ${forced}\n🕵️ Nascoste: ${hidden}`);
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

            // Ritorno a casa
            await movePlayer(message.member, message.channel, homeChannel, `🏠 ${message.member} è ritornato.`, false);
        }

        if (command === 'bussa') {
            message.delete().catch(()=>{}); 

            if (pendingKnocks.has(message.author.id)) {
                return message.channel.send(`${message.author}, stai già bussando o aspettando una risposta!`).then(m => setTimeout(() => m.delete(), 5000));
            }

            // Selezione: Modalità (Normale, Nascosta, Forzata)
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
                        .setLabel('Visita Forzata')
                        .setValue('mode_forced') // [NUOVO]
                        .setDescription('Entri con forza (Richiede Punti Forzata)')
                        .setEmoji('🧨'),
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
        // 1. SELEZIONE MODALITÀ
        if (interaction.customId === 'knock_mode_select') {
            if (interaction.message.content.includes(interaction.user.id) === false && !interaction.message.interaction) {
                return interaction.reply({ content: "Non è il tuo menu.", ephemeral: true });
            }

            const selectedMode = interaction.values[0]; 
            
            // [MODIFICA FILTRO] Escludi casa propria e casa attuale
            const userHomeId = dbCache.playerHomes[interaction.user.id];
            const currentChannelId = interaction.channel.id;

            const tutteLeCase = interaction.guild.channels.cache
                .filter(c => 
                    c.parentId === ID_CATEGORIA_CASE && 
                    c.type === ChannelType.GuildText &&
                    c.id !== userHomeId &&          // Rimuove casa proprietario
                    c.id !== currentChannelId       // Rimuove casa attuale
                )
                .sort((a, b) => a.rawPosition - b.rawPosition);

            if (tutteLeCase.size === 0) return interaction.reply({ content: "❌ Non ci sono altre case disponibili dove andare.", ephemeral: true });

            const PAGE_SIZE = 25;
            const totalPages = Math.ceil(tutteLeCase.size / PAGE_SIZE);
            const pageOptions = [];

            for (let i = 0; i < totalPages; i++) {
                const start = i * PAGE_SIZE + 1;
                const end = Math.min((i + 1) * PAGE_SIZE, tutteLeCase.size);
                pageOptions.push(new StringSelectMenuOptionBuilder()
                    .setLabel(`Case ${start} - ${end}`)
                    .setValue(`page_${i}_${selectedMode}`) 
                    .setEmoji('🏘️')
                );
            }

            const selectGroup = new StringSelectMenuBuilder()
                .setCustomId('knock_page_select')
                .setPlaceholder('Seleziona zona...')
                .addOptions(pageOptions);

            let modeText = 'Normale';
            if (selectedMode === 'mode_hidden') modeText = 'Nascosta';
            if (selectedMode === 'mode_forced') modeText = 'Forzata';

            await interaction.update({ 
                content: `🏘️ **Modalità: ${modeText}**. Scegli zona:`, 
                components: [new ActionRowBuilder().addComponents(selectGroup)]
            });
        }

        // 2. SELEZIONE PAGINA
        if (interaction.customId === 'knock_page_select') {
            const parts = interaction.values[0].split('_'); 
            const pageIndex = parseInt(parts[1]);
            const currentMode = parts[2] + '_' + parts[3]; 

            const userHomeId = dbCache.playerHomes[interaction.user.id];
            const currentChannelId = interaction.channel.id;

            // Riapplichiamo lo stesso filtro per coerenza
            const tutteLeCase = interaction.guild.channels.cache
                .filter(c => 
                    c.parentId === ID_CATEGORIA_CASE && 
                    c.type === ChannelType.GuildText &&
                    c.id !== userHomeId &&
                    c.id !== currentChannelId
                )
                .sort((a, b) => a.rawPosition - b.rawPosition);

            const PAGE_SIZE = 25;
            const start = pageIndex * PAGE_SIZE;
            const caseSlice = Array.from(tutteLeCase.values()).slice(start, start + PAGE_SIZE);

            const selectHouse = new StringSelectMenuBuilder()
                .setCustomId('knock_house_select')
                .setPlaceholder('Dove vuoi andare?')
                .addOptions(caseSlice.map(c => 
                    new StringSelectMenuOptionBuilder()
                        .setLabel(formatName(c.name))
                        .setValue(`${c.id}_${currentMode}`) 
                        .setEmoji(currentMode === 'mode_hidden' ? '🕵️' : (currentMode === 'mode_forced' ? '🧨' : '🚪'))
                ));

            await interaction.update({ 
                content: `📂 **Scegli la casa:**`, 
                components: [new ActionRowBuilder().addComponents(selectHouse)] 
            });
        }

        // 3. ESECUZIONE (BUSSATA / INGRESSO)
        if (interaction.customId === 'knock_house_select') {
            const parts = interaction.values[0].split('_'); 
            const targetChannelId = parts[0];
            const mode = parts[1] + '_' + parts[2]; 
            
            const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
            const knocker = interaction.member;

            if (!targetChannel) return interaction.reply({ content: "Casa inesistente.", ephemeral: true });

            // ==========================================
            // 🧨 GESTIONE MODALITÀ FORZATA
            // ==========================================
            if (mode === 'mode_forced') {
                const forcedAvailable = dbCache.forcedVisits[knocker.id] || 0;
                if (forcedAvailable <= 0) {
                    return interaction.reply({ content: "⛔ Non hai visite forzate disponibili!", ephemeral: true });
                }

                // Scala visita forzata
                dbCache.forcedVisits[knocker.id] = forcedAvailable - 1;
                await saveDB();

                await interaction.message.delete().catch(()=>{});
                // Entra con narrazione specifica
                await enterHouse(knocker, interaction.channel, targetChannel, `@everyone ${knocker} ha sfondato la porta ed è entrato`, false);
                
                return interaction.channel.send({ content: `🧨 ${knocker} ha forzato l'ingresso!` }).then(m => setTimeout(() => m.delete(), 3000));
            }

            // ==========================================
            // 🕵️ GESTIONE MODALITÀ NASCOSTA
            // ==========================================
            if (mode === 'mode_hidden') {
                const hiddenAvailable = dbCache.hiddenVisits[knocker.id] || 0;
                if (hiddenAvailable <= 0) {
                    return interaction.reply({ content: "⛔ Non hai visite nascoste disponibili!", ephemeral: true });
                }

                dbCache.hiddenVisits[knocker.id] = hiddenAvailable - 1;
                await saveDB();

                await interaction.message.delete().catch(()=>{});
                await enterHouse(knocker, interaction.channel, targetChannel, "", true); 
                
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
                // Nessuno in casa
                pendingKnocks.delete(knocker.id);
                await interaction.channel.send({ content: `🔓 La porta è aperta/incustodita. ${knocker} entra...` }).then(m => setTimeout(() => m.delete(), 5000));
                await enterHouse(knocker, interaction.channel, targetChannel, `👋 ${knocker} è entrato.`, false);
            } else {
                // Qualcuno è in casa
                await interaction.channel.send({ content: `✊ ${knocker} ha bussato a **${formatName(targetChannel.name)}**. Aspetta una risposta...` });
                
                const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(' ');
                
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

// Funzione unificata per entrare
async function enterHouse(member, fromChannel, toChannel, entryMessage, isSilent) {
    // Se non è silent e non è forzata, scala visita normale?
    // NOTA: Se siamo arrivati qui da "mode_forced", i punti forzati sono GIA stati scalati sopra.
    // Se siamo arrivati da "mode_hidden", i punti nascosti sono GIA stati scalati.
    // Dobbiamo scalare solo le visite normali se NON è silent e NON è entrata forzata specifica.
    
    // Per semplicità nel codice precedente: 
    // enterHouse scala DB['playerVisits'] se !isSilent.
    // Tuttavia, per la visita FORZATA vogliamo mandare il messaggio MA NON scalare la visita 'normale', 
    // bensì quella 'forzata' (che abbiamo già scalato nel blocco if mode_forced).
    
    // Soluzione: controlliamo se entryMessage contiene la frase della forzata per evitare doppio addebito?
    // O meglio: passiamo un flag. Ma per non toccare troppo le firme:
    
    // Se il messaggio è quello standard o di porta aperta, scala normale.
    // Se è quello forzato (sfondato), non scala la normale.
    
    const isForcedEntry = entryMessage.includes("ha sfondato la porta");
    
    if (!isSilent && !isForcedEntry) {
        const current = dbCache.playerVisits[member.id] || 0;
        dbCache.playerVisits[member.id] = current + 1;
        await saveDB();
    }

    await movePlayer(member, fromChannel, toChannel, entryMessage, isSilent);
}

async function movePlayer(member, oldChannel, newChannel, entryMessage, isSilent) {
    if (!member || !newChannel) return;

    let channelToLeave = oldChannel;

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

    if (channelToLeave && channelToLeave.id !== newChannel.id) {
        if (channelToLeave.parentId === ID_CATEGORIA_CASE) {
            const prevMode = dbCache.playerModes[member.id];
            if (prevMode !== 'HIDDEN') {
                await channelToLeave.send(`🚪 ${member} è uscito.`);
            }
            await channelToLeave.permissionOverwrites.delete(member.id).catch(() => console.log("Permessi già tolti."));
        }
    }

    await newChannel.permissionOverwrites.create(member.id, { ViewChannel: true, SendMessages: true });

    dbCache.playerModes[member.id] = isSilent ? 'HIDDEN' : 'NORMAL';
    await saveDB();

    if (!isSilent) {
        await newChannel.send(entryMessage);
    }
}

client.login(TOKEN);
