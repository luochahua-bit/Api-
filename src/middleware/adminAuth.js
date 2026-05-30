const jwt = require('jsonwebtoken');
const config = require('../config');
const crypto = require('crypto');

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET
  || crypto.createHash('sha256').update(config.adminPassword + 'admin-jwt-salt').digest('hex');

// Main auth middleware — accepts both admin and support roles
module.exports = function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Admin authentication required', type: 'auth_error' } });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    if (decoded.role !== 'admin' && decoded.role !== 'support') throw new Error('not admin');
    req.adminRole = decoded.role; // 'admin' or 'support'
    req.adminUsername = decoded.username;
    next();
  } catch {
    return res.status(403).json({ error: { message: 'Invalid or expired admin token', type: 'auth_error' } });
  }
};

// Middleware that requires full admin role (not support)
module.exports.requireAdmin = function requireAdmin(req, res, next) {
  if (req.adminRole !== 'admin') {
    return res.status(403).json({ error: { message: '此操作需要管理员权限' } });
  }
  next();
};

module.exports.ADMIN_JWT_SECRET = ADMIN_JWT_SECRET;
