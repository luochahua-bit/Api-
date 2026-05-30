const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const config = require('../config');
const store = require('../store');
const providerManager = require('../services/provider');
const logger = require('../services/logger');
const { requireAdmin } = require('../middleware/adminAuth');

const router = Router();

// Get current admin role (for frontend permission checks)
router.get('/role', (req, res) => {
  res.json({ role: req.adminRole, username: req.adminUsername });
});

// Providers (admin only)
router.get('/providers', requireAdmin, (req, res) => {
  res.json({ providers: providerManager.getProvidersInfo() });
});

router.post('/providers', requireAdmin, (req, res) => {
  const { name, baseUrl, apiKey, weight, enabled } = req.body;
  if (!name || !baseUrl) {
    return res.status(400).json({ error: { message: 'Name and baseUrl are required' } });
  }
  const success = providerManager.addProvider({
    name, baseUrl, apiKey: apiKey || '', weight: weight || 1, enabled: enabled !== false,
  });
  if (!success) {
    return res.status(409).json({ error: { message: 'Provider already exists' } });
  }
  res.json({ success: true, message: 'Provider added' });
});

router.put('/providers/:name', requireAdmin, (req, res) => {
  const { name } = req.params;
  const changes = req.body;
  const success = providerManager.updateProvider(name, changes);
  if (!success) {
    return res.status(404).json({ error: { message: 'Provider not found' } });
  }
  res.json({ success: true, message: 'Provider updated' });
});

router.delete('/providers/:name', requireAdmin, (req, res) => {
  const { name } = req.params;
  const success = providerManager.removeProvider(name);
  if (!success) {
    return res.status(404).json({ error: { message: 'Provider not found' } });
  }
  res.json({ success: true, message: 'Provider removed' });
});

router.post('/providers/:name/test', requireAdmin, async (req, res) => {
  const { name } = req.params;
  const providers = store.getProviders();
  const provider = providers.find(p => p.name === name);
  if (!provider) {
    return res.status(404).json({ error: { message: 'Provider not found' } });
  }
  try {
    const axios = require('axios');
    const startTime = Date.now();
    await axios.get(`${provider.baseUrl}/models`, {
      headers: provider.apiKey ? { 'Authorization': `Bearer ${provider.apiKey}` } : {},
      timeout: 10000,
    });
    const latency = Date.now() - startTime;
    res.json({ success: true, latency, message: 'Provider is healthy' });
  } catch (err) {
    res.json({ success: false, error: err.message, message: 'Provider test failed' });
  }
});

router.post('/providers/:name/reset-breaker', requireAdmin, (req, res) => {
  const { name } = req.params;
  providerManager.resetCircuitBreaker(name);
  res.json({ success: true, message: 'Circuit breaker reset' });
});

// API Keys
router.get('/keys', requireAdmin, (req, res) => {
  const keys = store.getApiKeys().map(k => ({
    ...k,
    key: k.key.slice(0, 8) + '...' + k.key.slice(-4),
  }));
  res.json({ keys });
});

router.post('/keys', requireAdmin, (req, res) => {
  const { name } = req.body;
  const key = `sk-${crypto.randomBytes(24).toString('hex')}`;
  const apiKey = {
    key,
    name: name || 'unnamed',
    createdAt: Date.now(),
    enabled: true,
    usageCount: 0,
  };
  store.addApiKey(apiKey);
  res.json({ success: true, key, message: 'API key created. Save it now, it won\'t be shown again.' });
});

router.put('/keys/:key', requireAdmin, (req, res) => {
  const { key } = req.params;
  const { enabled } = req.body;
  const keys = store.getApiKeys();
  const actualKey = keys.find(k => k.key.endsWith(key.slice(-4)));
  if (!actualKey) {
    return res.status(404).json({ error: { message: 'API key not found' } });
  }
  store.updateApiKey(actualKey.key, { enabled });
  res.json({ success: true, message: 'API key updated' });
});

