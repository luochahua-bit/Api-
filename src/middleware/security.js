const config = require('../config');

// Security headers middleware
function securityHeaders(req, res, next) {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    // Prevent MIME sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Content Security Policy
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
    // Strict Transport Security (enable when using HTTPS)
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
}

// Admin IP whitelist middleware (optional, enabled via ADMIN_IP_WHITELIST env var)
function adminIpWhitelist(req, res, next) {
    const whitelist = process.env.ADMIN_IP_WHITELIST;
    if (!whitelist) return next();

    const allowedIps = whitelist.split(',').map(ip => ip.trim());
    const clientIp = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    if (!allowedIps.includes(clientIp) && !allowedIps.includes('*')) {
        console.warn(`[Security] Blocked admin access from ${clientIp}`);
        return res.status(403).json({ error: { message: 'Access denied', type: 'forbidden' } });
    }
    next();
}

// Request logging for security audit
function auditLog(req, res, next) {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const log = {
            time: new Date().toISOString(),
            method: req.method,
            path: req.path,
            ip: req.ip || req.headers['x-forwarded-for'],
            status: res.statusCode,
            duration: `${duration}ms`,
            userAgent: req.headers['user-agent']?.slice(0, 100),
        };
        // Log suspicious activities
        if (res.statusCode === 401 || res.statusCode === 403) {
            console.warn('[Security]', JSON.stringify(log));
        }
    });
    next();
}

module.exports = { securityHeaders, adminIpWhitelist, auditLog };
