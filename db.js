// ==========================================
// 🗄️ REPOSITORY - Operazioni Atomiche MongoDB
// NESSUN dbCache. NESSUN salvataggio completo.
// Ogni funzione fa UNA query chirurgica.
// ==========================================
const { 
    HousingModel, MeetingModel, AbilityModel, QueueModel, ModerationModel,
    PresetNightModel, PresetDayModel, PresetScheduledModel 
} = require('./database');

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

    async getDestroyedHousesData() {
        const doc = await HousingModel.findOne(H_ID, { destroyedHousesData: 1 }).lean();
        return doc?.destroyedHousesData || {};
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

    // 🔥 NUOVO: Lettura visite per la fase SUCCESSIVA (per preset)
    async getNextPhaseVisitInfo(userId) {
        const doc = await HousingModel.findOne(H_ID, {
            currentMode: 1,
            [`playerVisits.${userId}`]: 1,
            [`baseVisits.${userId}`]: 1,
            [`extraVisits.${userId}`]: 1,
            [`extraVisitsDay.${userId}`]: 1,
            [`dayLimits.${userId}`]: 1,
            [`forcedLimits.${userId}`]: 1,
            [`hiddenLimits.${userId}`]: 1,
        }).lean();
        if (!doc) return null;

        const currentMode = doc.currentMode || 'NIGHT';
        // Se siamo in DAY, il prossimo è NIGHT e viceversa
        const nextMode = currentMode === 'DAY' ? 'NIGHT' : 'DAY';
        
        let base, extra, forcedLimit, hiddenLimit;
        if (nextMode === 'DAY') {
            // Prossima fase è GIORNO: leggi dayLimits
            const limits = doc.dayLimits?.[userId] || { base: 0, forced: 0, hidden: 0 };
            base = limits.base !== undefined ? limits.base : 0;
            extra = doc.extraVisitsDay?.[userId] || 0;
            forcedLimit = limits.forced || 0;
            hiddenLimit = limits.hidden || 0;
        } else {
            // Prossima fase è NOTTE: leggi baseVisits + limits standard
            base = doc.baseVisits?.[userId] !== undefined ? doc.baseVisits[userId] : 0;
            extra = doc.extraVisits?.[userId] || 0;
            forcedLimit = doc.forcedLimits?.[userId] || 0;
            hiddenLimit = doc.hiddenLimits?.[userId] || 0;
        }

        return {
            nextMode,
            base,
            extra,
            totalLimit: base + extra,
            forcedLimit,
            hiddenLimit,
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

    // 🔥 NUOVO: Decrementa visite per la fase SUCCESSIVA (per preset)
    async decrementNextPhaseForcedLimit(userId) {
        const mode = await housing.getMode();
        // Se siamo in DAY, decrementiamo forcedLimits (notte)
        // Se siamo in NIGHT, decrementiamo dayLimits.forced (giorno)
        if (mode === 'DAY') {
            return HousingModel.updateOne(H_ID, { $inc: { [`forcedLimits.${userId}`]: -1 } });
        } else {
            // Per dayLimits dobbiamo fare un'operazione più complessa
            const doc = await HousingModel.findOne(H_ID, { [`dayLimits.${userId}`]: 1 }).lean();
            const current = doc?.dayLimits?.[userId] || { base: 0, forced: 0, hidden: 0 };
            current.forced = Math.max(0, (current.forced || 0) - 1);
            return HousingModel.updateOne(H_ID, { $set: { [`dayLimits.${userId}`]: current } });
        }
    },

    async decrementNextPhaseHiddenLimit(userId) {
        const mode = await housing.getMode();
        if (mode === 'DAY') {
            return HousingModel.updateOne(H_ID, { $inc: { [`hiddenLimits.${userId}`]: -1 } });
        } else {
            const doc = await HousingModel.findOne(H_ID, { [`dayLimits.${userId}`]: 1 }).lean();
            const current = doc?.dayLimits?.[userId] || { base: 0, forced: 0, hidden: 0 };
            current.hidden = Math.max(0, (current.hidden || 0) - 1);
            return HousingModel.updateOne(H_ID, { $set: { [`dayLimits.${userId}`]: current } });
        }
    },

    // 🔥 NUOVO: Decrementa visite base per la fase SUCCESSIVA (per preset normali)
    async decrementNextPhaseBaseLimit(userId) {
        const mode = await housing.getMode();
        if (mode === 'DAY') {
            // Prossima fase è NOTTE: decremento baseVisits
            return HousingModel.updateOne(H_ID, { $inc: { [`baseVisits.${userId}`]: -1 } });
        } else {
            // Prossima fase è GIORNO: decremento dayLimits.base
            const doc = await HousingModel.findOne(H_ID, { [`dayLimits.${userId}`]: 1 }).lean();
            const current = doc?.dayLimits?.[userId] || { base: 0, forced: 0, hidden: 0 };
            current.base = Math.max(0, (current.base || 0) - 1);
            return HousingModel.updateOne(H_ID, { $set: { [`dayLimits.${userId}`]: current } });
        }
    },
async incrementSpecificPhaseLimit(userId, field) {
        // field può essere: 'dayForcedLimit', 'nightForcedLimit', 'dayHiddenLimit', 'nightHiddenLimit', 'dayBaseLimit', 'nightBaseLimit'
        if (field === 'nightForcedLimit') {
            // Incrementa forced notturne
            return HousingModel.updateOne(H_ID, { $inc: { [`forcedLimits.${userId}`]: 1 } });
        } else if (field === 'nightHiddenLimit') {
            // Incrementa hidden notturne
            return HousingModel.updateOne(H_ID, { $inc: { [`hiddenLimits.${userId}`]: 1 } });
        } else if (field === 'nightBaseLimit') {
            // Incrementa base notturne
            return HousingModel.updateOne(H_ID, { $inc: { [`baseVisits.${userId}`]: 1 } });
        } else if (field === 'dayForcedLimit') {
            // Incrementa forced diurne
            const doc = await HousingModel.findOne(H_ID, { [`dayLimits.${userId}`]: 1 }).lean();
            const current = doc?.dayLimits?.[userId] || { base: 0, forced: 0, hidden: 0 };
            current.forced = (current.forced || 0) + 1;
            return HousingModel.updateOne(H_ID, { $set: { [`dayLimits.${userId}`]: current } });
        } else if (field === 'dayHiddenLimit') {
            // Incrementa hidden diurne
            const doc = await HousingModel.findOne(H_ID, { [`dayLimits.${userId}`]: 1 }).lean();
            const current = doc?.dayLimits?.[userId] || { base: 0, forced: 0, hidden: 0 };
            current.hidden = (current.hidden || 0) + 1;
            return HousingModel.updateOne(H_ID, { $set: { [`dayLimits.${userId}`]: current } });
        } else if (field === 'dayBaseLimit') {
            // Incrementa base diurne
            const doc = await HousingModel.findOne(H_ID, { [`dayLimits.${userId}`]: 1 }).lean();
            const current = doc?.dayLimits?.[userId] || { base: 0, forced: 0, hidden: 0 };
            current.base = (current.base || 0) + 1;
            return HousingModel.updateOne(H_ID, { $set: { [`dayLimits.${userId}`]: current } });
        }
    },
    async decrementNextPhaseBaseLimit(userId) {
        const mode = await housing.getMode();
        if (mode === 'DAY') {
            // Prossima fase è NOTTE: decremento baseVisits
            return HousingModel.updateOne(H_ID, { $inc: { [`baseVisits.${userId}`]: -1 } });
        } else {
            // Prossima fase è GIORNO: decremento dayLimits.base
            const doc = await HousingModel.findOne(H_ID, { [`dayLimits.${userId}`]: 1 }).lean();
            const current = doc?.dayLimits?.[userId] || { base: 0, forced: 0, hidden: 0 };
            current.base = Math.max(0, (current.base || 0) - 1);
            return HousingModel.updateOne(H_ID, { $set: { [`dayLimits.${userId}`]: current } });
        }
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

    async addDestroyedHouse(channelId, phase = null) {
        const updates = {
            $addToSet: { destroyedHouses: channelId }
        };
        
        // Se viene specificata la fase, salvo anche i metadati
        if (phase) {
            updates.$set = {
                [`destroyedHousesData.${channelId}`]: {
                    phase,
                    timestamp: new Date()
                }
            };
        }
        
        return HousingModel.updateOne(H_ID, updates);
    },

    async removeDestroyedHouse(channelId) {
        return HousingModel.updateOne(H_ID, {
            $pull: { destroyedHouses: channelId },
            $unset: { [`destroyedHousesData.${channelId}`]: '' }
        });
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

    // 🔥 MODIFICATO: NON resetta più le visite, solo le extra della fase corrente
    async resetNightVisits() {
        console.log('♻️ [Housing] Reset visite extra notturne...');
        return HousingModel.updateOne(H_ID, {
            $set: { extraVisits: {} }
        });
    },

    // 🔥 MODIFICATO: NON resetta più le visite, solo le extra della fase corrente
    async resetDayVisits() {
        console.log('♻️ [Housing] Reset visite extra diurne...');
        return HousingModel.updateOne(H_ID, {
            $set: { extraVisitsDay: {} }
        });
    },

    // 🔥 NUOVO: Resetta le visite ai valori base impostati (per !resetvisite)
    async resetVisitsToBase() {
        console.log('♻️ [Housing] Reset visite ai valori base...');
        const mode = await housing.getMode();
        
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
            $set: { 
                playerVisits: {}, 
                extraVisits: {}, 
                extraVisitsDay: {},
                ...setOps 
            }
        });
    },

    // Operazione BULK per resetVisite (LEGACY - mantenuto per compatibilità)
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

    async updateStatus(id, status) {
        return QueueModel.findByIdAndUpdate(id, { status });
    },

    async clearPending() {
        return QueueModel.deleteMany({ status: 'PENDING' });
    },

    async clearAll() {
        return QueueModel.deleteMany({});
    },

    async getAll() {
        return QueueModel.find({}).sort({ timestamp: 1 }).lean();
    },
};

// ==========================================
// 🗳️ MEETING
// ==========================================
const meeting = {
    // --- LETTURE MIRATE (una query, un campo) ---
    async getPhase() {
        const doc = await MeetingModel.findOne(M_ID, { phase: 1 }).lean();
        return doc?.phase || 'INACTIVE';
    },

    async getNumPlayers() {
        const doc = await MeetingModel.findOne(M_ID, { numPlayers: 1 }).lean();
        return doc?.numPlayers || 0;
    },

    async getTotalVotes(targetUserId) {
        const doc = await MeetingModel.findOne(M_ID, { [`votes.${targetUserId}`]: 1 }).lean();
        const arr = doc?.votes?.[targetUserId] || [];
        return arr.length;
    },

    async hasVoted(voterId) {
        const doc = await MeetingModel.findOne(M_ID, { voters: 1 }).lean();
        return (doc?.voters || []).includes(voterId);
    },

    async getVotes() {
        const doc = await MeetingModel.findOne(M_ID, { votes: 1 }).lean();
        return doc?.votes || {};
    },

    async getVoters() {
        const doc = await MeetingModel.findOne(M_ID, { voters: 1 }).lean();
        return doc?.voters || [];
    },

    async getTarget() {
        const doc = await MeetingModel.findOne(M_ID, { target: 1 }).lean();
        return doc?.target || null;
    },

    async getDoubleVoters() {
        const doc = await MeetingModel.findOne(M_ID, { doubleVoters: 1 }).lean();
        return doc?.doubleVoters || [];
    },

    async getBlockedVoters() {
        const doc = await MeetingModel.findOne(M_ID, { blockedVoters: 1 }).lean();
        return doc?.blockedVoters || [];
    },

    async getActiveGameSlots() {
        const doc = await MeetingModel.findOne(M_ID, { activeGameSlots: 1 }).lean();
        return doc?.activeGameSlots || [];
    },

    async getFullDoc() {
        return MeetingModel.findOne(M_ID).lean();
    },

    // --- SCRITTURE ATOMICHE ---
    async setPhase(phase) {
        return MeetingModel.updateOne(M_ID, { $set: { phase } });
    },

    async setNumPlayers(num) {
        return MeetingModel.updateOne(M_ID, { $set: { numPlayers: num } });
    },

    async setTarget(userId) {
        return MeetingModel.updateOne(M_ID, { $set: { target: userId } });
    },

    async addVote(targetUserId, voterId) {
        return MeetingModel.updateOne(M_ID, {
            $push: { [`votes.${targetUserId}`]: voterId },
            $addToSet: { voters: voterId }
        });
    },

    async removeVote(targetUserId, voterId) {
        return MeetingModel.updateOne(M_ID, {
            $pull: { [`votes.${targetUserId}`]: voterId, voters: voterId }
        });
    },

    async resetVotes() {
        return MeetingModel.updateOne(M_ID, {
            $set: { votes: {}, voters: [], target: null }
        });
    },

    async addDoubleVoter(userId) {
        return MeetingModel.updateOne(M_ID, { $addToSet: { doubleVoters: userId } });
    },

    async removeDoubleVoter(userId) {
        return MeetingModel.updateOne(M_ID, { $pull: { doubleVoters: userId } });
    },

    async clearDoubleVoters() {
        return MeetingModel.updateOne(M_ID, { $set: { doubleVoters: [] } });
    },

    async addBlockedVoter(userId) {
        return MeetingModel.updateOne(M_ID, { $addToSet: { blockedVoters: userId } });
    },

    async removeBlockedVoter(userId) {
        return MeetingModel.updateOne(M_ID, { $pull: { blockedVoters: userId } });
    },

    async clearBlockedVoters() {
        return MeetingModel.updateOne(M_ID, { $set: { blockedVoters: [] } });
    },

    async setActiveGameSlots(slots) {
        return MeetingModel.updateOne(M_ID, { $set: { activeGameSlots: slots } });
    },

    async updateGameSlot(slotIndex, updates) {
        const setOps = {};
        Object.keys(updates).forEach(key => {
            setOps[`activeGameSlots.${slotIndex}.${key}`] = updates[key];
        });
        return MeetingModel.updateOne(M_ID, { $set: setOps });
    },

    async clearActiveGameSlots() {
        return MeetingModel.updateOne(M_ID, { $set: { activeGameSlots: [] } });
    },

    // Operazione ATOMICA per swap tra 2 player
    async swapPlayerData(p1Id, p2Id) {
        const doc = await MeetingModel.findOne(M_ID).lean();
        if (!doc) return;

        const setOps = {};
        const unsetOps = {};

        // Swap nei votes
        ['votes', 'voters', 'doubleVoters', 'blockedVoters'].forEach(key => {
            const obj = doc[key] || {};
            const v1 = obj[p1Id];
            const v2 = obj[p2Id];
            if (v2 !== undefined) setOps[`${key}.${p1Id}`] = v2;
            else unsetOps[`${key}.${p1Id}`] = '';
            if (v1 !== undefined) setOps[`${key}.${p2Id}`] = v1;
            else unsetOps[`${key}.${p2Id}`] = '';
        });

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
        const doc = await ModerationModel.findOne({ ...MOD_ID, 'blockedVB.userId': userId }, { _id: 1 }).lean();
        return !!doc;
    },
    async addBlockedVB(userId, userTag) {
        return ModerationModel.updateOne(MOD_ID, { $push: { blockedVB: { userId, userTag, timestamp: new Date() } } });
    },
    async removeBlockedVB(userId) {
        return ModerationModel.updateOne(MOD_ID, { $pull: { blockedVB: { userId } } });
    },
    async getBlockedVB() {
        const doc = await ModerationModel.findOne(MOD_ID, { blockedVB: 1 }).lean();
        return doc?.blockedVB || [];
    },

    // --- RB (Roleblock) ---
    async isBlockedRB(userId) {
        const doc = await ModerationModel.findOne({ ...MOD_ID, 'blockedRB.userId': userId }, { _id: 1 }).lean();
        return !!doc;
    },
    async addBlockedRB(userId, userTag) {
        return ModerationModel.updateOne(MOD_ID, { $push: { blockedRB: { userId, userTag, timestamp: new Date() } } });
    },
    async removeBlockedRB(userId) {
        return ModerationModel.updateOne(MOD_ID, { $pull: { blockedRB: { userId } } });
    },
    async getBlockedRB() {
        const doc = await ModerationModel.findOne(MOD_ID, { blockedRB: 1 }).lean();
        return doc?.blockedRB || [];
    },

    // --- Protezione ---
    async isProtected(userId) {
        const doc = await ModerationModel.findOne({ ...MOD_ID, 'protected.userId': userId }, { _id: 1 }).lean();
        return !!doc;
    },
    async addProtected(userId, userTag) {
        return ModerationModel.updateOne(MOD_ID, { $push: { protected: { userId, userTag, timestamp: new Date() } } });
    },
    async removeProtected(userId) {
        return ModerationModel.updateOne(MOD_ID, { $pull: { protected: { userId } } });
    },
    async getProtected() {
        const doc = await ModerationModel.findOne(MOD_ID, { protected: 1 }).lean();
        return doc?.protected || [];
    },

    // --- Marked for Death ---
    async isMarkedForDeath(userId) {
        const doc = await ModerationModel.findOne({ ...MOD_ID, 'markedForDeath.userId': userId }, { _id: 1 }).lean();
        return !!doc;
    },
    async addMarkedForDeath(userId, userTag) {
        return ModerationModel.updateOne(MOD_ID, { $push: { markedForDeath: { userId, userTag, timestamp: new Date() } } });
    },
    async removeMarkedForDeath(userId) {
        return ModerationModel.updateOne(MOD_ID, { $pull: { markedForDeath: { userId } } });
    },
    async getMarkedForDeath() {
        const doc = await ModerationModel.findOne(MOD_ID, { markedForDeath: 1 }).lean();
        return doc?.markedForDeath || [];
    },
    async clearMarkedForDeath() {
        return ModerationModel.updateOne(MOD_ID, { $set: { markedForDeath: [] } });
    },

    // --- Unprotectable ---
    async isUnprotectable(userId) {
        const doc = await ModerationModel.findOne({ ...MOD_ID, 'unprotectable.userId': userId }, { _id: 1 }).lean();
        return !!doc;
    },
    async addUnprotectable(userId, userTag) {
        return ModerationModel.updateOne(MOD_ID, { $push: { unprotectable: { userId, userTag, timestamp: new Date() } } });
    },
    async removeUnprotectable(userId) {
        return ModerationModel.updateOne(MOD_ID, { $pull: { unprotectable: { userId } } });
    },
    async getUnprotectable() {
        const doc = await ModerationModel.findOne(MOD_ID, { unprotectable: 1 }).lean();
        return doc?.unprotectable || [];
    },

    // --- 🔥 FASE PRESET (NUOVO) ---
    async setPresetPhaseActive(active) {
        return ModerationModel.updateOne(MOD_ID, { $set: { presetPhaseActive: active } });
    },
    async isPresetPhaseActive() {
        const doc = await ModerationModel.findOne(MOD_ID, { presetPhaseActive: 1 }).lean();
        return doc?.presetPhaseActive || false;
    },
};

// ==========================================
// 📋 PRESET (PER PRESET SYSTEM)
// ==========================================
const preset = {
    // --- NIGHT ---
    async addNightPreset(userId, userName, type, category, details) {
        return PresetNightModel.create({ userId, userName, type, category, details, timestamp: new Date() });
    },
    async getAllNightPresets() {
        return PresetNightModel.find({}).sort({ timestamp: 1 }).lean();
    },
    async getUserNightPresets(userId) {
        return PresetNightModel.find({ userId }).sort({ timestamp: 1 }).lean();
    },
    async removeNightPreset(id) {
        return PresetNightModel.findByIdAndDelete(id);
    },
    async clearAllNightPresets() {
        return PresetNightModel.deleteMany({});
    },

    // --- 🔥 DAY (NUOVO) ---
    async addDayPreset(userId, userName, type, category, details) {
        return PresetDayModel.create({ userId, userName, type, category, details, timestamp: new Date() });
    },
    async getAllDayPresets() {
        return PresetDayModel.find({}).sort({ timestamp: 1 }).lean();
    },
    async getUserDayPresets(userId) {
        return PresetDayModel.find({ userId }).sort({ timestamp: 1 }).lean();
    },
    async removeDayPreset(id) {
        return PresetDayModel.findByIdAndDelete(id);
    },
    async clearAllDayPresets() {
        return PresetDayModel.deleteMany({});
    },

    // --- SCHEDULED ---
    async addScheduledPreset(userId, userName, type, category, details, triggerTime) {
        return PresetScheduledModel.create({ userId, userName, type, category, details, timestamp: new Date(), triggerTime });
    },
    async getAllScheduledPresets() {
        return PresetScheduledModel.find({}).sort({ triggerTime: 1 }).lean();
    },
    async getUserScheduledPresets(userId) {
        return PresetScheduledModel.find({ userId }).sort({ triggerTime: 1 }).lean();
    },
    async removeScheduledPreset(id) {
        return PresetScheduledModel.findByIdAndDelete(id);
    },
    async clearScheduledPresets(triggerTime) {
        return PresetScheduledModel.deleteMany({ triggerTime });
    },
    async getScheduledPresetsAtTime(triggerTime) {
        return PresetScheduledModel.find({ triggerTime }).sort({ timestamp: 1 }).lean();
    },
};


module.exports = { housing, queue, meeting, ability, moderation, preset };
