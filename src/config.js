require('dotenv').config();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function parseProviders() {
  const providers = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (/^PROVIDERS(_\d+)?$/.test(key) && value) {
      const parts = value.split('|');
      if (parts.length >= 4) {
        providers.push({
          name: parts[0].trim(),
          baseUrl: parts[1].trim(),
          apiKey: parts[2].trim(),
          weight: parseInt(parts[3]) || 1,
          enabled: parts[4] !== 'false',
        });
      }
    }
  }
  return providers;
}

module.exports = {
  port: parseInt(process.env.PORT) || 3000,
  apiKeys: (process.env.API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean),
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  providers: parseProviders(),
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 60,
  },
  maxRetries: parseInt(process.env.MAX_RETRIES) || 2,
  requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS) || 60000,
  healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS) || 60000,
  maxLogEntries: parseInt(process.env.MAX_LOG_ENTRIES) || 1000,
  dataDir,
  dbPath: path.join(dataDir, 'db.json'),
};
