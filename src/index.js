const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Fatal checks for required security variables
if (!config.adminPassword) {
  console.error('[FATAL] ADMIN_PASSWORD environment variable is not set. Exiting.');
  process.exit(1);
}

const auth = require('./middleware/auth');
const adminAuth = require('./middleware/adminAuth');
const rateLimit = require('./middleware/rateLimit');
const { securityHeaders, adminIpWhitelist, auditLog } = require('./middleware/security');
const requestLogger = require('./middleware/requestLogger');
const v1Routes = require('./routes/v1');
const adminRoutes = require('./routes/admin');
const marketRoutes = require('./routes/marketplace');
const providerManager = require('./services/provider');
const store = require('./store');
const healthCheck = require('./services/healthCheck');

const app = express();

// Trust reverse proxy (Render, Cloudflare, nginx) — makes req.ip return real client IP
app.set('trust proxy', 1);

// Security middleware
app.use(securityHeaders);
app.use(auditLog);
app.use(requestLogger);

// CORS - restrict in production
const configuredOrigin = process.env.CORS_ORIGIN;
const corsOptions = process.env.NODE_ENV === 'production'
  ? {
      origin: configuredOrigin
        ? configuredOrigin.split(',').map(o => o.trim())
        : ['https://llm-api-relay.onrender.com'],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }
  : {};
app.use(cors(corsOptions));

app.use(express.json({ limit: '1mb' }));
app.use(compression());

// Dashboard & Marketplace — dev mode reads file on each request, prod caches in memory
const isDev = process.env.NODE_ENV !== 'production';
if (isDev) {
  app.get(['/', '/market'], (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(fs.readFileSync(path.join(__dirname, 'marketplace.html'), 'utf8'));
  });
  app.get(['/admin', '/dashboard'], (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8'));
  });
} else {
  const dashboardHtml = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
  const marketHtml = fs.readFileSync(path.join(__dirname, 'marketplace.html'), 'utf8');
  app.get(['/', '/market'], (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(marketHtml);
  });
  app.get(['/admin', '/dashboard'], (req, res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(dashboardHtml);
  });
}

// Static public files (WeChat verification, etc.)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Static fix files (CSS, JS, PWA assets)
app.use('/fixes', express.static(path.join(__dirname, 'fixes'), {
  maxAge: '1h',
  setHeaders: (res) => {
    res.set('Cache-Control', 'public, max-age=3600');
  }
}));

// Health check (public, for monitoring)
app.get('/health', (req, res) => {
  const providers = providerManager.getProvidersInfo();
  const degraded = providers.some(p => (p.health?.consecutiveFailures || 0) >= 10);
  const healthy = providers.filter(p => p.health?.healthy).length;
  const total = providers.length;
  res.json({ status: degraded ? 'degraded' : 'ok', providers: { healthy, total } });
});

// Stats (public — logs already mask API keys)
app.get('/api/stats', (req, res) => {
  const stats = store.getStats();
  const providers = providerManager.getProvidersInfo();
  const logs = store.getLogs(50);
  const avgLatency = providers.reduce((sum, p) => sum + (p.health?.latency || 0), 0) / (providers.length || 1);
  res.json({
    ...stats,
    uptime: Math.floor((Date.now() - stats.startTime) / 1000),
    providers,
    logs,
    avgLatency: Math.round(avgLatency),
  });
});

// Public models
const { MODELS } = require('./data/models');
const PROVIDER_ALIAS = { openrouter: 'openrouter-free', google: 'google-ai', nvidia: 'nvidia-nim', github: 'github-models' };
app.get('/api/models', (req, res) => {
  const data = MODELS.map(m => ({
    ...m,
    provider: PROVIDER_ALIAS[m.provider] || m.provider,
  }));
  res.json({ object: 'list', data });
});

// API routes
app.use('/v1', auth, rateLimit, v1Routes);

