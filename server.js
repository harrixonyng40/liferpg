const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

// Simple password hashing with Node crypto (for mini prototype)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const hashVerify = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === hashVerify;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database setup
const adapter = new JSONFile(path.join(__dirname, 'data', 'db.json'));
const db = new Low(adapter, { users: [], chats: [] });

async function initDB() {
  await db.read();
  db.data ||= { users: [], chats: [] };
  await db.write();
}
initDB();

// In-memory online players
const onlinePlayers = new Map(); // socketId -> userId
const userSockets = new Map();   // userId -> socketId

// Roles
const ROLES = ['Hustler', 'Flexer', 'Explorer', 'Trader', 'Fighter'];

// Jobs
const JOBS = [
  { id: 'street', name: 'Street Hustle', pay: 50, cooldown: 15, roleBonus: 'Hustler' },
  { id: 'delivery', name: 'Food Delivery', pay: 80, cooldown: 25, roleBonus: 'Hustler' },
  { id: 'content', name: 'Content Create', pay: 120, cooldown: 40, roleBonus: 'Flexer' },
  { id: 'explore', name: 'Map Scavenge', pay: 90, cooldown: 30, roleBonus: 'Explorer' },
  { id: 'trade', name: 'Quick Flip', pay: 100, cooldown: 35, roleBonus: 'Trader' },
  { id: 'gym', name: 'Gym Coaching', pay: 110, cooldown: 45, roleBonus: 'Fighter' }
];

// Shop items
const SHOP = [
  { id: 'shoes', name: 'Fresh Sneakers', price: 200, flex: 10, type: 'wear' },
  { id: 'watch', name: 'Gold Watch', price: 500, flex: 25, type: 'wear' },
  { id: 'car', name: 'Used Whip', price: 2500, flex: 80, type: 'vehicle' },
  { id: 'chain', name: 'Ice Chain', price: 800, flex: 40, type: 'wear' },
  { id: 'phone', name: 'Latest Phone', price: 600, flex: 30, type: 'gadget' },
  { id: 'apartment', name: 'City Apartment', price: 5000, flex: 150, type: 'property' }
];

// Helper: find user
function findUser(id) {
  return db.data.users.find(u => u.id === id);
}

function findUserByEmail(email) {
  return db.data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    money: u.money,
    inventory: u.inventory || [],
    flexScore: u.flexScore || 0,
    hp: u.hp || 100,
    maxHp: u.maxHp || 100,
    level: u.level || 1,
    xp: u.xp || 0,
    mapX: u.mapX || 5,
    mapY: u.mapY || 5,
    lastJob: u.lastJob || {},
    isOnline: userSockets.has(u.id)
  };
}

