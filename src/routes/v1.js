const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { proxyRequest } = require('../services/proxy');
const providerManager = require('../services/provider');
const logger = require('../services/logger');
const store = require('../store');
const { MODELS } = require('../data/models');
const { isFreeKey, isFreeModel, getFreeModelsForResponse, deductFreeCoins, TOKENS_PER_COIN } = require('../utils/freeKeyManager');

const router = Router();

// Simple in-memory cache for /v1/models
let modelsCache = { free: null, paid: null, ts: 0 };
const MODELS_CACHE_TTL = 60000; // 60 seconds

router.get('/models', (req, res) => {
  const now = Date.now();

  // Free keys only see free models
  if (req.keyTier === 'free') {
    if (!modelsCache.free || now - modelsCache.ts > MODELS_CACHE_TTL) {
      modelsCache.free = { object: 'list', data: getFreeModelsForResponse() };
      modelsCache.ts = now;
    }
    return res.json(modelsCache.free);
  }

  if (!modelsCache.paid || now - modelsCache.ts > MODELS_CACHE_TTL) {
    const providers = providerManager.getProvidersInfo();
    modelsCache.paid = {
      object: 'list',
      data: MODELS.map(m => ({
        id: m.id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: m.provider,
        _free: m.free || false,
        _provider: m.provider,
      })),
      _providers: providers,
    };
    modelsCache.ts = now;
  }
  res.json(modelsCache.paid);
});

router.post('/chat/completions', async (req, res) => {
  const requestId = `chatcmpl-${uuidv4().replace(/-/g, '').slice(0, 24)}`;
  const model = req.body?.model || 'unknown';
  const startTime = Date.now();

  // Free keys can only use free models
  if (req.keyTier === 'free' && !isFreeModel(model)) {
    return res.status(403).json({
      error: {
        message: `免费 Key 不支持模型 "${model}"，请使用免费模型或升级付费 Key`,
        type: 'auth_error',
        code: 'model_not_allowed',
      },
    });
  }

  try {
    const result = await proxyRequest(req, '/chat/completions');

    if (result.streaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Proxy-Provider', result.provider);
      res.setHeader('X-Request-Id', requestId);

      let chunkCount = 0;
      let byteCount = 0;
      result.response.data.on('data', (chunk) => {
        chunkCount++;
        byteCount += chunk.length;
        res.write(chunk);
      });
      result.response.data.on('end', () => {
        store.incrementStats(chunkCount);

        // Deduct free coins (streaming: estimate tokens from byte count)
        // ~4 chars per English token, ~2 per CJK token; use 3 as mixed-content average
        if (req.keyTier === 'free' && req.freeKeyUserId) {
          const estimatedTokens = Math.max(1, Math.round(byteCount / 3));
          const deductResult = deductFreeCoins(req.freeKeyUserId, estimatedTokens);
          // Can't set headers after streaming starts, but deduction still happens
        }

        logger.logRequest({
          id: requestId, model, provider: result.provider,
          status: 'streaming', tokens: chunkCount, duration: result.duration,
          apiKey: req.apiKey,
        });
        res.end();
      });
      result.response.data.on('error', () => {
        store.incrementStats(0, true);
        logger.logRequest({
          id: requestId, model, provider: result.provider,
          status: 'error', duration: result.duration, apiKey: req.apiKey,
        });
        res.end();
      });
      req.on('close', () => result.response.data.destroy());
      return;
    }

    res.setHeader('X-Proxy-Provider', result.provider);
    res.setHeader('X-Request-Id', requestId);
    const usage = result.data?.usage;
    const tokens = usage ? (usage.prompt_tokens || 0) + (usage.completion_tokens || 0) : 0;
    store.incrementStats(tokens);

    // Deduct free coins based on actual token usage
    if (req.keyTier === 'free' && req.freeKeyUserId) {
      const deductResult = deductFreeCoins(req.freeKeyUserId, tokens);
      res.setHeader('X-Free-Coins-Used', String(deductResult.deducted));
      res.setHeader('X-Free-Coins-Remaining', String(deductResult.remaining));
      res.setHeader('X-Tokens-Per-Coin', String(TOKENS_PER_COIN));
    }

    logger.logRequest({
      id: requestId, model, provider: result.provider,
      status: result.status, tokens, duration: result.duration, apiKey: req.apiKey,
    });
    res.status(result.status).json({ ...result.data, id: result.data.id || requestId });
  } catch (err) {
    store.incrementStats(0, true);
    logger.logRequest({
      id: requestId, model, provider: 'none',
      status: 'error', error: err.message, apiKey: req.apiKey,
    });
    res.status(502).json({
      error: { message: `Proxy error: ${err.message}`, type: 'proxy_error', code: 'upstream_failure' },
    });
  }
});

router.post('/completions', async (req, res) => {
  const requestId = `cmpl-${uuidv4().replace(/-/g, '').slice(0, 24)}`;
  try {
    const result = await proxyRequest(req, '/completions');
    if (result.streaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      result.response.data.pipe(res);
      result.response.data.on('error', () => res.end());
      req.on('close', () => result.response.data.destroy());
      return;
    }
    res.setHeader('X-Proxy-Provider', result.provider);
    res.status(result.status).json(result.data);
  } catch (err) {
    store.incrementStats(0, true);
    res.status(502).json({ error: { message: `Proxy error: ${err.message}`, type: 'proxy_error' } });
  }
});

router.post('/embeddings', async (req, res) => {
  try {
    const result = await proxyRequest(req, '/embeddings');
    res.setHeader('X-Proxy-Provider', result.provider);
    res.status(result.status).json(result.data);
  } catch (err) {
    store.incrementStats(0, true);
    res.status(502).json({ error: { message: `Proxy error: ${err.message}`, type: 'proxy_error' } });
  }
});

router.post('/images/generations', async (req, res) => {
  try {
    const result = await proxyRequest(req, '/images/generations');
    res.setHeader('X-Proxy-Provider', result.provider);
    res.status(result.status).json(result.data);
  } catch (err) {
    store.incrementStats(0, true);
    res.status(502).json({ error: { message: `Proxy error: ${err.message}`, type: 'proxy_error' } });
  }
});

module.exports = router;
