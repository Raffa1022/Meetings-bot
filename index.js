const express = require('express');
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

const app = express();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Health Check per Koyeb
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.status(200).send('Bot Online'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));

// ==========================================
// ⚙️ CONFIGURAZIONE
// ==========================================
 
const PREFIX = '!';
const ID_CATEGORIA_PUBBLICA = '1460741411807826035'; 
const ID_CATEGORIA_CASE = '1460741413388947528';
const ID_CANALE_DB = '1464940718933151839'; // Il tuo canale database
const RUOLI_ACCESSO = ['1460741403331268661', '1460741404497019002', '1460741402672758814'];

let dbData = {
    homes: {}, 
    visits: {}, 
    maxVisitsPerUser: {}, 
    defaultMax: 3
};

// ==========================================
// 💾 GESTIONE DATABASE (DISCORD CHANNEL)
// ==========================================

async function loadData() {
    try {
        const channel = await client.channels.fetch(ID_CANALE_DB);
        const messages = await channel.messages.fetch({ limit: 1 });
        const lastMessage = messages.first();
        if (lastMessage && lastMessage.content.startsWith('{')) {
            dbData = JSON.parse(lastMessage.content);
            console.log("📂 Database caricato da Discord.");
        }
    } catch (err) {
        console.log("⚠️ Database non trovato o vuoto, uso valori di default.");
    }
}

async function saveData() {
    try {
        const channel = await client.channels.fetch(ID_CANALE_DB);
        // Inviamo il JSON come nuovo messaggio
        await channel.send(JSON.stringify(dbData, null, 2));
        console.log("💾 Database sincronizzato su Discord.");
    } catch (err) {
        console.error('⚠️ Errore durante il salvataggio:', err);
    }
}

// ==========================================
// 🛠️ UTILS
// ==========================================

function isAdmin(member) {
    return member?.permissions.has(PermissionsBitField.Flags.Administrator);
}

function formatName(name) {
    return name.replace(/-/g, ' ').replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()).substring(0, 50);
}

// ==========================================
// 👮 ADMIN COMMANDS
// ==========================================

const adminCommands = {
    'assegnacasa': async (message) => {
        if (!isAdmin(message.member)) return message.reply("⛔ Non sei admin.");
        const targetUser = message.mentions.members.first();
        const targetChannel = message.mentions.channels.first();
        if (!targetUser || !targetChannel) return message.reply("❌ Uso: `!assegnacasa @Utente #canale`");

        dbData.homes[targetUser.id] = targetChannel.id;
        await saveData();
        
        await targetChannel.permissionOverwrites.set([
            { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: targetUser.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels] }
        ]);

        message.reply(`✅ Casa assegnata a ${targetUser}.`);
    }
};

// ==========================================
// 👤 PLAYER LOGIC
// ==========================================

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Comandi Admin
    if (adminCommands[command]) return adminCommands[command](message, args);

    // Comando Bussa
    if (command === 'bussa') {
        const playerId = message.author.id;
        const used = dbData.visits[playerId] || 0;
        const maxV = dbData.maxVisitsPerUser[playerId] || dbData.defaultMax;
        
        if (used >= maxV) return message.reply(`⛔ Sei troppo stanco per altre visite (**${used}/${maxV}**).`);

        const tutteLeCase = message.guild.channels.cache
            .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (tutteLeCase.size === 0) return message.reply("❌ Nessuna casa trovata.");

        const options = tutteLeCase.first(25).map((c, index) => 
            new StringSelectMenuOptionBuilder()
                .setLabel(`${index + 1}. ${formatName(c.name)}`)
                .setValue(c.id)
                .setEmoji('Door')
        );

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('knock_select')
                .setPlaceholder('A quale porta bussi?')
                .addOptions(options)
        );

        await message.reply({ content: `🏠 **Visite: ${used}/${maxV}**`, components: [row] });
    }
});

// Gestione Interazioni (Bussata)
client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;

    if (interaction.customId === 'knock_select') {
        const targetChannel = interaction.guild.channels.cache.get(interaction.values[0]);
        const playerId = interaction.user.id;
        
        // Logica semplificata di esempio: apro la porta direttamente
        dbData.visits[playerId] = (dbData.visits[playerId] || 0) + 1;
        await saveData();
        
        await targetChannel.permissionOverwrites.edit(playerId, { ViewChannel: true, SendMessages: true });
        await interaction.reply({ content: `✅ Hai bussato e la porta si è aperta!`, ephemeral: true });
        await targetChannel.send(`🚶 **${interaction.user.username}** è entrato in casa.`);
    }
});

client.once('ready', async () => {
    await loadData(); // Carica i dati all'avvio
    console.log(`✅ Bot GDR Online come ${client.user.tag}`);
});

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GESAgq.BHN1CNeNhQSfnQVs6D0hjnhtVi2GDwCjTTcnQs');
