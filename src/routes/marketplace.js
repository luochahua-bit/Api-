const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const { sanitizeResponse, sanitizeStreamChunk, logIncident } = require('../services/security');
const { generateCode, sendVerificationEmail } = require('../services/email');
const { validateEmail, normalizeEmail } = require('../utils/emailValidator');
const { generateFreeKey, FREE_DAILY_LIMIT } = require('../utils/freeKeyManager');
const { createPaymentOrder, processSimulatedPayment, getUserPayments } = require('../services/payment');
const store = require('../store');
const userAuth = require('../middleware/userAuth');
const adminAuth = require('../middleware/adminAuth');
const { JWT_SECRET } = require('../middleware/userAuth');
const {
  genId, encryptKey, decryptKey, testProviderKey, verifyModelsExist, verifyModelIdentity,
  processMarketRequest, calculatePrice, calculateModelPrice,
  freezeFunds, releaseFunds, refundFunds,
  topUpBalance, processPayment, calculateFeeWithCredits,
  detectSourceLevel,
} = require('../services/marketplace');

const router = Router();

// ==================== Auth ====================

// Send verification code
const sendCodeLimiter = {};
const ipRegisterLimiter = {};
const loginLimiter = {}; // IP login attempts: { count, ts }
// Clean up expired rate limit entries every 5 minutes to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - 300000; // 5 minutes ago
  const ipCutoff = Date.now() - 3600000; // 1 hour ago
  for (const key in sendCodeLimiter) {
    if (sendCodeLimiter[key] < cutoff) delete sendCodeLimiter[key];
  }
  for (const key in ipRegisterLimiter) {
    if (ipRegisterLimiter[key].ts < ipCutoff) delete ipRegisterLimiter[key];
  }
  for (const key in loginLimiter) {
    if (loginLimiter[key].ts < cutoff) delete loginLimiter[key];
  }
}, 300000);
router.post('/auth/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: { message: '请输入邮箱' } });

  // IP registration rate limit: max 3 per hour per IP
  const ip = req.ip;
  const now = Date.now();
  if (!ipRegisterLimiter[ip]) ipRegisterLimiter[ip] = { count: 0, ts: now };
  if (now - ipRegisterLimiter[ip].ts > 3600000) ipRegisterLimiter[ip] = { count: 0, ts: now };
  ipRegisterLimiter[ip].count++;
  if (ipRegisterLimiter[ip].count > 3) {
    return res.status(429).json({ error: { message: '注册过于频繁，请 1 小时后再试' } });
  }

  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) return res.status(400).json({ error: { message: emailCheck.reason } });
  const normalizedEmail = normalizeEmail(email);
  // Rate limit: 60 seconds per email
  if (sendCodeLimiter[normalizedEmail] && now - sendCodeLimiter[normalizedEmail] < 60000) {
    const wait = Math.ceil((60000 - (now - sendCodeLimiter[normalizedEmail])) / 1000);
    return res.status(429).json({ error: { message: `${wait} 秒后可重新发送` } });
  }
  if (store.getUserByEmail(normalizedEmail)) return res.status(409).json({ error: { message: '邮箱已注册' } });
  const code = generateCode();
  store.addVerificationCode({ id: 'vc_' + crypto.randomUUID(), email: normalizedEmail, code, expiresAt: now + 5 * 60 * 1000, used: false, createdAt: now });
  sendCodeLimiter[normalizedEmail] = now;
  const result = await sendVerificationEmail(normalizedEmail, code);
  if (result.success) {
    res.json({ success: true, message: '验证码已发送到 ' + normalizedEmail, simulated: result.simulated || false });
  } else {
    res.status(500).json({ error: { message: '发送失败: ' + result.error } });
  }
});

// Verify email
router.post('/auth/verify-email', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: { message: '邮箱和验证码必填' } });
  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) return res.status(400).json({ error: { message: emailCheck.reason } });
  const normalizedEmail = normalizeEmail(email);
  const vc = store.getValidVerificationCode(normalizedEmail, code);
  if (!vc) return res.status(400).json({ error: { message: '验证码无效或已过期' } });
  store.markCodeUsed(normalizedEmail);
  // Mark user as verified
  const user = store.getUserByEmail(normalizedEmail);
  if (user) store.updateUser(user.id, { emailVerified: true });
  res.json({ success: true, message: '邮箱验证成功' });
});

router.post('/auth/register', async (req, res) => {
  const { username, password, email, code } = req.body;
  if (!username || !password || !email || !code) return res.status(400).json({ error: { message: '用户名、密码、邮箱、验证码必填' } });
  const emailCheck = validateEmail(email);
  if (!emailCheck.valid) return res.status(400).json({ error: { message: emailCheck.reason } });
  const normalizedEmail = normalizeEmail(email);
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: { message: '用户名 3-20 个字符' } });
  if (password.length < 6) return res.status(400).json({ error: { message: '密码至少 6 位' } });
  if (store.getUserByUsername(username)) return res.status(409).json({ error: { message: '用户名已存在' } });
  if (store.getUserByEmail(normalizedEmail)) return res.status(409).json({ error: { message: '邮箱已注册' } });
  // Verify code
  const vc = store.getValidVerificationCode(normalizedEmail, code);
  if (!vc) return res.status(400).json({ error: { message: '验证码无效或已过期' } });
  store.markCodeUsed(normalizedEmail);

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: genId('usr'), username, password: hashedPassword, email: normalizedEmail,
    nickname: '', bio: '',
    role: 'buyer',
    coins: 0, freeCoins: 0, frozenCoins: 0, totalCoinEarnings: 0, totalCoinSpending: 0, feeCredits: 0,
    balance: 0, frozenBalance: 0, totalEarnings: 0, totalSpending: 0,
    emailVerified: true, // verified during registration
    rating: 5.0, ratingCount: 0, createdAt: Date.now(), enabled: true,
  };
  store.addUser(user);
  // Auto-generate free API key
  const { key: freeKey } = generateFreeKey(user.id, username);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  const { password: _, ...safeUser } = user;
  res.json({ success: true, token, user: safeUser, freeApiKey: freeKey, freeDailyLimit: FREE_DAILY_LIMIT });
});

router.post('/auth/login', async (req, res) => {
  // Rate limit: 5 attempts per IP per minute
  const ip = req.ip;
  const now = Date.now();
  if (!loginLimiter[ip]) loginLimiter[ip] = { count: 0, ts: now };
  if (now - loginLimiter[ip].ts > 60000) loginLimiter[ip] = { count: 0, ts: now };
  loginLimiter[ip].count++;
  if (loginLimiter[ip].count > 5) {
    return res.status(429).json({ error: { message: '登录尝试过于频繁，请 1 分钟后再试' } });
  }

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: { message: '用户名和密码必填' } });
  const user = store.getUserByUsername(username);
  if (!user) return res.status(401).json({ error: { message: '用户名或密码错误' } });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: { message: '用户名或密码错误' } });
  if (!user.enabled) return res.status(403).json({ error: { message: '账号已被禁用' } });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  const { password: _, ...safeUser } = user;
  res.json({ success: true, token, user: safeUser });
});

router.get('/auth/profile', userAuth, (req, res) => {
  const { password: _, ...safeUser } = req.user;
  res.json(safeUser);
});

