// roleplay_houses_v7.2_NO_LOBBY_CLEAN.js - RIMOSSA LOBBY, SENZA HP/MONEY/LEVEL/INVENTORY

const http = require("http");
const mongoose = require("mongoose");
const { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder } = require("discord.js");

const CONFIG = {
  MONGO_URI: process.env.MONGO_URI || "mongodb://localhost/roleplay",
  HOME_GUILD: "1460740887494787259",
  HOUSES_CATEGORY: "1460741414357827747",
  PRIVATE_CHAT_CAT: "1460741413388947528",
  // LOBBY_CHANNEL rimosso
  DOOR_ROLE_ID: "1460741401435181295",
  ADMIN_ROLE_ID: "1460741401435181295",
  VISIT_TIMEOUT_MS: parseInt(process.env.VISIT_TIMEOUT) || 300000
};

mongoose.connect(CONFIG.MONGO_URI)
  .then(() => console.log("✅ MongoDB v7.2_CLEAN - No Lobby, Direct to House"))
  .catch(err => console.error("❌ MongoDB:", err));

// SCHEMI SEMPLIFICATI - Rimossi hp, money, level, inventory
const playerSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: String,
  roleChatId: String,
  currentHouseId: String,
  previousHouseId: String
});

const Player = mongoose.model("Player", playerSchema);

const houseSchema = new mongoose.Schema({
  houseId: { type: String, required: true, unique: true },
  channelId: String,
  ownerId: { type: String, required: true },
  ownerName: String,
  name: String,
  description: String,
  maxVisitors: { type: Number, default: 4 },
  visitors: [String],
  visitRequests: [{
    requesterId: String,
    requesterName: String,
    status: { type: String, default: "pending" },
    knockMessageId: String,
    timestamp: { type: Date, default: Date.now }
  }]
});

const House = mongoose.model("House", houseSchema);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers],
  partials: [Partials.Message, Partials.Channel, Partials.User]
});

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Roleplay v7.2_CLEAN - No Lobby, Direct to House");
}).listen(8007);

client.once("ready", async () => {
  console.log(`✅ v7.2_CLEAN online: ${client.user.tag}`);
  // createLobbyIfNeeded() rimosso
});

// FUNZIONI utility
async function getPlayer(userId) {
  let player = await Player.findOne({ userId });
  if (!player) {
    player = new Player({ userId, username: "Giocatore", currentHouseId: null });
    await player.save();
  }
  return player;
}

async function isHouse(channelId) {
  return await House.findOne({ channelId });
}

async function movePlayer(playerId, targetHouseId) {
  const player = await getPlayer(playerId);
  const guild = client.guilds.cache.get(CONFIG.HOME_GUILD);
  const targetHouse = await House.findOne({ houseId: targetHouseId });
  if (!targetHouse) throw new Error("Casa non registrata");
  const targetChannel = guild.channels.cache.get(targetHouse.channelId);
  if (!targetChannel) throw new Error("Canale non trovato");

  // NASCONDERE precedente
  if (player.previousHouseId && player.previousHouseId !== targetHouse.channelId) {
    const prevChannel = guild.channels.cache.get(player.previousHouseId);
    if (prevChannel && await isHouse(prevChannel.id)) {
      await prevChannel.permissionOverwrites.edit(playerId, { ViewChannel: false });
      prevChannel.send(`🚶 <@${playerId}> **esce** dalla stanza.`);
    }
  }

  // MOSTRARE target
  await targetChannel.permissionOverwrites.edit(playerId, {
    ViewChannel: true, SendMessages: true, AddReactions: true
  });
  player.previousHouseId = player.currentHouseId;
  player.currentHouseId = targetHouse.channelId;
  if (!targetHouse.visitors.includes(playerId)) {
    targetHouse.visitors.push(playerId);
  }
  await player.save();
  await targetHouse.save();
  targetChannel.send(`🚪 <@${playerId}> **entra** nella casa.`);
  return targetHouse;
}

