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

const express = require('express'); // Per Health Check Koyeb

// ==========================================
// ⚙️ CONFIGURAZIONE (MODIFICA QUI!)
// ==========================================

const TOKEN = 'MTQ2MzU5NDkwMTAzOTIyMjg3Nw.G2ZqJU.HRxjqWMs2fIwblzW2B2SUXcYhUZ8BkeWioLmss'; 
const PREFIX = '!';

// ID UTILI
const ID_CATEGORIA_PUBBLICA = '1460741412466331799'; 
const ID_CATEGORIA_CASE = '1460741413388947528';
const ID_CANALE_DB = '1465768646906220700'; // Canale privato dove il bot salva i dati

// RUOLI CHE POSSONO RISPONDERE AL BUSSARE (ID Ruoli Discord)
// Inserisci qui gli ID dei ruoli che, se presenti in casa, devono approvare l'ingresso
const RUOLI_PERMESSI = [
    '1460741403331268661', 
    '1460741404497019002', 
    '1460741402672758814'
]; 

const DEFAULT_MAX_VISITS = 3;

// ==========================================
// 🛡️ ANTI-CRASH & WEB SERVER (Koyeb Health Check)
// ==========================================

const app = express();
app.get('/', (req, res) => res.send('Bot is Alive!'));
app.listen(8000, () => console.log('🌍 Web Server pronto sulla porta 8000'));

process.on('unhandledRejection', (reason, p) => {
    console.error(' [ANTI-CRASH] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err, origin) => {
    console.error(' [ANTI-CRASH] Uncaught Exception:', err);
});
process.on('uncaughtExceptionMonitor', (err, origin) => {
    console.error(' [ANTI-CRASH] Uncaught Exception Monitor:', err);
});

// ==========================================
// 🤖 CLIENT DISCORD
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates, // Utile per sapere chi è nei canali
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// ==========================================
// 💾 GESTORE DATABASE (DISCORD CHANNEL DB)
// ==========================================

let dbCache = {
    playerHomes: {},   // { userID: channelID }
    playerVisits: {},  // { userID: count }
    maxVisits: {},     // { userID: limit }
    lastReset: null
};

// Carica il DB all'avvio
async function loadDB() {
    try {
        const channel = await client.channels.fetch(ID_CANALE_DB);
        const messages = await channel.messages.fetch({ limit: 1 });
        if (messages.size > 0) {
            const lastMsg = messages.first();
            if (lastMsg.content.startsWith('```json')) {
                const jsonContent = lastMsg.content.replace(/```json|```/g, '');
                dbCache = JSON.parse(jsonContent);
                console.log("💾 Database caricato con successo!");
            }
        }
    } catch (e) {
        console.error("❌ Errore caricamento DB:", e);
    }
}

// Salva il DB sul canale
async function saveDB() {
    try {
        const channel = await client.channels.fetch(ID_CANALE_DB);
        const jsonString = JSON.stringify(dbCache, null, 2);
        
        // Cancella vecchi messaggi per pulizia
        const messages = await channel.messages.fetch({ limit: 5 });
        if (messages.size > 0) await channel.bulkDelete(messages);

        await channel.send(`\`\`\`json\n${jsonString}\n\`\`\``);
    } catch (e) {
        console.error("❌ Errore salvataggio DB:", e);
    }
}

client.once('ready', async () => {
    console.log(`✅ Bot Online come ${client.user.tag}!`);
    await loadDB();
    
    // Controllo Reset Giornaliero (Semplificato)
    const today = new Date().toDateString();
    if (dbCache.lastReset !== today) {
        dbCache.playerVisits = {};
        dbCache.lastReset = today;
        await saveDB();
        console.log("🔄 Contatori visite resettati per nuovo giorno.");
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    try {
        // ---------------------------------------------------------
        // 👮 COMANDI ADMIN
        // ---------------------------------------------------------

        if (command === 'assegnacasa') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            const targetChannel = message.mentions.channels.first();

            if (!targetUser || !targetChannel) return message.reply("❌ Uso: `!assegnacasa @Utente #canale`");

            dbCache.playerHomes[targetUser.id] = targetChannel.id;
            await saveDB();

            await targetChannel.permissionOverwrites.set([
                { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: targetUser.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels] }
            ]);

            message.reply(`✅ Casa assegnata a ${targetUser}.`);
            targetChannel.send(`🔑 **${targetUser}**, questa è la tua dimora privata.`);
        }

        // !setmaxvisite @Utente 5
        if (command === 'setmaxvisite') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            
            const targetUser = message.mentions.members.first();
            const limit = parseInt(args[1]);

            if (!targetUser || isNaN(limit)) return message.reply("❌ Uso: `!setmaxvisite @Utente Numero`");
            
            dbCache.maxVisits[targetUser.id] = limit;
            await saveDB();
            message.reply(`✅ Limite visite per **${targetUser.displayName}** impostato a **${limit}**.`);
        }

        // !resetvisite
        if (command === 'resetvisite') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply("⛔ Non sei admin.");
            dbCache.playerVisits = {};
            await saveDB();
            message.reply("🔄 Tutti i contatori visite sono stati resettati manualmente.");
        }

        // ---------------------------------------------------------
        // 👤 COMANDI GIOCATORE
        // ---------------------------------------------------------

        if (command === 'torna') {
            const homeId = dbCache.playerHomes[message.author.id];
            if (!homeId) return message.reply("❌ Non hai una casa registrata.");
            
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
                    new StringSelectMenuOptionBuilder()
                        .setLabel(formatName(c.name))
                        .setValue(c.id)
                        .setEmoji('🌍')
                ).slice(0, 25));

            await message.reply({ components: [new ActionRowBuilder().addComponents(select)], ephemeral: true });
        }

        if (command === 'bussa') {
            // Controllo Stamina Personale
            const userLimit = dbCache.maxVisits[message.author.id] || DEFAULT_MAX_VISITS;
            const used = dbCache.playerVisits[message.author.id] || 0;
            
            if (used >= userLimit) {
                return message.reply(`⛔ **Sei stanco.** Hai usato tutte le tue ${userLimit} visite per oggi.`);
            }

            // Prendi tutte le case e ordina in modo naturale (Casa 1, Casa 2, Casa 10)
            const tutteLeCase = message.guild.channels.cache
                .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

            if (tutteLeCase.size === 0) return message.reply("❌ Non ci sono case.");

            // Paginazione
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
                .setPlaceholder('Seleziona zona...')
                .addOptions(pageOptions);

            await message.reply({ 
                content: `🏠 **Scegli dove andare (Visite rimaste: ${userLimit - used})**`, 
                components: [new ActionRowBuilder().addComponents(selectGroup)], 
                ephemeral: true 
            });
        }

    } catch (error) {
        console.error("Errore nel comando:", error);
        message.reply("⚠️ Si è verificato un errore durante l'esecuzione.").catch(()=>{});
    }
});