router.put('/auth/profile', userAuth, async (req, res) => {
  const { email, password, nickname, bio, phone } = req.body;
  const changes = {};
  if (email) {
    const emailCheck = validateEmail(email);
    if (!emailCheck.valid) return res.status(400).json({ error: { message: emailCheck.reason } });
    changes.email = normalizeEmail(email);
  }
  if (password) changes.password = await bcrypt.hash(password, 10);
  if (nickname !== undefined) {
    const n = nickname.trim();
    if (n.length < 2 || n.length > 20) return res.status(400).json({ error: { message: '昵称 2-20 个字符' } });
    changes.nickname = n;
  }
  if (bio !== undefined) {
    const b = bio.trim();
    if (b.length > 100) return res.status(400).json({ error: { message: '简介最多 100 字符' } });
    changes.bio = b;
  }
  if (phone !== undefined) {
    const p = phone.trim().replace(/\s/g, '');
    if (p && !/^1[3-9]\d{9}$/.test(p) && !/^\+\d{7,15}$/.test(p)) {
      return res.status(400).json({ error: { message: '手机号格式不正确' } });
    }
    changes.phone = p;
  }
  store.updateUser(req.userId, changes);
  const user = store.getUserById(req.userId);
  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

// ==================== Tasks ====================

const { TASKS, generateInviteCode, isDailyTaskDone, isOnceTaskDone, getTasksForUser } = require('../tasks');

// Get available tasks
router.get('/tasks', userAuth, (req, res) => {
  const completions = store.getTaskCompletions(req.userId);
  const tasks = getTasksForUser(req.user, completions);
  res.json({ tasks, freeCoins: req.user.freeCoins || 0, coins: req.user.coins || 0 });
});

// Claim task reward — with anti-abuse rate limiting
const taskClaimLimiter = {};
router.post('/tasks/:taskId/claim', userAuth, (req, res) => {
  const { taskId } = req.params;

  // Rate limit: max 10 task claims per minute per user
  const now = Date.now();
  const limiterKey = 'task_' + req.userId;
  if (!taskClaimLimiter[limiterKey]) taskClaimLimiter[limiterKey] = [];
  taskClaimLimiter[limiterKey] = taskClaimLimiter[limiterKey].filter(t => now - t < 60000);
  if (taskClaimLimiter[limiterKey].length >= 10) {
    return res.status(429).json({ error: { message: '操作过于频繁，请稍后再试' } });
  }
  taskClaimLimiter[limiterKey].push(now);

  const task = TASKS.find(t => t.id === taskId);
  if (!task) return res.status(404).json({ error: { message: '任务不存在' } });

  // New account cooldown: daily tasks (sign-in) available immediately,
  // other tasks require account to be at least 24 hours old
  if (task.type !== 'daily') {
    const accountAge = Date.now() - (req.user.createdAt || 0);
    if (accountAge < 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: { message: '新注册用户需满 24 小时后才能领取此任务，请先签到' } });
    }
  }

  const completions = store.getTaskCompletions(req.userId);

  // Check if already completed
  if (task.type === 'daily' && isDailyTaskDone(completions, taskId)) {
    return res.status(400).json({ error: { message: '今天已签到，明天再来' } });
  }
  if (task.type === 'once' && isOnceTaskDone(completions, taskId)) {
    return res.status(400).json({ error: { message: '此任务已完成' } });
  }

  // Task-specific validation
  if (taskId === 'complete_profile') {
    // Check if profile is actually complete (nickname + bio filled)
    if (!req.user.nickname || !req.user.bio) {
      return res.status(400).json({ error: { message: '请先完善个人资料（昵称 + 简介）' } });
    }
  }

  // Record completion and award coins
  store.addTaskCompletion(req.userId, taskId, task.reward);
  store.addFreeCoins(req.userId, task.reward, '任务奖励: ' + task.name);

  const user = store.getUserById(req.userId);
  res.json({
    success: true,
    reward: task.reward,
    freeCoins: user.freeCoins || 0,
    message: `获得 ${task.reward} 免费币`,
  });
});

// Get invite code
router.get('/tasks/invite-code', userAuth, (req, res) => {
  const existing = store.getInviteCode(req.userId);
  if (existing) {
    return res.json({ code: existing.code, usedCount: existing.usedBy.length });
  }
  const code = generateInviteCode(req.userId);
  store.addInviteCode(req.userId, code);
  res.json({ code, usedCount: 0 });
});

// Use invite code (during or after registration)
router.post('/tasks/use-invite', userAuth, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: { message: '请输入邀请码' } });

  const result = store.useInviteCode(code.trim().toUpperCase(), req.userId);
  if (!result.success) return res.status(400).json({ error: { message: result.error } });

  // Reward both inviter and invitee
  store.addFreeCoins(result.inviterId, 50, '邀请奖励: 好友注册');
  store.addFreeCoins(req.userId, 30, '被邀请奖励: 使用邀请码');
  store.addTaskCompletion(req.userId, 'invite_friend', 50);

  res.json({ success: true, message: '邀请码验证成功，你获得 30 免费币' });
});

// ==================== Listings ====================

router.get('/listings', (req, res) => {
  let listings = store.getActiveListings();
  if (req.query.model) {
    listings = listings.filter(l => l.models && l.models.some(m =>
      m.toLowerCase().includes(req.query.model.toLowerCase())
    ));
  }
  if (req.query.seller) listings = listings.filter(l => l.sellerName === req.query.seller);

  const sortBy = req.query.sort || 'createdAt';
  const order = req.query.order === 'asc' ? 1 : -1;
  listings.sort((a, b) => {
    if (sortBy === 'price') return (a.pricePerRequest - b.pricePerRequest) * order;
    if (sortBy === 'rating') return (a.rating - b.rating) * order;
    if (sortBy === 'quota') return (a.remainingQuota - b.remainingQuota) * order;
    return (a.createdAt - b.createdAt) * order;
  });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const total = listings.length;
  const start = (page - 1) * limit;
  const data = listings.slice(start, start + limit).map(l => ({
    ...l, apiKey: undefined,
    apiKeyMasked: l.apiKey ? l.apiKey.slice(0, 8) + '...' : '',
    buyerCount: store.getActiveBuyerCount(l.id),
  }));
  res.json({ total, page, limit, data });
});

router.get('/listings/:id', (req, res) => {
  const listing = store.getListingById(req.params.id);
  if (!listing) return res.status(404).json({ error: { message: '商品不存在' } });
  const seller = store.getUserById(listing.sellerId);
  const reviews = store.getReviewsByListing(listing.id);
  res.json({
    ...listing, apiKey: undefined,
    apiKeyMasked: listing.apiKey ? listing.apiKey.slice(0, 8) + '...' : '',
    buyerCount: store.getActiveBuyerCount(listing.id),
    sellerInfo: seller ? { username: seller.username, rating: seller.rating, ratingCount: seller.ratingCount } : null,
    reviews: reviews.slice(0, 10),
  });
});

