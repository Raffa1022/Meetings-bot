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
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Health Check Koyeb
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.status(200).send('Bot Online'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Health server listening on port ${PORT}`);
});

// ==========================================
// ⚙️ CONFIGURAZIONE
// ==========================================
 
const PREFIX = '!';

const ID_CATEGORIA_PUBBLICA = '1460741411807826035'; 
const ID_CATEGORIA_CASE = '1460741413388947528';

// ID RUOLI (Massimo 3 ruoli)
const RUOLI_ACCESSO = ['1460741403331268661', '1460741404497019002', '1460741402672758814'];

const DB_FILE = path.join(__dirname, '1464940718933151839');

// ==========================================
// 💾 GESTIONE DATABASE
// ==========================================

const defaultDB = {
    homes: {}, 
    visits: {}, 
    maxVisitsPerUser: {}, 
    defaultMax: 3
};

function loadData() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (err) { console.error('⚠️ Errore DB:', err); }
    return { ...defaultDB };
}

function saveData(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (err) { console.error('⚠️ Errore Save DB:', err); }
}

let dbData = loadData();

const playerHomes = new Map(Object.entries(dbData.homes));
const playerVisits = new Map(Object.entries(dbData.visits));
const playerMaxVisits = new Map(Object.entries(dbData.maxVisitsPerUser));

// ---------------------------------------------------------
// 👮 ADMIN COMMANDS
// ---------------------------------------------------------

const adminCommands = {
    'assegnacasa': async (message, args) => {
        if (!isAdmin(message.member)) return message.reply("⛔ Non sei admin.");
        const targetUser = message.mentions.members.first();
        const targetChannel = message.mentions.channels.first();
        if (!targetUser || !targetChannel) return message.reply("❌ Uso: `!assegnacasa @Utente #canale`");

        dbData.homes[targetUser.id] = targetChannel.id;
        saveData(dbData);
        
        await targetChannel.permissionOverwrites.set([
            { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: targetUser.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels] }
        ]);

        message.reply(`✅ Casa assegnata a ${targetUser}.`);
        targetChannel.send(`🔑 **${targetUser}**, questa è la tua dimora privata.`).catch(() => {});
    },

    'setmax': async (message, args) => {
        if (!isAdmin(message.member)) return message.reply("⛔ Non sei admin.");
        const targetUser = message.mentions?.first();
        const limit = parseInt(args[0]);
        
        if (isNaN(limit) || limit < 0) return message.reply("❌ Numero valido.");
        if (targetUser) {
            dbData.maxVisitsPerUser[targetUser.id] = limit;
            saveData(dbData);
            return message.reply(`✅ Max visite per **${targetUser.displayName}**: **${limit}**.`);
        } else {
            dbData.defaultMax = limit;
            saveData(dbData);
            return message.reply(`✅ Default: **${limit}**.`);
        }
    },

    'reset': async (message) => {
        if (!isAdmin(message.member)) return message.reply("⛔ Non sei admin.");
        dbData.visits = {};
        saveData(dbData);
        message.reply("🔄 Visite globali resettate.");
    }
};

// ---------------------------------------------------------
// 👤 PLAYER COMMANDS
// ---------------------------------------------------------

