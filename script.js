// ========== STATE ==========
let token = localStorage.getItem('lifeRpgToken') || null;
let user = null;
let socket = null;
let jobs = [];
let shop = [];
let roles = [];
let onlinePlayers = [];
let pendingChallengeFrom = null;

// ========== DOM ==========
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Screens
const authScreen = $('#auth-screen');
const roleScreen = $('#role-screen');
const gameScreen = $('#game-screen');

// ========== INIT ==========
async function init() {
  // Tabs for auth
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      $('#login-form').classList.toggle('hidden', target !== 'login');
      $('#register-form').classList.toggle('hidden', target !== 'register');
      $('#auth-error').textContent = '';
    });
  });

  // Auth forms
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    await doAuth('/api/login', { email, password });
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#reg-username').value.trim();
    const email = $('#reg-email').value.trim();
    const password = $('#reg-password').value;
    await doAuth('/api/register', { username, email, password });
  });

  // Nav panels
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.panel').forEach(p => p.classList.remove('active'));
      $(`#panel-${btn.dataset.panel}`).classList.add('active');
      if (btn.dataset.panel === 'map') renderMap();
    });
  });

  // Chat
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#chat-input').value.trim();
    if (!text || !socket) return;
    socket.emit('chat', text);
    $('#chat-input').value = '';
  });

  // Send money
  $('#send-money-btn').addEventListener('click', sendMoney);

  // Combat
  $('#challenge-btn').addEventListener('click', () => {
    const name = $('#challenge-user').value.trim();
    if (!name || !socket) return;
    socket.emit('challenge', name);
    addCombatLog(`Challenging ${name}...`);
  });

  $('#heal-btn').addEventListener('click', () => {
    if (socket) socket.emit('heal');
  });

  $('#accept-challenge').addEventListener('click', () => {
    if (pendingChallengeFrom && socket) {
      socket.emit('acceptChallenge', pendingChallengeFrom);
      closeChallengeModal();
    }
  });

  $('#decline-challenge').addEventListener('click', () => {
    if (pendingChallengeFrom && socket) {
      socket.emit('declineChallenge', pendingChallengeFrom);
      closeChallengeModal();
    }
  });

  // Buy coins modal
  $('#buy-coins-btn').addEventListener('click', () => {
    $('#coins-modal').classList.remove('hidden');
  });

  // Load static data
  await Promise.all([
    fetch('/api/jobs').then(r => r.json()).then(d => jobs = d),
    fetch('/api/shop').then(r => r.json()).then(d => shop = d),
    fetch('/api/roles').then(r => r.json()).then(d => roles = d)
  ]);

  // Auto login if token
  if (token) {
    connectSocket();
  } else {
    showScreen('auth');
  }
}

async function doAuth(url, body) {
  $('#auth-error').textContent = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      $('#auth-error').textContent = data.error || 'Error';
      return;
    }
    token = data.token;
    user = data.user;
    localStorage.setItem('lifeRpgToken', token);

    if (!user.role) {
      showRoleSelect();
    } else {
      connectSocket();
    }
  } catch (err) {
    $('#auth-error').textContent = 'Network error';
  }
}

function showRoleSelect() {
  showScreen('role');
  const container = $('#role-buttons');
  container.innerHTML = '';
  roles.forEach(role => {
    const btn = document.createElement('button');
    btn.textContent = role;
    btn.onclick = async () => {
      const res = await fetch('/api/choose-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, role })
      });
      const data = await res.json();
      if (data.success) {
        user = data.user;
        connectSocket();
      }
    };
    container.appendChild(btn);
  });
}

