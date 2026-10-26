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

/**
 * 错误次数达到此值视为顽固题：优先级抬升，且再次做错强制回到 stage 0。
 *
 * 取 2 而不是 3：外部导入的「不会」题 wrongCount 直接写 2（见 store.ts 的
 * importExternalWrong），阈值 3 会把它们全部挡在顽固池外，等于标了「不会」
 * 却不给优先权。错两次已经说明没记住，只剩 55 天，该优先。
 */
export const STUBBORN_THRESHOLD = 2

/**
 * 做对推进到该阶段即归档（退出待练池）。
 *
 * 取 4 而不是 6：6 档累计 2+4+7+15+30 = 58 天，比到初试的剩余天数还长，
 * 「做对 6 次归档」在考前来不及发生；4 档累计 2+4+7 = 13 天，可跑完多轮。
 */
export const ARCHIVE_STAGE = 4

/** 归档还要求「连续 N 次一眼就会」：挡住 `对→错→对→对→对` 这种轨迹被算成掌握 */
export const ARCHIVE_GOT_STREAK = 2

/** 补位锁 ①：只补「2 天内就要到期」的题，避免把还在间隔期里的题提前拉出来 */
export const REST_DUE_WINDOW = 2

/** 补位锁 ②：每天最多补几道 */
export const REST_MAX_FILL = 4

/** 顽固题每天最多占几个名额 */
export const STUBBORN_DAILY_LIMIT = 3

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
  /** 连续「一眼就会」的次数：归档要求 ≥ ARCHIVE_GOT_STREAK；做错清零，「想了会儿」不增不减 */
  gotStreak?: number
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
 * 艾宾浩斯选题：到期优先 → 顽固题补足 → 新错题补足 → **近期到期**的补满。
 *
 * 四个池互斥，选中集内不会重复，补足上限直接用参数。
 * 前三池填不满 target 时才用 rest 补位，且有两道锁（REST_DUE_WINDOW / REST_MAX_FILL）：
 * 补位题必须是「2 天内就要到期」的，每天最多补 4 道——否则会把一堆还在间隔期里的题
 * 提前拉出来，等于把 4 天/7 天的间隔压缩成 1 天，间隔复习就失去意义了。
 */
