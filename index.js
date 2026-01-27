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
const http = require('http'); [span_1](start_span)// Necessario per il fix Koyeb[span_1](end_span)

// --- 🌐 FIX HEALTH CHECK KOYEB ---
[span_2](start_span)// Risolve l'errore "TCP health check failed on port 8000" che spegne il bot[span_2](end_span)
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot GDR is running!');
}).listen(8000);

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

// ==========================================
// ⚙️ CONFIGURAZIONE (MODIFICA QUI!)
// ==========================================

const PREFIX = '!';
const ID_CATEGORIA_PUBBLICA = '1460741412466331799'; 
const ID_CATEGORIA_CASE = '1460741413388947528';

// ID dei 3 ruoli da taggare nel Toc Toc
const RUOLI_DA_TAGGARE = [
    '1460741403331268661', 
    '1460741402672758814', 
    '1460741404497019002'
];

// ==========================================
// 💾 DATABASE TEMPORANEO
// ==========================================

const playerHomes = new Map();  
const playerVisits = new Map(); 
const playerSpecificLimits = new Map(); // Limiti individuali { userID: numero }
let MAX_VISITS = 3;             // Default globale

// --- 🛡️ GESTIONE ERRORI (ANTI-CRASH) ---
process.on('unhandledRejection', (reason) => console.error('⚠️ Errore Promise:', reason));
process.on('uncaughtException', (err) => console.error('🚫 Errore Fatale:', err));

