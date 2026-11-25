# restart-dsh.ps1 — 让 DSH 自己重启一次（独立进程运行，脱离 DSH 的进程树）。
# 先尝试优雅关闭（让会话落盘），不行再强制结束，然后重新拉起。
param([int]$DelaySeconds = 120)

$ErrorActionPreference = 'SilentlyContinue'

Start-Sleep -Seconds $DelaySeconds

$exe = 'D:\Users\yunan\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe'
$name = 'DeepSeek Harness'

# 清掉计划任务残留（如曾用 schtasks 创建过）
schtasks /delete /tn 'dsh-collab-restart' /f | Out-Null

# 1) 优雅关闭主窗口
$main = Get-Process -Name $name | Where-Object { $_.MainWindowHandle -ne 0 }
foreach ($proc in $main) { $proc.CloseMainWindow() | Out-Null }
Start-Sleep -Seconds 8

# 2) 还有残留就强杀
$left = Get-Process -Name $name
if ($left) {
  foreach ($proc in $left) { Stop-Process -Id $proc.Id -Force }
  Start-Sleep -Seconds 3
}

# 3) 重新启动
if (Test-Path $exe) {
  Start-Process -FilePath $exe
}