router.delete('/keys/:key', requireAdmin, (req, res) => {
  const { key } = req.params;
  const keys = store.getApiKeys();
  const actualKey = keys.find(k => k.key.endsWith(key.slice(-4)));
  if (!actualKey) {
    return res.status(404).json({ error: { message: 'API key not found' } });
  }
  store.removeApiKey(actualKey.key);
  res.json({ success: true, message: 'API key revoked' });
});

// Logs
router.get('/logs', requireAdmin, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const model = req.query.model;
  const provider = req.query.provider;
  let logs = logger.getRecentLogs(limit);
  if (model) logs = logs.filter(l => l.model === model);
  if (provider) logs = logs.filter(l => l.provider === provider);
  res.json({ logs });
});

router.delete('/logs', requireAdmin, (req, res) => {
  logger.clearLogs();
  res.json({ success: true, message: 'Logs cleared' });
});

// Stats
router.get('/stats', (req, res) => {
  const stats = store.getStats();
  const providers = providerManager.getProvidersInfo();
  const logs = logger.getRecentLogs(50);
  const avgLatency = providers.reduce((sum, p) => sum + (p.health?.latency || 0), 0) / (providers.length || 1);
  res.json({
    ...stats,
    uptime: Math.floor((Date.now() - stats.startTime) / 1000),
    providers,
    logs,
    avgLatency: Math.round(avgLatency),
  });
});

// ========== User Management ==========

// List all users (sanitized)
router.get('/users', (req, res) => {
  const users = store.getUsers().map(u => ({
    id: u.id,
    username: u.username,
    email: u.email ? u.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : '',
    enabled: u.enabled,
    coins: u.coins || 0,
    freeCoins: u.freeCoins || 0,
    createdAt: u.createdAt,
  }));
  res.json({ data: users });
});

// Enable/disable user
router.put('/users/:id/toggle', requireAdmin, (req, res) => {
  const user = store.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: { message: '用户不存在' } });
  const newEnabled = !user.enabled;
  store.updateUser(user.id, { enabled: newEnabled });
  res.json({ success: true, message: `用户 ${user.username} 已${newEnabled ? '启用' : '禁用'}` });
});

// ========== Fund Trace ==========

// List all deposit orders (admin)
router.get('/deposits', (req, res) => {
  const status = req.query.status;
  let deposits = store.getDepositOrders ? store.getDepositOrders() : [];
  if (status) deposits = deposits.filter(d => d.status === status);
  res.json({ data: deposits });
});

// Cancel a pending deposit order (admin)
router.put('/deposits/:id/cancel', requireAdmin, (req, res) => {
  const order = store.getDepositOrder ? store.getDepositOrder(req.params.id) : null;
  if (!order) return res.status(404).json({ error: { message: '订单不存在' } });
  if (order.status !== 'pending') return res.status(400).json({ error: { message: '只能取消待处理的订单' } });
  store.updateDepositOrder(order.id, { status: 'cancelled', note: req.body.note || '管理员取消' });
  res.json({ success: true, message: '订单已取消' });
});

// Manually confirm a pending deposit order (admin only) — requires on-chain verification
router.put('/deposits/:id/confirm', requireAdmin, async (req, res) => {
  const order = store.getDepositOrder ? store.getDepositOrder(req.params.id) : null;
  if (!order) return res.status(404).json({ error: { message: '订单不存在' } });
  if (order.status !== 'pending') return res.status(400).json({ error: { message: '只能确认待处理的订单' } });

  // Verify transaction on-chain before crediting
  if (order.txHash) {
    const { verifyTransaction } = require('../services/usdtPayment');
    const result = await verifyTransaction(order.txHash, order.usdtAmount);
    if (!result.verified) {
      return res.status(400).json({ error: { message: '链上验证失败: ' + result.error } });
    }
  } else {
    // No txHash provided — require admin to explicitly bypass (with audit log)
    if (!req.body.forceConfirm) {
      return res.status(400).json({ error: { message: '用户未提供交易哈希，无法验证。如需强制确认，请在备注中说明原因并勾选强制确认。' } });
    }
    console.warn(`[Admin] Force-confirming deposit ${order.id} without txHash verification. Admin: ${req.adminUsername}, Note: ${req.body.note}`);
  }

  store.updateDepositOrder(order.id, { status: 'completed', confirmedAt: Date.now(), note: req.body.note || '管理员手动确认' });
  store.addCoins(order.userId, order.coins, `USDC 充值 ${order.usdtAmount} USDC → ${order.coins} 币 (管理员确认)`);
  store.addProcessedTx('manual_' + order.id);
  res.json({ success: true, message: `已确认到账，${order.coins} 金币已充入用户账户` });
});

