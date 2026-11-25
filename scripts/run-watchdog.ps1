# run-watchdog.ps1 — 中继与公网隧道的看护进程（隐藏窗口常驻，登录自启）。
# 每 60 秒检查一次：node 跑着 relay-server 吗？cloudflared 在吗？不在就拉起来。
$ErrorActionPreference = 'SilentlyContinue'

$node = 'D:\Work Buddy\_archive\_tools\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node).Source }

$relayScript = 'D:\dsh\collab-plugin\scripts\relay-server.mjs'
$tunnelScript = 'D:\dsh\collab-plugin\scripts\tunnel-host.mjs'
$log = 'D:\dsh\collab-plugin\watchdog.log'

function Write-Log($message) {
  try {
    Add-Content -Path $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $message) -ErrorAction SilentlyContinue
  } catch { }
}

Write-Log 'watchdog started'

while ($true) {
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
  $relay = $procs | Where-Object { $_.CommandLine -like '*relay-server*' }
  if (-not $relay) {
    Start-Process -FilePath $node -ArgumentList ('"' + $relayScript + '" --port 8790 --host 0.0.0.0 --rooms 32') -WindowStyle Hidden
    Write-Log 'relay restarted'
  }

  $cf = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'"
  if (-not $cf) {
    Start-Process -FilePath $node -ArgumentList ('"' + $tunnelScript + '" --port 8790') -WindowStyle Hidden
    Write-Log 'tunnel restarted'
  }

  Start-Sleep -Seconds 60
}
