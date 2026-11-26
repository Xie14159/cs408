# 408Lab 启动脚本（Windows）
# 用法：右键"使用 PowerShell 运行"或在此目录执行 .\start.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$env:NODE_ENV = "production"
$env:PORT = "3000"
# 本地 HTTP 部署，显式声明非 HTTPS（auth.ts 中 secure = NODE_ENV=production 且 HTTPS=true 才为 true）
$env:HTTPS = "false"
$env:DATABASE_URL = "file:D:/考研备考/408/zhenti/db/custom.db"

$logDir = Join-Path $root "logs"
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir "start.log"

# 从快捷方式（wscript 隐藏窗口）启动时，PATH 可能和终端不一致；显式解析 node 绝对路径。
# 优先固定 nvm4w 的安装路径，避免误用 Agent 沙箱里临时的 node。
$node = $null
foreach ($candidate in @(
    "C:\nvm4w\nodejs\node.exe",
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe")
)) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { $node = $candidate; break }
}
if (-not $node) {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
}
if (-not $node) {
    "[$(Get-Date -Format s)] 未找到 node.exe，请检查 Node.js 安装或 PATH" | Out-File -LiteralPath $log -Append -Encoding UTF8
    exit 1
}

if (-not (Test-Path -LiteralPath ".next\standalone\server.js")) {
    "[$(Get-Date -Format s)] 未找到 .next\standalone\server.js，请先构建：npm run build" | Out-File -LiteralPath $log -Append -Encoding UTF8
    Write-Host "未找到 .next\standalone\server.js，请先构建：npm run build（或参考 README）" -ForegroundColor Red
    exit 1
}
"[$(Get-Date -Format s)] 408Lab 启动 root=$root node=$node" | Out-File -LiteralPath $log -Append -Encoding UTF8
Write-Host "408Lab 启动中... http://localhost:3000 （Ctrl+C 停止）" -ForegroundColor Green
# 必须走 serve.mjs：它会先同步静态资源（.next/static、public）再拉起 standalone server。
# 直接 node server.js 会在 rebuild 后缺静态文件，页面变成裸 HTML。
& $node scripts/serve.mjs *>> $log