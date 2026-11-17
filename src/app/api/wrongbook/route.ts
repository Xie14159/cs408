import { NextResponse } from 'next/server'
import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 错题本落盘接口：把浏览器 localStorage 里的错题导出成磁盘文件，
 * 好让本机上的其它工具（例如豆包）直接读，不用手动下载。
 *
 *   POST /api/wrongbook            写入 exports/wrongbook_latest.json + .md（+ 当日快照）
 *   POST /api/wrongbook?name=xxx   写入指定文件名（自测用，避免覆盖正式数据）
 *   GET  /api/wrongbook            读出最新一份（方便 curl / 其它脚本直接取）
 *
 * 数据由前端构造（前端才有 QUESTION_MAP 的完整题干与解析），
 * 本接口只做校验 + 落盘，不碰 localStorage、不写数据库。
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 12 * 1024 * 1024 // 12MB，正常错题本约 100~300KB
const KEEP_SNAPSHOTS = 24 // 每小时一份，留一天

interface ExportItem {
  qid?: string
  status?: string
  year?: number
  number?: number
  subjectName?: string
  type?: string
  topic?: string
  difficulty?: string
  wrong?: number
  correct?: number
  attempts?: number
  lastAtISO?: string
  answer?: string
  options?: string[]
  explanation?: string
  answerText?: string
  errorTag?: string
  stage?: number | null
  nextReviewAt?: string
  question?: string
}

interface ExportPayload {
  app?: string
  version?: number
  exportedAt?: string
  timezone?: string
  summary?: { total?: number; pending?: number; mastered?: number }
  items?: ExportItem[]
}

/**
 * 项目根目录。
 * 注意：standalone 的 server.js 会 `process.chdir(__dirname)`，所以运行时的 cwd 是
 * `.next/standalone`，不是项目根。落盘必须锚在项目根，否则文件会写进 .next 里被下一次构建清掉。
 * 优先用 serve.mjs 注入的 PROJECT_ROOT，其次按目录名回退两级。
 */
function projectRoot(): string {
  const env = process.env.PROJECT_ROOT
  if (env && existsSync(env)) return env
  const cwd = process.cwd()
  if (cwd.endsWith(join('.next', 'standalone'))) return join(cwd, '..', '..')
  return cwd
}

function exportsDir(): string {
  const dir = join(projectRoot(), 'exports')
  mkdirSync(dir, { recursive: true })
  return dir
}

function safeName(name: string | null): string {
  if (!name) return 'wrongbook'
  const cleaned = name.replace(/[^A-Za-z0-9_-]/g, '')
  return cleaned ? `wrongbook_${cleaned}` : 'wrongbook'
}

