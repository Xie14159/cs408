// 构建后把静态资源复制进 standalone 目录。
// 原因：`next build` 产出 .next/standalone/server.js，但它不会把 .next/static 与 public 带过去；
// 原来的 build 脚本用的是 `cp -r`（Unix 命令），在 Windows 下直接失败，导致
// 服务起来后 /_next/static/*.js 全部 404，浏览器显示 "This page couldn't load"。
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const standalone = join(root, '.next', 'standalone')

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
  mkdirSync(to, { recursive: true })
  cpSync(from, to, { recursive: true, force: true })
  console.log(`[postbuild] 已复制 -> ${to}`)
}
