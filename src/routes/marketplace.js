const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const store = require('../store');
const userAuth = require('../middleware/userAuth');
const { JWT_SECRET } = require('../middleware/userAuth');
const {
  genId, encryptKey, decryptKey, testProviderKey, verifyModelsExist, verifyModelIdentity,
  processMarketRequest, calculatePrice, calculateModelPrice,
  freezeFunds, releaseFunds, refundFunds,
  topUpBalance, processPayment,
} = require('../services/marketplace');

const router = Router();

// ==================== Auth ====================

router.post('/auth/register', async (req, res) => {
  const { username, password, email, role } = req.body;
  if (!username || !password || !email) return res.status(400).json({ error: { message: '用户名、密码、邮箱必填' } });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: { message: '用户名 3-20 个字符' } });
  if (password.length < 6) return res.status(400).json({ error: { message: '密码至少 6 位' } });
  if (store.getUserByUsername(username)) return res.status(409).json({ error: { message: '用户名已存在' } });
  if (store.getUserByEmail(email)) return res.status(409).json({ error: { message: '邮箱已注册' } });

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: genId('usr'), username, password: hashedPassword, email,
    role: 'buyer',
    balance: 0, frozenBalance: 0, totalEarnings: 0, totalSpending: 0,
    rating: 5.0, ratingCount: 0, createdAt: Date.now(), enabled: true,
  };
  store.addUser(user);
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  const { password: _, ...safeUser } = user;
  res.json({ success: true, token, user: safeUser });
});

router.post('/auth/login', async (req, res) => {
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
  const { email, password } = req.body;
  const changes = {};
  if (email) changes.email = email;
  if (password) changes.password = await bcrypt.hash(password, 10);
  store.updateUser(req.userId, changes);
  const user = store.getUserById(req.userId);
  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
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

  // Step 1: Test API key is working
  const testResult = await testProviderKey(baseUrl, apiKey);
  if (!testResult.healthy) return res.status(400).json({ error: { message: `API Key 测试失败: ${testResult.error}` } });

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

  // Step 1: Freeze buyer's funds
  if (totalPrice > 0) {
    const freezeResult = freezeFunds(req.userId, totalPrice, listing.description);
    if (!freezeResult.success) return res.status(400).json({ error: { message: freezeResult.error } });
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
    // Key works - release funds immediately
    if (totalPrice > 0) {
      releaseFunds(order.id);
    } else {
      store.updateListing(listing.id, {
        remainingQuota: listing.remainingQuota - purchaseAmount,
        soldCount: (listing.soldCount || 0) + purchaseAmount,
      });
      store.updateOrder(order.id, { status: 'completed' });
    }

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
    // Key failed - refund to buyer
    if (totalPrice > 0) refundFunds(order.id, `Key 验证失败: ${verifyResult.error}`);
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

  const result = releaseFunds(order.id);
  if (!result.success) return res.status(400).json({ error: { message: result.error } });
  res.json({ success: true, order: store.getOrderById(order.id) });
});

// Dispute order (buyer reports key not working)
router.post('/orders/:id/dispute', userAuth, (req, res) => {
  const order = store.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: { message: '订单不存在' } });
  if (order.buyerId !== req.userId) return res.status(403).json({ error: { message: '只能申诉自己的订单' } });
  if (order.status !== 'frozen') return res.status(400).json({ error: { message: '订单状态异常' } });

  const { reason } = req.body;
  const result = refundFunds(order.id, reason || '买家申诉');
  if (!result.success) return res.status(400).json({ error: { message: result.error } });
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

router.post('/wallet/topup', (req, res) => {
  const { adminPassword, userId, username, amount, note } = req.body;
  const config = require('../config');
  if (adminPassword !== config.adminPassword) return res.status(403).json({ error: { message: '管理密码错误' } });
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
  try {
    const apiKey = decryptKey(listing.apiKey);
    const resp = await axios({
      method: 'POST', url: `${listing.baseUrl}/chat/completions`,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      data: req.body, responseType: isStream ? 'stream' : 'json', timeout: 120000,
    });

    const newQuota = buyerKey.remainingQuota - 1;
    const updates = { remainingQuota: newQuota };
    // Auto-disable when this was the last request
    if (newQuota <= 0) updates.enabled = false;
    store.updateMarketApiKey(buyerKey.key, updates);

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      resp.data.pipe(res);
    } else {
      const usage = resp.data?.usage;
      const tokens = usage ? (usage.prompt_tokens || 0) + (usage.completion_tokens || 0) : 0;
      if (listing.pricePerToken > 0 && tokens > 0) {
        const tokenCost = calculatePrice(listing, tokens);
        const buyer = store.getUserById(buyerKey.userId);
        if (buyer && buyer.balance >= tokenCost) {
          processPayment(buyerKey.userId, listing.sellerId, listing.id, tokenCost);
        }
      }
      res.json(resp.data);
    }
  } catch (err) {
    res.status(err.response?.status || 502).json(err.response?.data || { error: { message: `Proxy error: ${err.message}` } });
  }
});

module.exports = router;
