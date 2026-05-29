const jwt = require('jsonwebtoken');
const config = require('../config');
const crypto = require('crypto');

// Admin JWT secret: use env var or derive from admin password
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET
  || crypto.createHash('sha256').update(config.adminPassword + 'admin-jwt-salt').digest('hex');

module.exports = function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { message: 'Admin authentication required', type: 'auth_error' },
    });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error('not admin');
    next();
  } catch {
    return res.status(403).json({
      error: { message: 'Invalid or expired admin token', type: 'auth_error' },
    });
  }
};

module.exports.ADMIN_JWT_SECRET = ADMIN_JWT_SECRET;
