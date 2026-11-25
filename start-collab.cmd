@echo off
chcp 65001 >nul
title dsh-collab 协作服务
setlocal
set "NODE=D:\Work Buddy\_archive\_tools\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
set "ROOT=D:\dsh\collab-plugin"

echo ============================================
echo  dsh-collab 协作服务
echo  中继：http://10.10.22.81:8790/dsh-collab/relay
echo  自检：http://10.10.22.81:8790/dsh-collab/status
echo  关掉这个窗口就停止（房间数据已落盘，下次还在）
echo ============================================
echo.

start "dsh-collab relay" cmd /c ""%NODE%" "%ROOT%\scripts\relay-server.mjs" --port 8790 --host 0.0.0.0 --rooms 32 & pause"
timeout /t 2 >nul
start "dsh-collab tunnel" cmd /c ""%NODE%" "%ROOT%\scripts\tunnel-host.mjs" --port 8790 & pause"

echo 已启动两个窗口：relay / tunnel。等 3 秒做自检…
timeout /t 3 >nul
powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:8790/dsh-collab/relay/health' -TimeoutSec 5 -UseBasicParsing).Content } catch { 'relay 还没起来：看 relay 窗口的报错' }"
echo.
echo 隧道地址（公网，可能被某些网络拦）：
powershell -NoProfile -Command "if (Test-Path '%ROOT%\tunnel.log') { (Select-String -Path '%ROOT%\tunnel.log' -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -Last 1).Matches.Value } else { '（隧道日志还没生成）' }"
echo.
pause
