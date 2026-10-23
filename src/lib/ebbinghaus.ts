/* =====================================================================
 * 艾宾浩斯错题调度（与「考研拼好卷系统」同源实现）
 * ---------------------------------------------------------------------
 * 常量、优先级公式、阶段回写规则与 Python 版
 *   kaoyan-PinPaper/core/state_manager.py  (EBBINGHAUS 段)
 * 逐条对齐，两个系统共用同一套记忆曲线，避免「数学一天推 10 道、
 * 408 一天推 5 道」这种口径分裂。
 *
 * 日期一律用本地日期字符串 YYYY-MM-DD；内部换算走 UTC 天数，
 * 不引入时区假设，也不依赖运行环境的 locale。
 * ===================================================================== */

/** stage 0~5 对应的复习间隔（天）。注意回写用的是 INTERVALS[newStage]，故实际节奏是 2/4/7/15/30。 */
export const EBBINGHAUS_INTERVALS: number[] = [1, 2, 4, 7, 15, 30]

/** 错误次数达到此值视为顽固题：优先级抬升，且再次做错强制回到 stage 0 */
export const STUBBORN_THRESHOLD = 3

/** 做对推进到该阶段即归档（退出待练池） */
export const ARCHIVE_STAGE = 6

/** 错误类型对优先级的加成：方法不会最该先看，计算失误最不急 */
export const TAG_PRIORITY: Record<string, number> = {
  方法不会: 20,
  概念模糊: 15,
  审题错误: 10,
  计算失误: 8,
  其他: 0,
}

export const ERROR_TAGS = ['方法不会', '概念模糊', '审题错误', '计算失误', '其他'] as const
export type ErrorTag = (typeof ERROR_TAGS)[number]

/** 单道错题的调度记录 */
export interface WrongSched {
  /** 题号，同时用于老数据的稳定散列摊平 */
  qid: string
  /** 首次进池日期 YYYY-MM-DD */
  addedAt: string
  /** 上次复习日期；空串=从未复习过 */
  lastReviewedAt: string
  /** 下次到期日期；空串=老数据，调度时按 addedAt 摊平兜底 */
  nextReviewAt: string
  /** 0~5 活跃，6=已掌握归档 */
  stage: number
  wrongCount: number
  errorTag: string
  /** true=待练池；false=已归档 */
  active: boolean
  /** 由「导入已有错题」批量登记而来：不进新题池，只按到期日排队 */
  imported?: boolean
}

/* ------------------------------ 日期工具 ------------------------------ */

const DAY_MS = 86_400_000

/** 本地日期 → YYYY-MM-DD */
export function dateKey(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** YYYY-MM-DD（或带时间的历史格式）→ 自 1970-01-01 起的天数；非法返回 null */
export function toDay(key: string): number | null {
  if (!key) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key).trim())
  if (!m) return null
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS)
}

