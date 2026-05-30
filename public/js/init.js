/* LLM API Relay - Initialization */
/* Runs AFTER all external scripts are loaded */

(function() {
  var savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  var themeBtn = document.getElementById('themeBtn');
  if (themeBtn) themeBtn.textContent = savedTheme === 'dark' ? '🌙' : '☀️';
  if (typeof applyCardSize === 'function') applyCardSize();
  if (typeof checkAuth === 'function') checkAuth();
  if (typeof showPage === 'function') showPage('home');
  // Hide loading screen
  var ld = document.getElementById('app-loading');
  if (ld) { ld.style.opacity = '0'; setTimeout(function() { ld.remove(); }, 400); }
})();