router.post('/listings', userAuth, async (req, res) => {
  const { baseUrl, apiKey, description, models, modelRates, pricePerRequest, pricePerToken, totalQuota, sharingMode } = req.body;
  if (!baseUrl || !apiKey) return res.status(400).json({ error: { message: 'baseUrl 和 apiKey 必填' } });
  if (!pricePerRequest && !pricePerToken) return res.status(400).json({ error: { message: '至少设置一种价格' } });
  if (pricePerRequest && pricePerRequest < 0.01) return res.status(400).json({ error: { message: '价格最低 0.01 金币' } });

  // Step 1: Test API key is working
  const testResult = await testProviderKey(baseUrl, apiKey);
  if (!testResult.healthy) return res.status(400).json({ error: { message: `API Key 测试失败: ${testResult.error}` } });

  // Step 1.5: Detect source level
  const sourceLevel = detectSourceLevel(baseUrl, testResult.latency);

  // Step 2: Verify claimed models actually exist
  const claimedModels = models || [];
  let verification = { valid: true, verified: claimedModels, missing: [], details: {} };
  if (claimedModels.length > 0) {
    verification = await verifyModelsExist(baseUrl, apiKey, claimedModels);
    if (!verification.valid) {
      return res.status(400).json({
        error: { message: `模型验证失败: 以下模型不存在: ${verification.missing.join(', ')}` },
        verification,
      });
    }
  }

  // modelRates: { "gpt-4o": 10, "gpt-3.5-turbo": 1, "deepseek": 0.5 }
  const rates = {};
  if (modelRates && typeof modelRates === 'object') {
    for (const [model, rate] of Object.entries(modelRates)) {
      rates[model] = parseFloat(rate) || 1;
    }
  }

  const listing = {
    id: genId('lst'), sellerId: req.userId, sellerName: req.user.username,
    providerType: 'openai-compatible', baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey: encryptKey(apiKey), description: description || `${req.user.username} 的 API`,
    models: claimedModels, modelRates: rates,
    pricePerRequest: parseFloat(pricePerRequest) || 0,
    pricePerToken: parseFloat(pricePerToken) || 0,
    totalQuota: parseInt(totalQuota) || 10000,
    remainingQuota: parseInt(totalQuota) || 10000,
    sharingMode: sharingMode === 'exclusive' ? 'exclusive' : 'shared', // 'shared' | 'exclusive'
    source: sourceLevel,
    status: 'active',
    health: { lastCheck: Date.now(), latency: testResult.latency || 0, healthy: true },
    verification: {
      lastVerified: Date.now(), verified: true,
      modelCount: verification.details?.verified || claimedModels.length,
      totalUpstream: verification.totalActual || 0,
    },
    createdAt: Date.now(), soldCount: 0, rating: 5.0, ratingCount: 0,
  };
  store.addListing(listing);
  if (req.user.role !== 'seller') store.updateUser(req.userId, { role: 'seller' });
  res.json({ success: true, verification, listing: { ...listing, apiKey: undefined, apiKeyMasked: apiKey.slice(0, 8) + '...' } });
});

router.put('/listings/:id', userAuth, (req, res) => {
  const listing = store.getListingById(req.params.id);
  if (!listing) return res.status(404).json({ error: { message: '商品不存在' } });
  if (listing.sellerId !== req.userId) return res.status(403).json({ error: { message: '只能编辑自己的商品' } });
  const allowed = ['description', 'models', 'modelRates', 'pricePerRequest', 'pricePerToken', 'totalQuota', 'remainingQuota', 'sharingMode', 'status'];
  const changes = {};
  for (const key of allowed) { if (req.body[key] !== undefined) changes[key] = req.body[key]; }

  // If seller increased remainingQuota, re-enable disabled buyer keys
  if (changes.remainingQuota !== undefined && changes.remainingQuota > listing.remainingQuota) {
    const reenabled = store.reenableBuyerKeys(listing.id);
    if (reenabled > 0) console.log(`[Market] Re-enabled ${reenabled} buyer keys for listing ${listing.id}`);
  }

  // If seller increased totalQuota, also increase remainingQuota by the difference
  if (changes.totalQuota !== undefined && changes.totalQuota > listing.totalQuota) {
    const diff = changes.totalQuota - listing.totalQuota;
    changes.remainingQuota = (changes.remainingQuota || listing.remainingQuota) + diff;
    const reenabled = store.reenableBuyerKeys(listing.id);
    if (reenabled > 0) console.log(`[Market] Re-enabled ${reenabled} buyer keys for listing ${listing.id}`);
  }

  store.updateListing(listing.id, changes);
  res.json({ success: true });
});

router.delete('/listings/:id', userAuth, (req, res) => {
  const listing = store.getListingById(req.params.id);
  if (!listing) return res.status(404).json({ error: { message: '商品不存在' } });
  if (listing.sellerId !== req.userId) return res.status(403).json({ error: { message: '只能删除自己的商品' } });
  store.removeListing(listing.id);
  res.json({ success: true });
});

// Probe available models from an API key (before creating a listing)
router.post('/probe-models', userAuth, async (req, res) => {
  const { baseUrl, apiKey } = req.body;
  if (!baseUrl || !apiKey) return res.status(400).json({ error: { message: 'baseUrl 和 apiKey 必填' } });

  const result = await testProviderKey(baseUrl, apiKey);
  if (!result.healthy) {
    return res.status(400).json({ error: { message: `API Key 不可用: ${result.error}` } });
  }

  const models = (result.models || []).map(m => ({
    id: m.id || m.name,
    name: m.name || m.id,
    owned_by: m.owned_by || '',
  }));

  res.json({
    healthy: true,
    latency: result.latency,
    modelCount: models.length,
    models,
  });
});

router.post('/listings/:id/test', userAuth, async (req, res) => {
  const listing = store.getListingById(req.params.id);
  if (!listing) return res.status(404).json({ error: { message: '商品不存在' } });
  if (listing.sellerId !== req.userId) return res.status(403).json({ error: { message: '只能测试自己的商品' } });
  const apiKey = decryptKey(listing.apiKey);
  const result = await testProviderKey(listing.baseUrl, apiKey);
  store.updateListing(listing.id, { health: { lastCheck: Date.now(), latency: result.latency || 0, healthy: result.healthy } });
  res.json(result);
});

// Rotate seller's upstream API key
router.post('/listings/:id/rotate-key', userAuth, async (req, res) => {
  const listing = store.getListingById(req.params.id);
  if (!listing) return res.status(404).json({ error: { message: '商品不存在' } });
  if (listing.sellerId !== req.userId) return res.status(403).json({ error: { message: '只能更换自己商品的 Key' } });

  const { newApiKey, newBaseUrl } = req.body;
  if (!newApiKey) return res.status(400).json({ error: { message: '新 API Key 必填' } });

  const testUrl = newBaseUrl || listing.baseUrl;
  const testResult = await testProviderKey(testUrl, newApiKey);
  if (!testResult.healthy) {
    return res.status(400).json({ error: { message: `新 Key 验证失败: ${testResult.error}` } });
  }

  // Verify models still work with new key
  const claimedModels = listing.models || [];
  let verification = { valid: true, verified: claimedModels, missing: [] };
  if (claimedModels.length > 0) {
    verification = await verifyModelsExist(testUrl, newApiKey, claimedModels);
  }

  // Update listing with new key
  const updates = {
    apiKey: encryptKey(newApiKey),
    health: { lastCheck: Date.now(), latency: testResult.latency || 0, healthy: true },
  };
  if (newBaseUrl) updates.baseUrl = newBaseUrl.replace(/\/+$/, '');
  if (claimedModels.length > 0) {
    updates.verification = {
      lastVerified: Date.now(), verified: verification.valid,
      modelCount: verification.details?.verified || 0,
      totalUpstream: verification.totalActual || 0,
      missing: verification.missing || [],
    };
  }

  store.updateListing(listing.id, updates);

  // If old key was causing issues, re-enable disabled buyer keys
  if (!listing.health?.healthy) {
    const reenabled = store.reenableBuyerKeys(listing.id);
    if (reenabled > 0) console.log(`[Market] Re-enabled ${reenabled} buyer keys after key rotation for ${listing.id}`);
  }

  const buyerCount = store.getActiveBuyerCount(listing.id);
  res.json({
    success: true,
    message: `Key 已更换，${buyerCount} 个买家的代理 Key 将自动使用新 Key`,
    verification,
    buyerCount,
  });
});