// ==========================================
// 🖱️ GESTIONE INTERAZIONI
// ==========================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    try {
        // 1. SELEZIONE PAGINA
        if (interaction.customId === 'knock_page_select') {
            const pageIndex = parseInt(interaction.values[0].split('_')[1]);
            const PAGE_SIZE = 25;

            const tutteLeCase = interaction.guild.channels.cache
                .filter(c => c.parentId === ID_CATEGORIA_CASE && c.type === ChannelType.GuildText)
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

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

        // 2. BUSSATA E LOGICA INGRESSO
        if (interaction.customId === 'knock_house_select') {
            const targetChannelId = interaction.values[0];
            const targetChannel = interaction.guild.channels.cache.get(targetChannelId);
            const knocker = interaction.member;

            // Ricontrollo Limite
            const userLimit = dbCache.maxVisits[knocker.id] || DEFAULT_MAX_VISITS;
            const used = dbCache.playerVisits[knocker.id] || 0;
            if (used >= userLimit) return interaction.reply({ content: "⛔ Visite finite!", ephemeral: true });

            if (!targetChannel) return interaction.reply({ content: "Casa inesistente.", ephemeral: true });

            // 🔍 CONTROLLO CHI È IN CASA
            // Otteniamo chi ha i permessi di vedere il canale ED è effettivamente presente nella lista membri (o nel canale se voice, ma qui assumiamo text permission + presence generica in gdr)
            // Nota: Discord non dice se un utente sta "guardando" un canale testuale. 
            // Controlleremo chi ha il permesso di VIEW_CHANNEL nel canale e possiede uno dei RUOLI_PERMESSI.
            
            const membersWithAccess = targetChannel.members.filter(member => 
                !member.user.bot && 
                member.id !== knocker.id &&
                member.roles.cache.hasAny(...RUOLI_PERMESSI)
            );

            // LOGICA DI INGRESSO
            if (membersWithAccess.size === 0) {
                // --> NESSUNO IN CASA (o nessuno coi ruoli giusti) -> ENTRA SUBITO
                await interaction.reply({ content: `🔓 La porta è aperta/incustodita. Entri...`, ephemeral: true });
                await enterHouse(knocker, interaction.channel, targetChannel, "entra (incustodita)");
                
            } else {
                // --> QUALCUNO È IN CASA -> TOC TOC
                await interaction.reply({ content: `✊ Hai bussato a **${formatName(targetChannel.name)}**. Aspetta una risposta...`, ephemeral: true });
                
                // Tagga solo chi è presente coi ruoli
                const mentions = membersWithAccess.map(m => m.toString()).join(' ');
                
                const msg = await targetChannel.send(
                    `🔔 **TOC TOC!** ${mentions}\n**${knocker.displayName}** sta bussando!\nAvete **5 minuti** per rispondere.\n\n✅ = Apri | ❌ = Ignora`
                );
                await msg.react('✅');
                await msg.react('❌');

                // Collector
                const filter = (reaction, user) => {
                    return ['✅', '❌'].includes(reaction.emoji.name) && 
                           membersWithAccess.has(user.id); // Solo chi era dentro coi ruoli può rispondere
                };

                const collector = msg.createReactionCollector({ filter, time: 300000, max: 1 }); // 5 minuti (300k ms)

                collector.on('collect', async (reaction, user) => {
                    if (reaction.emoji.name === '✅') {
                        // APRE
                        msg.edit(`✅ **${user.displayName}** ha aperto la porta.`);
                        await enterHouse(knocker, interaction.channel, targetChannel, "entra (invitato)");
                    } else {
                        // RIFIUTA
                        msg.edit(`❌ **${user.displayName}** ha rifiutato l'ingresso.`);
                        
                        // Lista di chi c'era dentro (ID Discord e Nomi)
                        const namesList = membersWithAccess.map(m => `${m.displayName} (${m.user.tag})`).join('\n');
                        
                        try {
                            await knocker.send(
                                `⛔ Non ti hanno aperto alla **${targetChannel.name}**.\nPersone presenti che hanno rifiutato/ignorato:\n\`\`\`${namesList}\`\`\``
                            );
                        } catch(e) {}
                    }
                });

                collector.on('end', async (collected) => {
                    if (collected.size === 0) {
                        // TEMPO SCADUTO -> ENTRA AUTOMATICAMENTE
                        await targetChannel.send("⏳ Nessuno ha risposto in tempo. La porta viene forzata/aperta.");
                        await enterHouse(knocker, interaction.channel, targetChannel, "entra (tempo scaduto)");
                    }
                });
            }
        }

        // 3. VIAGGIO
        if (interaction.customId === 'public_travel') {
            const target = interaction.guild.channels.cache.get(interaction.values[0]);
            await interaction.deferReply({ ephemeral: true });
            await movePlayer(interaction.member, interaction.channel, target, "si dirige verso");
            await interaction.editReply(`✅ Arrivato.`);
        }

    } catch (error) {
        console.error("Errore interazione:", error);
        if (!interaction.replied) interaction.reply({ content: "❌ Errore critico.", ephemeral: true });
    }
});

