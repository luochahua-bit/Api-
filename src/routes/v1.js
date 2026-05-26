const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { proxyRequest } = require('../services/proxy');
const providerManager = require('../services/provider');
const logger = require('../services/logger');
const store = require('../store');

const router = Router();

const freeModels = [
  // OpenRouter 免费模型
  { id: 'deepseek/deepseek-v4-flash:free', name: 'DeepSeek V4 Flash', provider: 'openrouter', free: true },
  { id: 'google/gemma-4-31b-it:free', name: 'Google Gemma 4 31B', provider: 'openrouter', free: true },
  { id: 'google/gemma-4-26b-a4b-it:free', name: 'Google Gemma 4 26B', provider: 'openrouter', free: true },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'NVIDIA Nemotron 3 Super 120B', provider: 'openrouter', free: true },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'NVIDIA Nemotron 3 Nano 30B', provider: 'openrouter', free: true },
  { id: 'minimax/minimax-m2.5:free', name: 'MiniMax M2.5', provider: 'openrouter', free: true },
  { id: 'poolside/laguna-m.1:free', name: 'Poolside Laguna M.1', provider: 'openrouter', free: true },
  { id: 'baidu/cobuddy:free', name: 'Baidu CoBuddy', provider: 'openrouter', free: true },
  { id: 'nousresearch/hermes-3-llama-3.1-405b:free', name: 'Hermes 3 Llama 405B', provider: 'openrouter', free: true },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', provider: 'openrouter', free: true },
  { id: 'openai/gpt-oss-120b:free', name: 'GPT-OSS 120B', provider: 'openrouter', free: true },
  { id: 'openai/gpt-oss-20b:free', name: 'GPT-OSS 20B', provider: 'openrouter', free: true },
  { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder', provider: 'openrouter', free: true },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free', name: 'Qwen3 Next 80B', provider: 'openrouter', free: true },
  { id: 'z-ai/glm-4.5-air:free', name: 'GLM 4.5 Air', provider: 'openrouter', free: true },
  // Groq 免费模型
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B (Groq)', provider: 'groq', free: true },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)', provider: 'groq', free: true },
  { id: 'llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout (Groq)', provider: 'groq', free: true },
  { id: 'qwen/qwen3-32b', name: 'Qwen3 32B (Groq)', provider: 'groq', free: true },
  // Cerebras 免费模型
  { id: 'llama3.1-8b', name: 'Llama 3.1 8B (Cerebras)', provider: 'cerebras', free: true },
  { id: 'gpt-oss-120b', name: 'GPT-OSS 120B (Cerebras)', provider: 'cerebras', free: true },
  // SambaNova 免费模型
  { id: 'DeepSeek-V3-0324', name: 'DeepSeek V3 (SambaNova)', provider: 'sambanova', free: true },
  { id: 'DeepSeek-R1-Distill-Llama-70B', name: 'DeepSeek R1 Distill 70B (SambaNova)', provider: 'sambanova', free: true },
  { id: 'Meta-Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B (SambaNova)', provider: 'sambanova', free: true },
  // Google AI Studio 免费模型
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Google)', provider: 'google', free: true },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Google)', provider: 'google', free: true },
  { id: 'gemma-3-27b-it', name: 'Gemma 3 27B (Google)', provider: 'google', free: true },
  // Mistral 免费模型
  { id: 'mistral-small-latest', name: 'Mistral Small (Mistral)', provider: 'mistral', free: true },
  { id: 'mistral-medium-latest', name: 'Mistral Medium (Mistral)', provider: 'mistral', free: true },
  { id: 'codestral-latest', name: 'Codestral (Mistral)', provider: 'mistral', free: true },
  { id: 'pixtral-large-latest', name: 'Pixtral Large (Mistral)', provider: 'mistral', free: true },
  // NVIDIA NIM 免费模型
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B (NVIDIA)', provider: 'nvidia', free: true },
  { id: 'deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Qwen 32B (NVIDIA)', provider: 'nvidia', free: true },
  // Cohere 免费模型
  { id: 'command-a-03-2025', name: 'Command A (Cohere)', provider: 'cohere', free: true },
  { id: 'command-r-plus-08-2024', name: 'Command R Plus (Cohere)', provider: 'cohere', free: true },
  { id: 'command-r-08-2024', name: 'Command R (Cohere)', provider: 'cohere', free: true },
  // GitHub Models 免费模型
  { id: 'gpt-4o', name: 'GPT-4o (GitHub)', provider: 'github', free: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini (GitHub)', provider: 'github', free: true },
  { id: 'DeepSeek-R1', name: 'DeepSeek R1 (GitHub)', provider: 'github', free: true },
  { id: 'Llama-4-Maverick-17B-128E-Instruct', name: 'Llama 4 Maverick (GitHub)', provider: 'github', free: true },
  // 付费模型
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'paid', free: false },
  { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4', provider: 'paid', free: false },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'paid', free: false },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'paid', free: false },
  { id: 'qwen-plus', name: 'Qwen Plus', provider: 'paid', free: false },
  { id: 'glm-4', name: 'GLM-4', provider: 'paid', free: false },
];

router.get('/models', (req, res) => {
  const providers = providerManager.getProvidersInfo();
  res.json({
    object: 'list',
    data: freeModels.map(m => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: m.provider,
      _free: m.free || false,
      _provider: m.provider,
    })),
    _providers: providers,
  });
});

router.post('/chat/completions', async (req, res) => {
  const requestId = `chatcmpl-${uuidv4().replace(/-/g, '').slice(0, 24)}`;
  const model = req.body?.model || 'unknown';
  const startTime = Date.now();

  try {
    const result = await proxyRequest(req, '/chat/completions');

    if (result.streaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Proxy-Provider', result.provider);
      res.setHeader('X-Request-Id', requestId);

      let tokenCount = 0;
      result.response.data.on('data', (chunk) => {
        tokenCount++;
        res.write(chunk);
      });
      result.response.data.on('end', () => {
        store.incrementStats(tokenCount);
        logger.logRequest({
          id: requestId, model, provider: result.provider,
          status: 'streaming', tokens: tokenCount, duration: result.duration,
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
