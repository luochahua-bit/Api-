const axios = require('axios');
const config = require('../config');
const providerManager = require('./provider');

const FREE_MODEL_PATTERNS = [':free'];

function isFreeModel(model) {
  return FREE_MODEL_PATTERNS.some(p => model?.includes(p));
}

function filterProvidersForModel(model, providers) {
  if (isFreeModel(model)) {
    const freeProviders = providers.filter(p => !p.apiKey || p.apiKey.length === 0);
    if (freeProviders.length > 0) return freeProviders;
    return providers;
  }
  return providers.filter(p => p.apiKey && p.apiKey.length > 0);
}

async function proxyRequest(req, targetPath) {
  let lastError;
  const tried = new Set();
  const model = req.body?.model || '';
  const startTime = Date.now();
  const availableProviders = providerManager.getAvailableProviders();
  const suitableProviders = filterProvidersForModel(model, availableProviders);

  if (suitableProviders.length === 0) {
    throw new Error(`No suitable provider available for model: ${model}`);
  }

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const provider = providerManager.selectProviderFromList(suitableProviders);
    if (tried.has(provider.name) && tried.size >= suitableProviders.length) break;
    tried.add(provider.name);

    const targetUrl = `${provider.baseUrl}${targetPath}`;
    const isStreaming = req.body?.stream === true;

    try {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': isStreaming ? 'text/event-stream' : 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'LLM API Relay',
      };

      if (provider.apiKey && provider.apiKey.length > 0) {
        headers['Authorization'] = `Bearer ${provider.apiKey}`;
      }

      const response = await axios({
        method: req.method,
        url: targetUrl,
        headers,
        data: req.body,
        timeout: config.requestTimeoutMs,
        responseType: isStreaming ? 'stream' : 'json',
        validateStatus: () => true,
      });

      const duration = Date.now() - startTime;

      if (response.status === 401 || response.status === 403) {
        providerManager.reportFailure(provider.name);
        lastError = new Error(`Provider ${provider.name} auth failed: ${response.data?.error?.message || 'Unauthorized'}`);
        continue;
      }

      if (response.status >= 500) {
        providerManager.reportFailure(provider.name);
        lastError = new Error(`Upstream ${provider.name} returned ${response.status}`);
        continue;
      }

      providerManager.reportSuccess(provider.name);

      if (isStreaming && response.headers['content-type']?.includes('text/event-stream')) {
        return { streaming: true, response, provider: provider.name, duration };
      }

      return {
        streaming: false,
        status: response.status,
        data: response.data,
        provider: provider.name,
        duration,
      };
    } catch (err) {
      providerManager.reportFailure(provider.name);
      lastError = err;
    }
  }

  throw lastError || new Error('All providers failed');
}

module.exports = { proxyRequest };
