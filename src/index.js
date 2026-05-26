const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const auth = require('./middleware/auth');
const adminAuth = require('./middleware/adminAuth');
const rateLimit = require('./middleware/rateLimit');
const { securityHeaders, adminIpWhitelist, auditLog } = require('./middleware/security');
const v1Routes = require('./routes/v1');
const adminRoutes = require('./routes/admin');
const providerManager = require('./services/provider');
const store = require('./store');
const healthCheck = require('./services/healthCheck');

const app = express();

// Security middleware
app.use(securityHeaders);
app.use(auditLog);

// CORS - restrict in production
const corsOptions = process.env.NODE_ENV === 'production'
  ? { origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }
  : {};
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));

// Dashboard
const dashboardHtml = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
app.get('/', (req, res) => {
  res.type('html').send(dashboardHtml);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', providers: providerManager.getProvidersInfo() });
});

// Public stats for dashboard
app.get('/api/stats', (req, res) => {
  const stats = store.getStats();
  const providers = providerManager.getProvidersInfo();
  const logs = store.getLogs(50);
  const avgLatency = providers.reduce((sum, p) => sum + (p.health?.latency || 0), 0) / (providers.length || 1);
  res.json({
    ...stats,
    uptime: Math.floor((Date.now() - stats.startTime) / 1000),
    providers,
    logs,
    avgLatency: Math.round(avgLatency),
  });
});

