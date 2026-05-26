const store = require('../store');

class ProviderManager {
  constructor() {
    this.failureCounts = new Map();
    this.circuitBreaker = new Map();
  }

  getProviders() {
    return store.getProviders().filter(p => p.enabled);
  }

  getAvailableProviders() {
    const now = Date.now();
    return this.getProviders().filter(p => {
      const blockedUntil = this.circuitBreaker.get(p.name);
      return !blockedUntil || now > blockedUntil;
    });
  }

  selectProvider(preferredName) {
    const available = this.getAvailableProviders();
    if (available.length === 0) {
      this.circuitBreaker.clear();
      return this.getProviders()[0];
    }
    if (preferredName) {
      const preferred = available.find(p => p.name === preferredName);
      if (preferred) return preferred;
    }
    return this.weightedSelect(available);
  }

  selectProviderFromList(providerList) {
    if (providerList.length === 0) {
      return this.getProviders()[0];
    }
    return this.weightedSelect(providerList);
  }

  weightedSelect(providers) {
    const totalWeight = providers.reduce((sum, p) => sum + (p.weight || 1), 0);
    let random = Math.random() * totalWeight;
    for (const provider of providers) {
      random -= (provider.weight || 1);
      if (random <= 0) return provider;
    }
    return providers[providers.length - 1];
  }

  reportFailure(providerName) {
    const count = (this.failureCounts.get(providerName) || 0) + 1;
    this.failureCounts.set(providerName, count);
    if (count >= 3) {
      this.circuitBreaker.set(providerName, Date.now() + 60000);
      this.failureCounts.set(providerName, 0);
    }
  }

  reportSuccess(providerName) {
    this.failureCounts.set(providerName, 0);
  }

  resetCircuitBreaker(providerName) {
    this.circuitBreaker.delete(providerName);
    this.failureCounts.delete(providerName);
  }

  addProvider(provider) {
    return store.addProvider(provider);
  }

  updateProvider(name, changes) {
    return store.updateProvider(name, changes);
  }

  removeProvider(name) {
    this.circuitBreaker.delete(name);
    this.failureCounts.delete(name);
    return store.removeProvider(name);
  }

  getProvidersInfo() {
    const now = Date.now();
    return store.getProviders().map(p => ({
      ...p,
      apiKey: p.apiKey ? p.apiKey.slice(0, 8) + '...' : '',
      blocked: this.circuitBreaker.has(p.name) && now < this.circuitBreaker.get(p.name),
      health: p.health || { lastCheck: 0, latency: 0, healthy: true, consecutiveFailures: 0 },
    }));
  }
}

module.exports = new ProviderManager();