client.on('messageCreate', async message => {
    try {
        if (message.author.bot || !message.content.startsWith(PREFIX)) return;
        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // 1. Ritorna (Abbandona la casa attuale)
        if (command === 'ritorna') {
            const myHomeId = dbData.homes[message.author.id];
            const currentChannelId = message.channel.id;

            if (!myHomeId) return message.reply("❌ Non hai una casa.");
            if (currentChannelId === myHomeId) return message.reply("🏠 Sei già a casa tua.");

            const oldChannel = message.channel;
            const newChannel = client.guilds.cache.get(message.guild.id).channels.cache.get(myHomeId);

            // Abbandona attuale
            await oldChannel.permissionOverwrites.delete(message.author.id).catch(() => {});
            await oldChannel.send(`🚶 **${message.author.displayName}** abbandona l'edificio ${formatName(oldChannel.name)} e corre verso la propria dimora.`);

            // Entra in quella sua
            await newChannel.permissionOverwrites.create(message.author.id, { ViewChannel: true, SendMessages: true });
            
            const used = dbData.visits[message.author.id] || 0;
            await newChannel.send(`🚶 **${message.author.displayName}** rientra dalla ${formatName(oldChannel.name)} e si affaccia a casa sua.`);
            
            const embed = new EmbedBuilder().setColor(0x00FF00).setDescription(`👋 **${message.author.displayName}** è tornato a casa.`);
            await newChannel.send({ embeds: [embed] }).catch(() => {});
            const ping = await newChannel.send(`${message.author}`).catch(() => {});
            setTimeout(() => ping?.delete().catch(() => {}), 1000);

            message.delete().catch(() => {});
            return;
        }

        // 2. Bussa (LISTA ORDINATA E NUMERATA)
        if (command === 'bussa') {
            const playerId = message.author.id;
            const used = dbData.visits[playerId] || 0;
            const maxV = dbData.maxVisitsPerUser[playerId] || dbData.defaultMax;
            
            if (used >= maxV) {
                return message.reply(`⛔ **Sei stanco.** Visite usate: **${used}/${maxV}**.`);
            }

            // Ordina le case e prendi solo le prime 25
            const tutteLeCase = message.guild.channels.cache
                .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
                .sort((a, b) => a.name.localeCompare(b.name));

            if (tutteLeCase.size === 0) return message.reply("❌ Nessuna casa.");

            // Creazione opzioni numerate: "1. Casa Nome", "2. Casa Nome"
            const options = tutteLeCase.slice(0, 25).map((c, index) => 
                new StringSelectMenuOptionBuilder()
                    .setLabel(`${index + 1}. ${formatName(c.name)}`)
                    .setValue(c.id)
                    .setEmoji('🚪')
            );

            const select = new StringSelectMenuBuilder()
                .setCustomId('knock_select')
                .setPlaceholder('A quale porta bussi?')
                .addOptions(options);

            await message.reply({ 
                content: `🏠 **Visite usate: ${used}/${maxV}**`, 
                components: [new ActionRowBuilder().addComponents(select)], 
                ephemeral: true 
            });
            return;
        }

        // 3. Torna
        if (command === 'torna') {
            const myHomeId = dbData.homes[message.author.id];
            if (!myHomeId) return message.reply("❌ Non hai una casa.");
            
            const myHome = message.guild.channels.cache.get(myHomeId);
            if (!myHome) return message.reply("❌ La tua casa non esiste più.");
            
            if (message.channel.id === myHomeId) return message.reply("🏠 Sei già a casa tua.");

            await movePlayer(message.member, message.channel, myHome, "rientra a casa");
            message.delete().catch(() => {});
            return;
        }
        
        // 4. Viaggio
        if (command === 'viaggio') {
            const canaliPubblici = message.guild.channels.cache.filter(c => 
                c.parentId === ID_CATEGORIA_PUBBLICA && c.type === ChannelType.GuildText
            );
            const select = new StringSelectMenuBuilder()
                .setCustomId('travel_select')
                .setPlaceholder('Dove vuoi andare?')
                .addOptions(canaliPubblici.map(c => 
                    new StringSelectMenuOptionBuilder().setLabel(formatName(c.name)).setValue(c.id).setEmoji('🌍')
                ).slice(0, 25));
            await message.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
            return;
        }

        if (adminCommands[command]) {
            await adminCommands[command](message, args);
        }

    } catch (error) {
        console.error('❌ Errore:', error);
        message.reply({ content: '⚠️ Errore interno.', ephemeral: true }).catch(() => {});
    }
});

// ==========================================
// 🖱️ GESTIONE INTERAZIONI
// ==========================================

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isStringSelectMenu()) {
            // 1. Bussata (Nuova lista ordinata)
            if (interaction.customId === 'knock_select') {
                const targetChannelId = interaction.values[0];
                await handleKnock(interaction, targetChannelId);
                return;
            }

            // 2. Viaggio
            if (interaction.customId === 'travel_select') {
                const target = interaction.guild.channels.cache.get(interaction.values[0]);
                await movePlayer(interaction.member, interaction.channel, target, "si dirige verso");
                await interaction.editReply({ content: '✅ Arrivato a destinazione.', ephemeral: true });
            }
        }
    } catch (error) {
        console.error('❌ Errore Interaction:', error);
    }
});

