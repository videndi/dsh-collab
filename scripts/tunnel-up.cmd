@echo off
"D:\dsh\home\profiles\desktop\node_modules\cloudflared\bin\cloudflared.exe" tunnel --url http://127.0.0.1:8790 --no-autoupdate > "D:\dsh\collab-plugin\tunnel.log" 2>&1
