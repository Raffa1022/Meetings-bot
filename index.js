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

        // Splitta se troppo lungo (fallback base)
        if (jsonString.length > 1900) {
             // Semplice gestione chunk se necessario, qui inviamo diretto
             await channel.send(`\`\`\`json\n${jsonString}\n\`\`\``);
        } else {
             await channel.send(`\`\`\`json\n${jsonString}\n\`\`\``);
        }
    } catch (e) {
        console.error("❌ Errore salvataggio DB:", e);
    }
}

// [MODIFICATO] Funzione reset che applica i limiti in base alla modalità corrente
function applyLimitsForMode() {
    dbCache.playerVisits = {}; // Resetta contatore usate
    
    // Elenco di tutti gli utenti conosciuti
    const allUsers = new Set([
        ...Object.keys(dbCache.playerHomes),
        ...Object.keys(dbCache.baseVisits),
        ...Object.keys(dbCache.dayLimits)
    ]);

    allUsers.forEach(userId => {
        if (dbCache.currentMode === 'DAY') {
            // Carica limiti giorno
            const limits = dbCache.dayLimits[userId] || { forced: 0, hidden: 0 };
            dbCache.forcedVisits[userId] = limits.forced;
            dbCache.hiddenVisits[userId] = limits.hidden;
        } else {
            // Carica limiti notte/visite standard
            dbCache.forcedVisits[userId] = dbCache.forcedLimits[userId] || 0;
            dbCache.hiddenVisits[userId] = dbCache.hiddenLimits[userId] || 0;
        }
    });
}

