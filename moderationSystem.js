// ==========================================
// 🛡️ MODERATION SYSTEM - 100% ATOMICO
// vb, rb, morte, protezione, attacco, cura, osab
// Zero cache. Ogni operazione = query MongoDB.
// ==========================================
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    ChannelType, PermissionsBitField
} = require('discord.js');
const { HOUSING, RUOLI } = require('./config');
const db = require('./db');
const { isAdmin } = require('./helpers');

const PREFIX = '!';

/**
 * Trova il partner (sponsor/player) di un membro.
 * ALIVE → SPONSOR, SPONSOR → ALIVE, DEAD → SPONSOR_DEAD, SPONSOR_DEAD → DEAD
 */
async function findPartner(member, guild) {
    let partnerId = null;

    if (member.roles.cache.has(RUOLI.ALIVE) || member.roles.cache.has(RUOLI.DEAD)) {
        partnerId = await db.meeting.findSponsor(member.id);
    } else if (member.roles.cache.has(RUOLI.SPONSOR) || member.roles.cache.has(RUOLI.SPONSOR_DEAD)) {
        partnerId = await db.meeting.findPlayer(member.id);
    }

    if (!partnerId) return null;
    try {
        return await guild.members.fetch(partnerId);
    } catch { return null; }
}

module.exports = function initModerationSystem(client) {
    console.log("🛡️ [Moderation] Sistema caricato (100% atomico).");

    // --- COMANDI ---
    client.on('messageCreate', async message => {
        if (message.author.bot || !message.content.startsWith(PREFIX)) return;
        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // ===================== VB =====================
        if (command === 'vb') {
            if (!isAdmin(message.member)) return message.reply("⛔ Solo admin.");
            const mention = message.mentions.members.first();
            if (!mention) return message.reply("❌ Uso: `!vb @Utente`");

            const alreadyVB = await db.moderation.isBlockedVB(mention.id);
            if (alreadyVB) return message.reply("⚠️ Utente già in Visitblock.");

            // Aggiungi player
            await db.moderation.addBlockedVB(mention.id, mention.user.tag);
            let response = `🚫 **${mention.user.tag}** messo in Visitblock (no !bussa/!torna).`;

            // Aggiungi anche il partner
            const partner = await findPartner(mention, message.guild);
            if (partner) {
                const partnerVB = await db.moderation.isBlockedVB(partner.id);
                if (!partnerVB) {
                    await db.moderation.addBlockedVB(partner.id, partner.user.tag);
                    response += `\n🚫 Anche **${partner.user.tag}** (partner) messo in Visitblock.`;
                }
            }

            message.reply(response);
        }

        // ===================== RB =====================
        else if (command === 'rb') {
            if (!isAdmin(message.member)) return message.reply("⛔ Solo admin.");
            const mention = message.mentions.members.first();
            if (!mention) return message.reply("❌ Uso: `!rb @Utente`");

            const alreadyRB = await db.moderation.isBlockedRB(mention.id);
            if (alreadyRB) return message.reply("⚠️ Utente già in Roleblock.");

            await db.moderation.addBlockedRB(mention.id, mention.user.tag);
            let response = `🚫 **${mention.user.tag}** messo in Roleblock (no !abilità).`;

            const partner = await findPartner(mention, message.guild);
            if (partner) {
                const partnerRB = await db.moderation.isBlockedRB(partner.id);
                if (!partnerRB) {
                    await db.moderation.addBlockedRB(partner.id, partner.user.tag);
                    response += `\n🚫 Anche **${partner.user.tag}** (partner) messo in Roleblock.`;
                }
            }

            message.reply(response);
        }

        // ===================== PROTEZIONE =====================
        else if (command === 'protezione') {
            if (!isAdmin(message.member)) return message.reply("⛔ Solo admin.");
            const mention = message.mentions.members.first();
            if (!mention) return message.reply("❌ Uso: `!protezione @Utente`");

            const alreadyProt = await db.moderation.isProtected(mention.id);
            if (alreadyProt) return message.reply(`⚠️ ${mention} è già protetto.`);

            await db.moderation.addProtected(mention.id, mention.user.tag);
            let response = `🛡️ **${mention}** è attualmente protetto.`;

            const partner = await findPartner(mention, message.guild);
            if (partner) {
                const partnerProt = await db.moderation.isProtected(partner.id);
                if (!partnerProt) {
                    await db.moderation.addProtected(partner.id, partner.user.tag);
                    response += `\n🛡️ Anche **${partner}** (partner) è protetto.`;
                }
            }

            message.reply(response);
        }

        // ===================== ATTACCO =====================
        else if (command === 'attacco') {
            if (!isAdmin(message.member)) return message.reply("⛔ Solo admin.");
            const mention = message.mentions.members.first();
            if (!mention) return message.reply("❌ Uso: `!attacco @Utente`");

            const [isProt, partner] = await Promise.all([
                db.moderation.isProtected(mention.id),
                findPartner(mention, message.guild),
            ]);

            let partnerProt = false;
            if (partner) partnerProt = await db.moderation.isProtected(partner.id);

            if (isProt || partnerProt) {
                let msg = `🛡️ ⚠️ **ATTENZIONE**:`;
                if (isProt) msg += ` ${mention} È PROTETTO!`;
                if (partnerProt) msg += ` ${partner} (partner) È PROTETTO!`;
                message.reply(msg);
            } else {
                message.reply(`⚔️ **VIA LIBERA**: ${mention} NON è protetto.${partner ? ` Nemmeno ${partner} (partner).` : ''}`);
            }
        }

        // ===================== CURA =====================
        else if (command === 'cura') {
            if (!isAdmin(message.member)) return message.reply("⛔ Solo admin.");
            const type = args[0]?.toLowerCase();
            const mention = message.mentions.members.first();

            if (!mention || (type !== 'vb' && type !== 'rb' && type !== 'protezione')) {
                return message.reply("❌ Uso: `!cura vb @Utente` / `!cura rb @Utente` / `!cura protezione @Utente`");
            }

            const partner = await findPartner(mention, message.guild);

            if (type === 'vb') {
                const was = await db.moderation.isBlockedVB(mention.id);
                if (!was) return message.reply("⚠️ Utente non in Visitblock.");

                await db.moderation.removeBlockedVB(mention.id);
                let response = `✅ **${mention.user.tag}** rimosso da Visitblock.`;

                if (partner) {
                    const partnerWas = await db.moderation.isBlockedVB(partner.id);
                    if (partnerWas) {
                        await db.moderation.removeBlockedVB(partner.id);
                        response += `\n✅ Anche **${partner.user.tag}** (partner) rimosso da Visitblock.`;
                    }
                }
                message.reply(response);
            }
            else if (type === 'rb') {
                const was = await db.moderation.isBlockedRB(mention.id);
                if (!was) return message.reply("⚠️ Utente non in Roleblock.");

                await db.moderation.removeBlockedRB(mention.id);
                let response = `✅ **${mention.user.tag}** rimosso da Roleblock.`;

                if (partner) {
                    const partnerWas = await db.moderation.isBlockedRB(partner.id);
                    if (partnerWas) {
                        await db.moderation.removeBlockedRB(partner.id);
                        response += `\n✅ Anche **${partner.user.tag}** (partner) rimosso da Roleblock.`;
                    }
                }
                message.reply(response);
            }
            else if (type === 'protezione') {
                const was = await db.moderation.isProtected(mention.id);
                if (!was) return message.reply("⚠️ Utente non in Protezione.");

                await db.moderation.removeProtected(mention.id);
                let response = `✅ **${mention.user.tag}** rimosso da Protezione.`;

                if (partner) {
                    const partnerWas = await db.moderation.isProtected(partner.id);
                    if (partnerWas) {
                        await db.moderation.removeProtected(partner.id);
                        response += `\n✅ Anche **${partner.user.tag}** (partner) rimosso da Protezione.`;
                    }
                }
                message.reply(response);
            }
        }

        // ===================== MORTE =====================
        else if (command === 'morte') {
            if (!isAdmin(message.member)) return message.reply("⛔ Solo admin.");
            const targetMember = message.mentions.members.first();
            if (!targetMember) return message.reply("❌ Uso: `!morte @Utente`");

            const guild = message.guild;
            const partner = await findPartner(targetMember, guild);

            // 1. Trova TUTTE le case dove il giocatore ha overwrites
            const housesWithPlayer = guild.channels.cache.filter(c =>
                c.parentId === HOUSING.CATEGORIA_CASE &&
                c.type === ChannelType.GuildText &&
                c.permissionOverwrites.cache.has(targetMember.id)
            );

            // 2. Rimuovi da tutte le case + cancella primo pin del bot
            for (const [, house] of housesWithPlayer) {
                // Rimuovi permessi giocatore
                await house.permissionOverwrites.delete(targetMember.id).catch(() => {});

                // Rimuovi permessi partner (sponsor)
                if (partner && house.permissionOverwrites.cache.has(partner.id)) {
                    await house.permissionOverwrites.delete(partner.id).catch(() => {});
                }

                // Elimina il PRIMO messaggio pinnato del bot (ordine cronologico)
                try {
                    const pinnedMessages = await house.messages.fetchPinned();
                    const botPins = pinnedMessages
                        .filter(msg => msg.author.id === client.user.id)
                        .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
                    if (botPins.size > 0) await botPins.first().delete();
                } catch {}

                await house.send(`☠️ **${targetMember.displayName}** è morto.`);
            }

            // 3. Rimuovi proprietà casa
            await db.housing.removeHome(targetMember.id);
            if (partner) await db.housing.removeHome(partner.id);

            // 4. Cancella azioni pendenti
            await Promise.all([
                db.queue.deleteUserPendingActions(targetMember.id, ['KNOCK', 'RETURN', 'ABILITY']),
                db.housing.removePendingKnock(targetMember.id),
                db.housing.clearActiveKnock(targetMember.id),
            ]);

            // 5. Cambio ruoli: Giocatore ALIVE → DEAD
            const roleOps = [];
            if (targetMember.roles.cache.has(RUOLI.ALIVE)) {
                roleOps.push(targetMember.roles.remove(RUOLI.ALIVE).catch(() => {}));
            }
            roleOps.push(targetMember.roles.add(RUOLI.DEAD).catch(() => {}));

            // 6. Cambio ruoli: Sponsor SPONSOR → SPONSOR_DEAD
            if (partner && partner.roles.cache.has(RUOLI.SPONSOR)) {
                roleOps.push(partner.roles.remove(RUOLI.SPONSOR).catch(() => {}));
                roleOps.push(partner.roles.add(RUOLI.SPONSOR_DEAD).catch(() => {}));
            }

            await Promise.all(roleOps);

            let response = `☠️ **${targetMember.displayName}** è morto. Ruolo cambiato a <@&${RUOLI.DEAD}>.`;
            if (partner) {
                response += `\n💀 **${partner.displayName}** (sponsor) → <@&${RUOLI.SPONSOR_DEAD}>.`;
            }
            if (housesWithPlayer.size === 0) {
                response += `\n⚠️ Il giocatore non era in nessuna casa.`;
            }
            message.reply(response);
        }

        // ===================== OSAB =====================
        else if (command === 'osab') {
            if (!isAdmin(message.member)) return message.reply("⛔ Solo admin.");

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('osab_select')
                .setPlaceholder('Seleziona una lista da gestire')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Protezioni').setValue('list_protected').setEmoji('🛡️'),
                    new StringSelectMenuOptionBuilder().setLabel('Visitblock (VB)').setValue('list_vb').setEmoji('🚫'),
                    new StringSelectMenuOptionBuilder().setLabel('Roleblock (RB)').setValue('list_rb').setEmoji('❌'),
                );

            const embed = new EmbedBuilder()
                .setColor('#2F3136')
                .setTitle('⚙️ Pannello OSAB')
                .setDescription('Seleziona una categoria dal menu qui sotto per vedere e gestire le liste.');

            await message.reply({
                embeds: [embed],
                components: [new ActionRowBuilder().addComponents(selectMenu)]
            });
        }
    });

    // --- INTERAZIONI OSAB ---
    client.on('interactionCreate', async interaction => {
        // ===================== MENU OSAB =====================
        if (interaction.isStringSelectMenu() && interaction.customId === 'osab_select') {
            if (!isAdmin(interaction.member))
                return interaction.reply({ content: "❌ Solo admin.", ephemeral: true });

            const selection = interaction.values[0];
            let listData = [];
            let title = '';
            let type = '';
            let statusLabel = '';

            if (selection === 'list_vb') {
                listData = await db.moderation.getBlockedVB();
                title = '🚫 Lista Visitblock';
                type = 'vb';
                statusLabel = 'visitbloccato';
            } else if (selection === 'list_rb') {
                listData = await db.moderation.getBlockedRB();
                title = '❌ Lista Roleblock';
                type = 'rb';
                statusLabel = 'rolebloccato';
            } else if (selection === 'list_protected') {
                listData = await db.moderation.getProtected();
                title = '🛡️ Lista Protezioni';
                type = 'protected';
                statusLabel = 'protetto';
            }

            if (listData.length === 0) {
                return interaction.update({
                    embeds: [new EmbedBuilder().setTitle(title).setColor('#2F3136')
                        .setDescription("*Nessun utente in questa lista.*")],
                    components: [buildOsabMenuRow()]
                });
            }

            // Costruisci descrizione lista
            const description = listData.map((entry, i) =>
                `**${i + 1}.** <@${entry.userId}> ${statusLabel}`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setColor('#0099FF')
                .setTitle(title)
                .setDescription(description);

            // Bottoni rimozione (max 5 per riga, max 20 elementi per non superare 5 righe totali)
            const buttonRows = [];
            let currentRow = new ActionRowBuilder();

            listData.slice(0, 20).forEach((entry, index) => {
                currentRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`osab_remove_${type}_${entry.userId}`)
                        .setLabel(`❌ ${index + 1}`)
                        .setStyle(ButtonStyle.Danger)
                );

                if (currentRow.components.length === 5) {
                    buttonRows.push(currentRow);
                    currentRow = new ActionRowBuilder();
                }
            });
            if (currentRow.components.length > 0) buttonRows.push(currentRow);

            await interaction.update({
                embeds: [embed],
                components: [buildOsabMenuRow(), ...buttonRows]
            });
        }

        // ===================== BOTTONI RIMOZIONE OSAB =====================
        if (interaction.isButton() && interaction.customId.startsWith('osab_remove_')) {
            if (!isAdmin(interaction.member))
                return interaction.reply({ content: "❌ Solo admin.", ephemeral: true });

            const parts = interaction.customId.split('_');
            // osab_remove_TYPE_USERID
            const type = parts[2];
            const userId = parts[3];

            // Rimuovi atomicamente
            if (type === 'vb') await db.moderation.removeBlockedVB(userId);
            else if (type === 'rb') await db.moderation.removeBlockedRB(userId);
            else if (type === 'protected') await db.moderation.removeProtected(userId);

            // Aggiorna la vista ricaricando i dati freschi
            let listData = [];
            let title = '';
            let statusLabel = '';
            const listType = type;

            if (listType === 'vb') {
                listData = await db.moderation.getBlockedVB();
                title = '🚫 Lista Visitblock';
                statusLabel = 'visitbloccato';
            } else if (listType === 'rb') {
                listData = await db.moderation.getBlockedRB();
                title = '❌ Lista Roleblock';
                statusLabel = 'rolebloccato';
            } else if (listType === 'protected') {
                listData = await db.moderation.getProtected();
                title = '🛡️ Lista Protezioni';
                statusLabel = 'protetto';
            }

            if (listData.length === 0) {
                return interaction.update({
                    embeds: [new EmbedBuilder().setTitle(title).setColor('#00FF00')
                        .setDescription("✅ Lista vuota. Utente rimosso.")],
                    components: [buildOsabMenuRow()]
                });
            }

            const description = listData.map((entry, i) =>
                `**${i + 1}.** <@${entry.userId}> ${statusLabel}`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setColor('#0099FF')
                .setTitle(`${title} (aggiornata)`)
                .setDescription(description);

            const buttonRows = [];
            let currentRow = new ActionRowBuilder();

            listData.slice(0, 20).forEach((entry, index) => {
                currentRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`osab_remove_${listType}_${entry.userId}`)
                        .setLabel(`❌ ${index + 1}`)
                        .setStyle(ButtonStyle.Danger)
                );
                if (currentRow.components.length === 5) {
                    buttonRows.push(currentRow);
                    currentRow = new ActionRowBuilder();
                }
            });
            if (currentRow.components.length > 0) buttonRows.push(currentRow);

            await interaction.update({
                embeds: [embed],
                components: [buildOsabMenuRow(), ...buttonRows]
            });
        }
    });
};

// ==========================================
// 🛠️ HELPER
// ==========================================
function buildOsabMenuRow() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('osab_select')
            .setPlaceholder('Seleziona una lista da gestire')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Protezioni').setValue('list_protected').setEmoji('🛡️'),
                new StringSelectMenuOptionBuilder().setLabel('Visitblock (VB)').setValue('list_vb').setEmoji('🚫'),
                new StringSelectMenuOptionBuilder().setLabel('Roleblock (RB)').setValue('list_rb').setEmoji('❌'),
            )
    );
}
