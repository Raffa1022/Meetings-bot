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

let AbilityModel = null;
let dbCache = {}; 
let HousingModel = null;
let QueueSystem = null;
let QueueModel = null; // ← AGGIUNTO per accedere al DB della coda
let clientRef = null;
// pendingKnocks ora è dentro dbCache.pendingKnocks (array su MongoDB)

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
        
        // Inizializza pendingKnocks se non esiste
        if (!dbCache.pendingKnocks) {
            dbCache.pendingKnocks = [];
        }
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
    console.log(`🏠 [Housing] Eseguo azione ${queueItem.type} per ${queueItem.userId}`);
    
    try {
        if (queueItem.type === 'RETURN') {
            // TORNA A CASA
            const member = await clientRef.guilds.cache.first().members.fetch(queueItem.userId);
            const myHomeId = dbCache.playerHomes[queueItem.userId];
            const myHome = clientRef.channels.cache.get(myHomeId);
            const fromChannel = clientRef.channels.cache.get(queueItem.details.fromChannelId);
            
            if (!myHome) {
                console.error(`❌ [Housing] Casa non trovata per ${queueItem.userId}`);
                return;
            }
            
            await movePlayer(member, fromChannel, myHome, `🏠 ${member} è tornato a casa.`, false);
            console.log(`✅ [Housing] ${member.user.tag} è tornato a casa.`);
        }
        else if (queueItem.type === 'KNOCK') {
            // BUSSA
            const member = await clientRef.guilds.cache.first().members.fetch(queueItem.userId);
            const targetChannel = clientRef.channels.cache.get(queueItem.details.targetChannelId);
            const fromChannel = clientRef.channels.cache.get(queueItem.details.fromChannelId);
            const mode = queueItem.details.mode;
            
            if (!targetChannel) {
                console.error(`❌ [Housing] Casa target non trovata!`);
                return;
            }

            // A. Ingressi immediati (Forzata/Nascosta)
            if (mode === 'mode_forced') {
                const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(', ');
                await enterHouse(member, fromChannel, targetChannel, `${roleMentions}, ${member} ha sfondato la porta ed è entrato`, false);
                console.log(`✅ [Housing] ${member.user.tag} ha forzato l'ingresso.`);
                return;
            } 
            if (mode === 'mode_hidden') {
                await enterHouse(member, fromChannel, targetChannel, "", true);
                console.log(`✅ [Housing] ${member.user.tag} è entrato di nascosto.`);
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

            const filter = (reaction, user) => 
                ['✅', '❌'].includes(reaction.emoji.name) && 
                membersWithAccess.has(user.id);
            
            const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

            collector.on('collect', async (reaction, user) => {
                if (reaction.emoji.name === '✅') {
                    await msg.reply(`✅ Qualcuno ha aperto.`);
                    await enterHouse(member, fromChannel, targetChannel, `👋 ${member} è entrato.`, false);
                    console.log(`✅ [Housing] ${member.user.tag} è entrato (porta aperta).`);
                } else {
                    const currentRefused = dbCache.playerVisits[member.id] || 0;
                    dbCache.playerVisits[member.id] = currentRefused + 1;
                    await saveDB();

                    await msg.reply(`❌ Qualcuno ha rifiutato.`);
                    console.log(`❌ [Housing] ${member.user.tag} è stato rifiutato.`);

                    const presentPlayers = targetChannel.members
                        .filter(m => !m.user.bot && m.id !== member.id && !m.permissions.has(PermissionsBitField.Flags.Administrator))
                        .map(m => m.displayName)
                        .join(', ');

                    if (fromChannel) {
                        await fromChannel.send(`⛔ ${member}, entrata rifiutata. I giocatori presenti in quella casa sono: ${presentPlayers || 'Nessuno'}`);
                    }
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
    } catch (error) {
        console.error(`❌ [Housing] Errore esecuzione azione:`, error);
    }
}

module.exports = async (client, Model, QueueSys, QueueMod) => {
    clientRef = client;
    HousingModel = Model;
    QueueSystem = QueueSys;
    QueueModel = QueueMod; // ← Modello per accedere alla coda
    await loadDB();

    console.log("🏠 [Housing] Sistema Housing inizializzato (con QueueSystem).");

    // ==========================================
    // COMANDI !GIORNO E !NOTTE
    // ==========================================
    
    client.on('messageCreate', async message => {
        if (message.author.bot || !message.content.startsWith(PREFIX)) return;
        const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
        const cmd = args[0]?.toLowerCase();

        // ==========================================
        // !GIORNO
        // ==========================================
        if (cmd === 'giorno') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
            
            dbCache.currentMode = 'DAY';
            applyLimitsForMode();
            await saveDB();
            
            console.log("🌞 [Housing] Modalità GIORNO attivata.");
            
            const guild = message.guild;
            const categoriaDiurna = guild.channels.cache.get(ID_CATEGORIA_CHAT_DIURNA);
            const canaliDiurni = categoriaDiurna ? Array.from(categoriaDiurna.children.cache.values()).filter(c => c.type === ChannelType.GuildText) : [];
            
            for (const canale of canaliDiurni) {
                try {
                    await canale.permissionOverwrites.edit(guild.roles.everyone, { 
                        ViewChannel: false, SendMessages: false 
                    });
                    for (const roleId of RUOLI_PERMESSI) {
                        await canale.permissionOverwrites.edit(roleId, { 
                            ViewChannel: true, SendMessages: true 
                        });
                    }
                } catch (err) {
                    console.error(`Errore permessi GIORNO canale ${canale.name}:`, err);
                }
            }
            
            const bloccoTotale = guild.channels.cache.get(ID_CANALE_BLOCCO_TOTALE);
            if (bloccoTotale) {
                try {
                    await bloccoTotale.permissionOverwrites.edit(guild.roles.everyone, { 
                        ViewChannel: false, SendMessages: false 
                    });
                    for (const roleId of RUOLI_PERMESSI) {
                        await bloccoTotale.permissionOverwrites.edit(roleId, { 
                            ViewChannel: true, SendMessages: true 
                        });
                    }
                } catch (err) {
                    console.error("Errore permessi GIORNO blocco totale:", err);
                }
            }
            
            for (const id of ID_CANALI_BLOCCO_PARZIALE) {
                const canale = guild.channels.cache.get(id);
                if (canale) {
                    try {
                        await canale.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
                        for (const roleId of RUOLI_PERMESSI) {
                            await canale.permissionOverwrites.edit(roleId, { SendMessages: true });
                        }
                    } catch (err) {
                        console.error(`Errore permessi GIORNO blocco parziale ${canale.name}:`, err);
                    }
                }
            }

            const embedGiorno = new EmbedBuilder()
                .setTitle('☀️ IL GIORNO SI RISVEGLIA')
                .setDescription(`🔔 ${RUOLI_PUBBLICI.map(r => `<@&${r}>`).join(' ')}\n\nLe tenebre si dissolvono. È tornata la luce.`)
                .setColor('Gold')
                .setImage(GIF_GIORNO_START);
            
            const annunci = guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunci) await annunci.send({ embeds: [embedGiorno] });

            return message.reply("☀️ **Modalità GIORNO attivata!**");
        }

        // ==========================================
        // !NOTTE
        // ==========================================
        if (cmd === 'notte') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
            
            dbCache.currentMode = 'NIGHT';
            applyLimitsForMode();
            await saveDB();
            
            console.log("🌙 [Housing] Modalità NOTTE attivata.");
            
            const guild = message.guild;
            const categoriaDiurna = guild.channels.cache.get(ID_CATEGORIA_CHAT_DIURNA);
            const canaliDiurni = categoriaDiurna ? Array.from(categoriaDiurna.children.cache.values()).filter(c => c.type === ChannelType.GuildText) : [];
            
            for (const canale of canaliDiurni) {
                try {
                    await canale.permissionOverwrites.edit(guild.roles.everyone, { 
                        ViewChannel: false, SendMessages: false 
                    });
                } catch (err) {
                    console.error(`Errore permessi NOTTE canale ${canale.name}:`, err);
                }
            }
            
            const bloccoTotale = guild.channels.cache.get(ID_CANALE_BLOCCO_TOTALE);
            if (bloccoTotale) {
                try {
                    await bloccoTotale.permissionOverwrites.edit(guild.roles.everyone, { 
                        ViewChannel: false, SendMessages: false 
                    });
                } catch (err) {
                    console.error("Errore permessi NOTTE blocco totale:", err);
                }
            }
            
            for (const id of ID_CANALI_BLOCCO_PARZIALE) {
                const canale = guild.channels.cache.get(id);
                if (canale) {
                    try {
                        await canale.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
                    } catch (err) {
                        console.error(`Errore permessi NOTTE blocco parziale ${canale.name}:`, err);
                    }
                }
            }

            const embedNotte = new EmbedBuilder()
                .setTitle('🌙 LA NOTTE SCENDE')
                .setDescription(`🔔 ${RUOLI_PUBBLICI.map(r => `<@&${r}>`).join(' ')}\n\nIl buio avvolge il villaggio. Silenzio.`)
                .setColor('DarkBlue')
                .setImage(GIF_NOTTE_START);
            
            const annunci = guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunci) await annunci.send({ embeds: [embedNotte] });

            return message.reply("🌙 **Modalità NOTTE attivata!**");
        }

        // ==========================================
        // !TORNA
        // ==========================================
        if (cmd === 'torna') {
            const userId = message.author.id;
            const myHomeId = dbCache.playerHomes[userId];
            
            if (!myHomeId) return message.reply("⛔ Non hai una casa assegnata!");
            
            const myHome = message.guild.channels.cache.get(myHomeId);
            if (!myHome) return message.reply("⛔ La tua casa non esiste più!");

            // 🛑 CONTROLLO SE HA GIÀ UN'AZIONE IN CODA
            if (QueueModel) {
                const alreadyInQueue = await QueueModel.findOne({
                    userId: userId,
                    status: 'PENDING',
                    type: { $in: ['RETURN', 'KNOCK'] }
                });

                if (alreadyInQueue) {
                    return message.reply({
                        content: '⚠️ Hai già un\'azione in coda! Attendi che venga completata.',
                        ephemeral: true
                    });
                }
            }

            // Aggiungi alla coda
            if (QueueSystem) {
                console.log(`➕ [Housing] Aggiungendo RETURN alla coda per ${message.author.tag}`);
                await QueueSystem.add('RETURN', userId, {
                    fromChannelId: message.channel.id
                });
                return message.reply("⏳ **Azione Torna** messa in coda. Attendi...");
            } else {
                // Fallback senza coda (esecuzione immediata)
                await movePlayer(message.member, message.channel, myHome, `🏠 ${message.member} è tornato a casa.`, false);
                return message.reply("🏠 Sei tornato a casa!");
            }
        }

        // ==========================================
        // !BUSSA
        // ==========================================
        if (cmd === 'bussa') {
            const userId = message.author.id;

            // 🛑 CONTROLLO SE HA GIÀ UN'AZIONE IN CODA
            if (QueueModel) {
                const alreadyInQueue = await QueueModel.findOne({
                    userId: userId,
                    status: 'PENDING',
                    type: { $in: ['RETURN', 'KNOCK'] }
                });

                if (alreadyInQueue) {
                    return message.reply({
                        content: '⚠️ Hai già un\'azione in coda! Attendi che venga completata.'
                    });
                }
            }

            // Controllo se è già in un processo di scelta casa
            if (dbCache.pendingKnocks && dbCache.pendingKnocks.includes(userId)) {
                return message.reply("⚠️ Stai già scegliendo una casa. Completa prima l'azione in corso!");
            }

            let base, extra;
            if (dbCache.currentMode === 'DAY') {
                const limits = dbCache.dayLimits[userId] || { base: 0 };
                base = limits.base;
                extra = dbCache.extraVisitsDay ? (dbCache.extraVisitsDay[userId] || 0) : 0;
            } else {
                base = dbCache.baseVisits[userId] || DEFAULT_MAX_VISITS;
                extra = dbCache.extraVisits[userId] || 0;
            }
            const userLimit = base + extra;
            const used = dbCache.playerVisits[userId] || 0;

            const forcedAvailable = dbCache.forcedVisits[userId] || 0;
            const hiddenAvailable = dbCache.hiddenVisits[userId] || 0;
            const normalRemaining = Math.max(0, userLimit - used);

            const options = [];
            if (normalRemaining > 0) {
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel(`🚪 Normale (${normalRemaining} rimaste)`)
                    .setValue('mode_normal')
                    .setEmoji('✊')
                );
            }
            if (forcedAvailable > 0) {
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel(`💥 Forzata (${forcedAvailable} rimaste)`)
                    .setValue('mode_forced')
                    .setEmoji('🔨')
                );
            }
            if (hiddenAvailable > 0) {
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel(`🕵️ Nascosta (${hiddenAvailable} rimaste)`)
                    .setValue('mode_hidden')
                    .setEmoji('👻')
                );
            }

            if (options.length === 0) {
                return message.reply("⛔ Nessuna visita disponibile!");
            }

            // Aggiungi l'utente ai pendingKnocks
            if (!dbCache.pendingKnocks) dbCache.pendingKnocks = [];
            dbCache.pendingKnocks.push(userId);
            await saveDB();

            const selectMode = new StringSelectMenuBuilder()
                .setCustomId('knock_mode_select')
                .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMode);
            await message.reply({ content: "🔔 **Scegli il tipo di visita:**", components: [row] });
        }

        // ==========================================
        // !DISTRUGGI
        // ==========================================
        if (cmd === 'distruggi') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
            
            const targetId = args[1];
            if (!targetId) return message.reply("⚠️ Uso: `!distruggi <userId>`");
            
            const homeId = dbCache.playerHomes[targetId];
            if (!homeId) return message.reply("❌ Questo player non ha una casa.");
            
            const channel = message.guild.channels.cache.get(homeId);
            if (!channel) return message.reply("❌ Casa non trovata.");
            
            if (!dbCache.destroyedHouses) dbCache.destroyedHouses = [];
            dbCache.destroyedHouses.push(homeId);
            
            await channel.permissionOverwrites.edit(message.guild.roles.everyone, { 
                ViewChannel: false 
            });
            await channel.permissionOverwrites.delete(targetId).catch(() => {});
            await saveDB();
            
            const embedDistruzione = new EmbedBuilder()
                .setTitle('💥 DISTRUZIONE')
                .setDescription(`La casa di <@${targetId}> è stata ridotta in cenere.`)
                .setColor('DarkRed')
                .setImage(GIF_DISTRUZIONE);
            
            const annunci = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunci) await annunci.send({ embeds: [embedDistruzione] });
            
            return message.reply("💥 Casa distrutta.");
        }

        // ==========================================
        // !RICOSTRUISCI
        // ==========================================
        if (cmd === 'ricostruisci') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
            
            const targetId = args[1];
            if (!targetId) return message.reply("⚠️ Uso: `!ricostruisci <userId>`");
            
            const homeId = dbCache.playerHomes[targetId];
            if (!homeId) return message.reply("❌ Questo player non ha una casa.");
            
            const channel = message.guild.channels.cache.get(homeId);
            if (!channel) return message.reply("❌ Casa non trovata.");
            
            if (dbCache.destroyedHouses && dbCache.destroyedHouses.includes(homeId)) {
                dbCache.destroyedHouses = dbCache.destroyedHouses.filter(id => id !== homeId);
            }
            
            await channel.permissionOverwrites.create(targetId, { 
                ViewChannel: true, SendMessages: true 
            });
            await saveDB();
            
            const embedRicostruzione = new EmbedBuilder()
                .setTitle('🏗️ RICOSTRUZIONE')
                .setDescription(`La casa di <@${targetId}> risorge dalle ceneri.`)
                .setColor('Green')
                .setImage(GIF_RICOSTRUZIONE);
            
            const annunci = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (annunci) await annunci.send({ embeds: [embedRicostruzione] });
            
            return message.reply("🏗️ Casa ricostruita.");
        }

        // ==========================================
        // !SETCASA
        // ==========================================
        if (cmd === 'setcasa') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
            
            const targetUser = message.mentions.users.first();
            const targetChannel = message.mentions.channels.first();
            
            if (!targetUser || !targetChannel) {
                return message.reply("⚠️ Uso: `!setcasa @user #canale`");
            }
            
            if (targetChannel.parentId !== ID_CATEGORIA_CASE) {
                return message.reply("❌ Il canale deve essere nella categoria Case!");
            }

            await cleanOldHome(targetUser.id, message.guild);
            
            dbCache.playerHomes[targetUser.id] = targetChannel.id;
            await saveDB();
            
            await targetChannel.permissionOverwrites.create(targetUser.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });
            
            const houseMsg = await targetChannel.send(`🏠 <@${targetUser.id}>, questa è la tua dimora privata. Benvenuto!`);
            await houseMsg.pin();
            
            return message.reply(`✅ Casa assegnata: ${targetUser} → ${targetChannel}`);
        }
    });

    // ==========================================
    // INTERAZIONI SELECT MENU
    // ==========================================
    client.on('interactionCreate', async interaction => {
        if (!interaction.isStringSelectMenu()) return;

        // ==========================================
        // SCELTA MODALITÀ VISITA
        // ==========================================
        if (interaction.customId === 'knock_mode_select') {
            const selectedMode = interaction.values[0]; 
            
            const userHomeId = dbCache.playerHomes[interaction.user.id];
            const currentHouseChannel = interaction.guild.channels.cache.find(c => 
                c.parentId === ID_CATEGORIA_CASE && 
                c.permissionsFor(interaction.user).has(PermissionsBitField.Flags.ViewChannel)
            );
            const currentHouseId = currentHouseChannel ? currentHouseChannel.id : null;
            
            const tutteLeCase = interaction.guild.channels.cache
                .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
                .sort((a, b) => a.rawPosition - b.rawPosition);
            
            const caseVisitabili = Array.from(tutteLeCase.values()).filter(c => 
                c.id !== userHomeId && 
                c.id !== currentHouseId &&
                (!dbCache.destroyedHouses || !dbCache.destroyedHouses.includes(c.id))
            );

            if (caseVisitabili.length === 0) {
                // Rimuovi da pendingKnocks
                if (dbCache.pendingKnocks) {
                    dbCache.pendingKnocks = dbCache.pendingKnocks.filter(id => id !== interaction.user.id);
                    await saveDB();
                }
                return interaction.reply({ content: "❌ Nessuna casa visitabile!", ephemeral: true });
            }

            const PAGE_SIZE = 25;
            const totalPages = Math.ceil(caseVisitabili.length / PAGE_SIZE);
            
            if (totalPages === 1) {
                const selectHouse = new StringSelectMenuBuilder()
                    .setCustomId('knock_house_select')
                    .addOptions(caseVisitabili.map(c => 
                        new StringSelectMenuOptionBuilder()
                            .setLabel(formatName(c.name))
                            .setValue(`${c.id}_${selectedMode}`)
                            .setEmoji('🏠')
                    ));
                await interaction.update({ 
                    content: `📂 **Scegli la casa:**`, 
                    components: [new ActionRowBuilder().addComponents(selectHouse)] 
                });
            } else {
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

        // ==========================================
        // SCELTA CASA FINALE - CON FIX DOUBLE KNOCK
        // ==========================================
        if (interaction.customId === 'knock_house_select') {
            const parts = interaction.values[0].split('_'); 
            const targetChannelId = parts[0];
            const mode = parts[1] + '_' + parts[2]; 
            const knocker = interaction.member;

            // 🛑 CONTROLLO DOUBLE KNOCK - Verifica se ha già un'azione in coda
            if (QueueModel) {
                const alreadyInQueue = await QueueModel.findOne({
                    userId: knocker.id,
                    status: 'PENDING',
                    type: { $in: ['RETURN', 'KNOCK'] }
                });

                if (alreadyInQueue) {
                    // Rimuovi da pendingKnocks
                    if (dbCache.pendingKnocks) {
                        dbCache.pendingKnocks = dbCache.pendingKnocks.filter(id => id !== knocker.id);
                        await saveDB();
                    }
                    
                    return interaction.reply({
                        content: '⚠️ Hai già un\'azione in coda! Attendi che venga completata.',
                        ephemeral: true
                    });
                }
            }

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
            
            // Rimuovi da dbCache.pendingKnocks e salva
            if (dbCache.pendingKnocks) {
                dbCache.pendingKnocks = dbCache.pendingKnocks.filter(id => id !== knocker.id);
                await saveDB();
            }

            // --- AGGIUNTA ALLA CODA ---
            if (QueueSystem) {
                console.log(`➕ [Housing] Aggiungendo ${mode} alla coda per ${knocker.user.tag}`);
                await QueueSystem.add('KNOCK', knocker.id, {
                    targetChannelId: targetChannelId,
                    mode: mode,
                    fromChannelId: interaction.channel.id
                });
                await interaction.reply({ content: "⏳ **Azione Bussa** messa in coda. Attendi...", ephemeral: true });
            } else {
                // Fallback se coda non disponibile (esecuzione immediata)
                await interaction.reply({ content: "✅ Esecuzione immediata...", ephemeral: true });
                
                const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
                const fromChannel = interaction.channel;
                
                // A. Ingressi immediati (Forzata/Nascosta)
                if (mode === 'mode_forced') {
                    const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(', ');
                    await enterHouse(knocker, fromChannel, targetChannel, `${roleMentions}, ${knocker} ha sfondato la porta ed è entrato`, false);
                    return;
                } 
                if (mode === 'mode_hidden') {
                    await enterHouse(knocker, fromChannel, targetChannel, "", true);
                    return;
                }

                // B. Visita Normale -> TOC TOC
                const membersWithAccess = targetChannel.members.filter(m => 
                    !m.user.bot && m.id !== knocker.id && m.roles.cache.hasAny(...RUOLI_PERMESSI)
                );

                // Se vuota, entra subito
                if (membersWithAccess.size === 0) {
                    await enterHouse(knocker, fromChannel, targetChannel, `👋 ${knocker} è entrato.`, false);
                    return;
                }

                // Se c'è gente, invia il messaggio TOC TOC
                const roleMentions = RUOLI_PERMESSI.map(id => `<@&${id}>`).join(' ');
                const msg = await targetChannel.send(`🔔 **TOC TOC!** ${roleMentions}\nQualcuno sta bussando\n✅ = Apri | ❌ = Rifiuta`);
                await msg.react('✅'); 
                await msg.react('❌');

                const filter = (reaction, user) => 
                    ['✅', '❌'].includes(reaction.emoji.name) && 
                    membersWithAccess.has(user.id);
                
                const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 });

                collector.on('collect', async (reaction, user) => {
                    if (reaction.emoji.name === '✅') {
                        await msg.reply(`✅ Qualcuno ha aperto.`);
                        await enterHouse(knocker, fromChannel, targetChannel, `👋 ${knocker} è entrato.`, false);
                    } else {
                        const currentRefused = dbCache.playerVisits[knocker.id] || 0;
                        dbCache.playerVisits[knocker.id] = currentRefused + 1;
                        await saveDB();

                        await msg.reply(`❌ Qualcuno ha rifiutato.`);

                        const presentPlayers = targetChannel.members
                            .filter(m => !m.user.bot && m.id !== knocker.id && !m.permissions.has(PermissionsBitField.Flags.Administrator))
                            .map(m => m.displayName)
                            .join(', ');

                        if (fromChannel) {
                            await fromChannel.send(`⛔ ${knocker}, entrata rifiutata. I giocatori presenti in quella casa sono: ${presentPlayers || 'Nessuno'}`);
                        }
                    }
                });

                collector.on('end', async collected => {
                    if (collected.size === 0) {
                        await msg.reply('⏳ Nessuno ha risposto. La porta viene forzata.');
                        await enterHouse(knocker, fromChannel, targetChannel, `👋 ${knocker} è entrato.`, false);
                    }
                });
            }
    }
    }); // Chiude il client.on('interactionCreate'...)

    // Restituisci la funzione esecutore alla coda
    return executeHousingAction;
};