// ==========================================
// 🔔 LOGICA BUSSATA
// ==========================================
async function handleKnock(interaction, targetChannelId) {
    const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
    const member = interaction.member;
    
    if (!targetChannel) return interaction.reply({ content: "❌ Casa inesistente.", ephemeral: true });

    const playerId = member.id;
    const used = dbData.visits[playerId] || 0;
    const maxV = dbData.maxVisitsPerUser[playerId] || dbData.defaultMax;

    if (used >= maxV) return interaction.reply({ content: `⛔ Visite finite!`, ephemeral: true });

    const ownerId = dbData.homes[targetChannelId];
    if (!ownerId) return interaction.reply({ content: "❌ Casa disabitata.", ephemeral: true });

    const owner = await interaction.guild.members.fetch(ownerId).catch(() => null);
    if (!owner) return interaction.reply({ content: "❌ Proprietario non trovato.", ephemeral: true });

    const rolesPresent = RUOLI_ACCESSO.filter(id => owner.roles.cache.has(id));

    // --- AUTOMATICO (Nessun ruolo) ---
    if (rolesPresent.length === 0) {
        dbData.visits[playerId] = used + 1;
        saveData(dbData);
        await interaction.reply({ 
            content: `✅ **Bussato**. **${formatName(targetChannel.name)}** apre immediatamente!`, 
            ephemeral: true 
        });
        await member.send(`✅ **Entra** in ${formatName(targetChannel.name)}. Visite usate: **${used+1}/${maxV}**`);
        await targetChannel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true });
        await movePlayer(member, interaction.channel, targetChannel, "entra automatizzato");
    // --- REAZIONE (Ruoli presenti) ---
    } else {
        const mentions = rolesPresent.map(id => `<@&${id}>`).join(' ');
        await interaction.reply({ content: `✊ **Bussato** a **${formatName(targetChannel.name)}**. Attendi...`, ephemeral: true });

        const knockMsg = await targetChannel.send(
            `🔔 **TOC TOC!**\n${mentions}\n\n✅ = **APRI** | ❌ = **RIFIUTA**`
        );
        await knockMsg.react('✅');
        await knockMsg.react('❌');

        // TIME: INFINITO
        const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji?.name || '');
        const collector = knockMsg.createReactionCollector({ filter, time: Infinity, max: 5 }); 

        collector.on('collect', async (reaction, user) => {
            try {
                const reactor = await reaction.message.guild.members.fetch(user.id).catch(() => null);
                if (!reactor) return;
                
                // Solo chi ha TUTTI i ruoli speciali
                if (!RUOLI_ACCESSO.every(id => reactor.roles.cache.has(id))) {
                    reaction.users.remove(user.id).catch(() => {});
                    return;
                }

                collector.stop();

                const emoji = reaction.emoji.name;
                if (emoji === '✅') {
                    dbData.visits[playerId] = used + 1;
                    saveData(dbData);
                    
                    await targetChannel.send("*🔓 La serratura scatta e la porta si apre lentamente...");
                    await member.send(`✅ **Entra** in ${formatName(targetChannel.name)}. Visite usate: **${used+1}/${maxV}**`);

                    await targetChannel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true });
                    await movePlayer(member, interaction.channel || interaction.guild.channels.cache.get(targetChannelId), targetChannel, "entra invitato");

                } else {
                    await targetChannel.send("*🚪 La porta rimane chiusa.");
                    await member.send(`⛔ **Rifiutato** da ${formatName(targetChannel.name)}. Visite usate: **${used}/${maxV}**.`);
                }
            } catch (e) { console.error(e); }
        });

        collector.on('end', () => {
            targetChannel.send("⏰ *Tempo scaduto.*");
            member.send(`⏰ **Nessuno ha risposto** a ${formatName(targetChannel.name)}. Visite usate: **${used}/${maxV}**`).catch(() => {});
        });
    }
}

// ==========================================
// 🛠️ UTILITÀ
// ==========================================

function isAdmin(member) {
    return member?.permissions.has(PermissionsBitField.Flags.Administrator) || false;
}

function formatName(name) {
    return name.replace(/-/g, ' ').replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()).substring(0, 50);
}

async function movePlayer(member, oldChannel, newChannel, actionText) {
    try {
        if (!member || !newChannel) return;
        if (oldChannel) {
            oldChannel.send(`🚶 **${member.displayName}** esce e ${actionText} **${formatName(newChannel.name)}**`).catch(() => {});
            const myHome = dbData.homes[member.id];
            if (oldChannel.id !== myHome && oldChannel.parentId === ID_CATEGORIA_CASE) {
                await oldChannel.permissionOverwrites.delete(member.id).catch(() => {});
            }
        }
        await newChannel.permissionOverwrites.create(member.id, {
            ViewChannel: true,
            SendMessages: true
        }).catch(() => {});
        setTimeout(async () => {
            const embed = new EmbedBuilder().setColor(0x00FF00).setDescription(`👋 **${member.displayName}** è arrivato.`);
            await newChannel.send({ embeds: [embed] }).catch(() => {});
            const ping = await newChannel.send(`${member}`).catch(() => {});
            setTimeout(() => ping?.delete().catch(() => {}), 1000);
        }, 800);
    } catch (e) { console.error(e); }
}

client.once('ready', () => {
    console.log(`✅ Bot GDR Online!`);
    client.user.setActivity('GDR Online', { type: 'PLAYING' });
});

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GESAgq.BHN1CNeNhQSfnQVs6D0hjnhtVi2GDwCjTTcnQs').catch(err => console.error('❌ Login Failed:', err));
```
