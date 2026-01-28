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
const ID_CATEGORIA_CHAT_PRIVATE = '1460741414357827747'; 

// [NUOVO] Configurazione Distruzione/Ricostruzione
const ID_CANALE_ANNUNCI = '1460741475804381184'; // ID Canale dove mandare le gif
const ID_RUOLO_NOTIFICA_1 = '1460741403331268661'; // Usato anche per identificare chi va in "casa random"
const ID_RUOLO_NOTIFICA_2 = '1460741404497019002';

// [NUOVO] ID RUOLI SPETTATORI (Per comando !pubblico)
// Inserisci qui i 3 ID dei ruoli che verranno aggiunti con !pubblico
const RUOLI_SPETTATORI = [
    '1460741403331268661', 
    '1460741404497019002', 
    '1460741405722022151'
];

// Link alle GIF (Sostituisci i link se ne vuoi altri)
const GIF_DISTRUZIONE = 'https://i.giphy.com/media/oe33xf3B50fsc/giphy.gif'; 
const GIF_RICOSTRUZIONE = 'https://i.giphy.com/media/3ohjUS0WqYBpczfTlm/giphy.gif'; 

// RUOLI CHE POSSONO RISPONDERE AL BUSSARE (ID Ruoli Discord)
const RUOLI_PERMESSI = [
    '1460741403331268661', 
    '1460741404497019002'
]; 

const DEFAULT_MAX_VISITS = 10;

// ==========================================
// 🛡️ ANTI-CRASH & WEB SERVER
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
// 💾 GESTORE DATABASE
// ==========================================

let dbCache = {
    playerHomes: {},   
    playerVisits: {},  
    baseVisits: {},    
    extraVisits: {},   
    
    forcedLimits: {},  
    hiddenLimits: {},  
    
    forcedVisits: {},  
    hiddenVisits: {},  
    
    playerModes: {},   
    destroyedHouses: [], 
    lastReset: null
};

const pendingKnocks = new Set(); 

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
                
                // Inizializzazione fallback
                if (!dbCache.baseVisits) dbCache.baseVisits = {};
                if (!dbCache.extraVisits) dbCache.extraVisits = {};
                if (!dbCache.hiddenVisits) dbCache.hiddenVisits = {};
                if (!dbCache.forcedVisits) dbCache.forcedVisits = {};
                if (!dbCache.forcedLimits) dbCache.forcedLimits = {};
                if (!dbCache.hiddenLimits) dbCache.hiddenLimits = {};
                if (!dbCache.playerModes) dbCache.playerModes = {};
                if (!dbCache.destroyedHouses) dbCache.destroyedHouses = []; 
                
                console.log("💾 Database caricato con successo!");
            }
        }
    } catch (e) {
        console.error("❌ Errore caricamento DB:", e);
    }
}

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

