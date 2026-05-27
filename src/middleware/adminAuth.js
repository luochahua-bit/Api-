const config = require('../config');
const crypto = require('crypto');

const HASHED_TOKEN = 'adm_' + crypto.createHash('sha256').update(config.adminPassword + 'admin-salt').digest('hex').slice(0, 32);

module.exports = function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { message: 'Admin authentication required', type: 'auth_error' },
    });
  }

  const token = authHeader.slice(7);
  // Accept only the hashed token (not the raw password)
  if (token !== HASHED_TOKEN) {
    return res.status(403).json({
      error: { message: 'Invalid admin token', type: 'auth_error' },
    });
  }

  next();
};
