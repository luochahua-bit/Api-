/**
 * LLM API Relay - Marketplace JS Patch
 * Loaded AFTER the original inline <script> — overrides/extends existing functions.
 * Does NOT modify marketplace.html source code.
 */
(function() {
  'use strict';

  // ===== 1. Loading Overlay =====
  function showLoading() {
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loadingOverlay';
      overlay.className = 'loading-overlay';
      overlay.innerHTML = '<div class="spinner"></div>';
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
  }
  function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
  }
  window.showLoading = showLoading;
  window.hideLoading = hideLoading;

  // ===== 2. Confirm Dialog =====
  function showConfirm(title, message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-dialog">
          <h3>${esc(title)}</h3>
          <p>${esc(message)}</p>
          <div class="confirm-actions">
            <button class="btn btn-outline" id="confirmCancel">取消</button>
            <button class="btn btn-primary" id="confirmOk">确认</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('#confirmCancel').onclick = () => {
        overlay.remove();
        resolve(false);
      };
      overlay.querySelector('#confirmOk').onclick = () => {
        overlay.remove();
        resolve(true);
      };
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.remove(); resolve(false); }
      });
    });
  }
  window.showConfirm = showConfirm;

  // ===== 3. HTML Escape =====
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  // Override the existing esc function if it exists
  window.esc = esc;

  // ===== 4. Override buyListing with Confirmation =====
  const origBuyListing = window.buyListing;
  if (origBuyListing) {
    window.buyListing = async function(id) {
      const confirmed = await showConfirm(
        '确认购买',
        '确定要购买此 API 服务吗？资金将从您的钱包扣除。'
      );
      if (!confirmed) return;
      showLoading();
      try {
        await origBuyListing.call(this, id);
      } finally {
        hideLoading();
      }
    };
  }

  // ===== 5. Override loadHome with Error Display =====
  const origLoadHome = window.loadHome;
  if (origLoadHome) {
    window.loadHome = async function() {
      try {
        await origLoadHome.call(this);
      } catch(e) {
        // Show error to user instead of silent console.error
        if (window.showToast) {
          showToast('首页加载失败: ' + e.message, 'error');
        }
        const grid = document.querySelector('.listing-grid');
        if (grid && !grid.children.length) {
          grid.innerHTML = '<div class="empty" style="grid-column:1/-1">⚠ 加载失败，请刷新重试</div>';
        }
      }
    };
  }

  // ===== 6. loadListings Loading State (merged into section 13) =====
  // Loading state for listings is handled by the provider filter override in section 13

  // ===== 7. Override createListing with Validation =====
  const origCreateListing = window.createListing;
  if (origCreateListing) {
    window.createListing = async function() {
      // Enhanced validation
      const baseUrl = document.getElementById('listingUrl')?.value?.trim();
      const apiKey = document.getElementById('listingKey')?.value?.trim();
      const desc = document.getElementById('listingDesc')?.value?.trim();

      if (!baseUrl) {
        showToast('请填写 API Base URL', 'error');
        return;
      }
      if (!apiKey) {
        showToast('请填写 API Key', 'error');
        return;
      }
      if (!desc) {
        showToast('请填写描述信息', 'error');
        return;
      }
      // Check if at least one model is selected
      const checked = document.querySelectorAll('.model-check:checked');
      if (checked.length === 0) {
        showToast('请至少选择一个模型', 'error');
        return;
      }

      showLoading();
      try {
        await origCreateListing.call(this);
      } finally {
        hideLoading();
      }
    };
  }

  // ===== 8. Override disputeOrder with Custom Modal =====
  const origDisputeOrder = window.disputeOrder;
  if (origDisputeOrder) {
    window.disputeOrder = async function(orderId) {
      // Replace native prompt() with custom modal
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay dispute-modal';
      overlay.innerHTML = `
        <div class="modal">
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
          <h2>申请退款</h2>
          <div class="form-group">
            <label>退款原因</label>
            <textarea id="disputeReason" placeholder="请描述退款原因..." rows="3"></textarea>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">取消</button>
            <button class="btn btn-primary" id="disputeSubmit">提交退款</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      return new Promise((resolve) => {
        overlay.querySelector('#disputeSubmit').onclick = async () => {
          const reason = document.getElementById('disputeReason')?.value?.trim();
          if (!reason) {
            showToast('请填写退款原因', 'error');
            return;
          }
          overlay.remove();
          // Call original API with the reason
          try {
            showLoading();
            const res = await fetch(`/api/market/orders/${orderId}/dispute`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('market_token')
              },
              body: JSON.stringify({ reason })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            showToast('退款申请已提交', 'success');
            if (window.loadOrders) loadOrders('buyer');
          } catch(e) {
            showToast('退款失败: ' + e.message, 'error');
          } finally {
            hideLoading();
            resolve();
          }
        };
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) { overlay.remove(); resolve(); }
        });
      });
    };
  }

  // ===== 9. Enhanced Toast (persistent errors) =====
  const origShowToast = window.showToast;
  if (origShowToast) {
    window.showToast = function(msg, type) {
      origShowToast(msg, type);
      // Make error toasts clickable to dismiss
      if (type === 'error') {
        const toast = document.querySelector('.toast');
        if (toast) {
          toast.style.cursor = 'pointer';
          toast.onclick = () => { toast.className = 'toast'; };
          // Extend display time for errors
          setTimeout(() => {
            if (toast.classList.contains('toast-error')) {
              toast.className = 'toast';
            }
          }, 8000); // 8s for errors vs 3.5s for success
        }
      }
    };
  }

  // ===== 10. Copy Key with Fallback =====
  const origCopyKey = window.copyKey;
  if (origCopyKey) {
    window.copyKey = function() {
      const keyEl = document.querySelector('.key-display');
      if (!keyEl) return;
      const text = keyEl.textContent.replace('复制', '').trim();

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showToast('API Key 已复制', 'success');
        }).catch(() => fallbackCopy(text));
      } else {
        fallbackCopy(text);
      }
    };
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('API Key 已复制', 'success');
    } catch(e) {
      showToast('复制失败，请手动复制', 'error');
    }
    document.body.removeChild(ta);
  }

  // ===== 11. Button Loading States =====
  function wrapButtons() {
    // Add loading class to buttons during async operations
    document.querySelectorAll('.btn-primary[onclick]').forEach(btn => {
      const origOnclick = btn.getAttribute('onclick');
      if (!origOnclick || origOnclick.includes('Loading')) return;
      // Don't wrap if already wrapped
    });
  }

  // ===== 12. Register Service Worker =====
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/fixes/sw.js').catch(() => {});
    }
  }

  // ===== 13. Provider Filter in Browse Page =====
  let marketSelectedProvider = null;
  let marketAllListings = [];
  let marketFreeFilter = false;

  const PROVIDER_ICONS = {
    openrouter: 'OR', groq: 'GQ', cerebras: 'CB', google: 'GG',
    sambanova: 'SN', mistral: 'MI', nvidia: 'NV', cohere: 'CO',
    github: 'GH', haoyongai: 'HY', '4sapi': '4S',
  };
  const PROVIDER_COLORS = {
    openrouter: 'linear-gradient(135deg,#6366f1,#a855f7)',
    groq: 'linear-gradient(135deg,#f59e0b,#ef4444)',
    cerebras: 'linear-gradient(135deg,#22c55e,#06b6d4)',
    google: 'linear-gradient(135deg,#3b82f6,#22c55e)',
    sambanova: 'linear-gradient(135deg,#ec4899,#a855f7)',
    mistral: 'linear-gradient(135deg,#f97316,#f59e0b)',
    nvidia: 'linear-gradient(135deg,#22c55e,#16a34a)',
    cohere: 'linear-gradient(135deg,#6366f1,#3b82f6)',
    github: 'linear-gradient(135deg,#64748b,#334155)',
    haoyongai: 'linear-gradient(135deg,#8b5cf6,#ec4899)',
    '4sapi': 'linear-gradient(135deg,#06b6d4,#3b82f6)',
    default: 'linear-gradient(135deg,#6366f1,#3b82f6)',
  };

  function getProviderFromModel(model) {
    if (!model) return 'other';
    const m = model.toLowerCase();
    if (m.includes(':free') || m.includes('openrouter')) return 'openrouter';
    if (m.includes('groq')) return 'groq';
    if (m.includes('cerebras')) return 'cerebras';
    if (m.includes('gemini') || m.includes('gemma') || m.includes('google')) return 'google';
    if (m.includes('deepseek-v3') || m.includes('deepseek-r1') || m.includes('sambanova')) return 'sambanova';
    if (m.includes('mistral') || m.includes('codestral') || m.includes('pixtral')) return 'mistral';
    if (m.includes('nvidia') || m.includes('nemotron') || m.includes('meta/')) return 'nvidia';
    if (m.includes('command') || m.includes('cohere')) return 'cohere';
    if (m.includes('gpt-4o') || m.includes('llama-4') || m.includes('github')) return 'github';
    return 'other';
  }

  function getProviderLabel(key) {
    const labels = {
      openrouter: 'OpenRouter', groq: 'Groq', cerebras: 'Cerebras',
      google: 'Google AI', sambanova: 'SambaNova', mistral: 'Mistral',
      nvidia: 'NVIDIA NIM', cohere: 'Cohere', github: 'GitHub Models',
      haoyongai: '好用Ai', '4sapi': '4Sapi', other: '其他',
    };
    return labels[key] || key;
  }

  function injectProviderFilter() {
    const browsePage = document.getElementById('page-browse');
    if (!browsePage || document.getElementById('providerFilterSection')) return;

    // Create provider filter section
    const section = document.createElement('div');
    section.id = 'providerFilterSection';
    section.style.cssText = 'margin-bottom:16px';
    section.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:14px;font-weight:700">提供商筛选</div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn btn-sm" id="marketFreeBtn" onclick="toggleMarketFreeFilter()" style="background:rgba(34,197,94,0.1);color:var(--success);border:1px solid rgba(34,197,94,0.2);font-size:11px;padding:4px 10px">🎁 免费模型</button>
          <button class="btn btn-sm btn-outline" id="marketResetBtn" onclick="resetMarketProvider()" style="font-size:11px;padding:4px 10px;display:none">✕ 清除筛选</button>
        </div>
      </div>
      <div id="providerFilterGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px"></div>
      <div id="selectedProviderModels" style="display:none;margin-top:12px;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:10px">
        <div id="selectedProviderModelsTitle" style="font-size:13px;font-weight:700;margin-bottom:8px"></div>
        <div id="selectedProviderModelsGrid" style="display:flex;flex-wrap:wrap;gap:4px"></div>
      </div>
    `;

    // Insert before the search bar
    const searchBar = browsePage.querySelector('.search-bar');
    if (searchBar) {
      browsePage.insertBefore(section, searchBar);
    } else {
      browsePage.prepend(section);
    }
  }

  function renderProviderFilterCards(listings) {
    const grid = document.getElementById('providerFilterGrid');
    if (!grid) return;

    // Aggregate provider data from listings
    const providers = {};
    listings.forEach(l => {
      const models = l.models || [];
      models.forEach(m => {
        const pKey = getProviderFromModel(m);
        if (!providers[pKey]) {
          providers[pKey] = { name: pKey, models: new Set(), freeModels: new Set(), listings: new Set() };
        }
        providers[pKey].models.add(m);
        providers[pKey].listings.add(l.id);
        if (m.includes(':free') || l.pricePerRequest === 0) {
          providers[pKey].freeModels.add(m);
        }
      });
    });

    const sorted = Object.entries(providers).sort((a, b) => b[1].models.size - a[1].models.size);

    grid.innerHTML = sorted.map(([key, data]) => {
      const icon = PROVIDER_ICONS[key] || key.charAt(0).toUpperCase();
      const color = PROVIDER_COLORS[key] || PROVIDER_COLORS.default;
      const isSelected = marketSelectedProvider === key;
      const freeCount = data.freeModels.size;
      const totalCount = data.models.size;
      const listingCount = data.listings.size;
      const dimmed = marketFreeFilter && freeCount === 0;

      return '<div class="provider-filter-card" data-provider="' + key + '" data-free-count="' + freeCount + '" ' +
        'style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--card);' +
        'border:1px solid var(--border);border-radius:10px;cursor:pointer;opacity:' + (dimmed ? '0.25' : '1') + ';pointer-events:' + (dimmed ? 'none' : '') + '">' +
        '<div style="width:32px;height:32px;border-radius:8px;background:' + color + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff;flex-shrink:0">' + esc(icon) + '</div>' +
        '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(getProviderLabel(key)) + '</div>' +
        '<div style="font-size:10px;color:var(--text3)">' + totalCount + ' 模型 · ' + listingCount + ' 商品</div>' +
        '</div>' +
        (freeCount > 0 ? '<span style="background:rgba(34,197,94,0.15);color:#22c55e;font-size:9px;padding:2px 5px;border-radius:4px;font-weight:700;flex-shrink:0">' + freeCount + ' 免费</span>' : '') +
        '</div>';
    }).join('');

    // Use event delegation instead of inline onclick (more reliable)
    const gridEl = document.getElementById('providerFilterGrid');
    if (gridEl && !gridEl._delegated) {
      gridEl._delegated = true;
      gridEl.addEventListener('click', function(e) {
        const card = e.target.closest('.provider-filter-card');
        if (!card) return;
        const key = card.dataset.provider;
        if (!key) return;
        // Directly toggle, no function call overhead
        marketSelectedProvider = marketSelectedProvider === key ? null : key;
        lastRenderedProvider = null;
        applyMarketProviderFilter();
      }, { passive: true });
    }

    // Cache DOM refs after rendering
    cacheCardRefs();
  }

  window.selectMarketProvider = function(key) {
    if (marketSelectedProvider === key) {
      marketSelectedProvider = null;
    } else {
      marketSelectedProvider = key;
    }
    lastRenderedProvider = null; // force model section rebuild
    applyMarketProviderFilter();
  };

  window.resetMarketProvider = function() {
    marketSelectedProvider = null;
    marketFreeFilter = false;
    lastRenderedProvider = null;
    const btn = document.getElementById('marketFreeBtn');
    if (btn) {
      btn.style.background = 'rgba(34,197,94,0.1)';
      btn.textContent = '🎁 免费模型';
    }
    applyMarketProviderFilter();
  };

  window.toggleMarketFreeFilter = function() {
    marketFreeFilter = !marketFreeFilter;
    const btn = document.getElementById('marketFreeBtn');
    if (btn) {
      if (marketFreeFilter) {
        btn.style.background = 'rgba(34,197,94,0.25)';
        btn.textContent = '🎁 仅免费';
      } else {
        btn.style.background = 'rgba(34,197,94,0.1)';
        btn.textContent = '🎁 免费模型';
      }
    }
    applyMarketProviderFilter();
  };

  // Pre-built provider index for instant filtering
  let providerIndex = {}; // { listingId: Set<providerKey> }
  // Cached DOM references (built once)
  let cachedProviderCards = [];
  let cachedListingCards = [];

  function buildProviderIndex(listings) {
    providerIndex = {};
    listings.forEach(l => {
      const providers = new Set();
      (l.models || []).forEach(m => providers.add(getProviderFromModel(m)));
      providerIndex[l.id] = providers;
    });
  }

  function cacheCardRefs() {
    cachedProviderCards = Array.from(document.querySelectorAll('.provider-filter-card'));
    cachedListingCards = Array.from(document.querySelectorAll('#listingsGrid .listing-card'));
  }

  function applyMarketProviderFilter() {
    const resetBtn = document.getElementById('marketResetBtn');
    if (resetBtn) resetBtn.style.display = marketSelectedProvider ? '' : 'none';

    const selected = marketSelectedProvider;

    // 1. Provider card highlight — batch: read none, write all
    for (let i = 0; i < cachedProviderCards.length; i++) {
      const card = cachedProviderCards[i];
      if (selected && card.dataset.provider === selected) {
        card.classList.add('pf-selected');
        card.classList.remove('pf-dimmed');
      } else if (selected) {
        card.classList.remove('pf-selected');
        // Dim cards without free models when free filter is active
        if (marketFreeFilter) {
          const freeCount = parseInt(card.dataset.freeCount || '0');
          card.classList.toggle('pf-dimmed', freeCount === 0);
        } else {
          card.classList.remove('pf-dimmed');
        }
      } else {
        card.classList.remove('pf-selected');
        card.classList.remove('pf-dimmed');
      }
    }

    // 2. Listing card filter — batch: write only
    let visibleCount = 0;
    for (let i = 0; i < cachedListingCards.length; i++) {
      const card = cachedListingCards[i];
      if (!selected) {
        card.style.display = '';
        visibleCount++;
      } else {
        const id = card.dataset.listingId;
        const match = id && providerIndex[id] && providerIndex[id].has(selected);
        card.style.display = match ? '' : 'none';
        if (match) visibleCount++;
      }
    }

    const empty = document.getElementById('listingsEmpty');
    if (empty) empty.classList.toggle('hidden', visibleCount > 0 || !selected);

    // 3. Models section (cached per provider)
    updateProviderModels(selected);
  }

  // Cache last rendered provider to avoid re-build
  let lastRenderedProvider = null;
  let providerModelsCache = {};

  function updateProviderModels(providerKey) {
    const section = document.getElementById('selectedProviderModels');
    if (!section) return;

    if (!providerKey) {
      section.style.display = 'none';
      lastRenderedProvider = null;
      return;
    }

    section.style.display = '';

    if (lastRenderedProvider === providerKey) return;
    lastRenderedProvider = providerKey;

    if (!providerModelsCache[providerKey]) {
      const models = new Set();
      marketAllListings.forEach(l => {
        (l.models || []).forEach(m => {
          if (getProviderFromModel(m) === providerKey) models.add(m);
        });
      });
      providerModelsCache[providerKey] = [...models];
    }

    const models = providerModelsCache[providerKey];
    document.getElementById('selectedProviderModelsTitle').innerHTML =
      '📡 <strong>' + esc(getProviderLabel(providerKey)) + '</strong> 可用模型 <span style="font-size:11px;color:var(--text3);font-weight:400">' + models.length + ' 个</span>';

    let html = '';
    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      const isFree = m.includes(':free');
      html += '<span style="display:inline-flex;align-items:center;gap:4px;background:var(--bg);border:1px solid var(--border);padding:4px 10px;border-radius:6px;font-size:11px">';
      if (isFree) html += '<span style="background:rgba(34,197,94,0.15);color:#22c55e;font-size:9px;padding:1px 4px;border-radius:3px;font-weight:700">FREE</span>';
      html += esc(m) + '</span>';
    }
    document.getElementById('selectedProviderModelsGrid').innerHTML = html;
  }

  // Override loadListings to capture data and render provider filter
  const origLoadListings = window.loadListings;
  if (origLoadListings) {
    window.loadListings = async function() {
      const searchVal = document.getElementById('searchInput')?.value || '';
      const sortVal = document.getElementById('sortSelect')?.value || 'createdAt';
      const grid = document.getElementById('listingsGrid');

      // Show loading state
      if (grid) grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="spinner" style="margin:0 auto 12px"></div>加载中...</div>';

      try {
        const d = await api('/listings?model=' + encodeURIComponent(searchVal) + '&sort=' + sortVal);
        marketAllListings = d.data || [];

        // Build provider index for instant filtering
        buildProviderIndex(marketAllListings);
        providerModelsCache = {}; // clear model cache

        // Render provider filter cards
        renderProviderFilterCards(marketAllListings);

        // Show listings
        const empty = document.getElementById('listingsEmpty');
        if (!marketAllListings.length) {
          if (grid) grid.innerHTML = '';
          if (empty) empty.classList.remove('hidden');
        } else {
          if (empty) empty.classList.add('hidden');
          if (grid) {
            grid.className = 'listing-grid' + (window.cardSize === 'compact' ? ' compact' : '');
            grid.innerHTML = marketAllListings.map(l => renderListing(l, window.cardSize === 'compact')).join('');
            // Tag each card with listing ID for instant filtering
            const cards = grid.querySelectorAll('.listing-card');
            cards.forEach((card, i) => {
              if (marketAllListings[i]) card.dataset.listingId = marketAllListings[i].id;
            });
            // Re-cache DOM refs
            cacheCardRefs();
          }
        }

        // Re-apply active provider filter
        if (marketSelectedProvider) applyMarketProviderFilter();
      } catch(e) {
        if (grid) grid.innerHTML = '<div class="empty" style="grid-column:1/-1">⚠ 加载失败，请刷新重试</div>';
        if (window.showToast) showToast(e.message, 'error');
      }
    };
  }

  // Override loadHome to also capture listings
  const origLoadHome = window.loadHome;
  if (origLoadHome) {
    window.loadHome = async function() {
      try {
        await origLoadHome.call(this);
        // Also fetch all listings for the provider filter
        const d = await api('/listings?limit=50');
        marketAllListings = d.data || [];
      } catch(e) { /* handled by original */ }
    };
  }

  // ===== Initialize =====
  function init() {
    registerSW();
    injectProviderFilter();
    setInterval(wrapButtons, 5000);

    // Re-inject on page navigation (debounced)
    let injectTimer = null;
    const observer = new MutationObserver(() => {
      if (injectTimer) return;
      injectTimer = setTimeout(() => {
        injectTimer = null;
        if (!document.getElementById('providerFilterSection')) {
          injectProviderFilter();
          // Re-render if we have data
          if (marketAllListings.length) {
            renderProviderFilterCards(marketAllListings);
            if (marketSelectedProvider) applyMarketProviderFilter();
          }
        }
      }, 300);
    });
    const browsePage = document.getElementById('page-browse');
    if (browsePage) {
      observer.observe(browsePage, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
