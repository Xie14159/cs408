# 408Lab 启动脚本（Windows）
# 用法：右键"使用 PowerShell 运行"或在此目录执行 .\start.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$env:NODE_ENV = "production"
# 本地 HTTP 部署，显式声明非 HTTPS（auth.ts 中 secure = NODE_ENV=production 且 HTTPS=true 才为 true）
$env:HTTPS = "false"
$env:DATABASE_URL = "file:D:/考研备考/408/zhenti/db/custom.db"

if (-not (Test-Path -LiteralPath ".next\standalone\server.js")) {
    Write-Host "未找到 .next\standalone\server.js，请先构建：npm run build（或参考 README）" -ForegroundColor Red
    exit 1
}
Write-Host "408Lab 启动中... http://localhost:3000 （Ctrl+C 停止）" -ForegroundColor Green
node .next\standalone\server.js