// Admin login (no auth required) — with rate limiting
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { ADMIN_JWT_SECRET } = require('./middleware/adminAuth');
const ADMIN_PANEL_PASSWORD = config.adminPassword; // Use env var, not hardcoded
const ADMIN_USERS = (process.env.ADMIN_USERS || 'luo').split(',');
const adminLoginAttempts = {};
setInterval(() => {
  const cutoff = Date.now() - 300000;
  for (const key in adminLoginAttempts) {
    if (adminLoginAttempts[key].ts < cutoff) delete adminLoginAttempts[key];
  }
}, 300000);
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  const now = Date.now();
  if (!adminLoginAttempts[ip]) adminLoginAttempts[ip] = { count: 0, ts: now };
  if (now - adminLoginAttempts[ip].ts > 60000) adminLoginAttempts[ip] = { count: 0, ts: now };
  adminLoginAttempts[ip].count++;
  if (adminLoginAttempts[ip].count > 5) {
    return res.status(429).json({ error: { message: '登录尝试过于频繁，请 1 分钟后再试' } });
  }
  const { password, userToken } = req.body;
  if (!password || !userToken) return res.status(400).json({ error: { message: '需要用户登录 + 管理员密码' } });
  // Verify user JWT first
  try {
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('./middleware/userAuth');
    const decoded = jwt.verify(userToken, JWT_SECRET);
    const user = store.getUserById(decoded.userId);
    if (!user || !user.enabled) return res.status(403).json({ error: { message: '用户未登录或已被禁用' } });
    if (!ADMIN_USERS.includes(user.username)) return res.status(403).json({ error: { message: '此账号没有管理员权限' } });
  } catch (e) {
    return res.status(401).json({ error: { message: '请先登录用户账号' } });
  }
  // Verify admin password
  const pwBuf = Buffer.from(password, 'utf8');
  const expectedBuf = Buffer.from(ADMIN_PANEL_PASSWORD, 'utf8');
  const equal = pwBuf.length === expectedBuf.length && crypto.timingSafeEqual(pwBuf, expectedBuf);
  if (!equal) {
    return res.status(401).json({ error: { message: '管理员密码错误' } });
  }
  res.json({ success: true, token: jwt.sign({ role: 'admin' }, ADMIN_JWT_SECRET, { expiresIn: '4h' }) });
});

// Admin routes (with IP whitelist in production)
app.use('/api/admin', adminIpWhitelist, adminAuth, adminRoutes);

// Marketplace routes
app.use('/api/market', marketRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: { message: 'Not found', type: 'invalid_request_error' } });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: { message: 'Internal server error', type: 'server_error' } });
});

// Only start server when running directly (not in Vercel serverless)
if (!process.env.VERCEL) {
  // Try to restore database from cloud backup if local file missing
  const needsRestore = !require('fs').existsSync(require('./config').dbPath);
  store.restoreFromCloud().then(restored => {
    if (needsRestore) {
      if (restored) console.log('[Startup] Database restored from cloud backup');
      else console.warn('[Startup] No cloud backup available, starting with empty database');
    }
  }).catch(e => {
    console.error('[Startup] Cloud restore failed:', e.message);
  }).finally(() => {
  app.listen(config.port, () => {
    console.log('');
    console.log('========================================');
    console.log('  LLM API Relay Station v2.2');
    console.log('========================================');
    console.log(`  Port: ${config.port}`);
    console.log(`  Dashboard: http://localhost:${config.port}`);
    console.log(`  Providers: ${store.getProviders().map(p => p.name).join(', ') || 'none'}`);
    console.log(`  API Keys: ${store.getApiKeys().length}`);
    console.log('========================================');

    // Security warnings for insecure defaults
    const warnings = [];
    if (!process.env.JWT_SECRET) {
      warnings.push('JWT_SECRET 未设置（不应到达此处，启动时应已报错）');
    }
    if (!process.env.MARKET_ENCRYPT_KEY) {
      warnings.push('MARKET_ENCRYPT_KEY 未设置，API Key 加密不安全');
    }
    if (!process.env.SMTP_USER && !process.env.RESEND_API_KEY) {
      warnings.push('邮箱服务未配置（未设置 SMTP_USER 或 RESEND_API_KEY），验证码只打印到控制台');
    }
    if (warnings.length > 0) {
      console.log('');
      console.log('  ⚠️  安全警告:');
      warnings.forEach(w => console.log(`  → ${w}`));
    }
    console.log('');

    healthCheck.start();

    // Start USDT deposit monitor
    const usdtPayment = require('./services/usdtPayment');
    usdtPayment.startMonitor();

    // Start cloud backup service
    const backup = require('./services/backup');
    backup.start();

    // Immediate cloud backup after coin changes (prevents double-credit on restart)
    store.onCoinChange(() => backup.backup());

    // Clean expired verification codes every hour
    setInterval(() => {
      try { store.cleanExpiredCodes(); } catch (e) { /* ignore */ }
    }, 60 * 60 * 1000);

    // Fund reconciliation check every hour
    const recon = store.reconcileCoins();
    if (!recon.balanced) {
      console.warn('[Reconcile] MISMATCH — users have coins but transaction history is incomplete (likely data restored from backup)', JSON.stringify(recon));
    } else {
      console.log(`[Reconcile] OK — ${recon.userCount} users, ${recon.transactionCount} txns, balance: ${recon.totalBalance}`);
    }
    setInterval(() => {
      try {
        const r = store.reconcileCoins();
        if (!r.balanced) console.warn('[Reconcile] MISMATCH!', JSON.stringify(r));
      } catch (e) { /* ignore */ }
    }, 60 * 60 * 1000);
  });
  }); // close finally
} // close if !VERCEL

module.exports = app;
