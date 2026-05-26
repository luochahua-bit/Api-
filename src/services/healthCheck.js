const axios = require('axios');
const config = require('../config');
const store = require('../store');

class HealthCheckService {
  constructor() {
    this.interval = null;
  }

  start() {
    this.check();
    this.interval = setInterval(() => this.check(), config.healthCheckIntervalMs);
    console.log(`[HealthCheck] Started, interval: ${config.healthCheckIntervalMs / 1000}s`);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
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
      }
    }
  }
}

module.exports = new HealthCheckService();
