const store = require('../store');

class Logger {
  log(entry) {
    store.addLog(entry);
  }

  logRequest({ id, model, provider, status, tokens, duration, apiKey, error }) {
    const maskedKey = apiKey ? apiKey.slice(0, 8) + '...' : 'unknown';
    this.log({
      id,
      model,
      provider,
      status,
      tokens: tokens || 0,
      duration: duration || 0,
      apiKey: maskedKey,
      error: error || null,
    });
  }

  getRecentLogs(limit = 100) {
    return store.getLogs(limit);
  }

  getLogsByModel(model) {
    return store.getLogs().filter(l => l.model === model);
  }

  getLogsByProvider(provider) {
    return store.getLogs().filter(l => l.provider === provider);
  }

  clearLogs() {
    store.clearLogs();
  }
}

module.exports = new Logger();