// Verify models for a listing (seller can check their own)
router.post('/listings/:id/verify', userAuth, async (req, res) => {
  const listing = store.getListingById(req.params.id);
  if (!listing) return res.status(404).json({ error: { message: '商品不存在' } });
  if (listing.sellerId !== req.userId) return res.status(403).json({ error: { message: '只能验证自己的商品' } });

  const apiKey = decryptKey(listing.apiKey);
  const verification = await verifyModelsExist(listing.baseUrl, apiKey, listing.models || []);

  store.updateListing(listing.id, {
    verification: {
      lastVerified: Date.now(), verified: verification.valid,
      modelCount: verification.details?.verified || 0,
      totalUpstream: verification.totalActual || 0,
      missing: verification.missing || [],
    },
    health: { lastCheck: Date.now(), latency: 0, healthy: verification.valid },
  });

  res.json(verification);
});

// Verify a specific model identity (test if model is what it claims to be)
router.post('/listings/:id/verify-model', userAuth, async (req, res) => {
  const listing = store.getListingById(req.params.id);
  if (!listing) return res.status(404).json({ error: { message: '商品不存在' } });
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: { message: 'model 必填' } });

  const apiKey = decryptKey(listing.apiKey);
  const result = await verifyModelIdentity(listing.baseUrl, apiKey, model);
  res.json(result);
});

// ==================== Orders (担保交易) ====================

// Create order with escrow
router.post('/orders', userAuth, async (req, res) => {
  const { listingId, amount } = req.body;
  if (!listingId) return res.status(400).json({ error: { message: 'listingId 必填' } });

  const listing = store.getListingById(listingId);
  if (!listing) return res.status(404).json({ error: { message: '商品不存在' } });
  if (listing.status !== 'active') return res.status(400).json({ error: { message: '商品已下架' } });
  if (listing.sellerId === req.userId) return res.status(400).json({ error: { message: '不能购买自己的商品' } });

  const purchaseAmount = parseInt(amount) || 1;
  if (listing.remainingQuota < purchaseAmount) return res.status(400).json({ error: { message: `库存不足，剩余 ${listing.remainingQuota}` } });

  // Exclusive mode: only allow one buyer at a time
  if (listing.sharingMode === 'exclusive') {
    const existingBuyers = store.getActiveBuyerCount(listing.id);
    if (existingBuyers > 0) {
      return res.status(400).json({ error: { message: '此商品为独占模式，已被其他用户购买' } });
    }
  }

  const totalPrice = listing.pricePerRequest * purchaseAmount;

  // Step 1: Freeze buyer's coins as deposit
  if (totalPrice > 0) {
    const freezeResult = store.freezeCoins(req.userId, totalPrice, '购买 ' + listing.description);
    if (!freezeResult) return res.status(400).json({ error: { message: '金币余额不足，需要 ' + totalPrice + ' 金币' } });
  }

  // Step 2: Create order with 'frozen' status
  const order = {
    id: genId('ord'), buyerId: req.userId, sellerId: listing.sellerId,
    listingId: listing.id, amount: purchaseAmount, totalPrice,
    description: listing.description,
    status: totalPrice > 0 ? 'frozen' : 'completed',
    createdAt: Date.now(),
  };
  store.addOrder(order);

  // Step 3: Quick key health check (lightweight, async-friendly)
  const apiKey = decryptKey(listing.apiKey);
  const verifyResult = await testProviderKey(listing.baseUrl, apiKey);

  if (verifyResult.healthy) {
    // Key works - release coins to seller
    if (totalPrice > 0) {
      const buyer = store.getUserById(req.userId);
      const { finalFee } = calculateFeeWithCredits(totalPrice, buyer.feeCredits || 0);
      store.releaseCoins(req.userId, listing.sellerId, totalPrice, finalFee, '购买 ' + listing.description);
      // Deduct used fee credits
      const discount = totalPrice >= 1500 ? Math.min(buyer.feeCredits || 0, Math.ceil(totalPrice * 0.05)) : Math.min(buyer.feeCredits || 0, Math.ceil(totalPrice * 0.01));
      if (discount > 0) store.updateUser(req.userId, { feeCredits: (buyer.feeCredits || 0) - discount });
    }
    // Update listing: decrement quota
    store.updateListing(listing.id, {
      remainingQuota: listing.remainingQuota - purchaseAmount,
      soldCount: (listing.soldCount || 0) + purchaseAmount,
    });
    store.updateOrder(order.id, { status: 'completed' });

    // Generate buyer API key
    const buyerKey = `mk-${crypto.randomBytes(24).toString('hex')}`;
    store.addMarketApiKey({
      key: buyerKey, userId: req.userId, listingId: listing.id,
      sellerId: listing.sellerId, remainingQuota: purchaseAmount,
      enabled: true, createdAt: Date.now(),
    });

    // Update listing health
    store.updateListing(listing.id, { health: { lastCheck: Date.now(), latency: verifyResult.latency || 0, healthy: true } });

    // Background: run full model verification (non-blocking)
    if (listing.models && listing.models.length > 0) {
      setImmediate(async () => {
        try {
          const fullVerify = await verifyModelsExist(listing.baseUrl, apiKey, listing.models);
          store.updateListing(listing.id, {
            verification: {
              lastVerified: Date.now(), verified: fullVerify.valid,
              modelCount: fullVerify.details?.verified || 0,
              totalUpstream: fullVerify.totalActual || 0,
              missing: fullVerify.missing || [],
            },
          });
          // If models changed, mark listing for review
          if (!fullVerify.valid) {
            console.log(`[Verify] Listing ${listing.id} model mismatch: ${fullVerify.missing.join(', ')}`);
          }
        } catch (e) {
          console.error('[Verify] Background verification failed:', e.message);
        }
      });
    }

    res.json({
      success: true, order: store.getOrderById(order.id), apiKey: buyerKey,
      verify: { healthy: true, latency: verifyResult.latency },
    });
  } else {
    // Key failed - refund coins to buyer
    if (totalPrice > 0) store.refundCoins(req.userId, totalPrice, 'Key 验证失败，金币退回');
    store.updateOrder(order.id, { status: 'refunded', refundReason: 'Key 验证失败' });
    store.updateListing(listing.id, { health: { lastCheck: Date.now(), latency: 0, healthy: false } });
    res.status(400).json({
      error: { message: `卖家的 API Key 验证失败: ${verifyResult.error}，资金已退回` },
      order: store.getOrderById(order.id),
      verify: { healthy: false, error: verifyResult.error },
    });
  }
});

