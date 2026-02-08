// ==========================================
// 👮 COMANDI ADMIN HOUSING
// assegnacasa, visite, aggiunta, resetvisite, sblocca,
// notte, giorno, distruzione, ricostruzione, pubblico,
// sposta, dove, multipla, ritirata, ram
// ==========================================
const { PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { HOUSING, RUOLI, RUOLI_PUBBLICI, RUOLI_PERMESSI, GIF } = require('./config');
const db = require('./db');
const { movePlayer } = require('./playerMovement');
const { isAdmin, formatName } = require('./helpers');

module.exports = async function handleAdminCommand(message, command, args, client) {
    if (!isAdmin(message.member)) return message.reply("⛔ Non sei admin.");

    // ===================== ASSEGNACASA =====================
    if (command === 'assegnacasa') {
        const targetUser = message.mentions.members.first();
        const targetChannel = message.mentions.channels.first();
        if (!targetUser || !targetChannel) return message.reply("❌ Uso: `!assegnacasa @Utente #canale`");

        await Promise.all([
            db.housing.setHome(targetUser.id, targetChannel.id),
            targetChannel.permissionOverwrites.set([
                { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: targetUser.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels] }
            ]),
        ]);

        message.reply(`✅ Casa assegnata a ${targetUser}.`);
        const pinnedMsg = await targetChannel.send(`🔑 **${targetUser}**, questa è la tua dimora privata.`);
        await pinnedMsg.pin();
    }

    // ===================== VISITE =====================
    else if (command === 'visite') {
        const targetUser = message.mentions.members.first();
        const [, baseInput, forcedInput, hiddenInput] = [args[0], parseInt(args[1]), parseInt(args[2]), parseInt(args[3])];
        if (!targetUser || isNaN(baseInput) || isNaN(forcedInput) || isNaN(hiddenInput))
            return message.reply("❌ Uso: `!visite @Utente [Base] [Forzate] [Nascoste]`");

        const mode = await db.housing.getMode();
        await db.housing.setVisitLimits(targetUser.id, baseInput, forcedInput, hiddenInput);
        if (mode === 'NIGHT') {
            await db.housing.setNightForcedHidden(targetUser.id, forcedInput, hiddenInput);
        }
        message.reply(`✅ Configurazione Notte/Standard salvata per ${targetUser}.`);
    }

    // ===================== AGGIUNTA =====================
    else if (command === 'aggiunta') {
        const isDayAdd = args[0]?.toLowerCase() === 'giorno';
        const typeIndex = isDayAdd ? 1 : 0;
        const amountIndex = isDayAdd ? 3 : 2;
        const type = args[typeIndex]?.toLowerCase();
        const targetUser = message.mentions.members.first();
        const amount = parseInt(args[amountIndex]);

        if (!type || !targetUser || isNaN(amount) || !['base', 'nascosta', 'forzata'].includes(type)) {
            return message.reply("❌ Uso:\n`!aggiunta base/nascosta/forzata @Utente Num`\n`!aggiunta giorno base/nascosta/forzata @Utente Num`");
        }

        const mode = await db.housing.getMode();

        if (isDayAdd) {
            if (type === 'base') {
                await db.housing.addExtraVisit(targetUser.id, 'base', amount, true);
            } else if (mode !== 'DAY') {
                return message.reply("⚠ Puoi aggiungere visite Giorno solo se è attiva la modalità Giorno.");
            } else {
                await db.housing.addExtraVisit(targetUser.id, type, amount, true);
            }
            message.reply(`✅ Aggiunte visite (GIORNO) a ${targetUser}.`);
        } else {
            if (type === 'base') {
                await db.housing.addExtraVisit(targetUser.id, 'base', amount, false);
            } else if (mode !== 'NIGHT') {
                return message.reply("⚠ Puoi aggiungere visite Standard solo se è attiva la modalità Standard/Visite.");
            } else {
                await db.housing.addExtraVisit(targetUser.id, type, amount, false);
            }
            message.reply(`✅ Aggiunte visite (STANDARD) a ${targetUser}.`);
        }
    }

    // ===================== RESETVISITE =====================
    else if (command === 'resetvisite') {
        await db.housing.resetAllVisits();
        message.reply("♻️ **RESET GLOBALE COMPLETATO**");
    }

    // ===================== SBLOCCA =====================
    else if (command === 'sblocca') {
        await db.housing.clearPendingKnocks();
        message.reply("✅ **Sblocco effettuato!** Tutte le selezioni 'Bussa' pendenti sono state cancellate.");
    }

    // ===================== NOTTE =====================
    else if (command === 'notte') {
        const numero = args[0];
        if (!numero) return message.reply("❌ Specifica numero notte.");

        await Promise.all([
            db.housing.setMode('NIGHT'),
            db.housing.applyLimitsForMode('NIGHT'),
        ]);

        const annunciChannel = message.guild.channels.cache.get(HOUSING.CANALE_ANNUNCI);
        if (annunciChannel) {
            await annunciChannel.send({
                content: `<@&${RUOLI.ALIVE}> <@&${RUOLI.SPONSOR}>\n🌑 **NOTTE ${numero} HA INIZIO**`,
                files: [GIF.NOTTE]
            });
        }

        // Blocca canali diurni
        const catDiurna = message.guild.channels.cache.get(HOUSING.CATEGORIA_CHAT_DIURNA);
        if (catDiurna) {
            const canali = catDiurna.children.cache.filter(c => c.type === ChannelType.GuildText);
            const ruoli = [RUOLI.ALIVE, RUOLI.SPONSOR, RUOLI.DEAD];
            const ops = [];
            for (const [, channel] of canali) {
                for (const r of ruoli) {
                    if (r) ops.push(channel.permissionOverwrites.edit(r, { SendMessages: false }).catch(() => {}));
                }
            }
            await Promise.all(ops);
        }
        message.reply(`✅ **Notte ${numero} avviata.**`);
    }

    // ===================== GIORNO =====================
    else if (command === 'giorno') {
        // Se menziona un utente → config giorno
        if (message.mentions.members.size > 0) {
            const targetUser = message.mentions.members.first();
            const [base, forced, hidden] = [parseInt(args[1]), parseInt(args[2]), parseInt(args[3])];
            await db.housing.setDayLimits(targetUser.id, base, forced, hidden);
            const mode = await db.housing.getMode();
            if (mode === 'DAY') {
                await db.housing.setDayForcedHidden(targetUser.id, forced, hidden);
            }
            return message.reply("✅ Config Giorno salvata.");
        }

        const numero = args[0];
        if (!numero) return message.reply("❌ Specifica giorno.");

        await Promise.all([
            db.housing.setMode('DAY'),
            db.housing.applyLimitsForMode('DAY'),
        ]);

        const annunciChannel = message.guild.channels.cache.get(HOUSING.CANALE_ANNUNCI);
        if (annunciChannel) {
            await annunciChannel.send({
                content: `<@&${RUOLI.ALIVE}> <@&${RUOLI.SPONSOR}> <@&${RUOLI.DEAD}>\n☀️ **GIORNO ${numero}**`,
                files: [GIF.GIORNO]
            });
        }

        // Sblocca canali diurni
        const catDiurna = message.guild.channels.cache.get(HOUSING.CATEGORIA_CHAT_DIURNA);
        if (catDiurna) {
            const canali = catDiurna.children.cache.filter(c => c.type === ChannelType.GuildText);
            const ops = [];
            for (const [, channel] of canali) {
                if (channel.id === HOUSING.CANALE_BLOCCO_TOTALE) continue;
                if (HOUSING.CANALI_BLOCCO_PARZIALE.includes(channel.id)) {
                    ops.push(channel.permissionOverwrites.edit(RUOLI.ALIVE, { SendMessages: true }).catch(() => {}));
                } else {
                    [RUOLI.ALIVE, RUOLI.SPONSOR, RUOLI.DEAD].forEach(r => {
                        if (r) ops.push(channel.permissionOverwrites.edit(r, { SendMessages: true }).catch(() => {}));
                    });
                }
                ops.push(
                    channel.send(`☀️ **GIORNO ${numero}**`).then(msg => msg.pin()).catch(() => {})
                );
            }
            await Promise.all(ops);
        }
        message.reply(`✅ **Giorno ${numero} avviato.**`);
    }

    // ===================== DISTRUZIONE =====================
    else if (command === 'distruzione') {
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel || targetChannel.parentId !== HOUSING.CATEGORIA_CASE)
            return message.reply("❌ Devi menzionare un canale casa valido.");

        await db.housing.addDestroyedHouse(targetChannel.id);

        // Rimuovi ruoli pubblici
        const removeRoles = RUOLI_PUBBLICI.map(r =>
            r ? targetChannel.permissionOverwrites.delete(r).catch(() => {}) : Promise.resolve()
        );
        await Promise.all(removeRoles);

        // Rimuovi pin proprietario
        try {
            const pinned = await targetChannel.messages.fetchPinned();
            const keyMsg = pinned.find(m => m.content.includes("questa è la tua dimora privata"));
            if (keyMsg) await keyMsg.delete();
        } catch {}

        // Trova occupanti fisici
        const membersInside = [];
        targetChannel.permissionOverwrites.cache.forEach((overwrite, id) => {
            if (overwrite.type === 1) {
                const m = targetChannel.members.get(id);
                if (m && !m.user.bot && m.id !== message.member.id) membersInside.push(m);
            }
        });

        const allHomes = await db.housing.getAllHomes();
        const ownerId = Object.keys(allHomes).find(k => allHomes[k] === targetChannel.id);
        const destroyed = await db.housing.getDestroyedHouses();

        // FIX: Traccia coppie già spostate per evitare doppio spostamento
        const movedPlayers = new Set();

        for (const member of membersInside) {
            // Se già spostato come parte di una coppia, salta
            if (movedPlayers.has(member.id)) continue;

            const prevMode = await db.housing.getPlayerMode(member.id);
            if (prevMode !== 'HIDDEN') await targetChannel.send(`🚪 ${member} è uscito.`);

            await targetChannel.permissionOverwrites.delete(member.id).catch(() => {});

            const isOwner = ownerId === member.id;

            // FIX: Trova il partner (sponsor) per muoverlo insieme
            let partner = null;
            if (member.roles.cache.has(RUOLI.ALIVE)) {
                const sponsorId = await db.meeting.findSponsor(member.id);
                if (sponsorId) {
                    partner = membersInside.find(m => m.id === sponsorId);
                }
            } else if (member.roles.cache.has(RUOLI.DEAD)) {
                const sponsorId = await db.meeting.findSponsor(member.id);
                if (sponsorId) {
                    partner = membersInside.find(m => m.id === sponsorId);
                }
            } else if (member.roles.cache.has(RUOLI.SPONSOR)) {
                const playerId = await db.meeting.findPlayer(member.id);
                if (playerId) {
                    partner = membersInside.find(m => m.id === playerId);
                }
            } else if (member.roles.cache.has(RUOLI.SPONSOR_DEAD)) {
                const playerId = await db.meeting.findPlayer(member.id);
                if (playerId) {
                    partner = membersInside.find(m => m.id === playerId);
                }
            }

            if (isOwner) {
                const randomHouse = message.guild.channels.cache
                    .filter(c => c.parentId === HOUSING.CATEGORIA_CASE && c.id !== targetChannel.id && !destroyed.includes(c.id))
                    .random();
                if (randomHouse) {
                    await movePlayer(member, targetChannel, randomHouse, `👋 **${member}** è entrato.`, false);
                    movedPlayers.add(member.id);
                    
                    // FIX: Sposta anche il partner nella stessa casa
                    if (partner) {
                        await targetChannel.permissionOverwrites.delete(partner.id).catch(() => {});
                        await movePlayer(partner, targetChannel, randomHouse, null, false);
                        movedPlayers.add(partner.id);
                    }
                }
            } else {
                const homeId = allHomes[member.id];
                const hasSafe = homeId && homeId !== targetChannel.id && !destroyed.includes(homeId);
                if (hasSafe) {
                    const homeCh = message.guild.channels.cache.get(homeId);
                    if (homeCh) {
                        await movePlayer(member, targetChannel, homeCh, `🏠 ${member} è ritornato.`, false);
                        movedPlayers.add(member.id);
                        
                        // FIX: Sposta anche il partner nella stessa casa
                        if (partner) {
                            await targetChannel.permissionOverwrites.delete(partner.id).catch(() => {});
                            await movePlayer(partner, targetChannel, homeCh, null, false);
                            movedPlayers.add(partner.id);
                        }
                    }
                } else if (member.roles.cache.hasAny(...RUOLI_PERMESSI)) {
                    const randomHouse = message.guild.channels.cache
                        .filter(c => c.parentId === HOUSING.CATEGORIA_CASE && c.id !== targetChannel.id && !destroyed.includes(c.id))
                        .random();
                    if (randomHouse) {
                        await movePlayer(member, targetChannel, randomHouse, `👋 **${member}** è entrato.`, false);
                        movedPlayers.add(member.id);
                        
                        // FIX: Sposta anche il partner nella stessa casa
                        if (partner) {
                            await targetChannel.permissionOverwrites.delete(partner.id).catch(() => {});
                            await movePlayer(partner, targetChannel, randomHouse, null, false);
                            movedPlayers.add(partner.id);
                        }
                    }
                }
            }
        }

        message.reply(`🏚️ La casa ${targetChannel} è stata distrutta.`);
        const annunci = message.guild.channels.cache.get(HOUSING.CANALE_ANNUNCI);
        if (annunci) {
            annunci.send({
                content: `<@&${RUOLI.ALIVE}> <@&${RUOLI.SPONSOR}>\n🏡|${formatName(targetChannel.name)} casa è stata distrutta`,
                files: [GIF.DISTRUZIONE]
            });
        }
    }

    // ===================== RICOSTRUZIONE =====================
    else if (command === 'ricostruzione') {
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel || targetChannel.parentId !== HOUSING.CATEGORIA_CASE)
            return message.reply("❌ Devi menzionare un canale casa valido.");

        await Promise.all([
            db.housing.removeDestroyedHouse(targetChannel.id),
            db.housing.removeHomesByChannel(targetChannel.id),
        ]);

        message.reply(`🏗️ La casa ${targetChannel} è stata ricostruita.`);
        const annunci = message.guild.channels.cache.get(HOUSING.CANALE_ANNUNCI);
        if (annunci) {
            annunci.send({
                content: `<@&${RUOLI.ALIVE}> <@&${RUOLI.SPONSOR}>\n:house_with_garden:|${formatName(targetChannel.name)} casa è stata ricostruita`,
                files: [GIF.RICOSTRUZIONE]
            });
        }
    }

    // ===================== PUBBLICO =====================
    else if (command === 'pubblico') {
        if (message.channel.parentId !== HOUSING.CATEGORIA_CASE) return message.reply("⛔ Usalo in una casa.");
        const channel = message.channel;

        const destroyed = await db.housing.getDestroyedHouses();
        if (destroyed.includes(channel.id)) return message.reply("❌ Questa casa è distrutta!");

        const isPublic = channel.permissionOverwrites.cache.has(RUOLI_PUBBLICI[0]);
        if (isPublic) {
            const ops = RUOLI_PUBBLICI.map(r => r ? channel.permissionOverwrites.delete(r).catch(() => {}) : Promise.resolve());
            await Promise.all(ops);
            message.reply("🔒 La casa è tornata **PRIVATA**.");
        } else {
            const ops = RUOLI_PUBBLICI.map(r => r
                ? channel.permissionOverwrites.create(r, {
                    ViewChannel: true, SendMessages: false,
                    CreatePublicThreads: false, CreatePrivateThreads: false, AddReactions: false
                })
                : Promise.resolve()
            );
            await Promise.all(ops);
            channel.send(`📢 **LA CASA È ORA PUBBLICA!** <@&${RUOLI.ALIVE}> <@&${RUOLI.SPONSOR}>`);
        }
    }

    // ===================== SPOSTA =====================
    else if (command === 'sposta') {
        const targetMembers = message.mentions.members.filter(m => !m.user.bot);
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel || targetMembers.size === 0) return message.reply("❌ Uso: `!sposta @Utente1 @Utente2 ... #canale`");

        for (const [, member] of targetMembers) {
            await movePlayer(member, message.channel, targetChannel, `👋 **${member}** è entrato.`, false);
        }
        message.reply(`✅ Spostati ${targetMembers.size} utenti in ${targetChannel}.`);
    }

    // ===================== DOVE =====================
    else if (command === 'dove') {
        const targetUser = message.mentions.members.first();
        if (!targetUser) return message.reply("❌ Uso: `!dove @Utente`");

        const locations = message.guild.channels.cache.filter(c => {
            if (c.parentId !== HOUSING.CATEGORIA_CASE || c.type !== ChannelType.GuildText) return false;
            const ow = c.permissionOverwrites.cache.get(targetUser.id);
            return ow && ow.allow.has(PermissionsBitField.Flags.ViewChannel);
        });

        if (locations.size > 0) {
            const list = locations.map(c => `🏠 ${c} (ID: ${c.id})`).join('\n');
            const warn = locations.size > 1 ? "\n\n⚠️ **ATTENZIONE:** Utente in più case!" : "";
            message.reply(`📍 **${targetUser.displayName}** si trova in:\n${list}${warn}`);
        } else {
            message.reply(`❌ **${targetUser.displayName}** non è in nessuna casa.`);
        }
    }

    // ===================== MULTIPLA =====================
    else if (command === 'multipla') {
        const targetUser = message.mentions.members.first();
        if (!targetUser) return message.reply("❌ Uso: `!multipla @Utente #casa1 si narra #casa2 no ...`");

        const rawArgs = message.content.slice(message.content.indexOf(command) + command.length).trim().split(/ +/);
        let currentWrite = false, currentNarra = false;
        const actions = [];

        for (const arg of rawArgs) {
            if (arg.includes(targetUser.id)) continue;
            let stateChanged = false;
            if (arg.toLowerCase() === 'si') { currentWrite = true; stateChanged = true; }
            else if (arg.toLowerCase() === 'no') { currentWrite = false; stateChanged = true; }
            else if (arg.toLowerCase() === 'narra') { currentNarra = true; stateChanged = true; }
            else if (arg.toLowerCase() === 'muto') { currentNarra = false; stateChanged = true; }

            if (stateChanged && actions.length > 0) {
                actions[actions.length - 1].write = currentWrite;
                actions[actions.length - 1].narra = currentNarra;
                continue;
            }
            if (arg.match(/^<#(\d+)>$/)) {
                const channelId = arg.replace(/\D/g, '');
                const channel = message.guild.channels.cache.get(channelId);
                if (channel && channel.parentId === HOUSING.CATEGORIA_CASE) {
                    actions.push({ channel, write: currentWrite, narra: currentNarra });
                }
            }
        }

        const ops = [];
        for (const a of actions) {
            ops.push(db.housing.addMultiplaChannel(targetUser.id, a.channel.id));
            ops.push(a.channel.permissionOverwrites.create(targetUser.id, {
                ViewChannel: true, SendMessages: a.write, AddReactions: a.write, ReadMessageHistory: true
            }));
            if (a.narra) ops.push(a.channel.send(`👋 **${targetUser.displayName}** è entrato.`));
        }
        await Promise.all(ops);
        message.reply(`✅ Applicate impostazioni a **${actions.length}** case per ${targetUser}.`);
    }

    // ===================== RITIRATA =====================
    else if (command === 'ritirata') {
        const targetUser = message.mentions.members.first();
        if (!targetUser) return message.reply("❌ Uso: `!ritirata @Utente #casa1 narra ... [si/no]`");

        const rawArgs = message.content.slice(message.content.indexOf(command) + command.length).trim().split(/ +/);
        let currentNarra = false, currentWrite = null;
        const removalActions = [];

        for (const arg of rawArgs) {
            if (arg.includes(targetUser.id)) continue;
            let stateChanged = false;
            if (arg.toLowerCase() === 'narra') { currentNarra = true; stateChanged = true; }
            else if (arg.toLowerCase() === 'muto') { currentNarra = false; stateChanged = true; }
            else if (arg.toLowerCase() === 'si') currentWrite = true;
            else if (arg.toLowerCase() === 'no') currentWrite = false;

            if (stateChanged && removalActions.length > 0) {
                removalActions[removalActions.length - 1].narra = currentNarra;
                continue;
            }
            if (arg.match(/^<#(\d+)>$/)) {
                const channelId = arg.replace(/\D/g, '');
                const channel = message.guild.channels.cache.get(channelId);
                if (channel) removalActions.push({ channel, narra: currentNarra });
            }
        }

        const channelsRemovedIds = [];
        const ops = [];
        for (const a of removalActions) {
            if (a.narra) ops.push(a.channel.send(`🚪 **${targetUser.displayName}** è uscito.`));
            ops.push(a.channel.permissionOverwrites.delete(targetUser.id).catch(() => {}));
            channelsRemovedIds.push(a.channel.id);
        }
        await Promise.all(ops);

        // Aggiorna history
        let history = await db.housing.getMultiplaHistory(targetUser.id);
        history = history.filter(hid => !channelsRemovedIds.includes(hid));
        await db.housing.setMultiplaHistory(targetUser.id, history);

        if (currentWrite !== null) {
            const updateOps = history.map(hid => {
                const ch = message.guild.channels.cache.get(hid);
                return ch ? ch.permissionOverwrites.create(targetUser.id, {
                    ViewChannel: true, SendMessages: currentWrite, AddReactions: currentWrite, ReadMessageHistory: true
                }) : Promise.resolve();
            });
            await Promise.all(updateOps);
            message.reply(`✅ Rimossi ${removalActions.length} canali. Restanti aggiornati a: **${currentWrite ? "SCRITTURA (SI)" : "LETTURA (NO)"}**.`);
        } else {
            message.reply(`✅ Rimossi ${removalActions.length} canali.`);
        }
    }

    // ===================== CANCELLA =====================
    else if (command === 'cancella') {
        const subCommand = args[0]?.toLowerCase();

        // !cancella knock @Utente
        if (subCommand === 'knock' && message.mentions.members.size > 0) {
            const targetUser = message.mentions.members.first();
            await Promise.all([
                db.housing.removePendingKnock(targetUser.id),
                db.housing.clearActiveKnock(targetUser.id),
            ]);
            message.reply(`✅ Knock pendenti e attivi rimossi per ${targetUser}.`);
        }
        // !cancella knock tutti
        else if (subCommand === 'knock' && args[1]?.toLowerCase() === 'tutti') {
            await Promise.all([
                db.housing.clearPendingKnocks(),
                db.housing.clearAllActiveKnocks(),
            ]);
            message.reply("✅ **Tutti i knock pendenti e attivi sono stati rimossi!**");
        }
        // !cancella casa
        else if (subCommand === 'casa') {
            await db.housing.clearAllHomes();
            message.reply("✅ **Tutte le proprietà delle case sono state rimosse!**");
        }
        // Errore sintassi
        else {
            message.reply("❌ Uso:\n`!cancella knock @Utente` - Rimuove knock per utente specifico\n`!cancella knock tutti` - Rimuove tutti i knock\n`!cancella casa` - Rimuove tutte le proprietà");
        }
    }

    // ===================== RAM / MEMORIA =====================
    else if (command === 'ram' || command === 'memoria') {
        const used = process.memoryUsage();
        const fmt = (b) => (b / 1024 / 1024).toFixed(2);
        const mongoStatus = mongoose.connection.readyState === 1 ? "✅ Connesso" : "❌ Disconnesso";

        const embed = new EmbedBuilder()
            .setTitle("📊 Monitoraggio Server")
            .setColor('#00ff00')
            .addFields(
                { name: '🧠 Heap Totale', value: `${fmt(used.heapTotal)} MB`, inline: true },
                { name: '💾 Heap Usato', value: `${fmt(used.heapUsed)} MB`, inline: true },
                { name: '📦 RSS', value: `${fmt(used.rss)} MB`, inline: true },
                { name: '⚡ External', value: `${fmt(used.external)} MB`, inline: true },
                { name: '🗄️ MongoDB', value: mongoStatus, inline: true },
                { name: '⏱️ Uptime', value: `${Math.floor(process.uptime() / 60)} minuti`, inline: true },
            )
            .setTimestamp();
        message.reply({ embeds: [embed] });
    }
};