// Trace user's complete fund flow
router.get('/trace/user/:userId', (req, res) => {
  const user = store.getUserById(req.params.userId);
  if (!user) return res.status(404).json({ error: { message: '用户不存在' } });

  const deposits = (store.getDepositOrders ? store.getDepositOrders() : [])
    .filter(o => o.userId === user.id);
  const withdrawals = store.getWithdrawalsByUser ? store.getWithdrawalsByUser(user.id) : [];
  const coinTxns = store.getCoinTransactions ? store.getCoinTransactions(user.id) : [];

  res.json({
    user: { id: user.id, username: user.username, coins: user.coins || 0, freeCoins: user.freeCoins || 0 },
    deposits: deposits.map(d => ({ id: d.id, amount: d.usdtAmount, coins: d.coins, status: d.status, txHash: d.txHash, createdAt: d.createdAt })),
    withdrawals: withdrawals.map(w => ({ id: w.id, coins: w.coins, usdtAmount: w.usdtAmount, status: w.status, createdAt: w.createdAt })),
    coinTransactions: coinTxns.slice(-50).map(t => ({ type: t.type, coins: t.coins, description: t.description, balanceAfter: t.balanceAfter, createdAt: t.createdAt })),
    summary: {
      totalDeposited: deposits.filter(d => d.status === 'completed').reduce((s, d) => s + (d.usdtAmount || 0), 0),
      totalWithdrawn: withdrawals.filter(w => w.status === 'completed').reduce((s, w) => s + (w.usdtAmount || 0), 0),
      pendingWithdrawals: withdrawals.filter(w => w.status === 'pending').length,
    },
  });
});

// Trace specific deposit order
router.get('/trace/order/:orderId', (req, res) => {
  const order = store.getDepositOrder ? store.getDepositOrder(req.params.orderId) : null;
  if (!order) return res.status(404).json({ error: { message: '订单不存在' } });

  const user = store.getUserById(order.userId);
  const coinTxns = store.getCoinTransactions ? store.getCoinTransactions(order.userId) : [];
  const relatedTxns = coinTxns.filter(t => t.description && t.description.includes(order.id));

  res.json({
    order: { ...order },
    user: user ? { id: user.id, username: user.username, coins: user.coins || 0 } : null,
    relatedTransactions: relatedTxns,
  });
});

// ========== Withdrawal Management ==========

// Reconciliation
router.get('/reconcile', (req, res) => {
  const result = store.reconcileCoins ? store.reconcileCoins() : { error: 'Not available' };
  res.json(result);
});

// List all withdrawals
router.get('/withdrawals', (req, res) => {
  const status = req.query.status; // optional filter: pending, completed, rejected
  let withdrawals = store.getWithdrawals ? store.getWithdrawals() : [];
  if (status) withdrawals = withdrawals.filter(w => w.status === status);
  res.json({ data: withdrawals });
});

// Get/set auto-approve setting
router.get('/withdrawals/settings', (req, res) => {
  const settings = store.getWithdrawalSettings ? store.getWithdrawalSettings() : { autoApprove: false, autoMaxUsdt: 50, autoDailyMaxUsdt: 200 };
  res.json(settings);
});

