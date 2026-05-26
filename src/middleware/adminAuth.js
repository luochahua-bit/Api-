const config = require('../config');

module.exports = function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { message: 'Admin authentication required', type: 'auth_error' },
    });
  }

  const token = authHeader.slice(7);
  if (token !== config.adminPassword) {
    return res.status(403).json({
      error: { message: 'Invalid admin password', type: 'auth_error' },
    });
  }

  next();
};