[span_3](start_span)client.once('ready', () => { // Il log suggerisce 'clientReady' per v15, ma manteniamo la tua base[span_3](end_span)
    console.log(`✅ Bot GDR Online!`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // !assegnacasa @Utente #canale
    if (command === 'assegnacasa') {
        if (!isAdmin(message.member)) return message.reply("⛔ Non sei admin.");
        const targetUser = message.mentions.members.first();
        const targetChannel = message.mentions.channels.first();
        if (!targetUser || !targetChannel) return message.reply("❌ Uso: `!assegnacasa @Utente #canale`");

        playerHomes.set(targetUser.id, targetChannel.id);
        await targetChannel.permissionOverwrites.set([
            { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: targetUser.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels] }
        ]);
        message.reply(`✅ Casa assegnata a ${targetUser}.`);
        targetChannel.send(`🔑 **${targetUser}**, questa è la tua dimora privata.`);
    }

    // !setmaxvisite @Utente 5 (Modificato per limite individuale)
    if (command === 'setmaxvisite') {
        if (!isAdmin(message.member)) return message.reply("⛔ Non sei admin.");
        const targetUser = message.mentions.members.first();
        const limit = parseInt(args[1]); // Prende il numero dopo la menzione

        if (!targetUser || isNaN(limit)) return message.reply("❌ Uso: `!setmaxvisite @Utente 5`.");
        
        playerSpecificLimits.set(targetUser.id, limit);
        message.reply(`✅ Limite visite per ${targetUser} impostato a **${limit}**.`);
    }

    if (command === 'resetvisite') {
        if (!isAdmin(message.member)) return message.reply("⛔ Non sei admin.");
        playerVisits.clear();
        message.reply("🔄 **Nuovo Giorno!** Tutti i contatori visite sono stati resettati.");
    }

    if (command === 'torna') {
        const homeId = playerHomes.get(message.author.id);
        if (!homeId) return message.reply("❌ Non hai una casa.");
        const homeChannel = message.guild.channels.cache.get(homeId);
        if (!homeChannel) return message.reply("❌ La tua casa non esiste più.");
        if (message.channel.id === homeId) return message.reply("🏠 Sei già a casa.");
        await movePlayer(message.member, message.channel, homeChannel, "rientra a casa");
        message.delete().catch(()=>{});
    }

    if (command === 'viaggio') {
        const canaliPubblici = message.guild.channels.cache.filter(c => 
            c.parentId === ID_CATEGORIA_PUBBLICA && c.type === ChannelType.GuildText
        );
        if (canaliPubblici.size === 0) return message.reply("❌ Nessun luogo pubblico trovato.");
        const select = new StringSelectMenuBuilder()
            .setCustomId('public_travel')
            .setPlaceholder('Dove vuoi andare?')
            .addOptions(canaliPubblici.map(c => 
                new StringSelectMenuOptionBuilder().setLabel(formatName(c.name)).setValue(c.id).setEmoji('🌍')
            ).slice(0, 25));
        await message.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    if (command === 'bussa') {
        const used = playerVisits.get(message.author.id) || 0;
        const userLimit = playerSpecificLimits.get(message.author.id) || MAX_VISITS; // Controllo limite individuale

        if (used >= userLimit) {
            return message.reply(`⛔ **Sei stanco.** Hai usato tutte le tue ${userLimit} visite per oggi.`);
        }

        const tutteLeCase = message.guild.channels.cache
            .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
            .sort((a, b) => a.name.localeCompare(b.name));

        if (tutteLeCase.size === 0) return message.reply("❌ Non ci sono case.");

        const PAGE_SIZE = 25;
        const totalPages = Math.ceil(tutteLeCase.size / PAGE_SIZE);
        const pageOptions = [];
        for (let i = 0; i < totalPages; i++) {
            const start = i * PAGE_SIZE + 1;
            const end = Math.min((i + 1) * PAGE_SIZE, tutteLeCase.size);
            pageOptions.push(new StringSelectMenuOptionBuilder().setLabel(`Case ${start} - ${end}`).setValue(`page_${i}`).setEmoji('🏘️'));
        }

        const selectGroup = new StringSelectMenuBuilder().setCustomId('knock_page_select').setPlaceholder('Seleziona il gruppo di case...').addOptions(pageOptions);
        await message.reply({ 
            content: `🏠 **Scegli una zona (Visite rimaste: ${userLimit - used})**`, 
            components: [new ActionRowBuilder().addComponents(selectGroup)], 
            ephemeral: true 
        });
    }
});

// ==========================================
// 🖱️ GESTIONE INTERAZIONI
// ==========================================

client.on('interactionCreate', async interaction => {
    try { // Try-catch per evitare crash nelle interazioni
        if (interaction.isStringSelectMenu() && interaction.customId === 'knock_page_select') {
            const pageIndex = parseInt(interaction.values[0].split('_')[1]);
            const PAGE_SIZE = 25;
            const tutteLeCase = interaction.guild.channels.cache
                .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
                .sort((a, b) => a.name.localeCompare(b.name));
            const start = pageIndex * PAGE_SIZE;
            const caseSlice = Array.from(tutteLeCase.values()).slice(start, start + PAGE_SIZE);
            const selectHouse = new StringSelectMenuBuilder()
                .setCustomId('knock_house_select')
                .setPlaceholder('A quale porta bussi?')
                .addOptions(caseSlice.map(c => new StringSelectMenuOptionBuilder().setLabel(formatName(c.name)).setValue(c.id).setEmoji('🚪')));

            await interaction.update({ content: `📂 **Scegli la casa:**`, components: [new ActionRowBuilder().addComponents(selectHouse)] });
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'knock_house_select') {
            const targetChannelId = interaction.values[0];
            const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
            const member = interaction.member;

            const used = playerVisits.get(member.id) || 0;
            const userLimit = playerSpecificLimits.get(member.id) || MAX_VISITS;
            if (used >= userLimit) return interaction.reply({ content: "⛔ Visite finite!", ephemeral: true });

            let ownerId = null;
            for (const [uid, cid] of playerHomes.entries()) { if (cid === targetChannelId) ownerId = uid; }
            if (!ownerId) return interaction.reply({ content: "❌ Casa disabitata.", ephemeral: true });

            await interaction.reply({ content: `✊ Hai bussato a **${formatName(targetChannel.name)}**.`, ephemeral: true });

            // --- LOGICA PING SELETTIVO RUOLI ---
            const stringaPing = targetChannel.members
                .filter(m => m.roles.cache.some(r => RUOLI_DA_TAGGARE.includes(r.id)))
                .map(m => `<@${m.id}>`)
                .join(' ');

            const knockMsg = await targetChannel.send(
                `🔔 **TOC TOC!**\n${stringaPing}\nQualcuno sta bussando alla porta...\n\n✅ = Apri | ❌ = Ignora`
            );
            await knockMsg.react('✅');
            await knockMsg.react('❌');

            const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && user.id === ownerId;
            const collector = knockMsg.createReactionCollector({ filter, time: 60000, max: 1 });

            collector.on('collect', async (reaction) => {
                if (reaction.emoji.name === '✅') {
                    playerVisits.set(member.id, used + 1);
                    await targetChannel.send("*La porta si apre.*");
                    await targetChannel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true });
                    await movePlayer(member, interaction.channel, targetChannel, "entra invitato");
                } else {
                    await targetChannel.send("*Nessuno risponde.*");
                }
            });
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'public_travel') {
            const target = interaction.guild.channels.cache.get(interaction.values[0]);
            await interaction.deferReply({ ephemeral: true });
            await movePlayer(interaction.member, interaction.channel, target, "si dirige verso");
            await interaction.editReply(`✅ Arrivato.`);
        }
    } catch (e) { console.error("Errore interazione:", e); }
});

// ==========================================
// 🛠️ FUNZIONI DI UTILITÀ
// ==========================================

function isAdmin(member) { return member.permissions.has(PermissionsBitField.Flags.Administrator); }
function formatName(name) { return name.replace(/-/g, ' ').toUpperCase().substring(0, 25); }

async function movePlayer(member, oldChannel, newChannel, actionText) {
    if (!member || !newChannel) return;
    if (oldChannel) {
        const myHome = playerHomes.get(member.id);
        oldChannel.send(`🚶 **${member.displayName}** esce e ${actionText} **${formatName(newChannel.name)}**.`);
        if (oldChannel.id !== myHome && oldChannel.parentId === ID_CATEGORIA_CASE) {
             await oldChannel.permissionOverwrites.delete(member.id).catch(() => {});
        }
    }
    await newChannel.permissionOverwrites.create(member.id, { ViewChannel: true, SendMessages: true });
    setTimeout(async () => {
        const embed = new EmbedBuilder().setColor(0x00FF00).setDescription(`👋 **${member.displayName}** è entrato.`);
        await newChannel.send({ embeds: [embed] });
        const p = await newChannel.send(`${member}`);
        setTimeout(() => p.delete(), 500);
    }, 1000);
}

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GESAgq.BHN1CNeNhQSfnQVs6D0hjnhtVi2GDwCjTTcnQs');
