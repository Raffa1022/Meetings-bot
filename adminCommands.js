// ==========================================
// 👮 COMANDI ADMIN HOUSING
// assegnacasa, visite, aggiunta, resetvisite, sblocca,
// notte, giorno, distruzione, ricostruzione, pubblico,
// sposta, dove, multipla, ritirata, ram, ritorno, preset
// ==========================================
const { PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { HOUSING, RUOLI, RUOLI_PUBBLICI, RUOLI_PERMESSI, GIF, QUEUE } = require('./config');
const db = require('./db');
const { movePlayer } = require('./playerMovement');
const { isAdmin, formatName } = require('./helpers');
const { resolveNightPhase, resolveDayPhase } = require('./presetSystem');

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
        try {
            const numero = args[0];
            if (!numero) return message.reply("❌ Specifica numero notte.");

            await Promise.all([
                db.housing.setMode('NIGHT'),
                db.housing.applyLimitsForMode('NIGHT'),
                // 🔥 ATTIVA BLOCCO PRESET (Nessuna abilità finché non si fa !fine preset)
                db.moderation.setPresetPhaseActive(true)
            ]);

            // 🔥 ESEGUI PRESET NOTTURNI (Salvato nel PresetNightModel)
            await resolveNightPhase();

            // Rimuovi permessi testamento dai canali morti
            const DEAD_CHANNELS = ['1460741481420558469', '1460741482876239944'];
            const { econDb } = require('./economySystem');
            
            const allMembers = await message.guild.members.fetch();
            for (const [, member] of allMembers) {
                const testamentoChannels = await econDb.getTestamentoChannels(member.id);
                if (testamentoChannels.length > 0) {
                    for (const channelId of DEAD_CHANNELS) {
                        const channel = message.guild.channels.cache.get(channelId);
                        if (channel) {
                            await channel.permissionOverwrites.delete(member.id).catch(() => {});
                        }
                    }
                    await econDb.clearTestamento(member.id);
                }
            }

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
                const ruoli = [RUOLI.ALIVE, RUOLI.SPONSOR, RUOLI.DEAD, RUOLI.SPONSOR_DEAD];
                const ops = [];
                for (const [, channel] of canali) {
                    for (const r of ruoli) {
                        if (r) ops.push(channel.permissionOverwrites.edit(r, { SendMessages: false }).catch(() => {}));
                    }
                }
                await Promise.all(ops);
            }
            
            // 💰 Dai 100 monete
            const aliveMembers = message.guild.members.cache.filter(m => 
                !m.user.bot && m.roles.cache.has(RUOLI.ALIVE)
            );
            const aliveUserIds = Array.from(aliveMembers.keys());
            
            if (aliveUserIds.length > 0) {
                await econDb.bulkAddBalance(aliveUserIds, 100);
                if (annunciChannel) {
                    await annunciChannel.send(`🪙 <@&${RUOLI.ALIVE}> avete ricevuto il vostro collect giornaliero di **100 monete**!`);
                }
            }
            
            message.reply(`✅ **Notte ${numero} avviata.** Preset notturni eseguiti. Abilità bloccate fino a \`!fine preset\`.`);
        } catch (error) {
            console.error('❌ Errore comando !notte:', error);
            return message.reply("❌ Errore durante l'esecuzione del comando.");
        }
    }

    // ===================== GIORNO =====================
    else if (command === 'giorno') {
        try {
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
                // 🔥 ATTIVA BLOCCO PRESET (Nessuna abilità finché non si fa !fine preset)
                db.moderation.setPresetPhaseActive(true)
            ]);
            
            // 🔥 ESEGUI PRESET DIURNI (Salvato nel PresetDayModel)
            await resolveDayPhase();

            const annunciChannel = message.guild.channels.cache.get(HOUSING.CANALE_ANNUNCI);
            if (annunciChannel) {
                await annunciChannel.send({
                    content: `<@&${RUOLI.ALIVE}> <@&${RUOLI.SPONSOR}> <@&${RUOLI.DEAD}>\n☀️ **GIORNO ${numero}**`,
                    files: [GIF.GIORNO]
                });
            }

            // Sblocca canali diurni
            const DEAD_CHANNELS = ['1460741481420558469', '1460741482876239944'];
            const { econDb } = require('./economySystem');
            
            const catDiurna = message.guild.channels.cache.get(HOUSING.CATEGORIA_CHAT_DIURNA);
            if (catDiurna) {
                const canali = catDiurna.children.cache.filter(c => c.type === ChannelType.GuildText);
                const ops = [];
                for (const [, channel] of canali) {
                    if (channel.id === HOUSING.CANALE_BLOCCO_TOTALE) continue;
                    if (HOUSING.CANALI_BLOCCO_PARZIALE.includes(channel.id)) {
                        ops.push(channel.permissionOverwrites.edit(RUOLI.ALIVE, { SendMessages: true }).catch(() => {}));
                    } else {
                        [RUOLI.ALIVE, RUOLI.SPONSOR].forEach(r => {
                            if (r) ops.push(channel.permissionOverwrites.edit(r, { SendMessages: true }).catch(() => {}));
                        });
                        
                        if (!DEAD_CHANNELS.includes(channel.id)) {
                            [RUOLI.DEAD, RUOLI.SPONSOR_DEAD].forEach(r => {
                                if (r) ops.push(channel.permissionOverwrites.edit(r, { 
                                    SendMessages: false, 
                                    AddReactions: false, 
                                    CreatePublicThreads: false,
                                    CreatePrivateThreads: false 
                                }).catch(() => {}));
                            });
                        }
                    }
                    
                    if (DEAD_CHANNELS.includes(channel.id)) {
                        [RUOLI.DEAD, RUOLI.SPONSOR_DEAD].forEach(r => {
                            if (r) ops.push(channel.permissionOverwrites.edit(r, { 
                                SendMessages: false, 
                                ViewChannel: true,
                                AddReactions: false,
                                CreatePublicThreads: false,
                                CreatePrivateThreads: false 
                            }).catch(() => {}));
                        });
                    }
                    
                    ops.push(
                        channel.send(`☀️ **GIORNO ${numero}**`).then(msg => msg.pin()).catch(() => {})
                    );
                }
                await Promise.all(ops);
            }
            
            const aliveMembers = message.guild.members.cache.filter(m => 
                !m.user.bot && m.roles.cache.has(RUOLI.ALIVE)
            );
            const aliveUserIds = Array.from(aliveMembers.keys());
            
            if (aliveUserIds.length > 0) {
                await econDb.bulkAddBalance(aliveUserIds, 100);
                if (annunciChannel) {
                    await annunciChannel.send(`🪙 <@&${RUOLI.ALIVE}> avete ricevuto il vostro collect giornaliero di **100 monete**!`);
                }
            }
            
            message.reply(`✅ **Giorno ${numero} avviato.** Preset diurni eseguiti. Abilità bloccate fino a \`!fine preset\`.`);
        } catch (error) {
            console.error('❌ Errore comando !giorno:', error);
            return message.reply("❌ Errore durante l'esecuzione del comando.");
        }
    }

    // ===================== FINE PRESET =====================
    else if (command === 'fine' && args[0]?.toLowerCase() === 'preset') {
        // 1. Disattiva il blocco
        await db.moderation.setPresetPhaseActive(false);

        // 2. Annuncio ufficiale nel canale annunci
        const annunciChannel = message.guild.channels.cache.get(HOUSING.CANALE_ANNUNCI);
        if (annunciChannel) {
            await annunciChannel.send(
                `<@&${RUOLI.ALIVE}> <@&${RUOLI.SPONSOR}>\n✅ **Tutti i preset sono stati effettuati!**\nDa ora in poi potrete nuovamente utilizzare il comando \`!abilità\`.`
            );
        }
        
        // 3. Risposta conferma admin
        message.reply("✅ **Fase Preset Terminata.** Abilità sbloccate e annuncio inviato.");
        
        // 4. Trigger coda process per sbloccare le abilità in attesa
        const eventBus = require('./eventBus');
        eventBus.emit('queue:process');
    }

    // ===================== PRESET @UTENTE (ADMIN VIEW) =====================
    else if (command === 'preset' && message.mentions.members.size > 0) {
        const targetUser = message.mentions.members.first();
        
        // Helper locale per etichette
        const getLabel = (cat) => {
            const map = { 'KNOCK': 'Bussa', 'SHOP': 'Shop', 'PROTEZIONE': 'Protezione', 'LETALE': 'Letale', 'INFORMAZIONE': 'Info', 'COMUNICAZIONE': 'Comunicazione', 'POTENZIAMENTO': 'Potenziamento', 'TRASPORTO': 'Trasporto', 'CURA': 'Cura', 'VISITBLOCK': 'Visitblock', 'ROLEBLOCK': 'Roleblock', 'MANIPOLAZIONE': 'Manipolazione', 'ALTRO': 'Altro' };
            return map[cat] || cat;
        };

        // Recupera TUTTI i tipi di preset dal DB
        const nightPresets = await db.preset.getUserNightPresets(targetUser.id);
        const dayPresets = await db.preset.getUserDayPresets(targetUser.id);
        const scheduledPresets = await db.preset.getUserScheduledPresets(targetUser.id);

        let desc = "";

        if (nightPresets.length > 0) {
            desc += "\n🌙 **Preset Notturni (si attivano a fine !notte):**\n";
            nightPresets.forEach(p => {
                let det = p.type === 'ABILITY' ? p.details.text : (p.type === 'KNOCK' ? `Bussa a <#${p.details.targetChannelId}>` : (p.type === 'SHOP' ? p.details.itemName : p.type));
                desc += `- [${getLabel(p.category)}] ${det}\n`;
            });
        }
        
        if (dayPresets.length > 0) {
            desc += "\n☀️ **Preset Diurni (si attivano a fine !giorno):**\n";
            dayPresets.forEach(p => {
                let det = p.type === 'ABILITY' ? p.details.text : (p.type === 'KNOCK' ? `Bussa a <#${p.details.targetChannelId}>` : (p.type === 'SHOP' ? p.details.itemName : p.type));
                desc += `- [${getLabel(p.category)}] ${det}\n`;
            });
        }
        
        if (scheduledPresets.length > 0) {
            desc += "\n⏰ **Preset Timer (orario specifico):**\n";
            scheduledPresets.forEach(p => {
                let det = p.type === 'ABILITY' ? p.details.text : (p.type === 'KNOCK' ? `Bussa a <#${p.details.targetChannelId}>` : (p.type === 'SHOP' ? p.details.itemName : p.type));
                desc += `- [${p.triggerTime}] [${getLabel(p.category)}] ${det}\n`;
            });
        }

        if (desc === "") desc = "Nessun preset attivo per questo utente.";

        const embed = new EmbedBuilder()
            .setTitle(`📋 Preset di ${targetUser.displayName}`)
            .setColor('Blue')
            .setDescription(desc)
            .setTimestamp();
        
        message.reply({ embeds: [embed] });
    }

    // ===================== DISTRUZIONE =====================
    else if (command === 'distruzione') {
        const targetChannel = message.mentions.channels.first();
        if (!targetChannel || targetChannel.parentId !== HOUSING.CATEGORIA_CASE)
            return message.reply("❌ Devi menzionare un canale casa valido.");

        await db.housing.addDestroyedHouse(targetChannel.id);

        const removeRoles = RUOLI_PUBBLICI.map(r =>
            r ? targetChannel.permissionOverwrites.delete(r).catch(() => {}) : Promise.resolve()
        );
        await Promise.all(removeRoles);

        try {
            const pinned = await targetChannel.messages.fetchPinned();
            const keyMsg = pinned.find(m => m.content.includes("questa è la tua dimora privata"));
            if (keyMsg) await keyMsg.delete();
        } catch {}

        const membersInside = [];
        for (const [id, overwrite] of targetChannel.permissionOverwrites.cache) {
            if (overwrite.type !== 1) continue;
            try {
                const m = await message.guild.members.fetch(id);
                if (m && !m.user.bot && m.id !== message.member.id) membersInside.push(m);
            } catch {}
        }

        const allHomes = await db.housing.getAllHomes();
        const ownerId = Object.keys(allHomes).find(k => allHomes[k] === targetChannel.id);
        const destroyed = await db.housing.getDestroyedHouses();

        membersInside.sort((a, b) => {
            const aIsPlayer = a.roles.cache.has(RUOLI.ALIVE) || a.roles.cache.has(RUOLI.DEAD) ? 0 : 1;
            const bIsPlayer = b.roles.cache.has(RUOLI.ALIVE) || b.roles.cache.has(RUOLI.DEAD) ? 0 : 1;
            return aIsPlayer - bIsPlayer;
        });

        const movedPlayers = new Set();

        for (const member of membersInside) {
            if (movedPlayers.has(member.id)) continue;

            const prevMode = await db.housing.getPlayerMode(member.id);
            if (prevMode !== 'HIDDEN') await targetChannel.send(`🚪 ${member} è uscito.`);

            await targetChannel.permissionOverwrites.delete(member.id).catch(() => {});

            const isOwner = ownerId === member.id;
            let partner = null;
            if (member.roles.cache.has(RUOLI.ALIVE)) {
                const sponsorId = await db.meeting.findSponsor(member.id);
                if (sponsorId) {
                    partner = membersInside.find(m => m.id === sponsorId);
                    if (!partner) {
                        partner = await message.guild.members.fetch(sponsorId).catch(() => null);
                        if (partner && (partner.user.bot || !partner.roles.cache.has(RUOLI.SPONSOR))) partner = null;
                    }
                }
            } else if (member.roles.cache.has(RUOLI.DEAD)) {
                const sponsorId = await db.meeting.findSponsor(member.id);
                if (sponsorId) {
                    partner = membersInside.find(m => m.id === sponsorId);
                    if (!partner) {
                        partner = await message.guild.members.fetch(sponsorId).catch(() => null);
                        if (partner && (partner.user.bot || !partner.roles.cache.has(RUOLI.SPONSOR_DEAD))) partner = null;
                    }
                }
            } else if (member.roles.cache.has(RUOLI.SPONSOR)) {
                const playerId = await db.meeting.findPlayer(member.id);
                if (playerId) {
                    partner = membersInside.find(m => m.id === playerId);
                    if (!partner) {
                        partner = await message.guild.members.fetch(playerId).catch(() => null);
                        if (partner && (partner.user.bot || !partner.roles.cache.has(RUOLI.ALIVE))) partner = null;
                    }
                }
            } else if (member.roles.cache.has(RUOLI.SPONSOR_DEAD)) {
                const playerId = await db.meeting.findPlayer(member.id);
                if (playerId) {
                    partner = membersInside.find(m => m.id === playerId);
                    if (!partner) {
                        partner = await message.guild.members.fetch(playerId).catch(() => null);
                        if (partner && (partner.user.bot || !partner.roles.cache.has(RUOLI.DEAD))) partner = null;
                    }
                }
            }

            const movePartnerToo = async (destination) => {
                if (!partner) return;
                await targetChannel.permissionOverwrites.delete(partner.id).catch(() => {});
                const partnerOldHouse = message.guild.channels.cache.find(c =>
                    c.parentId === HOUSING.CATEGORIA_CASE && c.type === ChannelType.GuildText &&
                    c.id !== targetChannel.id && c.id !== destination.id &&
                    c.permissionOverwrites.cache.has(partner.id)
                );
                if (partnerOldHouse) {
                    await partnerOldHouse.permissionOverwrites.delete(partner.id).catch(() => {});
                }
                await movePlayer(partner, partnerOldHouse || targetChannel, destination, null, false);
                movedPlayers.add(partner.id);
            };

            let playerHomeForSponsor = null;
            if ((member.roles.cache.has(RUOLI.SPONSOR) || member.roles.cache.has(RUOLI.SPONSOR_DEAD)) && partner) {
                const partnerHomeId = allHomes[partner.id];
                if (partnerHomeId && partnerHomeId !== targetChannel.id && !destroyed.includes(partnerHomeId)) {
                    playerHomeForSponsor = message.guild.channels.cache.get(partnerHomeId);
                }
            }

            if (isOwner) {
                const randomHouse = message.guild.channels.cache
                    .filter(c => c.parentId === HOUSING.CATEGORIA_CASE && c.id !== targetChannel.id && !destroyed.includes(c.id))
                    .random();
                if (randomHouse) {
                    await movePlayer(member, targetChannel, randomHouse, `👋 **${member}** è entrato.`, false);
                    movedPlayers.add(member.id);
                    await movePartnerToo(randomHouse);
                }
            } else {
                let homeId = allHomes[member.id];
                if (!homeId && playerHomeForSponsor) {
                    homeId = playerHomeForSponsor.id;
                }
                if (!homeId && partner) {
                    const partnerHomeId = allHomes[partner.id];
                    if (partnerHomeId && partnerHomeId !== targetChannel.id && !destroyed.includes(partnerHomeId)) {
                        homeId = partnerHomeId;
                    }
                }

                const hasSafe = homeId && homeId !== targetChannel.id && !destroyed.includes(homeId);
                if (hasSafe) {
                    const homeCh = message.guild.channels.cache.get(homeId);
                    if (homeCh) {
                        await movePlayer(member, targetChannel, homeCh, `🏠 ${member} è ritornato.`, false);
                        movedPlayers.add(member.id);
                        await movePartnerToo(homeCh);
                    }
                } else if (member.roles.cache.hasAny(...RUOLI_PERMESSI, RUOLI.DEAD, RUOLI.SPONSOR_DEAD)) {
                    const randomHouse = message.guild.channels.cache
                        .filter(c => c.parentId === HOUSING.CATEGORIA_CASE && c.id !== targetChannel.id && !destroyed.includes(c.id))
                        .random();
                    if (randomHouse) {
                        await movePlayer(member, targetChannel, randomHouse, `👋 **${member}** è entrato.`, false);
                        movedPlayers.add(member.id);
                        await movePartnerToo(randomHouse);
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

        if (subCommand === 'knock' && message.mentions.members.size > 0) {
            const targetUser = message.mentions.members.first();
            await Promise.all([
                db.housing.removePendingKnock(targetUser.id),
                db.housing.clearActiveKnock(targetUser.id),
            ]);
            message.reply(`✅ Knock pendenti e attivi rimossi per ${targetUser}.`);
        }
        else if (subCommand === 'knock' && args[1]?.toLowerCase() === 'tutti') {
            await Promise.all([
                db.housing.clearPendingKnocks(),
                db.housing.clearAllActiveKnocks(),
            ]);
            message.reply("✅ **Tutti i knock pendenti e attivi sono stati rimossi!**");
        }
        else if (subCommand === 'casa') {
            await db.housing.clearAllHomes();
            message.reply("✅ **Tutte le proprietà delle case sono state rimosse!**");
        }
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

    // ===================== RITORNO =====================
    else if (command === 'ritorno') {
        await message.reply("⏳ **Inizio ritorno a casa di tutti i giocatori...**");

        const allHomes = await db.housing.getAllHomes();
        const destroyed = await db.housing.getDestroyedHouses();
        
        const allMembers = await message.guild.members.fetch();
        const playersToProcess = allMembers.filter(m => 
            !m.user.bot && 
            (m.roles.cache.has(RUOLI.ALIVE) || m.roles.cache.has(RUOLI.SPONSOR))
        );

        let returnedCount = 0;
        let alreadyHome = 0;
        let noHomeCount = 0;
        const noHomeList = [];
        const processedNoHome = new Set();

        for (const [, member] of playersToProcess) {
            const homeId = allHomes[member.id];
            
            if (!homeId || destroyed.includes(homeId)) {
                if (processedNoHome.has(member.id)) continue;

                const alreadyMarked = await db.moderation.isMarkedForDeath(member.id);
                if (!alreadyMarked) {
                    await db.moderation.addMarkedForDeath(member.id, member.user.tag);
                }
                noHomeList.push(member);
                noHomeCount++;
                processedNoHome.add(member.id);

                let partnerId = null;
                if (member.roles.cache.has(RUOLI.ALIVE)) {
                    partnerId = await db.meeting.findSponsor(member.id);
                } else if (member.roles.cache.has(RUOLI.SPONSOR)) {
                    partnerId = await db.meeting.findPlayer(member.id);
                }
                if (partnerId && !processedNoHome.has(partnerId)) {
                    const partnerMarked = await db.moderation.isMarkedForDeath(partnerId);
                    if (!partnerMarked) {
                        const partnerMember = allMembers.get(partnerId);
                        if (partnerMember) {
                            await db.moderation.addMarkedForDeath(partnerId, partnerMember.user.tag);
                            noHomeList.push(partnerMember);
                            noHomeCount++;
                        }
                    }
                    processedNoHome.add(partnerId);
                }
                continue;
            }

            const homeChannel = message.guild.channels.cache.get(homeId);
            if (!homeChannel) continue;

            const currentHouse = message.guild.channels.cache.find(c =>
                c.parentId === HOUSING.CATEGORIA_CASE &&
                c.type === ChannelType.GuildText &&
                c.permissionOverwrites.cache.has(member.id)
            );

            if (currentHouse && currentHouse.id === homeId) {
                alreadyHome++;
                continue;
            }

            if (currentHouse) {
                await movePlayer(member, currentHouse, homeChannel, `🏠 ${member} è ritornato.`, false);
            } else {
                await movePlayer(member, null, homeChannel, `🏠 ${member} è ritornato.`, false);
            }
            returnedCount++;
        }

        let response = `✅ **Ritorno completato!**\n` +
                      `🏠 Ritornati a casa: **${returnedCount}**\n` +
                      `✔️ Già a casa: **${alreadyHome}**`;

        if (noHomeCount > 0) {
            response += `\n☠️ Senza casa (aggiunti a lista morti): **${noHomeCount}**\n` +
                       noHomeList.map(m => `- ${m.displayName}`).join('\n');

            const logChannel = message.guild.channels.cache.get(QUEUE.CANALE_LOG);
            if (logChannel) {
                const logMsg = noHomeList.map(m => `⚠️ <@${m.id}> è rimasto senza casa.`).join('\n');
                await logChannel.send(`🏠❌ **Giocatori senza casa dopo !ritorno:**\n${logMsg}`);
            }
        }

        message.reply(response);
    }

    // ===================== PRESET DASHBOARD =====================
    else if (command === 'presetdashboard') {
        const channelId = args[0] || message.channel.id;
        const { setDashboardChannel, updatePresetDashboard } = require('./presetSystem');
        
        setDashboardChannel(channelId);
        await updatePresetDashboard();
        
        message.reply(`✅ Dashboard preset configurata su <#${channelId}>`);
    }

    // ===================== ESEGUI PRESET PROGRAMMATI =====================
    else if (command === 'eseguipreset') {
        const triggerTime = args[0];
        if (!triggerTime || !triggerTime.match(/^\d{2}:\d{2}$/)) {
            return message.reply("❌ Specifica l'orario nel formato HH:MM\nEsempio: `!eseguipreset 15:30`");
        }

        const { resolveScheduledPhase } = require('./presetSystem');
        await resolveScheduledPhase(triggerTime);
        
        message.reply(`✅ Preset programmati per le ${triggerTime} eseguiti e aggiunti alla coda.`);
    }
};
