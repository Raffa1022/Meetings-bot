const { PermissionsBitField, ChannelType, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Configurazione presa dal tuo file index-20.js
const CONFIG = {
    SERVER: {
        COMMAND_GUILD: '1460740887494787259',
        TARGET_GUILD:  '1463608688244822018',
        TARGET_CAT:    '1463608688991273015',
        ROLE_CHAT_CAT: '1460741414357827747'
    },
    CHANNELS: {
        LOG:       '1464941042380837010',
        WELCOME:   '1460740888450830501'
    },
    ROLES: {
        RESET:        '1460741401435181295',
        MEETING_1:    '1460741403331268661',
        MEETING_2:    '1460741402672758814',
        PLAYER_AUTO:  '1460741403331268661',
        SPONSOR_AUTO: '1460741404497019002',
        ALT_CHECK:    '1460741402672758814',
        AUTO_JOIN:    '1460741402672758814'
    },
    LIMITS: {
        MAX_MEETINGS: 3,
        MAX_READINGS: 1
    }
};

let MeetingModel = null;

// Funzione helper per recuperare i dati dal DB
async function getData() {
    let data = await MeetingModel.findOne({ id: 'main_meeting' });
    if (!data) {
        data = new MeetingModel({ id: 'main_meeting' });
        await data.save();
    }
    return data;
}

// Funzione per trovare lo sponsor
function findSponsor(data, playerId) {
    let slot = data.table.slots && data.table.slots.find(s => s.player === playerId);
    if (slot && slot.sponsor) return slot.sponsor;
    slot = data.activeGameSlots && data.activeGameSlots.find(s => s.player === playerId);
    if (slot && slot.sponsor) return slot.sponsor;
    return null;
}

// Generatore testo tabella
function generateTableText(tableData) {
    let text = "**Giocatori** \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b| \u200b \u200b **Sponsor**\n------------------------------\n";
    if (tableData && tableData.slots) {
        tableData.slots.forEach((slot, i) => {
            text += `**#${i + 1}** ${slot.player ? `<@${slot.player}>` : "`(libero)`"} \u200b | \u200b ${slot.sponsor ? `<@${slot.sponsor}>` : "`(libero)`"}\n`;
        });
    }
    return text;
}

module.exports = async (client, Model) => {
    MeetingModel = Model;
    console.log("🧩 [Meeting] Sistema caricato e connesso al DB.");

    // --- EVENTO: INGRESSO UTENTE (Auto Role) ---
    client.on('guildMemberAdd', async member => {
        try {
            const fetchedMember = await member.guild.members.fetch(member.id);
            if (fetchedMember.roles.cache.has(CONFIG.ROLES.ALT_CHECK)) {
                const welcomeChannel = member.guild.channels.cache.get(CONFIG.CHANNELS.WELCOME);
                if (welcomeChannel) await welcomeChannel.permissionOverwrites.create(member.id, { ViewChannel: false });
                return; 
            }
        } catch (e) { console.error("Errore verifica Alt:", e); }

        const data = await getData();
        if (data.isAutoRoleActive) {
            try { await member.roles.add(CONFIG.ROLES.AUTO_JOIN); } 
            catch (e) { console.error(`Errore auto-role:`, e); }
        }
    });

    // --- EVENTO: MESSAGGI (Comandi) ---
    client.on('messageCreate', async message => {
        if (message.author.bot) return;

        const content = message.content;
        const member = message.member;
        const guildId = message.guild.id;
        const isAdmin = member?.permissions.has(PermissionsBitField.Flags.Administrator);

        // !impostazioni
        if (content === '!impostazioni' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
            const data = await getData();
            const helpEmbed = new EmbedBuilder()
                .setTitle('⚙️ Pannello Gestione Bot')
                .setColor(0x2B2D31)
                .addFields(
                    { name: '🔹 !meeting @giocatore (Giocatori)', value: 'Invita un giocatore. Sponsor inclusi.' },
                    { name: '🛑 !fine (Giocatori)', value: 'Chiude la chat.' },
                    { name: '👁️ !lettura (Giocatori)', value: 'Supervisione. Sponsor inclusi.' }, 
                    { name: '🚪 !entrata (Overseer)', value: `Auto-ruolo (Stato: ${data.isAutoRoleActive ? 'ON' : 'OFF'})` },
                    { name: '📋 !tabella [num] (Overseer)', value: 'Crea tabella iscrizioni.' },
                    { name: '🚀 !assegna (Overseer)', value: 'Assegna ruoli/stanze e salva gioco.' },
                    { name: '⚠️ !azzeramento (Overseer)', value: 'Reset totale conteggi meeting/lettura' }
                )
                .setFooter({ text: 'Sistema Mongo Modular' });
            return message.channel.send({ embeds: [helpEmbed] });
        }

        // !entrata
        if (content === '!entrata' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
            if (!isAdmin) return;
            const data = await getData();
            data.isAutoRoleActive = !data.isAutoRoleActive;
            await data.save();
            return message.reply(`🚪 **Auto-Ruolo Ingressi:** ${data.isAutoRoleActive ? "✅ ATTIVO" : "🛑 DISATTIVO"}.`);
        }

        // !azzeramento
        if (content === '!azzeramento' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
            if (!member.roles.cache.has(CONFIG.ROLES.RESET)) return message.reply("⛔ Non hai i permessi.");
            const data = await getData();
            data.meetingCounts = {};
            data.letturaCounts = {};
            await data.save();
            return message.reply("♻️ **Reset effettuato:** Conteggi Meeting e Letture azzerati.");
        }

        // !tabella
        if (content.startsWith('!tabella') && guildId === CONFIG.SERVER.COMMAND_GUILD) {
            if (!isAdmin) return;
            const args = content.split(' ');
            const num = parseInt(args[1]);
            if (!num || num > 50) return message.reply("Specifica un numero di slot (max 50). Es: `!tabella 40`");

            const newTable = {
                limit: num,
                slots: Array(num).fill(null).map(() => ({ player: null, sponsor: null })),
                messageId: null
            };

            const embed = new EmbedBuilder()
                .setTitle(`📋 Iscrizione Giocatori & Sponsor`)
                .setDescription(generateTableText(newTable))
                .setColor('Blue')
                .setFooter({ text: "Usa i menu qui sotto per iscriverti!" });

            const options = Array.from({ length: num }, (_, i) => ({ label: `Numero ${i + 1}`, value: `${i}` }));
            const components = [];
            
            // Menu Player (Split 25)
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('select_player').setPlaceholder('👤 Giocatori 1-25').addOptions(options.slice(0, 25))
            ));
            if (num > 25) {
                components.push(new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('select_player_2').setPlaceholder(`👤 Giocatori 26-${num}`).addOptions(options.slice(25, 50))
                ));
            }
            // Menu Sponsor (Split 25)
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('select_sponsor').setPlaceholder('💰 Sponsor 1-25').addOptions(options.slice(0, 25))
            ));
            if (num > 25) {
                components.push(new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('select_sponsor_2').setPlaceholder(`💰 Sponsor 26-${num}`).addOptions(options.slice(25, 50))
                ));
            }
            // Bottone Leave
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('leave_game').setLabel('🏃 Abbandona Gioco').setStyle(ButtonStyle.Danger)
            ));

            const sentMsg = await message.channel.send({ embeds: [embed], components: components });
            newTable.messageId = sentMsg.id;

            const data = await getData();
            data.table = newTable;
            data.activeGameSlots = []; 
            await data.save();
        }

        // !assegna
        if (content === '!assegna' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
            if (!isAdmin) return;
            const data = await getData();
            if (data.table.limit === 0) return message.reply("⚠️ Nessuna tabella attiva in memoria.");

            await message.reply("⏳ **Inizio configurazione...**");
            let assegnati = 0;

            for (let i = 0; i < data.table.limit; i++) {
                const slot = data.table.slots[i];
                const channelName = `${i + 1}`; 
                const channel = message.guild.channels.cache.find(c => c.parentId === CONFIG.SERVER.ROLE_CHAT_CAT && c.name === channelName);

                if (channel) {
                    await channel.permissionOverwrites.set([{ id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]);
                    const permessiSpeciali = {
                        ViewChannel: true, SendMessages: true, ManageMessages: true,        
                        CreatePrivateThreads: true, SendMessagesInThreads: true, CreatePublicThreads: false   
                    };
                    let utentiDaSalutare = [];
                    if (slot.player) {
                        await channel.permissionOverwrites.edit(slot.player, permessiSpeciali);
                        utentiDaSalutare.push(`<@${slot.player}>`);
                        try { (await message.guild.members.fetch(slot.player)).roles.add(CONFIG.ROLES.PLAYER_AUTO); } catch (e) {}
                    }
                    if (slot.sponsor) {
                        await channel.permissionOverwrites.edit(slot.sponsor, permessiSpeciali);
                        utentiDaSalutare.push(`<@${slot.sponsor}>`);
                        try { (await message.guild.members.fetch(slot.sponsor)).roles.add(CONFIG.ROLES.SPONSOR_AUTO); } catch (e) {}
                    }
                    if (utentiDaSalutare.length > 0) {
                         const saluto = utentiDaSalutare.length === 1 ? 'Benvenuto' : 'Benvenuti';
                         await channel.send(`${saluto} ${utentiDaSalutare.join(' e ')}!`);
                    }
                    assegnati++;
                }
            }
            data.activeGameSlots = [...data.table.slots]; 
            data.table = { limit: 0, slots: [], messageId: null };
            await data.save();
            await message.channel.send(`✅ **Operazione completata!**\n- Stanze configurate: ${assegnati}\n- Gioco salvato in MongoDB.`);
        }

        // !meeting
        if (content.startsWith('!meeting ') && guildId === CONFIG.SERVER.COMMAND_GUILD) {
            if (!member.roles.cache.has(CONFIG.ROLES.PLAYER_AUTO)) return message.reply("❌ Solo i Giocatori possono gestire i meeting.");
            if (!member.roles.cache.has(CONFIG.ROLES.MEETING_1) && !member.roles.cache.has(CONFIG.ROLES.MEETING_2)) return message.reply("⛔ Non hai il ruolo autorizzato.");
            
            const data = await getData();
            if (data.activeUsers.includes(message.author.id)) return message.reply("⚠️ Hai già una chat attiva!");
            const authorCount = data.meetingCounts[message.author.id] || 0;
            if (authorCount >= CONFIG.LIMITS.MAX_MEETINGS) return message.reply(`⚠️ Limite raggiunto (${CONFIG.LIMITS.MAX_MEETINGS}).`);

            const userToInvite = message.mentions.users.first();
            if (!userToInvite || userToInvite.id === message.author.id) return message.reply("⚠️ Tagga un altro giocatore valido.");

            try {
                const targetMember = await message.guild.members.fetch(userToInvite.id);
                const isAuthorPlayer = member.roles.cache.has(CONFIG.ROLES.PLAYER_AUTO);
                const isTargetSponsor = targetMember.roles.cache.has(CONFIG.ROLES.SPONSOR_AUTO);
                const isAuthorSponsor = member.roles.cache.has(CONFIG.ROLES.SPONSOR_AUTO);
                const isTargetPlayer = targetMember.roles.cache.has(CONFIG.ROLES.PLAYER_AUTO);
                if (isAuthorPlayer && isTargetSponsor) return message.reply("⛔ Negato: Giocatore -> Sponsor.");
                if (isAuthorSponsor && isTargetPlayer) return message.reply("⛔ Negato: Sponsor -> Giocatore.");
            } catch (e) {}

            if (data.activeUsers.includes(userToInvite.id)) return message.reply(`⚠️ ${userToInvite} è impegnato.`);

            const proposalMsg = await message.channel.send(`🔔 **Richiesta Meeting**\n👤 **Ospite:** ${userToInvite}\n📩 **Da:** ${message.author}\n\n*Reagisci per accettare/rifiutare*`);
            await proposalMsg.react('✅'); await proposalMsg.react('❌');

            const collector = proposalMsg.createReactionCollector({ 
                filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === userToInvite.id, 
                time: 3 * 60 * 60 * 1000, max: 1 
            });

            collector.on('collect', async (reaction) => {
                if (reaction.emoji.name === '✅') {
                    const freshData = await getData();
                    if (freshData.activeUsers.includes(message.author.id) || freshData.activeUsers.includes(userToInvite.id)) 
                        return reaction.message.reply("❌ Occupato.");
                    
                    let cAuthor = freshData.meetingCounts[message.author.id] || 0;
                    let cGuest = freshData.meetingCounts[userToInvite.id] || 0;
                    if (cAuthor >= CONFIG.LIMITS.MAX_MEETINGS || cGuest >= CONFIG.LIMITS.MAX_MEETINGS) return reaction.message.reply("❌ Token finiti.");

                    const sponsorA = findSponsor(freshData, message.author.id);
                    const sponsorB = findSponsor(freshData, userToInvite.id);

                    freshData.meetingCounts[message.author.id] = cAuthor + 1;
                    freshData.meetingCounts[userToInvite.id] = cGuest + 1;
                    freshData.activeUsers.push(message.author.id);
                    freshData.activeUsers.push(userToInvite.id);
                    freshData.markModified('meetingCounts');
                    freshData.markModified('activeUsers');
                    await freshData.save();

                    try {
                        const targetGuild = client.guilds.cache.get(CONFIG.SERVER.TARGET_GUILD);
                        const permissions = [
                            { id: targetGuild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                            { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], deny: [PermissionsBitField.Flags.CreatePublicThreads] },
                            { id: userToInvite.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], deny: [PermissionsBitField.Flags.CreatePublicThreads] }
                        ];
                        if (sponsorA) permissions.push({ id: sponsorA, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], deny: [PermissionsBitField.Flags.CreatePublicThreads] });
                        if (sponsorB) permissions.push({ id: sponsorB, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], deny: [PermissionsBitField.Flags.CreatePublicThreads] });

                        const newChannel = await targetGuild.channels.create({
                            name: `meeting-${message.author.username}-${userToInvite.username}`,
                            type: ChannelType.GuildText, parent: CONFIG.SERVER.TARGET_CAT, permissionOverwrites: permissions,
                        });

                        let participantsText = `${message.author} e ${userToInvite}`;
                        if (sponsorA) participantsText += ` (Sponsor: <@${sponsorA}>)`;
                        if (sponsorB) participantsText += ` (Sponsor: <@${sponsorB}>)`;

                        const welcomeEmbed = new EmbedBuilder().setTitle("👋 Meeting Avviato").setDescription(`Benvenuti!\nScrivete **!fine** per chiudere.`).setColor(0x00FFFF);
                        await newChannel.send({ content: `🔔 Benvenuti: ${participantsText}`, embeds: [welcomeEmbed] });

                        const logEmbed = new EmbedBuilder().setTitle('📂 Meeting Avviato').setColor(0x00FF00) 
                            .setDescription(`**Autore:** ${message.author.tag}\n**Ospite:** ${userToInvite.tag}\nℹ️ Rispondi con **!lettura** per osservare.`).setFooter({ text: `ID:${newChannel.id}` });
                        
                        await reaction.message.reply({ 
                            content: `✅ **Meeting creato!**\n📊 **Stato:**\n👤 ${message.author.username}: **${cAuthor + 1}/${CONFIG.LIMITS.MAX_MEETINGS}**\n👤 ${userToInvite.username}: **${cGuest + 1}/${CONFIG.LIMITS.MAX_MEETINGS}**`, embeds: [logEmbed] 
                        });
                        reaction.message.channel.messages.cache.delete(reaction.message.id);

                    } catch (e) { 
                        console.error("Errore creazione:", e);
                        const rollbackData = await getData();
                        rollbackData.activeUsers = rollbackData.activeUsers.filter(u => u !== message.author.id && u !== userToInvite.id);
                        await rollbackData.save();
                    }
                } else { reaction.message.reply("❌ Rifiutata."); }
            });
        }

        // !lettura
        if (content === '!lettura' && guildId === CONFIG.SERVER.COMMAND_GUILD) {
            if (!message.reference) return message.reply("⚠️ Rispondi al messaggio verde.");
            if (!member.roles.cache.has(CONFIG.ROLES.PLAYER_AUTO)) return message.reply("❌ Accesso Negato.");

            const data = await getData();
            const currentRead = data.letturaCounts[message.author.id] || 0;
            if (currentRead >= CONFIG.LIMITS.MAX_READINGS) return message.reply("⛔ Limite supervisioni raggiunto (1/1).");

            try {
                const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
                const targetEmbed = repliedMsg.embeds[0];
                if (targetEmbed.fields.some(f => f.name === '👮 Supervisore')) return message.reply("⛔ Supervisore già presente.");

                const channelId = targetEmbed.footer?.text.match(/ID:(\d+)/)?.[1];
                const targetGuild = client.guilds.cache.get(CONFIG.SERVER.TARGET_GUILD);
                const targetChannel = await targetGuild.channels.fetch(channelId).catch(() => null);

                if (!targetChannel) return message.reply("❌ Canale inesistente.");
                if (targetChannel.permissionOverwrites.cache.has(message.author.id)) return message.reply("⚠️ Sei già dentro.");

                const supervisorSponsor = findSponsor(data, message.author.id);
                const readPerms = { ViewChannel: true, SendMessages: false, CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: false };
                
                await targetChannel.permissionOverwrites.create(message.author.id, readPerms);
                if (supervisorSponsor) await targetChannel.permissionOverwrites.create(supervisorSponsor, readPerms);

                let notificationMsg = supervisorSponsor ? `${message.author} e il suo Sponsor <@${supervisorSponsor}> osservano.` : `${message.author} osserva.`;
                const participants = targetChannel.permissionOverwrites.cache.filter(o => ![client.user.id, message.author.id, targetGuild.id, supervisorSponsor].includes(o.id)).map(o => `<@${o.id}>`).join(' ');
                await targetChannel.send(`⚠️ ATTENZIONE ${participants}: ${notificationMsg}`);

                data.letturaCounts[message.author.id] = currentRead + 1;
                data.markModified('letturaCounts');
                await data.save();

                const newEmbed = EmbedBuilder.from(targetEmbed).setColor(0xFFA500)
                    .spliceFields(0, 1, { name: 'Stato', value: '🟠 Supervisionato', inline: true })
                    .addFields({ name: '👮 Supervisore', value: notificationMsg, inline: true });
                await repliedMsg.edit({ embeds: [newEmbed] });
                message.reply(`👁️ **Accesso Garantito.**`);
                message.channel.messages.cache.delete(repliedMsg.id);

            } catch (e) { console.error(e); message.reply("❌ Errore tecnico."); }
        }

        // !fine
        if (content === '!fine' && guildId === CONFIG.SERVER.TARGET_GUILD) {
            if (!message.channel.name.startsWith('meeting-')) return;
            const data = await getData();
            const usersInChannel = message.channel.members.map(m => m.id);
            data.activeUsers = data.activeUsers.filter(uid => !usersInChannel.includes(uid));
            await data.save();

            await message.channel.send("🛑 **Chat Chiusa.**");
            message.channel.permissionOverwrites.cache.forEach(async (overwrite) => {
                if (overwrite.id !== client.user.id) {
                    await message.channel.permissionOverwrites.edit(overwrite.id, { SendMessages: false, AddReactions: false });
                }
            });
        }
    });

    // --- INTERAZIONI (Menu/Bottoni) ---
    client.on('interactionCreate', async interaction => {
        if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('select_player') || interaction.customId.startsWith('select_sponsor'))) {
            const data = await getData();
            if (data.table.limit === 0) return interaction.reply({ content: "⛔ Tabella chiusa.", ephemeral: true });

            const slotIndex = parseInt(interaction.values[0]);
            const type = interaction.customId.startsWith('select_player') ? 'player' : 'sponsor';

            if (data.table.slots[slotIndex][type]) return interaction.reply({ content: "❌ Posto occupato!", ephemeral: true });
            data.table.slots.forEach(slot => {
                if (slot.player === interaction.user.id) slot.player = null;
                if (slot.sponsor === interaction.user.id) slot.sponsor = null;
            });
            data.table.slots[slotIndex][type] = interaction.user.id;
            data.markModified('table');
            await data.save();
            await interaction.update({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setDescription(generateTableText(data.table))] });
        }

        if (interaction.isButton() && interaction.customId === 'leave_game') {
            const data = await getData();
            if (data.table.limit === 0) return interaction.reply({ content: "⛔ Tabella chiusa.", ephemeral: true });
            
            let found = false;
            data.table.slots.forEach(slot => {
                if (slot.player === interaction.user.id) { slot.player = null; found = true; }
                if (slot.sponsor === interaction.user.id) { slot.sponsor = null; found = true; }
            });
            if (!found) return interaction.reply({ content: "❌ Non eri iscritto.", ephemeral: true });
            
            data.markModified('table');
            await data.save();
            await interaction.update({ embeds: [new EmbedBuilder(interaction.message.embeds[0]).setDescription(generateTableText(data.table))] });
        }
    });
};