// Timeout visita
async function startVisitTimeout(houseId, requesterId, knockMessageId) {
  setTimeout(async () => {
    const house = await House.findOne({ houseId });
    if (!house) return;
    const pendingReq = house.visitRequests.find(r => r.requesterId === requesterId && r.status === "pending");
    if (!pendingReq) return;
    pendingReq.status = "auto-accepted";
    await house.save();
    const guild = client.guilds.cache.get(CONFIG.HOME_GUILD);
    const houseChannel = guild.channels.cache.get(house.channelId);
    if (houseChannel) {
      const timeoutMsg = await houseChannel.send(`⏰ **Timeout!** <@${requesterId}> **entra automaticamente**.`);
      const knockMsg = await houseChannel.messages.fetch(knockMessageId).catch(() => null);
      if (knockMsg) knockMsg.delete();
      await movePlayer(requesterId, houseId);
    }
  }, CONFIG.VISIT_TIMEOUT_MS);
}

// MAIN MESSAGE HANDLER
client.on("messageCreate", async message => {
  if (message.author.bot) return;
  const guild = message.guild;
  if (guild.id !== CONFIG.HOME_GUILD) return;
  const member = await guild.members.fetch(message.author.id);
  const isAdmin = member.roles.cache.has(CONFIG.ADMIN_ROLE_ID);
  const channel = message.channel;

  // ADMIN: !rc #target @giocatore
  if (message.content.startsWith("!rc ") && isAdmin) {
    const targetCh = message.mentions.channels.first();
    const targetPlayer = message.mentions.users.first();
    if (!targetCh || !targetPlayer) return message.reply("`!rc #canale @giocatore`");
    const player = await getPlayer(targetPlayer.id);
    await targetCh.setParent(CONFIG.PRIVATE_CHAT_CAT);
    await targetCh.setName(`rolechat-${targetPlayer.id.slice(-4)}`);
    const perms = [
      { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      { id: targetPlayer.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
    ];
    await targetCh.permissionOverwrites.set(perms);
    player.roleChatId = targetCh.id;
    await player.save();
    await targetCh.send("🎮 **RoleChat attiva!** `!visito nome-casa` `!ritorno` `!comandi`");
    return message.reply(`✅ RoleChat <#${targetCh.id}>`);
  }

  // ADMIN: !own @giocatore - TELETRASPORTO DIRETTO
  if (message.content.startsWith("!own ") && isAdmin) {
    const targetPlayer = message.mentions.users.first();
    if (!targetPlayer) return message.reply("`!own @giocatore`");
    const houseExists = await House.findOne({ channelId: channel.id });
    if (houseExists) return message.reply("❌ Già casa!");
    const houseId = `casa-${channel.name}`;
    const player = await getPlayer(targetPlayer.id);
    const newHouse = new House({
      houseId,
      channelId: channel.id,
      ownerId: targetPlayer.id,
      ownerName: targetPlayer.username,
      name: channel.name.charAt(0).toUpperCase() + channel.name.slice(1),
      description: `Casa di ${targetPlayer.username}`,
      visitors: [targetPlayer.id]
    });
    await newHouse.save();
    await channel.send(`🏠 **Casa registrata:** ${houseId}
Proprietario: <@${targetPlayer.id}>`);
    // TELETRASPORTO DIRETTO
    await movePlayer(targetPlayer.id, houseId);
    return message.reply(`✅ <#${channel.id}> = **${houseId}**`);
  }

  // CASA VUOTA CHECK + TOC TOC
  const houseDoc = await House.findOne({ channelId: channel.id });
  if (houseDoc) {
    const content = message.content.toLowerCase();
    // APRI/RIFIUTA
    if (["apri", "rifiuta"].includes(content)) {
      if (!member.roles.cache.has(CONFIG.DOOR_ROLE_ID)) {
        return message.reply("🔒 Non autorizzato.");
      }
      const pendingReq = houseDoc.visitRequests.find(r => r.status === "pending");
      if (!pendingReq) return message.reply("Nessuno bussa.");
      const requesterId = pendingReq.requesterId;
      if (content === "apri") {
        pendingReq.status = "accepted";
        await houseDoc.save();
        await movePlayer(requesterId, houseDoc.houseId);
        return message.reply(`✅ Aperto <@${requesterId}>`);
      } else {
        pendingReq.status = "rejected";
        await houseDoc.save();
        const requester = await getPlayer(requesterId);
        const rcChannel = client.channels.cache.get(requester.roleChatId);
        if (rcChannel) rcChannel.send("🚫 **Sei stato rifiutato.**");
        return message.reply(`❌ Rifiutato <@${requesterId}>`);
      }
    }
  }

  // COMANDI GIOCATORE RoleChat
  if (message.content.startsWith("!")) {
    const player = await getPlayer(message.author.id);
    if (message.channel.id !== player.roleChatId) {
      return message.reply("🔒 Solo RoleChat!");
    }
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    switch (command) {
      case "visito":
        const houseId = args.join("-").toLowerCase();
        const house = await House.findOne({ houseId });
        if (!house) return message.reply(`❌ **${houseId}** non è casa registrata (`!own @owner`)`);
        const houseChannel = client.channels.cache.get(house.channelId);
        if (!houseChannel) return message.reply("❌ Canale perso.");
        // CASA VUOTA? ENTRA AUTO
        const houseMembers = await houseChannel.members.fetch();
        const hasDoorRole = houseMembers.some(m => m.roles.cache.has(CONFIG.DOOR_ROLE_ID));
        if (!hasDoorRole) {
          await movePlayer(message.author.id, houseId);
          houseChannel.send(`🚪 <@${message.author.id}> **entra** (casa vuota).`);
          return message.reply(`✅ **Entrata automatica** in ${house.name} (nessun custode presente)`);
        }
        // TOC TOC
        const pendingReq = house.visitRequests.find(r => r.requesterId === message.author.id && r.status === "pending");
        if (pendingReq) return message.reply("⏳ Già bussato.");
        const knockMsg = await houseChannel.send(`🔔 **Toc toc...** <@${message.author.id}> bussa!`);
        house.visitRequests.push({
          requesterId: message.author.id,
          requesterName: message.author.username,
          knockMessageId: knockMsg.id,
          status: "pending"
        });
        await house.save();
        startVisitTimeout(houseId, message.author.id, knockMsg.id);
        message.reply(`⏳ **Toc toc** ${house.name}. Timeout: ${Math.round(CONFIG.VISIT_TIMEOUT_MS/60000)}min`);
        break;
      case "ritorno":
        const ownedHouse = await House.findOne({ ownerId: message.author.id });
        if (!ownedHouse) return message.reply("🏠 Non hai case!");
        await movePlayer(message.author.id, ownedHouse.houseId);
        message.reply(`🏠 **Tornato casa tua:** <#${ownedHouse.channelId}>`);
        break;
      case "comandi":
        const embed = new EmbedBuilder()
          .setTitle("📋 Comandi")
          .setDescription("**Giocatore (RoleChat):**")
          .addFields(
            { name: "!visito casa-xyz", value: "Bussa porta", inline: false },
            { name: "!ritorno", value: "Torna casa tua", inline: true },
            { name: "!comandi", value: "Lista", inline: true }
          )
          .setColor("Blue");
        message.reply({ embeds: [embed] });
        break;
      case "status":
        const currentHouse = player.currentHouseId ? await House.findOne({ channelId: player.currentHouseId }) : null;
        const embedStatus = new EmbedBuilder()
          .setTitle("👤 Status")
          .addFields(
            { name: "🏠", value: currentHouse ? currentHouse.name : "Nessuna casa", inline: true }
          )
          .setColor("Green");
        message.reply({ embeds: [embedStatus] });
        break;
    }
  }
});

client.login('MTQ2MzU5NDkwMTAzOTIyMjg3Nw.GESAgq.BHN1CNeNhQSfnQVs6D0hjnhtVi2GDwCjTTcnQs');
