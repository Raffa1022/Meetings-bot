// ==========================================
// 🚀 APP.JS - Entry Point
// Orchestratore di tutti i moduli
// ==========================================
const { Client, GatewayIntentBits, Partials, Options } = require('discord.js');
const express = require('express');

const { TOKEN, PORT, PREFIX } = require('./config');
const { connectDB } = require('./database');
const handleAdminCommand = require('./adminCommands');
const registerPlayerCommands = require('./playerCommands');
const registerKnockInteractions = require('./knockInteractions');
const initQueueSystem = require('./queueSystem');
const initMeetingSystem = require('./meetingSystem');
const initAbilitySystem = require('./abilitySystem');
const initModerationSystem = require('./moderationSystem'); // FIX: Aggiunto import mancante
const initEconomySystem = require('./economySystem');       // 💰 Economy System
const { isAdmin } = require('./helpers');

// --- WEB SERVER (UptimeRobot) ---
const app = express();
app.get('/', (_, res) => res.send('Bot System Online - MongoDB First'));
app.listen(PORT, () => console.log(`🌍 Web Server porta ${PORT}`));

// --- CLIENT DISCORD ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
    makeCache: Options.cacheWithLimits({
        MessageManager: 50,
        PresenceManager: 0,
        GuildMemberManager: 50,
    }),
});

// --- ADMIN COMMAND ROUTING ---
const ADMIN_COMMANDS = new Set([
    'assegnacasa', 'visite', 'aggiunta', 'resetvisite', 'sblocca',
    'notte', 'giorno', 'distruzione', 'ricostruzione', 'pubblico',
    'sposta', 'dove', 'multipla', 'ritirata', 'ram', 'memoria', 'cancella', 'ritorno'
]);

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Route ai comandi admin (auth gestita dentro handleAdminCommand)
    if (ADMIN_COMMANDS.has(command)) {
        try {
            await handleAdminCommand(message, command, args, client);
        } catch (err) {
            console.error(`❌ Errore comando admin ${command}:`, err);
            message.reply("❌ Errore interno.").catch(() => {});
        }
    }
});

// --- AVVIO ---
(async () => {
    try {
        console.log('🚀 Avvio bot...');

        // 1. MongoDB
        await connectDB();

        // 2. Registra moduli (nessuna dipendenza circolare!)
        initQueueSystem(client);       // Ascolta eventBus
        registerPlayerCommands(client); // Emette verso eventBus
        registerKnockInteractions(client);
        initMeetingSystem(client);
        initAbilitySystem(client);
        initModerationSystem(client);  // FIX: Aggiunta inizializzazione mancante
        initEconomySystem(client);     // 💰 Economy System

        // 3. Login
        await client.login(TOKEN);

        console.log(`\n✅ Bot avviato come ${client.user?.tag}`);
        console.log('='.repeat(50));
        console.log('🏠 Housing: Operazioni atomiche MongoDB');
        console.log('🚦 Queue: Event-driven, zero dipendenze circolari');
        console.log('👥 Meeting: Attivo');
        console.log('✨ Abilità: Coda cronologica');
        console.log('🛡️ Moderazione: Attivo');
        console.log('💰 Economia: Mercato, Inventario, Shop');
        console.log('💾 Database: MongoDB-First, zero dbCache');
        console.log('='.repeat(50));

    } catch (error) {
        console.error("❌ ERRORE CRITICO:", error);
        process.exit(1);
    }
})();

// Gestione errori globali
process.on('unhandledRejection', (error) => console.error('❌ Unhandled:', error));
process.on('uncaughtException', (error) => console.error('❌ Uncaught:', error));
