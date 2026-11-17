// 生产启动器：先自检/自愈静态资源，再拉起 standalone server。
//
// 为什么需要它：`next build` 产出 .next/standalone/server.js，但不会把
// .next/static 与 public 带进去。少了这两份，页面能返回 200，但
// /_next/static/*.css|js 全部 404 —— 浏览器里就是"裸 HTML、没有样式"。
// 而已经跑着的 server 即使补了文件也仍然 404，必须重启。
//
// 所以：补文件 + 重启 必须是同一个动作，不能靠人记。
//
// 用法：
//   node scripts/serve.mjs            启动（端口被占则直接报错退出）
//   node scripts/serve.mjs --restart  先杀掉占用端口的进程再启动
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync, readdirSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(process.cwd())
const nextDir = join(root, '.next')
const standalone = join(nextDir, 'standalone')
const serverJs = join(standalone, 'server.js')
const PORT = Number(process.env.PORT || 3000)
const restart = process.argv.includes('--restart')

/** 目录/文件的最新修改时间；不存在返回 0 */
function mtime(p) {
  try {
    if (statSync(p).isDirectory()) {
      let newest = 0
      const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const f = join(dir, e.name)
          if (e.isDirectory()) walk(f)
          else newest = Math.max(newest, statSync(f).mtimeMs)
        }
      }
      walk(p)
      return newest
    }
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}

function copyDir(from, to) {
  // 自愈：如果目标路径上是个 stale file（历史上 ENOTDIR 崩过），先删掉再建目录
  if (existsSync(to) && statSync(to).isFile()) unlinkSync(to)
  mkdirSync(to, { recursive: true })
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const s = join(from, e.name)
    const d = join(to, e.name)
    if (e.isDirectory()) copyDir(s, d)
    else copyFileSync(s, d)
  }
}

function syncAssets() {
  const pairs = [
    [join(nextDir, 'static'), join(standalone, '.next', 'static')],
    [join(root, 'public'), join(standalone, 'public')],
  ]
  for (const [from, to] of pairs) {
    if (!existsSync(from)) continue
    // 无条件覆盖复制（幂等）。
    // 不用 mtime 判断：源目录里删掉的文件不会让 mtime 变新，旧文件会残留在 standalone；
    // 而构建/复制间隔小于 1s 时容差又会让新文件被判为"不新"，反而漏同步。
    copyDir(from, to)
    console.log(`[serve] 已同步 ${to}`)
  }
}

function portPid(port) {
  try {
    // 不用裸 netstat / powershell：本机这些命令不在 PATH 里（execSync 走 cmd.exe 会失败），
    // 直接用 System32 绝对路径，避免重启时查不到旧进程、报 EADDRINUSE。
    const sysRoot = process.env.SystemRoot || 'C:\\Windows'
    const netstat = join(sysRoot, 'System32', 'netstat.exe')
    const out = execSync(`"${netstat}" -ano`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const re = new RegExp(`:${port}\\s`)
    const lines = out.split(/\r?\n/).filter((l) => l.includes('LISTENING') && re.test(l))
    if (!lines.length) return null
    const cols = lines[0].trim().split(/\s+/)
    return Number(cols[cols.length - 1]) || null
  } catch {
    return null
  }
}

if (!existsSync(serverJs)) {
  console.error('[serve] 找不到 .next/standalone/server.js，请先执行：npm run build')
  process.exit(1)
}

syncAssets()

const busy = portPid(PORT)
if (busy) {
  if (!restart) {
    console.error(
      `[serve] 端口 ${PORT} 已被 pid=${busy} 占用。\n` +
        `         要替换成新构建，请用：node scripts/serve.mjs --restart`
    )
    process.exit(1)
  }
  console.log(`[serve] 结束旧进程 pid=${busy}`)
  try {
    const sysRoot = process.env.SystemRoot || 'C:\\Windows'
    execSync(`"${join(sysRoot, 'System32', 'taskkill.exe')}" /PID ${busy} /T /F`, { stdio: 'ignore' })
  } catch {}
  // 等端口释放（portPid 每次要跑一次 netstat，本身就是天然延时）
  const t0 = Date.now()
  while (portPid(PORT) && Date.now() - t0 < 8000) {
    /* busy wait */
  }
}

const env = {
  ...process.env,
  NODE_ENV: 'production',
  HTTPS: 'false',
  PORT: String(PORT),
  // standalone 的 server.js 会 chdir 到 .next/standalone，API 落盘要靠这个锚回项目根
  PROJECT_ROOT: root,
  DATABASE_URL:
    process.env.DATABASE_URL || 'file:' + join(root, 'db', 'custom.db').replace(/\\/g, '/'),
}

console.log(`[serve] 启动 http://localhost:${PORT}  (cwd=${root})`)
const child = spawn(process.execPath, [serverJs], {
  cwd: root,
  env,
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig))
}
