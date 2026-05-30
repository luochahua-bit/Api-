const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const BACKUP_DIR = path.join(config.dataDir, 'backups');
const MAX_BACKUPS = 10;
const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

class Store {
  constructor() {
    this._locks = new Set(); // Per-user operation locks for concurrency safety
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
      // Coin system
      redemptionCodes: [], // { code, coins, usedBy, usedAt, createdAt, createdBy }
      withdrawals: [],     // { id, userId, coins, status, createdAt, processedAt, note }
      coinTransactions: [], // { id, userId, type, coins, description, createdAt }
      // Email verification
      verificationCodes: [], // { id, email, code, expiresAt, used, createdAt }
      // Payment orders
      paymentOrders: [],   // { id, userId, amount, status, createdAt, paidAt }
      // Task system
      taskCompletions: [], // { id, userId, taskId, reward, date, createdAt }
      inviteCodes: [],     // { userId, code, usedBy: [], createdAt }
      // USDT deposits
      depositOrders: [],   // { id, userId, usdtAmount, coins, address, status, txHash, createdAt, expiresAt, confirmedAt }
      processedTxHashes: [], // string[] — tx hashes already credited
      // Request logs for dispute resolution
      requestLogs: [],     // { id, buyerKeyId, listingId, sellerId, buyerId, model, statusCode, tokenCount, latency, error, source, timestamp, ip }
    };
    this.saveTimer = null;
    this.backupTimer = null;
    this._onCoinChange = null; // callback for immediate cloud backup
    this.load();
    this.initBackup();
  }

  // Called from index.js after startup — async restore from cloud if local file missing
  async restoreFromCloud() {
    if (fs.existsSync(config.dbPath)) return; // local file exists, no need to restore
    const backup = require('./services/backup');
    const restored = await backup.restore();
    if (restored) {
      this.load(); // reload from restored file
    }
  }

  load() {
    try {
      if (fs.existsSync(config.dbPath)) {
        const data = JSON.parse(fs.readFileSync(config.dbPath, 'utf8'));
        this.state = { ...this.state, ...data };
        // Ensure coin system arrays exist for older databases
        this.state.redemptionCodes = this.state.redemptionCodes || [];
        this.state.withdrawals = this.state.withdrawals || [];
        this.state.coinTransactions = this.state.coinTransactions || [];
        this.state.verificationCodes = this.state.verificationCodes || [];
        this.state.paymentOrders = this.state.paymentOrders || [];
        this.state.taskCompletions = this.state.taskCompletions || [];
        this.state.inviteCodes = this.state.inviteCodes || [];
        this.state.depositOrders = this.state.depositOrders || [];
        this.state.processedTxHashes = this.state.processedTxHashes || [];
        this.state.requestLogs = this.state.requestLogs || [];
        console.log('[Store] Loaded data from', config.dbPath);
      } else {
        this.seedFromEnv();
      }
    } catch (err) {
      console.error('[Store] Failed to load:', err.message);
      // Try to recover from latest backup instead of overwriting with demo data
      if (this.recoverFromBackup()) {
        console.log('[Store] Recovered from backup');
      } else {
        console.warn('[Store] No backup available, seeding from env');
        this.seedFromEnv();
      }
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
        const key = crypto.scryptSync(process.env.MARKET_ENCRYPT_KEY, 'salt', 32);
        const iv = crypto.randomBytes(16);
        const cipher = require('crypto').createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
      }

      const demoSeller = {
        id: genId('usr'),
        username: 'demo_seller',
        password: bcrypt.hashSync('06b5186f3dbe7e79d585ea82', 10),
        email: 'demo@example.com',
        role: 'seller',
        coins: 500,
        frozenCoins: 0,
        totalCoinEarnings: 200,
        totalCoinSpending: 0,
        feeCredits: 0,
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
        password: bcrypt.hashSync('06b5186f3dbe7e79d585ea82', 10),
        email: 'buyer@example.com',
        role: 'buyer',
        coins: 200,
        frozenCoins: 0,
        totalCoinEarnings: 0,
        totalCoinSpending: 0,
        feeCredits: 50,
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

  // Atomic write: write to temp file, then rename (prevents half-written corruption)
  save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.atomicWrite();
      this.saveTimer = null;
    }, 2000);
  }

  forceSave() {
    this.atomicWrite();
  }

  atomicWrite() {
    const tmpPath = config.dbPath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
      fs.renameSync(tmpPath, config.dbPath);
    } catch (err) {
      console.error('[Store] Failed to save:', err.message);
      // Clean up temp file if it exists
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }

  // ========== Backup System ==========

  initBackup() {
    // Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    // Backup on startup (if db exists and is healthy)
    if (fs.existsSync(config.dbPath)) {
      this.backup();
    }
    // Periodic backup every hour
    this.backupTimer = setInterval(() => this.backup(), BACKUP_INTERVAL_MS);
  }

  backup() {
    try {
      if (!fs.existsSync(config.dbPath)) return;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupPath = path.join(BACKUP_DIR, `db-${timestamp}.json`);
      fs.copyFileSync(config.dbPath, backupPath);
      this.cleanOldBackups();
    } catch (err) {
      console.error('[Store] Backup failed:', err.message);
    }
  }

  cleanOldBackups() {
    try {
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('db-') && f.endsWith('.json'))
        .sort()
        .reverse();
      // Keep only the newest MAX_BACKUPS files
      for (let i = MAX_BACKUPS; i < files.length; i++) {
        fs.unlinkSync(path.join(BACKUP_DIR, files[i]));
      }
    } catch (err) {
      console.error('[Store] Cleanup failed:', err.message);
    }
  }

  recoverFromBackup() {
    try {
      if (!fs.existsSync(BACKUP_DIR)) return false;
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('db-') && f.endsWith('.json'))
        .sort()
        .reverse();
      if (files.length === 0) return false;
      // Try each backup from newest to oldest
      for (const file of files) {
        try {
          const backupPath = path.join(BACKUP_DIR, file);
          const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
          this.state = { ...this.state, ...data };
          // Restore to main db file
          this.atomicWrite();
          console.log('[Store] Recovered from backup:', file);
          return true;
        } catch (_) {
          continue;
        }
      }
      return false;
    } catch (err) {
      console.error('[Store] Recovery failed:', err.message);
      return false;
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

  /** @returns {{ key: string, name: string, enabled: boolean, usageCount: number, userId?: string, tier?: string }|undefined} */
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

  /** @returns {{ id: string, username: string, email: string, password: string, enabled: boolean, coins: number, freeCoins: number, frozenCoins: number }|undefined} */
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
    this._triggerCoinBackup(); // immediate backup on user registration
    return true;
  }

  updateUser(id, changes) {
    const idx = this.state.users.findIndex(u => u.id === id);
    if (idx === -1) return false;
    this.state.users[idx] = { ...this.state.users[idx], ...changes };
    this.save();
    return true;
  }

  addKnownIp(userId, ip) {
    const user = this.getUserById(userId);
    if (!user) return;
    if (!user.knownIps) user.knownIps = [];
    if (!user.knownIps.includes(ip)) {
      user.knownIps.push(ip);
      // Keep last 50 IPs per user
      if (user.knownIps.length > 50) user.knownIps = user.knownIps.slice(-50);
      this.save();
    }
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

  // Atomically decrement listing quota (concurrency-safe, prevents overselling)
  decrementListingQuota(id, amount) {
    const lockKey = 'listing_' + id;
    if (this._locks.has(lockKey)) return false;
    this._locks.add(lockKey);
    try {
      const idx = this.state.listings.findIndex(l => l.id === id);
      if (idx === -1) return false;
      const listing = this.state.listings[idx];
      if ((listing.remainingQuota || 0) < amount) return false;
      listing.remainingQuota -= amount;
      listing.soldCount = (listing.soldCount || 0) + amount;
      this.save();
      return true;
    } finally {
      this._locks.delete(lockKey);
    }
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

  /** @param {{ id: string, buyerId: string, sellerId: string, listingId: string, amount: number, status: 'frozen'|'completed'|'refunded' }} order */
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
    this._triggerCoinBackup(); // backup on key purchase (buyer gets key)
    return true;
  }

  updateMarketApiKey(key, changes) {
    const idx = this.state.marketApiKeys.findIndex(k => k.key === key);
    if (idx === -1) return false;
    this.state.marketApiKeys[idx] = { ...this.state.marketApiKeys[idx], ...changes };
    this.save();
    return true;
  }

  // ========== Coin System ==========

  // Register callback for immediate cloud backup on coin changes
  onCoinChange(callback) {
    this._onCoinChange = callback;
  }

  // Trigger immediate cloud backup (called after coin changes)
  _triggerCoinBackup() {
    if (this._onCoinChange) {
      try { this._onCoinChange(); } catch (e) { /* ignore */ }
    }
  }

  // Add coins to user balance (concurrency-safe)
  /** Deducts coins: freeCoins first, then coins. @returns {{ deducted: number, remaining: number }} */
  addCoins(userId, amount, description) {
    if (this._locks.has(userId)) return false;
    this._locks.add(userId);
    try {
      const user = this.getUserById(userId);
      if (!user) return false;
      user.coins = (user.coins || 0) + amount;
      this.addCoinTransaction(userId, 'earn', amount, description);
      this.save();
      this._triggerCoinBackup();
      return true;
    } finally {
      this._locks.delete(userId);
    }
  }

  // Deduct coins from user balance (concurrency-safe)
  deductCoins(userId, amount, description) {
    if (this._locks.has(userId)) return false;
    this._locks.add(userId);
    try {
      const user = this.getUserById(userId);
      if (!user || (user.coins || 0) < amount) return false;
      user.coins -= amount;
      this.addCoinTransaction(userId, 'spend', -amount, description);
      this.save();
      this._triggerCoinBackup();
      return true;
    } finally {
      this._locks.delete(userId);
    }
  }

  // Deduct free coins (concurrency-safe, for API usage metering)
  spendFreeCoins(userId, amount, description) {
    if (this._locks.has(userId)) return false;
    this._locks.add(userId);
    try {
      const user = this.getUserById(userId);
      if (!user) return false;
      const actualDeduct = Math.min(amount, user.freeCoins || 0);
      if (actualDeduct <= 0) return false;
      user.freeCoins = (user.freeCoins || 0) - actualDeduct;
      user.totalCoinSpending = (user.totalCoinSpending || 0) + actualDeduct;
      this.addCoinTransaction(userId, 'spend_free', -actualDeduct, description);
      this.save();
      return true;
    } finally {
      this._locks.delete(userId);
    }
  }

  // Freeze coins as transaction deposit (concurrency-safe)
  freezeCoins(userId, amount, description) {
    if (this._locks.has(userId)) return false;
    this._locks.add(userId);
    try {
      const user = this.getUserById(userId);
      if (!user || (user.coins || 0) < amount) return false;
      user.coins -= amount;
      user.frozenCoins = (user.frozenCoins || 0) + amount;
      this.addCoinTransaction(userId, 'freeze', -amount, description);
      this.save();
      return true;
    } finally {
      this._locks.delete(userId);
    }
  }

  // Release frozen coins to another user (after transaction complete) (concurrency-safe)
  releaseCoins(fromUserId, toUserId, amount, fee, description) {
    if (amount <= 0) return false;
    // Lock both users (always lock in same order to prevent deadlock)
    const ids = [fromUserId, toUserId].sort();
    for (const id of ids) {
      if (this._locks.has(id)) return false;
      this._locks.add(id);
    }
    try {
      const fromUser = this.getUserById(fromUserId);
      const toUser = this.getUserById(toUserId);
      if (!fromUser || !toUser) return false;
      if ((fromUser.frozenCoins || 0) < amount) return false;

      fromUser.frozenCoins -= amount;
      const sellerGets = amount - fee;
      toUser.coins = (toUser.coins || 0) + sellerGets;
      toUser.totalCoinEarnings = (toUser.totalCoinEarnings || 0) + sellerGets;
      fromUser.totalCoinSpending = (fromUser.totalCoinSpending || 0) + amount;

      this.addCoinTransaction(fromUserId, 'purchase', -amount, description + ' (买家扣款)');
      this.addCoinTransaction(toUserId, 'earning', sellerGets, description + ' (卖家收款, 服务费' + fee + '金币)');
      if (fee > 0) {
        this.addCoinTransaction('platform', 'fee', fee, description + ' (平台服务费)');
      }
      this.save();
      this._triggerCoinBackup(); // backup on transaction completion
      return true;
    } finally {
      for (const id of ids) this._locks.delete(id);
    }
  }

  // Refund frozen coins back to buyer (concurrency-safe)
  refundCoins(userId, amount, description) {
    if (this._locks.has(userId)) return false;
    this._locks.add(userId);
    try {
      const user = this.getUserById(userId);
      if (!user) return false;
      if ((user.frozenCoins || 0) < amount) return false;
      user.frozenCoins -= amount;
      user.coins = (user.coins || 0) + amount;
      this.addCoinTransaction(userId, 'refund', amount, description);
      this.save();
      this._triggerCoinBackup(); // backup on refund
      return true;
    } finally {
      this._locks.delete(userId);
    }
  }

  // Refund by deducting from seller (for disputes after coins already released)
  refundFromSeller(buyerId, sellerId, amount, description) {
    const ids = [buyerId, sellerId].sort();
    for (const id of ids) {
      if (this._locks.has(id)) return false;
      this._locks.add(id);
    }
    try {
      const seller = this.getUserById(sellerId);
      const buyer = this.getUserById(buyerId);
      if (!seller || !buyer) return false;
      if ((seller.coins || 0) < amount) return false;
      seller.coins -= amount;
      seller.totalCoinEarnings = (seller.totalCoinEarnings || 0) - amount;
      buyer.coins = (buyer.coins || 0) + amount;
      this.addCoinTransaction(sellerId, 'dispute_refund', -amount, '争议退款扣减: ' + description);
      this.addCoinTransaction(buyerId, 'refund', amount, '争议退款: ' + description);
      this.save();
      this._triggerCoinBackup();
      return true;
    } finally {
      for (const id of ids) this._locks.delete(id);
    }
  }

  // Redemption codes
  getRedemptionCodes() { return this.state.redemptionCodes; }

  addRedemptionCode(code) {
    this.state.redemptionCodes.push(code);
    this.save();
    return true;
  }

  useRedemptionCode(codeStr, userId) {
    // Lock to prevent double-redemption from concurrent requests
    const lockKey = 'redeem_' + codeStr;
    if (this._locks.has(lockKey)) return { success: false, error: '兑换码正在处理中' };
    this._locks.add(lockKey);
    try {
      const code = this.state.redemptionCodes.find(c => c.code === codeStr && !c.usedBy);
      if (!code) return { success: false, error: '兑换码无效或已使用' };
      // Mark as used BEFORE adding coins to prevent double-redemption
      code.usedBy = userId;
      code.usedAt = Date.now();
      const added = this.addCoins(userId, code.coins, '兑换码 ' + codeStr);
      if (!added) {
        // Rollback: unmark the code so user can retry
        code.usedBy = undefined;
        code.usedAt = undefined;
        return { success: false, error: '系统繁忙，请稍后重试' };
      }
      this.save();
      return { success: true, coins: code.coins };
    } finally {
      this._locks.delete(lockKey);
    }
  }

  // Withdrawals
  getWithdrawals() { return this.state.withdrawals; }

  getWithdrawalById(id) { return this.state.withdrawals.find(w => w.id === id); }

  getWithdrawalsByUser(userId) {
    return this.state.withdrawals.filter(w => w.userId === userId);
  }

  addWithdrawal(withdrawal) {
    this.state.withdrawals.push(withdrawal);
    this.save();
    this._triggerCoinBackup(); // immediate backup on withdrawal
    return true;
  }

  updateWithdrawal(id, changes) {
    const idx = this.state.withdrawals.findIndex(w => w.id === id);
    if (idx === -1) return false;
    this.state.withdrawals[idx] = { ...this.state.withdrawals[idx], ...changes };
    this.save();
    return true;
  }

  // Withdrawal settings
  getWithdrawalSettings() {
    if (!this.state.withdrawalSettings) {
      this.state.withdrawalSettings = { autoApprove: false, autoMaxUsdt: 50, autoDailyMaxUsdt: 200 };
    }
    return this.state.withdrawalSettings;
  }

  updateWithdrawalSettings(settings) {
    this.state.withdrawalSettings = settings;
    this.save();
  }

  // ========== Fund Reconciliation ==========
  reconcileCoins() {
    const txns = this.state.coinTransactions || [];
    const users = this.state.users || [];

    // Sum all coin inflows (positive amounts)
    let totalInflow = 0;
    let totalOutflow = 0;
    for (const tx of txns) {
      if (tx.coins > 0) totalInflow += tx.coins;
      else totalOutflow += Math.abs(tx.coins);
    }

    // Sum current user balances
    let totalUserCoins = 0;
    let totalUserFreeCoins = 0;
    let totalUserFrozenCoins = 0;
    for (const u of users) {
      totalUserCoins += (u.coins || 0);
      totalUserFreeCoins += (u.freeCoins || 0);
      totalUserFrozenCoins += (u.frozenCoins || 0);
    }

    const totalBalance = totalUserCoins + totalUserFreeCoins + totalUserFrozenCoins;
    const expected = totalInflow - totalOutflow;
    const discrepancy = Math.abs(totalBalance - expected);

    const result = {
      totalInflow,
      totalOutflow,
      totalBalance,
      expected,
      discrepancy,
      balanced: discrepancy < 1, // allow rounding
      userCount: users.length,
      transactionCount: txns.length,
      timestamp: Date.now(),
    };

    if (!result.balanced) {
      console.warn('[RECONCILIATION] MISMATCH DETECTED!', JSON.stringify(result));
    }

    return result;
  }

  // Coin transactions log
  getCoinTransactions(userId) {
    if (userId) return this.state.coinTransactions.filter(t => t.userId === userId);
    return this.state.coinTransactions;
  }

  addCoinTransaction(userId, type, coins, description) {
    // Snapshot user balance at time of transaction for audit trail
    const user = userId !== 'platform' ? this.getUserById(userId) : null;
    const balanceAfter = user ? { coins: user.coins || 0, freeCoins: user.freeCoins || 0, frozenCoins: user.frozenCoins || 0 } : null;
    this.state.coinTransactions.push({
      id: 'ctx_' + crypto.randomUUID(),
      userId, type, coins, description,
      balanceAfter,
      createdAt: Date.now(),
    });
    // Keep last 5000 records
    if (this.state.coinTransactions.length > 5000) {
      this.state.coinTransactions = this.state.coinTransactions.slice(-5000);
    }
  }

  // ========== Email Verification ==========

  addVerificationCode(entry) {
    // Remove old codes for same email
    this.state.verificationCodes = this.state.verificationCodes.filter(c => c.email !== entry.email);
    this.state.verificationCodes.push(entry);
    this.save();
  }

  /** @returns {{ id: string, email: string, code: string, expiresAt: number, used: boolean }|null} */
  getValidVerificationCode(email, code) {
    const now = Date.now();
    return this.state.verificationCodes.find(c =>
      c.email === email && c.code === code && !c.used && c.expiresAt > now
    );
  }

  markCodeUsed(email) {
    const idx = this.state.verificationCodes.findIndex(c => c.email === email && !c.used);
    if (idx !== -1) {
      this.state.verificationCodes[idx].used = true;
      this.save();
    }
  }

  cleanExpiredCodes() {
    const now = Date.now();
    this.state.verificationCodes = this.state.verificationCodes.filter(c => c.expiresAt > now);
    this.save();
  }

  isEmailVerified(email) {
    const user = this.state.users.find(u => u.email === email);
    return user ? (user.emailVerified === true) : false;
  }

  // ========== Payment Orders ==========

  addPaymentOrder(order) {
    this.state.paymentOrders.push(order);
    this.save();
  }

  getPaymentOrder(id) {
    return this.state.paymentOrders.find(o => o.id === id);
  }

  updatePaymentOrder(id, changes) {
    const idx = this.state.paymentOrders.findIndex(o => o.id === id);
    if (idx === -1) return false;
    this.state.paymentOrders[idx] = { ...this.state.paymentOrders[idx], ...changes };
    this.save();
    return true;
  }

  getUserPaymentOrders(userId) {
    return this.state.paymentOrders.filter(o => o.userId === userId);
  }

  // ========== Free Coins + Task System ==========

  // Add free coins to user (from task rewards) (concurrency-safe)
  addFreeCoins(userId, amount, description) {
    if (this._locks.has(userId)) return false;
    this._locks.add(userId);
    try {
      const user = this.getUserById(userId);
      if (!user) return false;
      user.freeCoins = (user.freeCoins || 0) + amount;
      this.addCoinTransaction(userId, 'task_reward', amount, description);
      this.save();
      return true;
    } finally {
      this._locks.delete(userId);
    }
  }

  // Spend coins: free coins first, then paid coins (concurrency-safe)
  spendCoins(userId, amount, description) {
    if (this._locks.has(userId)) return { success: false, error: '操作进行中，请稍后' };
    this._locks.add(userId);
    try {
      const user = this.getUserById(userId);
      if (!user) return { success: false, error: '用户不存在' };

      const freeCoins = user.freeCoins || 0;
      const paidCoins = user.coins || 0;
      const total = freeCoins + paidCoins;

      if (total < amount) return { success: false, error: '金币不足' };

      let fromFree = Math.min(freeCoins, amount);
      let fromPaid = amount - fromFree;

      user.freeCoins = freeCoins - fromFree;
      user.coins = paidCoins - fromPaid;
      user.totalCoinSpending = (user.totalCoinSpending || 0) + amount;

      if (fromFree > 0) this.addCoinTransaction(userId, 'spend_free', -fromFree, description + ' (免费币)');
      if (fromPaid > 0) this.addCoinTransaction(userId, 'spend', -fromPaid, description + ' (付费币)');

      this.save();
      return { success: true, fromFree, fromPaid };
    } finally {
      this._locks.delete(userId);
    }
  }

  // Record task completion
  addTaskCompletion(userId, taskId, reward) {
    const today = new Date().toISOString().slice(0, 10);
    this.state.taskCompletions.push({
      id: 'tc_' + crypto.randomUUID(),
      userId, taskId, reward, date: today, createdAt: Date.now(),
    });
    this.save();
  }

  // Get user's task completions
  getTaskCompletions(userId) {
    return this.state.taskCompletions.filter(c => c.userId === userId);
  }

  // Invite codes
  addInviteCode(userId, code) {
    if (this.state.inviteCodes.find(c => c.userId === userId)) return false;
    this.state.inviteCodes.push({ userId, code, usedBy: [], createdAt: Date.now() });
    this.save();
    return true;
  }

  getInviteCode(code) {
    return this.state.inviteCodes.find(c => c.code === code);
  }

  useInviteCode(code, newUserId) {
    const lockKey = 'invite_' + code;
    if (this._locks.has(lockKey)) return { success: false, error: '邀请码正在处理中' };
    this._locks.add(lockKey);
    try {
      const invite = this.state.inviteCodes.find(c => c.code === code);
      if (!invite) return { success: false, error: '邀请码无效' };
      if (invite.userId === newUserId) return { success: false, error: '不能使用自己的邀请码' };
      if (invite.usedBy.includes(newUserId)) return { success: false, error: '已使用过此邀请码' };
      if (invite.usedBy.length >= 20) return { success: false, error: '邀请码使用次数已达上限' };
      invite.usedBy.push(newUserId);
      this.save();
      return { success: true, inviterId: invite.userId };
    } finally {
      this._locks.delete(lockKey);
    }
  }

  // ========== USDT Deposit Orders ==========

  addDepositOrder(order) {
    this.state.depositOrders.push(order);
    this.save();
    this._triggerCoinBackup(); // immediate backup on deposit order
  }

  getDepositOrder(id) {
    return this.state.depositOrders.find(o => o.id === id);
  }

  getDepositOrders() { return this.state.depositOrders; }

  getPendingDepositOrders() {
    return this.state.depositOrders.filter(o => o.status === 'pending');
  }

  getUserDepositOrders(userId) {
    return this.state.depositOrders.filter(o => o.userId === userId);
  }

  updateDepositOrder(id, changes) {
    const idx = this.state.depositOrders.findIndex(o => o.id === id);
    if (idx === -1) return false;
    this.state.depositOrders[idx] = { ...this.state.depositOrders[idx], ...changes };
    this.save();
    return true;
  }

  addProcessedTx(txHash) {
    this.state.processedTxHashes.push(txHash);
    // Keep last 10000 hashes
    if (this.state.processedTxHashes.length > 10000) {
      this.state.processedTxHashes = this.state.processedTxHashes.slice(-10000);
    }
    this.save();
    this._triggerCoinBackup();
  }

  isDepositTxProcessed(txHash) {
    return this.state.processedTxHashes.includes(txHash);
  }

  // ========== Request Logs (for dispute resolution) ==========

  addRequestLog(log) {
    this.state.requestLogs.push(log);
    // Keep last 5000 logs
    if (this.state.requestLogs.length > 5000) {
      this.state.requestLogs = this.state.requestLogs.slice(-5000);
    }
    this.save();
  }

  getRequestLogsByBuyerKey(buyerKeyId, limit = 20) {
    return this.state.requestLogs
      .filter(l => l.buyerKeyId === buyerKeyId)
      .slice(-limit);
  }

  getRequestLogsByListing(listingId, limit = 50) {
    return this.state.requestLogs
      .filter(l => l.listingId === listingId)
      .slice(-limit);
  }

  getRequestLogsBySeller(sellerId, limit = 50) {
    return this.state.requestLogs
      .filter(l => l.sellerId === sellerId)
      .slice(-limit);
  }
}

module.exports = new Store();