client.once('ready', async () => {
    console.log(`✅ Bot Online come ${client.user.tag}!`);
    await loadDB();
    
    const today = new Date().toDateString();
    if (dbCache.lastReset !== today) {
        // Reset giornaliero automatico (mantiene la modalità attuale ma ricarica i contatori)
        applyLimitsForMode();
        dbCache.lastReset = today;
        await saveDB();
        console.log("🔄 Contatori ripristinati per nuovo giorno.");
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    // Argomenti e comando
    // Nota: split(/ +/) aiuta a gestire spazi multipli
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

            // Se siamo in modalità NOTTE, applica subito
            if (dbCache.currentMode === 'NIGHT') {
                dbCache.forcedVisits[targetUser.id] = forcedInput;
                dbCache.hiddenVisits[targetUser.id] = hiddenInput;
            }
            
            await saveDB();
            message.reply(`✅ Configurazione Notte/Standard salvata per ${targetUser}.`);
        }

        // [NUOVO] Comando !giorno
        if (command === 'giorno') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            // args[1] = base, args[2] = forzate, args[3] = nascoste
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

            // Se siamo in modalità GIORNO, applica subito
            if (dbCache.currentMode === 'DAY') {
                dbCache.forcedVisits[targetUser.id] = forcedInput;
                dbCache.hiddenVisits[targetUser.id] = hiddenInput;
            }

            await saveDB();
            message.reply(`✅ Configurazione Giorno salvata per ${targetUser}.`);
        }

        // [MODIFICATO] Comando !aggiunta e !aggiunta giorno
        if (command === 'aggiunta') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            // Controlla se il primo argomento è "giorno"
            const isDayAdd = args[0].toLowerCase() === 'giorno';
            
            // Shift degli indici in base alla presenza di "giorno"
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
                // Aggiunta a contatori GIORNO
                if (type === 'base') dbCache.extraVisitsDay[targetUser.id] = (dbCache.extraVisitsDay[targetUser.id] || 0) + amount;
                else if (type === 'nascosta') {
                    // Se siamo in giorno, aggiungiamo direttamente al counter, altrimenti solo al DB per futuro switch? 
                    // Per coerenza con reset, aggiungiamo al counter corrente se siamo in modalità giorno
                    if (dbCache.currentMode === 'DAY') dbCache.hiddenVisits[targetUser.id] = (dbCache.hiddenVisits[targetUser.id] || 0) + amount;
                    else { /* Nota: le visite extra "speciali" (hidden/forced) solitamente si consumano, qui le aggiungiamo al counter live */ 
                        // Se non siamo in giorno, non possiamo aggiungere visite nascoste "del giorno" usabili ora. 
                        // Le aggiungeremo al caricamento? Il sistema "extra" per hidden/forced è complesso.
                        // Semplificazione: Aggiungi al counter "live" se la modalità corrisponde.
                        return message.reply("⚠ Puoi aggiungere visite Giorno solo se è attiva la modalità Giorno.");
                    }
                }
                else if (type === 'forzata') {
                    if (dbCache.currentMode === 'DAY') dbCache.forcedVisits[targetUser.id] = (dbCache.forcedVisits[targetUser.id] || 0) + amount;
                    else return message.reply("⚠ Puoi aggiungere visite Giorno solo se è attiva la modalità Giorno.");
                }
                message.reply(`✅ Aggiunte visite (GIORNO) a ${targetUser}.`);
            } else {
                // Aggiunta a contatori STANDARD/NOTTE
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

        // [MODIFICATO] !resetvisite: Alterna Giorno/Notte
        if (command === 'resetvisite') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            // Alterna modalità
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

            const membersInside = targetChannel.members.filter(m => !m.user.bot);
            
            for (const [memberId, member] of membersInside) {
                const ownerId = Object.keys(dbCache.playerHomes).find(key => dbCache.playerHomes[key] === targetChannel.id);
                const isOwner = (ownerId === member.id);
                const hasSpecialRole = member.roles.cache.has(ID_RUOLO_NOTIFICA_1); 

                await targetChannel.permissionOverwrites.delete(member.id).catch(() => {});

                if (isOwner && hasSpecialRole) {
                    const randomHouse = message.guild.channels.cache
                        .filter(c => c.parentId === ID_CATEGORIA_CASE && c.id !== targetChannel.id && !dbCache.destroyedHouses.includes(c.id))
                        .random();
                    
                    if (randomHouse) {
                        await movePlayer(member, targetChannel, randomHouse, `${member} è entrato.`, false);
                    }
                } else {
                    const homeId = dbCache.playerHomes[member.id];
                    const homeChannel = message.guild.channels.cache.get(homeId);
                    // Se la casa è distrutta, non può tornare (controllo fatto anche in !torna)
                    if (homeChannel && homeChannel.id !== targetChannel.id && !dbCache.destroyedHouses.includes(homeId)) {
                        await movePlayer(member, targetChannel, homeChannel, `🏠 ${member} è ritornato.`, false);
                    } else {
                         // Se non ha casa o casa distrutta, rimane "fuori" (rimossi permessi)
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

        if (command === 'ricostruzione') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetChannel = message.mentions.channels.first();
            if (!targetChannel || targetChannel.parentId !== ID_CATEGORIA_CASE) {
                return message.reply("❌ Devi menzionare un canale casa valido. Es: `!ricostruzione #canale-casa`");
            }

            dbCache.destroyedHouses = dbCache.destroyedHouses.filter(id => id !== targetChannel.id);
            await saveDB();

            message.reply(`🏗️ La casa ${targetChannel} è stata ricostruita.`);

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

        // [MODIFICATO] !trasporto FIXATO
        if (command === 'trasporto') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            // Parsing robusto: 
            // 1. Estrai tutti gli utenti menzionati o ID (in ordine di apparizione)
            // 2. Estrai il canale menzionato
            // 3. Estrai l'ultimo argomento come modalità

            const rawArgs = message.content.slice(PREFIX.length + command.length).trim().split(/ +/);
            
            const targetChannel = message.mentions.channels.first();
            if (!targetChannel) return message.reply("❌ Canale destinazione non trovato.");

            const resolvedMembers = [];
            // Itera gli argomenti per trovare gli utenti in ordine
            for (const arg of rawArgs) {
                if (arg.match(/^<@!?(\d+)>$/)) { // Regex per mention utente
                    const id = arg.replace(/\D/g, '');
                    const member = message.guild.members.cache.get(id);
                    if (member) resolvedMembers.push(member);
                }
            }

            if (resolvedMembers.length === 0) return message.reply("❌ Nessun utente specificato.");

            const modeArg = rawArgs[rawArgs.length - 1].toLowerCase();
            if (!['si', 'no', 'inv'].includes(modeArg)) return message.reply("❌ Specifica modalità alla fine: `si`, `no` o `inv`.");

            // Verifica casa comune
            let commonHouseId = null;

            for (const member of resolvedMembers) {
                const currentHouse = message.guild.channels.cache.find(c => 
                    c.parentId === ID_CATEGORIA_CASE && 
                    c.type === ChannelType.GuildText && 
                    c.permissionOverwrites.cache.has(member.id) && 
                    c.id !== targetChannel.id
                );

                const houseId = currentHouse ? currentHouse.id : 'nessuna';

                if (commonHouseId === null) {
                    commonHouseId = houseId;
                } else {
                    if (commonHouseId !== houseId) {
                        return message.reply("❌ **Errore Trasporto:** I giocatori non si trovano nella stessa casa!");
                    }
                }
            }

            const exitNarrative = `🚪 ${resolvedMembers[0]} è uscito seguito da ${resolvedMembers.slice(1).map(u => u.toString()).join(' ')}`;
            const enterNarrative = `👋 ${resolvedMembers[0]} è entrato seguito da ${resolvedMembers.slice(1).map(u => u.toString()).join(' ')}`;

            for (const user of resolvedMembers) {
                const oldChannel = commonHouseId !== 'nessuna' ? message.guild.channels.cache.get(commonHouseId) : null;
                
                if (oldChannel) {
                    await oldChannel.permissionOverwrites.delete(user.id).catch(() => {});
                }

                await targetChannel.permissionOverwrites.create(user.id, { ViewChannel: true, SendMessages: true });
                if (modeArg === 'inv') dbCache.playerModes[user.id] = 'HIDDEN';
                else dbCache.playerModes[user.id] = 'NORMAL';
            }
            
            if (commonHouseId !== 'nessuna' && modeArg !== 'inv') {
                const oldC = message.guild.channels.cache.get(commonHouseId);
                if (oldC) await oldC.send(exitNarrative);
            }

            if (modeArg !== 'inv') {
                await targetChannel.send(enterNarrative);
            }

            await saveDB();
            message.reply(`✅ Trasporto effettuato verso ${targetChannel}.`);
        }

        // [MODIFICATO] !multipla AVANZATO
        // Logica: !multipla @Utente #c1 #c2 si #c3 #c4
        // Prima del "si": solo lettura. Dopo "si": scrittura.
        if (command === 'multipla') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetUser = message.mentions.members.first();
            if (!targetUser) return message.reply("❌ Uso: `!multipla @Utente #casa1 ... si #casa2 ...`");

            // Inizializza storico ritirata
            if (!dbCache.multiplaHistory[targetUser.id]) {
                dbCache.multiplaHistory[targetUser.id] = [];
            }

            const rawArgs = message.content.slice(PREFIX.length + command.length).trim().split(/ +/);
            
            let canWrite = false; // Default: sola lettura
            let processedCount = 0;

            for (const arg of rawArgs) {
                // Se è una mention utente, salta
                if (arg.includes(targetUser.id)) continue;

                // Se è "si", attiva scrittura
                if (arg.toLowerCase() === 'si') {
                    canWrite = true;
                    continue;
                }

                // Se è un canale
                if (arg.match(/^<#(\d+)>$/)) {
                    const channelId = arg.replace(/\D/g, '');
                    const channel = message.guild.channels.cache.get(channelId);

                    if (channel && channel.parentId === ID_CATEGORIA_CASE) {
                        // Aggiorna storico
                        if (!dbCache.multiplaHistory[targetUser.id].includes(channel.id)) {
                            dbCache.multiplaHistory[targetUser.id].push(channel.id);
                        }

                        // Applica permessi
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

        // [MODIFICATO] !ritirata AVANZATO
        // !ritirata @Utente #c1 #c2 si/no
        // Rimuove da c1 e c2. "si/no" decide scrittura per le case RESTANTI nello storico.
        if (command === 'ritirata') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetUser = message.mentions.members.first();
            if (!targetUser) return message.reply("❌ Uso: `!ritirata @Utente #daRimuovere ... si/no`");

            const rawArgs = message.content.slice(PREFIX.length + command.length).trim().split(/ +/);
            const modeArg = rawArgs[rawArgs.length - 1].toLowerCase(); // si/no per il Rimanente

            const channelsToRemove = [];
            message.mentions.channels.forEach(c => channelsToRemove.push(c.id));

            // Rimuovi permessi dai canali specificati
            let removedCount = 0;
            for (const cid of channelsToRemove) {
                const channel = message.guild.channels.cache.get(cid);
                if (channel) {
                    await channel.permissionOverwrites.delete(targetUser.id).catch(() => {});
                    removedCount++;
                }
            }

            // Aggiorna storico rimuovendo quelli tolti
            let history = dbCache.multiplaHistory[targetUser.id] || [];
            history = history.filter(hid => !channelsToRemove.includes(hid));
            dbCache.multiplaHistory[targetUser.id] = history;

            // Aggiorna permessi per i canali RIMASTI
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

        // [NUOVO] !trasferimento
        if (command === 'trasferimento') {
            if (message.channel.parentId !== ID_CATEGORIA_CASE) return message.delete().catch(()=>{});

            // Controllo ruolo
            if (!message.member.roles.cache.has(ID_RUOLO_NOTIFICA_1)) {
                return message.channel.send("⛔ Non hai il ruolo per trasferirti.").then(m => setTimeout(() => m.delete(), 5000));
            }

            // Trova proprietario
            const ownerId = Object.keys(dbCache.playerHomes).find(key => dbCache.playerHomes[key] === message.channel.id);
            if (!ownerId) return message.channel.send("❌ Questa casa non ha un proprietario registrato.").then(m => setTimeout(() => m.delete(), 5000));

            const owner = message.guild.members.cache.get(ownerId);
            if (!owner) return message.channel.send("❌ Proprietario non trovato nel server.");

            const requester = message.author;
            const newHomeChannel = message.channel;

            const confirmEmbed = new EmbedBuilder()
                .setTitle("Richiesta di Trasferimento 📦")
                .setDescription(`${requester} vuole trasferirsi a casa tua e diventarne comproprietario.\nAccetti?`)
                .setColor('Blue');

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`transfer_yes_${requester.id}`).setLabel('Accetta ✅').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`transfer_no_${requester.id}`).setLabel('Rifiuta ❌').setStyle(ButtonStyle.Danger)
                );

            const msg = await owner.send({ content: `🔔 **Richiesta Trasferimento!**`, embeds: [confirmEmbed], components: [row] });
            message.reply(`📨 Richiesta inviata a ${owner}. Attendi risposta.`);

            // Gestione interazione pulsante
            const filter = i => i.user.id === owner.id;
            const collector = msg.createMessageComponentCollector({ filter, time: 300000, max: 1 });

            collector.on('collect', async i => {
                if (i.customId === `transfer_yes_${requester.id}`) {
                    await i.update({ content: "✅ Hai accettato il trasferimento.", components: [] });

                    // 1. Cancella vecchia key message
                    const oldHomeId = dbCache.playerHomes[requester.id];
                    if (oldHomeId) {
                        const oldChannel = message.guild.channels.cache.get(oldHomeId);
                        if (oldChannel) {
                            const pinned = await oldChannel.messages.fetchPinned();
                            // Cerca messaggio "questa è la tua dimora" che menziona l'utente
                            const oldKeyMsg = pinned.find(m => m.content.includes(requester.id) && m.content.includes("dimora privata"));
                            if (oldKeyMsg) await oldKeyMsg.delete();
                        }
                    }

                    // 2. Aggiorna DB
                    dbCache.playerHomes[requester.id] = newHomeChannel.id;
                    await saveDB();

                    // 3. Manda nuovo messaggio e pinna
                    const newKeyMsg = await newHomeChannel.send(`🔑 ${requester}, questa è la tua nuova dimora privata.`);
                    await newKeyMsg.pin();

                    // 4. Feedback
                    newHomeChannel.send(`📦 ${requester} si è trasferito ufficialmente qui!`);

                } else {
                    await i.update({ content: "❌ Hai rifiutato il trasferimento.", components: [] });
                    newHomeChannel.send(`⛔ ${owner} ha rifiutato la richiesta di trasferimento di ${requester}.`);
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

                // [MODIFICATO] Mostra statistiche in base alla modalità
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

                // Forced e Hidden sono letti dai contatori dinamici attuali (già caricati dallo switch mode)
                hidden = dbCache.hiddenVisits[message.author.id] || 0;
                forced = dbCache.forcedVisits[message.author.id] || 0;
                
                const modeStr = dbCache.currentMode === 'DAY' ? "☀️ GIORNO" : "🌙 NOTTE";

                message.channel.send(`📊 **Le tue visite (${modeStr}):**\n🏠 Normali: ${used}/${totalLimit}\n🧨 Forzate: ${forced}\n🕵️ Nascoste: ${hidden}`).then(m => setTimeout(() => m.delete(), 30000));
            }
        }

        if (command === 'torna') {
            message.delete().catch(()=>{}); 
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return;

            const homeId = dbCache.playerHomes[message.author.id];
            if (!homeId) return message.channel.send("❌ Non hai una casa."); 
            
            // [MODIFICATO] Controllo distruzione
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

            // [MODIFICATO] Usa i counter correnti (popolati da applyLimitsForMode)
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

            // Calcolo visite normali in base alla modalità
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
