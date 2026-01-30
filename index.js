const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder,
    EmbedBuilder,
    ChannelType,
    PermissionsBitField,
    Partials,
    ButtonStyle,
    ButtonBuilder
} = require('discord.js');

const express = require('express'); // Per Health Check Koyeb

// ==========================================
// ⚙️ CONFIGURAZIONE (MODIFICA QUI!)
// ==========================================

const TOKEN = 'MTQ2MzU5NDkwMTAzOTIyMjg3Nw.G2ZqJU.HRxjqWMs2fIwblzW2B2SUXcYhUZ8BkeWioLmss'; 
const PREFIX = '!';

// ID UTILI
const ID_CATEGORIA_CASE = '1460741413388947528';
const ID_CANALE_DB = '1465768646906220700'; 
const ID_CATEGORIA_CHAT_PRIVATE = '1460741414357827747'; 

// Configurazione Distruzione/Ricostruzione
const ID_CANALE_ANNUNCI = '1460741475804381184'; 
const ID_RUOLO_NOTIFICA_1 = '1460741403331268661'; // Usato anche per !trasferimento
const ID_RUOLO_NOTIFICA_2 = '1460741404497019002';

// Ruoli per comando !pubblico
const RUOLI_PUBBLICI = [
    '1460741403331268661', 
    '1460741404497019002', 
    '1460741405722022151'
];

// Link alle GIF
const GIF_DISTRUZIONE = 'https://i.giphy.com/media/oe33xf3B50fsc/giphy.gif'; 
const GIF_RICOSTRUZIONE = 'https://i.giphy.com/media/3ohjUS0WqYBpczfTlm/giphy.gif'; 

// RUOLI CHE POSSONO RISPONDERE AL BUSSARE (ID Ruoli Discord)
const RUOLI_PERMESSI = [
    '1460741403331268661', 
    '1460741404497019002'
]; 

const DEFAULT_MAX_VISITS = 0;

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
    playerVisits: {},  // Contatore visite usate
    
    // VISITE STANDARD (NOTTE/BASE)
    baseVisits: {},    
    extraVisits: {},   
    forcedLimits: {},  
    hiddenLimits: {},  
    
    // [NUOVO] VISITE GIORNO
    dayLimits: {}, // { userId: { base: 0, forced: 0, hidden: 0 } }
    extraVisitsDay: {}, // Extra specifichi per il giorno

    // STATO CORRENTE
    currentMode: 'NIGHT', // 'NIGHT' (Visite) o 'DAY' (Giorno)

    // Contatori dinamici (resettati al cambio modo)
    forcedVisits: {},  
    hiddenVisits: {},  
    
    playerModes: {},   
    destroyedHouses: [],
    
    multiplaHistory: {}, 
    
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
                if (!dbCache.multiplaHistory) dbCache.multiplaHistory = {};
                
                // [NUOVO]
                if (!dbCache.dayLimits) dbCache.dayLimits = {};
                if (!dbCache.extraVisitsDay) dbCache.extraVisitsDay = {};
                if (!dbCache.currentMode) dbCache.currentMode = 'NIGHT';

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

        if (jsonString.length > 1900) {
             await channel.send(`\`\`\`json\n${jsonString}\n\`\`\``);
        } else {
             await channel.send(`\`\`\`json\n${jsonString}\n\`\`\``);
        }
    } catch (e) {
        console.error("❌ Errore salvataggio DB:", e);
    }
}

function applyLimitsForMode() {
    dbCache.playerVisits = {}; 
    
    const allUsers = new Set([
        ...Object.keys(dbCache.playerHomes),
        ...Object.keys(dbCache.baseVisits),
        ...Object.keys(dbCache.dayLimits)
    ]);

    allUsers.forEach(userId => {
        if (dbCache.currentMode === 'DAY') {
            const limits = dbCache.dayLimits[userId] || { forced: 0, hidden: 0 };
            dbCache.forcedVisits[userId] = limits.forced;
            dbCache.hiddenVisits[userId] = limits.hidden;
        } else {
            dbCache.forcedVisits[userId] = dbCache.forcedLimits[userId] || 0;
            dbCache.hiddenVisits[userId] = dbCache.hiddenLimits[userId] || 0;
        }
    });
}