function connectSocket() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('authenticate', token);
  });

  socket.on('authenticated', (u) => {
    user = u;
    showScreen('game');
    updateUI();
    renderJobs();
    renderShop();
    renderInventory();
  });

  socket.on('authError', () => {
    localStorage.removeItem('lifeRpgToken');
    token = null;
    showScreen('auth');
  });

  socket.on('playerUpdate', (u) => {
    if (u.id === user.id) {
      user = u;
      updateUI();
      renderInventory();
    }
    // update online list if present
    const idx = onlinePlayers.findIndex(p => p.id === u.id);
    if (idx >= 0) onlinePlayers[idx] = u;
    renderOnline();
  });

  socket.on('leaderboard', (list) => {
    renderLeaderboard(list);
  });

  socket.on('onlinePlayers', (list) => {
    onlinePlayers = list;
    renderOnline();
    if ($('#panel-map').classList.contains('active')) renderMap();
  });

  socket.on('chatHistory', (msgs) => {
    const box = $('#chat-messages');
    box.innerHTML = '';
    msgs.forEach(addChatMsg);
  });

  socket.on('chat', addChatMsg);

  socket.on('moneyReceived', (data) => {
    addChatMsg({ username: 'System', text: data.message, time: Date.now() });
    // refresh self
    if (socket) socket.emit('authenticate', token); // simple refresh
  });

  socket.on('incomingChallenge', (data) => {
    pendingChallengeFrom = data.fromId;
    $('#challenge-text').textContent = `${data.from} (Lv.${data.level}) challenges you to a fight!`;
    $('#challenge-modal').classList.remove('hidden');
  });

  socket.on('challengeDeclined', () => {
    addCombatLog('Challenge was declined.');
  });

  socket.on('combatResult', (data) => {
    addCombatLog(data.resultMsg);
    addCombatLog(`You dealt ${data.myDmg} dmg, took ${data.oppDmg} dmg.`);
    if (data.me.id === user.id) {
      user = data.me;
      updateUI();
    }
  });

  socket.on('combatError', (msg) => addCombatLog(msg));
  socket.on('errorMsg', (msg) => alert(msg));
}

function showScreen(name) {
  authScreen.classList.add('hidden');
  roleScreen.classList.add('hidden');
  gameScreen.classList.add('hidden');
  if (name === 'auth') authScreen.classList.remove('hidden');
  if (name === 'role') roleScreen.classList.remove('hidden');
  if (name === 'game') gameScreen.classList.remove('hidden');
}

// ========== UI UPDATES ==========
function updateUI() {
  if (!user) return;
  $('#player-name').textContent = user.username;
  $('#player-role').textContent = user.role || '—';
  $('#player-level').textContent = `Lv.${user.level || 1}`;
  $('#player-money').textContent = (user.money || 0).toLocaleString();
  $('#player-hp').textContent = user.hp || 100;
  $('#player-maxhp').textContent = user.maxHp || 100;
  $('#player-flex').textContent = user.flexScore || 0;
}

function renderJobs() {
  const container = $('#jobs-list');
  container.innerHTML = '';
  jobs.forEach(job => {
    const card = document.createElement('div');
    card.className = 'job-card';
    const bonus = user && user.role === job.roleBonus ? ' (Role Bonus!)' : '';
    card.innerHTML = `
      <h4>${job.name}</h4>
      <div class="pay">+$${job.pay}${bonus}</div>
      <div class="cooldown">Cooldown: ${job.cooldown}s</div>
      <button onclick="doHustle('${job.id}')">Hustle</button>
    `;
    container.appendChild(card);
  });
}

async function doHustle(jobId) {
  const res = await fetch('/api/hustle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, jobId })
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error);
    return;
  }
  user = data.user;
  updateUI();
  // small feedback
  const btn = event.target;
  const original = btn.textContent;
  btn.textContent = `+$${data.earned}!`;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1500);
}

function renderShop() {
  const container = $('#shop-list');
  container.innerHTML = '';
  shop.forEach(item => {
    const card = document.createElement('div');
    card.className = 'shop-card';
    card.innerHTML = `
      <h4>${item.name}</h4>
      <div>$${item.price}</div>
      <div style="color:var(--accent2)">+${item.flex} Flex</div>
      <button onclick="doBuy('${item.id}')">Buy</button>
    `;
    container.appendChild(card);
  });
}

async function doBuy(itemId) {
  const res = await fetch('/api/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, itemId })
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error);
    return;
  }
  user = data.user;
  updateUI();
  renderInventory();
}

function renderInventory() {
  const container = $('#inventory-list');
  container.innerHTML = '';
  (user.inventory || []).forEach(item => {
    const el = document.createElement('div');
    el.className = 'inv-item';
    el.textContent = `${item.name} (+${item.flex} flex)`;
    container.appendChild(el);
  });
  if (!user.inventory || user.inventory.length === 0) {
    container.innerHTML = '<span style="color:var(--muted)">Empty – go buy something to flex!</span>';
  }
}

