const mongoose = require('mongoose');
const { 
    ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    EmbedBuilder, ChannelType, PermissionsBitField, ButtonStyle, ButtonBuilder
} = require('discord.js');

// ==========================================
// ⚙️ CONFIGURAZIONE (IDs e Costanti)
// ==========================================
const PREFIX = '!';
const ID_CATEGORIA_CASE = '1460741413388947528';
const ID_CATEGORIA_CHAT_PRIVATE = '1460741414357827747'; 
const ID_CATEGORIA_CHAT_DIURNA = '1460741410599866413';

// PERMESSI NOTTE
const ID_CANALE_BLOCCO_TOTALE = '1460741488815247567'; 
const ID_CANALI_BLOCCO_PARZIALE = [
    '1464941042380837010', '1460741484226543840', 
    '1460741486290276456', '1460741488135635030'
];

const ID_CANALE_ANNUNCI = '1460741475804381184'; 
const ID_RUOLO_NOTIFICA_1 = '1460741403331268661'; 
const ID_RUOLO_NOTIFICA_2 = '1460741404497019002';
const ID_RUOLO_NOTIFICA_3 = '1460741405722022151';

const GIF_NOTTE_START = 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExbWl6d2w2NWhkM2QwZWR6aDZ5YW5pdmFwMjR4NGd1ZXBneGo4NmhvayZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/LMomqSiRZF3zi/giphy.gif'; 
const GIF_GIORNO_START = 'https://media.giphy.com/media/jxbtTiXsCUZQXOKP2M/giphy.gif';
const GIF_DISTRUZIONE = 'https://i.giphy.com/media/oe33xf3B50fsc/giphy.gif'; 
const GIF_RICOSTRUZIONE = 'https://i.giphy.com/media/3ohjUS0WqYBpczfTlm/giphy.gif'; 

const RUOLI_PUBBLICI = ['1460741403331268661', '1460741404497019002', '1460741405722022151'];
const RUOLI_PERMESSI = ['1460741403331268661', '1460741404497019002']; 
const DEFAULT_MAX_VISITS = 0;

let dbCache = {}; // Cache locale sincronizzata con Mongo
let HousingModel = null;
let QueueSystem = null;
const pendingKnocks = new Set(); 

// ==========================================
// FUNZIONI DATABASE MONGO
// ==========================================

async function loadDB() {
    try {
        let data = await HousingModel.findOne({ id: 'main_housing' });
        if (!data) {
            data = new HousingModel({ id: 'main_housing' });
            await data.save();
        }
        dbCache = data.toObject();
        console.log("💾 [Housing] Database caricato da MongoDB!");
    } catch (e) {
        console.error("❌ [Housing] Errore caricamento DB:", e);
    }
}

async function saveDB() {
    try {
        await HousingModel.findOneAndUpdate({ id: 'main_housing' }, dbCache, { upsert: true });
    } catch (e) {
        console.error("❌ [Housing] Errore salvataggio DB:", e);
    }
}

// ==========================================
// FUNZIONI LOGICA
// ==========================================

function applyLimitsForMode() {
    dbCache.playerVisits = {}; 
    
    const allUsers = new Set([
        ...Object.keys(dbCache.playerHomes || {}),
        ...Object.keys(dbCache.baseVisits || {}),
        ...Object.keys(dbCache.dayLimits || {})
    ]);

    allUsers.forEach(userId => {
        if (dbCache.currentMode === 'DAY') {
            const limits = (dbCache.dayLimits && dbCache.dayLimits[userId]) ? dbCache.dayLimits[userId] : { forced: 0, hidden: 0 };
            if (!dbCache.forcedVisits) dbCache.forcedVisits = {};
            if (!dbCache.hiddenVisits) dbCache.hiddenVisits = {};
            
            dbCache.forcedVisits[userId] = limits.forced;
            dbCache.hiddenVisits[userId] = limits.hidden;
        } else {
            if (!dbCache.forcedVisits) dbCache.forcedVisits = {};
            if (!dbCache.hiddenVisits) dbCache.hiddenVisits = {};
            
            dbCache.forcedVisits[userId] = (dbCache.forcedLimits && dbCache.forcedLimits[userId]) || 0;
            dbCache.hiddenVisits[userId] = (dbCache.hiddenLimits && dbCache.hiddenLimits[userId]) || 0;
        }
    });
}

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
            const prevMode = dbCache.playerModes ? dbCache.playerModes[member.id] : null;
            if (prevMode !== 'HIDDEN') {
                await channelToLeave.send(`🚪 ${member} è uscito.`);
            }
            await channelToLeave.permissionOverwrites.delete(member.id).catch(() => {});
        }
    }

   await newChannel.permissionOverwrites.create(member.id, { 
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true 
    });
    
    if (!dbCache.playerModes) dbCache.playerModes = {};
    dbCache.playerModes[member.id] = isSilent ? 'HIDDEN' : 'NORMAL';
    await saveDB();

    if (!isSilent) await newChannel.send(entryMessage);
}

