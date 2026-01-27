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

// --- CONFIGURAZIONE ---
const TOKEN = 'IL_TUO_TOKEN_QUI';
const PREFIX = '!';

// ⚠️ INSERISCI GLI ID CORRETTI QUI ⚠️
const ID_CATEGORIA_PUBBLICA = '1460741412466331799'; 
const ID_CATEGORIA_CASE = '1460741413388947528';

// --- DATABASE MEMORIA ---
const playerHomes = new Map();  // userID -> channelID (Casa del giocatore)
const playerVisits = new Map(); // userID -> numero visite effettuate (Contatore)

let MAX_VISITS = 3; // Limite di default (modificabile da Admin)

client.once('ready', () => {
    console.log(`Bot GDR pronto. Limite visite attuale: ${MAX_VISITS}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // --- 1. ADMIN: ASSEGNA CASA ---
    if (command === 'assegnacasa') {
        if (!isAdmin(message.member)) return;
        
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
        targetChannel.send(`🔑 **${targetUser}**, questa è la tua dimora.`);
    }

    // --- 2. ADMIN: SETTA MAX VISITE ---
    // Uso: !setmaxvisite 5
    if (command === 'setmaxvisite') {
        if (!isAdmin(message.member)) return;

        const limit = parseInt(args[0]);
        if (isNaN(limit)) return message.reply("❌ Specifica un numero. Es: `!setmaxvisite 3`");

        MAX_VISITS = limit;
        message.reply(`✅ Il limite globale di visite è stato impostato a **${MAX_VISITS}**.`);
    }

    // --- 3. ADMIN: RESETTA VISITE ---
    // Uso: !resetvisite (Resetta TUTTI)
    if (command === 'resetvisite') {
        if (!isAdmin(message.member)) return;

        playerVisits.clear(); // Azzera la memoria delle visite
        message.reply("🔄 **Giorno resettato!** Tutti i giocatori hanno di nuovo le visite al massimo.");
    }

    // --- 4. GIOCATORE: STATO VISITE (Opzionale, utile per controllare) ---
    if (command === 'visite') {
        const used = playerVisits.get(message.author.id) || 0;
        const remaining = MAX_VISITS - used;
        message.reply(`📊 Hai usato **${used}/${MAX_VISITS}** visite.`);
    }

    // --- 5. GIOCATORE: TORNA A CASA ---
    if (command === 'torna') {
        const homeId = playerHomes.get(message.author.id);
        if (!homeId) return message.reply("❌ Non hai una casa assegnata.");
        const homeChannel = message.guild.channels.cache.get(homeId);
        
        if (message.channel.id === homeId) return message.reply("🏠 Sei già qui.");

        await movePlayer(message.member, message.channel, homeChannel, "rientra a casa");
        message.delete().catch(()=>{});
    }

    // --- 6. GIOCATORE: VIAGGIO (PUBBLICO) ---
    if (command === 'viaggio') {
        const canaliPubblici = message.guild.channels.cache.filter(c => 
            c.parentId === ID_CATEGORIA_PUBBLICA && c.type === ChannelType.GuildText
        );

        if (canaliPubblici.size === 0) return message.reply("Non ci sono luoghi pubblici.");

        const select = new StringSelectMenuBuilder()
            .setCustomId('public_travel')
            .setPlaceholder('Dove vuoi andare?')
            .addOptions(canaliPubblici.map(c => 
                new StringSelectMenuOptionBuilder()
                    .setLabel(formatName(c.name))
                    .setValue(c.id)
                    .setEmoji('🌍')
            ).slice(0, 25));

        await message.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
    }

    // --- 7. COMANDO BUSSA (CON CONTROLLO VISITE) ---
    if (command === 'bussa') {
        // A. CONTROLLO PRELIMINARE VISITE
        const used = playerVisits.get(message.author.id) || 0;
        if (used >= MAX_VISITS) {
            return message.reply(`⛔ **Sei stanco.** Hai esaurito le tue ${MAX_VISITS} visite per oggi.`);
        }

        // B. CREAZIONE MENU CASE
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
            pageOptions.push(new StringSelectMenuOptionBuilder()
                .setLabel(`Case ${start} - ${end}`)
                .setValue(`page_${i}`)
                .setEmoji('🏘️')
            );
        }

        const selectGroup = new StringSelectMenuBuilder()
            .setCustomId('knock_page_select')
            .setPlaceholder('Seleziona gruppo case...')
            .addOptions(pageOptions);

        await message.reply({ 
            content: `🏠 **Scegli una zona (Visite rimaste: ${MAX_VISITS - used})**`, 
            components: [new ActionRowBuilder().addComponents(selectGroup)], 
            ephemeral: true 
        });
    }
});

// --- GESTIONE INTERAZIONI ---
client.on('interactionCreate', async interaction => {
    
    // A. SELEZIONE PAGINA CASE
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
            .addOptions(caseSlice.map(c => 
                new StringSelectMenuOptionBuilder()
                    .setLabel(formatName(c.name))
                    .setValue(c.id)
                    .setEmoji('🚪')
            ));

        await interaction.update({ 
            content: `📂 **Case trovate:**`, 
            components: [new ActionRowBuilder().addComponents(selectHouse)] 
        });
    }

    // B. BUSSATA EFFETTIVA
    if (interaction.isStringSelectMenu() && interaction.customId === 'knock_house_select') {
        const targetChannelId = interaction.values[0];
        const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
        const member = interaction.member;

        // RICONTROLLO SICUREZZA VISITE (Anti-furbi che aprono il menu e aspettano)
        const used = playerVisits.get(member.id) || 0;
        if (used >= MAX_VISITS) {
            return interaction.reply({ content: "⛔ Hai finito le visite mentre sceglievi!", ephemeral: true });
        }

        if (!targetChannel) return interaction.reply({ content: "Casa non trovata.", ephemeral: true });

        // Trova Proprietario
        let ownerId = null;
        for (const [uid, cid] of playerHomes.entries()) {
            if (cid === targetChannelId) ownerId = uid;
        }
        if (!ownerId) return interaction.reply({ content: "❌ Casa disabitata.", ephemeral: true });

        // Invia Bussata
        await interaction.reply({ content: `✊ Bussata inviata a **${formatName(targetChannel.name)}**. In attesa...`, ephemeral: true });

        const knockMsg = await targetChannel.send(
            `🔔 **TOC TOC!**\nQualcuno sta bussando alla porta...\n\n✅ = Apri | ❌ = Ignora`
        );
        await knockMsg.react('✅');
        await knockMsg.react('❌');

        const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && user.id === ownerId;
        const collector = knockMsg.createReactionCollector({ filter, time: 60000, max: 1 });

        collector.on('collect', async (reaction, user) => {
            if (reaction.emoji.name === '✅') {
                // IL PROPRIETARIO APRE
                
                // 1. Incrementiamo contatore visite dell'ospite
                const currentVisits = playerVisits.get(member.id) || 0;
                playerVisits.set(member.id, currentVisits + 1);

                await targetChannel.send("*La porta si apre.*");
                await targetChannel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true });
                await movePlayer(member, interaction.channel, targetChannel, "entra invitato");

            } else {
                // IL PROPRIETARIO RIFIUTA
                await targetChannel.send("*Nessuno apre.*");
                try { await member.send(`⛔ Nessuno risponde alla porta di ${targetChannel.name}.`); } catch(e){}
                // Nota: Se rifiutano, NON scaliamo la visita (è la prassi GDR, ma se vuoi scalarla spostala fuori dall'if)
            }
        });
    }

    // C. VIAGGIO PUBBLICO
    if (interaction.isStringSelectMenu() && interaction.customId === 'public_travel') {
        const target = interaction.guild.channels.cache.get(interaction.values[0]);
        await interaction.deferReply({ ephemeral: true });
        await movePlayer(interaction.member, interaction.channel, target, "si dirige verso");
        await interaction.editReply(`✅ Arrivato.`);
    }
});

// --- UTILITIES ---
function isAdmin(member) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function formatName(name) {
    return name.replace(/-/g, ' ').toUpperCase().substring(0, 25);
}

async function movePlayer(member, oldChannel, newChannel, actionText) {
    if (!member || !newChannel) return;

    if (oldChannel) {
        const myHome = playerHomes.get(member.id);
        oldChannel.send(`🚶 **${member.displayName}** esce e ${actionText} **${formatName(newChannel.name)}**.`);
        
        // Se non è casa mia e sono nelle case private, perdo i permessi
        if (oldChannel.id !== myHome && oldChannel.parentId === ID_CATEGORIA_CASE) {
             await oldChannel.permissionOverwrites.delete(member.id).catch(() => {});
        }
    }

    await newChannel.permissionOverwrites.create(member.id, { ViewChannel: true, SendMessages: true });

    setTimeout(async () => {
        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setDescription(`👋 **${member.displayName}** è entrato.`)
        await newChannel.send({ embeds: [embed] });
        const p = await newChannel.send(`${member}`);
        setTimeout(() => p.delete(), 500);
    }, 1000);
}

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GESAgq.BHN1CNeNhQSfnQVs6D0hjnhtVi2GDwCjTTcnQs');
