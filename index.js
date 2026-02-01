require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const { 
    Client, GatewayIntentBits, Partials, Options, PermissionsBitField, 
    ChannelType, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle 
} = require('discord.js');

// ==========================================
// 1. CONFIGURAZIONE
// ==========================================

const TOKEN = process.env.TOKEN; 
const MONGO_URI = process.env.MONGO_URI;
const PREFIX = '!';

// --- CONFIGURAZIONE CASE ---
const ID_CATEGORIA_CASE = '1460741413388947528';
const ID_CATEGORIA_CHAT_PRIVATE = '1460741414357827747'; 
const ID_CATEGORIA_CHAT_DIURNA = '1460741410599866413';
const ID_CANALE_ANNUNCI = '1460741475804381184'; 
const ID_CANALE_BLOCCO_TOTALE = '1460741488815247567'; 
const ID_CANALI_BLOCCO_PARZIALE = ['1464941042380837010', '1460741484226543840', '1460741486290276456', '1460741488135635030'];

const RUOLI_NOTIFICA = { R1: '1460741403331268661', R2: '1460741404497019002', R3: '1460741405722022151' };
const GIFS = {
    NOTTE: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExbWl6d2w2NWhkM2QwZWR6aDZ5YW5pdmFwMjR4NGd1ZXBneGo4NmhvayZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/LMomqSiRZF3zi/giphy.gif',
    GIORNO: 'https://media.giphy.com/media/jxbtTiXsCUZQXOKP2M/giphy.gif',
    DISTRUZIONE: 'https://i.giphy.com/media/oe33xf3B50fsc/giphy.gif',
    RICOSTRUZIONE: 'https://i.giphy.com/media/3ohjUS0WqYBpczfTlm/giphy.gif'
};
const RUOLI_PERMESSI_CASA = ['1460741403331268661', '1460741404497019002']; 

// --- CONFIGURAZIONE MEETING ---
const CONFIG_MEETING = {
    SERVER: { COMMAND_GUILD: '1460740887494787259', TARGET_GUILD: '1463608688244822018', TARGET_CAT: '1463608688991273015' },
    CHANNELS: { WELCOME: '1460740888450830501' },
    ROLES: {
        RESET: '1460741401435181295', MEETING_1: '1460741403331268661', MEETING_2: '1460741402672758814',
        PLAYER_AUTO: '1460741403331268661', SPONSOR_AUTO: '1460741404497019002', ALT_CHECK: '1460741402672758814', AUTO_JOIN: '1460741402672758814'
    },
    LIMITS: { MAX_MEETINGS: 3, MAX_READINGS: 1 }
};

// ==========================================
// 2. SETUP DATI
// ==========================================
const app = express();
app.get('/', (req, res) => res.send('Bot Complete Alive!'));
app.listen(8000, () => console.log('🌍 Web Server pronto.'));

mongoose.connect(MONGO_URI).then(() => console.log('✅ MongoDB Connesso!')).catch(e => console.error('❌ Errore Mongo:', e));

const botSchema = new mongoose.Schema({
    id: { type: String, default: 'main' },
    // MEETING
    isAutoRoleActive: { type: Boolean, default: false },
    meetingCounts: { type: Object, default: {} },
    letturaCounts: { type: Object, default: {} },
    activeUsers: { type: Array, default: [] },
    table: { type: Object, default: { limit: 0, slots: [], messageId: null } },
    activeGameSlots: { type: Array, default: [] },
    // CASE
    playerHomes: { type: Object, default: {} },
    playerVisits: { type: Object, default: {} },
    baseVisits: { type: Object, default: {} },
    extraVisits: { type: Object, default: {} },
    forcedLimits: { type: Object, default: {} },
    hiddenLimits: { type: Object, default: {} },
    dayLimits: { type: Object, default: {} },
    extraVisitsDay: { type: Object, default: {} },
    currentMode: { type: String, default: 'NIGHT' },
    forcedVisits: { type: Object, default: {} },
    hiddenVisits: { type: Object, default: {} },
    playerModes: { type: Object, default: {} },
    destroyedHouses: { type: Array, default: [] },
    multiplaHistory: { type: Object, default: {} }, // Fondamentale per !multipla
    lastReset: { type: String, default: null }
}, { strict: false });

const BotModel = mongoose.model('BotDataFull', botSchema);

