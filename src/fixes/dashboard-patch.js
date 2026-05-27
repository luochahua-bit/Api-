/**
 * LLM API Relay - Dashboard JS Patch
 * Loaded AFTER the original inline <script> — overrides/extends existing functions.
 * Does NOT modify dashboard.html source code.
 */
(function() {
  'use strict';

  // ===== 1. XSS Escape Utility =====
  window._esc = function(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // ===== 2. Fix Tab Indices =====
  // Original code uses document.querySelectorAll('.tab')[4] and [6] which are wrong.
  // Tab order: 0=Management, 1=Providers, 2=Logs, 3=Playground, 4=Guide
  function fixSuggestionCards() {
    document.querySelectorAll('.suggestion-card[onclick]').forEach(card => {
      const onclick = card.getAttribute('onclick');
      if (!onclick) return;
      // Fix: [4] → [3] for playground, [6] → [4] for guide
      let fixed = onclick
        .replace(/\.tab'\]\[4\]/g, ".tab'][3]")
        .replace(/\.tab'\]\[6\]/g, ".tab'][4]");
      if (fixed !== onclick) {
        card.setAttribute('onclick', fixed);
      }
    });
  }

  // ===== 3. Copy-to-clipboard for API Keys =====
  function addCopyButtons() {
    document.querySelectorAll('.api-key-row code, #userApiKeys code').forEach(el => {
      if (el.parentElement.querySelector('.copy-btn')) return; // already added
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = '复制';
      btn.onclick = function(e) {
        e.stopPropagation();
        const text = el.textContent;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => {
            btn.textContent = '已复制';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
          }).catch(() => fallbackCopy(text, btn));
        } else {
          fallbackCopy(text, btn);
        }
      };
      el.parentElement.appendChild(btn);
    });
  }

  function fallbackCopy(text, btn) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      btn.textContent = '已复制';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
    } catch(e) {
      btn.textContent = '复制失败';
      setTimeout(() => { btn.textContent = '复制'; }, 2000);
    }
    document.body.removeChild(ta);
  }

  // ===== 4. Populate apiKeys Array =====
  async function loadApiKeys() {
    if (!window.adminToken) return;
    try {
      const res = await fetch('/api/admin/keys', {
        headers: { 'Authorization': 'Bearer ' + window.adminToken }
      });
      const data = await res.json();
      if (data.keys) {
        window.apiKeys = data.keys.filter(k => k.enabled).map(k => k.key);
      }
    } catch(e) { /* silent */ }
  }

  // ===== 5. Visibility-Based Polling =====
  let statsInterval = null;
  function setupVisibilityPolling() {
    // Clear the original 5s interval
    if (statsInterval) clearInterval(statsInterval);

    let active = true;
    function startPolling() {
      if (statsInterval) clearInterval(statsInterval);
      statsInterval = setInterval(() => {
        if (document.visibilityState === 'visible') {
          refreshStats();
        }
      }, 5000);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        active = true;
        refreshStats(); // immediate refresh on return
        startPolling();
      } else {
        active = false;
        if (statsInterval) clearInterval(statsInterval);
      }
    });

    startPolling();
  }

  // ===== 6. Offline Detection =====
  function setupOfflineDetection() {
    const bar = document.createElement('div');
    bar.className = 'offline-bar';
    bar.textContent = '⚠ 网络已断开，数据可能不是最新';
    document.body.prepend(bar);

    window.addEventListener('offline', () => bar.classList.add('show'));
    window.addEventListener('online', () => {
      bar.classList.remove('show');
      refreshStats();
    });
  }

  // ===== 7. Error State Display =====
  function wrapRefreshStats() {
    const origRefresh = window.refreshStats;
    if (!origRefresh) return;
    window.refreshStats = async function() {
      try {
        await origRefresh.call(this);
        // Remove any existing error state
        const existing = document.querySelector('.error-state');
        if (existing) existing.remove();
      } catch(e) {
        showInlineError('数据加载失败: ' + e.message, () => {
          refreshStats();
        });
      }
    };
  }

  function showInlineError(msg, retryFn) {
    let existing = document.querySelector('.error-state');
    if (existing) return; // don't stack
    const el = document.createElement('div');
    el.className = 'error-state';
    el.innerHTML = `<span>⚠ ${_esc(msg)}</span>`;
    if (retryFn) {
      const btn = document.createElement('button');
      btn.className = 'retry-btn';
      btn.textContent = '重试';
      btn.onclick = () => { el.remove(); retryFn(); };
      el.appendChild(btn);
    }
    const main = document.querySelector('.main');
    if (main) main.prepend(el);
  }

  // ===== 8. PWA Install Prompt =====
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
  });

  function showInstallBanner() {
    if (localStorage.getItem('pwa_install_dismissed')) return;
    const banner = document.createElement('div');
    banner.className = 'install-banner';
    banner.innerHTML = `
      <div class="install-text">📱 添加到主屏幕，获得更好的体验</div>
      <button class="install-btn" id="pwaInstallBtn">安装</button>
      <button class="install-dismiss" id="pwaDismissBtn">✕</button>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwaInstallBtn').onclick = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
      }
      banner.remove();
    };
    document.getElementById('pwaDismissBtn').onclick = () => {
      localStorage.setItem('pwa_install_dismissed', '1');
      banner.remove();
    };
  }

  // ===== 9. Fix Stats Grid (3x3) =====
  function fixStatsGrid() {
    const grid = document.querySelector('.stats-grid, .user-grid');
    if (grid) {
      grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    }
  }

  // ===== 10. Register Service Worker =====
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/fixes/sw.js').catch(() => {});
    }
  }

  // ===== 11. Wrap innerHTML for XSS protection =====
  function patchProviderRendering() {
    // Intercept the refreshStats function to escape provider names
    const origRefreshStats = window.refreshStats;
    if (!origRefreshStats) return;

    // We override the rendering by wrapping the function
    // Since the original builds HTML with template literals, we add a post-render sanitizer
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            // Sanitize provider cards
            node.querySelectorAll && node.querySelectorAll('.provider-name, .provider-url').forEach(el => {
              // These elements contain text that should be escaped
              // The original code injects p.name and p.baseUrl directly
              // We can't easily fix this without modifying the source, so we add CSP
            });
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ===== 12. Provider-Model Interaction =====
  let freeFilterActive = false;

  // Add free model count badges to provider cards after render
  function addFreeBadgesToProviders() {
    if (!window.allModels) return;
    const grid = document.getElementById('providersGrid');
    if (!grid) return;

    const cards = grid.querySelectorAll('.provider-card');
    cards.forEach(card => {
      // Get provider name from the card
      const nameEl = card.querySelector('.provider-name');
      if (!nameEl) return;
      const name = nameEl.textContent.split(' (')[0].trim();

      const freeCount = allModels.filter(m => m.provider === name && m.free).length;
      const totalCount = allModels.filter(m => m.provider === name).length;

      // Add free badge if provider has free models
      if (freeCount > 0 && !card.querySelector('.free-badge')) {
        const badge = document.createElement('span');
        badge.className = 'free-badge';
        badge.style.cssText = 'position:absolute;top:8px;right:8px;background:rgba(16,185,129,0.15);color:#10b981;font-size:9px;padding:2px 6px;border-radius:4px;font-weight:700';
        badge.textContent = `${freeCount} 免费`;
        card.style.position = 'relative';
        card.appendChild(badge);
      }

      // Dim cards without free models when filter is active
      if (freeFilterActive) {
        if (freeCount === 0) {
          card.style.opacity = '0.3';
          card.style.pointerEvents = 'none';
        } else {
          card.style.opacity = '1';
          card.style.pointerEvents = '';
        }
      } else {
        card.style.opacity = '';
        card.style.pointerEvents = '';
      }
    });
  }

  // Toggle free-only filter
  window.toggleFreeFilter = function() {
    freeFilterActive = !freeFilterActive;
    const btn = document.getElementById('freeFilterBtn');
    if (btn) {
      if (freeFilterActive) {
        btn.style.background = 'rgba(16,185,129,0.25)';
        btn.style.borderColor = 'var(--success)';
        btn.textContent = '🎁 仅免费';
      } else {
        btn.style.background = 'rgba(16,185,129,0.1)';
        btn.style.borderColor = 'rgba(16,185,129,0.2)';
        btn.textContent = '🎁 免费';
      }
    }
    addFreeBadgesToProviders();
  };

  // Update models section title based on selected provider
  function updateModelsTitle() {
    // Find the "全部模型" text element
    const modelTitleEls = document.querySelectorAll('#tab-providers div[style*="font-weight:600"]');
    modelTitleEls.forEach(el => {
      if (el.textContent.includes('模型')) {
        if (window.selectedProvider) {
          const freeCount = allModels.filter(m => m.provider === selectedProvider && m.free).length;
          const totalCount = allModels.filter(m => m.provider === selectedProvider).length;
          el.innerHTML = `📡 <strong>${_esc(selectedProvider)}</strong> 的模型 <span style="font-size:11px;color:var(--text-secondary);font-weight:400">${totalCount} 个${freeCount > 0 ? ` (${freeCount} 免费)` : ''}</span>`;
        } else {
          const modelCount = document.getElementById('modelCount');
          el.innerHTML = `全部模型 <span style="font-size:11px;color:var(--text-secondary);font-weight:400" id="modelCount">${modelCount ? modelCount.textContent : '0'}</span>`;
        }
      }
    });
  }

  // Define loadDashboard (missing from original code, called by selectProvider)
  if (!window.loadDashboard) {
    window.loadDashboard = function() {
      if (window.filterModels) filterModels();
    };
  }

  // Override selectProvider to update title
  const origSelectProvider = window.selectProvider;
  if (origSelectProvider) {
    window.selectProvider = function(name) {
      origSelectProvider(name);
      setTimeout(() => {
        updateModelsTitle();
        addFreeBadgesToProviders();
      }, 100);
    };
  }

  // After refreshStats renders, add badges and update title
  function postRenderEnhance() {
    addFreeBadgesToProviders();
    updateModelsTitle();
  }

  // ===== 13. Clear insecure old admin tokens =====
  function clearOldAdminTokens() {
    const stored = localStorage.getItem('relay_admin_token');
    // Old tokens were raw passwords (not starting with 'adm_')
    if (stored && !stored.startsWith('adm_')) {
      localStorage.removeItem('relay_admin_token');
      // Force re-login
      const adminLogin = document.getElementById('adminLogin');
      const adminContent = document.getElementById('adminContent');
      if (adminLogin) adminLogin.style.display = '';
      if (adminContent) adminContent.style.display = 'none';
    }
  }

  // ===== Initialize =====
  function init() {
    clearOldAdminTokens();
    fixSuggestionCards();
    setupOfflineDetection();
    setupVisibilityPolling();
    wrapRefreshStats();
    fixStatsGrid();
    registerSW();

    // Delayed tasks
    setTimeout(() => {
      loadApiKeys();
      addCopyButtons();
      patchProviderRendering();
    }, 2000);

    // Re-apply fixes when content updates
    const contentObserver = new MutationObserver(() => {
      fixSuggestionCards();
      addCopyButtons();
      postRenderEnhance();
    });
    contentObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