function resetCounters() {
    dbCache.playerVisits = {}; 
    dbCache.extraVisits = {};  
    
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
                return message.reply("❌ Uso: `!visite @Utente [Base] [Forzate] [Nascoste]`");
            }

            dbCache.baseVisits[targetUser.id] = baseInput;
            dbCache.forcedLimits[targetUser.id] = forcedInput;
            dbCache.hiddenLimits[targetUser.id] = hiddenInput;

            dbCache.forcedVisits[targetUser.id] = forcedInput;
            dbCache.hiddenVisits[targetUser.id] = hiddenInput;
            
            await saveDB();
            message.reply(`✅ Configurazione salvata.`);
        }

        if (command === 'aggiunta') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const type = args[0] ? args[0].toLowerCase() : null;
            const targetUser = message.mentions.members.first();
            const amount = parseInt(args[2]);

            if (!type || !targetUser || isNaN(amount) || !['base', 'nascosta', 'forzata'].includes(type)) {
                return message.reply("❌ Uso: `!aggiunta base/nascosta/forzata @Utente Numero`");
            }
            
            if (type === 'base') dbCache.extraVisits[targetUser.id] = (dbCache.extraVisits[targetUser.id] || 0) + amount;
            else if (type === 'nascosta') dbCache.hiddenVisits[targetUser.id] = (dbCache.hiddenVisits[targetUser.id] || 0) + amount;
            else if (type === 'forzata') dbCache.forcedVisits[targetUser.id] = (dbCache.forcedVisits[targetUser.id] || 0) + amount;

            await saveDB();
            message.reply(`✅ Aggiunte visite a ${targetUser}.`);
        }

        if (command === 'resetvisite') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            resetCounters();
            await saveDB();
            message.reply("🔄 Contatori resettati.");
        }

        // [NUOVO COMANDO] !pubblico
        if (command === 'pubblico') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            if (message.channel.parentId !== ID_CATEGORIA_CASE) return message.reply("⛔ Comando usabile solo dentro una casa.");

            for (const roleId of RUOLI_SPETTATORI) {
                const role = message.guild.roles.cache.get(roleId);
                if (role) {
                    await message.channel.permissionOverwrites.edit(roleId, {
                        ViewChannel: true,
                        SendMessages: false,
                        AddReactions: false,
                        CreatePublicThreads: false,
                        CreatePrivateThreads: false
                    });
                }
            }
            message.reply("👁️ **Modalità Pubblica Attivata:** I ruoli spettatori possono ora osservare.");
        }

        // [NUOVO COMANDO] !sposta
        if (command === 'sposta') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetUser = message.mentions.members.first();
            const targetChannel = message.mentions.channels.first();

            if (!targetUser || !targetChannel) return message.reply("❌ Uso: `!sposta @Utente #canale-casa`");
            if (targetChannel.parentId !== ID_CATEGORIA_CASE) return message.reply("❌ Canale di destinazione non valido.");

            const oldChannel = targetUser.voice.channel || message.channel; // Fallback al canale testuale corrente

            await movePlayer(targetUser, oldChannel, targetChannel, `👋 ${targetUser} è stato spostato qui.`, false);
            message.delete().catch(()=>{});
        }

        // [COMANDO AGGIORNATO] !distruzione
        if (command === 'distruzione') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetChannel = message.mentions.channels.first();
            if (!targetChannel || targetChannel.parentId !== ID_CATEGORIA_CASE) {
                return message.reply("❌ Devi menzionare un canale casa valido. Es: `!distruzione #canale-casa`");
            }

            if (!dbCache.destroyedHouses.includes(targetChannel.id)) {
                dbCache.destroyedHouses.push(targetChannel.id);
                await saveDB();
            }

            // 1. Rimuovi il messaggio pinnato del proprietario
            try {
                const pinnedMessages = await targetChannel.messages.fetchPinned();
                const ownerPin = pinnedMessages.find(m => m.content.includes("questa è la tua dimora privata"));
                if (ownerPin) {
                    await ownerPin.delete();
                }
            } catch (err) {
                console.log("Nessun messaggio pinnato da rimuovere o errore permessi.");
            }

            // 2. Gestione giocatori dentro la casa
            // Recupera i membri che possono vedere il canale (simulando chi è "dentro")
            const membersInside = targetChannel.members.filter(m => !m.user.bot);
            
            // Trova tutte le case disponibili per lo spostamento random (escludendo quella distrutta e altre distrutte)
            const availableHouses = message.guild.channels.cache.filter(c => 
                c.parentId === ID_CATEGORIA_CASE && 
                c.type === ChannelType.GuildText && 
                c.id !== targetChannel.id &&
                !dbCache.destroyedHouses.includes(c.id)
            );

            for (const [memberId, member] of membersInside) {
                // Se è proprietario (ID_RUOLO_NOTIFICA_1) -> Casa Random
                if (member.roles.cache.has(ID_RUOLO_NOTIFICA_1)) {
                    const randomHouse = availableHouses.random();
                    if (randomHouse) {
                        await movePlayer(member, targetChannel, randomHouse, `😨 ${member} fugge dalla distruzione ed entra qui!`, false);
                    }
                } else {
                    // Se non è proprietario -> Torna a casa sua
                    const homeId = dbCache.playerHomes[memberId];
                    const homeChannel = message.guild.channels.cache.get(homeId);
                    if (homeChannel && homeChannel.id !== targetChannel.id) {
                        await movePlayer(member, targetChannel, homeChannel, `🏠 ${member} è tornato a casa dopo la distruzione.`, false);
                    }
                }
            }

            message.reply(`🏚️ La casa ${targetChannel} è stata distrutta, pin rimosso e occupanti evacuati.`);

            const annunciChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunciChannel) {
                annunciChannel.send({
                    content: `<@&${ID_RUOLO_NOTIFICA_1}> <@&${ID_RUOLO_NOTIFICA_2}>\n🏡|${formatName(targetChannel.name)} casa è stata distrutta ed è diventata inaccessibile`,
                    files: [GIF_DISTRUZIONE]
                });
            }
        }

        // [COMANDO] !ricostruzione
        if (command === 'ricostruzione') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetChannel = message.mentions.channels.first();
            if (!targetChannel || targetChannel.parentId !== ID_CATEGORIA_CASE) {
                return message.reply("❌ Devi menzionare un canale casa valido. Es: `!ricostruzione #canale-casa`");
            }

            dbCache.destroyedHouses = dbCache.destroyedHouses.filter(id => id !== targetChannel.id);
            await saveDB();

            message.reply(`🏗️ La casa ${targetChannel} è stata ricostruita e riaggiunta alla lista.`);

            const annunciChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunciChannel) {
                annunciChannel.send({
                    content: `<@&${ID_RUOLO_NOTIFICA_1}> <@&${ID_RUOLO_NOTIFICA_2}>\n:house_with_garden:|${formatName(targetChannel.name)} casa è stata ricostruita ed è nuovamente visitabile`,
                    files: [GIF_RICOSTRUZIONE]
                });
            }
        }

        // ---------------------------------------------------------
        // 👤 COMANDI GIOCATORE / MISTI
        // ---------------------------------------------------------

        // [COMANDO AGGIORNATO] !chi
        if (command === 'chi') {
            message.delete().catch(()=>{});

            let targetChannel = null;
            const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);

            if (message.channel.parentId === ID_CATEGORIA_CASE) {
                targetChannel = message.channel;
            } else if (isAdmin && message.mentions.channels.first()) {
                const mentioned = message.mentions.channels.first();
                if (mentioned.parentId === ID_CATEGORIA_CASE) {
                    targetChannel = mentioned;
                }
            }

            if (!targetChannel) {
                return message.channel.send("⛔ Devi usare questo comando dentro una casa oppure, se sei Admin, specificare la casa: `!chi #casa`.")
                    .then(m => setTimeout(() => m.delete(), 5000));
            }

            const ownerId = Object.keys(dbCache.playerHomes).find(key => dbCache.playerHomes[key] === targetChannel.id);
            let ownerMention = "Nessuno";
            if (ownerId) ownerMention = `<@${ownerId}>`;

            const targetRoleID = RUOLI_PERMESSI[0];
            
            // FILTRO: Membri con ruolo permesso MA SENZA nessuno dei ruoli spettatori
            const playersInHouse = targetChannel.members.filter(member => 
                !member.user.bot && 
                member.roles.cache.has(targetRoleID) &&
                !member.roles.cache.hasAny(...RUOLI_SPETTATORI) // [MODIFICA] Esclude spettatori
            );

            let description = "";
            if (playersInHouse.size > 0) {
                playersInHouse.forEach(p => description += `👤 ${p}\n`);
            } else {
                description = "Nessuno presente.";
            }

            const embed = new EmbedBuilder()
                .setTitle(`👥 Persone in casa: ${formatName(targetChannel.name)}`)
                .setDescription(description)
                .addFields({ name: '🔑 Proprietario', value: ownerMention, inline: false })
                .setColor('#2b2d31')
                .setTimestamp();

            message.channel.send({ embeds: [embed] }).then(msg => {
                setTimeout(() => msg.delete().catch(() => {}), 300000);
            });
        }

        if (command === 'rimaste') {
            message.delete().catch(()=>{});
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) {
                return message.channel.send("⛔ Solo chat private!").then(m => setTimeout(() => m.delete(), 5000));
            }

            if (message.member.roles.cache.hasAny(...RUOLI_PERMESSI)) {
                const base = dbCache.baseVisits[message.author.id] || DEFAULT_MAX_VISITS;
                const extra = dbCache.extraVisits[message.author.id] || 0;
                const totalLimit = base + extra;
                const used = dbCache.playerVisits[message.author.id] || 0;

                const hidden = dbCache.hiddenVisits[message.author.id] || 0;
                const forced = dbCache.forcedVisits[message.author.id] || 0;
                
                message.channel.send(`📊 **Le tue visite:**\n🏠 Normali: ${used}/${totalLimit}\n🧨 Forzate: ${forced}\n🕵️ Nascoste: ${hidden}`).then(m => setTimeout(() => m.delete(), 30000));
            }
        }

        if (command === 'torna') {
            message.delete().catch(()=>{}); 
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return;

            const homeId = dbCache.playerHomes[message.author.id];
            if (!homeId) return message.channel.send("❌ Non hai una casa."); 
            const homeChannel = message.guild.channels.cache.get(homeId);
            if (!homeChannel) return message.channel.send("❌ Casa non trovata.");

            const isVisiting = message.guild.channels.cache.some(c => 
                c.parentId === ID_CATEGORIA_CASE && 
                c.type === ChannelType.GuildText && 
                c.id !== homeId && 
                c.permissionsFor(message.member).has(PermissionsBitField.Flags.ViewChannel) 
            );

            if (!isVisiting) return message.channel.send("🏠 Sei già a casa.");

            await movePlayer(message.member, message.channel, homeChannel, `🏠 ${message.member} è ritornato.`, false);
        }

        if (command === 'bussa') {
            message.delete().catch(()=>{}); 

            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return message.channel.send(`⛔ Solo chat private!`);
            if (pendingKnocks.has(message.author.id)) return message.channel.send(`${message.author}, stai già bussando!`);

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
                        .setDescription('(Richiede visita forzata)') 
                        .setEmoji('🧨'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Visita Nascosta')
                        .setValue('mode_hidden')
                        .setDescription('(Richiede visita nascosta)') 
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
        if (interaction.customId === 'knock_mode_select') {
            if (!interaction.message.content.includes(interaction.user.id)) return interaction.reply({ content: "Non è il tuo menu.", ephemeral: true });

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
                    c.id !== currentHouseId &&
                    (!dbCache.destroyedHouses || !dbCache.destroyedHouses.includes(c.id)) 
                )
                .sort((a, b) => a.rawPosition - b.rawPosition);

            if (tutteLeCase.size === 0) return interaction.reply({ content: "❌ Nessuna casa disponibile.", ephemeral: true });

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

            await interaction.update({ 
                content: `🏘️ **Modalità scelta**. Seleziona zona:`, 
                components: [new ActionRowBuilder().addComponents(selectGroup)]
            });
        }

        if (interaction.customId === 'knock_page_select') {
            const parts = interaction.values[0].split('_'); 
            const pageIndex = parseInt(parts[1]);
            const currentMode = parts[2] + '_' + parts[3]; 

            const userHomeId = dbCache.playerHomes[interaction.user.id];
            const currentHouseChannel = interaction.guild.channels.cache.find(c => 
                c.parentId === ID_CATEGORIA_CASE && 
                c.permissionsFor(interaction.user).has(PermissionsBitField.Flags.ViewChannel)
            );
            const currentHouseId = currentHouseChannel ? currentHouseChannel.id : null;

            const tutteLeCase = interaction.guild.channels.cache
                .filter(c => 
                    c.parentId === ID_CATEGORIA_CASE && 
                    c.type === ChannelType.GuildText &&
                    c.id !== userHomeId &&
                    c.id !== currentHouseId &&
                    (!dbCache.destroyedHouses || !dbCache.destroyedHouses.includes(c.id))
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
                        .setEmoji('🏠')
                ));

            await interaction.update({ 
                content: `📂 **Scegli la casa:**`, 
                components: [new ActionRowBuilder().addComponents(selectHouse)] 
            });
        }

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
                
                // [MODIFICA RICHIESTA] Rimossa doppia scritta CASA
                return interaction.channel.send({ content: `🧨 ${knocker} ha forzato l'ingresso in 🏡| ${formatName(targetChannel.name)}` });
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
                
                // [MODIFICA RICHIESTA] Rimossa doppia scritta CASA
                return interaction.channel.send({ content: `🕵️ ${knocker} sei entrato in modalità nascosta in 🏡| ${formatName(targetChannel.name)}` });
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
                await interaction.channel.send({ content: `🔓 La porta è aperta...` }).then(m => setTimeout(() => m.delete(), 5000));
                await enterHouse(knocker, interaction.channel, targetChannel, `👋 ${knocker} è entrato.`, false);
            } else {
                await interaction.channel.send({ content: `✊ ${knocker} ha bussato a **${formatName(targetChannel.name)}**.` });
                
                const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(' ');
                const msg = await targetChannel.send(
                    `🔔 **TOC TOC!** ${roleMentions}\n**Qualcuno** sta bussando!\nAvete **5 minuti** per rispondere.\n\n✅ = Apri | ❌ = Rifiuta`
                );
                await msg.react('✅');
                await msg.react('❌');

                const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && membersWithAccess.has(user.id);
                const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

                collector.on('collect', async (reaction, user) => {
                    if (reaction.emoji.name === '✅') {
                        msg.edit(`✅ **${user.displayName}** ha aperto.`);
                        pendingKnocks.delete(knocker.id);
                        await enterHouse(knocker, interaction.channel, targetChannel, `👋 **${knocker}** è entrato.`, false);
                    } else {
                        const currentRefused = dbCache.playerVisits[knocker.id] || 0;
                        dbCache.playerVisits[knocker.id] = currentRefused + 1;
                        await saveDB();

                        msg.edit(`❌ **${user.displayName}** ha rifiutato.`);
                        pendingKnocks.delete(knocker.id);
                        await interaction.channel.send(`⛔ ${knocker}, rifiutato. Hai perso la visita.`);
                    }
                });

                collector.on('end', async (collected) => {
                    if (collected.size === 0) {
                        pendingKnocks.delete(knocker.id);
                        await targetChannel.send("⏳ Nessuno ha risposto. La porta viene forzata.");
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
    // [MODIFICA] Ritorna sempre "CASA X", ma nei log è stato rimosso "CASA" statico prima
    return name.replace(/-/g, ' ').toUpperCase().substring(0, 25);
}

async function enterHouse(member, fromChannel, toChannel, entryMessage, isSilent) {
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

    // Gestione Uscita
    let channelToLeave = oldChannel;
    // Se è in chat privata, cerchiamo in quale casa si trova veramente
    if (oldChannel && oldChannel.parentId === ID_CATEGORIA_CHAT_PRIVATE) {
        const currentHouse = oldChannel.guild.channels.cache.find(c => 
            c.parentId === ID_CATEGORIA_CASE && 
            c.permissionsFor(member).has(PermissionsBitField.Flags.ViewChannel)
        );
        if (currentHouse) channelToLeave = currentHouse;
    } else if (oldChannel.parentId === ID_CATEGORIA_CASE) {
        channelToLeave = oldChannel;
    }

    if (channelToLeave && channelToLeave.id !== newChannel.id) {
        if (channelToLeave.parentId === ID_CATEGORIA_CASE) {
            const prevMode = dbCache.playerModes[member.id];
            // [MODIFICA] Se la modalità precedente non era hidden, narra l'uscita
            if (prevMode !== 'HIDDEN') {
                await channelToLeave.send(`🚪 ${member} è uscito.`);
            }
            await channelToLeave.permissionOverwrites.delete(member.id).catch(() => {});
        }
    }

    // Gestione Entrata
    await newChannel.permissionOverwrites.create(member.id, { ViewChannel: true, SendMessages: true });
    dbCache.playerModes[member.id] = isSilent ? 'HIDDEN' : 'NORMAL';
    await saveDB();

    if (!isSilent && entryMessage) await newChannel.send(entryMessage);
}

client.login(TOKEN);

