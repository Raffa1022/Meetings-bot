const { 
    Client, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder, EmbedBuilder, ChannelType, PermissionsBitField,
    PermissionFlagsBits, Partials, Colors
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
              GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ==========================================
// ⚙️ CONFIG (INSERISCI ID!)
// ==========================================
const PREFIX = '!';
const ID_CATEGORIA_PUBBLICA = '1460741412466331799';
const ID_CATEGORIA_CASE = '1460741413388947528';
const ID_DATABASE_CANALE = '1464940718933151839'; // ← IL TUO CANALE DB!
const ROLES_IDS = ['1460741404497019002', '1460741403331268661', '1460741402672758814']; // ID ruoli per bussare

// ==========================================
// 🗄️ DATABASE DISCORD
// ==========================================
async function saveData(key, value) {
    try {
        const dbChannel = client.channels.cache.get(ID_DATABASE_CANALE);
        if (!dbChannel) throw new Error('Canale DB non trovato');
        
        const data = await getAllData();
        data[key] = value;
        
        const embed = new EmbedBuilder()
            .setTitle('💾 DATABASE GDR')
            .setColor(Colors.Blue)
            .setDescription('```json)
' + JSON.stringify(data, null, 2) + '
```')
            .setTimestamp();
        
        const msgs = await dbChannel.messages.fetch({ limit: 10 });
        const dbMsg = msgs.find(m => m.author.id === client.user.id && m.embeds[0]?.title === '💾 DATABASE GDR');
        if (dbMsg) await dbMsg.edit({ embeds: [embed] });
        else await dbChannel.send({ embeds: [embed] });
    } catch (e) { console.error('Save error:', e); }
}

async function getData(key) {
    try {
        const dbChannel = client.channels.cache.get(ID_DATABASE_CANALE);
        if (!dbChannel) return null;
        
        const msgs = await dbChannel.messages.fetch({ limit: 10 });
        const dbMsg = msgs.find(m => m.author.id === client.user.id && m.embeds[0]?.title === '💾 DATABASE GDR');
        if (!dbMsg) return null;
        
        const content = dbMsg.embeds[0].description.replace(/```(?:json)?
?|
?```/g, '');
        const data = JSON.parse(content);
        return data[key] ?? null;
    } catch (e) { console.error('Get error:', e); return null; }
}

async function getAllData() {
    const data = {};
    // Carica tutti keys? Per semplicità, inizia vuoto e builda
    // In pratica: carica da msg esistente o {}
    try {
        return await getData('__all__') || {};
    } catch {
        return {};
    }
}

client.once('ready', async () => {
    console.log(`✅ Bot GDR Online! DB: ${ID_DATABASE_CANALE}`);
    
    // Health check Koyeb
    try {
        const express = require('express');
        const app = express();
        app.get('/health', (req, res) => res.sendStatus(200));
        app.listen(3000);
        console.log('🏥 Health su 3000');
    } catch {}
});

client.on('messageCreate', safeHandler(async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // !assegnacasa @user #channel
    if (command === 'assegnacasa') {
        if (!isAdmin(message.member)) return message.reply("⛔ Non admin.");
        const targetUser = message.mentions.members?.first();
        const targetChannel = message.mentions.channels?.first();
        if (!targetUser || !targetChannel) return message.reply("❌ `!assegnacasa @user #chan`");

        await saveData(`homes.${targetUser.id}`, targetChannel.id);
        await targetChannel.permissionOverwrites.set([
            { id: message.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: targetUser.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] }
        ]);
        message.reply(`✅ Casa ${targetUser.displayName}`);
    }

    // !setmaxvisite @giocatore 5
    if (command === 'setmaxvisite') {
        if (!isAdmin(message.member)) return message.reply("⛔ Non admin.");
        const targetUser = message.mentions.members?.first();
        const limit = parseInt(args[1]);
        if (!targetUser || isNaN(limit) || limit < 1) return message.reply("❌ `!setmaxvisite @giocatore NUMERO`");

        await saveData(`maxvisits.${targetUser.id}`, limit);
        message.reply(`✅ ${targetUser.displayName}: **${limit}** visite`);
    }

    // !resetvisite @giocatore (o globale)
    if (command === 'resetvisite') {
        if (!isAdmin(message.member)) return message.reply("⛔ Non admin.");
        const targetUser = message.mentions.members?.first();
        if (targetUser) {
            await saveData(`visits.${targetUser.id}`, 0);
            message.reply(`✅ Reset ${targetUser.displayName}`);
        } else {
            const data = await getAllData();
            for (const key of Object.keys(data)) {
                if (key.startsWith('visits.')) await saveData(key, 0);
            }
            message.reply("🔄 Reset globale visite");
        }
    }

    // !torna
    if (command === 'torna') {
        const homeId = await getData(`homes.${message.author.id}`);
        if (!homeId) return message.reply("❌ Non hai casa.");
        const homeChannel = message.guild.channels.cache.get(homeId);
        if (!homeChannel) return message.reply("❌ Casa persa.");
        if (message.channel.id === homeId) return message.reply("🏠 Già casa.");

        await movePlayer(message.member, message.channel, homeChannel, "rientra");
        message.delete().catch(() => {});
    }

    // !viaggio (invariato)
    if (command === 'viaggio') {
        // ... codice precedente
    }

    // !bussa con ordinamento numerico
    if (command === 'bussa') {
        const userId = message.author.id;
        const used = (await getData(`visits.${userId}`)) || 0;
        const maxV = (await getData(`maxvisits.${userId}`)) || 3;
        if (used >= maxV) return message.reply(`⛔ **${used}/${maxV}** visite usate.`);

        let caseChannels = message.guild.channels.cache
            .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText);

        // ORDINA PER NUMERO CASA
        caseChannels = caseChannels.sort((a, b) => {
            const numA = parseInt(a.name.match(/Casas*(d+)/i)?.[1] || Infinity);
            const numB = parseInt(b.name.match(/Casas*(d+)/i)?.[1] || Infinity);
            return numA - numB;
        });

        if (caseChannels.size === 0) return message.reply("❌ Nessuna casa.");

        // Paginazione pagine (25 per pagina)
        const PAGE_SIZE = 25;
        const pages = Math.ceil(caseChannels.size / PAGE_SIZE);
        const pageSelectOpts = [];
        for (let p = 0; p < pages; p++) {
            const start = p * PAGE_SIZE + 1;
            const end = Math.min((p + 1) * PAGE_SIZE, caseChannels.size);
            pageSelectOpts.push(new StringSelectMenuOptionBuilder()
                .setLabel(`Case ${start}-${end}`)
                .setValue(`page_${p}`)
                .setEmoji('🏘️'));
        }

        const selectPage = new StringSelectMenuBuilder()
            .setCustomId('knock_page_select')
            .setPlaceholder('Zona case...')
            .addOptions(pageSelectOpts.slice(0, 25));

        await message.reply({
            content: `🏠 **Visite: ${maxV - used}/${maxV}**`,
            components: [new ActionRowBuilder().addComponents(selectPage)],
            ephemeral: true
        });
    }
}));

