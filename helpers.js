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
 * Trova il partner abbinato da spostare insieme (bidirezionale).
 * ALIVE → trova SPONSOR
 * SPONSOR → trova ALIVE
 * DEAD → trova SPONSOR_DEAD
 * SPONSOR_DEAD → trova DEAD
 * Usa il collegamento dalla tabella (activeGameSlots).
 */
async function getSponsorsToMove(member, guild) {
    const db = require('./db'); // lazy require per evitare dipendenze circolari

    // Player ALIVE → trova sponsor SPONSOR
    if (member.roles.cache.has(RUOLI.ALIVE)) {
        const sponsorId = await db.meeting.findSponsor(member.id);
        if (!sponsorId) return [];
        try {
            const sponsor = await guild.members.fetch(sponsorId);
            if (sponsor && !sponsor.user.bot && sponsor.roles.cache.has(RUOLI.SPONSOR)) {
                return [sponsor];
            }
        } catch {}
    }
    // Player DEAD → trova sponsor SPONSOR_DEAD
    else if (member.roles.cache.has(RUOLI.DEAD)) {
        const sponsorId = await db.meeting.findSponsor(member.id);
        if (!sponsorId) return [];
        try {
            const sponsor = await guild.members.fetch(sponsorId);
            if (sponsor && !sponsor.user.bot && sponsor.roles.cache.has(RUOLI.SPONSOR_DEAD)) {
                return [sponsor];
            }
        } catch {}
    }
    // Sponsor SPONSOR → trova player ALIVE
    else if (member.roles.cache.has(RUOLI.SPONSOR)) {
        const playerId = await db.meeting.findPlayer(member.id);
        if (!playerId) return [];
        try {
            const player = await guild.members.fetch(playerId);
            if (player && !player.user.bot && player.roles.cache.has(RUOLI.ALIVE)) {
                return [player];
            }
        } catch {}
    }
    // Sponsor SPONSOR_DEAD → trova player DEAD
    else if (member.roles.cache.has(RUOLI.SPONSOR_DEAD)) {
        const playerId = await db.meeting.findPlayer(member.id);
        if (!playerId) return [];
        try {
            const player = await guild.members.fetch(playerId);
            if (player && !player.user.bot && player.roles.cache.has(RUOLI.DEAD)) {
                return [player];
            }
        } catch {}
    }
    return [];
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

