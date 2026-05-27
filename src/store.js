const fs = require('fs');
const config = require('./config');

class Store {
  constructor() {
    this.state = {
      providers: [],
      apiKeys: [],
      logs: [],
      stats: { totalRequests: 0, totalTokens: 0, totalErrors: 0, startTime: Date.now() },
      // Marketplace data
      users: [],
      listings: [],
      orders: [],
      reviews: [],
      transactions: [],
      marketApiKeys: [], // buyer API keys for marketplace proxy
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
    this.seedMarketplace();
  }

  seedMarketplace() {
    // Create demo seller if marketplace is empty
    if (this.state.users.length === 0) {
      const bcrypt = require('bcryptjs');
      const crypto = require('crypto');

      function genId(prefix) {
        return prefix + '_' + crypto.randomBytes(10).toString('hex');
      }

      function encryptKey(text) {
        const ENCRYPTION_KEY = 'market-encrypt-key-32bytes!!!!!';
        const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
        const iv = crypto.randomBytes(16);
        const cipher = require('crypto').createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
      }

      const demoSeller = {
        id: genId('usr'),
        username: 'demo_seller',
        password: bcrypt.hashSync('demo123', 10),
        email: 'demo@example.com',
        role: 'seller',
        balance: 100,
        frozenBalance: 0,
        totalEarnings: 50,
        totalSpending: 0,
        rating: 4.8,
        ratingCount: 12,
        createdAt: Date.now(),
        enabled: true,
      };

      const demoBuyer = {
        id: genId('usr'),
        username: 'demo_buyer',
        password: bcrypt.hashSync('demo123', 10),
        email: 'buyer@example.com',
        role: 'buyer',
        balance: 50,
        frozenBalance: 0,
        totalEarnings: 0,
        totalSpending: 0,
        rating: 5.0,
        ratingCount: 0,
        createdAt: Date.now(),
        enabled: true,
      };

      this.state.users.push(demoSeller, demoBuyer);

      // Create demo listings
      const demoListings = [
        {
          id: genId('lst'), sellerId: demoSeller.id, sellerName: 'demo_seller',
          providerType: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: encryptKey('sk-or-v1-demo'), description: 'OpenRouter 全家桶 - DeepSeek/Gemma/Llama 等 25+ 模型',
          models: ['deepseek/deepseek-v4-flash:free', 'google/gemma-4-26b-a4b-it:free', 'meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen3-coder:free'],
          modelRates: { 'deepseek/deepseek-v4-flash:free': 0.5, 'google/gemma-4-26b-a4b-it:free': 0.3, 'meta-llama/llama-3.3-70b-instruct:free': 0.8, 'qwen/qwen3-coder:free': 0.6 },
          pricePerRequest: 0.01, pricePerToken: 0.00001, totalQuota: 500, remainingQuota: 480,
          status: 'active', health: { lastCheck: Date.now(), latency: 500, healthy: true },
          sharingMode: 'exclusive',
          createdAt: Date.now() - 86400000, soldCount: 20, rating: 4.9, ratingCount: 8,
        },
        {
          id: genId('lst'), sellerId: demoSeller.id, sellerName: 'demo_seller',
          providerType: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1',
          apiKey: encryptKey('gsk-demo'), description: 'Groq 超速推理 - Llama 3.3 70B / Qwen3 32B',
          models: ['llama-3.3-70b-versatile', 'qwen/qwen3-32b', 'llama-4-scout-17b-16e-instruct'],
          modelRates: { 'llama-3.3-70b-versatile': 1, 'qwen/qwen3-32b': 0.8, 'llama-4-scout-17b-16e-instruct': 0.5 },
          pricePerRequest: 0.05, pricePerToken: 0.00002, totalQuota: 200, remainingQuota: 150,
          status: 'active', health: { lastCheck: Date.now(), latency: 120, healthy: true },
          sharingMode: 'shared',
          createdAt: Date.now() - 172800000, soldCount: 50, rating: 4.7, ratingCount: 15,
        },
        {
          id: genId('lst'), sellerId: demoSeller.id, sellerName: 'demo_seller',
          providerType: 'openai-compatible', baseUrl: 'https://api.cerebras.ai/v1',
          apiKey: encryptKey('csk-demo'), description: 'Cerebras 极速推理 - GPT-OSS 120B / Llama 3.1 8B',
          models: ['gpt-oss-120b', 'llama3.1-8b'],
          modelRates: { 'gpt-oss-120b': 2, 'llama3.1-8b': 0.3 },
          pricePerRequest: 0.03, pricePerToken: 0.00001, totalQuota: 300, remainingQuota: 280,
          status: 'active', health: { lastCheck: Date.now(), latency: 80, healthy: true },
          sharingMode: 'shared',
          createdAt: Date.now() - 259200000, soldCount: 20, rating: 4.5, ratingCount: 5,
        },
        {
          id: genId('lst'), sellerId: demoSeller.id, sellerName: 'demo_seller',
          providerType: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: encryptKey('AIza-demo'), description: 'Google Gemini 2.5 Flash - 免费大杯模型',
          models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemma-3-27b-it'],
          modelRates: { 'gemini-2.5-flash': 1.5, 'gemini-2.0-flash': 1, 'gemma-3-27b-it': 0.5 },
          pricePerRequest: 0.02, pricePerToken: 0.00001, totalQuota: 400, remainingQuota: 350,
          status: 'active', health: { lastCheck: Date.now(), latency: 300, healthy: true },
          sharingMode: 'shared',
          createdAt: Date.now() - 345600000, soldCount: 50, rating: 4.6, ratingCount: 6,
        },
        {
          id: genId('lst'), sellerId: demoSeller.id, sellerName: 'demo_seller',
          providerType: 'openai-compatible', baseUrl: 'https://api.sambanova.ai/v1',
          apiKey: encryptKey('samba-demo'), description: 'SambaNova DeepSeek V3/R1 - 高级推理模型',
          models: ['DeepSeek-V3-0324', 'DeepSeek-R1-Distill-Llama-70B', 'Meta-Llama-3.3-70B-Instruct'],
          modelRates: { 'DeepSeek-V3-0324': 2, 'DeepSeek-R1-Distill-Llama-70B': 3, 'Meta-Llama-3.3-70B-Instruct': 1 },
          pricePerRequest: 0.1, pricePerToken: 0.00005, totalQuota: 100, remainingQuota: 85,
          status: 'active', health: { lastCheck: Date.now(), latency: 200, healthy: true },
          sharingMode: 'exclusive',
          createdAt: Date.now() - 432000000, soldCount: 15, rating: 4.4, ratingCount: 3,
        },
      ];

      this.state.listings.push(...demoListings);
      this.save();
      console.log('[Store] Seeded marketplace with demo data');
    }
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

  // ========== Marketplace: Users ==========
  getUsers() { return this.state.users; }

  getUserById(id) {
    return this.state.users.find(u => u.id === id);
  }

  getUserByUsername(username) {
    return this.state.users.find(u => u.username === username);
  }

  getUserByEmail(email) {
    return this.state.users.find(u => u.email === email);
  }

  addUser(user) {
    if (this.state.users.find(u => u.username === user.username || u.email === user.email)) return false;
    this.state.users.push(user);
    this.save();
    return true;
  }

  updateUser(id, changes) {
    const idx = this.state.users.findIndex(u => u.id === id);
    if (idx === -1) return false;
    this.state.users[idx] = { ...this.state.users[idx], ...changes };
    this.save();
    return true;
  }

  // ========== Marketplace: Listings ==========
  getListings() { return this.state.listings; }

  getListingById(id) {
    return this.state.listings.find(l => l.id === id);
  }

  getListingsBySeller(sellerId) {
    return this.state.listings.filter(l => l.sellerId === sellerId);
  }

  getActiveListings() {
    return this.state.listings.filter(l => l.status === 'active' && l.remainingQuota > 0);
  }

  addListing(listing) {
    this.state.listings.push(listing);
    this.save();
    return true;
  }

  updateListing(id, changes) {
    const idx = this.state.listings.findIndex(l => l.id === id);
    if (idx === -1) return false;
    this.state.listings[idx] = { ...this.state.listings[idx], ...changes };
    this.save();
    return true;
  }

  removeListing(id) {
    const idx = this.state.listings.findIndex(l => l.id === id);
    if (idx === -1) return false;
    this.state.listings.splice(idx, 1);
    this.save();
    return true;
  }

  // ========== Marketplace: Orders ==========
  getOrders() { return this.state.orders; }

  getOrderById(id) {
    return this.state.orders.find(o => o.id === id);
  }

  getOrdersByBuyer(buyerId) {
    return this.state.orders.filter(o => o.buyerId === buyerId);
  }

  getOrdersBySeller(sellerId) {
    return this.state.orders.filter(o => o.sellerId === sellerId);
  }

  addOrder(order) {
    this.state.orders.push(order);
    this.save();
    return true;
  }

  updateOrder(id, changes) {
    const idx = this.state.orders.findIndex(o => o.id === id);
    if (idx === -1) return false;
    this.state.orders[idx] = { ...this.state.orders[idx], ...changes };
    this.save();
    return true;
  }

  // ========== Marketplace: Reviews ==========
  getReviews() { return this.state.reviews; }

  getReviewsBySeller(sellerId) {
    return this.state.reviews.filter(r => r.sellerId === sellerId);
  }

  getReviewsByListing(listingId) {
    return this.state.reviews.filter(r => r.listingId === listingId);
  }

  addReview(review) {
    this.state.reviews.push(review);
    this.save();
    return true;
  }

  // ========== Marketplace: Transactions ==========
  getTransactions() { return this.state.transactions; }

  getTransactionsByUser(userId) {
    return this.state.transactions.filter(t => t.userId === userId);
  }

  addTransaction(transaction) {
    this.state.transactions.push(transaction);
    this.save();
    return true;
  }

  // ========== Marketplace: Buyer API Keys ==========
  getMarketApiKeys() { return this.state.marketApiKeys; }

  getMarketApiKey(key) {
    return this.state.marketApiKeys.find(k => k.key === key && k.enabled);
  }

  getMarketApiKeysByListing(listingId) {
    return this.state.marketApiKeys.filter(k => k.listingId === listingId);
  }

  getActiveBuyerCount(listingId) {
    return this.state.marketApiKeys.filter(k => k.listingId === listingId && k.enabled && k.remainingQuota > 0).length;
  }

  reenableBuyerKeys(listingId) {
    let count = 0;
    for (const k of this.state.marketApiKeys) {
      if (k.listingId === listingId && !k.enabled && k.remainingQuota > 0) {
        k.enabled = true;
        count++;
      }
    }
    if (count > 0) this.save();
    return count;
  }

  addMarketApiKey(apiKey) {
    this.state.marketApiKeys.push(apiKey);
    this.save();
    return true;
  }

  updateMarketApiKey(key, changes) {
    const idx = this.state.marketApiKeys.findIndex(k => k.key === key);
    if (idx === -1) return false;
    this.state.marketApiKeys[idx] = { ...this.state.marketApiKeys[idx], ...changes };
    this.save();
    return true;
  }
}

module.exports = new Store();