router.put('/withdrawals/settings', (req, res) => {
  const { autoApprove, autoMaxUsdt, autoDailyMaxUsdt } = req.body;
  const settings = {
    autoApprove: !!autoApprove,
    autoMaxUsdt: parseFloat(autoMaxUsdt) || 50,
    autoDailyMaxUsdt: parseFloat(autoDailyMaxUsdt) || 200,
  };
  if (store.updateWithdrawalSettings) store.updateWithdrawalSettings(settings);
  res.json({ success: true, settings });
});

// Approve withdrawal (manual USDT transfer required)
router.put('/withdrawals/:id/approve', (req, res) => {
  const { txHash, note } = req.body;
  const withdrawal = store.getWithdrawalById ? store.getWithdrawalById(req.params.id) : null;
  if (!withdrawal) return res.status(404).json({ error: { message: '提现记录不存在' } });
  if (withdrawal.status !== 'pending') return res.status(400).json({ error: { message: '只能审批待审核的提现' } });
  store.updateWithdrawal(withdrawal.id, {
    status: 'completed',
    processedAt: Date.now(),
    txHash: txHash || '',
    note: note || '已批准',
  });
  res.json({ success: true, message: '提现已批准' });
});

// Reject withdrawal (refund coins to user)
router.put('/withdrawals/:id/reject', (req, res) => {
  const { reason } = req.body;
  const withdrawal = store.getWithdrawalById ? store.getWithdrawalById(req.params.id) : null;
  if (!withdrawal) return res.status(404).json({ error: { message: '提现记录不存在' } });
  if (withdrawal.status !== 'pending') return res.status(400).json({ error: { message: '只能拒绝待审核的提现' } });
  // Refund coins to user using locked store method
  const user = store.getUserById(withdrawal.userId);
  if (!user) {
    return res.status(400).json({ error: { message: '用户不存在，无法退款' } });
  }
  const refunded = store.addCoins(withdrawal.userId, withdrawal.coins, `提现被拒绝，退还 ${withdrawal.coins} 币`);
  if (!refunded) {
    return res.status(500).json({ error: { message: '退款失败，系统繁忙，请重试' } });
  }
  store.updateWithdrawal(withdrawal.id, {
    status: 'rejected',
    processedAt: Date.now(),
    note: req.body.reason || '已拒绝',
  });
  res.json({ success: true, message: `提现已拒绝，${withdrawal.coins} 金币已退还` });
});

// ========== Dispute Management ==========

// Get all disputed orders (pending + resolved)
router.get('/disputes', (req, res) => {
  const orders = store.getOrders();
  const disputes = orders
    .filter(o => o.status === 'disputed' || o.status === 'refunded' || o.status === 'dispute_rejected' || o.refundReason)
    .map(o => {
      const buyer = store.getUserById(o.buyerId);
      const seller = store.getUserById(o.sellerId);
      const listing = store.getListingById(o.listingId);
      return {
        ...o,
        buyerName: buyer?.username || o.buyerId,
        sellerName: seller?.username || o.sellerId,
        buyerEmail: buyer?.email ? buyer.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : '',
        sellerEmail: seller?.email ? seller.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : '',
        listingDesc: listing?.description || o.listingId,
      };
    })
    .sort((a, b) => {
      // Pending disputes first
      if (a.status === 'disputed' && b.status !== 'disputed') return -1;
      if (a.status !== 'disputed' && b.status === 'disputed') return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  res.json({ data: disputes });
});

// Approve dispute — refund buyer, deduct from seller
router.post('/disputes/:id/approve', (req, res) => {
  const order = store.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: { message: '订单不存在' } });
  if (order.status !== 'disputed' && order.status !== 'frozen') {
    return res.status(400).json({ error: { message: '只能审批待处理的申诉' } });
  }

  // Calculate refund amount based on usage
  const usagePercent = order.disputeUsagePercent || 0;
  let refundAmount = order.totalPrice;
  if (usagePercent > 20) {
    const remainingRatio = (100 - usagePercent) / 100;
    refundAmount = Math.floor(order.totalPrice * remainingRatio);
  }

  // Refund from seller to buyer
  if (order.status === 'frozen') {
    // Coins still frozen — use refundCoins
    const refundOk = store.refundCoins(order.buyerId, order.totalPrice, '管理员批准退款: ' + (order.refundReason || ''));
    if (!refundOk) return res.status(500).json({ error: { message: '退款失败' } });
  } else {
    // Coins already released to seller — use refundFromSeller
    const refundOk = store.refundFromSeller(order.buyerId, order.sellerId, refundAmount, '管理员批准退款: ' + (order.refundReason || ''));
    if (!refundOk) return res.status(500).json({ error: { message: '退款失败，卖家余额不足' } });
  }

  // Restore listing quota (proportional)
  const listing = store.getListingById(order.listingId);
  if (listing) {
    const quotaRestore = usagePercent > 20 ? Math.floor(order.amount * (100 - usagePercent) / 100) : order.amount;
    store.updateListing(order.listingId, { remainingQuota: (listing.remainingQuota || 0) + quotaRestore });
  }

  store.updateOrder(order.id, {
    status: 'refunded',
    refundAmount,
    adminNote: req.body.adminNote || '',
    resolvedAt: Date.now(),
  });

  res.json({ success: true, message: `已批准退款 ${refundAmount} 金币`, refundAmount });
});

