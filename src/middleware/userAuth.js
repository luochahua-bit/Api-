const jwt = require('jsonwebtoken');
const store = require('../store');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is not set. Exiting.');
  process.exit(1);
}

module.exports = function userAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { message: 'Missing or invalid Authorization header', type: 'auth_error' },
    });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = store.getUserById(decoded.userId);
    if (!user || !user.enabled) {
      return res.status(403).json({
        error: { message: 'User not found or disabled', type: 'auth_error' },
      });
    }
    req.user = user;
    req.userId = user.id;
    next();
  } catch (err) {
    return res.status(401).json({
      error: { message: 'Invalid or expired token', type: 'auth_error' },
    });
  }
};

module.exports.JWT_SECRET = JWT_SECRET;