/** 天数 → YYYY-MM-DD */
export function fromDay(n: number): string {
  const d = new Date(n * DAY_MS)
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${m}-${day}`
}

/** 日期字符串加减天数；解析失败时原样返回 */
export function addDays(key: string, n: number): string {
  const d = toDay(key)
  return d === null ? key : fromDay(d + n)
}

/** 两个日期相差的天数（b - a） */
export function diffDays(a: string, b: string): number {
  const da = toDay(a)
  const db = toDay(b)
  if (da === null || db === null) return 0
  return db - da
}

/**
 * 稳定散列（与 Python 版 _stable_hash 同式）：
 * 老错题批量进池时用它把到期日摊到 14 天窗口，避免上百道题全压同一天。
 */
export function stableHash(text: string): number {
  let h = 0
  for (const ch of Array.from(text)) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 100000
  }
  return h
}

/** 老数据（nextReviewAt 为空）的到期兜底：addedAt + 1 + 散列(0~13) 天 */
export function legacyDueDay(rec: WrongSched, todayNum: number): number {
  const base = toDay(rec.addedAt) ?? todayNum
  if (base >= todayNum) return base + 1
  return base + 1 + (stableHash(rec.qid) % 14)
}

/** 统一到期日（天序号） */
export function dueDay(rec: WrongSched, todayNum: number): number {
  const nxt = toDay(rec.nextReviewAt)
  return nxt === null ? legacyDueDay(rec, todayNum) : nxt
}

export function dueDateOf(rec: WrongSched, today: string = dateKey()): string {
  return fromDay(dueDay(rec, toDay(today) ?? 0))
}

/* ------------------------------ 优先级 ------------------------------ */

/** 优先级分：逾期天数×10 + 错误次数×5 + 错误标签分（越高越先推） */
export function wrongPriority(rec: WrongSched, todayNum: number): number {
  const overdue = Math.max(0, todayNum - dueDay(rec, todayNum))
  return overdue * 10 + rec.wrongCount * 5 + (TAG_PRIORITY[rec.errorTag] ?? 0)
}

/* ------------------------------ 选题 ------------------------------ */

/**
 * 按章节轮转取题：每章先取一道，再循环补足，让当天的 N 道题尽量覆盖多考点。
 * 同章内保持传入的优先级顺序（调用方先排好序）。
 */
function rotateByTopic(
  pool: string[],
  limit: number,
  topicOf: (qid: string) => string,
  skip: Set<string>,
): string[] {
  if (limit <= 0) return []
  const buckets = new Map<string, string[]>()
  for (const qid of pool) {
    if (skip.has(qid)) continue
    const key = topicOf(qid) || ''
    const arr = buckets.get(key)
    if (arr) arr.push(qid)
    else buckets.set(key, [qid])
  }
  const cursors = new Map<string, number>()
  for (const k of buckets.keys()) cursors.set(k, 0)

  const picked: string[] = []
  while (picked.length < limit) {
    let advanced = false
    for (const [key, bucket] of buckets) {
      if (picked.length >= limit) break
      const cur = cursors.get(key) ?? 0
      if (cur < bucket.length) {
        picked.push(bucket[cur])
        cursors.set(key, cur + 1)
        advanced = true
      }
    }
    if (!advanced) break
  }
  return picked
}

export interface SelectDailyArgs {
  sched: Record<string, WrongSched>
  today?: string
  /** 今天要推几道 */
  target?: number
  exclude?: Iterable<string>
  /** qid → 章节/考点，用于轮转；不传则退化为纯优先级顺序 */
  topicOf?: (qid: string) => string
  /** 顽固题最多补几道 */
  maxStubborn?: number
}

/**
 * 艾宾浩斯选题：到期优先 → 顽固题补足 → 新错题补足 → 不硬凑。
 *
 * 三个池互斥（if / else if / else if），选中集内不会重复，补足上限直接用参数。
 */
export function selectDailyWrong(args: SelectDailyArgs): string[] {
  const { sched } = args
  const today = args.today ?? dateKey()
  const target = args.target ?? 10
  const exclude = new Set(args.exclude ?? [])
  const topicOf = args.topicOf ?? (() => '')
  const maxStubborn = args.maxStubborn ?? 5
  const t = toDay(today)
  if (t === null || target <= 0) return []

  const due: string[] = []
  const stubborn: string[] = []
  const newbie: string[] = []

  for (const [qid, rec] of Object.entries(sched)) {
    if (!rec.active || rec.wrongCount <= 0) continue
    if (exclude.has(qid)) continue
    const d = dueDay(rec, t)
    if (d <= t) due.push(qid)
    else if (rec.wrongCount >= STUBBORN_THRESHOLD) stubborn.push(qid)
    else if (rec.stage === 0 && !rec.lastReviewedAt && !rec.imported) newbie.push(qid)
  }

  due.sort((a, b) => {
    const pa = wrongPriority(sched[a], t)
    const pb = wrongPriority(sched[b], t)
    if (pb !== pa) return pb - pa
    return (toDay(sched[a].addedAt) ?? t) - (toDay(sched[b].addedAt) ?? t)
  })
  stubborn.sort((a, b) => sched[b].wrongCount - sched[a].wrongCount)
  newbie.sort((a, b) => (toDay(sched[a].addedAt) ?? t) - (toDay(sched[b].addedAt) ?? t))

  const selected = rotateByTopic(due, target, topicOf, exclude)
  const seen = new Set(selected)

  for (const qid of rotateByTopic(
    stubborn,
    Math.min(target - selected.length, maxStubborn),
    topicOf,
    new Set([...seen, ...exclude]),
  )) {
    if (selected.length >= target) break
    selected.push(qid)
    seen.add(qid)
  }

  for (const qid of rotateByTopic(
    newbie,
    target - selected.length,
    topicOf,
    new Set([...seen, ...exclude]),
  )) {
    if (selected.length >= target) break
    selected.push(qid)
    seen.add(qid)
  }

  return selected
}

/* ------------------------------ 回写 ------------------------------ */

/** 新题进池：与「又错一次」同口径，一律明天开始推（历史批量补登才走 14 天摊平） */
export function createSched(qid: string, today: string, errorTag = '概念模糊'): WrongSched {
  return {
    qid,
    addedAt: today,
    lastReviewedAt: '',
    nextReviewAt: addDays(today, 1),
    stage: 0,
    wrongCount: 1,
    errorTag,
    active: true,
  }
}

/** 批量导入历史错题：到期日按 windowDays 摊平，避免一次性涌入；不进新题池 */
export function importSched(
  qid: string,
  today: string,
  wrongCount: number,
  errorTag = '概念模糊',
  windowDays = 14,
): WrongSched {
  return {
    qid,
    addedAt: today,
    lastReviewedAt: '',
    nextReviewAt: addDays(today, 1 + (stableHash(qid) % Math.max(1, windowDays))),
    stage: 0,
    wrongCount: Math.max(1, wrongCount),
    errorTag,
    active: true,
    imported: true,
  }
}

/**
 * 复习回写（与 Python 版 record_review_result 一致）：
 * - 做对：stage+1，间隔取 INTERVALS[newStage]；到 ARCHIVE_STAGE 归档。
 * - 做错：wrongCount+1；归档题重新激活并回 0；顽固题强制回 0；否则回退一级；统一明天再练。
 */
export function applyReview(rec: WrongSched, correct: boolean, today: string): WrongSched {
  const t = toDay(today) ?? 0
  if (correct) {
    const nextStage = rec.stage + 1
    if (nextStage >= ARCHIVE_STAGE) {
      return { ...rec, stage: ARCHIVE_STAGE, active: false, nextReviewAt: '', lastReviewedAt: today }
    }
    const gap = EBBINGHAUS_INTERVALS[nextStage] ?? 30
    return {
      ...rec,
      stage: nextStage,
      active: true,
      nextReviewAt: fromDay(t + gap),
      lastReviewedAt: today,
    }
  }

  const wrongCount = rec.wrongCount + 1
  let stage: number
  let active = rec.active
  if (!rec.active) {
    active = true
    stage = 0
  } else if (wrongCount >= STUBBORN_THRESHOLD && rec.stage > 0) {
    stage = 0
  } else {
    stage = Math.max(0, rec.stage - 1)
  }
  return {
    ...rec,
    wrongCount,
    stage,
    active,
    nextReviewAt: fromDay(t + 1),
    lastReviewedAt: today,
  }
}

/** 「没做」：不动阶段与次数，只把到期日拉回今天，明天还能被选中 */
export function applySkip(rec: WrongSched, today: string): WrongSched {
  return { ...rec, nextReviewAt: today }
}

/** 顺延（清空今日）：到期日推到 N 天后 */
export function applyPostpone(rec: WrongSched, today: string, days = 1): WrongSched {
  return { ...rec, nextReviewAt: addDays(today, days) }
}

/* ------------------------------ 展示辅助 ------------------------------ */

/** 该题「下一次做对」会推到几天后（用于卡片上写明收益） */
export function nextGapIfCorrect(rec: WrongSched): number | null {
  const nextStage = rec.stage + 1
  if (nextStage >= ARCHIVE_STAGE) return null
  return EBBINGHAUS_INTERVALS[nextStage] ?? 30
}

/** 阶段文案 */
export function stageLabel(stage: number): string {
  if (stage >= ARCHIVE_STAGE) return '已掌握'
  return `第 ${stage + 1} 轮`
}