export function selectDailyWrong(args: SelectDailyArgs): string[] {
  const { sched } = args
  const today = args.today ?? dateKey()
  const target = args.target ?? 10
  const exclude = new Set(args.exclude ?? [])
  const topicOf = args.topicOf ?? (() => '')
  // 顽固题（错≥2）每天最多 3 道：它们要的是「诊断 + 重学」，不是每天重看一遍。
  // 给多了会把到期的新题挤出去，池子就变成了「每天复习同一批不会的题」。
  const maxStubborn = args.maxStubborn ?? STUBBORN_DAILY_LIMIT
  const t = toDay(today)
  if (t === null || target <= 0) return []

  const due: string[] = []
  const stubborn: string[] = []
  const newbie: string[] = []
  const rest: string[] = []

  for (const [qid, rec] of Object.entries(sched)) {
    if (!rec.active || rec.wrongCount <= 0) continue
    if (exclude.has(qid)) continue
    const d = dueDay(rec, t)
    if (d <= t) due.push(qid)
    else if (rec.wrongCount >= STUBBORN_THRESHOLD) stubborn.push(qid)
    else if (rec.stage === 0 && !rec.lastReviewedAt && !rec.imported) newbie.push(qid)
    else if (d <= t + REST_DUE_WINDOW) rest.push(qid)
  }

  due.sort((a, b) => {
    const pa = wrongPriority(sched[a], t)
    const pb = wrongPriority(sched[b], t)
    if (pb !== pa) return pb - pa
    return (toDay(sched[a].addedAt) ?? t) - (toDay(sched[b].addedAt) ?? t)
  })
  stubborn.sort((a, b) => sched[b].wrongCount - sched[a].wrongCount)
  newbie.sort((a, b) => (toDay(sched[a].addedAt) ?? t) - (toDay(sched[b].addedAt) ?? t))
  // 「最久没碰」只用来决定**补位顺序**：候选已经被 REST_DUE_WINDOW 限制在「2 天内到期」，
  // 所以这里的排序不会再挑出刚复习过的题。
  rest.sort((a, b) => {
    const la = sched[a].lastReviewedAt || ''
    const lb = sched[b].lastReviewedAt || ''
    if (la !== lb) return la < lb ? -1 : 1
    const da = dueDay(sched[a], t)
    const db = dueDay(sched[b], t)
    if (da !== db) return da - db
    return (toDay(sched[a].addedAt) ?? t) - (toDay(sched[b].addedAt) ?? t)
  })

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

  // ② 池子不闲置，但补位有上限：每天最多补 REST_MAX_FILL 道，且只从「2 天内到期」里取
  for (const qid of rotateByTopic(
    rest,
    Math.min(target - selected.length, REST_MAX_FILL),
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

/** 「想了一会儿」的间隔折扣：阶段照推，但只拿 70% 的间隔（最少 2 天） */
const SLOW_GAP_FACTOR = 0.7
const SLOW_GAP_MIN = 2

function gapForStage(stage: number): number {
  return EBBINGHAUS_INTERVALS[stage] ?? 30
}

/**
 * 判对分三档（+ 又错）：
 * - `got`  一眼就会 / 直接推出来 → 正常推进一级
 * - `slow` 想了一会儿才出来     → 阶段照推，间隔打七折（说明还没真熟）
 * - `peek` 看了解析才懂         → **不推进**，明天原样再来（原来会被当成"做对"直接推一级）
 * - `wrong` 又错                → 回写规则同 Python 版
 *
 * 三档存在的理由：二进制"做对/又错"会把"看解析才懂"记成掌握，
 * 于是一道没学会的题被推到 15 天、30 天后，等于从视野里消失。
 */
export type ReviewGrade = 'got' | 'slow' | 'peek' | 'wrong'

export function applyReview(rec: WrongSched, grade: ReviewGrade, today: string): WrongSched {
  const t = toDay(today) ?? 0

  // 看了解析才懂：不动阶段、不加错次、不动连击，明天再来一次
  if (grade === 'peek') {
    return { ...rec, active: true, nextReviewAt: fromDay(t + 1), lastReviewedAt: today }
  }

  if (grade === 'got' || grade === 'slow') {
    // 「想了会儿」阶段照推，但不算连击——它说明还没真熟，不该用来凑归档条件
    const gotStreak = grade === 'got' ? (rec.gotStreak ?? 0) + 1 : (rec.gotStreak ?? 0)
    const nextStage = rec.stage + 1
    if (nextStage >= ARCHIVE_STAGE && gotStreak >= ARCHIVE_GOT_STREAK) {
      return {
        ...rec,
        stage: ARCHIVE_STAGE,
        gotStreak,
        active: false,
        nextReviewAt: '',
        lastReviewedAt: today,
      }
    }
    // 阶段到顶但连击还不够：停在最后一档继续磨，不能再往上推
    const stage = Math.min(nextStage, ARCHIVE_STAGE - 1)
    const base = gapForStage(stage)
    const gap = grade === 'slow' ? Math.max(SLOW_GAP_MIN, Math.round(base * SLOW_GAP_FACTOR)) : base
    return {
      ...rec,
      stage,
      gotStreak,
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
    // 又错一次，连击清零：下一轮要重新连上 2 次才归档
    gotStreak: 0,
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

/** 按档位算「下一次复习推到几天后」；归档返回 null */
export function nextGap(rec: WrongSched, grade: ReviewGrade): number | null {
  if (grade === 'peek' || grade === 'wrong') return 1
  const gotStreak = grade === 'got' ? (rec.gotStreak ?? 0) + 1 : (rec.gotStreak ?? 0)
  const nextStage = rec.stage + 1
  if (nextStage >= ARCHIVE_STAGE && gotStreak >= ARCHIVE_GOT_STREAK) return null
  const stage = Math.min(nextStage, ARCHIVE_STAGE - 1)
  const base = gapForStage(stage)
  return grade === 'slow' ? Math.max(SLOW_GAP_MIN, Math.round(base * SLOW_GAP_FACTOR)) : base
}

/** 兼容旧调用：等价于 nextGap(rec, 'got') */
export function nextGapIfCorrect(rec: WrongSched): number | null {
  return nextGap(rec, 'got')
}

/** 阶段文案 */
export function stageLabel(stage: number): string {
  if (stage >= ARCHIVE_STAGE) return '已掌握'
  return `第 ${stage + 1} 轮`
}
