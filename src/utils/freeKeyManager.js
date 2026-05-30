/**
 * Free Key Manager
 * Manages free-tier API keys with coin-based metering
 * 1 free coin = 10,000 tokens, minimum 1 coin per request
 */

const crypto = require('crypto');
const store = require('../store');
const { MODELS } = require('../data/models');

const FREE_PREFIX = 'sk-free-';
const TOKENS_PER_COIN = 10000; // 1 free coin = 10,000 tokens
const MIN_COINS_PER_REQUEST = 1; // minimum deduction per request
const FREE_DAILY_LIMIT = 50; // free key daily request limit

// Free model IDs — derived from shared model catalog
const FREE_MODEL_IDS = MODELS.filter(m => m.free).map(m => m.id);

/**
 * Generate a free-tier API key for a user
 */
function generateFreeKey(userId, username) {
  const key = FREE_PREFIX + crypto.randomBytes(20).toString('hex');
  store.addApiKey({
    key,
    name: `${username} (free)`,
    tier: 'free',
    userId,
    createdAt: Date.now(),
    enabled: true,
    usageCount: 0,
  });
  return { key };
}

/**
 * Check if a key is a free-tier key
 */
function isFreeKey(key) {
  return typeof key === 'string' && key.startsWith(FREE_PREFIX);
}

/**
 * Check if user has enough free coins for a request
 * @param {Object} user - user object from store
 * @returns {{ allowed: boolean, balance: number, message?: string }}
 */
function checkFreeCoinBalance(user) {
  if (!user) return { allowed: false, balance: 0, message: '用户不存在' };
  const balance = user.freeCoins || 0;
  if (balance < MIN_COINS_PER_REQUEST) {
    return {
      allowed: false,
      balance,
      message: `免费币不足（剩余 ${balance}），请做任务赚取更多或充值`,
    };
  }
  return { allowed: true, balance };
}

/**
 * Calculate coins to deduct based on token usage
 * @param {number} totalTokens - prompt + completion tokens
 * @returns {number} coins to deduct (minimum MIN_COINS_PER_REQUEST)
 */
function calculateCoinCost(totalTokens) {
  if (!totalTokens || totalTokens <= 0) return MIN_COINS_PER_REQUEST;
  return Math.max(MIN_COINS_PER_REQUEST, Math.ceil(totalTokens / TOKENS_PER_COIN));
}

/**
 * Deduct free coins from user after API usage
 * @param {string} userId
 * @param {number} totalTokens - actual token usage from response
 * @returns {{ success: boolean, deducted: number, remaining: number }}
 */
function deductFreeCoins(userId, totalTokens) {
  const user = store.getUserById(userId);
  if (!user) return { success: false, deducted: 0, remaining: 0 };

  const cost = calculateCoinCost(totalTokens);
  const balance = user.freeCoins || 0;
  const actualDeduct = Math.min(cost, balance); // can't deduct more than balance

  if (actualDeduct <= 0) return { success: false, deducted: 0, remaining: 0 };

  // Use store.spendCoins for concurrency-safe deduction with locking
  const result = store.spendFreeCoins(userId, actualDeduct,
    `API 调用 (${totalTokens || 0} token, ${actualDeduct} 币)`);
  if (!result) return { success: false, deducted: 0, remaining: balance };

  return { success: true, deducted: actualDeduct, remaining: balance - actualDeduct };
}

/**
 * Check if a model is available for free keys
 */
function isFreeModel(modelId) {
  return FREE_MODEL_IDS.includes(modelId);
}

/**
 * Get free models list for API response
 */
function getFreeModelsForResponse() {
  return MODELS.filter(m => m.free).map(m => ({
    id: m.id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: m.provider,
  }));
}

module.exports = {
  generateFreeKey, isFreeKey,
  checkFreeCoinBalance, calculateCoinCost, deductFreeCoins,
  isFreeModel, getFreeModelsForResponse,
  TOKENS_PER_COIN, MIN_COINS_PER_REQUEST, FREE_DAILY_LIMIT,
};
