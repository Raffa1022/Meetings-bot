// ==========================================
// 📡 EVENT BUS - Rompe dipendenze circolari
// Housing emette → Queue ascolta (e viceversa)
// ==========================================
const EventEmitter = require('events');

const eventBus = new EventEmitter();
eventBus.setMaxListeners(20);

module.exports = eventBus;