// Reject dispute — order stays as completed, re-enable buyer key
router.post('/disputes/:id/reject', (req, res) => {
  const order = store.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: { message: '订单不存在' } });
  if (order.status !== 'disputed') {
    return res.status(400).json({ error: { message: '只能驳回待处理的申诉' } });
  }

  // Re-enable buyer's key
  const buyerKeys = store.getMarketApiKeys().filter(k => k.userId === order.buyerId && k.listingId === order.listingId);
  buyerKeys.forEach(k => store.updateMarketApiKey(k.key, { enabled: true }));

  store.updateOrder(order.id, {
    status: 'completed',
    adminNote: '管理员驳回: ' + (req.body.reason || '无理由'),
    resolvedAt: Date.now(),
  });

  res.json({ success: true, message: '申诉已驳回，订单恢复为已完成' });
});

// ========== Redemption Codes (admin only) ==========

// List all redemption codes
router.get('/redeem-codes', requireAdmin, (req, res) => {
  const codes = store.getRedemptionCodes ? store.getRedemptionCodes() : [];
  const enriched = codes.map(c => {
    const usedByUser = c.usedBy ? store.getUserById(c.usedBy) : null;
    return {
      ...c,
      usedByName: usedByUser?.username || c.usedBy || null,
    };
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json({ data: enriched });
});

// Create redemption code(s)
router.post('/redeem-codes', requireAdmin, (req, res) => {
  const { coins, count = 1 } = req.body;
  if (!coins || coins <= 0) return res.status(400).json({ error: { message: '金币数量必须大于 0' } });
  if (count < 1 || count > 50) return res.status(400).json({ error: { message: '数量范围 1-50' } });

  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = 'COIN-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    store.addRedemptionCode({
      code,
      coins: parseFloat(coins),
      createdAt: Date.now(),
      createdBy: req.adminUsername || 'admin',
    });
    codes.push(code);
  }

  res.json({ success: true, codes, message: `已创建 ${codes.length} 个兑换码，每个 ${coins} 金币` });
});

// Delete a redemption code (only if unused)
router.delete('/redeem-codes/:code', requireAdmin, (req, res) => {
  const codes = store.getRedemptionCodes ? store.getRedemptionCodes() : [];
  const code = codes.find(c => c.code === req.params.code);
  if (!code) return res.status(404).json({ error: { message: '兑换码不存在' } });
  if (code.usedBy) return res.status(400).json({ error: { message: '已使用的兑换码不能删除' } });
  // Remove from store (need to add this method or do it directly)
  if (store.removeRedemptionCode) {
    store.removeRedemptionCode(req.params.code);
  }
  res.json({ success: true, message: '兑换码已删除' });
});

module.exports = router;
