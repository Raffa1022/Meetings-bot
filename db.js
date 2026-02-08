// ==========================================
// 🗄️ REPOSITORY - Operazioni Atomiche MongoDB
// NESSUN dbCache. NESSUN salvataggio completo.
// Ogni funzione fa UNA query chirurgica.
// ==========================================
const { HousingModel, MeetingModel, AbilityModel, QueueModel, ModerationModel } = require('./database');

const H_ID = { id: 'main_housing' };
const M_ID = { id: 'main_meeting' };
const MOD_ID = { id: 'main_moderation' };

// ==========================================
// 🏠 HOUSING - LETTURE
// ==========================================
const housing = {
    // --- Letture singole (lean = JS puro, no overhead Mongoose) ---
    async getHome(userId) {
        const doc = await HousingModel.findOne(H_ID, { [`playerHomes.${userId}`]: 1 }).lean();
        return doc?.playerHomes?.[userId] || null;
    },

    async getAllHomes() {
        const doc = await HousingModel.findOne(H_ID, { playerHomes: 1 }).lean();
        return doc?.playerHomes || {};
    },

    async getMode() {
        const doc = await HousingModel.findOne(H_ID, { currentMode: 1 }).lean();
        return doc?.currentMode || 'NIGHT';
    },

    async getDestroyedHouses() {
        const doc = await HousingModel.findOne(H_ID, { destroyedHouses: 1 }).lean();
        return doc?.destroyedHouses || [];
    },

    async getPlayerMode(userId) {
        const doc = await HousingModel.findOne(H_ID, { [`playerModes.${userId}`]: 1 }).lean();
        return doc?.playerModes?.[userId] || null;
    },

    async isPendingKnock(userId) {
        const doc = await HousingModel.findOne(
            { ...H_ID, pendingKnocks: userId },
            { _id: 1 }
        ).lean();
        return !!doc;
    },

    async getPendingKnocks() {
        const doc = await HousingModel.findOne(H_ID, { pendingKnocks: 1 }).lean();
        return doc?.pendingKnocks || [];
    },

    async getMultiplaHistory(userId) {
        const doc = await HousingModel.findOne(H_ID, { [`multiplaHistory.${userId}`]: 1 }).lean();
        return doc?.multiplaHistory?.[userId] || [];
    },

    // Lettura composita per check visite (una sola query)
    // FIX: Default a 0 se non impostato
    async getVisitInfo(userId) {
        const doc = await HousingModel.findOne(H_ID, {
            currentMode: 1,
            [`playerVisits.${userId}`]: 1,
            [`baseVisits.${userId}`]: 1,
            [`extraVisits.${userId}`]: 1,
            [`extraVisitsDay.${userId}`]: 1,
            [`dayLimits.${userId}`]: 1,
            [`forcedVisits.${userId}`]: 1,
            [`hiddenVisits.${userId}`]: 1,
        }).lean();
        if (!doc) return null;

        const mode = doc.currentMode || 'NIGHT';
        let base, extra;
        if (mode === 'DAY') {
            const limits = doc.dayLimits?.[userId] || { base: 0 };
            base = limits.base !== undefined ? limits.base : 0; // FIX: Default 0
            extra = doc.extraVisitsDay?.[userId] || 0;
        } else {
            base = doc.baseVisits?.[userId] !== undefined ? doc.baseVisits[userId] : 0; // FIX: Default 0
            extra = doc.extraVisits?.[userId] || 0;
        }

        return {
            mode,
            used: doc.playerVisits?.[userId] || 0,
            base,
            extra,
            totalLimit: base + extra,
            forced: doc.forcedVisits?.[userId] || 0,
            hidden: doc.hiddenVisits?.[userId] || 0,
        };
    },

    async getLastReset() {
        const doc = await HousingModel.findOne(H_ID, { lastReset: 1 }).lean();
        return doc?.lastReset || '';
    },

    // Lettura completa per operazioni bulk (applyLimitsForMode, cambio)
    async getFullDoc() {
        return HousingModel.findOne(H_ID).lean();
    },

    // --- SCRITTURE ATOMICHE ---
    async setHome(userId, channelId) {
        return HousingModel.updateOne(H_ID, { $set: { [`playerHomes.${userId}`]: channelId } });
    },

    async removeHome(userId) {
        return HousingModel.updateOne(H_ID, { $unset: { [`playerHomes.${userId}`]: '' } });
    },

    async incrementVisit(userId) {
        return HousingModel.updateOne(H_ID, { $inc: { [`playerVisits.${userId}`]: 1 } });
    },

    async decrementForced(userId) {
        return HousingModel.updateOne(H_ID, { $inc: { [`forcedVisits.${userId}`]: -1 } });
    },

    async decrementHidden(userId) {
        return HousingModel.updateOne(H_ID, { $inc: { [`hiddenVisits.${userId}`]: -1 } });
    },

    async setVisitLimits(userId, base, forced, hidden) {
        return HousingModel.updateOne(H_ID, {
            $set: {
                [`baseVisits.${userId}`]: base,
                [`forcedLimits.${userId}`]: forced,
                [`hiddenLimits.${userId}`]: hidden,
            }
        });
    },

    async setNightForcedHidden(userId, forced, hidden) {
        return HousingModel.updateOne(H_ID, {
            $set: {
                [`forcedVisits.${userId}`]: forced,
                [`hiddenVisits.${userId}`]: hidden,
            }
        });
    },

    async setDayLimits(userId, base, forced, hidden) {
        return HousingModel.updateOne(H_ID, {
            $set: { [`dayLimits.${userId}`]: { base, forced, hidden } }
        });
    },

    async setDayForcedHidden(userId, forced, hidden) {
        return HousingModel.updateOne(H_ID, {
            $set: {
                [`forcedVisits.${userId}`]: forced,
                [`hiddenVisits.${userId}`]: hidden,
            }
        });
    },

    async addExtraVisit(userId, type, amount, isDay) {
        const field = isDay
            ? (type === 'base' ? `extraVisitsDay.${userId}` : type === 'nascosta' ? `hiddenVisits.${userId}` : `forcedVisits.${userId}`)
            : (type === 'base' ? `extraVisits.${userId}` : type === 'nascosta' ? `hiddenVisits.${userId}` : `forcedVisits.${userId}`);
        return HousingModel.updateOne(H_ID, { $inc: { [field]: amount } });
    },

    async setMode(mode) {
        return HousingModel.updateOne(H_ID, { $set: { currentMode: mode } });
    },

    async setPlayerMode(userId, mode) {
        return HousingModel.updateOne(H_ID, { $set: { [`playerModes.${userId}`]: mode } });
    },

    async addPendingKnock(userId) {
        return HousingModel.updateOne(H_ID, { $addToSet: { pendingKnocks: userId } });
    },

    async removePendingKnock(userId) {
        return HousingModel.updateOne(H_ID, { $pull: { pendingKnocks: userId } });
    },

    async clearPendingKnocks() {
        return HousingModel.updateOne(H_ID, { $set: { pendingKnocks: [] } });
    },

    async setActiveKnock(userId, targetChannelId) {
        return HousingModel.updateOne(H_ID, { $set: { [`activeKnocks.${userId}`]: targetChannelId } });
    },

    async clearActiveKnock(userId) {
        return HousingModel.updateOne(H_ID, { $unset: { [`activeKnocks.${userId}`]: '' } });
    },

    async clearAllActiveKnocks() {
        return HousingModel.updateOne(H_ID, { $set: { activeKnocks: {} } });
    },

    async getActiveKnock(userId) {
        const doc = await HousingModel.findOne(H_ID, { [`activeKnocks.${userId}`]: 1 }).lean();
        return doc?.activeKnocks?.[userId] || null;
    },

    async addDestroyedHouse(channelId) {
        return HousingModel.updateOne(H_ID, { $addToSet: { destroyedHouses: channelId } });
    },

    async removeDestroyedHouse(channelId) {
        return HousingModel.updateOne(H_ID, { $pull: { destroyedHouses: channelId } });
    },

    async setLastReset(date) {
        return HousingModel.updateOne(H_ID, { $set: { lastReset: date } });
    },

    async setMultiplaHistory(userId, history) {
        return HousingModel.updateOne(H_ID, { $set: { [`multiplaHistory.${userId}`]: history } });
    },

    async addMultiplaChannel(userId, channelId) {
        return HousingModel.updateOne(H_ID, {
            $addToSet: { [`multiplaHistory.${userId}`]: channelId }
        });
    },

    // Operazione BULK per applyLimitsForMode
    async applyLimitsForMode(mode) {
        const doc = await HousingModel.findOne(H_ID, {
            playerHomes: 1, baseVisits: 1, dayLimits: 1,
            forcedLimits: 1, hiddenLimits: 1
        }).lean();
        if (!doc) return;

        const allUsers = new Set([
            ...Object.keys(doc.playerHomes || {}),
            ...Object.keys(doc.baseVisits || {}),
            ...Object.keys(doc.dayLimits || {}),
        ]);

        const setOps = {};
        allUsers.forEach(userId => {
            if (mode === 'DAY') {
                const limits = doc.dayLimits?.[userId] || { forced: 0, hidden: 0 };
                setOps[`forcedVisits.${userId}`] = limits.forced || 0;
                setOps[`hiddenVisits.${userId}`] = limits.hidden || 0;
            } else {
                setOps[`forcedVisits.${userId}`] = doc.forcedLimits?.[userId] || 0;
                setOps[`hiddenVisits.${userId}`] = doc.hiddenLimits?.[userId] || 0;
            }
        });

        return HousingModel.updateOne(H_ID, {
            $set: { playerVisits: {}, ...setOps }
        });
    },

    // Operazione BULK per resetVisite
    async resetAllVisits() {
        const mode = await housing.getMode();
        await HousingModel.updateOne(H_ID, {
            $set: { extraVisits: {}, extraVisitsDay: {}, playerVisits: {} }
        });
        return housing.applyLimitsForMode(mode);
    },

    // Operazione ATOMICA per swap dati tra 2 player
    async swapPlayerData(p1Id, p2Id) {
        const doc = await HousingModel.findOne(H_ID).lean();
        if (!doc) return;

        const swapKeys = [
            'playerVisits', 'baseVisits', 'forcedLimits', 'hiddenLimits',
            'dayLimits', 'forcedVisits', 'hiddenVisits', 'extraVisits', 'extraVisitsDay',
            'activeKnocks'
        ];

        const setOps = {};
        const unsetOps = {};

        swapKeys.forEach(key => {
            const obj = doc[key] || {};
            const v1 = obj[p1Id];
            const v2 = obj[p2Id];

            if (v2 !== undefined) setOps[`${key}.${p1Id}`] = v2;
            else unsetOps[`${key}.${p1Id}`] = '';

            if (v1 !== undefined) setOps[`${key}.${p2Id}`] = v1;
            else unsetOps[`${key}.${p2Id}`] = '';
        });

        const update = {};
        if (Object.keys(setOps).length) update.$set = setOps;
        if (Object.keys(unsetOps).length) update.$unset = unsetOps;

        if (Object.keys(update).length) {
            return HousingModel.updateOne(H_ID, update);
        }
    },

    // Rimuovi homes del proprietario di una casa ricostruita
    async removeHomesByChannel(channelId) {
        const doc = await HousingModel.findOne(H_ID, { playerHomes: 1 }).lean();
        if (!doc?.playerHomes) return [];

        const owners = Object.keys(doc.playerHomes).filter(uid => doc.playerHomes[uid] === channelId);
        if (owners.length === 0) return [];

        const unsetOps = {};
        owners.forEach(uid => { unsetOps[`playerHomes.${uid}`] = ''; });
        await HousingModel.updateOne(H_ID, { $unset: unsetOps });
        return owners;
    },

    // Trova proprietario di una casa
    async findOwner(channelId) {
        const doc = await HousingModel.findOne(H_ID, { playerHomes: 1 }).lean();
        if (!doc?.playerHomes) return null;
        return Object.keys(doc.playerHomes).find(uid => doc.playerHomes[uid] === channelId) || null;
    },

    // Rimuovi tutte le proprietà delle case
    async clearAllHomes() {
        return HousingModel.updateOne(H_ID, { $set: { playerHomes: {} } });
    },
};