// Manual confirm order (buyer confirms key works after testing)
router.post('/orders/:id/confirm', userAuth, (req, res) => {
  const order = store.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: { message: '订单不存在' } });
  if (order.buyerId !== req.userId) return res.status(403).json({ error: { message: '只能确认自己的订单' } });
  if (order.status !== 'frozen') return res.status(400).json({ error: { message: '订单状态异常' } });

  // Use coin system with fee credits
  const buyer = store.getUserById(order.buyerId);
  const { finalFee, discount } = calculateFeeWithCredits(order.totalPrice, buyer.feeCredits || 0);
  store.releaseCoins(order.buyerId, order.sellerId, order.totalPrice, finalFee, '确认收货');
  if (discount > 0) store.updateUser(order.buyerId, { feeCredits: (buyer.feeCredits || 0) - discount });
  store.updateOrder(order.id, { status: 'completed' });
  res.json({ success: true, order: store.getOrderById(order.id) });
});

// Dispute order (buyer reports key not working)
router.post('/orders/:id/dispute', userAuth, (req, res) => {
  const order = store.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: { message: '订单不存在' } });
  if (order.buyerId !== req.userId) return res.status(403).json({ error: { message: '只能申诉自己的订单' } });
  if (order.status !== 'frozen') return res.status(400).json({ error: { message: '订单状态异常' } });

  // Refund cooldown: max 1 refund per 7 days
  const recentRefunds = store.getOrdersByBuyer(req.userId)
    .filter(o => o.status === 'refunded' && o.createdAt > Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (recentRefunds.length >= 1) {
    return res.status(400).json({ error: { message: '7 天内已有退款记录，请联系客服' } });
  }

  // Check usage from request logs
  const buyerKeys = store.getMarketApiKeys().filter(k => k.userId === req.userId && k.listingId === order.listingId);
  let totalRequests = 0;
  let errorRequests = 0;
  for (const key of buyerKeys) {
    const logs = store.getRequestLogsByBuyerKey(key.key, 100);
    totalRequests += logs.length;
    errorRequests += logs.filter(l => l.statusCode >= 400).length;
  }

  const usedQuota = order.amount - (buyerKeys[0]?.remainingQuota || 0);
  const usagePercent = order.amount > 0 ? (usedQuota / order.amount) * 100 : 0;

  const { reason } = req.body;

  // Proportional refund rules
  if (usagePercent > 50) {
    return res.status(400).json({
      error: { message: `已使用 ${Math.round(usagePercent)}% 额度，超过 50% 不支持退款` },
      usage: { totalRequests, errorRequests, usagePercent: Math.round(usagePercent) },
    });
  }

  if (usagePercent > 20) {
    // Partial refund: refund remaining quota only
    const remainingRatio = (100 - usagePercent) / 100;
    const refundAmount = Math.floor(order.totalPrice * remainingRatio);
    store.refundCoins(order.buyerId, refundAmount, '部分退款: ' + (reason || '买家申诉') + ` (已用${Math.round(usagePercent)}%)`);
    store.updateOrder(order.id, { status: 'refunded', refundReason: reason || '买家申诉', refundAmount });
    return res.json({
      success: true, refundAmount, message: `已退还 ${refundAmount} 币（已用 ${Math.round(usagePercent)}%，退还未使用部分）`,
      order: store.getOrderById(order.id),
    });
  }

  // Full refund (usage < 20%)
  store.refundCoins(order.buyerId, order.totalPrice, '退款: ' + (reason || '买家申诉'));
  store.updateOrder(order.id, { status: 'refunded', refundReason: reason || '买家申诉' });
  res.json({ success: true, order: store.getOrderById(order.id) });
});

router.get('/orders', userAuth, (req, res) => {
  const role = req.query.role || 'buyer';
  const orders = role === 'seller'
    ? store.getOrdersBySeller(req.userId)
    : store.getOrdersByBuyer(req.userId);
  const enriched = orders.map(o => {
    const listing = store.getListingById(o.listingId);
    return { ...o, listingInfo: listing ? { description: listing.description, models: listing.models } : null };
  });
  res.json({ data: enriched });
});

router.get('/orders/:id', userAuth, (req, res) => {
  const order = store.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: { message: '订单不存在' } });
  if (order.buyerId !== req.userId && order.sellerId !== req.userId) return res.status(403).json({ error: { message: '无权查看' } });
  res.json(order);
});

// ==================== Reviews ====================

router.post('/reviews', userAuth, (req, res) => {
  const { orderId, rating, comment } = req.body;
  if (!orderId || !rating) return res.status(400).json({ error: { message: 'orderId 和 rating 必填' } });
  const order = store.getOrderById(orderId);
  if (!order) return res.status(404).json({ error: { message: '订单不存在' } });
  if (order.buyerId !== req.userId) return res.status(403).json({ error: { message: '只能评价自己的订单' } });
  if (order.status !== 'completed') return res.status(400).json({ error: { message: '只能评价已完成的订单' } });
  const existing = store.getReviews().find(r => r.orderId === orderId && r.buyerId === req.userId);
  if (existing) return res.status(409).json({ error: { message: '已经评价过了' } });

  const review = {
    id: genId('rev'), orderId, buyerId: req.userId, sellerId: order.sellerId,
    listingId: order.listingId, rating: Math.max(1, Math.min(5, parseInt(rating))),
    comment: comment || '', createdAt: Date.now(),
  };
  store.addReview(review);
  // Auto-reward: review order task
  store.addFreeCoins(req.userId, 5, '任务奖励: 评价订单');
  store.addTaskCompletion(req.userId, 'review_order', 5);

  const sellerReviews = store.getReviewsBySeller(order.sellerId);
  const avgRating = sellerReviews.reduce((sum, r) => sum + r.rating, 0) / sellerReviews.length;
  store.updateUser(order.sellerId, { rating: Math.round(avgRating * 10) / 10, ratingCount: sellerReviews.length });

  const listingReviews = store.getReviewsByListing(order.listingId);
  const listingAvg = listingReviews.reduce((sum, r) => sum + r.rating, 0) / listingReviews.length;
  store.updateListing(order.listingId, { rating: Math.round(listingAvg * 10) / 10, ratingCount: listingReviews.length });

  res.json({ success: true, review });
});

router.get('/reviews/seller/:sellerId', (req, res) => {
  res.json({ data: store.getReviewsBySeller(req.params.sellerId) });
});

// ==================== Wallet ====================

router.get('/wallet/balance', userAuth, (req, res) => {
  res.json({
    balance: req.user.balance,
    frozenBalance: req.user.frozenBalance || 0,
    availableBalance: req.user.balance,
    totalEarnings: req.user.totalEarnings || 0,
    totalSpending: req.user.totalSpending || 0,
  });
});

router.post('/wallet/topup', userAuth, adminAuth, (req, res) => {
  const { userId, username, amount, note } = req.body;
  let targetUser;
  if (userId) targetUser = store.getUserById(userId);
  else if (username) targetUser = store.getUserByUsername(username);
  else return res.status(400).json({ error: { message: '需要 userId 或 username' } });
  if (!targetUser) return res.status(404).json({ error: { message: '用户不存在' } });
  const topAmount = parseFloat(amount);
  if (!topAmount || topAmount <= 0) return res.status(400).json({ error: { message: '金额必须大于 0' } });
  const result = topUpBalance(targetUser.id, topAmount, note);
  res.json(result);
});

