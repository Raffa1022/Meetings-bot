// ================== DISCORD GDR BOT ==================
const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ChannelType,
    PermissionFlagsBits,
    Partials
} = require('discord.js');

const mongoose = require('mongoose');
const express = require('express');

// ================== CONFIG ==================
const TOKEN = 'MTQ2MzU5NDkwMTAzOTIyMjg3Nw.G2ZqJU.HRxjqWMs2fIwblzW2B2SUXcYhUZ8BkeWioLmss';

// 🔴 DATABASE (INSERITO MANUALMENTE)
const MONGO_URI = 'mongodb://127.0.0.1:27017';
const DATABASE_NAME = '1464940718933151839';

const PREFIX = '!';
const ID_CATEGORIA_CASE = '1460741413388947528';
const ROLES_IDS = ['1460741403331268661', '1460741404497019002', '1460741402672758814'];

// ================== MONGOOSE ==================
mongoose.connect(`${MONGO_URI}/${DATABASE_NAME}`);

const PlayerSchema = new mongoose.Schema({
    userId: String,
    homeId: String,
    visits: { type: Number, default: 0 },
    maxVisits: { type: Number, default: 3 }
});

const Player = mongoose.model('Player', PlayerSchema);

// ================== CLIENT ==================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ================== READY ==================
client.once('ready', () => {
    console.log('✅ Bot GDR Online');

    const app = express();
    app.get('/health', (_, res) => res.sendStatus(200));
    app.listen(3000);
});

// ================== MESSAGE HANDLER ==================
client.on('messageCreate', safe(async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const cmd = args.shift()?.toLowerCase();

    // ===== ASSEGNA CASA =====
    if (cmd === 'assegnacasa') {
        if (!isAdmin(message.member)) return message.reply('⛔ Non admin');

        const user = message.mentions.members.first();
        const channel = message.mentions.channels.first();
        if (!user || !channel) {
            return message.reply('❌ !assegnacasa @utente #canale');
        }

        await Player.findOneAndUpdate(
            { userId: user.id },
            { homeId: channel.id },
            { upsert: true }
        );

        await channel.permissionOverwrites.set([
            { id: message.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
        ]);

        message.reply(`✅ Casa assegnata a ${user}`);
    }

    // ===== SET MAX VISITE =====
    if (cmd === 'setmaxvisite') {
        if (!isAdmin(message.member)) return;

        const user = message.mentions.members.first();
        const num = parseInt(args[1]);
        if (!user || isNaN(num)) return;

        await Player.findOneAndUpdate(
            { userId: user.id },
            { maxVisits: num },
            { upsert: true }
        );

        message.reply(`✅ ${user} max visite: ${num}`);
    }

    // ===== BUSSA =====
    if (cmd === 'bussa') {
        const player = await getPlayer(message.author.id);
        if (player.visits >= player.maxVisits) {
            return message.reply('⛔ Visite terminate');
        }

        const houses = message.guild.channels.cache
            .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
            .sort((a, b) => {
                const na = parseInt(a.name.match(/(\d+)/)?.[1] || 0);
                const nb = parseInt(b.name.match(/(\d+)/)?.[1] || 0);
                return na - nb;
            });

        const options = houses.map(c =>
            new StringSelectMenuOptionBuilder()
                .setLabel(c.name)
                .setValue(c.id)
        ).slice(0, 25);

        const menu = new StringSelectMenuBuilder()
            .setCustomId('knock_house_select')
            .setPlaceholder('Scegli una casa')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(menu);
        message.reply({ content: '🚪 Dove vuoi bussare?', components: [row] });
    }
}));

// ================== INTERACTION ==================
client.on('interactionCreate', safe(async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId !== 'knock_house_select') return;

    const visitor = interaction.member;
    const channel = interaction.guild.channels.cache.get(interaction.values[0]);
    const player = await getPlayer(visitor.id);

    if (player.visits >= player.maxVisits) {
        return interaction.reply({ content: '⛔ Visite finite', ephemeral: true });
    }

    // RUOLI PRESENTI
    const rolesInHouse = new Set();
    channel.members.forEach(m => {
        m.roles.cache.forEach(r => {
            if (ROLES_IDS.includes(r.id)) rolesInHouse.add(r.id);
        });
    });

    const mentions = [...rolesInHouse].map(r => `<@&${r}>`).join(' ');

    await interaction.reply({ content: `✊ Bussato a **${channel.name}**`, ephemeral: true });

    const knock = await channel.send(
        `🔔 **TOC TOC!** ${mentions}\n✅ Apri | ❌ Rifiuta`
    );

    await knock.react('✅');
    await knock.react('❌');

    try {
        const collected = await knock.awaitReactions({
            max: 1,
            time: 300000,
            filter: async (r, u) => {
                if (!['✅', '❌'].includes(r.emoji.name)) return false;
                const m = await interaction.guild.members.fetch(u.id);
                return ROLES_IDS.some(id => m.roles.cache.has(id));
            }
        });

        const reaction = collected.first();
        await knock.reactions.removeAll().catch(() => {});

        player.visits++;
        await player.save();

        if (reaction.emoji.name === '✅') {
            await channel.permissionOverwrites.edit(visitor.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });
            channel.send('*La porta si apre.*');
        } else {
            channel.send('*Accesso negato.*');
            visitor.send('⛔ Ti hanno rifiutato').catch(() => {});
        }
    } catch {
        player.visits++;
        await player.save();

        await channel.permissionOverwrites.edit(visitor.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        });
        channel.send('*Nessuno risponde. Entri comunque.*');
    }
}));

// ================== FUNZIONI ==================
async function getPlayer(id) {
    let p = await Player.findOne({ userId: id });
    if (!p) p = await Player.create({ userId: id });
    return p;
}

function isAdmin(member) {
    return member.permissions.has(PermissionFlagsBits.Administrator);
}

function safe(fn) {
    return async (...a) => {
        try { await fn(...a); }
        catch (e) { console.error(e); }
    };
}

// ================== LOGIN ==================
client.login(TOKEN);

