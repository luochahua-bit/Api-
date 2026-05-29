const crypto = require('crypto');
const axios = require('axios');
const store = require('../store');

// Tiered platform service fee
function calculatePlatformFee(amount) {
  let rate;
  if (amount >= 10000) rate = 0.10;       // 10% for >= 10000
  else if (amount >= 1500) rate = 0.05;    // 5% for >= 1500
  else rate = 0.01;                        // 1% default
  return { fee: Math.ceil(amount * rate), rate };
}

// Calculate fee after applying user's fee credits
function calculateFeeWithCredits(amount, feeCredits) {
  const { fee: rawFee, rate } = calculatePlatformFee(amount);
  const discount = Math.min(feeCredits || 0, rawFee);
  return { rawFee, discount, finalFee: rawFee - discount, rate };
}

function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

// Encrypt API key for storage
const ENCRYPTION_KEY = process.env.MARKET_ENCRYPT_KEY;
if (!ENCRYPTION_KEY) {
  console.error('[FATAL] MARKET_ENCRYPT_KEY environment variable is not set. Exiting.');
  process.exit(1);
}
const ALGORITHM = 'aes-256-cbc';

function encryptKey(text) {
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptKey(encrypted) {
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const parts = encrypted.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(parts[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Test if a provider API key is working
async function testProviderKey(baseUrl, apiKey) {
  try {
    const resp = await axios.get(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      timeout: 15000,
    });
    const models = resp.data?.data || [];
    return { healthy: true, latency: resp.headers['x-response-time'] || 0, modelCount: models.length, models };
  } catch (err) {
    const status = err.response?.status;
    let reason = err.message;
    if (status === 401) reason = 'API Key 无效或已过期';
    else if (status === 403) reason = 'API Key 权限不足';
    else if (status === 429) reason = 'API Key 已达速率限制';
    else if (err.code === 'ECONNREFUSED') reason = '无法连接到服务器';
    else if (err.code === 'ETIMEDOUT') reason = '连接超时';
    return { healthy: false, error: reason, status };
  }
}

// ========== Model Verification (模型验证系统) ==========

// Verify that the seller's listed models actually exist on the upstream API
async function verifyModelsExist(baseUrl, apiKey, claimedModels) {
  const result = await testProviderKey(baseUrl, apiKey);
  if (!result.healthy) {
    return { valid: false, error: `API 不可用: ${result.error}`, details: {} };
  }

  const actualModels = (result.models || []).map(m => m.id || m.name);
  const verified = [];
  const missing = [];
  const unclaimed = [];

  for (const model of claimedModels) {
    if (actualModels.some(am => am === model || am.includes(model) || model.includes(am))) {
      verified.push(model);
    } else {
      missing.push(model);
    }
  }

  // Models that exist but weren't claimed (informational)
  for (const am of actualModels) {
    if (!claimedModels.some(cm => cm === am || am.includes(cm) || cm.includes(am))) {
      unclaimed.push(am);
    }
  }

  return {
    valid: missing.length === 0,
    verified, missing, unclaimed: unclaimed.slice(0, 20),
    totalActual: actualModels.length,
    details: { verified: verified.length, missing: missing.length, total: claimedModels.length },
  };
}

// Verify model identity by making a test request and checking the response
async function verifyModelIdentity(baseUrl, apiKey, claimedModel) {
  try {
    const resp = await axios.post(`${baseUrl}/chat/completions`, {
      model: claimedModel,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5,
    }, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      timeout: 30000,
    });

    const responseModel = resp.data?.model || '';
    const matched = responseModel === claimedModel ||
                    responseModel.includes(claimedModel) ||
                    claimedModel.includes(responseModel);

    return {
      verified: matched,
      claimedModel,
      actualModel: responseModel,
      latency: resp.headers['x-response-time'] || 0,
      error: matched ? null : `声称 ${claimedModel}，实际返回 ${responseModel}`,
    };
  } catch (err) {
    return {
      verified: false, claimedModel, actualModel: null,
      error: `测试请求失败: ${err.message}`,
    };
  }
}

// Calculate price with model rate multiplier
function calculateModelPrice(listing, model, tokens = 0) {
  const basePrice = listing.pricePerRequest || 0;
  const tokenPrice = (listing.pricePerToken || 0) * (tokens || 0);
  const rate = (listing.modelRates && listing.modelRates[model]) || 1;
  return (basePrice + tokenPrice) * rate;
}

// Process a marketplace API request (buyer proxy)
async function processMarketRequest(listing, targetPath, requestBody, isStream) {
  const apiKey = decryptKey(listing.apiKey);
  const url = `${listing.baseUrl}${targetPath}`;
  const resp = await axios({
    method: 'POST', url,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    data: requestBody,
    responseType: isStream ? 'stream' : 'json',
    timeout: 120000,
  });
  return resp;
}

// Calculate price for a request (legacy, without model rate)
function calculatePrice(listing, tokens = 0) {
  if (listing.pricePerToken > 0 && tokens > 0) return listing.pricePerToken * tokens;
  return listing.pricePerRequest || 0;
}

// ========== Escrow System (担保交易) ==========

// Step 1: Freeze buyer's funds when order is created
function freezeFunds(buyerId, amount, orderDescription) {
  const buyer = store.getUserById(buyerId);
  if (!buyer) return { success: false, error: '用户不存在' };
  if (buyer.balance < amount) return { success: false, error: `余额不足，需要 ${amount}，当前 ${buyer.balance}` };

  store.updateUser(buyerId, {
    balance: buyer.balance - amount,
    frozenBalance: (buyer.frozenBalance || 0) + amount,
  });

  store.addTransaction({
    id: genId('txn'), userId: buyerId,
    type: 'freeze', amount: -amount,
    description: `冻结资金: ${orderDescription}`,
    createdAt: Date.now(),
  });

  return { success: true };
}

// Step 2a: Release funds to seller (key verified, transaction complete)
function releaseFunds(orderId) {
  const order = store.getOrderById(orderId);
  if (!order) return { success: false, error: '订单不存在' };
  if (order.status !== 'frozen') return { success: false, error: '订单状态异常' };

  const buyer = store.getUserById(order.buyerId);
  const seller = store.getUserById(order.sellerId);
  if (!buyer || !seller) return { success: false, error: '用户不存在' };

  const amount = order.totalPrice;
  const { fee: platformFee } = calculatePlatformFee(amount);
  const sellerEarning = amount - platformFee;

  // Move from frozen to seller
  store.updateUser(order.buyerId, {
    frozenBalance: (buyer.frozenBalance || 0) - amount,
    totalSpending: (buyer.totalSpending || 0) + amount,
  });

  store.updateUser(order.sellerId, {
    balance: seller.balance + sellerEarning,
    totalEarnings: (seller.totalEarnings || 0) + sellerEarning,
  });

  // Record transactions
  store.addTransaction({
    id: genId('txn'), userId: order.buyerId,
    type: 'purchase', amount: -amount,
    description: `购买完成: ${order.description || 'API Key'}`,
    createdAt: Date.now(),
  });

  store.addTransaction({
    id: genId('txn'), userId: order.sellerId,
    type: 'earning', amount: sellerEarning,
    description: `出售收入: ${order.description || 'API Key'} (平台服务费 ${platformFee} 金币)`,
    createdAt: Date.now(),
  });

  // Decrease listing quota
  const listing = store.getListingById(order.listingId);
  if (listing) {
    store.updateListing(listing.id, {
      remainingQuota: listing.remainingQuota - order.amount,
      soldCount: (listing.soldCount || 0) + order.amount,
    });
  }

  store.updateOrder(orderId, { status: 'completed' });
  return { success: true, sellerEarning, platformFee };
}

// Step 2b: Refund to buyer (key failed verification)
function refundFunds(orderId, reason) {
  const order = store.getOrderById(orderId);
  if (!order) return { success: false, error: '订单不存在' };
  if (order.status !== 'frozen') return { success: false, error: '订单状态异常' };

  const buyer = store.getUserById(order.buyerId);
  if (!buyer) return { success: false, error: '用户不存在' };

  const amount = order.totalPrice;

  // Return frozen funds to buyer balance
  store.updateUser(order.buyerId, {
    frozenBalance: (buyer.frozenBalance || 0) - amount,
    balance: buyer.balance + amount,
  });

  store.addTransaction({
    id: genId('txn'), userId: order.buyerId,
    type: 'refund', amount: amount,
    description: `退款: ${reason || 'Key 验证失败'}`,
    createdAt: Date.now(),
  });

  store.updateOrder(orderId, { status: 'refunded', refundReason: reason });
  return { success: true };
}

// Top up user balance (admin only)
function topUpBalance(userId, amount, adminNote) {
  const user = store.getUserById(userId);
  if (!user) return { success: false, error: 'User not found' };

  store.updateUser(userId, { balance: user.balance + amount });
  store.addTransaction({
    id: genId('txn'), userId,
    type: 'topup', amount,
    description: adminNote || '管理员充值',
    createdAt: Date.now(),
  });

  return { success: true, newBalance: user.balance + amount };
}

// ========== Source Level Detection ==========

const KNOWN_DIRECT_HOSTS = [
  'api.openai.com', 'api.anthropic.com', 'api.deepseek.com',
  'api.groq.com', 'api.cerebras.ai', 'api.sambanova.ai',
  'generativelanguage.googleapis.com', 'api.mistral.ai',
  'integrate.api.nvidia.com', 'api.cohere.com',
];

const KNOWN_RELAY_HOSTS = [
  'openrouter.ai', 'models.inference.ai.azure.com',
];

function detectSourceLevel(baseUrl, latency, responseHeaders) {
  if (!baseUrl) return { level: 'C', label: '未声明' };

  const host = new URL(baseUrl).hostname.toLowerCase();

  // Check if response has proxy headers
  const proxyHeaders = ['x-proxy', 'x-relay', 'x-forwarded-by', 'x-powered-by'];
  const hasProxyHeaders = responseHeaders && proxyHeaders.some(h => responseHeaders[h]);

  if (KNOWN_DIRECT_HOSTS.some(h => host.includes(h))) {
    return { level: 'S', label: '官方直连' };
  }

  if (KNOWN_RELAY_HOSTS.some(h => host.includes(h))) {
    return { level: 'A', label: '知名中转' };
  }

  if (hasProxyHeaders) {
    return { level: 'B', label: '第三方中转', warning: '检测到代理特征' };
  }

  if (latency > 2000) {
    return { level: 'B', label: '疑似中转', warning: '延迟较高' };
  }

  return { level: 'B', label: '其他来源' };
}

// Direct payment (for per-token billing after request completes) — uses coin system
function processPayment(buyerId, sellerId, listingId, amount) {
  if (amount <= 0) return { success: false, error: '金额无效' };

  const buyer = store.getUserById(buyerId);
  const seller = store.getUserById(sellerId);
  if (!buyer || !seller) return { success: false, error: '用户不存在' };
  if ((buyer.coins || 0) < amount) return { success: false, error: '金币不足' };

  const { fee: platformFee } = calculatePlatformFee(amount);
  const sellerEarning = amount - platformFee;

  store.updateUser(buyerId, {
    coins: (buyer.coins || 0) - amount,
    totalCoinSpending: (buyer.totalCoinSpending || 0) + amount,
  });

  store.updateUser(sellerId, {
    coins: (seller.coins || 0) + sellerEarning,
    totalCoinEarnings: (seller.totalCoinEarnings || 0) + sellerEarning,
  });

  store.addCoinTransaction(buyerId, 'usage', -amount, 'Token 用量扣费');
  store.addCoinTransaction(sellerId, 'earning', sellerEarning, 'Token 用量收入 (平台服务费 ' + platformFee + ' 金币)');

  return { success: true };
}

module.exports = {
  genId, encryptKey, decryptKey,
  testProviderKey, verifyModelsExist, verifyModelIdentity,
  detectSourceLevel,
  processMarketRequest, calculatePrice, calculateModelPrice,
  freezeFunds, releaseFunds, refundFunds,
  topUpBalance, processPayment,
  calculatePlatformFee, calculateFeeWithCredits,
  PLATFORM_FEE_RATE: 0.01,
};