// Funzione helper per pulire la vecchia casa
async function cleanOldHome(userId, guild) {
    const oldHomeId = dbCache.playerHomes[userId];
    if (oldHomeId) {
        const oldChannel = guild.channels.cache.get(oldHomeId);
        if (oldChannel) {
            try {
                const pinnedMessages = await oldChannel.messages.fetchPinned();
                const keyMsg = pinnedMessages.find(m => m.content.includes("questa è la tua dimora privata"));
                if (keyMsg) await keyMsg.delete();
            } catch (err) {
                console.log("Errore rimozione pin vecchia casa:", err);
            }
        }
    }
}

client.once('ready', async () => {
    console.log(`✅ Bot Online come ${client.user.tag}!`);
    await loadDB();
    
    const today = new Date().toDateString();
    if (dbCache.lastReset !== today) {
        applyLimitsForMode();
        dbCache.lastReset = today;
        await saveDB();
        console.log("🔄 Contatori ripristinati per nuovo giorno.");
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

            if (dbCache.currentMode === 'NIGHT') {
                dbCache.forcedVisits[targetUser.id] = forcedInput;
                dbCache.hiddenVisits[targetUser.id] = hiddenInput;
            }
            
            await saveDB();
            message.reply(`✅ Configurazione Notte/Standard salvata per ${targetUser}.`);
        }

        if (command === 'giorno') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            const baseInput = parseInt(args[1]);
            const forcedInput = parseInt(args[2]);
            const hiddenInput = parseInt(args[3]);

            if (!targetUser || isNaN(baseInput) || isNaN(forcedInput) || isNaN(hiddenInput)) {
                return message.reply("❌ Uso: `!giorno @Utente [Base] [Forzate] [Nascoste]`");
            }

            dbCache.dayLimits[targetUser.id] = {
                base: baseInput,
                forced: forcedInput,
                hidden: hiddenInput
            };

            if (dbCache.currentMode === 'DAY') {
                dbCache.forcedVisits[targetUser.id] = forcedInput;
                dbCache.hiddenVisits[targetUser.id] = hiddenInput;
            }

            await saveDB();
            message.reply(`✅ Configurazione Giorno salvata per ${targetUser}.`);
        }

        if (command === 'aggiunta') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const isDayAdd = args[0].toLowerCase() === 'giorno';
            const typeIndex = isDayAdd ? 1 : 0;
            const userIndex = isDayAdd ? 2 : 1;
            const amountIndex = isDayAdd ? 3 : 2;

            const type = args[typeIndex] ? args[typeIndex].toLowerCase() : null;
            const targetUser = message.mentions.members.first();
            const amount = parseInt(args[amountIndex]);

            if (!type || !targetUser || isNaN(amount) || !['base', 'nascosta', 'forzata'].includes(type)) {
                return message.reply(`❌ Uso:\n\`!aggiunta base/nascosta/forzata @Utente Num\`\n\`!aggiunta giorno base/nascosta/forzata @Utente Num\``);
            }
            
            if (isDayAdd) {
                if (type === 'base') dbCache.extraVisitsDay[targetUser.id] = (dbCache.extraVisitsDay[targetUser.id] || 0) + amount;
                else if (type === 'nascosta') {
                    if (dbCache.currentMode === 'DAY') dbCache.hiddenVisits[targetUser.id] = (dbCache.hiddenVisits[targetUser.id] || 0) + amount;
                    else return message.reply("⚠ Puoi aggiungere visite Giorno solo se è attiva la modalità Giorno.");
                }
                else if (type === 'forzata') {
                    if (dbCache.currentMode === 'DAY') dbCache.forcedVisits[targetUser.id] = (dbCache.forcedVisits[targetUser.id] || 0) + amount;
                    else return message.reply("⚠ Puoi aggiungere visite Giorno solo se è attiva la modalità Giorno.");
                }
                message.reply(`✅ Aggiunte visite (GIORNO) a ${targetUser}.`);
            } else {
                if (type === 'base') dbCache.extraVisits[targetUser.id] = (dbCache.extraVisits[targetUser.id] || 0) + amount;
                else if (type === 'nascosta') {
                    if (dbCache.currentMode === 'NIGHT') dbCache.hiddenVisits[targetUser.id] = (dbCache.hiddenVisits[targetUser.id] || 0) + amount;
                    else return message.reply("⚠ Puoi aggiungere visite Standard solo se è attiva la modalità Standard/Visite.");
                }
                else if (type === 'forzata') {
                    if (dbCache.currentMode === 'NIGHT') dbCache.forcedVisits[targetUser.id] = (dbCache.forcedVisits[targetUser.id] || 0) + amount;
                    else return message.reply("⚠ Puoi aggiungere visite Standard solo se è attiva la modalità Standard/Visite.");
                }
                message.reply(`✅ Aggiunte visite (STANDARD) a ${targetUser}.`);
            }

            await saveDB();
        }

        if (command === 'resetvisite') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            if (dbCache.currentMode === 'NIGHT') {
                dbCache.currentMode = 'DAY';
                message.channel.send("☀️ **MODALITÀ GIORNO ATTIVATA** ☀️\nCaricamento visite diurne...");
            } else {
                dbCache.currentMode = 'NIGHT';
                message.channel.send("🌙 **MODALITÀ NOTTE/VISITE ATTIVATA** 🌙\nCaricamento visite standard...");
            }

            applyLimitsForMode();
            await saveDB();
            message.reply("🔄 Contatori aggiornati in base alla nuova modalità.");
        }

        if (command === 'distruzione') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetChannel = message.mentions.channels.first();
            if (!targetChannel || targetChannel.parentId !== ID_CATEGORIA_CASE) {
                return message.reply("❌ Devi menzionare un canale casa valido. Es: `!distruzione #canale-casa`");
            }

            if (!dbCache.destroyedHouses.includes(targetChannel.id)) {
                dbCache.destroyedHouses.push(targetChannel.id);
            }

            for (const roleId of RUOLI_PUBBLICI) {
                if (roleId) await targetChannel.permissionOverwrites.delete(roleId).catch(() => {});
            }
            
            await saveDB();

            const pinnedMessages = await targetChannel.messages.fetchPinned();
            const keyMsg = pinnedMessages.find(m => m.content.includes("questa è la tua dimora privata"));
            if (keyMsg) await keyMsg.delete();

            const membersInside = targetChannel.members.filter(m => !m.user.bot && m.id !== message.member.id);
            const ownerId = Object.keys(dbCache.playerHomes).find(key => dbCache.playerHomes[key] === targetChannel.id);

            for (const [memberId, member] of membersInside) {
                const isOwner = (ownerId === member.id);
                
                await targetChannel.permissionOverwrites.delete(member.id).catch(() => {});

                if (isOwner) {
                    // Proprietario -> Casa random
                    const randomHouse = message.guild.channels.cache
                        .filter(c => c.parentId === ID_CATEGORIA_CASE && c.id !== targetChannel.id && !dbCache.destroyedHouses.includes(c.id))
                        .random();
                    
                    if (randomHouse) {
                        await movePlayer(member, targetChannel, randomHouse, `${member} è entrato (casa distrutta).`, false);
                    }
                } else {
                    // Ospite -> Torna a casa sua (se esiste)
                    const homeId = dbCache.playerHomes[member.id];
                    
                    if (homeId && homeId !== targetChannel.id && !dbCache.destroyedHouses.includes(homeId)) {
                        const homeChannel = message.guild.channels.cache.get(homeId);
                        if (homeChannel) {
                            await movePlayer(member, targetChannel, homeChannel, `🏠 ${member} è ritornato (casa distrutta).`, false);
                        }
                    } 
                }
            }

            message.reply(`🏚️ La casa ${targetChannel} è stata distrutta.`);

            const annunciChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunciChannel) {
                annunciChannel.send({
                    content: `<@&${ID_RUOLO_NOTIFICA_1}> <@&${ID_RUOLO_NOTIFICA_2}>\n🏡|${formatName(targetChannel.name)} casa è stata distrutta ed è diventata inaccessibile`,
                    files: [GIF_DISTRUZIONE]
                });
            }
        }

        // [MODIFICATO] !ricostruzione
        if (command === 'ricostruzione') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetChannel = message.mentions.channels.first();
            if (!targetChannel || targetChannel.parentId !== ID_CATEGORIA_CASE) {
                return message.reply("❌ Devi menzionare un canale casa valido. Es: `!ricostruzione #canale-casa`");
            }

            dbCache.destroyedHouses = dbCache.destroyedHouses.filter(id => id !== targetChannel.id);

            // [MODIFICA RICHIESTA]: Rimuove il vecchio proprietario dal DB in modo che non possa tornare
            const exOwners = Object.keys(dbCache.playerHomes).filter(uid => dbCache.playerHomes[uid] === targetChannel.id);
            for (const uid of exOwners) {
                delete dbCache.playerHomes[uid];
            }

            await saveDB();

            message.reply(`🏗️ La casa ${targetChannel} è stata ricostruita. I vecchi proprietari hanno perso il diritto di proprietà.`);

            const annunciChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunciChannel) {
                annunciChannel.send({
                    content: `<@&${ID_RUOLO_NOTIFICA_1}> <@&${ID_RUOLO_NOTIFICA_2}>\n:house_with_garden:|${formatName(targetChannel.name)} casa è stata ricostruita ed è nuovamente visitabile`,
                    files: [GIF_RICOSTRUZIONE]
                });
            }
        }

        if (command === 'pubblico') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            if (message.channel.parentId !== ID_CATEGORIA_CASE) return message.reply("⛔ Usalo in una casa.");

            const channel = message.channel;
            if (dbCache.destroyedHouses.includes(channel.id)) return message.reply("❌ Questa casa è distrutta!");

            const isAlreadyPublic = channel.permissionOverwrites.cache.has(RUOLI_PUBBLICI[0]);

            if (isAlreadyPublic) {
                for (const roleId of RUOLI_PUBBLICI) {
                    if (roleId && roleId !== '') await channel.permissionOverwrites.delete(roleId).catch(() => {});
                }
                message.reply("🔒 La casa è tornata **PRIVATA**.");
            } else {
                for (const roleId of RUOLI_PUBBLICI) {
                    if (roleId && roleId !== '') {
                        await channel.permissionOverwrites.create(roleId, {
                            ViewChannel: true,
                            SendMessages: false,
                            AddReactions: false,
                            CreatePublicThreads: false,
                            CreatePrivateThreads: false
                        });
                    }
                }
                
                const tag1 = `<@&${ID_RUOLO_NOTIFICA_1}>`;
                const tag2 = `<@&${ID_RUOLO_NOTIFICA_2}>`;
                message.channel.send(`📢 **LA CASA È ORA PUBBLICA!** ${tag1} ${tag2}`);
            }
        }

        if (command === 'sposta') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            const targetChannel = message.mentions.channels.first();

            if (!targetUser || !targetChannel) return message.reply("❌ Uso: `!sposta @Utente #canale`");

            await movePlayer(targetUser, message.channel, targetChannel, `👋 **${targetUser}** è entrato.`, false);
            message.reply(`✅ ${targetUser} spostato in ${targetChannel}.`);
        }

        // [MODIFICATO] !trasporto
        if (command === 'trasporto') {
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return; // Solo chat admin
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            // Sintassi: !trasporto @u1 @u2 #destinazione
            const targetChannel = message.mentions.channels.first();
            const membersToMove = message.mentions.members.filter(m => !m.user.bot);

            if (!targetChannel || membersToMove.size < 1) {
                return message.reply("❌ Uso: `!trasporto @Utente1 @Utente2 ... #CanaleDestinazione`");
            }

            // Controllo che siano tutti nella stessa casa
            let startHouseId = null;
            let allTogether = true;

            for (const [id, member] of membersToMove) {
                const currentHouse = message.guild.channels.cache.find(c => 
                    c.parentId === ID_CATEGORIA_CASE && 
                    c.type === ChannelType.GuildText && 
                    c.permissionOverwrites.cache.has(member.id)
                );

                if (!currentHouse) {
                    allTogether = false;
                    break; 
                }

                if (startHouseId === null) {
                    startHouseId = currentHouse.id;
                } else if (startHouseId !== currentHouse.id) {
                    allTogether = false;
                    break;
                }
            }

            if (!allTogether || !startHouseId) {
                return message.reply("❌ **Errore Trasporto:** Tutti i giocatori specificati devono trovarsi nella stessa casa per essere trasportati insieme!");
            }

            const startChannel = message.guild.channels.cache.get(startHouseId);
            const memberArray = Array.from(membersToMove.values());
            
            // Costruzione stringhe narrazione richiesta
            const firstUser = memberArray[0];
            const others = memberArray.slice(1);
            let othersString = others.length > 0 ? ` seguito da ${others.map(m => m.toString()).join(', ')}` : "";

            const exitMsg = `🚪 ${firstUser}${othersString} è uscito.`;
            const enterMsg = `👋 ${firstUser}${othersString} è entrato.`;

            // Rimuovi permessi vecchia casa
            for (const member of memberArray) {
                if (startChannel) await startChannel.permissionOverwrites.delete(member.id).catch(()=>{});
            }
            if (startChannel) await startChannel.send(exitMsg);

            // Aggiungi permessi nuova casa
            for (const member of memberArray) {
                await targetChannel.permissionOverwrites.create(member.id, { ViewChannel: true, SendMessages: true });
                dbCache.playerModes[member.id] = 'NORMAL';
            }
            await targetChannel.send(enterMsg);

            await saveDB();
            message.reply(`✅ Trasporto di gruppo effettuato verso ${targetChannel}.`);
        }
        
        // [NUOVO] !dove
        if (command === 'dove') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            if (!targetUser) return message.reply("❌ Uso: `!dove @Utente`");

            // Cerca la casa dove l'utente ha permessi di visione ATTUALI (dove è fisicamente)
            const location = message.guild.channels.cache.find(c => 
                c.parentId === ID_CATEGORIA_CASE && 
                c.type === ChannelType.GuildText && 
                c.permissionOverwrites.cache.has(targetUser.id)
            );

            if (location) {
                message.reply(`📍 **${targetUser.displayName}** si trova attualmente in: ${location} (ID: ${location.id})`);
            } else {
                message.reply(`❌ **${targetUser.displayName}** non si trova in nessuna casa al momento.`);
            }
        }

        if (command === 'multipla') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetUser = message.mentions.members.first();
            if (!targetUser) return message.reply("❌ Uso: `!multipla @Utente #casa1 ... si #casa2 ...`");

            if (!dbCache.multiplaHistory[targetUser.id]) {
                dbCache.multiplaHistory[targetUser.id] = [];
            }

            const rawArgs = message.content.slice(PREFIX.length + command.length).trim().split(/ +/);
            
            let canWrite = false; 
            let processedCount = 0;

            for (const arg of rawArgs) {
                if (arg.includes(targetUser.id)) continue;
                if (arg.toLowerCase() === 'si') {
                    canWrite = true;
                    continue;
                }

                if (arg.match(/^<#(\d+)>$/)) {
                    const channelId = arg.replace(/\D/g, '');
                    const channel = message.guild.channels.cache.get(channelId);

                    if (channel && channel.parentId === ID_CATEGORIA_CASE) {
                        if (!dbCache.multiplaHistory[targetUser.id].includes(channel.id)) {
                            dbCache.multiplaHistory[targetUser.id].push(channel.id);
                        }

                        await channel.permissionOverwrites.create(targetUser.id, {
                            ViewChannel: true,
                            SendMessages: canWrite,
                            AddReactions: canWrite,
                            CreatePublicThreads: canWrite,
                            CreatePrivateThreads: canWrite
                        });
                        processedCount++;
                    }
                }
            }
            
            await saveDB();
            message.reply(`✅ Configurazione multipla applicata a ${processedCount} canali per ${targetUser}.`);
        }

        if (command === 'ritirata') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetUser = message.mentions.members.first();
            if (!targetUser) return message.reply("❌ Uso: `!ritirata @Utente #daRimuovere ... si/no`");

            const rawArgs = message.content.slice(PREFIX.length + command.length).trim().split(/ +/);
            const modeArg = rawArgs[rawArgs.length - 1].toLowerCase(); 

            const channelsToRemove = [];
            message.mentions.channels.forEach(c => channelsToRemove.push(c.id));

            let removedCount = 0;
            for (const cid of channelsToRemove) {
                const channel = message.guild.channels.cache.get(cid);
                if (channel) {
                    await channel.permissionOverwrites.delete(targetUser.id).catch(() => {});
                    removedCount++;
                }
            }

            let history = dbCache.multiplaHistory[targetUser.id] || [];
            history = history.filter(hid => !channelsToRemove.includes(hid));
            dbCache.multiplaHistory[targetUser.id] = history;

            if (modeArg === 'si' || modeArg === 'no') {
                const canWrite = (modeArg === 'si');
                for (const hid of history) {
                    const ch = message.guild.channels.cache.get(hid);
                    if (ch) {
                        await ch.permissionOverwrites.create(targetUser.id, {
                            ViewChannel: true,
                            SendMessages: canWrite,
                            AddReactions: canWrite
                        });
                    }
                }
                message.reply(`✅ Rimossi ${removedCount} canali. I restanti (${history.length}) sono stati impostati su Scrittura: **${modeArg.toUpperCase()}**.`);
            } else {
                message.reply(`✅ Rimossi ${removedCount} canali. Nessuna modifica ai restanti.`);
            }

            await saveDB();
        }

        // ---------------------------------------------------------
        // 👤 COMANDI GIOCATORE / NUOVI
        // ---------------------------------------------------------

        // [MODIFICATO] !trasferimento
        if (command === 'trasferimento') {
            if (message.channel.parentId !== ID_CATEGORIA_CASE) return message.delete().catch(()=>{});

            // Controllo ruolo
            if (!message.member.roles.cache.has(ID_RUOLO_NOTIFICA_1)) {
                return message.channel.send("⛔ Non hai il ruolo per trasferirti.").then(m => setTimeout(() => m.delete(), 5000));
            }

            const requester = message.author;
            const newHomeChannel = message.channel;

            // Trova proprietario esistente
            const ownerId = Object.keys(dbCache.playerHomes).find(key => dbCache.playerHomes[key] === message.channel.id);
            
            // Caso 1: Casa vuota = assegnazione automatica
            if (!ownerId) {
                // PULIZIA VECCHIA CASA
                await cleanOldHome(requester.id, message.guild);

                dbCache.playerHomes[requester.id] = newHomeChannel.id;
                await saveDB();

                await newHomeChannel.permissionOverwrites.edit(requester.id, { ViewChannel: true, SendMessages: true });
                const pinnedMsg = await newHomeChannel.send(`🔑 **${requester}**, questa è la tua dimora privata (Trasferimento automatico).`);
                await pinnedMsg.pin();
                return message.reply("✅ Trasferimento completato! La casa era vuota e ora è tua.");
            }

            // Caso 2: Casa occupata = richiesta permesso
            const owner = message.guild.members.cache.get(ownerId);
            if (!owner) return message.channel.send("❌ Proprietario della casa non trovato nel server (DB Errore).");

            const confirmEmbed = new EmbedBuilder()
                .setTitle("Richiesta di Trasferimento 📦")
                .setDescription(`${requester} vuole trasferirsi presso **${formatName(newHomeChannel.name)}** e diventarne comproprietario.\nAccetti?`)
                .setColor('Blue');

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`transfer_yes_${requester.id}`).setLabel('Accetta ✅').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`transfer_no_${requester.id}`).setLabel('Rifiuta ❌').setStyle(ButtonStyle.Danger)
                );

            // Verifica se il proprietario è IN CASA (ha i permessi di visualizzazione)
            const isOwnerHome = newHomeChannel.permissionsFor(owner).has(PermissionsBitField.Flags.ViewChannel);
            let msg;
            let targetChannelForButtons;

            if (isOwnerHome) {
                // Proprietario in casa -> manda messaggio nel canale
                targetChannelForButtons = newHomeChannel;
                msg = await newHomeChannel.send({ 
                    content: `🔔 **Richiesta Trasferimento!** <@${owner.id}>`, 
                    embeds: [confirmEmbed], 
                    components: [row] 
                });
            } else {
                // Proprietario fuori casa -> manda messaggio in Chat Private
                const privateChat = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_PRIVATE);
                if (privateChat) {
                    targetChannelForButtons = privateChat;
                    msg = await privateChat.send({
                        content: `🔔 **Richiesta Trasferimento per casa tua!** <@${owner.id}> (L'utente si trova in ${newHomeChannel})`,
                        embeds: [confirmEmbed],
                        components: [row]
                    });
                    message.channel.send(`📩 Il proprietario non è in casa. Ho inviato la richiesta sulla sua linea privata.`);
                } else {
                    return message.channel.send("❌ Errore canale chat private.");
                }
            }

            const filter = i => i.user.id === owner.id;
            const collector = msg.createMessageComponentCollector({ filter, time: 300000, max: 1 });

            collector.on('collect', async i => {
                if (i.customId === `transfer_yes_${requester.id}`) {
                    await i.update({ content: `✅ **${owner.displayName}** ha accettato il trasferimento!`, embeds: [], components: [] });

                    // PULIZIA VECCHIA CASA
                    await cleanOldHome(requester.id, message.guild);

                    // Aggiorna DB
                    dbCache.playerHomes[requester.id] = newHomeChannel.id;
                    await saveDB();

                    // Imposta permessi canale
                    await newHomeChannel.permissionOverwrites.edit(requester.id, { ViewChannel: true, SendMessages: true });

                    const newKeyMsg = await newHomeChannel.send(`🔑 ${requester}, questa è la tua nuova dimora privata (Comproprietario).`);
                    await newKeyMsg.pin();

                    if (!isOwnerHome) {
                        newHomeChannel.send(`✅ **${owner.displayName}** (da remoto) ha accettato il trasferimento di ${requester}!`);
                    }

                } else {
                    await i.update({ content: `❌ **${owner.displayName}** ha rifiutato il trasferimento.`, embeds: [], components: [] });
                    
                    if (!isOwnerHome) {
                        newHomeChannel.send(`❌ **${owner.displayName}** (da remoto) ha rifiutato il trasferimento.`);
                    }

                    const notificationChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
                    if (notificationChannel) {
                        notificationChannel.send(`<@&${ID_RUOLO_NOTIFICA_1}>: Il trasferimento di ${requester} presso ${newHomeChannel} è stato RIFIUTATO dal proprietario.`);
                    }
                }
            });
        }

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
                return message.channel.send("⛔ Devi usare questo comando dentro una casa.").then(m => setTimeout(() => m.delete(), 5000));
            }

            const ownerId = Object.keys(dbCache.playerHomes).find(key => dbCache.playerHomes[key] === targetChannel.id);
            let ownerMention = "Nessuno";
            if (ownerId) ownerMention = `<@${ownerId}>`;

            const playersInHouse = targetChannel.members.filter(member => 
                !member.user.bot && 
                targetChannel.permissionOverwrites.cache.has(member.id)
            );

            let description = "";
            if (playersInHouse.size > 0) {
                playersInHouse.forEach(p => description += `👤 ${p}\n`);
            } else {
                description = "Nessuno (o solo osservatori).";
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
                let base, extra, hidden, forced;

                if (dbCache.currentMode === 'DAY') {
                     const limits = dbCache.dayLimits[message.author.id] || { base: 0 };
                     base = limits.base;
                     extra = dbCache.extraVisitsDay[message.author.id] || 0;
                } else {
                     base = dbCache.baseVisits[message.author.id] || DEFAULT_MAX_VISITS;
                     extra = dbCache.extraVisits[message.author.id] || 0;
                }

                const totalLimit = base + extra;
                const used = dbCache.playerVisits[message.author.id] || 0;

                hidden = dbCache.hiddenVisits[message.author.id] || 0;
                forced = dbCache.forcedVisits[message.author.id] || 0;
                
                const modeStr = dbCache.currentMode === 'DAY' ? "☀️ GIORNO" : "🌙 NOTTE";

                message.channel.send(`📊 **Le tue visite (${modeStr}):**\n🏠 Normali: ${used}/${totalLimit}\n🧨 Forzate: ${forced}\n🕵️ Nascoste: ${hidden}`).then(m => setTimeout(() => m.delete(), 30000));
            }
        }

        // [MODIFICATO] !torna
        if (command === 'torna') {
            message.delete().catch(()=>{}); 
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return;

            const homeId = dbCache.playerHomes[message.author.id];
            
            // [MODIFICA RICHIESTA]: Messaggio specifico se la casa non esiste (ricostruita/cancellata)
            if (!homeId) {
                return message.channel.send("❌ **Non hai una casa!** Potrebbe essere stata distrutta e ricostruita. Devi cercarne una nuova."); 
            }
            
            if (dbCache.destroyedHouses.includes(homeId)) {
                return message.channel.send("🏚️ **Casa tua è stata distrutta!** Non puoi tornarci.");
            }

            const homeChannel = message.guild.channels.cache.get(homeId);
            if (!homeChannel) return message.channel.send("❌ Canale casa non trovato.");

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
    // Gestione bottoni (es. trasferimento) e menu
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

            if (mode === 'mode_forced') {
                const forcedAvailable = dbCache.forcedVisits[knocker.id] || 0;
                if (forcedAvailable <= 0) {
                    return interaction.reply({ content: "⛔ Non hai visite forzate disponibili (per la modalità attuale)!", ephemeral: true });
                }

                dbCache.forcedVisits[knocker.id] = forcedAvailable - 1;
                await saveDB();

                await interaction.message.delete().catch(()=>{});
                
                const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(', ');
                const narrazioneForzata = `${roleMentions}, ${knocker} ha sfondato la porta ed è entrato`;

                await enterHouse(knocker, interaction.channel, targetChannel, narrazioneForzata, false);
                
                return interaction.channel.send({ content: `🧨 ${knocker} ha forzato l'ingresso in 🏡| ${formatName(targetChannel.name)}` });
            }

            if (mode === 'mode_hidden') {
                const hiddenAvailable = dbCache.hiddenVisits[knocker.id] || 0;
                if (hiddenAvailable <= 0) {
                    return interaction.reply({ content: "⛔ Non hai visite nascoste disponibili (per la modalità attuale)!", ephemeral: true });
                }

                dbCache.hiddenVisits[knocker.id] = hiddenAvailable - 1;
                await saveDB();

                await interaction.message.delete().catch(()=>{});
                await enterHouse(knocker, interaction.channel, targetChannel, "", true); 
                
                return interaction.channel.send({ content: `🕵️ ${knocker} sei entrato in modalità nascosta in 🏡| ${formatName(targetChannel.name)}` });
            }

            let base, extra;
            if (dbCache.currentMode === 'DAY') {
                const limits = dbCache.dayLimits[knocker.id] || { base: 0 };
                base = limits.base;
                extra = dbCache.extraVisitsDay[knocker.id] || 0;
            } else {
                base = dbCache.baseVisits[knocker.id] || DEFAULT_MAX_VISITS;
                extra = dbCache.extraVisits[knocker.id] || 0;
            }

            const userLimit = base + extra;
            const used = dbCache.playerVisits[knocker.id] || 0;
            
            if (used >= userLimit) return interaction.reply({ content: `⛔ Visite normali finite (Modalità: ${dbCache.currentMode})!`, ephemeral: true });

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

                        msg.edit(`❌ Qualcuno ha rifiutato l'accesso.`);
                        pendingKnocks.delete(knocker.id);

                        const peopleInside = targetChannel.members.filter(m => 
                            !m.user.bot && 
                            targetChannel.permissionOverwrites.cache.has(m.id)
                        );
                        
                        const namesList = peopleInside.map(m => m.displayName).join(', ') || "Nessuno visibile";

                        await interaction.channel.send(`⛔ ${knocker}, rifiutato. Hai perso la visita.\n**Persone presenti:** ${namesList}`);
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

    let channelToLeave = oldChannel;
    
    if (oldChannel && oldChannel.parentId === ID_CATEGORIA_CHAT_PRIVATE) {
        const currentHouse = oldChannel.guild.channels.cache.find(c => 
            c.parentId === ID_CATEGORIA_CASE && 
            c.permissionsFor(member).has(PermissionsBitField.Flags.ViewChannel)
        );
        if (currentHouse) channelToLeave = currentHouse;
    }

    if (channelToLeave && channelToLeave.id !== newChannel.id) {
        if (channelToLeave.parentId === ID_CATEGORIA_CASE) {
            const prevMode = dbCache.playerModes[member.id];
            if (prevMode !== 'HIDDEN') {
                await channelToLeave.send(`🚪 ${member} è uscito.`);
            }
            await channelToLeave.permissionOverwrites.delete(member.id).catch(() => {});
        }
    }

    await newChannel.permissionOverwrites.create(member.id, { ViewChannel: true, SendMessages: true });
    dbCache.playerModes[member.id] = isSilent ? 'HIDDEN' : 'NORMAL';
    await saveDB();

    if (!isSilent) await newChannel.send(entryMessage);
}

client.login(TOKEN);