router.get('/wallet/transactions', userAuth, (req, res) => {
  res.json({ data: store.getTransactionsByUser(req.userId) });
});

// ==================== Buyer API Proxy ====================

router.get('/v1/models', userAuth, (req, res) => {
  const buyerKeys = store.getMarketApiKeys().filter(k => k.userId === req.userId && k.enabled);
  const models = [];
  for (const bk of buyerKeys) {
    const listing = store.getListingById(bk.listingId);
    if (listing && listing.status === 'active') {
      for (const model of (listing.models || [])) {
        models.push({
          id: model, object: 'model', created: listing.createdAt,
          owned_by: listing.sellerName, _listingId: listing.id, _remainingQuota: bk.remainingQuota,
        });
      }
    }
  }
  res.json({ object: 'list', data: models });
});

router.post('/v1/chat/completions', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: { message: 'Missing Authorization header' } });
  const token = authHeader.slice(7);
  const buyerKey = store.getMarketApiKey(token);
  if (!buyerKey) return res.status(403).json({ error: { message: 'Invalid API key' } });

  // Auto-disable key when quota exhausted
  if (buyerKey.remainingQuota <= 0) {
    store.updateMarketApiKey(buyerKey.key, { enabled: false });
    return res.status(402).json({ error: { message: '额度已用完，Key 已自动禁用' } });
  }

  const listing = store.getListingById(buyerKey.listingId);
  // Auto-disable key when listing is no longer available
  if (!listing || listing.status !== 'active') {
    store.updateMarketApiKey(buyerKey.key, { enabled: false });
    return res.status(502).json({ error: { message: '商品已下架，Key 已自动禁用' } });
  }

  const isStream = req.body.stream === true;
  const requestStart = Date.now();
  try {
    const apiKey = decryptKey(listing.apiKey);
    const resp = await axios({
      method: 'POST', url: `${listing.baseUrl}/chat/completions`,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      data: req.body, responseType: isStream ? 'stream' : 'json', timeout: 120000,
    });

    const latency = Date.now() - requestStart;
    const newQuota = buyerKey.remainingQuota - 1;
    const updates = { remainingQuota: newQuota };
    // Auto-disable when this was the last request
    if (newQuota <= 0) updates.enabled = false;
    store.updateMarketApiKey(buyerKey.key, updates);

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Stream with security scanning
      const chunks = [];
      resp.data.on('data', (chunk) => {
        const chunkStr = chunk.toString();
        const check = sanitizeStreamChunk(chunkStr);
        if (!check.safe) {
          logIncident(store, listing.id, buyerKey.userId, check.warnings[0], { model: req.body.model });
          // Send sanitized chunk instead
          res.write(check.chunk);
        } else {
          res.write(chunk);
        }
      });
      resp.data.on('end', () => {
        // Log request for dispute resolution
        store.addRequestLog({
          id: 'rl_' + crypto.randomUUID(), buyerKeyId: buyerKey.key, listingId: listing.id,
          sellerId: listing.sellerId, buyerId: buyerKey.userId,
          model: req.body.model || '', statusCode: 200, tokenCount: 0,
          latency, error: null, source: 'stream', timestamp: Date.now(), ip: req.ip,
        });
        res.end();
      });
      resp.data.on('error', () => res.end());
      req.on('close', () => resp.data.destroy());
    } else {
      // Non-streaming: validate and sanitize full response
      const sanitized = sanitizeResponse(resp.data);
      if (!sanitized.safe) {
        logIncident(store, listing.id, buyerKey.userId, sanitized.reason, {
          model: req.body.model, warnings: sanitized.warnings,
        });
      }
      const usage = resp.data?.usage;
      const tokens = usage ? (usage.prompt_tokens || 0) + (usage.completion_tokens || 0) : 0;
      const actualModel = resp.data?.model || req.body.model || '';

      // Log request for dispute resolution
      store.addRequestLog({
        id: 'rl_' + crypto.randomUUID(), buyerKeyId: buyerKey.key, listingId: listing.id,
        sellerId: listing.sellerId, buyerId: buyerKey.userId,
        model: actualModel, statusCode: resp.status, tokenCount: tokens,
        latency, error: null, source: listing.baseUrl, timestamp: Date.now(), ip: req.ip,
      });

      // Error responses don't deduct quota
      if (resp.status >= 400) {
        store.updateMarketApiKey(buyerKey.key, { remainingQuota: buyerKey.remainingQuota });
      } else if (listing.pricePerToken > 0 && tokens > 0) {
        const tokenCost = calculatePrice(listing, tokens);
        const buyer = store.getUserById(buyerKey.userId);
        if (buyer && buyer.balance >= tokenCost) {
          processPayment(buyerKey.userId, listing.sellerId, listing.id, tokenCost);
        }
      }
      res.json(sanitized.data);
    }
  } catch (err) {
    const latency = Date.now() - requestStart;
    const statusCode = err.response?.status || 502;
    // Log failed request
    store.addRequestLog({
      id: 'rl_' + crypto.randomUUID(), buyerKeyId: buyerKey.key, listingId: listing.id,
      sellerId: listing.sellerId, buyerId: buyerKey.userId,
      model: req.body.model || '', statusCode, tokenCount: 0,
      latency, error: err.message, source: listing.baseUrl, timestamp: Date.now(), ip: req.ip,
    });
    res.status(statusCode).json(err.response?.data || { error: { message: `Proxy error: ${err.message}` } });
  }
});

// ==================== Coin System ====================

// Get coin balance
router.get('/coin/balance', userAuth, (req, res) => {
  res.json({
    coins: req.user.coins || 0,
    freeCoins: req.user.freeCoins || 0,
    totalCoins: (req.user.coins || 0) + (req.user.freeCoins || 0),
    frozenCoins: req.user.frozenCoins || 0,
    feeCredits: req.user.feeCredits || 0,
    totalCoinEarnings: req.user.totalCoinEarnings || 0,
    totalCoinSpending: req.user.totalCoinSpending || 0,
  });
});

// Get coin transactions
router.get('/coin/transactions', userAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const txns = store.getCoinTransactions(req.userId).slice(-limit).reverse();
  res.json({ data: txns });
});

// Rate limiter for redemption (5 attempts per minute per user)
const redeemAttempts = {};

