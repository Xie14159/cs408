import { QUESTION_MAP } from '@/data'
import { SUBJECTS } from '@/data/types'
import { isWrongEntry, type QRecord } from '@/lib/store'

/**
 * 错题本导出载荷的唯一构造处。
 * 两个消费方共用它：①「导出 JSON」按钮（下载文件）②「同步到本地」按钮（POST 到 /api/wrongbook 落盘）。
 * 分开写两份最容易漂移——字段一多，导出的和落盘的就对不上了。
 */

type Rec = {
  wrong: number
  correct: number
  attempts: number
  lastResult: string
  lastAt: number
}

type Sch = {
  stage?: number
  nextReviewAt?: string
  lastReviewedAt?: string
  errorTag?: string
  active?: boolean
}

export interface WrongbookItem {
  qid: string
  status: '待巩固' | '已掌握'
  year: number
  number: number
  subject: string
  subjectName: string
  type: string
  topic: string
  difficulty: string | number
  score: number
  wrong: number
  correct: number
  attempts: number
  lastResult: string
  lastAt: number
  lastAtISO: string
  answer: string
  /** 单选选项（不含 A. 前缀）；综合题为空数组 */
  options: string[]
  /** 解析（截 2000 字，够讲题用） */
  explanation: string
  stage: number | null
  nextReviewAt: string
  lastReviewedAt: string
  errorTag: string
  active: boolean | null
  question: string
  answerText: string
  stem: string
}

export interface WrongbookPayload {
  app: '408Lab'
  version: 2
  exportedAt: string
  timezone: string
  summary: { total: number; pending: number; mastered: number }
  items: WrongbookItem[]
}

export function buildWrongbookPayload(
  records: Record<string, Rec>,
  sched: Record<string, Sch>
): WrongbookPayload {
  const now = new Date()
  let pending = 0
  let mastered = 0
  const items: WrongbookItem[] = Object.entries(records)
    .filter(([, r]) => (r?.wrong ?? 0) > 0)
    .sort((a, b) => b[1].lastAt - a[1].lastAt)
    .map(([qid, r]) => {
      const q = QUESTION_MAP.get(qid)
      const sc = sched[qid]
      const still = isWrongEntry(r as unknown as QRecord)
      if (still) pending++
      else mastered++
      return {
        qid,
        status: still ? '待巩固' : '已掌握',
        year: q?.year ?? 0,
        number: q?.number ?? 0,
        subject: q?.subject ?? '',
        subjectName: q ? (SUBJECTS[q.subject]?.name ?? q.subject) : '',
        type: q?.type ?? '',
        topic: q?.topic ?? '',
        difficulty: q?.difficulty ?? '',
        score: q?.score ?? 0,
        wrong: r.wrong,
        correct: r.correct,
        attempts: r.attempts,
        lastResult: r.lastResult,
        lastAt: r.lastAt,
        lastAtISO: new Date(r.lastAt).toISOString(),
        answer: q?.answer ?? '',
        options: q?.options ?? [],
        explanation: (q?.explanation ?? '').slice(0, 2000),
        stage: sc?.stage ?? null,
        nextReviewAt: sc?.nextReviewAt ?? '',
        lastReviewedAt: sc?.lastReviewedAt ?? '',
        errorTag: sc?.errorTag ?? '',
        active: sc?.active ?? null,
        question: q?.question ?? '',
        answerText: (q?.answerText ?? '').slice(0, 4000),
        stem: (q?.question ?? '').replace(/\s+/g, ' ').slice(0, 160),
      }
    })
  return {
    app: '408Lab',
    version: 2,
    exportedAt: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    summary: { total: items.length, pending, mastered },
    items,
  }
}

export interface SaveResult {
  ok: boolean
  count?: number
  files?: { json: string; md: string; snapshot: string }
  error?: string
}

/** 落盘到 D:\考研备考\408\zhenti\exports\（由本机 API 写文件，浏览器不下载） */
export async function saveWrongbookToDisk(payload: WrongbookPayload): Promise<SaveResult> {
  try {
    const res = await fetch('/api/wrongbook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = (await res.json()) as SaveResult
    if (!res.ok || !data.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}` }
    return data
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
