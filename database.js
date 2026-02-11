const mongoose = require('mongoose');
const { MONGO_URI } = require('./config');

// ==========================================
// 📊 SCHEMA HOUSING (Documento Singolo)
// ==========================================
const housingSchema = new mongoose.Schema({
    id: { type: String, default: 'main_housing', index: true },
    playerHomes: { type: Object, default: {} },
    playerVisits: { type: Object, default: {} },
    baseVisits: { type: Object, default: {} },
    extraVisits: { type: Object, default: {} },
    forcedLimits: { type: Object, default: {} },
    hiddenLimits: { type: Object, default: {} },
    dayLimits: { type: Object, default: {} },
    extraVisitsDay: { type: Object, default: {} },
    currentMode: { type: String, default: 'NIGHT' },
    forcedVisits: { type: Object, default: {} },
    hiddenVisits: { type: Object, default: {} },
    playerModes: { type: Object, default: {} },
    destroyedHouses: { type: Array, default: [] }, // Manteniamo per compatibilità legacy
    destroyedHousesData: { type: Object, default: {} }, // { channelId: { phase: 'NOTTE 1' | 'GIORNO 1', timestamp: Date } }
    multiplaHistory: { type: Object, default: {} },
    lastReset: { type: String, default: '' },
    pendingKnocks: { type: Array, default: [] },
    activeKnocks: { type: Object, default: {} }
}, { minimize: false, versionKey: false });

// ==========================================
// 📊 SCHEMA MEETING (Documento Singolo)
// ==========================================
const meetingSchema = new mongoose.Schema({
    id: { type: String, default: 'main_meeting', index: true },
    isAutoRoleActive: { type: Boolean, default: false },
    meetingCounts: { type: Object, default: {} },
    letturaCounts: { type: Object, default: {} },
    activeUsers: { type: Array, default: [] },
    table: {
        type: Object,
        default: { limit: 0, slots: [], messageId: null }
    },
    activeGameSlots: { type: Array, default: [] }
}, { minimize: false, versionKey: false });

// ==========================================
// 📊 SCHEMA ABILITÀ
// ==========================================
const abilitySchema = new mongoose.Schema({
    userId: { type: String, index: true },
    content: String,
    status: { type: String, default: 'QUEUED', index: true },
    timestamp: { type: Date, default: Date.now }
}, { versionKey: false });

// ==========================================
// 📊 SCHEMA CODA
// ==========================================
const queueSchema = new mongoose.Schema({
    type: { type: String, required: true, index: true },   // ABILITY, RETURN, KNOCK
    userId: { type: String, required: true, index: true },
    status: { type: String, default: 'PENDING', index: true },
    details: { type: Object, default: {} },
    timestamp: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

queueSchema.index({ status: 1, timestamp: 1 });
queueSchema.index({ userId: 1, status: 1, type: 1 });

// ==========================================
// 📊 SCHEMA MODERAZIONE (Documento Singolo)
// ==========================================
const moderationSchema = new mongoose.Schema({
    id: { type: String, default: 'main_moderation', index: true },
    blockedVB: { type: Array, default: [] },       
    blockedRB: { type: Array, default: [] },       
    protected: { type: Array, default: [] },       
    unprotectable: { type: Array, default: [] },   
    markedForDeath: { type: Array, default: [] },
    presetPhaseActive: { type: Boolean, default: false } // 🔒 BLOCCO ABILITÀ (Nuovo)
}, { minimize: false, versionKey: false });

// ==========================================
// 📊 SCHEMA PRESET NOTTURNO
// ==========================================
const presetNightSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    userName: { type: String, required: true },
    type: { type: String, required: true },
    category: { type: String, required: true },
    details: { type: Object, default: {} },
    timestamp: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

// ==========================================
// 📊 SCHEMA PRESET DIURNO (Nuovo)
// ==========================================
const presetDaySchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    userName: { type: String, required: true },
    type: { type: String, required: true },
    category: { type: String, required: true },
    details: { type: Object, default: {} },
    timestamp: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

// ==========================================
// 📊 SCHEMA PRESET PROGRAMMATO
// ==========================================
const presetScheduledSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    userName: { type: String, required: true },
    type: { type: String, required: true }, 
    category: { type: String, required: true },
    details: { type: Object, default: {} },
    timestamp: { type: Date, default: Date.now },
    triggerTime: { type: String, required: true, index: true } 
}, { versionKey: false });

// ==========================================
// 📦 MODELLI
// ==========================================
const HousingModel = mongoose.model('HousingData', housingSchema);
const MeetingModel = mongoose.model('MeetingData', meetingSchema);
const AbilityModel = mongoose.model('AbilityData', abilitySchema);
const QueueModel = mongoose.model('QueueData', queueSchema);
const ModerationModel = mongoose.model('ModerationData', moderationSchema);
const PresetNightModel = mongoose.model('PresetNightData', presetNightSchema);
const PresetDayModel = mongoose.model('PresetDayData', presetDaySchema); // Nuovo
const PresetScheduledModel = mongoose.model('PresetScheduledData', presetScheduledSchema);

// ==========================================
// 🔌 CONNESSIONE
// ==========================================
async function connectDB() {
    await mongoose.connect(MONGO_URI, {
        maxPoolSize: 5,
        minPoolSize: 1,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 30000,
    });
    console.log('✅ MongoDB connesso (pool: 5)');

    await Promise.all([
        HousingModel.findOneAndUpdate(
            { id: 'main_housing' }, { $setOnInsert: { id: 'main_housing' } },
            { upsert: true, new: true }
        ),
        MeetingModel.findOneAndUpdate(
            { id: 'main_meeting' }, { $setOnInsert: { id: 'main_meeting' } },
            { upsert: true, new: true }
        ),
        ModerationModel.findOneAndUpdate(
            { id: 'main_moderation' }, { $setOnInsert: { id: 'main_moderation', presetPhaseActive: false } },
            { upsert: true, new: true }
        ),
    ]);
    console.log('✅ Documenti singleton verificati');
}

module.exports = {
    connectDB,
    HousingModel,
    MeetingModel,
    AbilityModel,
    QueueModel,
    ModerationModel,
    PresetNightModel,
    PresetDayModel, // Export
    PresetScheduledModel,
};