// ==========================================
// 🛠️ FUNZIONI DI UTILITÀ
// ==========================================

function formatName(name) {
    return name.replace(/-/g, ' ').toUpperCase().substring(0, 25);
}

// Funzione unificata per entrare e scalare visite
async function enterHouse(member, fromChannel, toChannel, narrativeAction) {
    // Aggiorna DB Visite
    const current = dbCache.playerVisits[member.id] || 0;
    dbCache.playerVisits[member.id] = current + 1;
    await saveDB();

    await movePlayer(member, fromChannel, toChannel, narrativeAction);
}

async function movePlayer(member, oldChannel, newChannel, actionText) {
    if (!member || !newChannel) return;

    // Gestione uscita vecchio canale
    if (oldChannel && oldChannel.id !== newChannel.id) {
        const myHome = dbCache.playerHomes[member.id];
        
        oldChannel.send(`🚶 **${member.displayName}** esce e ${actionText} **${formatName(newChannel.name)}**.`);
        
        // Toglie permessi se esce da una casa privata non sua
        if (oldChannel.id !== myHome && oldChannel.parentId === ID_CATEGORIA_CASE) {
             await oldChannel.permissionOverwrites.delete(member.id).catch(() => {});
        }
    }

    // Gestione entrata nuovo canale
    await newChannel.permissionOverwrites.create(member.id, { ViewChannel: true, SendMessages: true });

    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setDescription(`👋 **${member.displayName}** è entrato.`)
    
    await newChannel.send({ embeds: [embed] });
    // Ping fantasma
    const p = await newChannel.send(`${member}`);
    setTimeout(() => p.delete(), 500);
}

client.login(TOKEN);

