const store = require('../store');

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

  req.apiKey = token;
  req.apiKeyInfo = apiKey;
  store.incrementKeyUsage(token);
  next();
};
