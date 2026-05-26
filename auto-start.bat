@echo off
cd /d "C:\Users\Luo\Desktop\中转站"
start /min cmd /c "node src/index.js"
timeout /t 5 /nobreak >/dev/null
start /min cmd /c "npx localtunnel --port 3000"
