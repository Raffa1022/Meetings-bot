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
const ID_CANALE_DATABASE = '1464940718933151839'; // <--- METTI L'ID QUI!

const RUOLI_DA_TAGGARE = ['1460741403331268661', '1460741404497019002', '1460741402672758814']; // I 3 ruoli da taggare

// ==========================================
// 💾 DATABASE (Sincronizzato su Discord)
// ==========================================
let playerHomes = new Map();   
let playerLimits = new Map(); 
const playerVisits = new Map(); // Queste si resettano ogni giorno/riavvio
let DEFAULT_MAX_VISITS = 3;             

// --- FUNZIONE SALVATAGGIO SU DISCORD ---
async function syncToDiscord() {
    const dbChannel = client.channels.cache.get(ID_CANALE_DATABASE);
    if (!dbChannel) return console.error("❌ Canale Database non trovato!");

    const data = {
        homes: Array.from(playerHomes.entries()),
        limits: Array.from(playerLimits.entries()),
        defaultLimit: DEFAULT_MAX_VISITS
    };

    // Puliamo il vecchio messaggio e scriviamo quello nuovo
    const messages = await dbChannel.messages.fetch({ limit: 1 });
    if (messages.size > 0) await messages.first().delete().catch(()=>{});
    
    await dbChannel.send(`\`\`\`json\n${JSON.stringify(data)}\n\`\`\``);
}

// --- FUNZIONE CARICAMENTO DA DISCORD ---
async function loadFromDiscord() {
    const dbChannel = client.channels.cache.get(ID_CANALE_DATABASE);
    if (!dbChannel) return;

    const messages = await dbChannel.messages.fetch({ limit: 1 });
    if (messages.size === 0) return;

    try {
        const rawData = messages.first().content.replace(/```json|```/g, '');
        const data = JSON.parse(rawData);
        
        playerHomes = new Map(data.homes);
        playerLimits = new Map(data.limits);
        DEFAULT_MAX_VISITS = data.defaultLimit;
        console.log("📂 Database caricato da Discord!");
    } catch (e) { console.error("❌ Errore caricamento DB:", e); }
}

client.once('ready', async () => {
    await loadFromDiscord();
    console.log(`✅ Bot GDR Online!`);
});

// Protezione Anti-Crash
process.on('unhandledRejection', e => console.error('Errore non gestito:', e));
process.on('uncaughtException', e => console.error('Eccezione critica:', e));

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

            if (!targetUser || !targetChannel) return message.reply("❌ Uso: `!assegnacasa @Utente #canale`.");

            playerHomes.set(targetUser.id, targetChannel.id);
            await syncToDiscord(); // SALVA

            await targetChannel.permissionOverwrites.set([
                { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: targetUser.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels] }
            ]);

            message.reply(`✅ Casa assegnata a ${targetUser}.`);
        }

        // !setmaxvisite @utente numero
        if (command === 'setmaxvisite') {
            if (!isAdmin(message.member)) return message.reply("⛔ Non sei admin.");
            const targetUser = message.mentions.users.first();
            
            if (targetUser) {
                const limit = parseInt(args[1]);
                if (isNaN(limit)) return message.reply("❌ Specifica un numero.");
                playerLimits.set(targetUser.id, limit);
                await syncToDiscord(); // SALVA
                message.reply(`✅ Limite per ${targetUser} impostato a **${limit}**.`);
            } else {
                const limit = parseInt(args[0]);
                if (isNaN(limit)) return message.reply("❌ Specifica un numero o @utente.");
                DEFAULT_MAX_VISITS = limit;
                await syncToDiscord(); // SALVA
                message.reply(`✅ Limite globale impostato a **${DEFAULT_MAX_VISITS}**.`);
            }
        }

        // !bussa
        if (command === 'bussa') {
            const userLimit = playerLimits.get(message.author.id) || DEFAULT_MAX_VISITS;
            const used = playerVisits.get(message.author.id) || 0;
            if (used >= userLimit) return message.reply(`⛔ Sei troppo stanco (${used}/${userLimit} visite).`);

            const caseCanali = message.guild.channels.cache
                .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
                .sort((a, b) => a.name.localeCompare(b.name));

            if (caseCanali.size === 0) return message.reply("❌ Nessuna casa trovata.");

            const select = new StringSelectMenuBuilder()
                .setCustomId('knock_house_select')
                .setPlaceholder('A quale porta bussi?')
                .addOptions(Array.from(caseCanali.values()).slice(0, 25).map(c => 
                    new StringSelectMenuOptionBuilder().setLabel(formatName(c.name)).setValue(c.id).setEmoji('🚪')
                ));

            await message.reply({ content: "🏘️ **Scegli una casa:**", components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
        }
    } catch (err) { console.error(err); }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    try {
        if (interaction.customId === 'knock_house_select') {
            const targetChannelId = interaction.values[0];
            const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
            const userLimit = playerLimits.get(interaction.user.id) || DEFAULT_MAX_VISITS;
            const used = playerVisits.get(interaction.user.id) || 0;

            let ownerId = null;
            for (const [uid, cid] of playerHomes.entries()) {
                if (cid === targetChannelId) ownerId = uid;
            }

            if (!ownerId) return interaction.reply({ content: "❌ Casa disabitata.", ephemeral: true });

            // TAG RUOLI INTELLIGENTE
            const mentions = RUOLI_DA_TAGGARE
                .filter(rid => targetChannel.members.some(m => m.roles.cache.has(rid)))
                .map(rid => `<@&${rid}>`).join(' ');

            const knockMsg = await targetChannel.send(`${mentions}\n🔔 **TOC TOC!** Qualcuno bussa... ✅/❌`);
            await knockMsg.react('✅'); await knockMsg.react('❌');

            const collector = knockMsg.createReactionCollector({ 
                filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === ownerId, 
                time: 60000, max: 1 
            });

            collector.on('collect', async (r) => {
                if (r.emoji.name === '✅') {
                    playerVisits.set(interaction.user.id, used + 1);
                    await targetChannel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true });
                    await targetChannel.send(`*La porta si apre per ${interaction.user}*`);
                } else {
                    await targetChannel.send("*Silenzio dall'interno...*");
                }
            });

            await interaction.reply({ content: "✊ Hai bussato!", ephemeral: true });
        }
    } catch (e) { console.error(e); }
});

function isAdmin(m) { return m.permissions.has(PermissionsBitField.Flags.Administrator); }
function formatName(n) { return n.replace(/-/g, ' ').toUpperCase().substring(0, 25); }

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GESAgq.BHN1CNeNhQSfnQVs6D0hjnhtVi2GDwCjTTcnQs');
