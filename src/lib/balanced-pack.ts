/* =====================================================================
 * 错题成套 · 四科 × 题型配额组卷
 * ---------------------------------------------------------------------
 * 与调度模块（ebbinghaus.ts）解耦：本模块只做「给定优先级顺序的候选池，
 * 按 408 卷面蓝图配额切成一套卷」，不读 sched、不依赖 localStorage。
 *
 * 配额口径（DS 复核定稿）：
 * - 科目权重按卷面分值 DS45/CO45/OS35/CN25，最大余数法分配，Σ科目配额 = target；
 * - 科内题型按卷面 单选40 : 综合7 切分，综合题数量受池内可用数封顶；
 *   池内该科综合 ≥1 且科目配额 ≥2 时，综合保底 1 道；
 * - 配额是上限：格内不足直接少出，不跨格补位；plan 区分 unavailable（池内无题可选）
 *   与 unfilled（配额未用满），shortfall 为两者之和的兼容字段；
 * - 展示顺序按科轮转打散（ds→co→os→cn），科内单选在前、综合在后，
 *   科内同题型保持传入的优先级顺序。
 * ===================================================================== */

import type { QuestionType, SubjectCode } from '../data/types'

export interface PackMeta {
  subject: SubjectCode
  type: QuestionType
}

export interface PlanRow {
  subject: SubjectCode
  type: QuestionType
  /** 蓝图原始配额（未按池内封顶，道） */
  planned: number
  /** 池内封顶后的可选上限（道） */
  quota: number
  /** 实际入选（道） */
  actual: number
  /** planned − quota：池内物理缺口，配额名额在池里根本无题可选（不可补） */
  unavailable: number
  /** quota − actual：配额未用满（本实现不跨格补位，恒为 0） */
  unfilled: number
  /** planned − actual（兼容字段；= unavailable + unfilled） */
  shortfall: number
}

export interface BalancedPack {
  qids: string[]
  plan: PlanRow[]
  /** 未入选题数：metaOf 返回 undefined、科目/题型枚举非法、或 qid 重复 */
  skipped: number
  /** 本次实际目标道数（已按池总量封顶） */
  target: number
}

const SUBJECT_ORDER: SubjectCode[] = ['ds', 'co', 'os', 'cn']
const TYPE_ORDER: QuestionType[] = ['single', 'application']

/** 408 卷面分值权重 */
const SUBJECT_WEIGHT: Record<SubjectCode, number> = { ds: 45, co: 45, os: 35, cn: 25 }
/** 综合题占卷面题型比：7 / (40+7) */
const APP_SHARE = 7 / 47

function cellKey(subject: SubjectCode, type: QuestionType): string {
  return `${subject}:${type}`
}

/** 最大余数法（Hamilton）：把 n 个名额按权重分到四科，保证 Σ = n */
function allocateByWeight(n: number): Record<SubjectCode, number> {
  const total = SUBJECT_ORDER.reduce((sum, s) => sum + SUBJECT_WEIGHT[s], 0)
  const raw = SUBJECT_ORDER.map((s) => ({ s, v: (n * SUBJECT_WEIGHT[s]) / total }))
  const quota: Record<SubjectCode, number> = { ds: 0, co: 0, os: 0, cn: 0 }
  for (const { s, v } of raw) quota[s] = Math.floor(v)
  let rest = n - SUBJECT_ORDER.reduce((sum, s) => sum + quota[s], 0)
  const byRemainder = [...raw].sort(
    (a, b) => b.v - Math.floor(b.v) - (a.v - Math.floor(a.v)),
  )
  for (const { s } of byRemainder) {
    if (rest <= 0) break
    quota[s] += 1
    rest -= 1
  }
  return quota
}

/** 按最终入选 qids 统计各格 actual；planned/quota 缺省 0（空池 / 整池统计） */
function planFromRows(
  qids: string[],
  metaById: Map<string, PackMeta>,
  plannedByCell: Map<string, number>,
  quotaByCell?: Map<string, number>,
): PlanRow[] {
  return SUBJECT_ORDER.flatMap((s) =>
    TYPE_ORDER.map((t) => {
      const k = cellKey(s, t)
      const planned = plannedByCell.get(k) ?? 0
      const quota = quotaByCell?.get(k) ?? planned
      const actual = qids.filter((q) => {
        const m = metaById.get(q)
        return m?.subject === s && m?.type === t
      }).length
      const unavailable = planned - quota
      const unfilled = quota - actual
      return {
        subject: s,
        type: t,
        planned,
        quota,
        actual,
        unavailable,
        unfilled,
        shortfall: planned - actual,
      }
    }),
  )
}

