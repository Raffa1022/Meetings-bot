// ==========================================
// 👥 MEETING SYSTEM - 100% ATOMICO
// Zero .save(), solo operazioni $set/$inc/$push/$pull
// ==========================================
const {
    PermissionsBitField, ChannelType, EmbedBuilder,
    ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const { MEETING, HOUSING, RUOLI } = require('./config');
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

        // !overseer — Comandi admin/overseer dettagliati
        if (content === '!overseer' && guildId === MEETING.COMMAND_GUILD) {
            if (!isAdm) return message.reply("⛔ Solo overseer.");

            const embeds = [];

            embeds.push(new EmbedBuilder()
                .setTitle('🔧 Comandi Overseer — Housing')
                .setColor(0x2B2D31)
                .addFields(
                    { name: '🏠 !assegnacasa @utente #canale', value: 'Assegna una casa a un giocatore. Il canale diventa la sua dimora privata, con accesso esclusivo. Viene creato un messaggio pinnati con la chiave 🔑.' },
                    { name: '📊 !visite @utente [base] [forzate] [nascoste]', value: 'Configura le visite standard/notte di un giocatore. I 3 numeri indicano quante visite base, forzate e nascoste può fare per turno. Es: `!visite @Tizio 3 1 1`' },
                    { name: '☀️ !giorno @utente [base] [forzate] [nascoste]', value: 'Configura le visite GIORNO di un giocatore. Stessa logica di !visite ma per la modalità giorno. Es: `!giorno @Tizio 2 1 0`' },
                    { name: '➕ !aggiunta [giorno] base/nascosta/forzata @utente [num]', value: 'Aggiunge visite extra a un giocatore. Usa `giorno` per la modalità giorno. Es: `!aggiunta forzata @Tizio 2` oppure `!aggiunta giorno base @Tizio 1`' },
                    { name: '♻️ !resetvisite', value: 'Azzera TUTTI i contatori visite di TUTTI i giocatori. Reset globale, irreversibile.' },
                    { name: '🔓 !sblocca', value: 'Sblocca tutte le bussate pendenti nel sistema. Utile se un giocatore è rimasto bloccato in una selezione.' },
                    { name: '🌙 !notte [numero]', value: 'Avvia la notte X. Annuncia nel canale annunci, blocca i canali diurni e imposta la modalità Notte. Es: `!notte 3`' },
                    { name: '☀️ !giorno [numero]', value: 'Avvia il giorno X. Annuncia nel canale annunci, sblocca i canali diurni e imposta la modalità Giorno. Es: `!giorno 4`' },
                    { name: '💥 !distruzione #canale', value: 'Distrugge una casa. Tutti gli occupanti vengono espulsi (proprietario → casa random, visitatori → propria casa o random). Annuncio pubblico.' },
                    { name: '🏗️ !ricostruzione #canale', value: 'Ricostruisce una casa precedentemente distrutta. Rimuove la proprietà precedente e la rende disponibile.' },
                )
            );

            embeds.push(new EmbedBuilder()
                .setTitle('🔧 Comandi Overseer — Housing (cont.)')
                .setColor(0x2B2D31)
                .addFields(
                    { name: '📢 !pubblico', value: 'Usalo dentro una casa per renderla pubblica (tutti possono vederla in sola lettura) o riportarla privata. Toggle.' },
                    { name: '🚚 !sposta @utente1 @utente2 ... #canale', value: 'Sposta uno o più utenti in un canale casa. Es: `!sposta @Tizio @Caio #casa-5`' },
                    { name: '📍 !dove @utente', value: 'Mostra in quale casa/case si trova fisicamente un giocatore. Segnala se è presente in più case contemporaneamente.' },
                    { name: '👁️ !multipla @utente #casa1 si narra #casa2 no ...', value: 'Aggiunge un giocatore come osservatore in più case. `si`=scrittura, `no`=lettura, `narra`=messaggio di entrata, `muto`=silenzioso.' },
                    { name: '🚪 !ritirata @utente #casa1 narra [si/no]', value: 'Rimuove un giocatore da case specifiche. `narra`=messaggio di uscita. `si/no` alla fine aggiorna i permessi delle case restanti.' },
                    { name: '🗑️ !cancella knock @utente', value: 'Rimuove tutti i knock pendenti e attivi per un utente specifico.' },
                    { name: '🗑️ !cancella knock tutti', value: 'Rimuove TUTTI i knock pendenti e attivi di tutti i giocatori.' },
                    { name: '🗑️ !cancella casa', value: 'Rimuove TUTTE le proprietà delle case. Nessun giocatore avrà più una casa assegnata.' },
                    { name: '🏠 !ritorno', value: 'Riporta TUTTI i giocatori alive/sponsor alla propria casa. Chi non ha casa viene aggiunto alla lista morti automaticamente.' },
                    { name: '📊 !ram', value: 'Mostra statistiche del server: memoria heap, RSS, stato MongoDB, uptime. Alias: `!memoria`' },
                    { name: '🔄 !trasferimento si/no', value: 'Abilita o disabilita i trasferimenti per i giocatori. Se disabilitato, possono trasferirsi solo con la **Tenda** (oggetto del mercato).' },
                )
            );

            embeds.push(new EmbedBuilder()
                .setTitle('🛡️ Comandi Overseer — Moderazione')
                .setColor(0xE74C3C)
                .addFields(
                    { name: '🚫 !vb @utente', value: 'Mette un giocatore in **Visitblock**: non può usare `!bussa` e `!torna`. Automaticamente applicato anche al partner (sponsor/giocatore abbinato).' },
                    { name: '❌ !rb @utente', value: 'Mette un giocatore in **Roleblock**: non può usare `!abilità`. Automaticamente applicato anche al partner.' },
                    { name: '⛓️ !noprot @utente', value: 'Aggiunge un giocatore alla lista Non Proteggibili: non può essere protetto con `!protezione`. Automaticamente applicato anche al partner.' },
                    { name: '🛡️ !protezione @utente', value: 'Protegge un giocatore dagli attacchi. Se qualcuno lo attacca, l\'overseer vedrà un avviso prima di procedere. Automaticamente applicata anche al partner. Se il giocatore ha le catene (!noprot), la protezione fallirà.' },
                    { name: '⚔️ !attacco @utente', value: 'Attacca un giocatore. Se è protetto, mostra opzioni (rimuovi protezione / aggiungi a lista morti). Se non è protetto, lo aggiunge direttamente alla lista morti e rimuove casa + accesso.' },
                    { name: '🧹 !cura vb @utente', value: 'Rimuove un giocatore da Visitblock (e il suo partner).' },
                    { name: '🧹 !cura rb @utente', value: 'Rimuove un giocatore da Roleblock (e il suo partner).' },
                    { name: '🧹 !cura protezione @utente', value: 'Rimuove la protezione da un giocatore (e dal suo partner).' },
                    { name: '🧹 !cura noprot @utente', value: 'Rimuove un giocatore dalla lista Non Proteggibili (e il suo partner).' },
                    { name: '🧹 !cura tutto', value: 'Pulisce TUTTE le liste globalmente (Visitblock, Roleblock, Protezione, Non Proteggibili) senza specificare utente.' },
                    { name: '⚰️ !morte', value: 'Processa TUTTI i giocatori nella lista morti: cambia ruolo (Alive→Dead, Sponsor→Sponsor Dead), rimuove da case, cancella azioni in coda, annuncia la morte nelle case.' },
                    { name: '📋 !osab', value: 'Pannello interattivo per gestire le liste VB, RB, Protezione e Non Proteggibili. Permette di visualizzare e rimuovere singoli giocatori con bottoni.' },
                )
            );

            embeds.push(new EmbedBuilder()
                .setTitle('👥 Comandi Overseer — Meeting & Tabella')
                .setColor(0x3498DB)
                .addFields(
                    { name: '🚪 !entrata', value: 'Toggle auto-ruolo all\'ingresso nel server meeting. Quando è attivo, assegna ruoli automaticamente ai nuovi membri.' },
                    { name: '📋 !tabella [numero]', value: 'Crea una tabella di iscrizioni con X slot. I giocatori e sponsor possono registrarsi tramite menu. Es: `!tabella 20`' },
                    { name: '🚀 !assegna', value: 'Assegna automaticamente ruoli, stanze e case ai giocatori/sponsor registrati nella tabella. Crea le chat private e saluta.' },
                    { name: '🔄 !riprendi tabella', value: 'Riapre la tabella per permettere a nuovi sponsor di registrarsi negli slot vuoti.' },
                    { name: '🔒 !chiudi tabella', value: 'Chiude la tabella e assegna automaticamente i nuovi sponsor registrati alle rispettive stanze.' },
                    { name: '⚠️ !azzeramento', value: 'Azzera i conteggi meeting e letture di tutti i giocatori. Reset completo.' },
                )
            );

            embeds.push(new EmbedBuilder()
                .setTitle('💰 Comandi Overseer — Economia')
                .setColor(0xF1C40F)
                .addFields(
                    { name: '🪙 !pagamento [importo]', value: 'Distribuisce monete a TUTTI i giocatori alive. Es: `!pagamento 100` dà 100 monete a ciascuno.' },
                    { name: '🪙 !pagamento @utente [importo]', value: 'Dà monete a un singolo giocatore. Es: `!pagamento @Tizio 50`' },
                    { name: '💵 !bilancio @utente', value: 'Mostra il bilancio dettagliato di un giocatore specifico (saldo, guadagnato, speso).' },
                    { name: '💸 !ritira @utente [importo]', value: 'Ritira monete dal bilancio di un giocatore. Es: `!ritira @Tizio 30`' },
                    { name: '🎁 !regala @utente [oggetto] [quantità]', value: 'Regala un oggetto del mercato a un giocatore. Es: `!regala @Tizio scopa 2`' },
                )
            );

            return message.channel.send({ embeds });
        }

        // !giocatori — Comandi giocatori dettagliati
        if (content === '!giocatori' && guildId === MEETING.COMMAND_GUILD) {
            const embeds = [];

            embeds.push(new EmbedBuilder()
                .setTitle('🏠 Comandi Giocatori — Housing')
                .setColor(0x2ECC71)
                .addFields(
                    { name: '✊ !bussa', value: 'Bussa alla porta di una casa per visitarla. Disponibile solo dalla tua **chat privata**. Scegli tra 3 modalità:\n• **👋 Visita Normale** — gli occupanti decidono se aprirti\n• **🧨 Visita Forzata** — entri senza permesso (consuma 1 visita forzata)\n• **🕵️ Visita Nascosta** — entri invisibilmente (consuma 1 visita nascosta)\nDopo aver scelto la modalità, seleziona la casa dal menu.' },
                    { name: '🏠 !torna', value: 'Torna alla tua casa. Disponibile solo dalla **chat privata** e solo se ti trovi in un\'altra casa. Viene messo in coda e processato in ordine cronologico.' },
                    { name: '📦 !trasferimento', value: 'Trasferisciti in una nuova casa. Usalo **dentro la casa** dove vuoi trasferirti. Se la casa ha un proprietario, serve la sua approvazione. Se non ha proprietario, il trasferimento è immediato. ⚠️ Può essere disabilitato dall\'overseer.' },
                    { name: '👥 !chi', value: 'Mostra chi è presente nella casa dove ti trovi. Indica il proprietario e gli occupanti visibili.' },
                    { name: '📊 !rimaste', value: 'Mostra quante visite ti rimangono (base, forzate, nascoste). Disponibile dalla tua chat privata.' },
                    { name: '🗑️ !rimuovi', value: 'Annulla un\'azione in coda (bussata pendente, ritorno, abilità o selezione casa attiva). Menu interattivo.' },
                    { name: '🔄 !cambio', value: 'Scambia identità con il tuo partner nella stessa chat. Lo sponsor diventa giocatore e viceversa. Include scambio di ruoli, casa, meeting, bilancio e inventario. Se lo sponsor richiede, il giocatore deve accettare.' },
                    { name: '🏚️ !case', value: 'Mostra la lista delle case attualmente distrutte.' },
                )
            );

            embeds.push(new EmbedBuilder()
                .setTitle('✨ Comandi Giocatori — Abilità')
                .setColor(0x9B59B6)
                .addFields(
                    { name: '✨ !abilità', value: 'Usa la tua abilità. Richiede il ruolo abilità (<@&' + RUOLI.ABILITA + '>). Apre un form dove descrivi cosa vuoi fare. L\'abilità viene messa in **coda** e l\'overseer la approva o la rifiuta.\n⚠️ Se sei in **Roleblock**, l\'abilità verrà annullata automaticamente.' },
                )
            );

            embeds.push(new EmbedBuilder()
                .setTitle('💰 Comandi Giocatori — Economia')
                .setColor(0xF1C40F)
                .addFields(
                    { name: '🛒 !mercato', value: 'Mostra il negozio con tutti gli oggetti disponibili, i prezzi e le descrizioni. Solo giocatori alive.' },
                    { name: '🛍️ !compra [oggetto] [quantità]', value: 'Acquista un oggetto dal mercato. Usalo nella tua **chat privata**. Es: `!compra scopa` o `!compra scarpe 2`. Il costo viene scalato dal tuo bilancio.' },
                    { name: '🎒 !inventario', value: 'Mostra tutti gli oggetti che possiedi e le relative quantità.' },
                    { name: '🎯 !usa [oggetto]', value: 'Usa un oggetto del tuo inventario. L\'azione viene messa in **coda** e processata in ordine cronologico. Oggetti disponibili:\n• **🧹 scopa** — cancella messaggi in una casa (rispondi al messaggio da cui iniziare)\n• **✉️ lettera** — invia un messaggio anonimo a un giocatore (dropdown)\n• **👟 scarpe** — +1 visita base (anche allo sponsor)\n• **📜 testamento** — permette di scrivere nei canali diurni fino a !notte (solo dead, solo durante !giorno)\n• **⛓️ catene** — applica VB + RB a un giocatore e al suo partner (dropdown)\n• **🎆 fuochi** — annuncia la tua posizione nel canale annunci\n• **⛺ tenda** — trasferisciti in una casa (funziona anche se i trasferimenti sono disabilitati)' },
                    { name: '💵 !bilancio', value: 'Mostra il tuo bilancio personale: saldo attuale, totale guadagnato e totale speso.' },
                    { name: '💸 !paga @utente [importo]', value: 'Trasferisci monete a un altro giocatore. Il saldo viene scalato dal tuo bilancio e aggiunto al destinatario. Es: `!paga @Tizio 50`' },
                    { name: '🏆 !classifica', value: 'Mostra la classifica dei 15 giocatori più ricchi.' },
                )
            );

            embeds.push(new EmbedBuilder()
                .setTitle('📋 Comandi Giocatori — Altro')
                .setColor(0x95A5A6)
                .addFields(
                    { name: '⚰️ !cimitero', value: 'Mostra la lista di tutti i giocatori morti (ruolo Dead).' },
                    { name: '👥 !meeting @giocatore', value: 'Invita un altro giocatore a un meeting privato. Servono i ruoli corretti. Lo sponsor viene aggiunto automaticamente. L\'invitato deve accettare con reazione ✅.' },
                    { name: '👁️ !lettura', value: 'Supervisiona un meeting attivo. Rispondi al messaggio verde del log meeting. Tu e il tuo sponsor osservate in sola lettura.' },
                    { name: '🛑 !fine', value: 'Chiudi il meeting in corso. Usalo dentro il canale meeting.' },
                )
            );

            return message.channel.send({ embeds });
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

                // Rename automatico: Nome (Partner)
                if (slot.player && slot.sponsor) {
                    try {
                        const playerMember = await message.guild.members.fetch(slot.player);
                        const sponsorMember = await message.guild.members.fetch(slot.sponsor);
                        
                        // Usa il nome attuale (nickname se presente, altrimenti username)
                        const playerCurrentName = playerMember.nickname || playerMember.user.username;
                        const sponsorCurrentName = sponsorMember.nickname || sponsorMember.user.username;
                        
                        // Rimuovi eventuale vecchio pattern (xxx) se esiste
                        const cleanPlayerName = playerCurrentName.replace(/\s*\([^)]*\)\s*$/g, '').trim();
                        const cleanSponsorName = sponsorCurrentName.replace(/\s*\([^)]*\)\s*$/g, '').trim();
                        
                        // Crea nuovi nickname
                        const newPlayerNick = `${cleanPlayerName} (${cleanSponsorName})`;
                        const newSponsorNick = `${cleanSponsorName} (${cleanPlayerName})`;
                        
                        // Applica solo se rientrano nel limite Discord (32 caratteri)
                        if (newPlayerNick.length <= 32) {
                            await playerMember.setNickname(newPlayerNick).catch(() => {});
                        }
                        if (newSponsorNick.length <= 32) {
                            await sponsorMember.setNickname(newSponsorNick).catch(() => {});
                        }
                    } catch (e) {
                        console.error("⚠️ Errore rename:", e.message);
                    }
                }

                assegnati++;
            }

            // --- HOUSING: Assegna case random a ogni coppia ---
            const destroyed = await db.housing.getDestroyedHouses();
            const assignedHouseIds = new Set(
                table.slots.filter(s => s.houseId).map(s => s.houseId)
            );
            const availableHouses = [...message.guild.channels.cache
                .filter(c =>
                    c.parentId === HOUSING.CATEGORIA_CASE &&
                    c.type === ChannelType.GuildText &&
                    !destroyed.includes(c.id) &&
                    !assignedHouseIds.has(c.id)
                ).values()
            ].sort(() => Math.random() - 0.5);

            let houseIndex = 0;
            let caseAssegnate = 0;
            const slotsWithHouses = table.slots.map(s => ({ ...s }));

            for (let i = 0; i < table.limit; i++) {
                const slot = slotsWithHouses[i];
                if (!slot.player) continue;

                // Se ha già una casa (da !riprendi), aggiungi solo il nuovo sponsor
                if (slot.houseId) {
                    if (slot.sponsor) {
                        const houseChannel = message.guild.channels.cache.get(slot.houseId);
                        if (houseChannel) {
                            await houseChannel.permissionOverwrites.create(slot.sponsor, { ViewChannel: true, SendMessages: true });
                            await db.housing.setHome(slot.sponsor, slot.houseId);
                        }
                    }
                    continue;
                }

                // Assegna nuova casa random
                if (houseIndex >= availableHouses.length) {
                    await message.channel.send(`⚠️ Case disponibili esaurite! Slot #${i + 1} senza casa.`);
                    continue;
                }

                const house = availableHouses[houseIndex++];
                slot.houseId = house.id;

                // Player: proprietario + permessi
                await db.housing.setHome(slot.player, house.id);
                await house.permissionOverwrites.create(slot.player, { ViewChannel: true, SendMessages: true });

                const playerMember = await message.guild.members.fetch(slot.player).catch(() => null);
                if (playerMember) {
                    const pinnedMsg = await house.send(`🔑 **${playerMember}**, questa è la tua dimora privata.`);
                    await pinnedMsg.pin();
                }

                // Sponsor: proprietario + permessi
                if (slot.sponsor) {
                    await db.housing.setHome(slot.sponsor, house.id);
                    await house.permissionOverwrites.create(slot.sponsor, { ViewChannel: true, SendMessages: true });
                }

                caseAssegnate++;
            }

            // Salva gioco e pulisci tabella (atomico)
            await db.meeting.saveGameAndClearTable(slotsWithHouses);
            await message.channel.send(`✅ Stanze configurate: ${assegnati} | 🏠 Case assegnate: ${caseAssegnate}`);
        }

        // !riprendi tabella
        if (content === '!riprendi tabella' && guildId === MEETING.COMMAND_GUILD && isAdm) {
            const currentTable = await db.meeting.getTable();
            if (currentTable.limit > 0) return message.reply("⚠️ C'è già una tabella attiva. Chiudila prima.");

            const oldSlots = await db.meeting.getActiveGameSlots();
            if (oldSlots.length === 0) return message.reply("❌ Nessun dato di gioco salvato da ripristinare.");

            const table = await db.meeting.reopenTableFromGame(null);
            if (!table) return message.reply("❌ Errore nel ripristino della tabella.");

            const embed = new EmbedBuilder()
                .setTitle('📋 Tabella Ripristinata - Iscrizione Sponsor')
                .setDescription(generateTableText(table))
                .setColor('Orange');

            const opts = Array.from({ length: table.limit }, (_, i) => ({ label: `Numero ${i + 1}`, value: `${i}` }));
            const components = [];

            // Solo menu sponsor (non giocatori)
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('select_sponsor').setPlaceholder('💰 Sponsor 1-25').addOptions(opts.slice(0, 25))
            ));
            if (table.limit > 25) {
                components.push(new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId('select_sponsor_2').setPlaceholder(`💰 Sponsor 26-${table.limit}`).addOptions(opts.slice(25, 50))
                ));
            }
            components.push(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('leave_game').setLabel('🏃 Abbandona').setStyle(ButtonStyle.Danger)
            ));

            const sentMsg = await message.channel.send({ embeds: [embed], components });
            await db.meeting.updateTableMessageId(sentMsg.id);
            message.reply("✅ Tabella ripristinata! I nuovi sponsor possono iscriversi.");
        }

        // !chiudi tabella
        if (content === '!chiudi tabella' && guildId === MEETING.COMMAND_GUILD && isAdm) {
            const table = await db.meeting.getTable();
            if (table.limit === 0) return message.reply("⚠️ Nessuna tabella attiva da chiudere.");

            const oldSlots = await db.meeting.getActiveGameSlots();

            // Processa nuovi sponsor aggiunti
            let nuoviSponsor = 0;
            for (let i = 0; i < table.slots.length; i++) {
                const slot = table.slots[i];
                const oldSlot = oldSlots[i];

                // Nuovo sponsor aggiunto (non c'era prima o è diverso)
                if (slot.sponsor && (!oldSlot?.sponsor || oldSlot.sponsor !== slot.sponsor)) {
                    const sponsorMember = await message.guild.members.fetch(slot.sponsor).catch(() => null);
                    if (!sponsorMember) continue;

                    // Aggiungi ruolo sponsor
                    try { await sponsorMember.roles.add(MEETING.ROLE_SPONSOR_AUTO); } catch {}

                    // Aggiungi alla casa del giocatore
                    const houseId = slot.houseId || oldSlot?.houseId;
                    if (houseId) {
                        const houseChannel = message.guild.channels.cache.get(houseId);
                        if (houseChannel) {
                            await houseChannel.permissionOverwrites.create(slot.sponsor, { ViewChannel: true, SendMessages: true });
                            await db.housing.setHome(slot.sponsor, houseId);
                        }
                    }

                    // Aggiungi alla stanza meeting
                    const chName = `${i + 1}`;
                    const meetingChannel = message.guild.channels.cache.find(c =>
                        c.parentId === MEETING.ROLE_CHAT_CAT && c.name === chName
                    );
                    if (meetingChannel) {
                        await meetingChannel.permissionOverwrites.edit(slot.sponsor, {
                            ViewChannel: true, SendMessages: true, ManageMessages: true,
                            CreatePrivateThreads: false, SendMessagesInThreads: false, CreatePublicThreads: false
                        });
                        await meetingChannel.send(`💰 Benvenuto <@${slot.sponsor}>!`);
                    }

                    nuoviSponsor++;
                }
            }

            // Salva e chiudi
            await db.meeting.saveGameAndClearTable([...table.slots]);

            // Cancella messaggio tabella
            if (table.messageId) {
                try {
                    const tableMsg = await message.channel.messages.fetch(table.messageId);
                    if (tableMsg) await tableMsg.delete();
                } catch {}
            }

            message.reply(`✅ Tabella chiusa. ${nuoviSponsor > 0 ? `Nuovi sponsor assegnati: ${nuoviSponsor}` : 'Nessun nuovo sponsor.'}`);
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
