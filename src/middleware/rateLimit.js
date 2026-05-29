const config = require('../config');

const clients = new Map();
const ANON_LIMIT = 10; // Requests per minute for unauthenticated users

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of clients) {
    if (now - data.windowStart > config.rateLimit.windowMs) {
      clients.delete(key);
    }
  }
}, config.rateLimit.windowMs);

module.exports = function rateLimit(req, res, next) {
  const hasKey = !!req.apiKey;
  const clientKey = req.apiKey || `ip:${req.ip}`;
  const now = Date.now();
  let client = clients.get(clientKey);

  if (!client || now - client.windowStart > config.rateLimit.windowMs) {
    client = { windowStart: now, count: 0 };
    clients.set(clientKey, client);
  }

  client.count++;

  const maxRequests = hasKey ? config.rateLimit.maxRequests : ANON_LIMIT;
  res.set('X-RateLimit-Limit', String(maxRequests));
  res.set('X-RateLimit-Remaining', String(Math.max(0, maxRequests - client.count)));

  if (client.count > maxRequests) {
    return res.status(429).json({
      error: { message: 'Rate limit exceeded', type: 'rate_limit_error' },
    });
  }

  next();
};