// ========== AUTH ROUTES ==========
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    if (!email || !password || !username) {
      return res.status(400).json({ error: 'Email, password and username required' });
    }
    if (findUserByEmail(email)) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    if (db.data.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(400).json({ error: 'Username taken' });
    }

    const hashed = hashPassword(password);
    const user = {
      id: uuidv4(),
      email,
      password: hashed,
      username,
      role: null, // choose later
      money: 100, // starting money
      inventory: [],
      flexScore: 0,
      hp: 100,
      maxHp: 100,
      level: 1,
      xp: 0,
      mapX: 5,
      mapY: 5,
      lastJob: {},
      createdAt: Date.now()
    };

    db.data.users.push(user);
    await db.write();

    res.json({ success: true, user: publicUser(user), token: user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = findUserByEmail(email);
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const match = verifyPassword(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });

    res.json({ success: true, user: publicUser(user), token: user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Choose role
app.post('/api/choose-role', async (req, res) => {
  const { token, role } = req.body;
  const user = findUser(token);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  user.role = role;
  await db.write();
  res.json({ success: true, user: publicUser(user) });
});

// ========== GAME ACTIONS ==========
app.post('/api/hustle', async (req, res) => {
  const { token, jobId } = req.body;
  const user = findUser(token);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  if (!user.role) return res.status(400).json({ error: 'Choose a role first' });

  const job = JOBS.find(j => j.id === jobId);
  if (!job) return res.status(400).json({ error: 'Invalid job' });

  const now = Date.now();
  const last = user.lastJob[jobId] || 0;
  if (now - last < job.cooldown * 1000) {
    const remaining = Math.ceil((job.cooldown * 1000 - (now - last)) / 1000);
    return res.status(400).json({ error: `Cooldown: ${remaining}s remaining` });
  }

  let pay = job.pay;
  if (user.role === job.roleBonus) pay = Math.floor(pay * 1.5); // role bonus

  user.money += pay;
  user.lastJob[jobId] = now;
  user.xp = (user.xp || 0) + 10;
  if (user.xp >= user.level * 100) {
    user.level++;
    user.xp = 0;
    user.maxHp += 10;
    user.hp = user.maxHp;
  }

  await db.write();
  broadcastLeaderboard();
  io.emit('playerUpdate', publicUser(user));

  res.json({ success: true, earned: pay, user: publicUser(user) });
});

app.post('/api/buy', async (req, res) => {
  const { token, itemId } = req.body;
  const user = findUser(token);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  const item = SHOP.find(i => i.id === itemId);
  if (!item) return res.status(400).json({ error: 'Item not found' });
  if (user.money < item.price) return res.status(400).json({ error: 'Not enough money' });

  user.money -= item.price;
  user.inventory = user.inventory || [];
  user.inventory.push({ ...item, boughtAt: Date.now() });
  user.flexScore = (user.flexScore || 0) + item.flex;

  await db.write();
  broadcastLeaderboard();
  io.emit('playerUpdate', publicUser(user));

  res.json({ success: true, user: publicUser(user) });
});

app.post('/api/send-money', async (req, res) => {
  const { token, toUsername, amount } = req.body;
  const from = findUser(token);
  if (!from) return res.status(401).json({ error: 'Not logged in' });

  const to = db.data.users.find(u => u.username.toLowerCase() === toUsername.toLowerCase());
  if (!to) return res.status(400).json({ error: 'Player not found' });
  if (from.id === to.id) return res.status(400).json({ error: 'Cannot send to yourself' });

  const amt = parseInt(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
  if (from.money < amt) return res.status(400).json({ error: 'Not enough money' });

  from.money -= amt;
  to.money += amt;

  await db.write();
  broadcastLeaderboard();
  io.emit('playerUpdate', publicUser(from));
  io.emit('playerUpdate', publicUser(to));

  // Notify receiver if online
  const toSocket = userSockets.get(to.id);
  if (toSocket) {
    io.to(toSocket).emit('moneyReceived', {
      from: from.username,
      amount: amt,
      message: `${from.username} sent you $${amt}`
    });
  }

  res.json({ success: true, user: publicUser(from) });
});

app.post('/api/move', async (req, res) => {
  const { token, dx, dy } = req.body;
  const user = findUser(token);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  const newX = Math.max(0, Math.min(9, (user.mapX || 5) + (dx || 0)));
  const newY = Math.max(0, Math.min(9, (user.mapY || 5) + (dy || 0)));
  user.mapX = newX;
  user.mapY = newY;

  // Random event chance
  let event = null;
  if (Math.random() < 0.15) {
    const events = [
      { type: 'money', amount: 30, msg: 'You found $30 on the ground!' },
      { type: 'money', amount: -20, msg: 'You got pickpocketed! -$20' },
      { type: 'xp', amount: 15, msg: 'You discovered a hidden path! +15 XP' },
      { type: 'heal', amount: 20, msg: 'You found a health pack! +20 HP' }
    ];
    event = events[Math.floor(Math.random() * events.length)];
    if (event.type === 'money') {
      user.money = Math.max(0, user.money + event.amount);
    } else if (event.type === 'xp') {
      user.xp = (user.xp || 0) + event.amount;
    } else if (event.type === 'heal') {
      user.hp = Math.min(user.maxHp, (user.hp || 100) + event.amount);
    }
  }

  await db.write();
  io.emit('playerUpdate', publicUser(user));
  res.json({ success: true, user: publicUser(user), event });
});

// Simulated real-money purchase
app.post('/api/buy-coins', async (req, res) => {
  const { token, packageId } = req.body;
  const user = findUser(token);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  const packages = {
    small: { coins: 500, price: 4.99 },
    medium: { coins: 1500, price: 9.99 },
    large: { coins: 4000, price: 19.99 }
  };
  const pack = packages[packageId];
  if (!pack) return res.status(400).json({ error: 'Invalid package' });

  // In real app: integrate Stripe here. For mini version we just add the coins.
  user.money += pack.coins;
  await db.write();
  broadcastLeaderboard();
  io.emit('playerUpdate', publicUser(user));

  res.json({
    success: true,
    message: `Simulated purchase successful! +$${pack.coins} (would cost $${pack.price} real money)`,
    user: publicUser(user)
  });
});

app.get('/api/leaderboard', async (req, res) => {
  await db.read();
  const sorted = [...db.data.users]
    .sort((a, b) => (b.money || 0) - (a.money || 0))
    .slice(0, 20)
    .map(u => ({
      username: u.username,
      role: u.role,
      money: u.money,
      flexScore: u.flexScore || 0,
      level: u.level || 1,
      isOnline: userSockets.has(u.id)
    }));
  res.json(sorted);
});

app.get('/api/shop', (req, res) => res.json(SHOP));
app.get('/api/jobs', (req, res) => res.json(JOBS));
app.get('/api/roles', (req, res) => res.json(ROLES));

function broadcastLeaderboard() {
  const sorted = [...db.data.users]
    .sort((a, b) => (b.money || 0) - (a.money || 0))
    .slice(0, 15)
    .map(u => ({
      username: u.username,
      role: u.role,
      money: u.money,
      flexScore: u.flexScore || 0,
      level: u.level || 1,
      isOnline: userSockets.has(u.id)
    }));
  io.emit('leaderboard', sorted);
}

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('authenticate', async (token) => {
    const user = findUser(token);
    if (!user) {
      socket.emit('authError', 'Invalid token');
      return;
    }

    onlinePlayers.set(socket.id, user.id);
    userSockets.set(user.id, socket.id);
    socket.userId = user.id;

    // Send current state
    socket.emit('authenticated', publicUser(user));
    broadcastOnlinePlayers();
    broadcastLeaderboard();

    // Recent chat
    const recent = (db.data.chats || []).slice(-50);
    socket.emit('chatHistory', recent);
  });

  socket.on('chat', async (msg) => {
    if (!socket.userId) return;
    const user = findUser(socket.userId);
    if (!user) return;

    const chatMsg = {
      id: uuidv4(),
      username: user.username,
      role: user.role,
      text: String(msg).slice(0, 300),
      time: Date.now()
    };
    db.data.chats = db.data.chats || [];
    db.data.chats.push(chatMsg);
    if (db.data.chats.length > 200) db.data.chats = db.data.chats.slice(-200);
    await db.write();

    io.emit('chat', chatMsg);
  });

  // Combat challenge
  socket.on('challenge', (targetUsername) => {
    if (!socket.userId) return;
    const from = findUser(socket.userId);
    const to = db.data.users.find(u => u.username.toLowerCase() === targetUsername.toLowerCase());
    if (!to || !from) return;

    const toSocketId = userSockets.get(to.id);
    if (!toSocketId) {
      socket.emit('combatError', 'Player is offline');
      return;
    }

    io.to(toSocketId).emit('incomingChallenge', {
      from: from.username,
      fromId: from.id,
      level: from.level
    });
  });

  socket.on('acceptChallenge', (fromId) => {
    if (!socket.userId) return;
    const me = findUser(socket.userId);
    const opponent = findUser(fromId);
    if (!me || !opponent) return;

    // Simple combat: both deal damage based on level + random
    const myDmg = Math.floor(Math.random() * 20) + (me.level * 5) + 10;
    const oppDmg = Math.floor(Math.random() * 20) + (opponent.level * 5) + 10;

    me.hp = Math.max(0, (me.hp || 100) - oppDmg);
    opponent.hp = Math.max(0, (opponent.hp || 100) - myDmg);

    let resultMsg = '';
    let winner = null;

    if (me.hp <= 0 && opponent.hp <= 0) {
      resultMsg = 'It\'s a draw! Both knocked out.';
    } else if (me.hp <= 0) {
      resultMsg = `${opponent.username} wins!`;
      winner = opponent;
      // small reward
      opponent.money += 50;
      me.money = Math.max(0, me.money - 20);
    } else if (opponent.hp <= 0) {
      resultMsg = `${me.username} wins!`;
      winner = me;
      me.money += 50;
      opponent.money = Math.max(0, opponent.money - 20);
    } else {
      resultMsg = `Fight continues! You dealt ${myDmg}, took ${oppDmg}`;
    }

    db.write();

    const meSocket = userSockets.get(me.id);
    const oppSocket = userSockets.get(opponent.id);

    const payload = {
      me: publicUser(me),
      opponent: publicUser(opponent),
      myDmg,
      oppDmg,
      resultMsg,
      winner: winner ? winner.username : null
    };

    if (meSocket) io.to(meSocket).emit('combatResult', payload);
    if (oppSocket) io.to(oppSocket).emit('combatResult', payload);

    io.emit('playerUpdate', publicUser(me));
    io.emit('playerUpdate', publicUser(opponent));
    broadcastLeaderboard();
  });

  socket.on('declineChallenge', (fromId) => {
    const fromSocket = userSockets.get(fromId);
    if (fromSocket) {
      io.to(fromSocket).emit('challengeDeclined');
    }
  });

  socket.on('heal', async () => {
    if (!socket.userId) return;
    const user = findUser(socket.userId);
    if (!user) return;
    if (user.money < 50) {
      socket.emit('errorMsg', 'Need $50 to heal');
      return;
    }
    user.money -= 50;
    user.hp = user.maxHp || 100;
    await db.write();
    socket.emit('playerUpdate', publicUser(user));
    io.emit('playerUpdate', publicUser(user));
  });

  socket.on('disconnect', () => {
    const userId = onlinePlayers.get(socket.id);
    if (userId) {
      onlinePlayers.delete(socket.id);
      userSockets.delete(userId);
      broadcastOnlinePlayers();
    }
    console.log('Socket disconnected:', socket.id);
  });
});

function broadcastOnlinePlayers() {
  const list = [];
  for (const [uid] of userSockets) {
    const u = findUser(uid);
    if (u) list.push(publicUser(u));
  }
  io.emit('onlinePlayers', list);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Life RPG Simulator running on http://localhost:${PORT}`);
});