export function selectBalancedPaper(
  orderedQids: string[],
  target: number,
  metaOf: (qid: string) => PackMeta | undefined,
): BalancedPack {
  const n = Math.max(0, Math.floor(Number.isFinite(target) ? target : 0))

  const pool: { qid: string; meta: PackMeta }[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const qid of orderedQids) {
    const meta = metaOf(qid)
    // 缺元数据、科目/题型枚举非法、qid 重复，一律计入 skipped，不静默丢弃
    if (
      !meta ||
      !SUBJECT_ORDER.includes(meta.subject) ||
      !TYPE_ORDER.includes(meta.type) ||
      seen.has(qid)
    ) {
      skipped += 1
      continue
    }
    seen.add(qid)
    pool.push({ qid, meta })
  }

  // 空池：提前返回；plan 仍返回全格 0 行
  if (pool.length === 0) {
    return { qids: [], plan: planFromRows([], new Map(), new Map()), skipped, target: 0 }
  }

  const metaById = new Map<string, PackMeta>()
  for (const { qid, meta } of pool) metaById.set(qid, meta)

  // 「全部」档：Infinity 或目标 ≥ 池总量，整池入选，不套配额（须先于 n===0 判定，
  // 否则 Infinity 会被归一化为 0 而误进空池路径；NaN 不是全部档，归 0 走空池）
  const allIn = target === Infinity || target >= pool.length
  if (allIn) {
    const all = pool.map((p) => p.qid)
    const plannedByCell = new Map<string, number>()
    for (const { meta } of pool) {
      const k = cellKey(meta.subject, meta.type)
      plannedByCell.set(k, (plannedByCell.get(k) ?? 0) + 1)
    }
    return {
      qids: all,
      plan: planFromRows(all, metaById, plannedByCell),
      skipped,
      target: pool.length,
    }
  }

  // 0 道目标：空返回，plan 全格 0 行
  if (n === 0) {
    return { qids: [], plan: planFromRows([], new Map(), new Map()), skipped, target: 0 }
  }

  const cap = Math.min(n, pool.length)

  // 分桶，保持入参优先级顺序
  const cells = new Map<string, string[]>()
  for (const { qid, meta } of pool) {
    const arr = cells.get(cellKey(meta.subject, meta.type)) ?? []
    arr.push(qid)
    cells.set(cellKey(meta.subject, meta.type), arr)
  }

  // 科目配额 → 科内题型配额：planned 为蓝图原始配额（未封顶）；quota 为池内封顶后的可选上限。
  // 综合按 7/47 比例切；池内有综合且科目配额 ≥2 时保底 1 道。qs=1 时按比例本就归单选，
  // 保底不触发，避免单题名额被综合占走。
  const subjectQuota = allocateByWeight(cap)
  const cellQuota = new Map<string, number>()
  const cellPlanned = new Map<string, number>()
  for (const s of SUBJECT_ORDER) {
    const qs = subjectQuota[s]
    const appPool = cells.get(cellKey(s, 'application')) ?? []
    const singlePool = cells.get(cellKey(s, 'single')) ?? []
    let appRaw = Math.round(qs * APP_SHARE)
    if (appPool.length >= 1 && qs >= 2) appRaw = Math.max(appRaw, 1)
    const singleRaw = qs - appRaw
    cellPlanned.set(cellKey(s, 'application'), appRaw)
    cellPlanned.set(cellKey(s, 'single'), singleRaw)
    cellQuota.set(cellKey(s, 'application'), Math.min(appRaw, appPool.length))
    cellQuota.set(cellKey(s, 'single'), Math.min(singleRaw, singlePool.length))
  }

  // 轮转选题：科序 ds→co→os→cn，科内 single→application，每格在配额内取优先级最高的一道
  const taken = new Set<string>()
  const bySubject: Record<SubjectCode, string[]> = { ds: [], co: [], os: [], cn: [] }
  const cursor = new Map<string, number>()
  const cellCount = new Map<string, number>()
  let remaining = cap

  while (remaining > 0) {
    let advanced = false
    for (const s of SUBJECT_ORDER) {
      for (const t of TYPE_ORDER) {
        if (remaining <= 0) break
        const k = cellKey(s, t)
        if ((cellCount.get(k) ?? 0) >= (cellQuota.get(k) ?? 0)) continue
        const arr = cells.get(k) ?? []
        const cur = cursor.get(k) ?? 0
        if (cur >= arr.length) continue
        const qid = arr[cur]
        cursor.set(k, cur + 1)
        cellCount.set(k, (cellCount.get(k) ?? 0) + 1)
        bySubject[s].push(qid)
        taken.add(qid)
        remaining -= 1
        advanced = true
      }
    }
    if (!advanced) break
  }

  // 展示顺序：按科轮转打散，科内 single 在前 app 在后（bySubject 已按此顺序收集）
  const qids: string[] = []
  let idx = 0
  let filled = false
  while (!filled) {
    filled = true
    for (const s of SUBJECT_ORDER) {
      if (idx < bySubject[s].length) {
        qids.push(bySubject[s][idx])
        filled = false
      }
    }
    idx += 1
  }

  const plan = planFromRows(qids, metaById, cellPlanned, cellQuota)
  return { qids, plan, skipped, target: cap }
}