// ==========================================
// 📋 CODA
// ==========================================
const queue = {
    async add(type, userId, details = {}) {
        return QueueModel.create({ type, userId, details, status: 'PENDING' });
    },

    async getPending() {
        return QueueModel.find({ status: 'PENDING' }).sort({ timestamp: 1 }).lean();
    },

    async getFirst() {
        return QueueModel.findOne({ status: 'PENDING' }).sort({ timestamp: 1 }).lean();
    },

    async remove(id) {
        return QueueModel.findByIdAndDelete(id);
    },

    async findById(id) {
        return QueueModel.findById(id).lean();
    },

    async getUserPending(userId, types = ['RETURN', 'KNOCK']) {
        return QueueModel.findOne({
            userId, status: 'PENDING', type: { $in: types }
        }).lean();
    },

    async getUserAllPending(userId) {
        return QueueModel.find({ userId, status: 'PENDING' }).lean();
    },

    async removeUserPending(userId, type) {
        return QueueModel.findOneAndDelete({ userId, status: 'PENDING', type });
    },

    async deleteUserPendingActions(userId, types = ['KNOCK', 'RETURN']) {
        return QueueModel.deleteMany({
            userId, status: 'PENDING', type: { $in: types }
        });
    },
};

// ==========================================
// 👥 MEETING - 100% ATOMICO
// ==========================================
const meeting = {
    // --- LETTURE (tutte .lean()) ---
    async getAutoRoleState() {
        const doc = await MeetingModel.findOne(M_ID, { isAutoRoleActive: 1 }).lean();
        return doc?.isAutoRoleActive || false;
    },

    async getMeetingCount(userId) {
        const doc = await MeetingModel.findOne(M_ID, { [`meetingCounts.${userId}`]: 1 }).lean();
        return doc?.meetingCounts?.[userId] || 0;
    },

    async getLetturaCount(userId) {
        const doc = await MeetingModel.findOne(M_ID, { [`letturaCounts.${userId}`]: 1 }).lean();
        return doc?.letturaCounts?.[userId] || 0;
    },

    async isUserActive(userId) {
        const doc = await MeetingModel.findOne({ ...M_ID, activeUsers: userId }, { _id: 1 }).lean();
        return !!doc;
    },

    async getActiveUsers() {
        const doc = await MeetingModel.findOne(M_ID, { activeUsers: 1 }).lean();
        return doc?.activeUsers || [];
    },

    async getTable() {
        const doc = await MeetingModel.findOne(M_ID, { table: 1 }).lean();
        return doc?.table || { limit: 0, slots: [], messageId: null };
    },

    async findSponsor(playerId) {
        const data = await MeetingModel.findOne(M_ID, { 'table.slots': 1, activeGameSlots: 1 }).lean();
        if (!data) return null;
        let slot = data.table?.slots?.find(s => s.player === playerId);
        if (slot?.sponsor) return slot.sponsor;
        slot = data.activeGameSlots?.find(s => s.player === playerId);
        return slot?.sponsor || null;
    },

    async findPlayer(sponsorId) {
        const data = await MeetingModel.findOne(M_ID, { 'table.slots': 1, activeGameSlots: 1 }).lean();
        if (!data) return null;
        let slot = data.table?.slots?.find(s => s.sponsor === sponsorId);
        if (slot?.player) return slot.player;
        slot = data.activeGameSlots?.find(s => s.sponsor === sponsorId);
        return slot?.player || null;
    },

    async getActiveGameSlots() {
        const doc = await MeetingModel.findOne(M_ID, { activeGameSlots: 1 }).lean();
        return doc?.activeGameSlots || [];
    },

    // --- SCRITTURE ATOMICHE ---
    async toggleAutoRole() {
        // Leggi stato attuale (lean), poi scrivi l'opposto atomicamente
        const current = await meeting.getAutoRoleState();
        const newState = !current;
        await MeetingModel.updateOne(M_ID, { $set: { isAutoRoleActive: newState } });
        return newState;
    },

    async resetCounts() {
        return MeetingModel.updateOne(M_ID, { $set: { meetingCounts: {}, letturaCounts: {} } });
    },

    async incrementMeetingCount(userId) {
        return MeetingModel.updateOne(M_ID, { $inc: { [`meetingCounts.${userId}`]: 1 } });
    },

    async incrementLetturaCount(userId) {
        return MeetingModel.updateOne(M_ID, { $inc: { [`letturaCounts.${userId}`]: 1 } });
    },

    async addActiveUsers(userIds) {
        return MeetingModel.updateOne(M_ID, {
            $addToSet: { activeUsers: { $each: Array.isArray(userIds) ? userIds : [userIds] } }
        });
    },

    async removeActiveUsers(userIds) {
        return MeetingModel.updateOne(M_ID, {
            $pull: { activeUsers: { $in: Array.isArray(userIds) ? userIds : [userIds] } }
        });
    },

    // Tabella: crea nuova tabella
    async createTable(limit, messageId) {
        const slots = Array(limit).fill(null).map(() => ({ player: null, sponsor: null }));
        return MeetingModel.updateOne(M_ID, {
            $set: { table: { limit, slots, messageId }, activeGameSlots: [] }
        });
    },

    // Tabella: setta un utente in uno slot (con pulizia slot precedenti)
    async setSlot(slotIndex, type, userId) {
        // 1. Leggi tabella (lean)
        const table = await meeting.getTable();
        if (table.limit === 0) return null;

        // 2. Calcola modifiche
        const setOps = {};
        // Pulisci l'utente da tutti gli slot
        table.slots.forEach((slot, i) => {
            if (slot.player === userId) setOps[`table.slots.${i}.player`] = null;
            if (slot.sponsor === userId) setOps[`table.slots.${i}.sponsor`] = null;
        });
        // Se lo slot target è già occupato, abort
        if (table.slots[slotIndex]?.[type]) return 'OCCUPIED';
        // Setta nello slot target
        setOps[`table.slots.${slotIndex}.${type}`] = userId;

        // 3. Scrivi tutto in UNA operazione atomica
        await MeetingModel.updateOne(M_ID, { $set: setOps });
        // Ritorna tabella aggiornata per il rendering
        return meeting.getTable();
    },

    // Tabella: rimuovi utente
    async removeFromSlots(userId) {
        const table = await meeting.getTable();
        if (table.limit === 0) return null;

        const setOps = {};
        let found = false;
        table.slots.forEach((slot, i) => {
            if (slot.player === userId) { setOps[`table.slots.${i}.player`] = null; found = true; }
            if (slot.sponsor === userId) { setOps[`table.slots.${i}.sponsor`] = null; found = true; }
        });
        if (!found) return null;
        await MeetingModel.updateOne(M_ID, { $set: setOps });
        return meeting.getTable();
    },

    // Assegna: salva gioco e resetta tabella
    async updateTableMessageId(messageId) {
        return MeetingModel.updateOne(M_ID, { $set: { 'table.messageId': messageId } });
    },

    async saveGameAndClearTable(slots) {
        return MeetingModel.updateOne(M_ID, {
            $set: {
                activeGameSlots: slots,
                table: { limit: 0, slots: [], messageId: null }
            }
        });
    },

    // Riapri tabella da activeGameSlots (per nuovi sponsor)
    async reopenTableFromGame(messageId) {
        const doc = await MeetingModel.findOne(M_ID, { activeGameSlots: 1 }).lean();
        const slots = doc?.activeGameSlots || [];
        if (slots.length === 0) return null;
        const table = { limit: slots.length, slots: slots.map(s => ({ ...s })), messageId };
        await MeetingModel.updateOne(M_ID, { $set: { table } });
        return table;
    },

    // Swap dati meeting tra 2 player (ATOMICO)
    async swapMeetingData(p1Id, p2Id) {
        const doc = await MeetingModel.findOne(M_ID, {
            meetingCounts: 1, letturaCounts: 1, activeGameSlots: 1
        }).lean();
        if (!doc) return;

        const setOps = {};
        const unsetOps = {};

        ['meetingCounts', 'letturaCounts'].forEach(key => {
            const obj = doc[key] || {};
            const v1 = obj[p1Id];
            const v2 = obj[p2Id];
            if (v2 !== undefined) setOps[`${key}.${p1Id}`] = v2;
            else unsetOps[`${key}.${p1Id}`] = '';
            if (v1 !== undefined) setOps[`${key}.${p2Id}`] = v1;
            else unsetOps[`${key}.${p2Id}`] = '';
        });

        // Swap player/sponsor in activeGameSlots
        if (doc.activeGameSlots) {
            doc.activeGameSlots.forEach((slot, i) => {
                let newPlayer = slot.player;
                let newSponsor = slot.sponsor;
                let modified = false;

                if (slot.player === p1Id) { newPlayer = p2Id; modified = true; }
                else if (slot.player === p2Id) { newPlayer = p1Id; modified = true; }

                if (slot.sponsor === p1Id) { newSponsor = p2Id; modified = true; }
                else if (slot.sponsor === p2Id) { newSponsor = p1Id; modified = true; }

                if (modified) {
                    setOps[`activeGameSlots.${i}.player`] = newPlayer;
                    setOps[`activeGameSlots.${i}.sponsor`] = newSponsor;
                }
            });
        }

        const update = {};
        if (Object.keys(setOps).length) update.$set = setOps;
        if (Object.keys(unsetOps).length) update.$unset = unsetOps;
        if (Object.keys(update).length) {
            return MeetingModel.updateOne(M_ID, update);
        }
    },
};

