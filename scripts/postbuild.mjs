// 构建后把静态资源复制进 standalone 目录。
// 原因：`next build` 产出 .next/standalone/server.js，但它不会把 .next/static 与 public 带过去；
// 原来的 build 脚本用的是 `cp -r`（Unix 命令），在 Windows 下直接失败，导致
// 服务起来后 /_next/static/*.js 全部 404，浏览器显示 "This page couldn't load"。
//
// 注意：不要用 fs.cpSync({recursive:true})——Node 22 在 Windows 上递归复制时会
// 直接崩进程（STATUS_STACK_BUFFER_OVERRUN），而且崩之前只建了空目录，看起来像成功。
// 这里改成逐文件递归复制，路径可控、失败点明确。
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const standalone = join(root, '.next', 'standalone')

function copyDir(from, to) {
  mkdirSync(to, { recursive: true })
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, e.name)
    const dst = join(to, e.name)
    if (e.isDirectory()) copyDir(src, dst)
    else copyFileSync(src, dst)
  }
}

if (!existsSync(standalone)) {
  console.log('[postbuild] 未找到 .next/standalone，跳过（非 standalone 构建）')
  process.exit(0)
}

const copies = [
  [join(root, '.next', 'static'), join(standalone, '.next', 'static')],
  [join(root, 'public'), join(standalone, 'public')],
]

for (const [from, to] of copies) {
  if (!existsSync(from)) {
    console.log(`[postbuild] 跳过（源不存在）：${from}`)
    continue
  }
  copyDir(from, to)
  console.log(`[postbuild] 已复制 -> ${to}`)
}
