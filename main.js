const { Client, GatewayIntentBits, Partials, Options } = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');

// IMPORT DATI
// Assicurati che in database.js ci sia QueueModel!
const { HousingModel, MeetingModel, AbilityModel, QueueModel } = require('./database'); 

// IMPORT SISTEMI
const initHousingSystem = require('./housingSystem');
const initMeetingSystem = require('./meetingSystem');
const initAbilitySystem = require('./abilitySystem');
const queueSystem = require('./queueSystem'); // <--- NUOVO IMPORT

const TOKEN = '...'; 
const MONGO_URI = '...';

const app = express();
app.get('/', (req, res) => res.send('Bot Online'));
app.listen(8000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
});

(async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB Connesso!');

        // 1. Avvia Housing e prendi l'esecutore per passarlo alla coda
        // Passiamo queueSystem dentro housingSystem così housing può aggiungere cose alla coda
        const housingExecutor = await initHousingSystem(client, HousingModel, queueSystem);
        
        // 2. Avvia la Coda (dandogli l'esecutore housing per quando tocca a lui)
        await queueSystem.init(client, QueueModel, housingExecutor);

        // 3. Altri sistemi
        await initMeetingSystem(client, MeetingModel);
        // Passiamo queueSystem anche ad abilitySystem
        await initAbilitySystem(client, AbilityModel, queueSystem);

        await client.login(TOKEN);

    } catch (error) {
        console.error("❌ Errore critico avvio:", error);
    }
})();