// ==========================================
// ✨ ABILITÀ
// ==========================================
const ability = {
    async create(userId, content) {
        return AbilityModel.create({ userId, content, status: 'QUEUED' });
    },

    async updateStatus(id, status) {
        return AbilityModel.findByIdAndUpdate(id, { status });
    },
};

// ==========================================
// 🛡️ MODERAZIONE - 100% ATOMICO
// ==========================================
const moderation = {
    // --- VB (Visitblock) ---
    async isBlockedVB(userId) {
        const doc = await ModerationModel.findOne(
            { ...MOD_ID, 'blockedVB.userId': userId }, { _id: 1 }
        ).lean();
        return !!doc;
    },

    async addBlockedVB(userId, userTag) {
        return ModerationModel.updateOne(MOD_ID, {
            $push: { blockedVB: { userId, userTag, timestamp: new Date() } }
        });
    },

    async removeBlockedVB(userId) {
        return ModerationModel.updateOne(MOD_ID, {
            $pull: { blockedVB: { userId } }
        });
    },

    async getBlockedVB() {
        const doc = await ModerationModel.findOne(MOD_ID, { blockedVB: 1 }).lean();
        return doc?.blockedVB || [];
    },

    // --- RB (Roleblock) ---
    async isBlockedRB(userId) {
        const doc = await ModerationModel.findOne(
            { ...MOD_ID, 'blockedRB.userId': userId }, { _id: 1 }
        ).lean();
        return !!doc;
    },

    async addBlockedRB(userId, userTag) {
        return ModerationModel.updateOne(MOD_ID, {
            $push: { blockedRB: { userId, userTag, timestamp: new Date() } }
        });
    },

    async removeBlockedRB(userId) {
        return ModerationModel.updateOne(MOD_ID, {
            $pull: { blockedRB: { userId } }
        });
    },

    async getBlockedRB() {
        const doc = await ModerationModel.findOne(MOD_ID, { blockedRB: 1 }).lean();
        return doc?.blockedRB || [];
    },

    // --- Protezione ---
    async isProtected(userId) {
        const doc = await ModerationModel.findOne(
            { ...MOD_ID, 'protected.userId': userId }, { _id: 1 }
        ).lean();
        return !!doc;
    },

    async addProtected(userId, userTag) {
        return ModerationModel.updateOne(MOD_ID, {
            $push: { protected: { userId, userTag, timestamp: new Date() } }
        });
    },

    async removeProtected(userId) {
        return ModerationModel.updateOne(MOD_ID, {
            $pull: { protected: { userId } }
        });
    },

    async getProtected() {
        const doc = await ModerationModel.findOne(MOD_ID, { protected: 1 }).lean();
        return doc?.protected || [];
    },

    // --- Marked for Death (Lista Morti) ---
    async isMarkedForDeath(userId) {
        const doc = await ModerationModel.findOne(
            { ...MOD_ID, 'markedForDeath.userId': userId }, { _id: 1 }
        ).lean();
        return !!doc;
    },

    async addMarkedForDeath(userId, userTag) {
        return ModerationModel.updateOne(MOD_ID, {
            $push: { markedForDeath: { userId, userTag, timestamp: new Date() } }
        });
    },

    async removeMarkedForDeath(userId) {
        return ModerationModel.updateOne(MOD_ID, {
            $pull: { markedForDeath: { userId } }
        });
    },

    async getMarkedForDeath() {
        const doc = await ModerationModel.findOne(MOD_ID, { markedForDeath: 1 }).lean();
        return doc?.markedForDeath || [];
    },

    async clearMarkedForDeath() {
        return ModerationModel.updateOne(MOD_ID, { $set: { markedForDeath: [] } });
    },
};

module.exports = { housing, queue, meeting, ability, moderation };
