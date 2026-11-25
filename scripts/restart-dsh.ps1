# restart-dsh.ps1 — 重启 DSH 并写日志到 restart.log（便于确认到底有没有执行）。
param([int]$DelaySeconds = 45)

$log = 'D:\dsh\collab-plugin\restart.log'
function L($m) {
  try { Add-Content -Path $log -Value ((Get-Date -Format 'HH:mm:ss') + ' ' + $m) } catch { }
}

L "scheduled (delay=${DelaySeconds}s)"
Start-Sleep -Seconds $DelaySeconds
L 'wake up'

$exe = 'D:\Users\yunan\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe'
$name = 'DeepSeek Harness'

$main = Get-Process -Name $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
L ("main windows=" + (@($main).Count))
foreach ($p in @($main)) { try { $p.CloseMainWindow() | Out-Null } catch { } }

Start-Sleep -Seconds 8
$left = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
L ("processes left=" + $left.Count)
if ($left.Count -gt 0) {
  foreach ($p in $left) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { } }
  Start-Sleep -Seconds 3
}

if (Test-Path $exe) {
  L "starting $exe"
  Start-Process -FilePath $exe
  L 'started'
} else {
  L "EXE NOT FOUND: $exe"
}
