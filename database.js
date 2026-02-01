const mongoose = require('mongoose');

// --- SCHEMA CASE (Ex index-19) ---
const housingSchema = new mongoose.Schema({
    id: { type: String, default: 'main_housing' }, // ID univoco per trovare il documento
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
}, { minimize: false }); // minimize: false assicura che gli oggetti vuoti {} vengano salvati

// --- SCHEMA MEETING (Ex index-20) ---
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

const HousingModel = mongoose.model('HousingData', housingSchema);
const MeetingModel = mongoose.model('MeetingData', meetingSchema);

module.exports = { HousingModel, MeetingModel };