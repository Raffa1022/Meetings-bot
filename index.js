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
// Il primo ruolo (index 0) verrà usato anche per il comando !chi
const RUOLI_PERMESSI = [
    '1460741403331268661', 
    '1460741404497019002'
]; 

const DEFAULT_MAX_VISITS = 10;

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
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ==========================================
// 💾 GESTORE DATABASE (DISCORD CHANNEL DB)
// ==========================================

let dbCache = {
    playerHomes: {},   // { userID: channelID }
    playerVisits: {},  // { userID: count (visite normali usate OGGI) }
    baseVisits: {},    // { userID: limit (limite visite normali) }
    extraVisits: {},   // { userID: extra (visite normali aggiuntive una tantum) }
    
    // Gestione Limiti e Contatori per Forzate/Nascoste
    forcedLimits: {},  // { userID: limit }
    hiddenLimits: {},  // { userID: limit }
    
    forcedVisits: {},  // { userID: count (disponibili attuali) }
    hiddenVisits: {},  // { userID: count (disponibili attuali) }
    
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
                
                dbCache = { ...dbCache, ...data };
                
                if (!dbCache.baseVisits) dbCache.baseVisits = {};
                if (!dbCache.extraVisits) dbCache.extraVisits = {};
                if (!dbCache.hiddenVisits) dbCache.hiddenVisits = {};
                if (!dbCache.forcedVisits) dbCache.forcedVisits = {};
                if (!dbCache.forcedLimits) dbCache.forcedLimits = {};
                if (!dbCache.hiddenLimits) dbCache.hiddenLimits = {};
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
        
        const messages = await channel.messages.fetch({ limit: 5 });
        if (messages.size > 0) await channel.bulkDelete(messages);

        await channel.send(`\`\`\`json\n${jsonString}\n\`\`\``);
    } catch (e) {
        console.error("❌ Errore salvataggio DB:", e);
    }
}

// Funzione Helper per resettare i contatori ai valori base
function resetCounters() {
    dbCache.playerVisits = {}; // Resetta le usate normali a 0
    dbCache.extraVisits = {};  // Rimuove gli extra normali
    
    const allUsers = new Set([
        ...Object.keys(dbCache.playerHomes),
        ...Object.keys(dbCache.forcedLimits),
        ...Object.keys(dbCache.hiddenLimits)
    ]);

    allUsers.forEach(userId => {
        dbCache.forcedVisits[userId] = dbCache.forcedLimits[userId] || 0;
        dbCache.hiddenVisits[userId] = dbCache.hiddenLimits[userId] || 0;
    });
}

