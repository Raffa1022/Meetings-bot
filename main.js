const { Client, GatewayIntentBits, Partials, Options } = require('discord.js');
const mongoose = require('mongoose');
const express = require('express');

// --- IMPORTA I MODULI ---
// Importiamo tutti i modelli, incluso QueueModel per la coda
const { HousingModel, MeetingModel, AbilityModel, QueueModel } = require('./database'); 

const initHousingSystem = require('./housingSystem');
const initMeetingSystem = require('./meetingSystem');
const initAbilitySystem = require('./abilitySystem');
const queueSystem = require('./queueSystem'); // Il cervello della coda

// CONFIGURAZIONE
const TOKEN = 'MTQ2MzU5NDkwMTAzOTIyMjg3Nw.G2ZqJU.HRxjqWMs2fIwblzW2B2SUXcYhUZ8BkeWioLmss'; 
// Usiamo .trim() per evitare l'errore "Invalid scheme" causato da spazi invisibili
const MONGO_URI = (process.env.MONGO_URI || 'mongodb+srv://raffaelewwo:Canebilli12@cluster0.7snmgc1.mongodb.net/?appName=Cluster0').trim();

// --- SERVER WEB ---
const app = express();
app.get('/', (req, res) => res.send('Bot System Online'));
app.listen(8000);

// --- CLIENT DISCORD ---
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

// --- AVVIO ---
(async () => {
    try {
        // 1. Connessione a MongoDB
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB Connesso!');

        // 2. Avvia Housing e ottieni l'esecutore per la coda
        // Passiamo queueSystem a housingSystem per permettergli di aggiungere azioni
        const housingExecutor = await initHousingSystem(client, HousingModel, queueSystem);
        
        // 3. Avvia la Coda Cronologica
        // Gli diamo il modello DB e la funzione per muovere i player
        await queueSystem.init(client, QueueModel, housingExecutor);

        // 4. Avvia il sistema Meeting
        await initMeetingSystem(client, MeetingModel);
        
        // 5. Avvia il sistema Abilità (passando la coda)
        await initAbilitySystem(client, AbilityModel, queueSystem);

        // 6. Login
        await client.login(TOKEN);
        console.log(`🤖 Bot avviato con successo!`);

    } catch (error) {
        console.error("❌ Errore critico avvio:", error);
    }
})();

