const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const config = require('../config');
const store = require('../store');
const providerManager = require('../services/provider');
const logger = require('../services/logger');

const router = Router();

// Login endpoint is now in index.js (before adminAuth middleware)

// Providers
router.get('/providers', (req, res) => {
  res.json({ providers: providerManager.getProvidersInfo() });
});

router.post('/providers', (req, res) => {
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

router.put('/providers/:name', (req, res) => {
  const { name } = req.params;
  const changes = req.body;
  const success = providerManager.updateProvider(name, changes);
  if (!success) {
    return res.status(404).json({ error: { message: 'Provider not found' } });
  }
  res.json({ success: true, message: 'Provider updated' });
});

router.delete('/providers/:name', (req, res) => {
  const { name } = req.params;
  const success = providerManager.removeProvider(name);
  if (!success) {
    return res.status(404).json({ error: { message: 'Provider not found' } });
  }
  res.json({ success: true, message: 'Provider removed' });
});

router.post('/providers/:name/test', async (req, res) => {
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

router.post('/providers/:name/reset-breaker', (req, res) => {
  const { name } = req.params;
  providerManager.resetCircuitBreaker(name);
  res.json({ success: true, message: 'Circuit breaker reset' });
});

// API Keys
router.get('/keys', (req, res) => {
  const keys = store.getApiKeys().map(k => ({
    ...k,
    key: k.key.slice(0, 8) + '...' + k.key.slice(-4),
  }));
  res.json({ keys });
});

router.post('/keys', (req, res) => {
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

router.put('/keys/:key', (req, res) => {
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

router.delete('/keys/:key', (req, res) => {
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
router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const model = req.query.model;
  const provider = req.query.provider;
  let logs = logger.getRecentLogs(limit);
  if (model) logs = logs.filter(l => l.model === model);
  if (provider) logs = logs.filter(l => l.provider === provider);
  res.json({ logs });
});

router.delete('/logs', (req, res) => {
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

// ========== Withdrawal Management ==========

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
  // Refund coins to user
  store.addCoins(withdrawal.userId, withdrawal.coins, `提现被拒绝，退还 ${withdrawal.coins} 币`);
  store.updateWithdrawal(withdrawal.id, {
    status: 'rejected',
    processedAt: Date.now(),
    note: reason || '已拒绝',
  });
  res.json({ success: true, message: '提现已拒绝，金币已退还' });
});

module.exports = router;
