// ==========================================
// ⚙️ CONFIGURAZIONE CENTRALIZZATA
// Tutti gli ID Discord, costanti, GIF in UN SOLO POSTO
// ==========================================

module.exports = {
    // --- TOKEN & DATABASE ---
    TOKEN: process.env.TOKEN || 'MTQ2MzU5NDkwMTAzOTIyMjg3Nw.G2ZqJU.HRxjqWMs2fIwblzW2B2SUXcYhUZ8BkeWioLmss',
    MONGO_URI: (process.env.MONGO_URI || 'mongodb+srv://raffaelewwo:Canebilli12@cluster0.7snmgc1.mongodb.net/?appName=Cluster0').trim(),

    PREFIX: '!',

    // --- HOUSING ---
    HOUSING: {
        CATEGORIA_CASE: '1460741413388947528',
        CATEGORIA_CHAT_PRIVATE: '1460741414357827747',
        CATEGORIA_CHAT_DIURNA: '1460741410599866413',
        CANALE_BLOCCO_TOTALE: '1460741488815247567',
        CANALI_BLOCCO_PARZIALE: [
            '1464941042380837010', '1460741484226543840',
            '1460741486290276456', '1460741488135635030'
        ],
        CANALE_ANNUNCI: '1460741475804381184',
        DEFAULT_MAX_VISITS: 0,
    },

    // --- RUOLI ---
    RUOLI: {
        ALIVE: '1460741403331268661',       // @IDruolo1 - giocatore alive
        SPONSOR: '1460741404497019002',     // @IDruolo2 - sponsor alive
        DEAD: '1460741405722022151',        // @IDruolo3 - giocatore dead
        SPONSOR_DEAD: '1469862321563238502',     // @IDruolo4 - sponsor dead
        ABILITA: '1460741403331268661',     // Ruolo abilità
        ADMIN_QUEUE: '1460741401435181295', // Ruolo admin coda
    },

    // Gruppi di ruoli
    RUOLI_PUBBLICI: ['1460741403331268661', '1460741404497019002', '1460741405722022151', '1469862321563238502'],
    RUOLI_PERMESSI: ['1460741403331268661', '1460741404497019002', '1469862321563238502'],

    // --- CODA ---
    QUEUE: {
        CANALE_LOG: '1465768646906220700',
    },

    // --- MEETING ---
    MEETING: {
        COMMAND_GUILD: '1460740887494787259',
        TARGET_GUILD: '1463608688244822018',
        TARGET_CAT: '1463608688991273015',
        ROLE_CHAT_CAT: '1460741414357827747',
        LOG_CHANNEL: '1464941042380837010',
        WELCOME_CHANNEL: '1460740888450830501',
        ROLE_RESET: '1460741401435181295',
        ROLE_MEETING_1: '1460741403331268661',
        ROLE_MEETING_2: '1460741402672758814',
        ROLE_PLAYER_AUTO: '1460741403331268661',
        ROLE_SPONSOR_AUTO: '1460741404497019002',
        ROLE_ALT_CHECK: '1460741402672758814',
        ROLE_AUTO_JOIN: '1460741402672758814',
        MAX_MEETINGS: 3,
        MAX_READINGS: 1,
    },

    // --- GIF ---
    GIF: {
        NOTTE: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExbWl6d2w2NWhkM2QwZWR6aDZ5YW5pdmFwMjR4NGd1ZXBneGo4NmhvayZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/LMomqSiRZF3zi/giphy.gif',
        GIORNO: 'https://media.giphy.com/media/jxbtTiXsCUZQXOKP2M/giphy.gif',
        DISTRUZIONE: 'https://i.giphy.com/media/oe33xf3B50fsc/giphy.gif',
        RICOSTRUZIONE: 'https://i.giphy.com/media/3ohjUS0WqYBpczfTlm/giphy.gif',
    },

    // --- WEB SERVER ---
    PORT: process.env.PORT || 8000,
};
