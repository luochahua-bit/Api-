# Changelog

## [2.1.0] - 2026-05-28

### Added
- `src/utils/emailValidator.js` — 邮箱格式校验 + 临时邮箱域名拦截
- `src/utils/freeKeyManager.js` — 免费 Key 生成 + 每日限额管理
- `src/data/models.js` — 共享模型目录，消除 3 处重复定义
- `src/tasks.js` — 任务系统（7 个任务，免费币奖励）
- **注册自动发放免费 API Key**（`sk-free-` 前缀，50 次/天，40 个免费模型）
- **双金币体系**：免费币（做任务获得，不可提现）+ 付费币（充值获得，可提现）
- 消费优先扣免费币，不够再扣付费币
- 7 个任务：每日签到(5)、完善资料(20)、首次购买(30)、首次上架(20)、邀请好友(50)、评价订单(5)、七日活跃(50)
- 邀请码系统（邀请人得 50 币，被邀请人得 30 币）
- **数据安全**：原子写入（temp + rename）、每小时定时备份（保留 10 份）、损坏自动从备份恢复
- **启动安全检查**：检测 ADMIN_PASSWORD、JWT_SECRET、MARKET_ENCRYPT_KEY、SMTP 是否为默认值
- **前端 XSS 修复**：dashboard.html 10 处 + marketplace.html 2 处，共 12 处 innerHTML 加转义
- 免费 Key 每日限额检查（超限返回 429 + 重置时间）
- `/v1/models` 对免费 Key 只返回免费模型
- `/v1/chat/completions` 对免费 Key 校验模型是否免费
- 响应头 `X-Free-Remaining` 告知剩余免费次数
- Admin 登录限频（5次/分钟/IP），防暴力破解
- `sendCodeLimiter` 定期清理（每5分钟），修复内存泄漏
- `trust proxy` 设置，确保 `req.ip` 返回真实客户端 IP
- CORS 支持多域名配置（逗号分隔）
- `CHANGELOG.md` 更新日志

### Fixed
- 邮箱注册无格式校验 — 任意字符串都能作为"邮箱"提交
- 邮箱大小写不一致 — `User@QQ.COM` 和 `user@qq.com` 会注册出两个号
- `sendCodeLimiter` 对象从不清理，长期运行内存持续增长
- Admin 登录 `/api/admin/login` 无任何限频，可被暴力破解
- `req.ip` 在 Render 反向代理后拿到的是代理 IP 而非真实 IP
- `CORS_ORIGIN` 在 render.yaml 中设为 `*`，任何网站都能调用 API

### Changed
- 免费模型列表从 `v1.js` 和 `index.js` 内联定义抽取到 `src/data/models.js` 单一数据源
- `send-code`、`verify-email`、`register` 三个端点增加邮箱格式校验守卫
- `middleware/auth.js` 支持免费 Key 识别 + 每日限频
- 注册响应新增 `freeApiKey` 和 `freeDailyLimit` 字段
- 所有邮箱存储统一转小写归一化
- `render.yaml` CORS_ORIGIN 改为 `https://llm-api-relay.onrender.com`
- CORS 逻辑支持逗号分隔的多域名

### Security
- 临时邮箱（mailinator、guerrillamail 等 20+ 域名）被拦截注册
- Admin 登录暴力破解窗口从无限降到 5 次/分钟

### Pending（需用户手动操作）
- Render 上配置 SMTP 环境变量（否则邮箱验证码只打印到控制台）
- 确认 ENCRYPTION_KEY、JWT_SECRET、ADMIN_PASSWORD 环境变量已设
- 接入 Cloudflare 防 DNS 攻击
- 后续有新域名需在 CORS_ORIGIN 中添加

---

## [2.0.0] - 2026-05-27

### Added
- 邮箱验证码注册（send-code → verify-email → register）
- QQ 邮箱 SMTP 支持（nodemailer）
- 模拟支付系统（充值订单 + 模拟支付回调）
- 金币兑换码系统（管理员生成 → 用户兑换）
- 提现申请系统（用户申请 → 管理员审核）
- 分层平台服务费（1% / 5% / 10%）
- 手续费抵扣券（feeCredits）
- 模型验证系统（验证卖家声称的模型是否真实存在）
- 模型身份验证（测试请求检查返回的模型名）
- API Key 轮换（卖家更换上游 Key，买家代理 Key 自动跟随）
- 独占/共享购买模式
- 安全响应扫描（XSS/钓鱼/注入检测）
- 流式响应安全过滤
- 安全事件日志
- Dockerfile + docker-compose
- nginx 配置（SSL、rate limit、路径屏蔽）
- 自 ping 防 Render 休眠

### Fixed
- `processPayment` 未定义导致非流式请求崩溃
- Admin 路由无认证
- 注册可随意修改 role 字段（角色提权）

---

## [1.0.0] - 初始版本

### Features
- OpenAI 兼容 API 中转
- 多 Provider 负载均衡（加权选择）
- 熔断器（连续失败自动暂停）
- Dashboard 管理面板
- API Key 管理
- 请求日志
- 健康检查
- 速率限制
