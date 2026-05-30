/* LLM API Relay - API Communication Layer */
/* Extracted from marketplace.html */

var API = '/api/market';
var token = localStorage.getItem('market_token');
var currentUser = null;

async function api(path, opts) {
  opts = opts || {};
  var h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  var r = await fetch(API + path, Object.assign({}, opts, { headers: Object.assign({}, h, opts.headers || {}) }));
  var d = await r.json();
  if (!r.ok) { var e = new Error(d.error && d.error.message || 'Error'); e.status = r.status; throw e; }
  return d;
}

async function checkAuth() {
  if (!token) return;
  try {
    currentUser = await api('/auth/profile');
    updateUI();
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      token = null;
      localStorage.removeItem('market_token');
    }
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('market_token');
  updateUI();
  showPage('home');
  toast('已退出');
}

function updateUI() {
  var ok = !!currentUser;
  var loginBtn = document.getElementById('loginBtn');
  var logoutBtn = document.getElementById('logoutBtn');
  var userDisplay = document.getElementById('userDisplay');
  var balanceDisplay = document.getElementById('balanceDisplay');
  var frozenDisplay = document.getElementById('frozenDisplay');

  if (loginBtn) loginBtn.classList.toggle('hidden', ok);
  if (logoutBtn) logoutBtn.classList.toggle('hidden', !ok);
  if (userDisplay) userDisplay.classList.toggle('hidden', !ok);
  if (balanceDisplay) balanceDisplay.classList.toggle('hidden', !ok);
  if (frozenDisplay) frozenDisplay.classList.toggle('hidden', !ok);

  if (currentUser) {
    if (userDisplay) userDisplay.textContent = currentUser.username;
    var fc = currentUser.freeCoins || 0;
    var pc = currentUser.coins || 0;
    if (balanceDisplay) balanceDisplay.textContent = '免费:' + fc + ' | 付费:' + fmtCoins(pc);
    if (frozenDisplay) {
      var fb = currentUser.frozenBalance || 0;
      frozenDisplay.textContent = fb > 0 ? '🔒' + fb.toFixed(2) : '';
    }
  }
}
