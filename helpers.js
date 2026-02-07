// ==========================================
// 🛠️ FUNZIONI HELPER RIUTILIZZABILI
// ==========================================
const { PermissionsBitField, ChannelType } = require('discord.js');
const { HOUSING, RUOLI_PERMESSI, RUOLI } = require('./config');

/**
 * Formatta nome canale: "casa-di-mario" → "CASA DI MARIO"
 */
function formatName(name) {
    return name.replace(/-/g, ' ').toUpperCase().substring(0, 25);
}

/**
 * Trova gli occupanti FISICI di una casa (hanno permessi personalizzati)
 * Esclude bot e opzionalmente un utente specifico
 */
function getOccupants(channel, excludeId = null) {
    const result = new Map();
    channel.permissionOverwrites.cache.forEach((overwrite, id) => {
        if (overwrite.type !== 1) return; // Solo Member, non Role
        const m = channel.members.get(id);
        if (!m || m.user.bot) return;
        if (excludeId && m.id === excludeId) return;
        if (!m.roles.cache.hasAny(...RUOLI_PERMESSI)) return;
        result.set(m.id, m);
    });
    return result;
}

/**
 * Trova gli sponsor da spostare insieme a un giocatore
 */
function getSponsorsToMove(player, guild) {
    if (!player.roles.cache.has(RUOLI.ALIVE) && !player.roles.cache.has(RUOLI.DEAD)) return [];

    const privateChannel = guild.channels.cache.find(c =>
        c.parentId === HOUSING.CATEGORIA_CHAT_PRIVATE &&
        c.type === ChannelType.GuildText &&
        c.permissionsFor(player).has(PermissionsBitField.Flags.ViewChannel)
    );
    if (!privateChannel) return [];

    const sponsors = [];
    privateChannel.members.forEach(member => {
        if (member.id !== player.id && !member.user.bot && member.roles.cache.has(RUOLI.SPONSOR)) {
            sponsors.push(member);
        }
    });
    return sponsors;
}

/**
 * Controlla se un utente è admin
 */
function isAdmin(member) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

/**
 * Invia messaggio e auto-cancella dopo X ms
 */
async function sendTemp(channel, content, ms = 5000) {
    const msg = await channel.send(content);
    setTimeout(() => msg.delete().catch(() => {}), ms);
    return msg;
}

/**
 * Verifica se un utente è fisicamente in una casa diversa da quella specificata
 */
function isVisitingOtherHouse(guild, userId, homeId) {
    return guild.channels.cache.some(c =>
        c.parentId === HOUSING.CATEGORIA_CASE &&
        c.type === ChannelType.GuildText &&
        c.id !== homeId &&
        c.permissionOverwrites.cache.has(userId)
    );
}

module.exports = {
    formatName,
    getOccupants,
    getSponsorsToMove,
    isAdmin,
    sendTemp,
    isVisitingOtherHouse,
};

