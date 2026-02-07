// ==========================================
// 👥 MEETING SYSTEM - 100% ATOMICO
// Zero .save(), solo operazioni $set/$inc/$push/$pull
// ==========================================
const {
    PermissionsBitField, ChannelType, EmbedBuilder,
    ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const { MEETING } = require('./config');
const db = require('./db');

function generateTableText(tableData) {
    let text = "**Giocatori** \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b \u200b| \u200b \u200b **Sponsor**\n------------------------------\n";
    if (tableData?.slots) {
        tableData.slots.forEach((slot, i) => {
            text += `**#${i + 1}** ${slot.player ? `<@${slot.player}>` : "`(libero)`"} \u200b | \u200b ${slot.sponsor ? `<@${slot.sponsor}>` : "`(libero)`"}\n`;
        });
    }
    return text;
}

module.exports = function initMeetingSystem(client) {
    console.log("🧩 [Meeting] Sistema caricato (100% atomico).");

    // --- AUTO ROLE ---
    client.on('guildMemberAdd', async member => {
        try {
            const fetched = await member.guild.members.fetch(member.id);
            if (fetched.roles.cache.has(MEETING.ROLE_ALT_CHECK)) {
                const welcome = member.guild.channels.cache.get(MEETING.WELCOME_CHANNEL);
                if (welcome) await welcome.permissionOverwrites.create(member.id, { ViewChannel: false });
                return;
            }
        } catch {}

        const isActive = await db.meeting.getAutoRoleState();
        if (isActive) {
            try { await member.roles.add(MEETING.ROLE_AUTO_JOIN); } catch {}
        }
    });

    // --- COMANDI ---
    client.on('messageCreate', async message => {
        if (message.author.bot) return;
        const content = message.content;
        const member = message.member;
        const guildId = message.guild?.id;
        const isAdm = member?.permissions.has(PermissionsBitField.Flags.Administrator);

        // !impostazioni
        if (content === '!impostazioni' && guildId === MEETING.COMMAND_GUILD) {
            const isActive = await db.meeting.getAutoRoleState();
            const embed = new EmbedBuilder()
                .setTitle('⚙️ Pannello Gestione Bot').setColor(0x2B2D31)
                .addFields(
                    { name: '🔹 !meeting @giocatore', value: 'Invita un giocatore. Sponsor inclusi.' },
                    { name: '🛑 !fine', value: 'Chiude la chat.' },
                    { name: '👁️ !lettura', value: 'Supervisione. Sponsor inclusi.' },
                    { name: '🚪 !entrata', value: `Auto-ruolo (${isActive ? 'ON' : 'OFF'})` },
                    { name: '📋 !tabella [num]', value: 'Crea tabella iscrizioni.' },
                    { name: '🚀 !assegna', value: 'Assegna ruoli/stanze.' },
                    { name: '⚠️ !azzeramento', value: 'Reset conteggi meeting/lettura' },
                );
            return message.channel.send({ embeds: [embed] });
        }

        // !entrata
        if (content === '!entrata' && guildId === MEETING.COMMAND_GUILD && isAdm) {
            const newState = await db.meeting.toggleAutoRole();
            return message.reply(`🚪 Auto-Ruolo: ${newState ? "✅ ATTIVO" : "🛑 DISATTIVO"}.`);
        }

        // !azzeramento
        if (content === '!azzeramento' && guildId === MEETING.COMMAND_GUILD) {
            if (!member.roles.cache.has(MEETING.ROLE_RESET)) return message.reply("⛔ No permessi.");
            await db.meeting.resetCounts();
            return message.reply("♻️ Conteggi Meeting e Letture azzerati.");
        }

        // !tabella
        if (content.startsWith('!tabella') && guildId === MEETING.COMMAND_GUILD && isAdm) {
            const num = parseInt(content.split(' ')[1]);
            if (!num || num > 50) return message.reply("Specifica numero slot (max 50).");

            // Crea tabella in DB (atomico)
            await db.meeting.createTable(num, null);

            // Leggi per rendering
            const table = await db.meeting.getTable();
            const embed = new EmbedBuilder()
                .setTitle('📋 Iscrizione Giocatori & Sponsor')
                .setDescription(generateTableText(table))
                .setColor('Blue');

            const opts = Array.from({ length: num }, (_, i) => ({ label: `Numero ${i + 1}`, value: `${i}` }));
            const components = [];

            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('select_player').setPlaceholder('👤 Giocatori 1-25').addOptions(opts.slice(0, 25))
            ));
            if (num > 25) {
                components.push(new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('select_player_2').setPlaceholder(`👤 Giocatori 26-${num}`).addOptions(opts.slice(25, 50))
                ));
            }
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('select_sponsor').setPlaceholder('💰 Sponsor 1-25').addOptions(opts.slice(0, 25))
            ));
            if (num > 25) {
                components.push(new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('select_sponsor_2').setPlaceholder(`💰 Sponsor 26-${num}`).addOptions(opts.slice(25, 50))
                ));
            }
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('leave_game').setLabel('🏃 Abbandona Gioco').setStyle(ButtonStyle.Danger)
            ));

            const sentMsg = await message.channel.send({ embeds: [embed], components });

            // Aggiorna messageId via repository (atomico)
            await db.meeting.updateTableMessageId(sentMsg.id);
        }

        // !assegna
        if (content === '!assegna' && guildId === MEETING.COMMAND_GUILD && isAdm) {
            const table = await db.meeting.getTable();
            if (table.limit === 0) return message.reply("⚠️ Nessuna tabella attiva.");

            await message.reply("⏳ **Inizio configurazione...**");
            let assegnati = 0;

            for (let i = 0; i < table.limit; i++) {
                const slot = table.slots[i];
                const chName = `${i + 1}`;
                const channel = message.guild.channels.cache.find(c =>
                    c.parentId === MEETING.ROLE_CHAT_CAT && c.name === chName
                );
                if (!channel) continue;

                await channel.permissionOverwrites.set([
                    { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }
                ]);

                const perms = {
                    ViewChannel: true, SendMessages: true, ManageMessages: true,
                    CreatePrivateThreads: false, SendMessagesInThreads: false, CreatePublicThreads: false
                };
                const saluti = [];

                if (slot.player) {
                    await channel.permissionOverwrites.edit(slot.player, perms);
                    saluti.push(`<@${slot.player}>`);
                    try { (await message.guild.members.fetch(slot.player)).roles.add(MEETING.ROLE_PLAYER_AUTO); } catch {}
                }
                if (slot.sponsor) {
                    await channel.permissionOverwrites.edit(slot.sponsor, perms);
                    saluti.push(`<@${slot.sponsor}>`);
                    try { (await message.guild.members.fetch(slot.sponsor)).roles.add(MEETING.ROLE_SPONSOR_AUTO); } catch {}
                }
                if (saluti.length > 0) {
                    await channel.send(`${saluti.length === 1 ? 'Benvenuto' : 'Benvenuti'} ${saluti.join(' e ')}!`);
                }
                assegnati++;
            }

            // Salva gioco e pulisci tabella (atomico)
            await db.meeting.saveGameAndClearTable([...table.slots]);
            await message.channel.send(`✅ Stanze configurate: ${assegnati}`);
        }

        // !meeting
        if (content.startsWith('!meeting ') && guildId === MEETING.COMMAND_GUILD) {
            if (!member.roles.cache.has(MEETING.ROLE_PLAYER_AUTO)) return message.reply("❌ Solo Giocatori.");
            if (!member.roles.cache.has(MEETING.ROLE_MEETING_1) && !member.roles.cache.has(MEETING.ROLE_MEETING_2))
                return message.reply("⛔ Non autorizzato.");

            // Check atomici paralleli
            const [authorActive, authorCount] = await Promise.all([
                db.meeting.isUserActive(message.author.id),
                db.meeting.getMeetingCount(message.author.id),
            ]);

            if (authorActive) return message.reply("⚠️ Hai già una chat attiva!");
            if (authorCount >= MEETING.MAX_MEETINGS) return message.reply(`⚠️ Limite raggiunto (${MEETING.MAX_MEETINGS}).`);

            const userToInvite = message.mentions.users.first();
            if (!userToInvite || userToInvite.id === message.author.id) return message.reply("⚠️ Tagga un altro giocatore.");

            try {
                const target = await message.guild.members.fetch(userToInvite.id);
                const aP = member.roles.cache.has(MEETING.ROLE_PLAYER_AUTO);
                const tS = target.roles.cache.has(MEETING.ROLE_SPONSOR_AUTO);
                const aS = member.roles.cache.has(MEETING.ROLE_SPONSOR_AUTO);
                const tP = target.roles.cache.has(MEETING.ROLE_PLAYER_AUTO);
                if (aP && tS) return message.reply("⛔ Negato: Giocatore -> Sponsor.");
                if (aS && tP) return message.reply("⛔ Negato: Sponsor -> Giocatore.");
                if (aP && !tP) return message.reply("⛔ Puoi invitare solo altri Giocatori.");
            } catch {}

            const guestActive = await db.meeting.isUserActive(userToInvite.id);
            if (guestActive) return message.reply(`⚠️ ${userToInvite} è impegnato.`);

            const proposalMsg = await message.channel.send(
                `🔔 **Richiesta Meeting**\n👤 **Ospite:** ${userToInvite}\n📩 **Da:** ${message.author}\n\n*Reagisci ✅/❌*`
            );
            await Promise.all([proposalMsg.react('✅'), proposalMsg.react('❌')]);

            const collector = proposalMsg.createReactionCollector({
                filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === userToInvite.id,
                time: 3 * 60 * 60 * 1000, max: 1
            });

            collector.on('collect', async (reaction) => {
                if (reaction.emoji.name !== '✅') return reaction.message.reply("❌ Rifiutata.");

                // Re-check atomico fresco (parallelo)
                const [aActive, gActive, cA, cG] = await Promise.all([
                    db.meeting.isUserActive(message.author.id),
                    db.meeting.isUserActive(userToInvite.id),
                    db.meeting.getMeetingCount(message.author.id),
                    db.meeting.getMeetingCount(userToInvite.id),
                ]);

                if (aActive || gActive) return reaction.message.reply("❌ Occupato.");
                if (cA >= MEETING.MAX_MEETINGS || cG >= MEETING.MAX_MEETINGS)
                    return reaction.message.reply("❌ Token finiti.");

                const [sponsorA, sponsorB] = await Promise.all([
                    db.meeting.findSponsor(message.author.id),
                    db.meeting.findSponsor(userToInvite.id),
                ]);

                // SCRITTURE ATOMICHE in parallelo
                await Promise.all([
                    db.meeting.incrementMeetingCount(message.author.id),
                    db.meeting.incrementMeetingCount(userToInvite.id),
                    db.meeting.addActiveUsers([message.author.id, userToInvite.id]),
                ]);

                try {
                    const targetGuild = client.guilds.cache.get(MEETING.TARGET_GUILD);
                    const permissions = [
                        { id: targetGuild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], deny: [PermissionsBitField.Flags.CreatePublicThreads, PermissionsBitField.Flags.CreatePrivateThreads] },
                        { id: userToInvite.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], deny: [PermissionsBitField.Flags.CreatePublicThreads, PermissionsBitField.Flags.CreatePrivateThreads] },
                    ];
                    if (sponsorA) permissions.push({ id: sponsorA, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], deny: [PermissionsBitField.Flags.CreatePublicThreads, PermissionsBitField.Flags.CreatePrivateThreads] });
                    if (sponsorB) permissions.push({ id: sponsorB, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages], deny: [PermissionsBitField.Flags.CreatePublicThreads, PermissionsBitField.Flags.CreatePrivateThreads] });

                    const newChannel = await targetGuild.channels.create({
                        name: `meeting-${message.author.username}-${userToInvite.username}`,
                        type: ChannelType.GuildText, parent: MEETING.TARGET_CAT, permissionOverwrites: permissions,
                    });

                    let pText = `${message.author} e ${userToInvite}`;
                    if (sponsorA) pText += ` (Sponsor: <@${sponsorA}>)`;
                    if (sponsorB) pText += ` (Sponsor: <@${sponsorB}>)`;

                    const welcomeEmbed = new EmbedBuilder().setTitle("👋 Meeting Avviato").setDescription("Scrivete **!fine** per chiudere.").setColor(0x00FFFF);
                    await newChannel.send({ content: `🔔 Benvenuti: ${pText}`, embeds: [welcomeEmbed] });

                    const logEmbed = new EmbedBuilder().setTitle('📂 Meeting Avviato').setColor(0x00FF00)
                        .setDescription(`**Autore:** ${message.author.tag}\n**Ospite:** ${userToInvite.tag}\nℹ️ **!lettura** per osservare.`)
                        .setFooter({ text: `ID:${newChannel.id}` });

                    await reaction.message.reply({
                        content: `✅ Meeting creato!\n👤 ${message.author.username}: **${cA + 1}/${MEETING.MAX_MEETINGS}**\n👤 ${userToInvite.username}: **${cG + 1}/${MEETING.MAX_MEETINGS}**`,
                        embeds: [logEmbed]
                    });
                    reaction.message.channel.messages.cache.delete(reaction.message.id);

                } catch (e) {
                    console.error("Errore creazione meeting:", e);
                    // Rollback atomico
                    await db.meeting.removeActiveUsers([message.author.id, userToInvite.id]);
                }
            });
            collector.on('end', () => {});
        }

        // !lettura
        if (content === '!lettura' && guildId === MEETING.COMMAND_GUILD) {
            if (!message.reference) return message.reply("⚠️ Rispondi al messaggio verde.");
            if (!member.roles.cache.has(MEETING.ROLE_PLAYER_AUTO)) return message.reply("❌ Accesso Negato.");

            const curRead = await db.meeting.getLetturaCount(message.author.id);
            if (curRead >= MEETING.MAX_READINGS) return message.reply("⛔ Limite supervisioni raggiunto.");

            try {
                const replied = await message.channel.messages.fetch(message.reference.messageId);
                const tEmbed = replied.embeds[0];
                if (tEmbed.fields.some(f => f.name === '👮 Supervisore')) return message.reply("⛔ Supervisore già presente.");

                const chId = tEmbed.footer?.text.match(/ID:(\d+)/)?.[1];
                const tGuild = client.guilds.cache.get(MEETING.TARGET_GUILD);
                const tChannel = await tGuild.channels.fetch(chId).catch(() => null);
                if (!tChannel) return message.reply("❌ Canale inesistente.");
                if (tChannel.permissionOverwrites.cache.has(message.author.id)) return message.reply("⚠️ Sei già dentro.");

                const sponsorSup = await db.meeting.findSponsor(message.author.id);
                const readPerms = { ViewChannel: true, SendMessages: false, CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: false };

                // Permessi + contatore in parallelo (atomici)
                const ops = [
                    tChannel.permissionOverwrites.create(message.author.id, readPerms),
                    db.meeting.incrementLetturaCount(message.author.id),
                ];
                if (sponsorSup) ops.push(tChannel.permissionOverwrites.create(sponsorSup, readPerms));
                await Promise.all(ops);

                let notifMsg = sponsorSup ? `${message.author} e Sponsor <@${sponsorSup}> osservano.` : `${message.author} osserva.`;
                const participants = tChannel.permissionOverwrites.cache
                    .filter(o => ![client.user.id, message.author.id, tGuild.id, sponsorSup].includes(o.id))
                    .map(o => `<@${o.id}>`).join(' ');
                await tChannel.send(`⚠️ ATTENZIONE ${participants}: ${notifMsg}`);

                const newEmbed = EmbedBuilder.from(tEmbed).setColor(0xFFA500)
                    .spliceFields(0, 1, { name: 'Stato', value: '🟠 Supervisionato', inline: true })
                    .addFields({ name: '👮 Supervisore', value: notifMsg, inline: true });
                await replied.edit({ embeds: [newEmbed] });
                message.reply("👁️ **Accesso Garantito.**");
                message.channel.messages.cache.delete(replied.id);
            } catch (e) { console.error(e); message.reply("❌ Errore tecnico."); }
        }

        // !fine
        if (content === '!fine' && guildId === MEETING.TARGET_GUILD) {
            if (!message.channel.name.startsWith('meeting-')) return;

            // Raccogli IDs e rimuovi atomicamente
            const usersInCh = message.channel.members.map(m => m.id);
            await db.meeting.removeActiveUsers(usersInCh);

            await message.channel.send("🛑 **Chat Chiusa.**");
            const lockOps = [];
            message.channel.permissionOverwrites.cache.forEach((ow) => {
                if (ow.id !== client.user.id) {
                    lockOps.push(message.channel.permissionOverwrites.edit(ow.id, { SendMessages: false, AddReactions: false }));
                }
            });
            await Promise.all(lockOps);
        }
    });

    // --- INTERAZIONI (Tabella) ---
    client.on('interactionCreate', async interaction => {
        // Selezione slot giocatore/sponsor
        if (interaction.isStringSelectMenu() && (interaction.customId.startsWith('select_player') || interaction.customId.startsWith('select_sponsor'))) {
            const slotIndex = parseInt(interaction.values[0]);
            const type = interaction.customId.startsWith('select_player') ? 'player' : 'sponsor';

            const result = await db.meeting.setSlot(slotIndex, type, interaction.user.id);

            if (result === null) return interaction.reply({ content: "⛔ Tabella chiusa.", ephemeral: true });
            if (result === 'OCCUPIED') return interaction.reply({ content: "❌ Posto occupato!", ephemeral: true });

            // result = tabella aggiornata
            await interaction.update({
                embeds: [new EmbedBuilder(interaction.message.embeds[0]).setDescription(generateTableText(result))]
            });
        }

        // Bottone abbandona
        if (interaction.isButton() && interaction.customId === 'leave_game') {
            const result = await db.meeting.removeFromSlots(interaction.user.id);

            if (result === null) return interaction.reply({ content: "⛔ Tabella chiusa o non eri iscritto.", ephemeral: true });

            await interaction.update({
                embeds: [new EmbedBuilder(interaction.message.embeds[0]).setDescription(generateTableText(result))]
            });
        }
    });
};
