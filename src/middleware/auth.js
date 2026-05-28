const store = require('../store');
const { isFreeKey, checkFreeCoinBalance } = require('../utils/freeKeyManager');

module.exports = function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { message: 'Missing or invalid Authorization header', type: 'auth_error' },
    });
  }

  const token = authHeader.slice(7);
  const apiKey = store.getApiKey(token);

  if (!apiKey || !apiKey.enabled) {
    return res.status(403).json({
      error: { message: 'Invalid API key', type: 'auth_error' },
    });
  }

  // Free key: check coin balance (1 coin minimum to make a request)
  if (isFreeKey(token)) {
    const user = apiKey.userId ? store.getUserById(apiKey.userId) : null;
    const balance = checkFreeCoinBalance(user);
    if (!balance.allowed) {
      return res.status(402).json({
        error: {
          message: balance.message,
          type: 'insufficient_coins',
          free_coins: 0,
        },
      });
    }
    req.keyTier = 'free';
    req.freeCoinBalance = balance.balance;
    req.freeKeyUserId = apiKey.userId;
  } else {
    req.keyTier = apiKey.tier || 'platform';
    store.incrementKeyUsage(token);
  }

  req.apiKey = token;
  req.apiKeyInfo = apiKey;
  next();
};
