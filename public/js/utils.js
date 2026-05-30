/* LLM API Relay - Utility Functions */
/* Extracted from marketplace.html */

// Provider detection
var PROVIDER_ICONS = {
  openrouter: 'OR', groq: 'GQ', cerebras: 'CB', google: 'GM',
  sambanova: 'SN', mistral: 'MI', nvidia: 'NV', cohere: 'CH', github: 'GH'
};
var PROVIDER_CLS = {
  openrouter: 'provider-openrouter', groq: 'provider-groq', cerebras: 'provider-cerebras',
  google: 'provider-google', sambanova: 'provider-sambanova', mistral: 'provider-mistral',
  nvidia: 'provider-nvidia', cohere: 'provider-cohere', github: 'provider-github'
};

function getProvider(url) {
  if (!url) return 'default';
  url = url.toLowerCase();
  if (url.includes('openrouter')) return 'openrouter';
  if (url.includes('groq')) return 'groq';
  if (url.includes('cerebras')) return 'cerebras';
  if (url.includes('google') || url.includes('generativelanguage')) return 'google';
  if (url.includes('sambanova')) return 'sambanova';
  if (url.includes('mistral')) return 'mistral';
  if (url.includes('nvidia') || url.includes('nim')) return 'nvidia';
  if (url.includes('cohere')) return 'cohere';
  if (url.includes('github')) return 'github';
  return 'default';
}
function getProviderIcon(name) { var k = getProvider(name); return PROVIDER_ICONS[k] || 'AI'; }
function getProviderCls(name) { var k = getProvider(name); return PROVIDER_CLS[k] || 'provider-default'; }

// Toast notification
function toast(msg, type) {
  type = type || 'success';
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 3500);
}

// Password toggle
function togglePwd(inputId, btn) {
  var input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? '👁' : '🙈';
}

// HTML escaping
function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escAttr(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// Formatting
function stars(n) { n = Math.round(n || 0); var s = ''; for (var i = 0; i < 5; i++) s += i < n ? '★' : '☆'; return s; }
function fmtTime(ts) { return new Date(ts).toLocaleString(); }
function fmtPrice(p) { return p > 0 ? p.toFixed(2) : '免费'; }
function fmtCoins(n) { return (n || 0).toFixed(2); }

// Clipboard
function copyToClipboard(text, label) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function() { toast((label || '已复制') + ': ' + text, 'success'); })
    .catch(function() { fallbackCopy(text); });
  } else { fallbackCopy(text); }
}
function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('已复制', 'success'); } catch (e) { toast('复制失败', 'error'); }
  ta.remove();
}

// Modal helpers
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  if (id === 'authModal' && typeof _pendingBuyId !== 'undefined') _pendingBuyId = null;
}
function showAuthModal() { showModal('authModal'); }