async function getData() {
    let data = await BotModel.findOne({ id: 'main' });
    if (!data) { data = new BotModel({ id: 'main' }); await data.save(); }
    return data;
}

// ==========================================
// 3. LOGICA & UTILS
// ==========================================
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    makeCache: Options.cacheWithLimits({ MessageManager: 10, GuildMemberManager: 10, UserManager: 10 })
});

const pendingKnocks = new Set(); 

function formatName(name) { return name.replace(/-/g, ' ').toUpperCase().substring(0, 25); }
function generateTableText(table) {
    let text = "**Giocatori** \u200b \u200b| \u200b \u200b **Sponsor**\n------------------\n";
    table.slots.forEach((s, i) => text += `**#${i+1}** ${s.player?`<@${s.player}>`:"`(libero)`"} | ${s.sponsor?`<@${s.sponsor}>`:"`(libero)`"}\n`);
    return text;
}
function applyLimitsForMode(data) {
    data.playerVisits = {}; 
    const allUsers = new Set([...Object.keys(data.playerHomes||{}), ...Object.keys(data.baseVisits||{}), ...Object.keys(data.dayLimits||{})]);
    allUsers.forEach(uid => {
        if (data.currentMode === 'DAY') {
            const l = data.dayLimits[uid] || {forced:0, hidden:0};
            data.forcedVisits[uid] = l.forced; data.hiddenVisits[uid] = l.hidden;
        } else {
            data.forcedVisits[uid] = data.forcedLimits[uid]||0; data.hiddenVisits[uid] = data.hiddenLimits[uid]||0;
        }
    });
}
async function cleanOldHome(userId, guild, data) {
    const oldId = data.playerHomes[userId];
    if (oldId) {
        const c = guild.channels.cache.get(oldId);
        if (c) {
            try {
                const pins = await c.messages.fetchPinned();
                const k = pins.find(m => m.content.includes("questa è la tua dimora privata"));
                if (k) await k.delete();
            } catch (e) {}
        }
    }
}
async function movePlayer(member, oldCh, newCh, msg, isSilent, data) {
    if (!member || !newCh) return;
    let leave = oldCh;
    if (oldCh && oldCh.parentId === ID_CATEGORIA_CHAT_PRIVATE) {
        leave = oldCh.guild.channels.cache.find(c => c.parentId === ID_CATEGORIA_CASE && c.permissionsFor(member).has(PermissionsBitField.Flags.ViewChannel));
    }
    if (leave && leave.id !== newCh.id && leave.parentId === ID_CATEGORIA_CASE) {
        if (data.playerModes[member.id] !== 'HIDDEN') await leave.send(`🚪 ${member} è uscito.`);
        await leave.permissionOverwrites.delete(member.id).catch(()=>{});
    }
    await newCh.permissionOverwrites.create(member.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    data.playerModes[member.id] = isSilent ? 'HIDDEN' : 'NORMAL';
    data.markModified('playerModes');
    if (!isSilent) await newCh.send(msg);
}

// ==========================================
// 4. EVENTI & COMANDI
// ==========================================
client.once('ready', async () => {
    console.log(`✅ BOT ONLINE: ${client.user.tag}`);
    const data = await getData();
    const today = new Date().toDateString();
    if (data.lastReset !== today) {
        applyLimitsForMode(data); data.lastReset = today; await data.save();
        console.log("🔄 Reset Giornaliero.");
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);

    try {
        const data = await getData();

        // --- COMANDI ADMIN CASE ---
        if (command === 'assegnacasa' && isAdmin) {
            const user = message.mentions.members.first(); const ch = message.mentions.channels.first();
            if (!user || !ch) return message.reply("❌ `!assegnacasa @user #channel`");
            data.playerHomes[user.id] = ch.id; data.markModified('playerHomes'); await data.save();
            await ch.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true });
            const msg = await ch.send(`🔑 **${user}**, dimora assegnata.`); await msg.pin();
            return message.reply("✅ Fatto.");
        }

                if (command === 'sposta' && isAdmin) {
            const user = message.mentions.members.first();
            const dest = message.mentions.channels.first();
            if (!user || !dest) return message.reply("❌ Uso: `!sposta @Utente #Canale`");

            // Cerca dov'è ora l'utente per toglierlo da lì
            const currentLoc = message.guild.channels.cache.find(c => 
                c.parentId === ID_CATEGORIA_CASE && 
                c.permissionsFor(user).has(PermissionsBitField.Flags.ViewChannel)
            );

            await movePlayer(user, currentLoc, dest, `🚚 **${user.displayName}** è entrato.`, false, data);
            await data.save();
            message.reply(`✅ Spostato ${user.displayName} in ${dest}.`);
        }

        if (command === 'visite' && isAdmin) {
            const user = message.mentions.members.first();
            const [b, f, h] = [parseInt(args[1]), parseInt(args[2]), parseInt(args[3])];
            if (!user || isNaN(b)) return message.reply("❌ `!visite @user Base Forz Nasc`");
            data.baseVisits[user.id] = b; data.forcedLimits[user.id] = f; data.hiddenLimits[user.id] = h;
            if (data.currentMode === 'NIGHT') { data.forcedVisits[user.id] = f; data.hiddenVisits[user.id] = h; }
            data.markModified('baseVisits'); data.markModified('forcedLimits'); data.markModified('hiddenLimits'); await data.save();
            return message.reply("✅ Config Notte salvata.");
        }

        if (command === 'giorno' && isAdmin) {
            const arg = args[0];
            if (message.mentions.members.size > 0) {
                const user = message.mentions.members.first();
                const [b, f, h] = [parseInt(args[1]), parseInt(args[2]), parseInt(args[3])];
                data.dayLimits[user.id] = { base: b, forced: f, hidden: h };
                if (data.currentMode === 'DAY') { data.forcedVisits[user.id] = f; data.hiddenVisits[user.id] = h; }
                data.markModified('dayLimits'); await data.save();
                return message.reply("✅ Config Giorno utente salvata.");
            }
            if (!arg) return message.reply("❌ `!giorno 1`");
            data.currentMode = 'DAY'; applyLimitsForMode(data); await data.save();
            const ann = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (ann) ann.send({ content: `<@&${RUOLI_NOTIFICA.R1}> <@&${RUOLI_NOTIFICA.R2}>\n☀️ **GIORNO ${arg}**`, files: [GIFS.GIORNO] });
            // Sblocco Chat
            const cat = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_DIURNA);
            if (cat) cat.children.cache.filter(c => c.type === ChannelType.GuildText).forEach(async c => {
                if (c.id === ID_CANALE_BLOCCO_TOTALE) return;
                const roles = ID_CANALI_BLOCCO_PARZIALE.includes(c.id) ? [RUOLI_NOTIFICA.R1] : [RUOLI_NOTIFICA.R1, RUOLI_NOTIFICA.R2, RUOLI_NOTIFICA.R3];
                for (const r of roles) if (r) await c.permissionOverwrites.edit(r, { SendMessages: true }).catch(()=>{});
                try { const m = await c.send(`☀️ **GIORNO ${arg}**`); await m.pin(); } catch(e){}
            });
            return message.reply("✅ Giorno avviato.");
        }

        if (command === 'notte' && isAdmin) {
            const arg = args[0];
            if (!arg) return message.reply("❌ `!notte 1`");
            data.currentMode = 'NIGHT'; applyLimitsForMode(data); await data.save();
            const ann = message.guild.channels.cache.get(ID_CANALE_ANNUNCI);
            if (ann) ann.send({ content: `🌑 **NOTTE ${arg}**`, files: [GIFS.NOTTE] });
            // Blocco Chat
            const cat = message.guild.channels.cache.get(ID_CATEGORIA_CHAT_DIURNA);
            if (cat) cat.children.cache.filter(c => c.type === ChannelType.GuildText).forEach(c => {
                [RUOLI_NOTIFICA.R1, RUOLI_NOTIFICA.R2, RUOLI_NOTIFICA.R3].forEach(async r => { if (r) await c.permissionOverwrites.edit(r, { SendMessages: false }).catch(()=>{}); });
            });
            return message.reply("✅ Notte avviata.");
        }

        if (command === 'aggiunta' && isAdmin) {
            const isDay = args[0].toLowerCase() === 'giorno';
            const offset = isDay ? 1 : 0;
            const type = args[offset]; const user = message.mentions.members.first(); const amount = parseInt(args[offset+2]);
            if (!type || !user || isNaN(amount)) return message.reply("❌ `!aggiunta [giorno] base/nascosta/forzata @user N`");
            if (isDay) {
                if (type === 'base') data.extraVisitsDay[user.id] = (data.extraVisitsDay[user.id]||0) + amount;
                else if (data.currentMode === 'DAY') {
                    if (type === 'nascosta') data.hiddenVisits[user.id] = (data.hiddenVisits[user.id]||0) + amount;
                    if (type === 'forzata') data.forcedVisits[user.id] = (data.forcedVisits[user.id]||0) + amount;
                } else return message.reply("⚠ Attiva Giorno prima.");
                data.markModified('extraVisitsDay');
            } else {
                if (type === 'base') data.extraVisits[user.id] = (data.extraVisits[user.id]||0) + amount;
                else if (data.currentMode === 'NIGHT') {
                    if (type === 'nascosta') data.hiddenVisits[user.id] = (data.hiddenVisits[user.id]||0) + amount;
                    if (type === 'forzata') data.forcedVisits[user.id] = (data.forcedVisits[user.id]||0) + amount;
                } else return message.reply("⚠ Attiva Notte prima.");
                data.markModified('extraVisits');
            }
            await data.save();
            return message.reply(`✅ Aggiunte ${amount} visite.`);
        }

        if (command === 'distruzione' && isAdmin) {
            const ch = message.mentions.channels.first();
            if (!ch) return;
            data.destroyedHouses.push(ch.id); await data.save();
            const ownerId = Object.keys(data.playerHomes).find(k => data.playerHomes[k] === ch.id);
            for (const [mid, m] of ch.members.filter(m => !m.user.bot)) {
                let dest = null;
                if (mid === ownerId) dest = message.guild.channels.cache.filter(c => c.parentId === ID_CATEGORIA_CASE && c.id !== ch.id && !data.destroyedHouses.includes(c.id)).random();
                else { const h = data.playerHomes[mid]; if (h && !data.destroyedHouses.includes(h)) dest = message.guild.channels.cache.get(h); }
                if (dest) await movePlayer(m, ch, dest, "💥 Fuga distruzione!", false, data);
            }
            await data.save();
            message.reply("🏚️ Distrutta.");
        }

        if (command === 'ricostruzione' && isAdmin) {
            const ch = message.mentions.channels.first();
            data.destroyedHouses = data.destroyedHouses.filter(id => id !== ch.id);
            const owners = Object.keys(data.playerHomes).filter(k => data.playerHomes[k] === ch.id);
            owners.forEach(o => delete data.playerHomes[o]); data.markModified('playerHomes'); await data.save();
            message.reply("🏗️ Ricostruita.");
        }

        if (command === 'resetvisite' && isAdmin) {
            data.extraVisits = {}; data.extraVisitsDay = {}; data.playerVisits = {}; applyLimitsForMode(data); await data.save();
            message.reply("♻️ Reset Totale Visite.");
        }

        if (command === 'dove' && isAdmin) {
            const user = message.mentions.members.first();
            if (!user) return message.reply("❌ `!dove @user`");
            const locs = message.guild.channels.cache.filter(c => c.parentId === ID_CATEGORIA_CASE && c.permissionOverwrites.cache.get(user.id)?.allow.has(PermissionsBitField.Flags.ViewChannel));
            message.reply(locs.size > 0 ? `📍 In: ${locs.map(c => c.toString()).join(', ')}` : "❌ In nessuna casa.");
        }

        if (command === 'chi') {
            const ch = message.mentions.channels.first() || message.channel;
            if (ch.parentId !== ID_CATEGORIA_CASE) return;
            const inside = ch.members.filter(m => !m.user.bot && ch.permissionsFor(m).has(PermissionsBitField.Flags.ViewChannel)).map(m => m.toString()).join('\n');
            const ownerId = Object.keys(data.playerHomes).find(k => data.playerHomes[k] === ch.id);
            message.channel.send({ embeds: [new EmbedBuilder().setTitle(`👥 In: ${formatName(ch.name)}`).setDescription(inside || "Nessuno").addFields({ name: "Proprietario", value: ownerId ? `<@${ownerId}>` : "Nessuno" })] });
        }

        // --- COMANDI AGGIUNTI (MULTIPLA / RITIRATA) ---
        if (command === 'multipla' && isAdmin) {
            const user = message.mentions.members.first();
            if (!user) return message.reply("❌ `!multipla @user #casa1 si narra...`");
            if (!data.multiplaHistory[user.id]) data.multiplaHistory[user.id] = [];
            const rawArgs = message.content.slice(PREFIX.length + command.length).trim().split(/ +/);
            let write = false, narra = false;
            let actions = [];
            for (const arg of rawArgs) {
                if (arg.includes(user.id)) continue;
                if (arg === 'si') write = true; else if (arg === 'no') write = false;
                else if (arg === 'narra') narra = true; else if (arg === 'muto') narra = false;
                
                if (actions.length > 0) { actions[actions.length - 1].w = write; actions[actions.length - 1].n = narra; }
                if (arg.match(/^<#(\d+)>$/)) {
                    const c = message.guild.channels.cache.get(arg.replace(/\D/g, ''));
                    if (c && c.parentId === ID_CATEGORIA_CASE) actions.push({ ch: c, w: write, n: narra });
                }
            }
            for (const act of actions) {
                if (!data.multiplaHistory[user.id].includes(act.ch.id)) data.multiplaHistory[user.id].push(act.ch.id);
                await act.ch.permissionOverwrites.create(user.id, { ViewChannel: true, SendMessages: act.w, ReadMessageHistory: true });
                if (act.n) await act.ch.send(`👋 **${user.displayName}** è entrato.`);
            }
            data.markModified('multiplaHistory'); await data.save();
            message.reply(`✅ Applicato a ${actions.length} case.`);
        }

        if (command === 'ritirata' && isAdmin) {
            const user = message.mentions.members.first();
            if (!user) return message.reply("❌ `!ritirata @user #casa1...`");
            const rawArgs = message.content.slice(PREFIX.length + command.length).trim().split(/ +/);
            let narra = false, write = null, toRemove = [];
            for (const arg of rawArgs) {
                if (arg.includes(user.id)) continue;
                if (arg === 'narra') narra = true; else if (arg === 'muto') narra = false;
                else if (arg === 'si') write = true; else if (arg === 'no') write = false;
                if (toRemove.length > 0) toRemove[toRemove.length - 1].n = narra;
                if (arg.match(/^<#(\d+)>$/)) {
                    const c = message.guild.channels.cache.get(arg.replace(/\D/g, ''));
                    if (c) toRemove.push({ ch: c, n: narra });
                }
            }
            for (const act of toRemove) {
                if (act.n) await act.ch.send(`🚪 **${user.displayName}** è uscito.`);
                await act.ch.permissionOverwrites.delete(user.id).catch(()=>{});
            }
            // Aggiorna History e Case rimaste
            const removedIds = toRemove.map(x => x.ch.id);
            data.multiplaHistory[user.id] = (data.multiplaHistory[user.id] || []).filter(id => !removedIds.includes(id));
            if (write !== null) {
                for (const hid of data.multiplaHistory[user.id]) {
                    const c = message.guild.channels.cache.get(hid);
                    if (c) await c.permissionOverwrites.create(user.id, { ViewChannel: true, SendMessages: write, ReadMessageHistory: true });
                }
            }
            data.markModified('multiplaHistory'); await data.save();
            message.reply(`✅ Rimossi ${toRemove.length} canali.`);
        }

        // --- COMANDI USER CASE ---
        if (command === 'trasferimento') {
            if (message.channel.parentId !== ID_CATEGORIA_CASE) return;
            const req = message.author; const ch = message.channel;
            const ownerId = Object.keys(data.playerHomes).find(k => data.playerHomes[k] === ch.id);
            if (!ownerId) {
                await cleanOldHome(req.id, message.guild, data);
                data.playerHomes[req.id] = ch.id; data.markModified('playerHomes'); await data.save();
                await ch.permissionOverwrites.edit(req.id, { ViewChannel: true, SendMessages: true });
                (await ch.send(`🔑 **${req}**, casa tua.`)).pin();
                return message.reply("✅ Trasferito.");
            }
            const owner = message.guild.members.cache.get(ownerId);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`tr_yes_${req.id}`).setLabel('Sì').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`tr_no_${req.id}`).setLabel('No').setStyle(ButtonStyle.Danger));
            let tCh = ch.permissionsFor(owner).has(PermissionsBitField.Flags.ViewChannel) ? ch : message.guild.channels.cache.get(ID_CATEGORIA_CHAT_PRIVATE)?.children.cache.find(c => c.permissionsFor(owner).has(PermissionsBitField.Flags.ViewChannel));
            if (tCh) { tCh.send({ content: `🔔 <@${owner.id}>, ${req} vuole trasferirsi.`, components: [row] }); message.reply("📩 Inviata."); }
        }

        if (command === 'torna') {
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return;
            const hId = data.playerHomes[message.author.id];
            if (!hId || data.destroyedHouses.includes(hId)) return message.reply("❌ Non hai casa agibile.");
            await movePlayer(message.member, message.channel, message.guild.channels.cache.get(hId), `🏠 ${message.member} è tornato.`, false, data);
            await data.save();
        }

        if (command === 'rimaste') {
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return;
            const b = (data.currentMode==='DAY'?data.dayLimits[message.author.id]?.base:data.baseVisits[message.author.id])||0;
            const e = (data.currentMode==='DAY'?data.extraVisitsDay[message.author.id]:data.extraVisits[message.author.id])||0;
            message.reply(`📊 **Visite (${data.currentMode})**: Usate ${data.playerVisits[message.author.id]||0}/${b+e} | F: ${data.forcedVisits[message.author.id]||0} | N: ${data.hiddenVisits[message.author.id]||0}`);
        }

        if (command === 'bussa') {
            if (message.channel.parentId !== ID_CATEGORIA_CHAT_PRIVATE) return;
            if (pendingKnocks.has(message.author.id)) return message.reply("⏳ Già bussando.");
            const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('knock_mode').setPlaceholder('Entrata').addOptions({label:'Normale',value:'n',emoji:'👋'},{label:'Forzata',value:'f',emoji:'🧨'},{label:'Nascosta',value:'h',emoji:'🕵️'}));
            message.channel.send({ content: "Scegli:", components: [row] });
        }

        // --- COMANDI MEETING ---
        if (message.guild.id === CONFIG_MEETING.SERVER.COMMAND_GUILD) {
            if (command === 'impostazioni') message.reply("⚙️ Bot Attivo.");
            if (command === 'tabella' && isAdmin) {
                const n = parseInt(args[0]); data.table = { limit: n, slots: Array(n).fill({}), messageId: null }; data.activeGameSlots = []; await data.save();
                const opts = Array.from({length:Math.min(n,25)},(_,i)=>({label:`${i+1}`,value:`${i}`}));
                message.channel.send({ embeds:[new EmbedBuilder().setDescription(generateTableText(data.table))], components:[
                    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('sel_pl').setPlaceholder('Giocatore').addOptions(opts)),
                    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('sel_sp').setPlaceholder('Sponsor').addOptions(opts))
                ]});
            }
            if (command === 'assegna' && isAdmin) { data.activeGameSlots=[...data.table.slots]; data.table.limit=0; await data.save(); message.reply("🚀 Assegnato."); }
            if (command === 'meeting' && message.member.roles.cache.has(CONFIG_MEETING.ROLES.PLAYER_AUTO)) {
                const t = message.mentions.users.first();
                if (!t || data.activeUsers.includes(message.author.id) || data.activeUsers.includes(t.id)) return message.reply("❌ Occupato.");
                data.meetingCounts[message.author.id]=(data.meetingCounts[message.author.id]||0)+1;
                data.meetingCounts[t.id]=(data.meetingCounts[t.id]||0)+1;
                data.activeUsers.push(message.author.id, t.id); data.markModified('meetingCounts'); data.markModified('activeUsers'); await data.save();
                const c = await client.guilds.cache.get(CONFIG_MEETING.SERVER.TARGET_GUILD).channels.create({ name:`meeting-${message.author.username}-${t.username}`, type:ChannelType.GuildText, parent:CONFIG_MEETING.SERVER.TARGET_CAT });
                await c.permissionOverwrites.create(message.author.id, { ViewChannel:true, SendMessages:true });
                await c.permissionOverwrites.create(t.id, { ViewChannel:true, SendMessages:true });
                c.send(`🔔 Meeting: ${message.author} & ${t}. !fine per chiudere.`); message.reply("✅ Meeting creato.");
            }
            if (command === 'fine' && message.channel.name.startsWith('meeting-')) {
                const u = message.channel.members.map(m=>m.id); data.activeUsers = data.activeUsers.filter(id=>!u.includes(id)); await data.save();
                message.channel.send("🛑 Chiuso."); message.channel.permissionOverwrites.cache.forEach(p=>message.channel.permissionOverwrites.edit(p.id,{SendMessages:false}));
            }
        }
    } catch (e) { console.error(e); }
});