// Unified code redemption — auto-detects invite code vs redemption code
router.post('/redeem', userAuth, (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') return res.status(400).json({ error: { message: '请输入兑换码或邀请码' } });

  const trimmed = code.trim().toUpperCase();

  // Rate limit: max 5 attempts per minute
  const now = Date.now();
  const limiterKey = 'redeem_' + req.userId;
  if (!redeemAttempts[limiterKey]) redeemAttempts[limiterKey] = [];
  redeemAttempts[limiterKey] = redeemAttempts[limiterKey].filter(t => now - t < 60000);
  if (redeemAttempts[limiterKey].length >= 5) {
    return res.status(429).json({ error: { message: '兑换尝试过于频繁，请 1 分钟后再试' } });
  }
  redeemAttempts[limiterKey].push(now);

  // Auto-detect: U + 8 chars = invite code, INV- + 8 hex = old invite code, COIN- = redemption code
  if ((trimmed.startsWith('U') && trimmed.length === 9) || (trimmed.startsWith('INV-') && trimmed.length === 12)) {
    // Invite code (new U format or legacy INV- format)
    const result = store.useInviteCode(trimmed, req.userId);
    if (!result.success) return res.status(400).json({ error: { message: result.error } });
    store.addFreeCoins(result.inviterId, 50, '邀请奖励: 好友注册');
    store.addFreeCoins(req.userId, 30, '被邀请奖励: 使用邀请码');
    store.addTaskCompletion(result.inviterId, 'invite_friend', 50); // inviter gets task credit
    res.json({ success: true, type: 'invite', freeCoins: 30, message: '邀请码验证成功，获得 30 免费币' });
  } else if (trimmed.startsWith('COIN-')) {
    // Redemption code
    const result = store.useRedemptionCode(trimmed, req.userId);
    if (!result.success) return res.status(400).json({ error: { message: result.error } });
    res.json({ success: true, type: 'redeem', coins: result.coins, message: '兑换成功，获得 ' + result.coins + ' 付费币' });
  } else {
    return res.status(400).json({ error: { message: '无效的码，请检查格式' } });
  }
});

// Redeem a code (legacy endpoint, kept for backward compatibility)
router.post('/coin/redeem', userAuth, (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') return res.status(400).json({ error: { message: '请输入兑换码' } });

  // Rate limit: max 5 attempts per minute
  const now = Date.now();
  const key = 'redeem_' + req.userId;
  if (!redeemAttempts[key]) redeemAttempts[key] = [];
  redeemAttempts[key] = redeemAttempts[key].filter(t => now - t < 60000);
  if (redeemAttempts[key].length >= 5) {
    return res.status(429).json({ error: { message: '兑换尝试过于频繁，请 1 分钟后再试' } });
  }
  redeemAttempts[key].push(now);

  const result = store.useRedemptionCode(code.trim().toUpperCase(), req.userId);
  if (!result.success) return res.status(400).json({ error: { message: result.error } });
  res.json({ success: true, coins: result.coins, message: '兑换成功，获得 ' + result.coins + ' 金币' });
});

// Create purchase order
router.post('/coin/purchase', userAuth, (req, res) => {
  const { amount } = req.body;
  const result = createPaymentOrder(req.userId, amount);
  if (!result.success) return res.status(400).json({ error: { message: result.error } });
  res.json({
    success: true,
    order: result.order,
    message: '订单已创建，请完成支付',
  });
});

// Process simulated payment
router.post('/coin/pay', userAuth, (req, res) => {
  // Simulated payment disabled in production — use USDT deposit instead
  if (process.env.NODE_ENV === 'production') {
    return res.status(400).json({ error: { message: '模拟支付已关闭，请使用 USDT 充值' } });
  }
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: { message: '缺少订单 ID' } });
  const order = store.getPaymentOrder(orderId);
  if (!order) return res.status(404).json({ error: { message: '订单不存在' } });
  if (order.userId !== req.userId) return res.status(403).json({ error: { message: '无权操作此订单' } });
  const result = processSimulatedPayment(orderId);
  if (!result.success) return res.status(400).json({ error: { message: result.error } });
  res.json({ success: true, amount: result.amount, message: '充值成功，' + result.amount + ' 金币已到账' });
});

// Get purchase history
router.get('/coin/purchases', userAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const orders = getUserPayments(req.userId, limit);
  res.json({ data: orders });
});

// Request withdrawal
router.post('/coin/withdraw', userAuth, (req, res) => {
  const { coins, walletAddress } = req.body;
  if (!coins || coins < 1) return res.status(400).json({ error: { message: '提现金币数必须大于 0' } });
  if (!walletAddress) return res.status(400).json({ error: { message: '请填写 USDT-TRC20 收款地址' } });
  if (coins > (req.user.coins || 0)) return res.status(400).json({ error: { message: '金币余额不足' } });

  const pending = store.getWithdrawalsByUser(req.userId).filter(w => w.status === 'pending');
  if (pending.length >= 3) return res.status(400).json({ error: { message: '最多 3 笔待审核提现，请等待处理' } });

  // Calculate withdrawal fee
  const feeInfo = calculateWithdrawalFee(coins, req.user.feeCredits || 0);
  const actualDeduct = coins; // deduct full amount from user
  const usdtPayout = feeInfo.payout / 10; // convert to USDT

  store.deductCoins(req.userId, actualDeduct, `申请提现 ${coins} 币 (手续费${feeInfo.fee}币, 到手${feeInfo.payout}币=${usdtPayout}USDT)`);

  const withdrawal = {
    id: 'wd_' + crypto.randomUUID(),
    userId: req.userId,
    username: req.user.username,
    coins,
    fee: feeInfo.fee,
    payout: feeInfo.payout,
    usdtAmount: usdtPayout,
    walletAddress,
    status: 'pending',
    createdAt: Date.now(),
    processedAt: null,
    note: '',
  };
  store.addWithdrawal(withdrawal);
  res.json({
    success: true,
    message: `提现申请已提交。扣除 ${coins} 币（手续费 ${feeInfo.fee} 币），到手 ${feeInfo.payout} 币 = ${usdtPayout} USDT`,
    fee: feeInfo,
    withdrawal,
  });
});

// Get my withdrawals
router.get('/coin/withdrawals', userAuth, (req, res) => {
  const withdrawals = store.getWithdrawalsByUser(req.userId);
  res.json({ data: withdrawals });
});

// ==================== USDT Deposit ====================

const { createDepositOrder, checkDepositOrder, COINS_PER_USDT, MIN_DEPOSIT, WALLET_ADDRESS } = require('../services/usdtPayment');

// Create deposit order
router.post('/deposit', userAuth, (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < MIN_DEPOSIT) {
    return res.status(400).json({ error: { message: `最低充值 ${MIN_DEPOSIT} USDT` } });
  }
  const result = createDepositOrder(req.userId, parseFloat(amount));
  if (!result.success) return res.status(400).json({ error: { message: result.error } });
  res.json({
    success: true,
    order: result.order,
    address: WALLET_ADDRESS,
    message: `请转 ${result.order.usdtAmount} USDT 到指定地址`,
  });
});

// Check deposit order status
router.get('/deposit/:orderId', userAuth, (req, res) => {
  const result = checkDepositOrder(req.params.orderId);
  if (!result.success) return res.status(400).json({ error: { message: result.error } });
  if (result.order.userId !== req.userId) return res.status(403).json({ error: { message: '无权查看' } });
  res.json(result.order);
});

// Get user's deposit history
router.get('/deposits', userAuth, (req, res) => {
  const orders = store.getUserDepositOrders(req.userId);
  res.json({ data: orders.slice(-50).reverse() });
});

// Withdrawal fee tiers
function calculateWithdrawalFee(coins, feeCredits) {
  let rate;
  if (coins <= 20) rate = 0;        // ≤20 coins: free
  else if (coins <= 100) rate = 0.05; // 21-100: 5%
  else if (coins <= 500) rate = 0.03; // 101-500: 3%
  else rate = 0.02;                   // >500: 2%

  let fee = Math.ceil(coins * rate);
  // Fee credits can reduce up to 50% of fee
  const maxDiscount = Math.floor(fee * 0.5);
  const discount = Math.min(feeCredits || 0, maxDiscount);
  fee = fee - discount;

  // Iron rule: fee >= 0, payout > 0
  if (fee < 0) fee = 0;
  if (coins - fee <= 0 && coins > 0) fee = coins - 1; // leave at least 1 coin

  return { fee, rate, discount, payout: coins - fee };
}

