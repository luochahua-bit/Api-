/* LLM API Relay - Reusable Components */
/* Template functions for repeated UI patterns */

// Render model tags HTML
function renderModelTags(models, maxShow) {
  maxShow = maxShow || 3;
  if (!models || !models.length) return '';
  var html = '';
  var show = Math.min(models.length, maxShow);
  for (var i = 0; i < show; i++) {
    html += '<span class="model-tag">' + esc(models[i]) + '</span>';
  }
  if (models.length > show) html += '<span class="model-tag">+' + (models.length - show) + '</span>';
  return html;
}

// Render stat card
function renderStatCard(label, valueId, subtitle, color) {
  return '<div class="card text-center">' +
    '<div class="text-xs">' + esc(label) + '</div>' +
    '<div class="text-3xl" style="color:' + (color || 'var(--primary)') + '" id="' + escAttr(valueId) + '">-</div>' +
    (subtitle ? '<div class="text-xs">' + esc(subtitle) + '</div>' : '') +
    '</div>';
}

// Render badge
function renderBadge(type, text) {
  return '<span class="badge badge-' + escAttr(type) + '">' + esc(text) + '</span>';
}

// Render provider icon
function renderProviderIcon(url) {
  var p = getProvider(url);
  return '<div class="icon-provider ' + getProviderCls(p) + '">' + getProviderIcon(p) + '</div>';
}

// Render star rating
function renderStars(rating, count) {
  return '<span class="text-warning">' + stars(rating) + '</span> ' + (rating || 0) +
    (count ? ' <span class="text-xs">(' + count + ')</span>' : '');
}

// Render listing card (used in browse, home, my listings)
function renderListingCard(l, compact) {
  var p = getProvider(l.baseUrl);
  var pIcon = getProviderIcon(p);
  var pCls = getProviderCls(p);
  var priceText = l.pricePerRequest > 0 ? fmtPrice(l.pricePerRequest) + '/次' : (l.pricePerToken > 0 ? fmtPrice(l.pricePerToken) + '/token' : '免费');
  var ms = l.models || [];
  var modelsHtml = renderModelTags(ms, compact ? 2 : 3);
  var isExclusive = l.sharingMode === 'exclusive';
  var isSoldOut = isExclusive && l.buyerCount > 0;
  var healthBadge = l.health && l.health.healthy ? renderBadge('green', '正常') : renderBadge('red', '异常');
  var sharingBadge = isExclusive ? '<span class="badge badge-pink">独占</span>' : '<span class="badge badge-cyan">共享</span>';
  var statusText = isExclusive
    ? (isSoldOut ? '<span class="text-danger">已售出</span>' : '<span class="text-success">可购买</span>')
    : '<span class="flex-col gap-2" style="align-items:flex-end"><span>' + (l.remainingQuota > 0 ? '剩余 ' + l.remainingQuota + ' 个' : '已售罄') + '</span><span>' + (l.buyerCount || 0) + ' 人已购买</span></span>';

  return '<div class="card listing-card" onclick="showDetail(\'' + escAttr(l.id) + '\')">' +
    '<div class="card-header">' + renderProviderIcon(l.baseUrl) + '<div class="flex-1">' +
    '<div class="text-lg truncate">' + esc(l.description) + '</div>' +
    '<div class="text-xs mt-4">卖家: ' + esc(l.sellerName) + ' ' + renderStars(l.rating) + '</div>' +
    '</div><span class="badge badge-green">' + priceText + '</span></div>' +
    '<div>' + modelsHtml + '</div>' +
    '<div class="card-footer"><div class="flex gap-6">' + healthBadge + sharingBadge + '</div>' +
    '<div class="text-xs">' + statusText + '</div></div></div>';
}

// Render order card
function renderOrderCard(o, role) {
  var desc = (o.listingInfo && o.listingInfo.description) || o.listingId;
  var statusCls = o.status === 'completed' ? 'escrow-completed' : o.status === 'frozen' ? 'escrow-frozen' : o.status === 'disputed' ? 'escrow-frozen' : 'escrow-refunded';
  var statusIcon = o.status === 'completed' ? '✅' : o.status === 'frozen' ? '🔒' : o.status === 'disputed' ? '⚖️' : '↩️';
  var statusText = o.status === 'completed' ? '已完成' : o.status === 'frozen' ? '资金冻结中' : o.status === 'disputed' ? '申诉审核中' : '已退款';
  var actions = '';
  var disputeInfo = '';

  if (o.status === 'frozen' && role === 'buyer') {
    actions = '<button class="btn btn-sm btn-primary" onclick="confirmOrder(\'' + escAttr(o.id) + '\')">确认收货</button>' +
      '<button class="btn btn-sm btn-outline ml-6" onclick="disputeOrder(\'' + escAttr(o.id) + '\')">申诉退款</button>';
  }
  if (o.status === 'disputed') {
    disputeInfo = '<div class="mt-8 p-8" style="background:rgba(245,158,11,0.1);border-radius:6px">' +
      '<div class="text-warning font-bold">申诉原因: ' + esc(o.refundReason || '') + '</div>' +
      (o.disputeUsagePercent != null ? '<div class="text-muted">使用量: ' + o.disputeUsagePercent + '%</div>' : '') +
      (o.sellerResponse ? '<div class="text-info mt-4">卖家回应: ' + esc(o.sellerResponse) + '</div>' : '') +
      '</div>';
    if (role === 'seller' && !o.sellerResponse) {
      actions = '<button class="btn btn-sm btn-primary" onclick="respondDispute(\'' + escAttr(o.id) + '\')">回应申诉</button>';
    }
    if (role === 'buyer') {
      actions = '<span class="text-xs text-warning italic">等待管理员裁决...</span>';
    }
  }

  return '<div class="card"><div class="flex-between">' +
    '<div><strong class="text-lg">' + esc(desc) + '</strong>' +
    '<div class="text-xs mt-4">数量: ' + o.amount + ' | ' + o.totalPrice + ' 币 | ' + fmtTime(o.createdAt) + '</div></div>' +
    '<div class="escrow-status ' + statusCls + '">' + statusIcon + ' ' + statusText + '</div></div>' +
    disputeInfo +
    (actions ? '<div class="mt-10">' + actions + '</div>' : '') + '</div>';
}