// ==========================================
// 5. INTERAZIONI
// ==========================================
client.on('interactionCreate', async i => {
    if (!i.isStringSelectMenu() && !i.isButton()) return;
    const data = await getData();
    try {
        if (i.customId === 'knock_mode') {
            const m = i.values[0];
            const opts = i.guild.channels.cache.filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText && !data.destroyedHouses.includes(c.id)).map(c => ({label:formatName(c.name),value:`${c.id}_${m}`})).slice(0,25);
            i.reply({content:"Casa:",components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('knock_house').addOptions(opts))],ephemeral:true});
        }
        if (i.customId === 'knock_house') {
            const [hid, m] = i.values[0].split('_'); const t = i.guild.channels.cache.get(hid); const u = i.member;
            if (m === 'f') {
                if ((data.forcedVisits[u.id]||0)>0) { data.forcedVisits[u.id]--; await data.save(); await movePlayer(u, i.channel, t, `🧨 ${u} SFONDA!`, false, data); i.update({content:"💥 Entrato.",components:[]}); }
                else i.reply({content:"❌ Forzate finite.",ephemeral:true});
            } else if (m === 'h') {
                if ((data.hiddenVisits[u.id]||0)>0) { data.hiddenVisits[u.id]--; await data.save(); await movePlayer(u, i.channel, t, "", true, data); i.update({content:"🕵️ Entrato.",components:[]}); }
                else i.reply({content:"❌ Nascoste finite.",ephemeral:true});
            } else {
                const l = (data.currentMode==='DAY'?data.dayLimits[u.id]?.base:data.baseVisits[u.id])||0;
                const e = (data.currentMode==='DAY'?data.extraVisitsDay[u.id]:data.extraVisits[u.id])||0;
                if ((data.playerVisits[u.id]||0)>=l+e) return i.reply({content:"❌ Finite.",ephemeral:true});
                pendingKnocks.add(u.id); i.update({content:"✊ Bussato...",components:[]});
                const msg = await t.send(`🔔 **TOC TOC!**\n✅ Apri | ❌ Rifiuta`); await msg.react('✅'); await msg.react('❌');
                msg.createReactionCollector({filter:(r,user)=>['✅','❌'].includes(r.emoji.name)&&!user.bot&&t.permissionsFor(user).has(PermissionsBitField.Flags.SendMessages),time:300000,max:1})
                .on('collect', async r => {
                    if (r.emoji.name==='✅') { data.playerVisits[u.id]=(data.playerVisits[u.id]||0)+1; await data.save(); await movePlayer(u, i.channel, t, `👋 ${u} entra.`, false, data); msg.edit("✅ Aperto."); }
                    else { data.playerVisits[u.id]=(data.playerVisits[u.id]||0)+1; await data.save(); msg.edit("⛔ Rifiutato."); }
                    pendingKnocks.delete(u.id);
                });
            }
        }
        if (i.customId.startsWith('tr_yes_')) {
            const uid = i.customId.split('_')[2]; const ch = i.message.channel; // Contesto semplificato
            await cleanOldHome(uid, i.guild, data); data.playerHomes[uid] = ch.id; data.markModified('playerHomes'); await data.save();
            await i.guild.channels.cache.get(ch.id).permissionOverwrites.edit(uid, {ViewChannel:true, SendMessages:true});
            i.update({content:"✅ Accettato.",components:[]});
        }
        if (i.customId === 'sel_pl' || i.customId === 'sel_sp') {
            const idx = parseInt(i.values[0]); const type = i.customId==='sel_pl'?'player':'sponsor';
            if (data.table.slots[idx][type]) return i.reply({content:"Occupato.",ephemeral:true});
            data.table.slots[idx][type] = i.user.id; data.markModified('table'); await data.save();
            i.update({embeds:[new EmbedBuilder().setDescription(generateTableText(data.table))]});
        }
    } catch (e) { console.error(e); }
});


client.login(TOKEN);