// INTERAZIONI (knock con ROLES, 5min timeout, auto-entry)
client.on('interactionCreate', safeHandler(async interaction => {
    if (!interaction.isStringSelectMenu()) return;

    if (interaction.customId === 'knock_page_select') {
        // Mostra case pagina specifica (ordinamento già fatto)
        const pageIdx = parseInt(interaction.values[0].split('_')[1]);
        const PAGE_SIZE = 25;
        let caseChannels = interaction.guild.channels.cache.filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
            .sort((a, b) => parseInt(a.name.match(/Casas*(d+)/i)?.[1] || Infinity) - parseInt(b.name.match(/Casas*(d+)/i)?.[1] || Infinity));

        const start = pageIdx * PAGE_SIZE;
        const houses = Array.from(caseChannels.values()).slice(start, start + PAGE_SIZE);

        const houseSelect = new StringSelectMenuBuilder()
            .setCustomId('knock_house_select')
            .setPlaceholder('Bussa qui...')
            .addOptions(houses.map(c => new StringSelectMenuOptionBuilder()
                .setLabel(`${formatName(c.name)}`)
                .setValue(c.id)
                .setEmoji('🚪')));

        await interaction.update({
            content: '📂 **Scegli casa:**',
            components: [new ActionRowBuilder().addComponents(houseSelect)]
        });
    }

    if (interaction.customId === 'knock_house_select') {
        const targetId = interaction.values[0];
        const targetCh = interaction.guild.channels.cache.get(targetId);
        const visitor = interaction.member;
        const used = await getData(`visits.${visitor.id}`) || 0;
        const maxV = await getData(`maxvisits.${visitor.id}`) || 3;
        if (used >= maxV) return interaction.reply({ content: '⛔ Visite finite!', ephemeral: true });

        if (!targetCh) return interaction.reply({ content: '❌ Casa sparita.', ephemeral: true });

        // ROLES PRESENTI IN CASA (overwrite o membri con role)
        const guildMembersWithRoles = interaction.guild.members.cache.filter(m => 
            ROLES_IDS.some(roleId => m.roles.cache.has(roleId)));
        const rolesInHouse = ROLES_IDS.filter(roleId => 
            targetCh.permissionOverwrites.cache.has(roleId) || 
            guildMembersWithRoles.some(m => m.roles.cache.has(roleId))
        );

        await interaction.reply({ content: `✊ Bussato **${formatName(targetCh.name)}**. Attendi...`, ephemeral: true });

        const mentions = rolesInHouse.map(id => `<@&${id}> `).join('') || '*(nessuno role attivo)*';
        const knockEmbed = new EmbedBuilder()
            .setTitle('🔔 TOC TOC!')
            .setDescription(`${mentions}
**Qualcuno bussa!**
✅ **Apri** | ❌ **Rifiuta**`)
            .setColor(Colors.Orange);
        
        const knockMsg = await targetCh.send({ embeds: [knockEmbed] });
        await knockMsg.react('✅');
        await knockMsg.react('❌');

        // 5 MIN REACTIONS solo da ROLES
        try {
            const reaction = await knockMsg.awaitReactions({
                filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && ROLES_IDS.some(roleId => u.roles.cache.has(roleId)),
                time: 300000, // 5 min
                max: 1
            }).then(collected => collected.first());

            if (reaction.emoji.name === '✅') {
                // ENTRA
                await saveData(`visits.${visitor.id}`, used + 1);
                await targetCh.send("*🔓 La porta si apre.*");
                await targetCh.permissionOverwrites.edit(visitor.id, {
                    ViewChannel: true,
                    SendMessages: true
                });
                await movePlayer(visitor, interaction.channel, targetCh, "entra invitato");
            } else {
                // RIFIUTO: rivela chi (roles del refuser)
                const refuser = reaction.users.cache.first();
                const refuserRoles = ROLES_IDS.filter(id => refuser.roles.cache.has(id)).map(id => `<@&${id}>`).join(' ');
                await targetCh.send(`*🚪 Rifiutato da ${refuserRoles}.*`);
                await visitor.send(`⛔ **${formatName(targetCh.name)}** rifiutato da: ${refuserRoles}`);
            }
        } catch {
            // AUTO ENTRY
            await saveData(`visits.${visitor.id}`, used + 1);
            await targetCh.send("*⏰ Nessuno risponde. Entra automaticamente.*");
            await targetCh.permissionOverwrites.edit(visitor.id, { ViewChannel: true, SendMessages: true });
            await movePlayer(visitor, interaction.channel, targetCh, "entra auto");
        }
    }

    // public_travel (invariato)
    if (interaction.customId === 'public_travel') {
        const target = interaction.guild.channels.cache.get(interaction.values[0]);
        await interaction.deferReply({ ephemeral: true });
        await movePlayer(interaction.member, interaction.channel, target, "va a");
        interaction.editReply('✅ Arrivato!');
    }
}));