// Public models
app.get('/api/models', (req, res) => {
  const freeModels = [
    // OpenRouter 免费模型
    { id: 'deepseek/deepseek-v4-flash:free', name: 'DeepSeek V4 Flash', free: true, provider: 'openrouter' },
    { id: 'google/gemma-4-31b-it:free', name: 'Google Gemma 4 31B', free: true, provider: 'openrouter' },
    { id: 'google/gemma-4-26b-a4b-it:free', name: 'Google Gemma 4 26B', free: true, provider: 'openrouter' },
    { id: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'NVIDIA Nemotron 3 Super 120B', free: true, provider: 'openrouter' },
    { id: 'nvidia/nemotron-3-nano-30b-a3b:free', name: 'NVIDIA Nemotron 3 Nano 30B', free: true, provider: 'openrouter' },
    { id: 'minimax/minimax-m2.5:free', name: 'MiniMax M2.5', free: true, provider: 'openrouter' },
    { id: 'poolside/laguna-m.1:free', name: 'Poolside Laguna M.1', free: true, provider: 'openrouter' },
    { id: 'baidu/cobuddy:free', name: 'Baidu CoBuddy', free: true, provider: 'openrouter' },
    { id: 'nousresearch/hermes-3-llama-3.1-405b:free', name: 'Hermes 3 Llama 405B', free: true, provider: 'openrouter' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', free: true, provider: 'openrouter' },
    { id: 'openai/gpt-oss-120b:free', name: 'GPT-OSS 120B', free: true, provider: 'openrouter' },
    { id: 'openai/gpt-oss-20b:free', name: 'GPT-OSS 20B', free: true, provider: 'openrouter' },
    { id: 'qwen/qwen3-coder:free', name: 'Qwen3 Coder', free: true, provider: 'openrouter' },
    { id: 'qwen/qwen3-next-80b-a3b-instruct:free', name: 'Qwen3 Next 80B', free: true, provider: 'openrouter' },
    { id: 'z-ai/glm-4.5-air:free', name: 'GLM 4.5 Air', free: true, provider: 'openrouter' },
    // Groq 免费模型
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B (Groq)', free: true, provider: 'groq' },
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)', free: true, provider: 'groq' },
    { id: 'llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout (Groq)', free: true, provider: 'groq' },
    { id: 'qwen/qwen3-32b', name: 'Qwen3 32B (Groq)', free: true, provider: 'groq' },
    // Cerebras 免费模型
    { id: 'llama3.1-8b', name: 'Llama 3.1 8B (Cerebras)', free: true, provider: 'cerebras' },
    { id: 'gpt-oss-120b', name: 'GPT-OSS 120B (Cerebras)', free: true, provider: 'cerebras' },
    // SambaNova 免费模型
    { id: 'DeepSeek-V3-0324', name: 'DeepSeek V3 (SambaNova)', free: true, provider: 'sambanova' },
    { id: 'DeepSeek-R1-Distill-Llama-70B', name: 'DeepSeek R1 Distill 70B (SambaNova)', free: true, provider: 'sambanova' },
    { id: 'Meta-Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B (SambaNova)', free: true, provider: 'sambanova' },
    // Google AI Studio 免费模型
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Google)', free: true, provider: 'google' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Google)', free: true, provider: 'google' },
    { id: 'gemma-3-27b-it', name: 'Gemma 3 27B (Google)', free: true, provider: 'google' },
    // Mistral 免费模型
    { id: 'mistral-small-latest', name: 'Mistral Small (Mistral)', free: true, provider: 'mistral' },
    { id: 'mistral-medium-latest', name: 'Mistral Medium (Mistral)', free: true, provider: 'mistral' },
    { id: 'codestral-latest', name: 'Codestral (Mistral)', free: true, provider: 'mistral' },
    { id: 'pixtral-large-latest', name: 'Pixtral Large (Mistral)', free: true, provider: 'mistral' },
    // NVIDIA NIM 免费模型
    { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B (NVIDIA)', free: true, provider: 'nvidia' },
    { id: 'deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Qwen 32B (NVIDIA)', free: true, provider: 'nvidia' },
    // Cohere 免费模型
    { id: 'command-a-03-2025', name: 'Command A (Cohere)', free: true, provider: 'cohere' },
    { id: 'command-r-plus-08-2024', name: 'Command R Plus (Cohere)', free: true, provider: 'cohere' },
    { id: 'command-r-08-2024', name: 'Command R (Cohere)', free: true, provider: 'cohere' },
    // GitHub Models 免费模型
    { id: 'gpt-4o', name: 'GPT-4o (GitHub)', free: true, provider: 'github' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (GitHub)', free: true, provider: 'github' },
    { id: 'DeepSeek-R1', name: 'DeepSeek R1 (GitHub)', free: true, provider: 'github' },
    { id: 'Llama-4-Maverick-17B-128E-Instruct', name: 'Llama 4 Maverick (GitHub)', free: true, provider: 'github' },
    // 付费模型
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', free: false, provider: 'paid' },
    { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4', free: false, provider: 'paid' },
    { id: 'deepseek-chat', name: 'DeepSeek Chat', free: false, provider: 'paid' },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', free: false, provider: 'paid' },
    { id: 'qwen-plus', name: 'Qwen Plus', free: false, provider: 'paid' },
    { id: 'glm-4', name: 'GLM-4', free: false, provider: 'paid' },
  ];
  res.json({ object: 'list', data: freeModels });
});

// API routes
app.use('/v1', auth, rateLimit, v1Routes);

// Admin routes (with IP whitelist in production)
app.use('/api/admin', adminIpWhitelist, adminAuth, adminRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: { message: 'Not found', type: 'invalid_request_error' } });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: { message: 'Internal server error', type: 'server_error' } });
});

app.listen(config.port, () => {
  console.log('');
  console.log('========================================');
  console.log('  LLM API Relay Station v2.0');
  console.log('========================================');
  console.log(`  Port: ${config.port}`);
  console.log(`  Dashboard: http://localhost:${config.port}`);
  console.log(`  Admin Password: ${config.adminPassword}`);
  console.log(`  Providers: ${store.getProviders().map(p => p.name).join(', ') || 'none'}`);
  console.log(`  API Keys: ${store.getApiKeys().length}`);
  console.log('========================================');
  console.log('');

  healthCheck.start();
});
