const { Client, GatewayIntentBits, Partials, Options } = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');

// --- IMPORTA I MODULI ---
const { HousingModel, MeetingModel } = require('./database');
const initHousingSystem = require('./housingSystem');
const initMeetingSystem = require('./meetingSystem');

// CONFIGURAZIONE
const TOKEN = 'MTQ2MzU5NDkwMTAzOTIyMjg3Nw.G2ZqJU.HRxjqWMs2fIwblzW2B2SUXcYhUZ8BkeWioLmss'; 
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://raffaelewwo:Canebilli12@cluster0.7snmgc1.mongodb.net/?appName=Cluster0'; // Inserisci qui la stringa Mongo o usa Env Vars

// --- SERVER WEB (Per Koyeb/Render) ---
const app = express();
app.get('/', (req, res) => res.send('Bot Modular System Online'));
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
        // 1. Connetti Mongo
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB Connesso!');

        // 2. Avvia i sistemi modulari
        await initHousingSystem(client, HousingModel);
        await initMeetingSystem(client, MeetingModel);

        // 3. Login Discord
        await client.login(TOKEN);
        console.log(`🤖 Bot avviato come ${client.user ? client.user.tag : 'Token valido'}`);

    } catch (error) {
        console.error("❌ Errore critico avvio:", error);
    }
})();