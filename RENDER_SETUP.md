# Render 部署配置指南

## 当前状态
- ✅ GitHub 代码已推送
- ✅ render.yaml 已配置
- ⚠️ 需要在 Render Dashboard 手动配置环境变量

## 配置步骤

### 1. 登录 Render Dashboard
访问 https://dashboard.render.com 并登录

### 2. 创建新的 Web Service
1. 点击 "New +" 按钮
2. 选择 "Web Service"
3. 连接 GitHub 仓库: `luochahua-bit/Api-`
4. 选择 "master" 分支

### 3. 配置服务
- **Name**: `llm-api-relay`
- **Runtime**: `Node`
- **Build Command**: `npm ci --production`
- **Start Command**: `node src/index.js`
- **Plan**: `Free`

### 4. 配置环境变量
在 "Environment" 部分添加以下变量:

```
NODE_ENV=production
ADMIN_PASSWORD=<your-admin-password>
API_KEYS=<your-api-keys>
CORS_ORIGIN=*
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=120
MAX_RETRIES=3
REQUEST_TIMEOUT_MS=120000
HEALTH_CHECK_INTERVAL_MS=60000
MAX_LOG_ENTRIES=2000
```

### 5. 配置 Providers
添加以下环境变量（每个提供商一行）:

```
PROVIDERS=openrouter-free|https://openrouter.ai/api/v1|<your-openrouter-key>|10|true
PROVIDERS_2=groq|https://api.groq.com/openai/v1|<your-groq-key>|8|true
PROVIDERS_3=cerebras|https://api.cerebras.ai/v1|<your-cerebras-key>|7|true
PROVIDERS_4=sambanova|https://api.sambanova.ai/v1|<your-sambanova-key>|6|true
PROVIDERS_5=google-ai|https://generativelanguage.googleapis.com/v1beta/openai|<your-google-key>|5|true
PROVIDERS_6=mistral|https://api.mistral.ai/v1|<your-mistral-key>|5|true
PROVIDERS_7=github-models|https://models.inference.ai.azure.com|<your-github-token>|4|true
PROVIDERS_8=nvidia-nim|https://integrate.api.nvidia.com/v1|<your-nvidia-key>|4|true
PROVIDERS_9=cohere|https://api.cohere.com/compatibility/v1|<your-cohere-key>|3|true
PROVIDERS_10=haoyongai|https://www.haoyongai.xyz/v1|<your-haoyongai-key>|3|true
PROVIDERS_11=4sapi|https://new-api.4sapi.com/v1|<your-4sapi-key>|2|true
```

### 6. 部署
点击 "Create Web Service" 按钮开始部署

## 免费 API Key 获取

### OpenRouter (推荐)
1. 访问 https://openrouter.ai
2. 注册账号
3. 进入 https://openrouter.ai/keys
4. 创建新的 API Key

### Groq
1. 访问 https://console.groq.com
2. 注册账号
3. 创建 API Key

### Cerebras
1. 访问 https://cloud.cerebras.ai
2. 注册账号
3. 创建 API Key

### SambaNova
1. 访问 https://cloud.sambanova.ai
2. 注册账号
3. 创建 API Key

### Google AI Studio
1. 访问 https://aistudio.google.com
2. 使用 Google 账号登录
3. 创建 API Key

### Mistral
1. 访问 https://console.mistral.ai
2. 注册账号
3. 创建 API Key

### GitHub Models
1. 访问 https://github.com/marketplace/models
2. 使用 GitHub 账号登录
3. 创建 Personal Access Token

### NVIDIA NIM
1. 访问 https://build.nvidia.com
2. 注册账号
3. 创建 API Key

### Cohere
1. 访问 https://cohere.com
2. 注册账号
3. 创建 API Key

## 验证部署

部署完成后，访问以下地址验证:
- 主页: `https://llm-api-relay.onrender.com`
- 健康检查: `https://llm-api-relay.onrender.com/health`
- 管理后台: `https://llm-api-relay.onrender.com/admin`
- API 测试: `https://llm-api-relay.onrender.com/v1/models`

## 本地测试

本地服务仍在运行在 `http://localhost:3000`

测试命令:
```bash
# 健康检查
curl http://localhost:3000/health

# 获取模型列表
curl http://localhost:3000/v1/models

# 测试聊天
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-fc580aaf37b3f8a908a864d95c40688da675b3b1c32c45e0" \
  -d '{
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## 故障排除

### 问题: 部署失败
- 检查 Render 日志
- 确保所有环境变量已正确配置
- 确保 Node.js 版本 >= 18

### 问题: API 调用失败
- 检查 API Key 是否有效
- 检查提供商是否健康（访问 /health）
- 检查网络连接

### 问题: 管理后台无法访问
- 检查 ADMIN_PASSWORD 是否设置
- 检查 IP 白名单配置（如有）

## 下一步

1. 配置自定义域名（可选）
2. 设置自动部署（GitHub webhook）
3. 监控服务状态
4. 优化性能和成本
