const fs = require('fs');
const config = require('./config');

class Store {
  constructor() {
    this.state = {
      providers: [],
      apiKeys: [],
      logs: [],
      stats: { totalRequests: 0, totalTokens: 0, totalErrors: 0, startTime: Date.now() },
    };
    this.saveTimer = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(config.dbPath)) {
        const data = JSON.parse(fs.readFileSync(config.dbPath, 'utf8'));
        this.state = { ...this.state, ...data };
        console.log('[Store] Loaded data from', config.dbPath);
      } else {
        this.seedFromEnv();
      }
    } catch (err) {
      console.error('[Store] Failed to load, seeding from .env:', err.message);
      this.seedFromEnv();
    }
  }

  seedFromEnv() {
    this.state.providers = config.providers.map(p => ({
      ...p,
      health: { lastCheck: 0, latency: 0, healthy: true, consecutiveFailures: 0 },
    }));
    this.state.apiKeys = config.apiKeys.map(key => ({
      key,
      name: 'default',
      createdAt: Date.now(),
      enabled: true,
      usageCount: 0,
    }));
    this.save();
    console.log('[Store] Seeded from .env config');
  }

  save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      try {
        fs.writeFileSync(config.dbPath, JSON.stringify(this.state, null, 2));
      } catch (err) {
        console.error('[Store] Failed to save:', err.message);
      }
      this.saveTimer = null;
    }, 2000);
  }

  forceSave() {
    try {
      fs.writeFileSync(config.dbPath, JSON.stringify(this.state, null, 2));
    } catch (err) {
      console.error('[Store] Failed to force save:', err.message);
    }
  }

  // Providers
  getProviders() { return this.state.providers; }

  addProvider(provider) {
    const existing = this.state.providers.find(p => p.name === provider.name);
    if (existing) return false;
    this.state.providers.push({
      ...provider,
      health: { lastCheck: 0, latency: 0, healthy: true, consecutiveFailures: 0 },
    });
    this.save();
    return true;
  }

  updateProvider(name, changes) {
    const idx = this.state.providers.findIndex(p => p.name === name);
    if (idx === -1) return false;
    this.state.providers[idx] = { ...this.state.providers[idx], ...changes };
    this.save();
    return true;
  }

  removeProvider(name) {
    const idx = this.state.providers.findIndex(p => p.name === name);
    if (idx === -1) return false;
    this.state.providers.splice(idx, 1);
    this.save();
    return true;
  }

  // API Keys
  getApiKeys() { return this.state.apiKeys; }

  getApiKey(key) {
    return this.state.apiKeys.find(k => k.key === key);
  }

  addApiKey(apiKey) {
    const existing = this.state.apiKeys.find(k => k.key === apiKey.key);
    if (existing) return false;
    this.state.apiKeys.push(apiKey);
    this.save();
    return true;
  }

  updateApiKey(key, changes) {
    const idx = this.state.apiKeys.findIndex(k => k.key === key);
    if (idx === -1) return false;
    this.state.apiKeys[idx] = { ...this.state.apiKeys[idx], ...changes };
    this.save();
    return true;
  }

  removeApiKey(key) {
    const idx = this.state.apiKeys.findIndex(k => k.key === key);
    if (idx === -1) return false;
    this.state.apiKeys.splice(idx, 1);
    this.save();
    return true;
  }

  incrementKeyUsage(key) {
    const apiKey = this.state.apiKeys.find(k => k.key === key);
    if (apiKey) {
      apiKey.usageCount = (apiKey.usageCount || 0) + 1;
      this.save();
    }
  }

  // Logs
  getLogs(limit = 100) {
    return this.state.logs.slice(0, limit);
  }

  addLog(entry) {
    this.state.logs.unshift({ ...entry, timestamp: Date.now() });
    if (this.state.logs.length > config.maxLogEntries) {
      this.state.logs.length = config.maxLogEntries;
    }
    this.save();
  }

  clearLogs() {
    this.state.logs = [];
    this.save();
  }

  // Stats
  getStats() { return this.state.stats; }

  incrementStats(tokens = 0, error = false) {
    this.state.stats.totalRequests++;
    this.state.stats.totalTokens += tokens;
    if (error) this.state.stats.totalErrors++;
    this.save();
  }
}

module.exports = new Store();
