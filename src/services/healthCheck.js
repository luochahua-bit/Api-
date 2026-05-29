const axios = require('axios');
const config = require('../config');
const store = require('../store');

class HealthCheckService {
  constructor() {
    this.interval = null;
    this.keepAliveInterval = null;
  }

  start() {
    this.check();
    this.interval = setInterval(() => this.check(), config.healthCheckIntervalMs);
    console.log(`[HealthCheck] Started, interval: ${config.healthCheckIntervalMs / 1000}s`);

    // Anti-sleep: self-ping every 10 minutes to prevent Render free tier from sleeping
    if (process.env.NODE_ENV === 'production' && process.env.RENDER) {
      const SELF_PING_MS = 10 * 60 * 1000; // 10 minutes
      this.keepAliveInterval = setInterval(() => {
        const url = `http://localhost:${config.port}/health`;
        axios.get(url, { timeout: 5000 }).catch(() => {});
      }, SELF_PING_MS);
      console.log(`[HealthCheck] Anti-sleep ping enabled (every 10min)`);
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  async check() {
    const providers = store.getProviders().filter(p => p.enabled);
    for (const provider of providers) {
      try {
        const startTime = Date.now();
        await axios.get(`${provider.baseUrl}/models`, {
          headers: provider.apiKey ? { 'Authorization': `Bearer ${provider.apiKey}` } : {},
          timeout: 10000,
        });
        const latency = Date.now() - startTime;
        store.updateProvider(provider.name, {
          health: { lastCheck: Date.now(), latency, healthy: true, consecutiveFailures: 0 },
        });
      } catch (err) {
        const health = provider.health || { consecutiveFailures: 0 };
        const consecutiveFailures = (health.consecutiveFailures || 0) + 1;
        store.updateProvider(provider.name, {
          health: {
            lastCheck: Date.now(),
            latency: 0,
            healthy: consecutiveFailures < 3,
            consecutiveFailures,
          },
        });
        // Alert at key thresholds to avoid log spam
        if ([10, 50, 100, 500, 1000].includes(consecutiveFailures)) {
          console.warn(`[HealthCheck] ALERT: ${provider.name} has failed ${consecutiveFailures} consecutive times — last error: ${err.message}`);
        }
      }
    }
  }
}

module.exports = new HealthCheckService();
