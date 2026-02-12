// ==========================================
// 👤 COMANDI GIOCATORE HOUSING
// bussa, torna, trasferimento, chi, rimaste, cambio, rimuovi, preset
// ==========================================
const {
    ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    EmbedBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType
} = require('discord.js');
const { HOUSING, RUOLI, RUOLI_PERMESSI, RUOLI_PUBBLICI, PREFIX } = require('./config');
const db = require('./db');
const eventBus = require('./eventBus');
const { movePlayer, cleanOldHome } = require('./playerMovement');
const { isAdmin, formatName, isVisitingOtherHouse, sendTemp, getSponsorsToMove } = require('./helpers');

// 🔧 Stato trasferimenti (globale, toggle admin)
let trasferimentiEnabled = true;

module.exports = function registerPlayerCommands(client) {

    client.on('messageCreate', async message => {
        if (message.author.bot || !message.content.startsWith(PREFIX)) return;
        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // ===================== TORNA =====================
        if (command === 'torna') {
            message.delete().catch(() => {});
            if (message.channel.parentId !== HOUSING.CATEGORIA_CHAT_PRIVATE) return;

            // ✅ BLOCCO PRESET PHASE
            const isPresetPhase = await db.moderation.isPresetPhaseActive();
            if (isPresetPhase) {
                return message.channel.send("🔒 **Fase Preset attiva!** Non puoi usare !torna fino al comando `!fine preset`.");
            }

            // Sponsor non possono
            if (message.member.roles.cache.has(RUOLI.SPONSOR) || message.member.roles.cache.has(RUOLI.SPONSOR_DEAD)) {
                return message.channel.send("⛔ Gli sponsor non possono usare il comando !torna.");
            }

            // Check Visitblock
            const isVB = await db.moderation.isBlockedVB(message.author.id);
            if (isVB) return message.channel.send("🚫 Sei in **Visitblock**! Non puoi usare !torna.");

            const homeId = await db.housing.getHome(message.author.id);
            if (!homeId) return message.channel.send("❌ **Non hai una casa!**");

            const destroyed = await db.housing.getDestroyedHouses();
            if (destroyed.includes(homeId)) return message.channel.send("🏚️ **Casa distrutta!**");

            const homeChannel = message.guild.channels.cache.get(homeId);
            if (!homeChannel) return message.channel.send("❌ Errore casa.");

            const currentHouse = message.guild.channels.cache.find(c =>
                c.parentId === HOUSING.CATEGORIA_CASE &&
                c.type === ChannelType.GuildText &&
                c.permissionOverwrites.cache.has(message.author.id)
            );

            if (!currentHouse) {
                return message.channel.send("🏠 Non sei in nessuna casa! Non puoi usare !torna.");
            }
            
            if (currentHouse.id === homeId) {
                return message.channel.send("🏠 Sei già nella tua casa! Non puoi usare !torna.");
            }

            const activeKnock = await db.housing.getActiveKnock(message.author.id);
            if (activeKnock) {
                return message.channel.send("⚠️ Hai una bussata in attesa di risposta! Non puoi usare !torna finché non viene risolta.");
            }

            const myPending = await db.queue.getUserPending(message.author.id);
            if (myPending) {
                const t = myPending.type === 'KNOCK' ? 'bussa' : 'torna';
                return message.channel.send(`⚠️ Hai già un'azione "${t}" in corso! Usa \`!rimuovi\` per annullarla.`);
            }

            const others = message.channel.members.filter(m => !m.user.bot && m.id !== message.author.id);
            for (const [memberId, member] of others) {
                const otherPending = await db.queue.getUserPending(memberId);
                if (otherPending) {
                    return message.channel.send(`⚠️ C'è già un'azione in corso in questa chat. Attendi che ${member} completi la sua azione.`);
                }
            }

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

            // ✅ BLOCCO PRESET PHASE
            const isPresetPhase = await db.moderation.isPresetPhaseActive();
            if (isPresetPhase) {
                return message.channel.send("🔒 **Fase Preset attiva!** Non puoi usare !bussa fino al comando `!fine preset`.");
            }

            if (message.member.roles.cache.has(RUOLI.SPONSOR) || message.member.roles.cache.has(RUOLI.SPONSOR_DEAD))
                return message.channel.send("⛔ Gli sponsor non possono usare il comando !bussa.");

            const isVBBussa = await db.moderation.isBlockedVB(message.author.id);
            if (isVBBussa) return message.channel.send("🚫 Sei in **Visitblock**! Non puoi usare !bussa.");

            const activeKnock = await db.housing.getActiveKnock(message.author.id);
            if (activeKnock) {
                return message.channel.send("⚠️ Hai già una bussata in attesa di risposta! Non puoi bussare di nuovo finché non viene risolta.");
            }

            const myPending = await db.queue.getUserPending(message.author.id);
            if (myPending) {
                await db.housing.removePendingKnock(message.author.id);
                const t = myPending.type === 'KNOCK' ? 'bussa' : 'torna';
                return message.channel.send(`⚠️ Hai già un'azione "${t}" in corso! Usa \`!rimuovi\` per annullarla.`);
            }

            const others = message.channel.members.filter(m => !m.user.bot && m.id !== message.author.id);
            for (const [memberId, member] of others) {
                const otherPending = await db.queue.getUserPending(memberId);
                if (otherPending) {
                    return message.channel.send(`⚠️ C'è già un'azione in corso in questa chat. Attendi che ${member} completi la sua azione.`);
                }
            }

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
            if (isAdmin(message.member)) {
                const toggle = args[0]?.toLowerCase();
                if (toggle === 'si' || toggle === 'sì' || toggle === 'yes') {
                    trasferimentiEnabled = true;
                    return message.reply("✅ **Trasferimenti ABILITATI.**");
                } else if (toggle === 'no') {
                    trasferimentiEnabled = false;
                    return message.reply("🚫 **Trasferimenti DISABILITATI.**");
                }
            }

            if (!trasferimentiEnabled && !isAdmin(message.member)) {
                return message.reply("🚫 **I trasferimenti sono disabilitati.**");
            }

            if (message.channel.parentId !== HOUSING.CATEGORIA_CASE) return message.delete().catch(() => {});
            if (message.member.roles.cache.has(RUOLI.SPONSOR) || message.member.roles.cache.has(RUOLI.SPONSOR_DEAD))
                return sendTemp(message.channel, "⛔ Gli sponsor non possono usare il comando !trasferimento.");
            if (!message.member.roles.cache.has(RUOLI.ALIVE))
                return sendTemp(message.channel, "⛔ Non hai il ruolo.");

            const newHomeChannel = message.channel;
            const ownerId = await db.housing.findOwner(newHomeChannel.id);

            if (ownerId === message.author.id)
                return message.reply("❌ Sei già a casa tua!");

            if (!ownerId) {
                const sponsors = await getSponsorsToMove(message.member, message.guild);
                await cleanOldHome(message.author.id, message.guild);
                for (const s of sponsors) await cleanOldHome(s.id, message.guild);
                
                await db.housing.setHome(message.author.id, newHomeChannel.id);
                for (const s of sponsors) await db.housing.setHome(s.id, newHomeChannel.id);
                
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
                    const sponsors = await getSponsorsToMove(message.member, message.guild);
                    await cleanOldHome(message.author.id, message.guild);
                    for (const s of sponsors) await cleanOldHome(s.id, message.guild);
                    await db.housing.setHome(message.author.id, newHomeChannel.id);
                    for (const s of sponsors) await db.housing.setHome(s.id, newHomeChannel.id);
                    await newHomeChannel.permissionOverwrites.edit(message.author.id, { ViewChannel: true, SendMessages: true });
                    const newKeyMsg = await newHomeChannel.send(`🔑 ${message.author}, dimora assegnata (Comproprietario).`);
                    await newKeyMsg.pin();
                } else {
                    await i.update({ content: "❌ Rifiutato.", embeds: [], components: [] });
                }
            });
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
            const ownerIds = [];
            for (const userId of Object.keys(allHomes)) {
                if (allHomes[userId] !== targetChannel.id) continue;
                try {
                    const member = await message.guild.members.fetch(userId);
                    if (member.roles.cache.has(RUOLI.ALIVE) && 
                        !member.roles.cache.has(RUOLI.SPONSOR) &&
                        targetChannel.permissionOverwrites.cache.has(userId)) {
                        ownerIds.push(userId);
                    }
                } catch {}
            }
            
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

            if (!message.member.roles.cache.hasAny(...RUOLI_PERMESSI, RUOLI.DEAD, RUOLI.SPONSOR_DEAD)) return;

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

            const R1 = RUOLI.ALIVE, R2 = RUOLI.SPONSOR, R3 = RUOLI.DEAD, R4 = RUOLI.SPONSOR_DEAD;
            const admin = isAdmin(message.member);
            const hasR1 = message.member.roles.cache.has(R1);
            const hasR2 = message.member.roles.cache.has(R2);
            const hasR3 = message.member.roles.cache.has(R3);
            const hasR4 = message.member.roles.cache.has(R4);

            if (!admin && !hasR1 && !hasR2 && !hasR3 && !hasR4) return message.reply("⛔ Non hai i permessi.");

            const members = message.channel.members.filter(m => !m.user.bot);
            
            let player1 = members.find(m => m.roles.cache.has(R1));
            let player2 = members.find(m => m.roles.cache.has(R2));
            let usingDeadRoles = false;
            
            if (!player1 || !player2) {
                player1 = members.find(m => m.roles.cache.has(R3));
                player2 = members.find(m => m.roles.cache.has(R4));
                usingDeadRoles = true;
            }
            
            if (!player1 || !player2)
                return message.reply("❌ Non trovo entrambi i giocatori con i ruoli necessari.");

            if (!admin && message.member.id !== player1.id && message.member.id !== player2.id)
                return message.reply("⛔ Non sei coinvolto in questo scambio.");

            const performSwap = async () => {
                try {
                    const pendingCmds = await db.queue.getUserPending(player1.id);
                    if (pendingCmds) {
                        await db.queue.deleteUserPendingActions(player1.id);
                        await db.housing.removePendingKnock(player1.id);
                        await message.channel.send(`⚠️ I comandi pendenti di ${player1} sono stati cancellati prima dello scambio.`);
                    }

                    const { econDb } = require('./economySystem');

                    const role1 = usingDeadRoles ? R3 : R1;
                    const role2 = usingDeadRoles ? R4 : R2;
                    
                    await Promise.all([
                        db.housing.swapPlayerData(player1.id, player2.id),
                        db.meeting.swapMeetingData(player1.id, player2.id),
                        econDb.swapEconomyData(player1.id, player2.id),
                        player1.roles.remove(role1), player1.roles.add(role2),
                        player2.roles.remove(role2), player2.roles.add(role1),
                    ]);

                    message.channel.send(`✅ **Scambio Completato!**\n👤 ${player1} ora ha il ruolo <@&${role2}>.\n👤 ${player2} ora ha il ruolo <@&${role1}>.\n🪙 Bilancio e inventario scambiati.`);
                } catch (error) {
                    console.error("❌ Errore cambio:", error);
                    message.channel.send("❌ Si è verificato un errore critico durante lo scambio.");
                }
            };

            if ((message.member.id === player2.id) && !admin) {
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
                return;
            }

            message.channel.send("🔄 **Inizio procedura di scambio identità...**");
            await performSwap();
        }

        // ===================== CASE =====================
        else if (command === 'case') {
            const canUse = message.member.roles.cache.hasAny(RUOLI.ALIVE, RUOLI.SPONSOR, RUOLI.DEAD, RUOLI.SPONSOR_DEAD) || isAdmin(message.member);
            if (!canUse) return message.reply("⛔ Non hai i permessi.");

            const destroyed = await db.housing.getDestroyedHouses();
            if (destroyed.length === 0) {
                return message.reply("✅ Nessuna casa è stata distrutta al momento.");
            }

            // Recupero i metadati delle case distrutte
            const destroyedData = await db.housing.getDestroyedHousesData();

            // Ordino le case per numero estratto dal nome
            const sortedDestroyed = destroyed
                .map(id => {
                    const ch = message.guild.channels.cache.get(id);
                    const match = ch?.name.match(/casa-(\d+)/);
                    const number = match ? parseInt(match[1]) : 999999;
                    const phaseInfo = destroyedData[id];
                    return { id, ch, number, phaseInfo };
                })
                .sort((a, b) => a.number - b.number);

            const list = sortedDestroyed.map(({ ch, id, phaseInfo }) => {
                const houseName = ch ? formatName(ch.name) : `ID: ${id} (canale non trovato)`;
                const phaseText = phaseInfo?.phase ? ` - ${phaseInfo.phase}` : '';
                return `🏚️ ${ch || houseName} (${houseName})${phaseText}`;
            }).join('\n');

            const embed = new EmbedBuilder()
                .setTitle('🏚️ Case Distrutte')
                .setDescription(list)
                .setColor('Red')
                .setTimestamp();

            message.reply({ embeds: [embed] });
        }

        // ===================== PRESET (NUOVO SISTEMA CON BLOCCO FASE) =====================
        else if (command === 'preset') {
            const { showAdminDashboard, handlePresetCommand, showUserPresets } = require('./presetSystem');

            // --- ADMIN: Visualizza lista completa (Dashboard) ---
            if (isAdmin(message.member) && args.length === 0) {
                return showAdminDashboard(message);
            }

            // --- GIOCATORE / ADMIN (Funzioni utente) ---
            const subcommand = args[0]?.toLowerCase();
            const canUse = message.member.roles.cache.hasAny(RUOLI.ALIVE, RUOLI.SPONSOR, RUOLI.DEAD, RUOLI.SPONSOR_DEAD) || isAdmin(message.member);

            if (!canUse) return message.reply("⛔ Non hai i permessi per usare i preset.");

            // 🔥 NUOVO: Leggo la modalità corrente per bloccare i preset
            const currentMode = await db.housing.getMode();

            // 1. Preset Notturno - BLOCCATO durante fase NOTTURNA
            if (subcommand === 'notturno') {
                if (currentMode === 'NIGHT') {
                    return message.reply("🌙 **Siamo già in fase notturna!** Non puoi usare `!preset notturno` durante la notte. Usa questo comando durante il giorno per programmare le tue azioni notturne.");
                }
                await handlePresetCommand(message, args.slice(1), 'night');
            }
            // 2. Preset Diurno - BLOCCATO durante fase DIURNA
            else if (subcommand === 'diurno') {
                if (currentMode === 'DAY') {
                    return message.reply("☀️ **Siamo già in fase diurna!** Non puoi usare `!preset diurno` durante il giorno. Usa questo comando durante la notte per programmare le tue azioni diurne.");
                }
                await handlePresetCommand(message, args.slice(1), 'day');
            }
            // 3. Preset Timer - BLOCCATO durante fase preset attiva
            else if (subcommand === 'timer') {
                // ✅ BLOCCO PRESET PHASE (stesso meccanismo di !bussa, !torna, !abilità)
                const isPresetPhase = await db.moderation.isPresetPhaseActive();
                if (isPresetPhase) {
                    return message.reply("🔒 **Fase Preset attiva!** Non puoi usare `!preset timer` fino al comando `!fine preset`.");
                }
                
                const timeArg = args[1]; // "!preset timer 15:30" -> args[1] è l'orario
                if (!timeArg || !/^\d{2}:\d{2}$/.test(timeArg)) {
                    return message.reply("❌ Specifica l'orario nel formato HH:MM\nEsempio: `!preset timer 03:40`");
                }
                await handlePresetCommand(message, args.slice(2), 'scheduled', timeArg);
            }
            // 4. Lista Personale (per cancellare)
            else if (subcommand === 'list') {
                await showUserPresets(message);
            }
            // Help
            else {
                const helpMsg = await message.reply({
                    content: "📋 **Comandi Preset:**\n`!preset notturno` - Imposta un'azione per la notte (usabile solo di giorno)\n`!preset diurno` - Imposta un'azione per il giorno (usabile solo di notte)\n`!preset timer HH:MM` - Imposta un'azione per un orario specifico (es. 03:40)\n`!preset list` - Visualizza e gestisci le tue azioni programmate"
                });
                // Auto-cancellazione dopo 1 minuto (60000ms)
                setTimeout(() => {
                    helpMsg.delete().catch(() => {});
                }, 60000);
            }
        }
    });

};