// MAP
function renderMap() {
  const grid = $('#map-grid');
  grid.innerHTML = '';
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const cell = document.createElement('div');
      cell.className = 'map-cell';
      if (user && user.mapX === x && user.mapY === y) {
        cell.classList.add('player');
        cell.textContent = 'YOU';
      } else {
        // show other online players
        const other = onlinePlayers.find(p => p.id !== user.id && p.mapX === x && p.mapY === y);
        if (other) {
          cell.classList.add('other');
          cell.textContent = other.username.slice(0, 2).toUpperCase();
          cell.title = other.username;
        }
      }
      grid.appendChild(cell);
    }
  }
}

async function move(dx, dy) {
  const res = await fetch('/api/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, dx, dy })
  });
  const data = await res.json();
  if (!res.ok) return;
  user = data.user;
  updateUI();
  renderMap();
  if (data.event) {
    $('#map-event').textContent = data.event.msg;
    setTimeout(() => $('#map-event').textContent = '', 4000);
  }
}

// SOCIAL
function addChatMsg(msg) {
  const box = $('#chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `<span class="name">${msg.username}</span> <span class="time">${time}</span><br>${escapeHtml(msg.text)}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function renderLeaderboard(list) {
  const container = $('#leaderboard');
  container.innerHTML = '';
  list.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'lb-row';
    row.innerHTML = `
      <span>${i + 1}. ${p.username} ${p.isOnline ? '🟢' : ''}</span>
      <span>$${p.money.toLocaleString()}</span>
    `;
    container.appendChild(row);
  });
}

function renderOnline() {
  const container = $('#online-list');
  container.innerHTML = '';
  onlinePlayers.forEach(p => {
    const row = document.createElement('div');
    row.className = 'online-row';
    row.innerHTML = `
      <span><span class="online-dot"></span>${p.username} (${p.role || '?'})</span>
      <span>$${p.money.toLocaleString()}</span>
    `;
    container.appendChild(row);
  });
  if (onlinePlayers.length === 0) {
    container.innerHTML = '<span style="color:var(--muted)">No one else online</span>';
  }
}

async function sendMoney() {
  const to = $('#send-to').value.trim();
  const amount = $('#send-amount').value;
  if (!to || !amount) return alert('Enter username and amount');

  const res = await fetch('/api/send-money', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, toUsername: to, amount })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  user = data.user;
  updateUI();
  alert(`Sent $${amount} to ${to}`);
  $('#send-to').value = '';
  $('#send-amount').value = '';
}

// COMBAT LOG
function addCombatLog(text) {
  const log = $('#combat-log');
  const p = document.createElement('p');
  p.textContent = text;
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
}

function closeChallengeModal() {
  $('#challenge-modal').classList.add('hidden');
  pendingChallengeFrom = null;
}

// COINS
async function buyCoins(packageId) {
  const res = await fetch('/api/buy-coins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, packageId })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error);
  user = data.user;
  updateUI();
  alert(data.message);
  closeCoinsModal();
}

function closeCoinsModal() {
  $('#coins-modal').classList.add('hidden');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make some functions global for onclick
window.doHustle = doHustle;
window.doBuy = doBuy;
window.move = move;
window.buyCoins = buyCoins;
window.closeCoinsModal = closeCoinsModal;

// Start
init();

// ========== PWA / MOBILE APP ==========
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = $('#install-banner');
  if (banner) banner.classList.remove('hidden');
});

document.addEventListener('DOMContentLoaded', () => {
  const installBtn = $('#install-btn');
  const closeBtn = $('#install-close');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      $('#install-banner').classList.add('hidden');
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      $('#install-banner').classList.add('hidden');
    });
  }
});

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('SW registered', reg.scope))
      .catch(err => console.log('SW failed', err));
  });
}

// Prevent pull-to-refresh / overscroll on mobile
document.body.addEventListener('touchmove', (e) => {
  if (e.target.closest('.game-main, #chat-messages, #leaderboard, #online-list, .combat-log')) return;
  // allow scrolling inside main areas
}, { passive: true });
