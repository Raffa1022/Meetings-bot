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

// ==========================================
// ⚙️ CONFIGURAZIONE
// ==========================================
 
const PREFIX = '!';
const ID_CATEGORIA_PUBBLICA = '1460741412466331799'; 
const ID_CATEGORIA_CASE = '1460741413388947528';

// ID dei 3 ruoli da taggare quando qualcuno bussa
const RUOLI_DA_TAGGARE = [
    '1460741403331268661',
    '1460741404497019002',
    '1460741402672758814'
];

// ==========================================
// 💾 DATABASE TEMPORANEO
// ==========================================

const playerHomes = new Map();   
const playerVisits = new Map();  
const playerLimits = new Map(); // Limiti personalizzati per giocatore
let DEFAULT_MAX_VISITS = 3;             


client.once('ready', () => {
    console.log(`✅ Bot GDR Online e protetto da crash!`);
});

// --- PROTEZIONE ANTI-CRASH (Essenziale per Koyeb) ---
process.on('unhandledRejection', error => { console.error('Errore non gestito:', error); });
process.on('uncaughtException', error => { console.error('Eccezione critica:', error); });

client.on('messageCreate', async message => {
    try {
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

        // !setmaxvisite @utente numero (OPPURE !setmaxvisite numero per il globale)
        if (command === 'setmaxvisite') {
            if (!isAdmin(message.member)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.users.first();
            
            if (targetUser) {
                const limit = parseInt(args[1]);
                if (isNaN(limit)) return message.reply("❌ Specifica un numero. Uso: `!setmaxvisite @utente 5`.");
                playerLimits.set(targetUser.id, limit);
                message.reply(`✅ Limite visite per ${targetUser} impostato a **${limit}**.`);
            } else {
                const limit = parseInt(args[0]);
                if (isNaN(limit)) return message.reply("❌ Specifica un numero o menziona un utente.");
                DEFAULT_MAX_VISITS = limit;
                message.reply(`✅ Limite visite globale impostato a **${DEFAULT_MAX_VISITS}**.`);
            }
        }

        // !resetvisite
        if (command === 'resetvisite') {
            if (!isAdmin(message.member)) return message.reply("⛔ Non sei admin.");
            playerVisits.clear();
            message.reply("🔄 **Nuovo Giorno!** Tutti i contatori visite sono stati resettati.");
        }

        // !torna
        if (command === 'torna') {
            const homeId = playerHomes.get(message.author.id);
            if (!homeId) return message.reply("❌ Non hai una casa.");
            
            const homeChannel = message.guild.channels.cache.get(homeId);
            if (!homeChannel) return message.reply("❌ La tua casa non esiste più.");
            if (message.channel.id === homeId) return message.reply("🏠 Sei già a casa.");

            await movePlayer(message.member, message.channel, homeChannel, "rientra a casa");
            message.delete().catch(()=>{});
        }

        // !viaggio
        if (command === 'viaggio') {
            const canaliPubblici = message.guild.channels.cache.filter(c => 
                c.parentId === ID_CATEGORIA_PUBBLICA && c.type === ChannelType.GuildText
            );

            if (canaliPubblici.size === 0) return message.reply("❌ Nessun luogo pubblico trovato.");

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

        // !bussa
        if (command === 'bussa') {
            const userLimit = playerLimits.get(message.author.id) || DEFAULT_MAX_VISITS;
            const used = playerVisits.get(message.author.id) || 0;
            
            if (used >= userLimit) {
                return message.reply(`⛔ **Sei stanco.** Hai usato tutte le tue ${userLimit} visite.`);
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
                pageOptions.push(new StringSelectMenuOptionBuilder()
                    .setLabel(`Case ${start} - ${end}`)
                    .setValue(`page_${i}`)
                    .setEmoji('🏘️')
                );
            }

            const selectGroup = new StringSelectMenuBuilder()
                .setCustomId('knock_page_select')
                .setPlaceholder('Seleziona il gruppo di case...')
                .addOptions(pageOptions);

            await message.reply({ 
                content: `🏠 **Scegli una zona (Visite rimaste: ${userLimit - used})**`, 
                components: [new ActionRowBuilder().addComponents(selectGroup)], 
                ephemeral: true 
            });
        }
    } catch (err) {
        console.error("Errore nel comando:", err);
        message.reply("⚠️ Si è verificato un errore interno. Riprova.").catch(()=>{});
    }
});

client.on('interactionCreate', async interaction => {
    try {
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
                content: `📂 **Scegli la casa:**`, 
                components: [new ActionRowBuilder().addComponents(selectHouse)] 
            });
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'knock_house_select') {
            const targetChannelId = interaction.values[0];
            const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
            const member = interaction.member;

            const userLimit = playerLimits.get(member.id) || DEFAULT_MAX_VISITS;
            const used = playerVisits.get(member.id) || 0;

            if (used >= userLimit) {
                return interaction.reply({ content: "⛔ Visite finite!", ephemeral: true });
            }

            if (!targetChannel) return interaction.reply({ content: "Casa inesistente.", ephemeral: true });

            let ownerId = null;
            for (const [uid, cid] of playerHomes.entries()) {
                if (cid === targetChannelId) ownerId = uid;
            }

            if (!ownerId) return interaction.reply({ content: "❌ Casa disabitata.", ephemeral: true });

            await interaction.reply({ content: `✊ Hai bussato a **${formatName(targetChannel.name)}**. Attendi...`, ephemeral: true });

            // --- LOGICA TAG RUOLI ---
            // Controlla chi può vedere il canale e ha uno dei ruoli target
            const rolesToMention = [];
            RUOLI_DA_TAGGARE.forEach(roleId => {
                const hasSomeone = targetChannel.members.some(m => m.roles.cache.has(roleId));
                if (hasSomeone) rolesToMention.push(`<@&${roleId}>`);
            });

            const mentionString = rolesToMention.length > 0 ? rolesToMention.join(' ') : '';

            const knockMsg = await targetChannel.send(
                `${mentionString}\n🔔 **TOC TOC!**\nQualcuno sta bussando alla porta...\n\n✅ = Apri | ❌ = Ignora`
            );
            await knockMsg.react('✅');
            await knockMsg.react('❌');

            const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && user.id === ownerId;
            const collector = knockMsg.createReactionCollector({ filter, time: 60000, max: 1 });

            collector.on('collect', async (reaction, user) => {
                if (reaction.emoji.name === '✅') {
                    playerVisits.set(member.id, used + 1);
                    await targetChannel.send("*La serratura scatta. La porta si apre.*");
                    await targetChannel.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true });
                    await movePlayer(member, interaction.channel, targetChannel, "entra invitato");
                } else {
                    await targetChannel.send("*Decidi di non aprire.*");
                    try { await member.send(`⛔ Nessuno risponde alla porta di ${formatName(targetChannel.name)}.`); } catch(e){}
                }
            });
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'public_travel') {
            const target = interaction.guild.channels.cache.get(interaction.values[0]);
            await interaction.deferReply({ ephemeral: true });
            await movePlayer(interaction.member, interaction.channel, target, "si dirige verso");
            await interaction.editReply(`✅ Arrivato.`);
        }
    } catch (err) {
        console.error("Errore interazione:", err);
    }
});

// ==========================================
// 🛠️ UTILS
// ==========================================

function isAdmin(member) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function formatName(name) {
    return name.replace(/-/g, ' ').toUpperCase().substring(0, 25);
}

async function movePlayer(member, oldChannel, newChannel, actionText) {
    try {
        if (!member || !newChannel) return;

        if (oldChannel && oldChannel.id !== newChannel.id) {
            const myHome = playerHomes.get(member.id);
            oldChannel.send(`🚶 **${member.displayName}** esce e ${actionText} **${formatName(newChannel.name)}**.`);
            
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
            setTimeout(() => p.delete().catch(()=>{}), 500);
        }, 1000);
    } catch (e) { console.error("Errore movePlayer:", e); }
}

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GESAgq.BHN1CNeNhQSfnQVs6D0hjnhtVi2GDwCjTTcnQs');