// Validate TRON address format
function validateTronAddress(address) {
  if (!address || typeof address !== 'string') {
    return { valid: false, message: '地址不能为空' };
  }
  const trimmed = address.trim();

  // Check: must start with T
  if (!trimmed.startsWith('T')) {
    return { valid: false, message: 'TRON 地址必须以 T 开头，您可能选错了网络' };
  }

  // Check: must be 34 characters
  if (trimmed.length !== 34) {
    return { valid: false, message: `TRON 地址应为 34 个字符，您输入了 ${trimmed.length} 个` };
  }

  // Check: only Base58 characters (no 0, O, I, l)
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed)) {
    return { valid: false, message: '地址包含无效字符，请检查是否复制完整' };
  }

  return { valid: true, message: '地址格式正确' };
}

// Address validation endpoint (format + on-chain check)
router.post('/validate-address', userAuth, async (req, res) => {
  const { address } = req.body;

  // Layer 1: Format check
  const formatCheck = validateTronAddress(address);
  if (!formatCheck.valid) {
    return res.json({ ...formatCheck, onChain: null });
  }

  // Layer 2: On-chain check
  try {
    const axios = require('axios');
    const resp = await axios.get(`https://api.trongrid.io/v1/accounts/${address.trim()}`, { timeout: 10000 });
    const account = resp.data?.data?.[0];

    if (!account) {
      return res.json({
        valid: true,
        message: '地址格式正确，但链上无记录（可能是新地址）',
        warning: '新地址首次收款需要少量 TRX 作为手续费',
        onChain: { exists: false, balance: 0, txCount: 0 },
      });
    }

    const trxBalance = account.balance || 0;
    const txCount = account.total_transaction_count || 0;
    const trc20Tokens = Object.keys(account.assetV2 || {}).length;

    let warning = null;
    if (trxBalance < 1000000) { // < 1 TRX (in sun)
      warning = '该地址 TRX 余额较低，首次收款可能需要少量 TRX 作为手续费';
    }

    return res.json({
      valid: true,
      message: '地址验证通过',
      warning,
      onChain: {
        exists: true,
        trxBalance: (trxBalance / 1e6).toFixed(2),
        txCount,
        trc20Tokens,
      },
    });
  } catch (err) {
    // API error - still pass format check
    return res.json({
      valid: true,
      message: '地址格式正确（链上验证暂时不可用）',
      warning: '无法连接区块链网络，请自行确认地址正确',
      onChain: null,
    });
  }
});

// USDT withdrawal (admin processes manually)
router.post('/withdraw-usdt', userAuth, (req, res) => {
  const { coins, walletAddress } = req.body;
  if (!coins || coins < 1) return res.status(400).json({ error: { message: '提现金币数必须大于 0' } });
  if (!walletAddress) return res.status(400).json({ error: { message: '请填写 USDT-TRC20 收款地址' } });

  const addrCheck = validateTronAddress(walletAddress);
  if (!addrCheck.valid) {
    return res.status(400).json({ error: { message: addrCheck.message } });
  }

  const user = store.getUserById(req.userId);
  if ((user.coins || 0) < coins) return res.status(400).json({ error: { message: '付费币余额不足' } });

  const feeInfo = calculateWithdrawalFee(coins, user.feeCredits || 0);
  const usdtPayout = feeInfo.payout / COINS_PER_USDT;
  if (usdtPayout > 50) return res.status(400).json({ error: { message: '单次最多提现 50 USDT' } });

  store.deductCoins(req.userId, coins, `申请提现 ${coins} 币 (手续费${feeInfo.fee}币, 到手${usdtPayout}USDT)`);
  store.updateUser(req.userId, { usdtAddress: walletAddress });

  const withdrawal = {
    id: 'wd_' + crypto.randomUUID(),
    userId: req.userId,
    username: user.username,
    coins,
    fee: feeInfo.fee,
    payout: feeInfo.payout,
    usdtAmount: usdtPayout,
    walletAddress,
    status: 'pending',
    createdAt: Date.now(),
    processedAt: null,
    txHash: null,
    note: '',
  };
  store.addWithdrawal(withdrawal);

  res.json({
    success: true,
    message: `提现申请已提交。扣除 ${coins} 币（手续费 ${feeInfo.fee} 币），到手 ${usdtPayout} USDT`,
    fee: feeInfo,
    addressCheck: addrCheck,
    withdrawal,
  });
});

// ==================== Admin: Coin Management ====================

// Generate redemption codes
router.post('/admin/codes', adminAuth, (req, res) => {
  const { coins, count } = req.body;
  if (!coins || coins < 1) return res.status(400).json({ error: { message: '金币数必须大于 0' } });
  const num = Math.min(count || 1, 100);
  const codes = [];
  for (let i = 0; i < num; i++) {
    const code = {
      code: 'COIN-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
      coins: parseInt(coins),
      usedBy: null,
      usedAt: null,
      createdAt: Date.now(),
      createdBy: 'admin',
    };
    store.addRedemptionCode(code);
    codes.push(code);
  }
  res.json({ success: true, codes, message: `生成了 ${num} 个兑换码，每个 ${coins} 金币` });
});

// List all codes
router.get('/admin/codes', adminAuth, (req, res) => {
  const codes = store.getRedemptionCodes();
  const unused = codes.filter(c => !c.usedBy).length;
  res.json({ data: codes, total: codes.length, unused });
});

// List withdrawals
router.get('/admin/withdrawals', adminAuth, (req, res) => {
  const withdrawals = store.getWithdrawals();
  const pending = withdrawals.filter(w => w.status === 'pending').length;
  res.json({ data: withdrawals, total: withdrawals.length, pending });
});

// Approve/reject withdrawal
router.put('/admin/withdrawals/:id', adminAuth, (req, res) => {
  const { status, note } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: { message: '状态必须是 approved 或 rejected' } });
  }
  const withdrawal = store.getWithdrawals().find(w => w.id === req.params.id);
  if (!withdrawal) return res.status(404).json({ error: { message: '提现申请不存在' } });
  if (withdrawal.status !== 'pending') return res.status(400).json({ error: { message: '该申请已处理' } });

  store.updateWithdrawal(req.params.id, { status, processedAt: Date.now(), note: note || '' });

  if (status === 'rejected') {
    // Refund coins back to user
    store.addCoins(withdrawal.userId, withdrawal.coins, '提现被拒绝，金币退回');
  }

  res.json({ success: true, message: status === 'approved' ? '已批准提现' : '已拒绝，金币已退回' });
});

// Direct coin top-up (admin only)
router.post('/admin/topup-coins', adminAuth, (req, res) => {
  const { userId, coins, note } = req.body;
  if (!userId || !coins) return res.status(400).json({ error: { message: 'userId 和 coins 必填' } });
  const user = store.getUserById(userId);
  if (!user) return res.status(404).json({ error: { message: '用户不存在' } });
  store.addCoins(userId, parseInt(coins), note || '管理员充值');
  res.json({ success: true, message: `已为 ${user.username} 充值 ${coins} 金币` });
});

module.exports = router;
