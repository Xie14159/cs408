import { NextRequest } from 'next/server'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getQuestion, loadBank } from '@/data'
import { figureFor } from '@/data/figures'
import { SUBJECTS } from '@/data/types'
import { randomUUID } from 'node:crypto'

/**
 * 到期真题做题本 PDF。
 *
 * 错题调度存在浏览器 localStorage，服务端看不到「哪道到期」，所以由前端
 * 把到期 qid 列表 POST 过来；这里只负责取题面、拼 JSON、调本机 Python
 * （reportlab）排版，产物落 exports 并回传二进制流。
 *
 * 注意：standalone 的 server.js 会 chdir 到 .next/standalone，serve.mjs 已通过
 * PROJECT_ROOT 锚回项目根；脚本/图片/落盘路径必须基于它，不能用 process.cwd()。
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_QIDS = 80

function projectRoot(): string {
  return process.env.PROJECT_ROOT || process.cwd()
}

function runPython(
  python: string,
  script: string,
  input: string,
  output: string,
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let settled = false
    const done = (code: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout: out, stderr: err })
    }
    const p = spawn(python, [script, input, output], { cwd, windowsHide: true })
    const timer = setTimeout(() => {
      try {
        p.kill()
      } catch {}
      done(-1)
      err += '\n[timeout] PDF 生成超过 120 秒'
    }, 120_000)
    p.stdout?.on('data', (d) => {
      out += String(d)
    })
    p.stderr?.on('data', (d) => {
      err += String(d)
    })
    p.on('error', (e) => {
      err += `\n[spawn] ${e.message}`
      done(-1)
    })
    p.on('close', (code) => done(code ?? -1))
  })
}

interface WorksheetItem {
  qid: string
  year: number
  number: number
  subjectName: string
  type: string
  topic: string
  score: number
  question: string
  code: { lang: string; text: string } | null
  options: string[] | null
  figure: string | null
}

export async function POST(req: NextRequest) {
  let payload: { qids?: unknown; date?: unknown }
  try {
    payload = await req.json()
  } catch {
    return Response.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const qids = Array.isArray(payload.qids)
    ? payload.qids.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : []
  const date = typeof payload.date === 'string' ? payload.date : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ ok: false, error: 'date 必须是 YYYY-MM-DD' }, { status: 400 })
  }
  if (qids.length === 0) {
    return Response.json({ ok: false, error: '没有到期题可导出' }, { status: 400 })
  }
  if (qids.length > MAX_QIDS) {
    return Response.json({ ok: false, error: `一次最多导出 ${MAX_QIDS} 道` }, { status: 400 })
  }

  await loadBank()

  const root = projectRoot()
  const items: WorksheetItem[] = []
  for (const id of qids) {
    const q = getQuestion(id)
    if (!q) continue
    const fig = figureFor(id)
    items.push({
      qid: q.id,
      year: q.year,
      number: q.number,
      subjectName: SUBJECTS[q.subject]?.name ?? q.subject,
      type: q.type,
      topic: q.topic,
      score: q.score,
      question: q.question,
      code: q.code ?? null,
      options: q.options ?? null,
      figure: fig ? join(root, 'public', fig.replace(/^\/+/, '')) : null,
    })
  }
  if (items.length === 0) {
    return Response.json({ ok: false, error: 'qid 在题库里一个都没找到' }, { status: 400 })
  }

  const script = process.env.WORKSHEET_SCRIPT || join(root, 'scripts', 'make_worksheet_pdf.py')
  if (!existsSync(script)) {
    return Response.json({ ok: false, error: `找不到生成脚本：${script}` }, { status: 500 })
  }
  const python = process.env.WORKSHEET_PYTHON || 'python'

  const outDir = process.env.WORKSHEET_OUT_DIR || join(root, 'exports')
  const fileName = `408做题本_${date}.pdf`
  const pdfPath = join(outDir, fileName)

  const tmpDir = await mkdtemp(join(tmpdir(), 'worksheet-'))
  const jsonPath = join(tmpDir, `${randomUUID()}.json`)
  try {
    await writeFile(jsonPath, JSON.stringify({ date, items }, null, 2), 'utf8')
    const r = await runPython(python, script, jsonPath, pdfPath, root)
    const last = r.stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? ''
    let result: { ok?: boolean; error?: string; pages?: number } = {}
    try {
      result = JSON.parse(last)
    } catch {
      result = { ok: false, error: r.stderr.trim() || '生成器没有返回 JSON' }
    }
    if (r.code !== 0 || !result.ok || !existsSync(pdfPath)) {
      return Response.json(
        {
          ok: false,
          error: result.error || r.stderr.trim() || '生成失败',
          detail: r.stderr.slice(-1200),
        },
        { status: 500 },
      )
    }

    const buf = await readFile(pdfPath)
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(buf.byteLength),
        'Content-Disposition': `attachment; filename="408worksheet_${date}.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
        'X-Worksheet-Pages': String(result.pages ?? 0),
        'X-Worksheet-Count': String(items.length),
        'X-Worksheet-Path': encodeURIComponent(pdfPath),
      },
    })
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}
