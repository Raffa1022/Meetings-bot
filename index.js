const http = require('http');
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is alive');
}).listen(8000);
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    Options, 
    PermissionsBitField, 
    ChannelType, 
    EmbedBuilder 
} = require('discord.js');

// 1. SERVER PER MANTENERE IL BOT SVEGLIO (Keep-alive)
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is alive');
}).listen(8000);

// 2. CONFIGURAZIONE DEL CLIENT DISCORD
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ],
    // Partials: Fondamentali per leggere reazioni su messaggi vecchi (non in memoria)
    partials: [Partials.Message, Partials.Reaction, Partials.User],
    
    // Cache: Ridotta al minimo per non far crashare il bot su Koyeb
    makeCache: Options.cacheWithLimits({
        MessageManager: 10,        // Ricorda solo gli ultimi 10 messaggi per canale
        PresenceManager: 0,       // Non memorizza lo stato (online/offline) degli utenti
        GuildMemberManager: 100    // Memorizza al massimo 100 membri del server
    }),
});

// --- CONFIGURAZIONE ID (COMPILA TUTTI I CAMPI SE NECESSARIO) ---
// Qui puoi aggiungere le tue variabili come ID_SERVER_COMMAND ecc.

// 3. EVENTO: IL BOT È PRONTO
client.once('ready', () => {
    console.log(`Bot loggato come ${client.user.tag}`);
});

// 4. LOGICA DELLE REAZIONI (✅ e ❌)
client.on('messageReactionAdd', async (reaction, user) => {
    // Ignora le reazioni messe dal bot stesso
    if (user.bot) return;

    // Se il messaggio è vecchio e non è tra i 10 in memoria, il bot lo "riprende" da Discord
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Errore nel recupero del messaggio vecchio:', error);
            return;
        }
    }

    // Gestione dei tasti per il meeting
    const message = reaction.message;

    if (reaction.emoji.name === '✅') {
        // Logica quando viene cliccata la spunta
        console.log(`${user.username} ha accettato il meeting.`);
        // Esempio: invia un messaggio di conferma
        await message.channel.send(`✅ **${user.username}** ha accettato l'incontro!`);
        
        // Una volta finita l'operazione, il messaggio uscirà dalla memoria 
        // appena arrivano nuovi messaggi, grazie al limite di 10 impostato sopra.
    }

    if (reaction.emoji.name === '❌') {
        // Logica quando viene cliccata la croce
        console.log(`${user.username} ha rifiutato il meeting.`);
        await message.channel.send(`❌ **${user.username}** ha declinato l'invito.`);
    }
});

// --- 🔧 CONFIGURAZIONE ID (COMPILA TUTTI I CAMPI) ---

// 1. ID del Server "TELECOMANDO" (Dove scrivi i comandi)
const ID_SERVER_COMMAND = '1294619216447799376'; 

// 2. ID del Canale LOG nel server "TELECOMANDO"
const ID_CANALE_LOG = '1294619216930013277';

// 3. ID del Server di DESTINAZIONE (Dove si creano le stanze)
const ID_SERVER_TARGET = '1463608688244822018';

// 4. ID della Categoria nel Server di DESTINAZIONE
const ID_CATEGORIA_TARGET = '1463608688991273015';

// 5. ID del RUOLO che può fare gli AZZERAMENTI (1 e 2)
const ID_RUOLO_RESET = '1463619259728134299';

// 6. & 7. I DUE RUOLI che possono creare MEETING
// Solo chi ha ALMENO UNO di questi due ruoli può fare !meeting
const ID_RUOLO_MEETING_1 = '1369800222448025711';
const ID_RUOLO_MEETING_2 = '1463689842285215764';


// --- 🔢 SISTEMI DI CONTEGGIO ---
const meetingCounts = new Map(); // Conta i meeting (Max 3)
const MAX_MEETINGS = 3;

const letturaCounts = new Map(); // Conta le letture (Max 1)
const MAX_LETTURE = 1;


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ]
});

