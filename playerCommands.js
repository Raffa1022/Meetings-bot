// ==========================================
// 👤 COMANDI GIOCATORE HOUSING
// bussa, torna, trasferimento, chi, rimaste, cambio, rimuovi
// ==========================================
const {
    ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    EmbedBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType
} = require('discord.js');
const { HOUSING, RUOLI, RUOLI_PERMESSI, RUOLI_PUBBLICI, PREFIX } = require('./config');
const db = require('./db');
const eventBus = require('./eventBus');
const { movePlayer, cleanOldHome } = require('./playerMovement');
const { isAdmin, formatName, isVisitingOtherHouse, sendTemp } = require('./helpers');

module.exports = function registerPlayerCommands(client) {

    client.on('messageCreate', async message => {
        if (message.author.bot || !message.content.startsWith(PREFIX)) return;
        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // ===================== TORNA =====================
        if (command === 'torna') {
            message.delete().catch(() => {});
            if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE) return;

            // Sponsor non possono
            if (message.member.roles.cache.has(RUOLI.SPONSOR)) {
                return message.channel.send("⛔ Gli sponsor non possono usare il comando !torna.");
            }

            const homeId = await db.housing.getHome(message.author.id);
            if (!homeId) return message.channel.send("❌ **Non hai una casa!**");

            const destroyed = await db.housing.getDestroyedHouses();
            if (destroyed.includes(homeId)) return message.channel.send("🏚️ **Casa distrutta!**");

            const homeChannel = message.guild.channels.cache.get(homeId);
            if (!homeChannel) return message.channel.send("❌ Errore casa.");

            if (!isVisitingOtherHouse(message.guild, message.author.id, homeId))
                return message.channel.send("🏠 Sei già a casa.");

            // Controllo coda: utente ha già azione pendente?
            const myPending = await db.queue.getUserPending(message.author.id);
            if (myPending) {
                const t = myPending.type === 'KNOCK' ? 'bussa' : 'torna';
                return message.channel.send(`⚠️ Hai già un'azione "${t}" in corso! Usa \`!rimuovi\` per annullarla.`);
            }

            // Controllo: altri nella stessa chat hanno azioni in corso?
            const others = message.channel.members.filter(m => !m.user.bot && m.id !== message.author.id);
            for (const [memberId, member] of others) {
                const otherPending = await db.queue.getUserPending(memberId);
                if (otherPending) {
                    return message.channel.send(`⚠️ C'è già un'azione in corso in questa chat. Attendi che ${member} completi la sua azione.`);
                }
            }

            // Aggiungi alla coda tramite EventBus
            eventBus.emit('queue:add', {
                type: 'RETURN',
                userId: message.author.id,
                details: { fromChannelId: message.channel.id }
            });
            await message.channel.send("⏳ **Azione Torna** messa in coda. Attendi...");
        }

        // ===================== BUSSA =====================
        else if (command === 'bussa') {
            message.delete().catch(() => {});
            if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
                return message.channel.send("⛔ Solo chat private!");

            if (message.member.roles.cache.has(RUOLI.SPONSOR))
                return message.channel.send("⛔ Gli sponsor non possono usare il comando !bussa.");

            // Controllo coda
            const myPending = await db.queue.getUserPending(message.author.id);
            if (myPending) {
                await db.housing.removePendingKnock(message.author.id);
                const t = myPending.type === 'KNOCK' ? 'bussa' : 'torna';
                return message.channel.send(`⚠️ Hai già un'azione "${t}" in corso! Usa \`!rimuovi\` per annullarla.`);
            }

            // Controllo altri nella chat
            const others = message.channel.members.filter(m => !m.user.bot && m.id !== message.author.id);
            for (const [memberId, member] of others) {
                const otherPending = await db.queue.getUserPending(memberId);
                if (otherPending) {
                    return message.channel.send(`⚠️ C'è già un'azione in corso in questa chat. Attendi che ${member} completi la sua azione.`);
                }
            }

            // Controllo pending knock
            const isPending = await db.housing.isPendingKnock(message.author.id);
            if (isPending) return message.channel.send(`${message.author}, stai già bussando!`);

            await db.housing.addPendingKnock(message.author.id);

            const selectMode = new StringSelectMenuBuilder()
                .setCustomId('knock_mode_select')
                .setPlaceholder('Come vuoi entrare?')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Visita Normale').setValue('mode_normal').setEmoji('👋'),
                    new StringSelectMenuOptionBuilder().setLabel('Visita Forzata').setValue('mode_forced').setEmoji('🧨'),
                    new StringSelectMenuOptionBuilder().setLabel('Visita Nascosta').setValue('mode_hidden').setEmoji('🕵️'),
                );

            const closeBtn = new ButtonBuilder()
                .setCustomId('knock_close')
                .setLabel('Chiudi').setStyle(ButtonStyle.Danger).setEmoji('❌');

            const menuMsg = await message.channel.send({
                content: `🎭 **${message.author}, scegli la modalità di visita:**`,
                components: [
                    new ActionRowBuilder().addComponents(selectMode),
                    new ActionRowBuilder().addComponents(closeBtn),
                ]
            });

            setTimeout(async () => {
                menuMsg.delete().catch(() => {});
                await db.housing.removePendingKnock(message.author.id);
            }, 60000);
        }

        // ===================== TRASFERIMENTO =====================
        else if (command === 'trasferimento') {
            if (message.channel.parentId !== HOUSING.CATEGORIA_CASE) return message.delete().catch(() => {});
            if (message.member.roles.cache.has(RUOLI.SPONSOR))
                return sendTemp(message.channel, "⛔ Gli sponsor non possono usare il comando !trasferimento.");
            if (!message.member.roles.cache.has(RUOLI.ALIVE))
                return sendTemp(message.channel, "⛔ Non hai il ruolo.");

            const newHomeChannel = message.channel;
            const ownerId = await db.housing.findOwner(newHomeChannel.id);

            if (ownerId === message.author.id)
                return message.reply("❌ Sei già a casa tua, non puoi trasferirti qui!");

            if (!ownerId) {
                // Casa senza proprietario
                await cleanOldHome(message.author.id, message.guild);
                await db.housing.setHome(message.author.id, newHomeChannel.id);
                await newHomeChannel.permissionOverwrites.edit(message.author.id, { ViewChannel: true, SendMessages: true });
                const pinnedMsg = await newHomeChannel.send(`🔑 **${message.author}**, questa è la tua dimora privata.`);
                await pinnedMsg.pin();
                return message.reply("✅ Trasferimento completato!");
            }

            const owner = message.guild.members.cache.get(ownerId);
            if (!owner) return message.channel.send("❌ Proprietario non trovato.");

            const confirmEmbed = new EmbedBuilder()
                .setTitle("Richiesta di Trasferimento 📦")
                .setDescription(`${message.author} vuole trasferirsi qui.\nAccetti?`)
                .setColor('Blue');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`transfer_yes_${message.author.id}`).setLabel('Accetta ✅').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`transfer_no_${message.author.id}`).setLabel('Rifiuta ❌').setStyle(ButtonStyle.Danger),
            );

            const isOwnerHome = newHomeChannel.permissionsFor(owner).has(PermissionsBitField.Flags.ViewChannel);
            let msg;
            if (isOwnerHome) {
                msg = await newHomeChannel.send({ content: `🔔 Richiesta <@${owner.id}>`, embeds: [confirmEmbed], components: [row] });
            } else {
                const privateCat = message.guild.channels.cache.get(HOUSING.CATEGORIA_CHAT_PRIVATE);
                const ownerPM = privateCat?.children.cache.find(c =>
                    c.type === ChannelType.GuildText && c.permissionsFor(owner).has(PermissionsBitField.Flags.ViewChannel)
                );
                if (ownerPM) {
                    msg = await ownerPM.send({ content: `🔔 Richiesta Trasferimento <@${owner.id}>`, embeds: [confirmEmbed], components: [row] });
                    message.channel.send("📩 Richiesta inviata in privato.");
                } else {
                    return message.channel.send("❌ Proprietario non raggiungibile.");
                }
            }

            const collector = msg.createMessageComponentCollector({ filter: i => i.user.id === owner.id, max: 1, time: 300000 });
            collector.on('collect', async i => {
                if (i.customId === `transfer_yes_${message.author.id}`) {
                    await i.update({ content: "✅ Accettato!", embeds: [], components: [] });
                    await cleanOldHome(message.author.id, message.guild);
                    await db.housing.setHome(message.author.id, newHomeChannel.id);
                    await newHomeChannel.permissionOverwrites.edit(message.author.id, { ViewChannel: true, SendMessages: true });
                    const newKeyMsg = await newHomeChannel.send(`🔑 ${message.author}, dimora assegnata (Comproprietario).`);
                    await newKeyMsg.pin();
                } else {
                    await i.update({ content: "❌ Rifiutato.", embeds: [], components: [] });
                }
            });
            collector.on('end', () => {}); // Cleanup
        }

        // ===================== CHI =====================
        else if (command === 'chi') {
            message.delete().catch(() => {});
            let targetChannel = null;

            if (isAdmin(message.member) && message.mentions.channels.size > 0) {
                targetChannel = message.mentions.channels.first();
            } else if (message.channel.parentId === HOUSING.CATEGORIA_CASE) {
                targetChannel = message.channel;
            }

            if (!targetChannel || targetChannel.parentId !== HOUSING.CATEGORIA_CASE)
                return sendTemp(message.channel, "⛔ Devi essere in una casa o (se admin) specificare una casa valida.");

            const allHomes = await db.housing.getAllHomes();
            const ownerIds = Object.keys(allHomes).filter(k => allHomes[k] === targetChannel.id);
            const ownerMention = ownerIds.length > 0 ? ownerIds.map(id => `<@${id}>`).join(', ') : "Nessuno";

            const players = targetChannel.members.filter(m =>
                !m.user.bot && m.roles.cache.has(RUOLI.ALIVE) &&
                targetChannel.permissionOverwrites.cache.has(m.id)
            );
            const desc = players.size > 0 ? players.map(p => `👤 ${p}`).join('\n') : "Nessuno.";

            const embed = new EmbedBuilder()
                .setTitle("👥 Persone in casa")
                .setDescription(desc)
                .addFields({ name: '🔑 Proprietario', value: ownerMention });

            const sentMsg = await message.channel.send({ embeds: [embed] });
            setTimeout(() => sentMsg.delete().catch(() => {}), 300000);
        }

        // ===================== RIMASTE =====================
        else if (command === 'rimaste') {
            message.delete().catch(() => {});
            if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE)
                return sendTemp(message.channel, "⛔ Solo chat private!");

            if (!message.member.roles.cache.hasAny(...RUOLI_PERMESSI)) return;

            const info = await db.housing.getVisitInfo(message.author.id);
            if (!info) return;

            const modeStr = info.mode === 'DAY' ? "☀️ GIORNO" : "🌙 NOTTE";
            sendTemp(message.channel,
                `📊 **Le tue visite (${modeStr}):**\n🏠 Normali: ${info.used}/${info.totalLimit}\n🧨 Forzate: ${info.forced}\n🕵️ Nascoste: ${info.hidden}`,
                30000
            );
        }

        // ===================== RIMUOVI =====================
        else if (command === 'rimuovi') {
            message.delete().catch(() => {});
            if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE) return;

            const options = [];
            const isPending = await db.housing.isPendingKnock(message.author.id);
            const queueItems = await db.queue.getUserAllPending(message.author.id);

            if (isPending) {
                options.push(new StringSelectMenuOptionBuilder()
                    .setLabel('Annulla selezione casa (Bussa)').setValue('remove_selecting')
                    .setEmoji('🚫').setDescription('Annulla il menu di selezione casa attuale'));
            }

            for (const item of queueItems) {
                if (item.type === 'KNOCK') {
                    options.push(new StringSelectMenuOptionBuilder()
                        .setLabel('Rimuovi Bussa dalla coda').setValue('remove_knock')
                        .setEmoji('🚪').setDescription('Annulla la visita in attesa'));
                } else if (item.type === 'RETURN') {
                    options.push(new StringSelectMenuOptionBuilder()
                        .setLabel('Rimuovi Torna dalla coda').setValue('remove_return')
                        .setEmoji('🏠').setDescription('Annulla il ritorno a casa'));
                } else if (item.type === 'ABILITY') {
                    options.push(new StringSelectMenuOptionBuilder()
                        .setLabel('Rimuovi Abilità dalla coda').setValue('remove_ability')
                        .setEmoji('✨').setDescription("Annulla l'abilità in attesa"));
                }
            }

            if (options.length === 0)
                return sendTemp(message.channel, "❌ Non hai nessuna azione in corso da rimuovere!");

            const menu = new StringSelectMenuBuilder()
                .setCustomId('remove_action_select')
                .setPlaceholder('Cosa vuoi rimuovere?')
                .addOptions(options);

            const menuMsg = await message.channel.send({
                content: '🗑️ **Seleziona cosa vuoi rimuovere:**',
                components: [new ActionRowBuilder().addComponents(menu)]
            });
            setTimeout(() => menuMsg.delete().catch(() => {}), 60000);
        }

        // ===================== CAMBIO =====================
        else if (command === 'cambio') {
            if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE) return;

            const R1 = RUOLI.ALIVE, R2 = RUOLI.SPONSOR;
            const admin = isAdmin(message.member);
            const hasR1 = message.member.roles.cache.has(R1);
            const hasR2 = message.member.roles.cache.has(R2);

            if (!admin && !hasR1 && !hasR2) return message.reply("⛔ Non hai i permessi.");

            const members = message.channel.members.filter(m => !m.user.bot);
            const player1 = members.find(m => m.roles.cache.has(R1));
            const player2 = members.find(m => m.roles.cache.has(R2));
            if (!player1 || !player2)
                return message.reply("❌ Non trovo entrambi i giocatori con i ruoli necessari.");

            if (!admin && message.member.id !== player1.id && message.member.id !== player2.id)
                return message.reply("⛔ Non sei coinvolto in questo scambio.");

            const performSwap = async () => {
                try {
                    // Cancella azioni pendenti di player1 (che diventerà sponsor)
                    const pendingCmds = await db.queue.getUserPending(player1.id);
                    if (pendingCmds) {
                        await db.queue.deleteUserPendingActions(player1.id);
                        await db.housing.removePendingKnock(player1.id);
                        await message.channel.send(`⚠️ I comandi pendenti di ${player1} sono stati cancellati prima dello scambio.`);
                    }

                    // Swap housing + meeting + ruoli in parallelo
                    await Promise.all([
                        db.housing.swapPlayerData(player1.id, player2.id),
                        db.meeting.swapMeetingData(player1.id, player2.id),
                        player1.roles.remove(R1), player1.roles.add(R2),
                        player2.roles.remove(R2), player2.roles.add(R1),
                    ]);

                    message.channel.send(`✅ **Scambio Completato!**\n👤 ${player1} ora ha il ruolo <@&${R2}>.\n👤 ${player2} ora ha il ruolo <@&${R1}>.`);
                } catch (error) {
                    console.error("❌ Errore cambio:", error);
                    message.channel.send("❌ Si è verificato un errore critico durante lo scambio.");
                }
            };

            // Se è lo sponsor a richiedere → serve accettazione
            if (message.member.id === player2.id && !admin) {
                const reqMsg = await message.channel.send(
                    `🔄 **${player2}** ha richiesto lo scambio identità.\n${player1}, reagisci con ✅ per accettare o ❌ per rifiutare.`
                );
                await reqMsg.react('✅');
                await reqMsg.react('❌');

                const collector = reqMsg.createReactionCollector({
                    filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === player1.id,
                    max: 1, time: 300000
                });

                collector.on('collect', async (reaction) => {
                    if (reaction.emoji.name === '❌') {
                        await reqMsg.edit(`${reqMsg.content}\n\n❌ **Scambio rifiutato da ${player1}.**`);
                        setTimeout(() => reqMsg.delete().catch(() => {}), 10000);
                        return;
                    }
                    await reqMsg.edit(`${reqMsg.content}\n\n✅ **Scambio accettato! Procedura in corso...**`);
                    await performSwap();
                    setTimeout(() => reqMsg.delete().catch(() => {}), 15000);
                });
                collector.on('end', () => {});
                return;
            }

            // Player1 o admin → scambio immediato
            message.channel.send("🔄 **Inizio procedura di scambio identità...**");
            await performSwap();
        }
    });
};
