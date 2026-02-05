const mongoose = require('mongoose');

// --- SCHEMA CASE (Housing) ---
const housingSchema = new mongoose.Schema({
    id: { type: String, default: 'main_housing' }, // ID univoco
    playerHomes: { type: Object, default: {} },
    playerVisits: { type: Object, default: {} },
    
    // Visite
    baseVisits: { type: Object, default: {} },
    extraVisits: { type: Object, default: {} },
    forcedLimits: { type: Object, default: {} },
    hiddenLimits: { type: Object, default: {} },
    
    // Giorno
    dayLimits: { type: Object, default: {} },
    extraVisitsDay: { type: Object, default: {} },
    
    // Stato
    currentMode: { type: String, default: 'NIGHT' },
    forcedVisits: { type: Object, default: {} },
    hiddenVisits: { type: Object, default: {} },
    playerModes: { type: Object, default: {} },
    destroyedHouses: { type: Array, default: [] },
    multiplaHistory: { type: Object, default: {} },
    lastReset: { type: String, default: '' }
}, { minimize: false });

// --- SCHEMA MEETING ---
const meetingSchema = new mongoose.Schema({
    id: { type: String, default: 'main_meeting' },
    isAutoRoleActive: { type: Boolean, default: false },
    meetingCounts: { type: Object, default: {} },
    letturaCounts: { type: Object, default: {} },
    activeUsers: { type: Array, default: [] },
    table: { 
        type: Object, 
        default: { limit: 0, slots: [], messageId: null } 
    },
    activeGameSlots: { type: Array, default: [] }
}, { minimize: false });

// --- SCHEMA ABILITÀ (NUOVO) ---
const abilitySchema = new mongoose.Schema({
    userId: String,         // Chi ha inviato la richiesta
    content: String,        // Il testo scritto nella tendina
    status: { type: String, default: 'PENDING' }, // PENDING, APPROVED, REJECTED
    adminMessageId: String, // ID del messaggio nel canale admin (per poterlo gestire)
    timestamp: { type: Date, default: Date.now }
}, { minimize: false });

// Creazione Modelli
const HousingModel = mongoose.model('HousingData', housingSchema);
const MeetingModel = mongoose.model('MeetingData', meetingSchema);
const AbilityModel = mongoose.model('AbilityData', abilitySchema);

// Export di tutti i modelli
module.exports = { HousingModel, MeetingModel, AbilityModel };