client.once('clientReady', () => {
    console.log(`✅ Bot online: ${client.user.tag}`);
    console.log("Sistema pronto: Ruoli meeting, Privacy e !impostazioni attivi.");
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // =========================================================================
    // ⚙️ COMANDO: !impostazioni (LISTA COMANDI)
    // =========================================================================
    if (message.content === '!impostazioni') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;

        const helpEmbed = new EmbedBuilder()
            .setTitle('🛠️ Pannello Comandi Bot')
            .setColor(0x0099FF)
            .setDescription("Ecco la lista dei comandi disponibili e la loro funzione.")
            .addFields(
                { name: '🟢 `!meeting @utente`', value: 'Crea una chat privata con un altro giocatore.\n*Max 3 meeting attivi per giocatore.*' },
                { name: '🛑 `!fine`', value: 'Si usa dentro la chat privata.\nArchivia la conversazione (diventa sola lettura per i partecipanti).' },
                { name: '🕵️ `!lettura`', value: 'Si usa rispondendo al messaggio verde nel canale Log.\nTi permette di entrare come supervisore in una chat.\n*Max 1 lettura attiva per giocatore. Vietato nelle proprie chat.*' },
                { name: '🔄 `!azzeramento1`', value: '**(Solo Staff)** Resetta i contatori dei Meeting a 0 per tutti.' },
                { name: '🔄 `!azzeramento2`', value: '**(Solo Staff)** Resetta i contatori delle Letture a 0 per tutti.' }
            )
            .setFooter({ text: 'Sistema Meeting & Privacy' });

        return message.channel.send({ embeds: [helpEmbed] });
    }

    // =========================================================================
    // 🔄 COMANDO: !azzeramento1 (RESETTA I MEETING A 0)
    // =========================================================================
    if (message.content === '!azzeramento1') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        
        if (!message.member.roles.cache.has(ID_RUOLO_RESET)) {
            return message.reply("❌ **Accesso Negato.** Non hai il ruolo autorizzato.");
        }

        meetingCounts.clear(); 
        return message.reply("🔄 **Azzeramento Meeting Completato.**\nTutti i contatori meeting sono tornati a 0/3.");
    }

    // =========================================================================
    // 🔄 COMANDO: !azzeramento2 (RESETTA LE LETTURE A 0)
    // =========================================================================
    if (message.content === '!azzeramento2') {
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        
        if (!message.member.roles.cache.has(ID_RUOLO_RESET)) {
            return message.reply("❌ **Accesso Negato.** Non hai il ruolo autorizzato.");
        }

        letturaCounts.clear(); 
        // Testo modificato come richiesto
        return message.reply("🔄 **Azzeramento Letture Completato.**\nTutti i giocatori possono effettuare nuovamente 1 lettura.");
    }

    // =========================================================================
    // 🟢 COMANDO: !meeting (Si fa nel server "Telecomando")
    // =========================================================================
    if (message.content.startsWith('!meeting ')) {
        
        if (message.guild.id !== ID_SERVER_COMMAND) return;

        // --- 🔒 CHECK RUOLI ABILITATI ---
        // Deve avere ALMENO UNO dei due ruoli
        const hasRole1 = message.member.roles.cache.has(ID_RUOLO_MEETING_1);
        const hasRole2 = message.member.roles.cache.has(ID_RUOLO_MEETING_2);

        if (!hasRole1 && !hasRole2) {
            return message.reply("❌ **Non autorizzato.** Non possiedi il ruolo necessario per creare meeting.");
        }

        // --- 🔢 CHECK LIMITE AUTORE ---
        const authorCountCheck = meetingCounts.get(message.author.id) || 0;
        if (authorCountCheck >= MAX_MEETINGS) {
            return message.reply(`❌ ${message.author}, **Azione Fallita.**\nHai raggiunto il limite massimo di **3** meeting (fatti o accettati).\nAttendi l'azzeramento globale.`);
        }

        const userToInvite = message.mentions.users.first();
        if (!userToInvite) return message.reply("❌ Devi taggare un utente. Esempio: `!meeting @Mario`");
        if (userToInvite.id === message.author.id) return message.reply("❌ Non puoi aprire un meeting con te stesso.");

        // Timeout 3 Ore
        const durataOre = 3;
        const durataMs = durataOre * 60 * 60 * 1000;
        const scadenzaTimestamp = Math.floor((Date.now() + durataMs) / 1000);

        const proposalMsg = await message.channel.send(
            `🔔 **Richiesta Meeting**\n<@${userToInvite.id}>, l'utente ${message.author} vuole aprire una stanza privata con te.\n\n⏳ **Scadenza:** <t:${scadenzaTimestamp}:R>\n\n✅ Accetta | ❌ Rifiuta`
        );
        
        await proposalMsg.react('✅');
        await proposalMsg.react('❌');

        const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && user.id === userToInvite.id;
        const collector = proposalMsg.createReactionCollector({ filter, time: durataMs, max: 1 });

        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅') {
                
                // --- 🔢 DOPPIO CHECK E INCREMENTO ---
                let countAuthor = meetingCounts.get(message.author.id) || 0;
                let countInvite = meetingCounts.get(userToInvite.id) || 0;

                if (countAuthor >= MAX_MEETINGS) {
                    return proposalMsg.reply(`❌ L'autore ${message.author} ha raggiunto il limite di meeting proprio ora!`);
                }

                if (countInvite >= MAX_MEETINGS) {
                    return proposalMsg.reply(`❌ ${userToInvite}, **Non puoi accettare!**\nHai raggiunto il limite di **3** meeting.`);
                }
                
                countAuthor++;
                countInvite++;
                
                meetingCounts.set(message.author.id, countAuthor);
                meetingCounts.set(userToInvite.id, countInvite);

                await proposalMsg.reply(`✅ **Accettato!** Creazione stanza in corso...\n📊 **Stato Slot:**\n- ${message.author.username}: ${countAuthor}/3\n- ${userToInvite.username}: ${countInvite}/3`);

                try {
                    const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
                    if (!targetGuild) return message.channel.send("❌ Errore: Server destinazione non trovato.");

                    const memberAuthor = await targetGuild.members.fetch(message.author.id).catch(() => null);
                    const memberInvite = await targetGuild.members.fetch(userToInvite.id).catch(() => null);

                    if (!memberAuthor || !memberInvite) {
                        return message.channel.send("❌ Errore: Uno dei partecipanti non è nel server di destinazione.");
                    }

                    // Creazione Canale
                    const newChannel = await targetGuild.channels.create({
                        name: `meeting-${memberAuthor.user.username}-${memberInvite.user.username}`,
                        type: ChannelType.GuildText,
                        parent: ID_CATEGORIA_TARGET,
                        topic: `Meeting Privato | ID: ${proposalMsg.id} | Stato: APERTO`,
                        permissionOverwrites: [
                            { id: targetGuild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, 
                            { id: memberAuthor.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                            { id: memberInvite.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                        ],
                    });

                    // Benvenuto
                    await newChannel.send(`🔒 **Nuova Sessione Privata**\nBenvenuti <@${memberAuthor.id}> e <@${memberInvite.id}>!\n\nQuando avete terminato, scrivete **!fine** per archiviare la conversazione (resterà consultabile in sola lettura).`);

                    // Log Admin
                    const logChannel = await client.channels.fetch(ID_CANALE_LOG);
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('📂 Nuovo Meeting Avviato')
                            .setColor(0x00FF00) // Verde
                            .setDescription(`**Autore:** ${message.author.tag}\n**Ospite:** ${userToInvite.tag}\n**Canale:** <#${newChannel.id}>`)
                            .addFields(
                                { name: 'Stato Controllo', value: '🟢 Nessun supervisore. Rispondi con `!lettura`.' },
                                { name: 'Slot Usati', value: `Autore: **${countAuthor}/3**\nOspite: **${countInvite}/3**` }
                            )
                            .setFooter({ text: `ID:${newChannel.id}` })
                            .setTimestamp();

                        await logChannel.send({ embeds: [logEmbed] });
                    }

                } catch (error) {
                    console.error("Errore creazione meeting:", error);
                    message.channel.send("❌ Errore tecnico creazione.");
                }
            } else {
                await proposalMsg.reply("❌ **Rifiutato.**");
            }
        });

        collector.on('end', collected => {
            if (collected.size === 0) {
                proposalMsg.reply("⏰ **Tempo scaduto.** Richiesta annullata.");
            }
        });

        return;
    }

    // =========================================================================
    // 🕵️ COMANDO: !lettura (Si fa nel server "Telecomando")
    // =========================================================================
    if (message.content === '!lettura') {
        
        if (message.guild.id !== ID_SERVER_COMMAND) return;
        if (!message.reference) return message.reply("❌ Devi usare **Rispondi** al messaggio di notifica verde.");

        // --- 🔢 CHECK LIMITE LETTURA ---
        const currentReadCount = letturaCounts.get(message.author.id) || 0;
        if (currentReadCount >= MAX_LETTURE) {
            return message.reply(`❌ ${message.author}, **Azione Fallita.**\nHai già utilizzato la tua lettura disponibile (1/1).\nAttendi il comando !azzeramento2.`);
        }

        try {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);

            // --- 🔒 CHECK UNICITÀ (SUPERVISORE UNICO) ---
            if (repliedMsg.embeds.length > 0) {
                const embed = repliedMsg.embeds[0];
                if (embed.data.color === 0xFFA500) { 
                    const field = embed.fields.find(f => f.name === '👮‍♂️ Supervisore');
                    const nomeSupervisore = field ? field.value : "un altro giocatore";
                    
                    if (!nomeSupervisore.includes(message.author.tag)) {
                        return message.reply(`❌ **Accesso Negato.**\nQuesta chat è già supervisionata da: **${nomeSupervisore}**.`);
                    }
                }
            }

            // Recupero ID
            let targetChannelId = null;
            if (repliedMsg.embeds.length > 0 && repliedMsg.embeds[0].footer) {
                const match = repliedMsg.embeds[0].footer.text.match(/(\d{17,20})/);
                if (match) targetChannelId = match[1];
            }

            if (!targetChannelId) return message.reply("❌ ID Canale non trovato.");

            const targetGuild = client.guilds.cache.get(ID_SERVER_TARGET);
            const targetChannel = await targetGuild.channels.fetch(targetChannelId).catch(() => null);

            if (!targetChannel) return message.reply("❌ Il canale del meeting non esiste più.");

            // --- 🚫 BLOCCO AUTO-SUPERVISIONE ---
            // Se l'utente è GIA' presente nei permessi del canale, significa che è un partecipante
            // (I partecipanti vengono aggiunti alla creazione. Gli admin esterni no.)
            if (targetChannel.permissionOverwrites.cache.has(message.author.id)) {
                return message.reply("❌ **Errore.** Non puoi supervisionare una chat di cui fai già parte (sei Autore o Ospite).");
            }

            const adminMember = await targetGuild.members.fetch(message.author.id).catch(() => null);
            if (!adminMember) return message.reply("❌ Non sei presente nel server di destinazione.");

            // Permessi Admin
            await targetChannel.permissionOverwrites.create(adminMember.id, {
                ViewChannel: true,
                SendMessages: false, 
                AddReactions: false
            });

            // Update Log
            const oldEmbed = repliedMsg.embeds[0];
            const newEmbed = EmbedBuilder.from(oldEmbed)
                .setColor(0xFFA500) 
                .setFields([
                    { name: '👮‍♂️ Supervisore', value: `${message.author.tag} (Attivo)` }
                ]);

            await repliedMsg.edit({ embeds: [newEmbed] });

            // Incremento contatore Lettura
            const newReadCount = currentReadCount + 1;
            letturaCounts.set(message.author.id, newReadCount);

            message.reply(`✅ **Accesso Supervisore Attivato.** (Letture usate: ${newReadCount}/1)\nHai timbrato questo meeting. Nessun altro giocatore potrà entrare.`);

            // Avviso Stanza
            const usersToTag = targetChannel.permissionOverwrites.cache
                .filter(overwrite => 
                    overwrite.id !== client.user.id && 
                    overwrite.id !== adminMember.id && 
                    overwrite.id !== targetGuild.id
                )
                .map(overwrite => `<@${overwrite.id}>`)
                .join(' ');

            if (usersToTag.length > 0) {
                await targetChannel.send(`👮‍♂️ **Avviso Staff**\n${usersToTag} ⚠️ È entrato il supervisore: ${message.author}`);
            }

        } catch (e) {
            console.error("Errore !lettura:", e);
            message.reply("❌ Errore tecnico.");
        }
        return;
    }

    // =========================================================================
    // 🛑 COMANDO: !fine (Si fa nel server di DESTINAZIONE)
    // =========================================================================
    if (message.content === '!fine') {
        if (message.guild.id !== ID_SERVER_TARGET) return;
        if (!message.channel.name.startsWith('meeting-')) return;

        await message.channel.send("🛑 **Sessione Terminata.**\nLa chat è stata archiviata: resterà consultabile ai partecipanti in sola lettura.");
        
        if (message.channel.topic) {
            await message.channel.setTopic(message.channel.topic.replace("Stato: APERTO", "Stato: CHIUSO"));
        }

        const everyoneRole = message.guild.roles.everyone;

        message.channel.permissionOverwrites.cache.forEach(async (overwrite) => {
            if (overwrite.id === client.user.id) return;

            if (overwrite.id === everyoneRole.id) {
                await message.channel.permissionOverwrites.edit(overwrite.id, {
                    ViewChannel: false, 
                    SendMessages: false
                });
                return;
            }

            try {
                await message.channel.permissionOverwrites.edit(overwrite.id, { 
                    ViewChannel: true,   
                    SendMessages: false, 
                    AddReactions: false 
                });
            } catch (e) {
                console.error(e);
            }
        });
    }
});

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GFe33d.9RgkeDdLwtKrQhi69vQFgMCVaR-hqvYkkI-hVg');