// ==========================================
// EXPORT INIT
// ==========================================
// ==========================================
// 🎯 ESECUTORE AZIONI HOUSING PER CODA
// ==========================================
async function executeHousingAction(queueItem) {
    // Trova il guild (server Discord)
    const guild = Object.values(dbCache.playerHomes).length > 0 
        ? (await client.channels.fetch(Object.values(dbCache.playerHomes)[0]).catch(()=>null))?.guild
        : client.guilds.cache.first();

    if (!guild) {
        console.error("❌ [Housing] Guild non trovata.");
        return;
    }
    
    const member = await guild.members.fetch(queueItem.userId).catch(() => null);
    if (!member) {
        console.warn(`⚠️ [Housing] Membro ${queueItem.userId} non trovato.`);
        return;
    }

    // 1️⃣ GESTIONE "TORNA"
    if (queueItem.type === 'RETURN') {
        const homeId = dbCache.playerHomes[member.id];
        if (homeId && !dbCache.destroyedHouses.includes(homeId)) {
            const homeChannel = guild.channels.cache.get(homeId);
            const currentChannel = guild.channels.cache.get(queueItem.details.fromChannelId);
            if (homeChannel) {
                await movePlayer(member, currentChannel, homeChannel, `🏠 ${member} è ritornato.`, false);
                console.log(`✅ [Housing] ${member.user.tag} è tornato a casa.`);
            }
        }
        return; 
    }

    // 2️⃣ GESTIONE "BUSSA"
    if (queueItem.type === 'KNOCK') {
        const { targetChannelId, mode, fromChannelId } = queueItem.details;
        const targetChannel = guild.channels.cache.get(targetChannelId);
        const fromChannel = guild.channels.cache.get(fromChannelId);
        
        if (!targetChannel || !fromChannel) {
            console.error("❌ [Housing] Canali non trovati per KNOCK.");
            return;
        }

        // A. Ingressi immediati (Forzata/Nascosta)
        if (mode === 'mode_forced') {
            const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(', ');
            await enterHouse(member, fromChannel, targetChannel, `${roleMentions}, ${member} ha sfondato la porta ed è entrato`, false);
            console.log(`✅ [Housing] ${member.user.tag} ha sfondato la porta.`);
            return;
        } 
        if (mode === 'mode_hidden') {
            await enterHouse(member, fromChannel, targetChannel, "", true);
            console.log(`✅ [Housing] ${member.user.tag} è entrato nascosto.`);
            return;
        }

        // B. Visita Normale -> TOC TOC
        const membersWithAccess = targetChannel.members.filter(m => 
            !m.user.bot && m.id !== member.id && m.roles.cache.hasAny(...RUOLI_PERMESSI)
        );

        // Se vuota, entra subito
        if (membersWithAccess.size === 0) {
            await enterHouse(member, fromChannel, targetChannel, `👋 ${member} è entrato.`, false);
            console.log(`✅ [Housing] ${member.user.tag} è entrato (casa vuota).`);
            return;
        }

        // Se c'è gente, invia il messaggio TOC TOC
        const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(' ');
        const msg = await targetChannel.send(`🔔 **TOC TOC!** ${roleMentions}\nQualcuno sta bussando\n✅ = Apri | ❌ = Rifiuta`);
        await msg.react('✅'); 
        await msg.react('❌');
        console.log(`🔔 [Housing] ${member.user.tag} sta bussando...`);

        const filter = (reaction, user) => 
            ['✅', '❌'].includes(reaction.emoji.name) && 
            membersWithAccess.has(user.id);
        
        const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

        collector.on('collect', async (reaction, user) => {
            if (reaction.emoji.name === '✅') {
                // ACCETTATO
                await msg.reply(`✅ Qualcuno ha aperto.`);
                await enterHouse(member, fromChannel, targetChannel, `👋 ${member} è entrato.`, false);
                console.log(`✅ [Housing] ${member.user.tag} è stato fatto entrare.`);
            } else {
                // RIFIUTATO
                const currentRefused = dbCache.playerVisits[member.id] || 0;
                dbCache.playerVisits[member.id] = currentRefused + 1;
                await saveDB();

                await msg.reply(`❌ Qualcuno ha rifiutato.`);

                // Lista presenti
                const presentPlayers = targetChannel.members
                    .filter(m => !m.user.bot && m.id !== member.id && !m.permissions.has(PermissionsBitField.Flags.Administrator))
                    .map(m => m.displayName)
                    .join(', ');

                // Messaggio di rifiuto
                if (fromChannel) {
                    await fromChannel.send(`⛔ ${member}, entrata rifiutata. I giocatori presenti in quella casa sono: ${presentPlayers || 'Nessuno'}`);
                }
                console.log(`❌ [Housing] ${member.user.tag} è stato rifiutato.`);
            }
        });

        collector.on('end', async collected => {
            if (collected.size === 0) {
                await msg.reply('⏳ Nessuno ha risposto. La porta viene forzata.');
                await enterHouse(member, fromChannel, targetChannel, `👋 ${member} è entrato.`, false);
                console.log(`✅ [Housing] ${member.user.tag} è entrato (timeout).`);
            }
        });
    }
}
module.exports = async (client, Model, QueueSys) => {
    HousingModel = Model;
    QueueSystem = QueueSys; // Salviamo il riferimento al sistema coda
    await loadDB();

    const today = new Date().toDateString();
    if (dbCache.lastReset !== today) {
        applyLimitsForMode();
        dbCache.lastReset = today;
        await saveDB();
        console.log("🔄 [Housing] Contatori ripristinati per nuovo giorno.");
    }

    client.on('messageCreate', async message => {
        if (message.author.bot || !message.content.startsWith(PREFIX)) return;

        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

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

            if (!targetUser || isNaN(baseInput) || isNaN(forcedInput) || isNaN(hiddenInput)) return message.reply("❌ Uso: `!visite @Utente [Base] [Forzate] [Nascoste]`");

            if (!dbCache.baseVisits) dbCache.baseVisits = {};
            if (!dbCache.forcedLimits) dbCache.forcedLimits = {};
            if (!dbCache.hiddenLimits) dbCache.hiddenLimits = {};

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
                if (!dbCache.extraVisitsDay) dbCache.extraVisitsDay = {};
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
                if (!dbCache.extraVisits) dbCache.extraVisits = {};
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
            
            dbCache.extraVisits = {};      
            dbCache.extraVisitsDay = {};   
            dbCache.playerVisits = {};
            applyLimitsForMode();
            
            await saveDB();
            message.reply("♻️ **RESET GLOBALE COMPLETATO**");
        }

        if (command === 'notte') {
             if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
             const numero = args[0];
             if (!numero) return message.reply("❌ Specifica numero notte.");

             dbCache.currentMode = 'NIGHT';
             applyLimitsForMode();
             await saveDB();

             const testoAnnuncio = `🌑 **NOTTE ${numero} HA INIZIO**`;
             const annunciChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
             if (annunciChannel) {
                 await annunciChannel.send({ content: `<@&${ID_RUOLO_NOTIFICA_1}> <@&${ID_RUOLO_NOTIFICA_2}>\n${testoAnnuncio}`, files: [GIF_NOTTE_START] });
             }
             
            const categoriaDiurna = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_DIURNA);
            if (categoriaDiurna) {
                const canaliDiurni = categoriaDiurna.children.cache.filter(c => c.type === ChannelType.GuildText);
                const ruoliDaBloccare = [ID_RUOLO_NOTIFICA_1, ID_RUOLO_NOTIFICA_2, ID_RUOLO_NOTIFICA_3];
                for (const [id, channel] of canaliDiurni) {
                    for (const r of ruoliDaBloccare) if (r) await channel.permissionOverwrites.edit(r, { SendMessages: false }).catch(() => {});
                }
            }
            message.reply(`✅ **Notte ${numero} avviata.**`);
        }

        if (command === 'giorno') {
             if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
             const arg1 = args[0];
             
             if (message.mentions.members.size > 0) {
                 const targetUser = message.mentions.members.first();
                 if(!dbCache.dayLimits) dbCache.dayLimits = {};
                 dbCache.dayLimits[targetUser.id] = { base: parseInt(args[1]), forced: parseInt(args[2]), hidden: parseInt(args[3]) };
                 if (dbCache.currentMode === 'DAY') {
                     dbCache.forcedVisits[targetUser.id] = parseInt(args[2]);
                     dbCache.hiddenVisits[targetUser.id] = parseInt(args[3]);
                 }
                 await saveDB();
                 return message.reply("✅ Config Giorno salvata.");
             }

             if (!arg1) return message.reply("❌ Specifica giorno.");
             
             dbCache.currentMode = 'DAY';
             applyLimitsForMode();
             await saveDB();

             const annunciChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
             if (annunciChannel) {
                 await annunciChannel.send({ content: `<@&${ID_RUOLO_NOTIFICA_1}> <@&${ID_RUOLO_NOTIFICA_2}> <@&${ID_RUOLO_NOTIFICA_3}>\n☀️ **GIORNO ${arg1}**`, files: [GIF_GIORNO_START] });
             }

             const categoriaDiurna = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_DIURNA);
             if (categoriaDiurna) {
                const canaliDiurni = categoriaDiurna.children.cache.filter(c => c.type === ChannelType.GuildText);
                const r1 = ID_RUOLO_NOTIFICA_1;
                for (const [id, channel] of canaliDiurni) {
                    if (channel.id === ID_CANALE_BLOCCO_TOTALE) { /* resta bloccato */ }
                    else if (ID_CANALI_BLOCCO_PARZIALE.includes(channel.id)) {
                         if (r1) await channel.permissionOverwrites.edit(r1, { SendMessages: true }).catch(() => {});
                    } else {
                         [ID_RUOLO_NOTIFICA_1, ID_RUOLO_NOTIFICA_2, ID_RUOLO_NOTIFICA_3].forEach(async r => {
                             if(r) await channel.permissionOverwrites.edit(r, { SendMessages: true }).catch(()=>{});
                         });
                    }
                    try { const msg = await channel.send(`☀️ **GIORNO ${arg1}**`); await msg.pin(); } catch(e){}
                }
             }
             message.reply(`✅ **Giorno ${arg1} avviato.**`);
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
                    const randomHouse = message.guild.channels.cache
                        .filter(c => c.parentId === ID_CATEGORIA_CASE && c.id !== targetChannel.id && !dbCache.destroyedHouses.includes(c.id))
                        .random();
                    if (randomHouse) await movePlayer(member, targetChannel, randomHouse, ` 👋 **${member}** è entrato.`, false);
              } else {
                    const homeId = dbCache.playerHomes[member.id];
                    const hasSafeHome = homeId && homeId !== targetChannel.id && !dbCache.destroyedHouses.includes(homeId);
                    
                    if (hasSafeHome) {
                        const homeChannel = message.guild.channels.cache.get(homeId);
                        if (homeChannel) await movePlayer(member, targetChannel, homeChannel, `🏠 ${member} è ritornato.`, false);
                    } else {
                        if (member.roles.cache.hasAny(...RUOLI_PERMESSI)) {
                            const randomHouse = message.guild.channels.cache
                                .filter(c => c.parentId === ID_CATEGORIA_CASE && c.id !== targetChannel.id && !dbCache.destroyedHouses.includes(c.id))
                                .random();
                            if (randomHouse) await movePlayer(member, targetChannel, randomHouse, `👋 **${member}** è entrato.`, false);
                        }
                    }
                }
            }

            message.reply(`🏚️ La casa ${targetChannel} è stata distrutta.`);
            const annunciChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunciChannel) {
                annunciChannel.send({ content: `<@&${ID_RUOLO_NOTIFICA_1}> <@&${ID_RUOLO_NOTIFICA_2}>\n🏡|${formatName(targetChannel.name)} casa è stata distrutta`, files: [GIF_DISTRUZIONE] });
            }
        }

        if (command === 'ricostruzione') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            const targetChannel = message.mentions.channels.first();
            if (!targetChannel || targetChannel.parentId !== ID_CATEGORIA_CASE) return message.reply("❌ Devi menzionare un canale casa valido.");

            dbCache.destroyedHouses = dbCache.destroyedHouses.filter(id => id !== targetChannel.id);
            const exOwners = Object.keys(dbCache.playerHomes).filter(uid => dbCache.playerHomes[uid] === targetChannel.id);
            for (const uid of exOwners) delete dbCache.playerHomes[uid];
            await saveDB();

            message.reply(`🏗️ La casa ${targetChannel} è stata ricostruita.`);
            const annunciChannel = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunciChannel) {
                annunciChannel.send({ content: `<@&${ID_RUOLO_NOTIFICA_1}> <@&${ID_RUOLO_NOTIFICA_2}>\n:house_with_garden:|${formatName(targetChannel.name)} casa è stata ricostruita`, files: [GIF_RICOSTRUZIONE] });
            }
        }

        if (command === 'pubblico') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            if (message.channel.parentId !== ID_CATEGORIA_CASE) return message.reply("⛔ Usalo in una casa.");

            const channel = message.channel;
            if (dbCache.destroyedHouses.includes(channel.id)) return message.reply("❌ Questa casa è distrutta!");

            const isAlreadyPublic = channel.permissionOverwrites.cache.has(RUOLI_PUBBLICI[0]);
            if (isAlreadyPublic) {
                for (const roleId of RUOLI_PUBBLICI) if (roleId) await channel.permissionOverwrites.delete(roleId).catch(() => {});
                message.reply("🔒 La casa è tornata **PRIVATA**.");
            } else {
                for (const roleId of RUOLI_PUBBLICI) {
                    if (roleId) await channel.permissionOverwrites.create(roleId, { ViewChannel: true, SendMessages: false });
                }
                const tag1 = `<@&${ID_RUOLO_NOTIFICA_1}>`;
                const tag2 = `<@&${ID_RUOLO_NOTIFICA_2}>`;
                message.channel.send(`📢 **LA CASA È ORA PUBBLICA!** ${tag1} ${tag2}`);
            }
        }

        if (command === 'sposta') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            const targetMembers = message.mentions.members.filter(m => !m.user.bot);
            const targetChannel = message.mentions.channels.first();

            if (!targetChannel || targetMembers.size === 0) return message.reply("❌ Uso: `!sposta @Utente1 @Utente2 ... #canale`");

            for (const [id, member] of targetMembers) {
                await movePlayer(member, message.channel, targetChannel, `👋 **${member}** è entrato.`, false);
            }
            message.reply(`✅ Spostati ${targetMembers.size} utenti in ${targetChannel}.`);
        }

        if (command === 'dove') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            if (!targetUser) return message.reply("❌ Uso: `!dove @Utente`");

            const locations = message.guild.channels.cache.filter(c => {
                if (c.parentId !== ID_CATEGORIA_CASE || c.type !== ChannelType.GuildText) return false;
                const overwrite = c.permissionOverwrites.cache.get(targetUser.id);
                return overwrite && overwrite.allow.has(PermissionsBitField.Flags.ViewChannel);
            });

            if (locations.size > 0) {
                const locList = locations.map(c => `🏠 ${c} (ID: ${c.id})`).join('\n');
                let warning = locations.size > 1 ? "\n\n⚠️ **ATTENZIONE:** Utente in più case!" : "";
                message.reply(`📍 **${targetUser.displayName}** si trova in:\n${locList}${warning}`);
            } else {
                message.reply(`❌ **${targetUser.displayName}** non è in nessuna casa.`);
            }
        }

        if (command === 'multipla') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            const targetUser = message.mentions.members.first();
            if (!targetUser) return message.reply("❌ Uso: `!multipla @Utente #casa1 si narra #casa2 no ...`");

            if (!dbCache.multiplaHistory) dbCache.multiplaHistory = {};
            if (!dbCache.multiplaHistory[targetUser.id]) dbCache.multiplaHistory[targetUser.id] = [];

            const rawArgs = message.content.slice(PREFIX.length + command.length).trim().split(/ +/);
            let currentWrite = false; 
            let currentNarra = false;
            let actions = [];

            for (const arg of rawArgs) {
                if (arg.includes(targetUser.id)) continue;
                let stateChanged = false;

                if (arg.toLowerCase() === 'si') { currentWrite = true; stateChanged = true; }
                else if (arg.toLowerCase() === 'no') { currentWrite = false; stateChanged = true; }
                else if (arg.toLowerCase() === 'narra') { currentNarra = true; stateChanged = true; }
                else if (arg.toLowerCase() === 'muto') { currentNarra = false; stateChanged = true; }

                if (stateChanged && actions.length > 0) {
                    actions[actions.length - 1].write = currentWrite;
                    actions[actions.length - 1].narra = currentNarra;
                    continue;
                }

                if (arg.match(/^<#(\d+)>$/)) {
                    const channelId = arg.replace(/\D/g, '');
                    const channel = message.guild.channels.cache.get(channelId);
                    if (channel && channel.parentId === ID_CATEGORIA_CASE) {
                        actions.push({ channel: channel, write: currentWrite, narra: currentNarra });
                    }
                }
            }

            let processedCount = 0;
            for (const action of actions) {
                if (!dbCache.multiplaHistory[targetUser.id].includes(action.channel.id)) {
                    dbCache.multiplaHistory[targetUser.id].push(action.channel.id);
                }
                await action.channel.permissionOverwrites.create(targetUser.id, {
                    ViewChannel: true, SendMessages: action.write, AddReactions: action.write, ReadMessageHistory: true
                });
                if (action.narra) await action.channel.send(`👋 **${targetUser.displayName}** è entrato.`);
                processedCount++;
            }
            await saveDB();
            message.reply(`✅ Applicate impostazioni a **${processedCount}** case per ${targetUser}.`);
        }

        if (command === 'ritirata') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");

            const targetUser = message.mentions.members.first();
            if (!targetUser) return message.reply("❌ Uso: `!ritirata @Utente #casa1 narra ... [si/no]`");

            const rawArgs = message.content.slice(PREFIX.length + command.length).trim().split(/ +/);
            let currentNarra = false;
            let currentWrite = null; 
            let removalActions = [];
            
            for (const arg of rawArgs) {
                if (arg.includes(targetUser.id)) continue;
                let stateChanged = false;
                if (arg.toLowerCase() === 'narra') { currentNarra = true; stateChanged = true; }
                else if (arg.toLowerCase() === 'muto') { currentNarra = false; stateChanged = true; }
                else if (arg.toLowerCase() === 'si') { currentWrite = true; } 
                else if (arg.toLowerCase() === 'no') { currentWrite = false; } 

                if (stateChanged && removalActions.length > 0) {
                    removalActions[removalActions.length - 1].narra = currentNarra;
                    continue;
                }

                if (arg.match(/^<#(\d+)>$/)) {
                    const channelId = arg.replace(/\D/g, '');
                    const channel = message.guild.channels.cache.get(channelId);
                    if (channel) removalActions.push({ channel: channel, narra: currentNarra });
                }
            }

            let removedCount = 0;
            let channelsRemovedIds = [];
            for (const action of removalActions) {
                if (action.narra) await action.channel.send(`🚪 **${targetUser.displayName}** è uscito.`);
                await action.channel.permissionOverwrites.delete(targetUser.id).catch(() => {});
                channelsRemovedIds.push(action.channel.id);
                removedCount++;
            }

            if(!dbCache.multiplaHistory) dbCache.multiplaHistory = {};
            let history = dbCache.multiplaHistory[targetUser.id] || [];
            history = history.filter(hid => !channelsRemovedIds.includes(hid));
            dbCache.multiplaHistory[targetUser.id] = history;

            if (currentWrite !== null) {
                for (const hid of history) {
                    const ch = message.guild.channels.cache.get(hid);
                    if (ch) {
                        await ch.permissionOverwrites.create(targetUser.id, {
                            ViewChannel: true, SendMessages: currentWrite, AddReactions: currentWrite, ReadMessageHistory: true
                        });
                    }
                }
                const statusText = currentWrite ? "SCRITTURA (SI)" : "LETTURA (NO)";
                message.reply(`✅ Rimossi ${removedCount} canali. Restanti aggiornati a: **${statusText}**.`);
            } else {
                message.reply(`✅ Rimossi ${removedCount} canali.`);
            }
            await saveDB();
        }
       // ---------------------------------------------------------
        // 🔄 COMANDO CAMBIO IDENTITÀ
        // ---------------------------------------------------------
        if (command === 'cambio') {
            // 1. Controllo Canale (Solo Categoria Chat Private)
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return;

            // 2. Definizione Ruoli da scambiare
            const R1 = ID_RUOLO_NOTIFICA_1; // Ruolo 1
            const R2 = ID_RUOLO_NOTIFICA_2; // Ruolo 2

            // 3. Controllo Permessi Esecutore
            const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
            const hasRole1 = message.member.roles.cache.has(R1);
            const hasRole2 = message.member.roles.cache.has(R2);

            if (!isAdmin && !hasRole1 && !hasRole2) return message.reply("⛔ Non hai i permessi per usare questo comando.");

            // 4. Identificazione dei due giocatori nel canale
            // Cerchiamo nel canale membri che non siano bot e abbiano uno dei due ruoli
            const membersInChannel = message.channel.members.filter(m => !m.user.bot);
            const player1 = membersInChannel.find(m => m.roles.cache.has(R1));
            const player2 = membersInChannel.find(m => m.roles.cache.has(R2));

            if (!player1 || !player2) {
                return message.reply("❌ Errore: Non trovo entrambi i giocatori con i ruoli necessari in questa chat per effettuare lo scambio.");
            }

            // Se chi digita non è admin, deve essere uno dei due coinvolti
            if (!isAdmin && message.member.id !== player1.id && message.member.id !== player2.id) {
                return message.reply("⛔ Non sei coinvolto in questo scambio.");
            }

            message.channel.send("🔄 **Inizio procedura di scambio identità...**");

            try {
                // A. SCAMBIO DATI HOUSING (Database Locale dbCache)
                // Scambiamo tutti i contatori pertinenti tra ID P1 e ID P2
                const swapKeys = [
                    'playerVisits', 'baseVisits', 'forcedLimits', 'hiddenLimits', 
                    'dayLimits', 'forcedVisits', 'hiddenVisits', 'extraVisits', 'extraVisitsDay'
                ];

                swapKeys.forEach(key => {
                    if (!dbCache[key]) dbCache[key] = {};
                    const val1 = dbCache[key][player1.id];
                    const val2 = dbCache[key][player2.id];
                    
                    // Scambio
                    if (val1 === undefined) delete dbCache[key][player2.id];
                    else dbCache[key][player2.id] = val1;

                    if (val2 === undefined) delete dbCache[key][player1.id];
                    else dbCache[key][player1.id] = val2;
                });

                await saveDB(); // Salva Housing

                // B. SCAMBIO DATI MEETING (Database Mongoose Diretto)
                try {
                    const MeetingData = mongoose.model('MeetingData');
                    const meetingDB = await MeetingData.findOne({ id: 'main_meeting' });
                    
                    if (meetingDB) {
                        const meetingKeys = ['meetingCounts', 'letturaCounts'];
                        let modified = false;

                        meetingKeys.forEach(key => {
                            if (!meetingDB[key]) meetingDB[key] = {};
                            // Mongoose Map/Object manipulation
                            const val1 = meetingDB[key][player1.id];
                            const val2 = meetingDB[key][player2.id];

                            // Scambio
                            if (val1 === undefined) delete meetingDB[key][player2.id];
                            else meetingDB[key][player2.id] = val1;

                            if (val2 === undefined) delete meetingDB[key][player1.id];
                            else meetingDB[key][player1.id] = val2;
                            
                            modified = true;
                        });

                        if (modified) {
                            meetingDB.markModified('meetingCounts');
                            meetingDB.markModified('letturaCounts');
                            await meetingDB.save();
                        }
                    }
                } catch (err) {
                    console.error("Errore scambio Meeting:", err);
                    message.channel.send("⚠️ Errore nello scambio dati Meeting (i ruoli verranno comunque scambiati).");
                }

                // C. SCAMBIO RUOLI DISCORD
                // Rimuovi e aggiungi in parallelo per velocità
                await Promise.all([
                    player1.roles.remove(R1),
                    player1.roles.add(R2),
                    player2.roles.remove(R2),
                    player2.roles.add(R1)
                ]);

                message.channel.send(`✅ **Scambio Completato!**\n👤 ${player1} ora ha il ruolo <@&${R2}> e le relative stats.\n👤 ${player2} ora ha il ruolo <@&${R1}> e le relative stats.`);

            } catch (error) {
                console.error(error);
                message.reply("❌ Si è verificato un errore critico durante lo scambio.");
            }
        }
        // ---------------------------------------------------------
        // 👤 COMANDI GIOCATORE
        // ---------------------------------------------------------

        if (command === 'trasferimento') {
            if (message.channel.parentId !== ID_CATEGORIA_CASE) return message.delete().catch(()=>{});
            if (!message.member.roles.cache.has(ID_RUOLO_NOTIFICA_1)) return message.channel.send("⛔ Non hai il ruolo.").then(m => setTimeout(() => m.delete(), 5000));

            const requester = message.author;
            const newHomeChannel = message.channel;
            const ownerId = Object.keys(dbCache.playerHomes).find(key => dbCache.playerHomes[key] === message.channel.id);
            
            // MODIFICA: Controllo se il proprietario è già in casa sua
            if (ownerId === requester.id) {
                return message.reply("❌ Sei già a casa tua, non puoi trasferirti qui!");
            }

            if (!ownerId) {
                await cleanOldHome(requester.id, message.guild);
                dbCache.playerHomes[requester.id] = newHomeChannel.id;
                await saveDB();

                await newHomeChannel.permissionOverwrites.edit(requester.id, { ViewChannel: true, SendMessages: true });
                const pinnedMsg = await newHomeChannel.send(`🔑 **${requester}**, questa è la tua dimora privata.`);
                await pinnedMsg.pin();
                return message.reply("✅ Trasferimento completato!");
            }

            const owner = message.guild.members.cache.get(ownerId);
            if (!owner) return message.channel.send("❌ Proprietario non trovato.");

            const confirmEmbed = new EmbedBuilder()
                .setTitle("Richiesta di Trasferimento 📦")
                .setDescription(`${requester} vuole trasferirsi qui.\nAccetti?`)
                .setColor('Blue');

            const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`transfer_yes_${requester.id}`).setLabel('Accetta ✅').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`transfer_no_${requester.id}`).setLabel('Rifiuta ❌').setStyle(ButtonStyle.Danger)
            );

            const isOwnerHome = newHomeChannel.permissionsFor(owner).has(PermissionsBitField.Flags.ViewChannel);
            let msg;
            if (isOwnerHome) {
                msg = await newHomeChannel.send({ content: `🔔 Richiesta <@${owner.id}>`, embeds: [confirmEmbed], components: [row] });
            } else {
                const privateCategory = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_PRIVATE);
                const ownerPrivateChannel = privateCategory.children.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(owner).has(PermissionsBitField.Flags.ViewChannel));
                if (ownerPrivateChannel) {
                    msg = await ownerPrivateChannel.send({ content: `🔔 Richiesta Trasferimento <@${owner.id}>`, embeds: [confirmEmbed], components: [row] });
                    message.channel.send(`📩 Richiesta inviata in privato.`);
                } else {
                    return message.channel.send(`❌ Proprietario non raggiungibile.`);
                }
            }

            const collector = msg.createMessageComponentCollector({ filter: i => i.user.id === owner.id, max: 1 });
            collector.on('collect', async i => {
                if (i.customId === `transfer_yes_${requester.id}`) {
                    await i.update({ content: `✅ Accettato!`, embeds: [], components: [] });
                    await cleanOldHome(requester.id, message.guild);
                    dbCache.playerHomes[requester.id] = newHomeChannel.id;
                    await saveDB();
                    await newHomeChannel.permissionOverwrites.edit(requester.id, { ViewChannel: true, SendMessages: true });
                    const newKeyMsg = await newHomeChannel.send(`🔑 ${requester}, dimora assegnata (Comproprietario).`);
                    await newKeyMsg.pin();
                } else {
                    await i.update({ content: `❌ Rifiutato.`, embeds: [], components: [] });
                }
            });
        }

                if (command === 'chi') {
            message.delete().catch(()=>{});
            
            const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);
            let targetChannel = null;

            // Logica di selezione canale
            if (isAdmin && message.mentions.channels.size > 0) {
                // Se è admin e ha menzionato un canale, usa quello
                targetChannel = message.mentions.channels.first();
            } else {
                // Altrimenti usa il canale corrente se è una casa
                if (message.channel.parentId === ID_CATEGORIA_CASE) {
                    targetChannel = message.channel;
                }
            }

            // Controllo validità
            if (!targetChannel || targetChannel.parentId !== ID_CATEGORIA_CASE) {
                return message.channel.send("⛔ Devi essere in una casa o (se admin) specificare una casa valida.").then(m => setTimeout(() => m.delete(), 5000));
            }

            const ownerIds = Object.keys(dbCache.playerHomes).filter(key => dbCache.playerHomes[key] === targetChannel.id);
            const ownerMention = ownerIds.length > 0 ? ownerIds.map(id => `<@${id}>`).join(', ') : "Nessuno";
            const playersInHouse = targetChannel.members.filter(m => !m.user.bot && targetChannel.permissionOverwrites.cache.has(m.id));
            let description = playersInHouse.size > 0 ? playersInHouse.map(p => `👤 ${p}`).join('\n') : "Nessuno.";

            const embed = new EmbedBuilder().setTitle(`👥 Persone in casa`).setDescription(description).addFields({ name: '🔑 Proprietario', value: ownerMention });
            message.channel.send({ embeds: [embed] }).then(msg => setTimeout(() => msg.delete().catch(() => {}), 300000));
        }


        if (command === 'rimaste') {
            message.delete().catch(()=>{});
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return message.channel.send("⛔ Solo chat private!").then(m => setTimeout(() => m.delete(), 5000));

            if (message.member.roles.cache.hasAny(...RUOLI_PERMESSI)) {
                let base, extra, hidden, forced;
                if (dbCache.currentMode === 'DAY') {
                     const limits = dbCache.dayLimits[message.author.id] || { base: 0 };
                     base = limits.base;
                     extra = dbCache.extraVisitsDay ? (dbCache.extraVisitsDay[message.author.id] || 0) : 0;
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

      if (command === 'torna') {
            message.delete().catch(()=>{}); 
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return;

            const homeId = dbCache.playerHomes[message.author.id];
            if (!homeId) return message.channel.send("❌ **Non hai una casa!**"); 
            if (dbCache.destroyedHouses.includes(homeId)) return message.channel.send("🏚️ **Casa distrutta!**");

            const homeChannel = message.guild.channels.cache.get(homeId);
            if (!homeChannel) return message.channel.send("❌ Errore casa.");

            const isVisiting = message.guild.channels.cache.some(c => 
                c.parentId === ID_CATEGORIA_CASE && 
                c.type === ChannelType.GuildText && 
                c.id !== homeId && 
                c.permissionsFor(message.member).has(PermissionsBitField.Flags.ViewChannel)
            );
            if (!isVisiting) return message.channel.send("🏠 Sei già a casa.");

            // --- MODIFICA CODA ---
            if (QueueSystem) {
                await QueueSystem.add('RETURN', message.author.id, {
                    fromChannelId: message.channel.id
                });
                await message.channel.send("⏳ **Azione Torna** messa in coda. Attendi...");
            } else {
                // Fallback se coda non disponibile
                await movePlayer(message.member, message.channel, homeChannel, `🏠 ${message.member} è ritornato.`, false);
            }
      }

        if (command === 'bussa') {
            message.delete().catch(()=>{}); 
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return message.channel.send(`⛔ Solo chat private!`);
            if (pendingKnocks.has(message.author.id)) return message.channel.send(`${message.author}, stai già bussando!`);

            const selectMode = new StringSelectMenuBuilder()
                .setCustomId('knock_mode_select')
                .setPlaceholder('Come vuoi entrare?')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Visita Normale').setValue('mode_normal').setEmoji('👋'),
                    new StringSelectMenuOptionBuilder().setLabel('Visita Forzata').setValue('mode_forced').setEmoji('🧨'),
                    new StringSelectMenuOptionBuilder().setLabel('Visita Nascosta').setValue('mode_hidden').setEmoji('🕵️')
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
    }

    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;
        
        if (interaction.customId === 'knock_mode_select') {
             if (!interaction.message.content.includes(interaction.user.id)) return interaction.reply({ content: "Non è tuo.", ephemeral: true });
             const selectedMode = interaction.values[0]; 
             const tutteLeCase = interaction.guild.channels.cache
                .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
                .sort((a, b) => a.rawPosition - b.rawPosition);

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
            const selectGroup = new StringSelectMenuBuilder().setCustomId('knock_page_select').addOptions(pageOptions);
            await interaction.update({ content: `🏘️ **Modalità scelta**. Seleziona zona:`, components: [new ActionRowBuilder().addComponents(selectGroup)] });
        }

        if (interaction.customId === 'knock_page_select') {
            const parts = interaction.values[0].split('_'); 
            const pageIndex = parseInt(parts[1]);
            const currentMode = parts[2] + '_' + parts[3]; 
            const userHomeId = dbCache.playerHomes[interaction.user.id];
            
            const currentHouseChannel = interaction.guild.channels.cache.find(c => c.parentId === ID_CATEGORIA_CASE && c.permissionsFor(interaction.user).has(PermissionsBitField.Flags.ViewChannel));
            const currentHouseId = currentHouseChannel ? currentHouseChannel.id : null;

            const tutteLeCase = interaction.guild.channels.cache
                .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
                .sort((a, b) => a.rawPosition - b.rawPosition);

            const start = pageIndex * 25;
            const caseSliceRaw = Array.from(tutteLeCase.values()).slice(start, start + 25);
            const caseSliceFiltered = caseSliceRaw.filter(c => 
                c.id !== userHomeId && c.id !== currentHouseId &&
                (!dbCache.destroyedHouses || !dbCache.destroyedHouses.includes(c.id))
            );

            if (caseSliceFiltered.length === 0) return interaction.reply({ content: "❌ Nessuna casa visitabile qui.", ephemeral: true });

            const selectHouse = new StringSelectMenuBuilder()
                .setCustomId('knock_house_select')
                .addOptions(caseSliceFiltered.map(c => 
                    new StringSelectMenuOptionBuilder().setLabel(formatName(c.name)).setValue(`${c.id}_${currentMode}`).setEmoji('🏠')
                ));
            await interaction.update({ content: `📂 **Scegli la casa:**`, components: [new ActionRowBuilder().addComponents(selectHouse)] });
        }
if (interaction.customId === 'knock_house_select') {
            const parts = interaction.values[0].split('_'); 
            const targetChannelId = parts[0];
            const mode = parts[1] + '_' + parts[2]; 
            const knocker = interaction.member;

            let base, extra;
            if (dbCache.currentMode === 'DAY') {
                const limits = dbCache.dayLimits[knocker.id] || { base: 0 };
                base = limits.base;
                extra = dbCache.extraVisitsDay ? (dbCache.extraVisitsDay[knocker.id] || 0) : 0;
            } else {
                base = dbCache.baseVisits[knocker.id] || DEFAULT_MAX_VISITS;
                extra = dbCache.extraVisits[knocker.id] || 0;
            }
            const userLimit = base + extra;
            const used = dbCache.playerVisits[knocker.id] || 0;

            if (mode === 'mode_forced') {
                const forcedAvailable = dbCache.forcedVisits[knocker.id] || 0;
                if (forcedAvailable <= 0) return interaction.reply({ content: "⛔ Finite forzate.", ephemeral: true });
                dbCache.forcedVisits[knocker.id] = forcedAvailable - 1;
            } else if (mode === 'mode_hidden') {
                const hiddenAvailable = dbCache.hiddenVisits[knocker.id] || 0;
                if (hiddenAvailable <= 0) return interaction.reply({ content: "⛔ Finite nascoste.", ephemeral: true });
                dbCache.hiddenVisits[knocker.id] = hiddenAvailable - 1;
            } else {
                if (used >= userLimit) return interaction.reply({ content: `⛔ Visite finite!`, ephemeral: true });
                dbCache.playerVisits[knocker.id] = used + 1;
            }

            await saveDB();
            await interaction.message.delete().catch(()=>{});

            // --- MODIFICA CODA ---
            if (QueueSystem) {
                await QueueSystem.add('KNOCK', knocker.id, {
                    targetChannelId: targetChannelId,
                    mode: mode,
                    fromChannelId: interaction.channel.id
                });
                await interaction.reply({ content: "⏳ **Azione Bussa** messa in coda. Attendi...", ephemeral: true });
            } else {
                // Fallback se coda non disponibile (esecuzione immediata)
                const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
                const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(', ');

                if (mode === 'mode_forced') {
                    await enterHouse(knocker, interaction.channel, targetChannel, `${roleMentions}, ${knocker} ha sfondato la porta ed è entrato`, false);
                } else if (mode === 'mode_hidden') {
                    await enterHouse(knocker, interaction.channel, targetChannel, "", true);
                } else {
                    await enterHouse(knocker, interaction.channel, targetChannel, `👋 ${knocker} è entrato.`, false);
                }
            }
    }
    }); // Chiude il client.on('interactionCreate'...)

    // Restituisci la funzione esecutore alla coda
    return executeHousingAction;
};