client.once('ready', async () => {
    console.log(`✅ Bot Online come ${client.user.tag}!`);
    await loadDB();
    
    // Controllo Reset Giornaliero
    const today = new Date().toDateString();
    if (dbCache.lastReset !== today) {
        resetCounters();
        dbCache.lastReset = today;
        await saveDB();
        console.log("🔄 Contatori ripristinati ai valori base per nuovo giorno.");
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

        if (command === 'visite') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            const baseInput = parseInt(args[1]);
            const forcedInput = parseInt(args[2]);
            const hiddenInput = parseInt(args[3]);

            if (!targetUser || isNaN(baseInput) || isNaN(forcedInput) || isNaN(hiddenInput)) {
                return message.reply("❌ Uso: `!visite @Utente [Base] [Forzate] [Nascoste]` (es: `!visite @tizio 3 0 1`)");
            }

            dbCache.baseVisits[targetUser.id] = baseInput;
            dbCache.forcedLimits[targetUser.id] = forcedInput;
            dbCache.hiddenLimits[targetUser.id] = hiddenInput;

            dbCache.forcedVisits[targetUser.id] = forcedInput;
            dbCache.hiddenVisits[targetUser.id] = hiddenInput;
            
            await saveDB();
            message.reply(`✅ Configurazione salvata per **${targetUser.displayName}**:\nOgni reset avrà: 🏠 ${baseInput} Base | 🧨 ${forcedInput} Forzate | 🕵️ ${hiddenInput} Nascoste`);
        }

        if (command === 'aggiunta') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const type = args[0] ? args[0].toLowerCase() : null;
            const targetUser = message.mentions.members.first();
            const amount = parseInt(args[2]);

            if (!type || !targetUser || isNaN(amount) || !['base', 'nascosta', 'forzata'].includes(type)) {
                return message.reply("❌ Uso: `!aggiunta base/nascosta/forzata @Utente Numero`");
            }
            
            if (type === 'base') {
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
            
            resetCounters();
            await saveDB();
            message.reply("🔄 Tutti i contatori sono stati riportati ai valori configurati.");
        }

        // ---------------------------------------------------------
        // 👤 COMANDI GIOCATORE
        // ---------------------------------------------------------

        // [RICHIESTA 5] Comando !chi
        if (command === 'chi') {
            message.delete().catch(()=>{});

            // Funziona solo nella categoria CASE
            if (message.channel.parentId !== ID_CATEGORIA_CASE) {
                return message.channel.send("⛔ Questo comando funziona solo all'interno di una casa.").then(m => setTimeout(() => m.delete(), 5000));
            }

            // Trova il proprietario della casa corrente
            // La chiave è l'ID utente, il valore è l'ID canale. Cerchiamo la chiave che corrisponde a questo canale.
            const ownerId = Object.keys(dbCache.playerHomes).find(key => dbCache.playerHomes[key] === message.channel.id);
            let ownerName = "Nessuno";
            
            if (ownerId) {
                const ownerMember = message.guild.members.cache.get(ownerId);
                if (ownerMember) ownerName = ownerMember.displayName;
            }

            // Trova tutti i giocatori presenti che hanno il ruolo IDrole1 (Usiamo il primo ruolo di RUOLI_PERMESSI)
            // Filtra solo chi è fisicamente nel canale (ha permessi di visualizzazione e non è un bot)
            // Nota: Discord non ha una lista "live" di chi guarda il canale testo, quindi ci basiamo sui membri che hanno permessi
            // OPPURE possiamo listare chi ha il ruolo ed è nel server se intendiamo "chi abita qui". 
            // Interpretando "giocatori presenti in casa": Elenchiamo chi ha il permesso di vedere il canale e ha il ruolo.
            
            const targetRoleID = RUOLI_PERMESSI[0]; // Prende il primo ID ruolo

            const playersInHouse = message.channel.members.filter(member => 
                !member.user.bot && 
                member.roles.cache.has(targetRoleID)
            );

            let description = "";
            if (playersInHouse.size > 0) {
                playersInHouse.forEach(p => {
                    description += `👤 ${p}\n`; // Menziona o scrive il nome
                });
            } else {
                description = "Nessuno presente.";
            }

            const embed = new EmbedBuilder()
                .setTitle(`👥 Persone in casa`)
                .setDescription(description)
                .addFields(
                    { name: '🔑 Proprietario', value: `**${ownerName}**`, inline: false }
                )
                .setColor('#2b2d31')
                .setTimestamp();

            // Invia e cancella dopo 5 minuti (300000 ms)
            message.channel.send({ embeds: [embed] }).then(msg => {
                setTimeout(() => msg.delete().catch(() => {}), 300000);
            });
        }

        if (command === 'rimaste') {
            message.delete().catch(()=>{}); // Pulizia comando

            // [RICHIESTA 3] Il comando funziona solo nelle chat private
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) {
                return message.channel.send("⛔ Questo comando funziona solo nelle chat private!").then(m => setTimeout(() => m.delete(), 5000));
            }

            if (message.member.roles.cache.hasAny(...RUOLI_PERMESSI)) {
                const base = dbCache.baseVisits[message.author.id] || DEFAULT_MAX_VISITS;
                const extra = dbCache.extraVisits[message.author.id] || 0;
                const totalLimit = base + extra;
                const used = dbCache.playerVisits[message.author.id] || 0;

                const hidden = dbCache.hiddenVisits[message.author.id] || 0;
                const forced = dbCache.forcedVisits[message.author.id] || 0;
                
                // Nota: Non usiamo reply ma send normale nelle private per pulizia
                message.channel.send(`📊 **Le tue visite:**\n🏠 Normali: ${used}/${totalLimit}\n🧨 Forzate: ${forced}\n🕵️ Nascoste: ${hidden}`).then(m => setTimeout(() => m.delete(), 30000));
            }
            return;
        }

        if (command === 'torna') {
            message.delete().catch(()=>{}); 

            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) {
                return message.channel.send("⛔ Questo comando funziona solo nelle chat private!").then(m => setTimeout(() => m.delete(), 5000));
            }

            const homeId = dbCache.playerHomes[message.author.id];
            if (!homeId) return message.channel.send("❌ Non hai una casa registrata."); 
            
            const homeChannel = message.guild.channels.cache.get(homeId);
            if (!homeChannel) return message.channel.send("❌ La tua casa non esiste più.");

            const isVisitingSomeone = message.guild.channels.cache.some(c => 
                c.parentId === ID_CATEGORIA_CASE && 
                c.type === ChannelType.GuildText && 
                c.id !== homeId && 
                c.permissionsFor(message.member).has(PermissionsBitField.Flags.ViewChannel) 
            );

            if (!isVisitingSomeone) {
                return message.channel.send("🏠 Sei già a casa (o non stai visitando nessuno).").then(m => setTimeout(() => m.delete(), 5000));
            }

            await movePlayer(message.member, message.channel, homeChannel, `🏠 ${message.member} è ritornato.`, false);
        }

        if (command === 'bussa') {
            message.delete().catch(()=>{}); 

            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) {
                return message.channel.send(`⛔ Puoi usare questo comando solo nelle chat private!`).then(m => setTimeout(() => m.delete(), 5000));
            }

            if (pendingKnocks.has(message.author.id)) {
                return message.channel.send(`${message.author}, stai già bussando o aspettando una risposta!`).then(m => setTimeout(() => m.delete(), 5000));
            }

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
                        .setValue('mode_forced')
                        .setDescription('Entri con forza (Richiede Punti Forzata)')
                        .setEmoji('🧨'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Visita Nascosta')
                        .setValue('mode_hidden')
                        .setDescription('Entri senza farti vedere (Richiede Punti Nascosti)')
                        .setEmoji('🕵️')
                );

            const menuMessage = await message.channel.send({ 
                content: `🎭 **${message.author}, scegli la modalità di visita:**`, 
                components: [new ActionRowBuilder().addComponents(selectMode)]
            });
            
            setTimeout(() => {
                menuMessage.delete().catch(() => {});
                pendingKnocks.delete(message.author.id); 
            }, 300000);
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
            const userHomeId = dbCache.playerHomes[interaction.user.id];
            
            const currentHouseChannel = interaction.guild.channels.cache.find(c => 
                c.parentId === ID_CATEGORIA_CASE && 
                c.type === ChannelType.GuildText &&
                c.permissionsFor(interaction.user).has(PermissionsBitField.Flags.ViewChannel)
            );
            const currentHouseId = currentHouseChannel ? currentHouseChannel.id : null;

            const tutteLeCase = interaction.guild.channels.cache
                .filter(c => 
                    c.parentId === ID_CATEGORIA_CASE && 
                    c.type === ChannelType.GuildText &&
                    c.id !== userHomeId &&      
                    c.id !== currentHouseId     
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
            
            const currentHouseChannel = interaction.guild.channels.cache.find(c => 
                c.parentId === ID_CATEGORIA_CASE && 
                c.type === ChannelType.GuildText &&
                c.permissionsFor(interaction.user).has(PermissionsBitField.Flags.ViewChannel)
            );
            const currentHouseId = currentHouseChannel ? currentHouseChannel.id : null;

            const tutteLeCase = interaction.guild.channels.cache
                .filter(c => 
                    c.parentId === ID_CATEGORIA_CASE && 
                    c.type === ChannelType.GuildText &&
                    c.id !== userHomeId &&
                    c.id !== currentHouseId
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

                dbCache.forcedVisits[knocker.id] = forcedAvailable - 1;
                await saveDB();

                await interaction.message.delete().catch(()=>{});
                
                const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(', ');
                const narrazioneForzata = `${roleMentions}, ${knocker} ha sfondato la porta ed è entrato`;

                await enterHouse(knocker, interaction.channel, targetChannel, narrazioneForzata, false);
                
                // [RICHIESTA 2] Messaggio aggiornato e SENZA cancellazione automatica
                return interaction.channel.send({ content: `🧨 ${knocker} ha forzato l'ingresso in 🏡 | CASA ${formatName(targetChannel.name)}` });
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
                
                // [RICHIESTA 2] Messaggio aggiornato e SENZA cancellazione automatica
                return interaction.channel.send({ content: `🕵️ ${knocker} sei entrato in modalità nascosta in 🏡 | CASA ${formatName(targetChannel.name)}` });
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
                pendingKnocks.delete(knocker.id);
                await interaction.channel.send({ content: `🔓 La porta è aperta/incustodita. ${knocker} entra...` }).then(m => setTimeout(() => m.delete(), 5000));
                await enterHouse(knocker, interaction.channel, targetChannel, `👋 ${knocker} è entrato.`, false);
            } else {
                await interaction.channel.send({ content: `✊ ${knocker} ha bussato a **${formatName(targetChannel.name)}**. Aspetta una risposta...` });
                
                const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(' ');
                
                // [RICHIESTA 1] "❌ = Rifiuta"
                const msg = await targetChannel.send(
                    `🔔 **TOC TOC!** ${roleMentions}\n**Qualcuno** sta bussando!\nAvete **5 minuti** per rispondere.\n\n✅ = Apri | ❌ = Rifiuta`
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
                        // [RICHIESTA 4] Se rifiutato, perde comunque la visita
                        const currentRefused = dbCache.playerVisits[knocker.id] || 0;
                        dbCache.playerVisits[knocker.id] = currentRefused + 1;
                        await saveDB();

                        msg.edit(`❌ **${user.displayName}** ha rifiutato l'ingresso.`);
                        pendingKnocks.delete(knocker.id);
                        const namesList = membersWithAccess.map(m => `${m} `).join(', ');
                        await interaction.channel.send(`⛔ ${knocker}, sei stato rifiutato da ${namesList} (membri presenti in casa). Hai perso la visita.`);
                    }
                });

                collector.on('end', async (collected) => {
                    if (collected.size === 0) {
                        pendingKnocks.delete(knocker.id);
                        await targetChannel.send("⏳ Nessuno ha risposto in tempo. La porta viene forzata/aperta.");
                        await enterHouse(knocker, interaction.channel, targetChannel, `👋 ${knocker} è entrato.`, false);
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
    const isForcedEntry = entryMessage.includes("ha sfondato la porta");
    
    // Incrementa contatore visite normali solo se non è silent e non è entrata forzata
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