/** 给人和 AI 读的 Markdown 摘要：先给统计，再按年份列题 */
function toMarkdown(p: ExportPayload, source: string): string {
  const items = p.items ?? []
  const s = p.summary ?? {}
  const lines: string[] = []
  const byYear = new Map<number, number>()
  const bySubject = new Map<string, number>()
  const byTopic = new Map<string, number>()
  for (const it of items) {
    byYear.set(it.year ?? 0, (byYear.get(it.year ?? 0) ?? 0) + 1)
    const sub = it.subjectName || '未知'
    bySubject.set(sub, (bySubject.get(sub) ?? 0) + 1)
    const tp = it.topic || '未标注'
    byTopic.set(tp, (byTopic.get(tp) ?? 0) + 1)
  }
  const sortDesc = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1])

  lines.push('# 408Lab 错题本（自动导出）', '')
  lines.push(`- 导出时间：${p.exportedAt ?? '-'}（${p.timezone ?? '-'}）`)
  lines.push(`- 文件：\`${source}\``)
  lines.push(
    `- 合计 **${items.length}** 道：待巩固 ${s.pending ?? '-'} 道、已掌握 ${s.mastered ?? '-'} 道`,
    ''
  )
  lines.push('## 分布', '')
  lines.push(
    '| 年份 | 题数 |',
    '| --- | --- |',
    ...[...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([y, n]) => `| ${y || '未标注'} | ${n} |`),
    ''
  )
  lines.push(
    '| 科目 | 题数 |',
    '| --- | --- |',
    ...sortDesc(bySubject).map(([k, n]) => `| ${k} | ${n} |`),
    ''
  )
  lines.push(
    '| 考点 | 题数 |',
    '| --- | --- |',
    ...sortDesc(byTopic).slice(0, 30).map(([k, n]) => `| ${k} | ${n} |`),
    ''
  )

  lines.push('## 题目清单（按最近出错时间倒序）', '')
  let i = 0
  for (const it of items) {
    i += 1
    const head = `${i}. \`${it.qid}\` ${it.year ?? ''} 第${it.number ?? '?'}题 · ${it.subjectName ?? ''} · ${it.type ?? ''} · ${it.topic ?? ''}`
    lines.push(head)
    const meta = [
      `状态 ${it.status ?? '-'}`,
      `错 ${it.wrong ?? 0} 次`,
      `对 ${it.correct ?? 0} 次`,
      `错因 ${it.errorTag || '未标'}`,
      `阶段 ${it.stage ?? '-'}`,
      `下次 ${it.nextReviewAt || '-'}`,
      `最近 ${it.lastAtISO ?? '-'}`,
    ].join(' · ')
    lines.push(`   - ${meta}`)
    // 大题题干往往很长（六个小问），160 字截断后基本看不出在问什么
    const stemLimit = it.type === 'single' ? 200 : 400
    const stem = (it.question ?? '').replace(/\s+/g, ' ').slice(0, stemLimit)
    if (stem) lines.push(`   - 题干：${stem}`)
    // 单选只有答案字母 + 选项；综合题的解法在 answerText 里，必须给出来，否则 md 等于没答案
    if (it.type === 'single') {
      if (it.answer) lines.push(`   - 答案：${it.answer}`)
      if (it.options?.length) {
        const opts = (['A', 'B', 'C', 'D', 'E', 'F'] as const)
          .map((tag, idx) => (it.options?.[idx] ? `${tag}. ${it.options[idx].replace(/\s+/g, ' ').slice(0, 80)}` : ''))
          .filter(Boolean)
          .join('  ')
        if (opts) lines.push(`   - 选项：${opts}`)
      }
    } else {
      // 多小问的大题给到 800 字，够看到 (3)(4)，完整内容仍在 json
      const ref = (it.answerText ?? it.answer ?? '').replace(/\s+/g, ' ').slice(0, 800)
      if (ref) lines.push(`   - 参考答案：${ref}`)
    }
    const expl = (it.explanation ?? '').replace(/\s+/g, ' ').slice(0, 400)
    if (expl) lines.push(`   - 解析：${expl}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** 原子写：先写临时文件再 rename，进程中途被杀也不会留下半截 JSON */
function writeAtomic(file: string, content: string) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, file)
}

/** 只接受本机页面/本机脚本的写入，挡住任意网页跨站 POST 覆盖镜像 */
function isLocalOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // curl / 本机脚本没有 Origin
  try {
    const u = new URL(origin)
    const host = u.hostname
    // 同源优先：用局域网 IP、隧道域名打开时也能写（host 头与 Origin 一致）
    if (u.host === req.headers.get('host')) return true
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return true
    // 内网地址段：192.168.x / 10.x / 172.16–31.x
    if (/^192\.168\./.test(host) || /^10\./.test(host)) return true
    const m = host.match(/^172\.(\d+)\./)
    if (m) {
      const n = Number(m[1])
      if (n >= 16 && n <= 31) return true
    }
    return false
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  try {
    if (!isLocalOrigin(req)) {
      return NextResponse.json({ ok: false, error: 'forbidden origin' }, { status: 403 })
    }
    const raw = await req.text()
    // 按字节数判上限：raw.length 是字符数，中文下会低估
    if (Buffer.byteLength(raw) > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload too large' }, { status: 413 })
    }
    const payload = JSON.parse(raw) as ExportPayload
    if (!payload || !Array.isArray(payload.items)) {
      return NextResponse.json(
        { ok: false, error: 'items 必须是数组（请用错题本页的导出/同步按钮）' },
        { status: 400 }
      )
    }
    const url = new URL(req.url)
    const base = safeName(url.searchParams.get('name'))
    const dir = exportsDir()
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    // 快照按小时：一天最多 24 份，不至于「每判一道题就多一个 0.5MB 文件」
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}`

    const latestJson = join(dir, `${base}_latest.json`)
    const latestMd = join(dir, `${base}_latest.md`)
    const snapJson = join(dir, `${base}_${stamp}.json`)

    const json = JSON.stringify(payload, null, 2)
    writeAtomic(latestJson, json)
    writeAtomic(snapJson, json)
    writeAtomic(latestMd, toMarkdown(payload, `${base}_latest.json`))

    // 只保留最近 24 份快照（按文件名里的时间戳排序，等价于按时间）
    try {
      const snaps = readdirSync(dir)
        .filter((f) => f.startsWith(`${base}_`) && f.endsWith('.json') && !f.includes('_latest'))
        .sort()
      for (const old of snaps.slice(0, Math.max(0, snaps.length - KEEP_SNAPSHOTS))) {
        unlinkSync(join(dir, old))
      }
    } catch {
      // 清理失败不影响本次落盘
    }

    return NextResponse.json({
      ok: true,
      count: payload.items.length,
      pending: payload.summary?.pending ?? null,
      mastered: payload.summary?.mastered ?? null,
      bytes: Buffer.byteLength(json),
      files: { json: latestJson, md: latestMd, snapshot: snapJson },
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}

export async function GET() {
  const file = join(projectRoot(), 'exports', 'wrongbook_latest.json')
  if (!existsSync(file)) {
    return NextResponse.json(
      { ok: false, error: '还没有导出过。打开错题本页点一次「同步到本地」即可生成。' },
      { status: 404 }
    )
  }
  const body = readFileSync(file, 'utf-8')
  return new NextResponse(body, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
