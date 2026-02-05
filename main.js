const { Client, GatewayIntentBits, Partials, Options } = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');

// --- IMPORTA I MODULI ---
const { HousingModel, MeetingModel, AbilityModel, QueueModel } = require('./database'); 

const { init: initHousingSystem } = require('./housingSystem');
const initMeetingSystem = require('./meetingSystem');
const initAbilitySystem = require('./abilitySystem');
const queueSystem = require('./queueSystem');

// CONFIGURAZIONE
const TOKEN = 'MTQ2MzU5NDkwMTAzOTIyMjg3Nw.G2ZqJU.HRxjqWMs2fIwblzW2B2SUXcYhUZ8BkeWioLmss'; 
// Usiamo .trim() per evitare l'errore "Invalid scheme" causato da spazi invisibili
const MONGO_URI = (process.env.MONGO_URI || 'mongodb+srv://raffaelewwo:Canebilli12@cluster0.7snmgc1.mongodb.net/?appName=Cluster0').trim();

// --- SERVER WEB (Per Koyeb/Render) ---
const app = express();
app.get('/', (req, res) => res.send('Bot System Online con Sistema Coda'));
app.listen(8000, () => console.log('🌍 Web Server pronto sulla porta 8000'));

// --- CLIENT DISCORD ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
    makeCache: Options.cacheWithLimits({
        MessageManager: 50,
        PresenceManager: 0,
        GuildMemberManager: 50,
    }),
});

// --- AVVIO ---
(async () => {
    try {
        console.log('🚀 Avvio del bot...');
        
        // 1. Connessione a MongoDB
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB Connesso!');

        // 2. Avvia Housing e ottieni la funzione esecutore
        // IMPORTANTE: Passiamo queueSystem come terzo parametro
        console.log('📦 Inizializzazione Housing System...');
        const housingExecutor = await initHousingSystem(client, HousingModel, queueSystem, QueueModel, AbilityModel);
        console.log('✅ Housing System caricato!');
        
        // 3. Avvia il Sistema Coda
        // Gli passiamo il client, il modello DB, e la funzione per eseguire le azioni housing
        console.log('📦 Inizializzazione Queue System...');
        await queueSystem.init(client, QueueModel, housingExecutor);
        console.log('✅ Queue System caricato!');

        // 4. Avvia il sistema Meeting
        console.log('📦 Inizializzazione Meeting System...');
        await initMeetingSystem(client, MeetingModel);
        console.log('✅ Meeting System caricato!');
        
        // 5. Avvia il sistema Abilità (passando la coda)
        console.log('📦 Inizializzazione Ability System...');
        await initAbilitySystem(client, AbilityModel, queueSystem);
        console.log('✅ Ability System caricato!');

        // 6. Login Discord
        await client.login(TOKEN);
        console.log(`✅ Bot avviato come ${client.user ? client.user.tag : 'Token valido'}`);
        console.log('');
        console.log('=================================================');
        console.log('🤖 SISTEMA COMPLETO ATTIVO!');
        console.log('=================================================');
        console.log('✨ Abilità: Coda cronologica attiva');
        console.log('🏠 Housing: Integrato con coda');
        console.log('👥 Meeting: Attivo');
        console.log('🚦 Queue: Monitoraggio attivo');
        console.log('=================================================');

    } catch (error) {
        console.error("❌ ERRORE CRITICO AVVIO:", error);
        console.error(error.stack);
        process.exit(1);
    }
})();

// Gestione errori globali
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});


