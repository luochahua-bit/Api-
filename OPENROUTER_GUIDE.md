# OpenRouter API Key 获取指南

## 当前状态
- ✅ OpenRouter 网站可访问
- ✅ 有 27 个免费模型可用
- ⚠️ 需要注册账号获取 API Key

## 免费模型列表

以下是 OpenRouter 提供的免费模型（部分）:

| 模型 ID | 名称 | 说明 |
|---------|------|------|
| `deepseek/deepseek-v4-flash:free` | DeepSeek V4 Flash | 免费，高性能 |
| `google/gemma-4-26b-a4b-it:free` | Google Gemma 4 26B | 免费，Google 模型 |
| `google/gemma-4-31b-it:free` | Google Gemma 4 31B | 免费，Google 模型 |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | NVIDIA Nemotron 3 | 免费，NVIDIA 模型 |
| `poolside/laguna-xs.2:free` | Poolside Laguna XS.2 | 免费 |
| `poolside/laguna-m.1:free` | Poolside Laguna M.1 | 免费 |
| `baidu/cobuddy:free` | Baidu CoBuddy | 免费，百度模型 |
| `openrouter/owl-alpha` | Owl Alpha | 免费 |

## 获取 API Key 步骤

### 方法 1: 网页注册（推荐）

1. **访问 OpenRouter 网站**
   - 打开浏览器，访问: https://openrouter.ai

2. **注册账号**
   - 点击右上角 "Sign Up" 按钮
   - 可以使用 Google、GitHub 或邮箱注册
   - 推荐使用 GitHub 账号（方便后续管理）

3. **登录后获取 API Key**
   - 登录后，访问: https://openrouter.ai/keys
   - 点击 "Create Key" 按钮
   - 输入 Key 名称（如 "my-api-relay"）
   - 点击 "Create" 生成 API Key

4. **复制 API Key**
   - 生成的 API Key 格式: `sk-or-v1-xxxxxxxxxxxx`
   - **重要**: 立即复制并保存，离开页面后无法再次查看

### 方法 2: 使用 GitHub OAuth（高级）

如果你有 GitHub 账号，可以使用 OAuth 流程:

```bash
# 1. 访问授权页面
https://openrouter.ai/auth/github

# 2. 授权后会跳转到你的 dashboard
# 3. 在 Keys 页面创建 API Key
```

## 配置 API Key

### 本地配置

编辑 `C:\Users\Luo\Desktop\中转站\.env` 文件:

```bash
# 将 your-openrouter-key 替换为你的 API Key
PROVIDERS=openrouter-free|https://openrouter.ai/api/v1|sk-or-v1-你的实际key|10|true
```

### Render 配置

在 Render Dashboard 的环境变量中:

```
PROVIDERS=openrouter-free|https://openrouter.ai/api/v1|sk-or-v1-你的实际key|10|true
```

## 测试 API Key

### 1. 测试连接

```bash
curl https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer sk-or-v1-你的key"
```

### 2. 测试聊天

```bash
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-or-v1-你的key" \
  -d '{
    "model": "deepseek/deepseek-v4-flash:free",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### 3. 通过中转站测试

```bash
# 本地测试
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-fc580aaf37b3f8a908a864d95c40688da675b3b1c32c45e0" \
  -d '{
    "model": "deepseek/deepseek-v4-flash:free",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## 免费额度说明

OpenRouter 免费模型的特点:
- ✅ 无需付费
- ✅ 无请求限制（但有速率限制）
- ✅ 支持多种模型
- ⚠️ 响应速度可能较慢
- ⚠️ 不支持所有功能（如 function calling）

## 常见问题

### Q: API Key 无效？
- 检查 Key 是否正确复制（以 `sk-or-v1-` 开头）
- 确认 Key 是否已激活（新 Key 可能需要几分钟）

### Q: 请求被拒绝？
- 检查是否使用了免费模型（以 `:free` 结尾）
- 确认账户是否有足够的额度

### Q: 响应速度慢？
- 免费模型可能有排队机制
- 尝试使用不同的免费模型
- 考虑升级到付费模型

## 下一步

1. 按照上述步骤获取 API Key
2. 配置到本地 `.env` 文件
3. 测试 API 功能
4. 配置到 Render 环境变量
5. 部署到生产环境

## 相关链接

- OpenRouter 官网: https://openrouter.ai
- API 文档: https://openrouter.ai/docs
- 免费模型列表: https://openrouter.ai/models?max_price=0
- API Key 管理: https://openrouter.ai/keys
