/**
 * Shared model catalog — single source of truth for all API endpoints
 * Used by /v1/models, /api/models, and dashboard
 */
const MODELS = [
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

module.exports = { MODELS };
