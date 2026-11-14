# 408Lab 守护脚本：进程挂了自动重启
# 用 serve.mjs 而不是直接 node server.js：serve.mjs 会先同步静态资源。
# 崩溃退避：连续 3 次以上崩溃间隔拉长到 10s，5 次以上到 30s，避免死循环刷屏。
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$env:NODE_ENV = "production"
$env:HTTPS = "false"
$env:DATABASE_URL = "file:D:/考研备考/408/zhenti/db/custom.db"

$crashes = 0
while ($true) {
    $started = Get-Date
    Write-Host "[$($started.ToString('HH:mm:ss'))] 启动 408Lab..." -ForegroundColor Cyan
    $proc = Start-Process -FilePath "node" -ArgumentList "scripts/serve.mjs" -PassThru -WindowStyle Hidden
    $proc.WaitForExit()
    $ranFor = ((Get-Date) - $started).TotalSeconds

    # 如果进程跑了超过 60 秒才退出，认为是正常停止，重置崩溃计数
    if ($ranFor -gt 60) { $crashes = 0 } else { $crashes++ }

    $delay = if ($crashes -ge 5) { 30 } elseif ($crashes -ge 3) { 10 } else { 3 }
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 进程退出(代码 $($proc.ExitCode))，${delay}秒后重启（连续崩溃 $crashes 次，运行 ${ranFor}s）..." -ForegroundColor Yellow
    Start-Sleep $delay
}
