@echo off
echo ========================================
echo   LLM API Relay - Render 配置助手
echo ========================================
echo.

echo [1/4] 检查 Git 状态...
cd /d "%~dp0"
git status
echo.

echo [2/4] 检查本地服务...
curl -s http://localhost:3000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ 本地服务运行正常
) else (
    echo ❌ 本地服务未运行
    echo 正在启动服务...
    start /B node src/index.js
    timeout /t 3 /nobreak >nul
)
echo.

echo [3/4] 检查公网隧道...
curl -s https://sweet-sides-knock.loca.lt/health >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ 公网隧道正常
) else (
    echo ⚠️ 公网隧道未连接
    echo 正在启动隧道...
    start /B lt --port 3000 --subdomain sweet-sides-knock
    timeout /t 5 /nobreak >nul
)
echo.

echo [4/4] 显示配置信息...
echo.
echo ========================================
echo   Render 配置信息
echo ========================================
echo.
echo GitHub 仓库: https://github.com/luochahua-bit/Api-
echo 分支: master
echo.
echo 环境变量:
echo   NODE_ENV=production
echo   ADMIN_PASSWORD=<自动生成>
echo   API_KEYS=<自动生成>
echo   CORS_ORIGIN=*
echo   RATE_LIMIT_WINDOW_MS=60000
echo   RATE_LIMIT_MAX_REQUESTS=120
echo   MAX_RETRIES=3
echo   REQUEST_TIMEOUT_MS=120000
echo   HEALTH_CHECK_INTERVAL_MS=60000
echo   MAX_LOG_ENTRIES=2000
echo.
echo Providers (需要手动配置):
echo   PROVIDERS=openrouter-free|https://openrouter.ai/api/v1|<your-key>|10|true
echo   PROVIDERS_2=groq|https://api.groq.com/openai/v1|<your-key>|8|true
echo   ... (详见 RENDER_SETUP.md)
echo.
echo ========================================
echo   下一步操作
echo ========================================
echo.
echo 1. 访问 https://dashboard.render.com
echo 2. 创建新的 Web Service
echo 3. 连接 GitHub 仓库: luochahua-bit/Api-
echo 4. 配置环境变量（见上方）
echo 5. 点击部署
echo.
echo 详细说明请查看: RENDER_SETUP.md
echo.
pause