// FUNZIONI UTILITY (invariate + db)
function safeHandler(fn) {
    return async (...args) => {
        try { return await fn(...args); }
        catch (e) { console.error('❌', e); args[0]?.reply?.({content:'❌ Errore!',ephemeral:true}).catch(()=>{}); }
    };
}

function isAdmin(member) { return member?.permissions.has(PermissionsBitField.Flags.Administrator); }

function formatName(name) { return name.replace(/-/g, ' ').replace(/Casa/i, '').trim().substring(0, 50); }

async function movePlayer(member, oldCh, newCh, action) {
    if (oldCh) {
        oldCh.send(`🚶 **${member.displayName}** ${action} **${formatName(newCh.name)}**.`);
        const homeId = await getData(`homes.${member.id}`);
        if (oldCh.id !== homeId && oldCh.parentId === ID_CATEGORIA_CASE) {
            oldCh.permissionOverwrites.delete(member.id).catch(() => {});
        }
    }
    await newCh.permissionOverwrites.edit(member.id, { ViewChannel: true, SendMessages: true });
    setTimeout(async () => {
        const embed = new EmbedBuilder().setColor(0x00FF00).setDescription(`👋 **${member.displayName}** entrato.`);
        await newCh.send({ embeds: [embed] });
        const ping = await newCh.send(`<@${member.id}>`);
        setTimeout(() => ping.delete(), 500);
    }, 1000);
}

// GLOBAL ERROR HANDLING
process.on('unhandledRejection', e => console.error('Rejection:', e));
process.on('uncaughtException', e => console.error('Exception:', e));
const TOKEN =
client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GESAgq.BHN1CNeNhQSfnQVs6D0hjnhtVi2GDwCjTTcnQs');


