'use client'

import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { SubjectCode } from '@/data/types'
import { EXTERNAL_WRONG } from '@/data/external-wrong'
import { ALL_MAP } from '@/data'
import {
  ARCHIVE_STAGE,
  addDays,
  applyPostpone,
  applyReview,
  applySkip,
  createSched,
  importSched,
  type ReviewGrade,
  type WrongSched,
} from '@/lib/ebbinghaus'
import { mergeDailyInto, pickNewerDate } from '@/lib/backup-merge'


/* ---------------- 去抖的 persist 存储 ---------------- */
/**
 * zustand persist 每次 set 都会同步 JSON.stringify + localStorage.setItem，
 * 答题时每题一次，数据越大主线程抖动越明显。这里把写入合并到 300ms 一次，
 * 并在页面隐藏/卸载前同步 flush，保证不丢最后一次操作。
 */
function createDebouncedStorage(): StateStorage {
  let pending: { name: string; value: string } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    try {
      localStorage.setItem(pending.name, pending.value)
    } catch {
      /* 配额满或隐私模式：放弃这次写入，不影响内存状态 */
    }
    pending = null
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
  }
  return {
    getItem: (name) => {
      if (typeof window === 'undefined') return null
      if (pending && pending.name === name) return pending.value
      try {
        return localStorage.getItem(name)
      } catch {
        return null
      }
    },
    setItem: (name, value) => {
      if (typeof window === 'undefined') return
      pending = { name, value }
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 300)
    },
    removeItem: (name) => {
      if (typeof window === 'undefined') return
      if (pending && pending.name === name) pending = null
      try {
        localStorage.removeItem(name)
      } catch {
        /* ignore */
      }
    },
  }
}

/* ---------------- 进度存储（localStorage 持久化） ---------------- */

export interface QRecord {
  attempts: number
  correct: number
  wrong: number
  /** 最近一次结果：单选对错 / 综合题自评 */
  lastResult: 'correct' | 'wrong' | 'mastered' | 'unmastered'
  lastAt: number
}

export interface ExamRecord {
  id: string
  ts: number
  label: string
  total: number
  correct: number
  /** 预估得分：单选按 2 分/题；整卷含综合题自评分 */
  score?: number
  /** 满分：80（纯单选卷）或 150（整卷） */
  scoreMax?: number
  durationSec: number
  perSubject: Partial<Record<SubjectCode, { c: number; t: number }>>
}

/** 收藏条目：条目不物理删除（fav=false 即取消），便于多端同步合并 */
export interface FavEntry {
  fav: boolean
  /** 收藏状态最近一次变更时间（同步时决定 fav 以谁为准） */
  ts: number
  note: string
  /** 备注最近一次编辑时间（同步时决定 note 以谁为准） */
  noteAt: number
}

interface ProgressState {
  records: Record<string, QRecord>
  /** 'YYYY-MM-DD' -> 当日答题次数 */
  daily: Record<string, number>
  exams: ExamRecord[]
  /** 题目收藏 + 备注（qid -> 条目） */
  favorites: Record<string, FavEntry>
  /** 艾宾浩斯调度：qid -> 记忆曲线记录（错题一进池就有记录，与错题本共用同一批题） */
  sched: Record<string, WrongSched>
  /** 'YYYY-MM-DD' -> 当天已推送的 qid 顺序（持久化：刷新后还是同一份，不会换一批） */
  assignedDaily: Record<string, string[]>
  /** 'YYYY-MM-DD' -> 当天已处理（做对 / 又错 / 没做）的 qid */
  processedDaily: Record<string, string[]>
  /** 'YYYY-MM-DD' -> 每日错题的判定档位（got / wrong / peek），用于答完后卡片状态与刷新后回显 */
  dailyDone: Record<string, Record<string, ReviewGrade>>
  /**
   * 'YYYY-MM-DD' -> 一日题包的作答结果（qid -> correct/wrong）。
   * 只服务「今日题包」，按日期隔离，次日自然失效，不参与正常抽题。
   */
  packDone: Record<string, Record<string, 'correct' | 'wrong'>>
  /** 'YYYY-MM-DD' -> 题包作答时选中的选项字母（仅单选；刷新后仍能看到自己选了什么） */
  packPick: Record<string, Record<string, string>>
  /** 'YYYY-MM-DD' -> 题包作答前的快照（records/sched 原值与 daily 实际增量），供撤销回滚 */
  packPrev: Record<
    string,
    Record<string, { record?: QRecord; sched?: WrongSched; dailyBefore?: number; dailyDelta?: number }>
  >
  /** 外部错题本补登完成日期；非空表示已跑过，不再重复导入 */
  externalImportedAt: string
  submitAnswer: (qid: string, result: 'correct' | 'wrong') => void
  /** 一日题包作答：记录对错，做错照常进池（不动 assignedDaily / processedDaily） */
  recordPackAnswer: (date: string, qid: string, correct: boolean, letter?: string) => void
  /** 撤销题包的一次作答：records / sched / 当日计数回滚到作答前 */
  undoPackAnswer: (date: string, qid: string) => void
  /** 把某天题包里做过的题全部登记进记忆曲线（已在池中的跳过，做对的也登记）；返回新增条数 */
  enrollPackAnswers: (date: string) => number
  /** 把某题从错题池归档：不再安排复习（教材口径不一致、不想再练的题用这个） */
  retireQuestion: (qid: string) => void
  /** 已掌握：记录为 mastered 并直接归档，之后不再进入任何复习队列 */
  masterQuestion: (qid: string) => void
  markApplication: (qid: string, mastered: boolean) => void
  resolveWrongFromBook: (qid: string, correct: boolean) => void
  /** 拼卷/错题即练会话作答：回写 records + 记忆曲线（同日幂等），不写 processedDaily / dailyDone / daily，不污染每日批次统计 */
  applyPracticeResult: (qid: string, correct: boolean) => void
  addExam: (rec: Omit<ExamRecord, 'id' | 'ts'> & { id?: string }) => void
  updateExam: (id: string, patch: Partial<ExamRecord>) => void
  toggleFavorite: (qid: string) => void
  setNote: (qid: string, note: string) => void
  /** 每日错题回写：四档判定（一眼就会 / 想了一会儿 / 看解析才懂 / 又错），同一天幂等 */
  recordReview: (qid: string, grade: ReviewGrade) => void
  /** 每日错题答题即判分：正确→got、错误→wrong；未答先看答案走 peek。同一天同题只记一次 */
  recordDailyAnswer: (qid: string, correct: boolean, grade?: ReviewGrade) => void
  /** 每日错题「没做」：不动阶段，只把到期日拉回今天 */
  skipReview: (qid: string) => void
  /** 把选题结果记入「今日已安排」（再开 10 道=并集追加） */
  assignDaily: (qids: string[]) => void
  /** 顺延指定错题的到期日（默认 +1 天） */
  postponeDaily: (qids: string[], days?: number) => void
  /** 清空今日：剩余题顺延到明天，今日安排与已处理都归零 */
  clearToday: () => void
  /** 把错题本里已有、但还没进调度池的错题一次性批量登记，返回登记条数 */
  importExistingWrong: () => number
  /** 并入外部错题本（不会 38 + 不熟 13），只在首次进入时跑一次，返回并入条数 */
  importExternalWrong: () => number
  resetAll: () => void
  /** 导出全部进度为JSON字符串 */
  exportJSON: () => string
  /** 从JSON字符串导入进度，合并策略：保留较新的lastAt */
  importJSON: (json: string) => { ok: number; skipped: number }
}

function todayKey(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 同一题今天是否已推进过记忆曲线（lastReviewedAt 同日）。每日批次与拼卷两条路径共用，避免双推 stage。 */
function reviewedToday(rec: WrongSched | undefined, today: string): boolean {
  return !!rec?.lastReviewedAt && rec.lastReviewedAt.slice(0, 10) === today
}

/** 错题进池 / 又错一次：首次进池把到期日摊到 14 天窗口，之后一律「明天再练」 */
function bumpSched(
  all: Record<string, WrongSched>,
  qid: string,
  today: string,
): Record<string, WrongSched> {
  const prev = all[qid]
  if (!prev) return { ...all, [qid]: createSched(qid, today) }
  return {
    ...all,
    [qid]: {
      ...prev,
      wrongCount: prev.wrongCount + 1,
      active: true,
      // 已归档的题又做错：重新激活并从第 1 轮开始
      stage: prev.active ? prev.stage : 0,
      nextReviewAt: addDays(today, 1),
    },
  }
}

/** 标记今日已处理；只保留当天 key，防无限增长 */
function withProcessed(
  processed: Record<string, string[]>,
  qid: string,
  today: string,
): Record<string, string[]> {
  const cur = new Set(processed[today] ?? [])
  cur.add(qid)
  return { [today]: Array.from(cur).sort() }
}

export const useProgress = create<ProgressState>()(
  persist(
    (set, get) => ({
      records: {},
      daily: {},
      exams: [],
      favorites: {},
      sched: {},
      assignedDaily: {},
      processedDaily: {},
      dailyDone: {},
      packDone: {},
      packPick: {},
      packPrev: {},
      externalImportedAt: '',
      submitAnswer: (qid, result) =>
        set((s) => {
          const prev = s.records[qid]
          const rec: QRecord = {
            attempts: (prev?.attempts ?? 0) + 1,
            correct: (prev?.correct ?? 0) + (result === 'correct' ? 1 : 0),
            wrong: (prev?.wrong ?? 0) + (result === 'wrong' ? 1 : 0),
            lastResult: result,
            lastAt: Date.now(),
          }
          const key = todayKey()
          return {
            records: { ...s.records, [qid]: rec },
            // 答错即自动进艾宾浩斯池（与错题本同一批题，不需要用户手动登记）
            sched: result === 'wrong' ? bumpSched(s.sched, qid, key) : s.sched,
            daily: { ...s.daily, [key]: (s.daily[key] ?? 0) + 1 },
          }
        }),
      /**
       * 一日题包作答：用 applyPracticeResult 回写 records + 记忆曲线（做对也推进 stage，
       * 做错照常进池），再单独累计当天答题数；不影响 assignedDaily / processedDaily。
       * 必须保持同步：幂等判断依赖「本次调用返回时 packDone 已写入」。
       */
      recordPackAnswer: (date, qid, correct, letter) => {
        const s0 = get()
        // 幂等：同一天同题只记一次；若上次写入中断留下半状态，也不覆盖原始快照
        if (s0.packDone[date]?.[qid]) return
        if (s0.packPrev[date]?.[qid]) return
        // 快照旧对象即可：applyPracticeResult / bumpSched 都是不可变更新，不会原地改
        const snap = {
          record: s0.records[qid],
          sched: s0.sched[qid],
          dailyBefore: s0.daily[date] ?? 0,
        }
        get().applyPracticeResult(qid, correct)
        // applyPracticeResult 刻意不写 daily（避免污染拼卷会话），题包是今日主批次，单独 +1
        const dailyNext = (get().daily[date] ?? 0) + 1
        const dailyDelta = dailyNext - snap.dailyBefore
        set((s) => ({
          daily: { ...s.daily, [date]: dailyNext },
          packPrev: {
            ...s.packPrev,
            [date]: { ...(s.packPrev[date] ?? {}), [qid]: { ...snap, dailyDelta } },
          },
          packDone: {
            ...s.packDone,
            [date]: { ...(s.packDone[date] ?? {}), [qid]: correct ? 'correct' : 'wrong' },
          },
          packPick: letter
            ? { ...s.packPick, [date]: { ...(s.packPick[date] ?? {}), [qid]: letter } }
            : s.packPick,
        }))
      },
      /** 撤销题包作答：records / sched / 当日计数回到作答前，packDone / packPick 移除该题 */
      undoPackAnswer: (date, qid) => {
        const snap = get().packPrev[date]?.[qid]
        if (!snap) return
        set((s) => {
          const records = { ...s.records }
          if (snap.record) records[qid] = snap.record
          else delete records[qid]
          const sched = { ...s.sched }
          if (snap.sched) sched[qid] = snap.sched
          else delete sched[qid]
          const done = { ...(s.packDone[date] ?? {}) }
          delete done[qid]
          const picks = { ...(s.packPick[date] ?? {}) }
          delete picks[qid]
          const prevs = { ...(s.packPrev[date] ?? {}) }
          delete prevs[qid]
          const daily = { ...s.daily }
          if (snap.dailyDelta) daily[date] = Math.max(0, (daily[date] ?? 0) - snap.dailyDelta)
          return {
            records,
            sched,
            packDone: { ...s.packDone, [date]: done },
            packPick: { ...s.packPick, [date]: picks },
            packPrev: { ...s.packPrev, [date]: prevs },
            daily,
          }
        })
      },
      /** 把题包当天做过的题登记进记忆曲线：已在池中的跳过；做对的也登记，到期日摊到 14 天窗口 */
      enrollPackAnswers: (date) => {
        const s = get()
        const done = s.packDone[date] ?? {}
        const missing = Object.keys(done).filter((qid) => !s.sched[qid])
        if (missing.length === 0) return 0
        const sched = { ...s.sched }
        for (const qid of missing) {
          // 「其他」标签不给额外优先级；imported=true 让它们按到期日渐进出现，不占用新题池
          sched[qid] = importSched(qid, date, 1, '其他', 14)
        }
        set({ sched })
        return missing.length
      },
      /** 归档某题：移出复习池，不再安排到期；以后若又答错会自动重新进池 */
      retireQuestion: (qid) =>
        set((s) => {
          const rec = s.sched[qid]
          if (!rec) return {}
          return {
            sched: {
              ...s.sched,
              [qid]: {
                ...rec,
                active: false,
                stage: ARCHIVE_STAGE,
                nextReviewAt: '',
              },
            },
          }
        }),
      /** 已掌握：手动判定，不当作一次答题（attempts 不变），直接归档出复习池 */
      masterQuestion: (qid) =>
        set((s) => {
          const prev = s.records[qid]
          const today = todayKey()
          const rec: QRecord = {
            attempts: prev?.attempts ?? 0,
            correct: prev?.correct ?? 0,
            wrong: prev?.wrong ?? 0,
            lastResult: 'mastered',
            lastAt: Date.now(),
          }
          const existing = s.sched[qid]
          const retired: WrongSched = existing
            ? { ...existing, active: false, stage: ARCHIVE_STAGE, nextReviewAt: '' }
            : {
                qid,
                addedAt: today,
                lastReviewedAt: '',
                nextReviewAt: '',
                stage: ARCHIVE_STAGE,
                wrongCount: 0,
                errorTag: '其他',
                active: false,
              }
          return {
            records: { ...s.records, [qid]: rec },
            sched: { ...s.sched, [qid]: retired },
          }
        }),
      markApplication: (qid, mastered) =>
        set((s) => {
          const prev = s.records[qid]
          const rec: QRecord = {
            attempts: (prev?.attempts ?? 0) + 1,
            correct: (prev?.correct ?? 0) + (mastered ? 1 : 0),
            wrong: (prev?.wrong ?? 0) + (mastered ? 0 : 1),
            lastResult: mastered ? 'mastered' : 'unmastered',
            lastAt: Date.now(),
          }
          const key = todayKey()
          return {
            records: { ...s.records, [qid]: rec },
            sched: mastered ? s.sched : bumpSched(s.sched, qid, key),
            daily: { ...s.daily, [key]: (s.daily[key] ?? 0) + 1 },
          }
        }),
      /**
       * 错题本里做题后的统一回写：更新 records + 推进/回退艾宾浩斯记忆曲线 + 标记今日已处理。
       * 与拼好卷 finish_daily_review 对齐：无论对错都算处理了这道错题。
       * - correct=true：records.lastResult=correct（题目从错题本消失），sched stage+1
       * - correct=false：records.lastResult=wrong，sched stage 回退/顽固归零，明天再来
       * - 幂等：同一天同一题只推进一次 sched（records 仍计一次 attempt）
       */
      resolveWrongFromBook: (qid, correct) =>
        set((s) => {
          const prev = s.records[qid]
          // 做对时不改lastResult（保持wrong/unmastered），题目留在错题本里看解析
          // 只有做错了才更新lastResult='wrong'
          const rec: QRecord = {
            attempts: (prev?.attempts ?? 0) + 1,
            correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
            wrong: (prev?.wrong ?? 0) + (correct ? 0 : 1),
            lastResult: correct ? (prev?.lastResult ?? 'wrong') : 'wrong',
            lastAt: Date.now(),
          }
          const today = todayKey()
          let sched = s.sched
          const existing = sched[qid]
          if (existing) {
            // 幂等：同一天不重复推进记忆曲线
            if (!existing.lastReviewedAt || existing.lastReviewedAt.slice(0, 10) !== today) {
              sched = { ...sched, [qid]: applyReview(existing, correct ? 'got' : 'wrong', today) }
            }
          } else if (!correct) {
            // sched 里没有且做错了，兜底进池
            sched = bumpSched(sched, qid, today)
          }
          // daily去重：同一天同一题只计一次
          const alreadyProcessed = (s.processedDaily[today] ?? []).includes(qid)
          return {
            records: { ...s.records, [qid]: rec },
            sched,
            processedDaily: withProcessed(s.processedDaily, qid, today),
            daily: { ...s.daily, [today]: (s.daily[today] ?? 0) + (alreadyProcessed ? 0 : 1) },
          }
        }),
      /**
       * 拼卷 / 错题即练会话作答：只回写 records 与记忆曲线，不碰每日批次。
       * - 同日幂等：今日每日批次已推进过的题，拼卷再练不二次推 stage（DS D4 硬约束）。
       * - 不写 processedDaily / dailyDone / daily：拼卷是独立练习会话，完成度与每日批次分开统计。
       * - sched 无记录且做错：兜底进池；做对不新建调度。
       */
      applyPracticeResult: (qid, correct) =>
        set((s) => {
          const prev = s.records[qid]
          const rec: QRecord = {
            attempts: (prev?.attempts ?? 0) + 1,
            correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
            wrong: (prev?.wrong ?? 0) + (correct ? 0 : 1),
            // 与错题本同口径：做对不改 lastResult，题仍留在错题本里看解析
            lastResult: correct ? (prev?.lastResult ?? 'wrong') : 'wrong',
            lastAt: Date.now(),
          }
          const today = todayKey()
          let sched = s.sched
          const existing = sched[qid]
          // 同日幂等：今日每日批次已处理、或曲线已推进过，拼卷再练都不二次推 stage
          const already =
            (s.processedDaily[today] ?? []).includes(qid) || reviewedToday(existing, today)
          if (existing) {
            if (!already) {
              sched = { ...sched, [qid]: applyReview(existing, correct ? 'got' : 'wrong', today) }
            }
          } else if (!correct) {
            sched = bumpSched(sched, qid, today)
          }
          return { records: { ...s.records, [qid]: rec }, sched }
        }),
      addExam: (rec) =>
        set((s) => ({
          exams: [
            ...s.exams,
            { ...rec, id: rec.id ?? `exam-${Date.now()}`, ts: Date.now() },
          ].slice(-200),
        })),
      updateExam: (id, patch) =>
        set((s) => ({
          exams: s.exams.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        })),
      toggleFavorite: (qid) =>
        set((s) => {
          const prev = s.favorites[qid]
          return {
            favorites: {
              ...s.favorites,
              [qid]: { fav: !(prev?.fav ?? false), ts: Date.now(), note: prev?.note ?? '', noteAt: prev?.noteAt ?? 0 },
            },
          }
        }),
      setNote: (qid, note) =>
        set((s) => {
          const prev = s.favorites[qid]
          return {
            favorites: {
              ...s.favorites,
              [qid]: { fav: prev?.fav ?? false, ts: prev?.ts ?? 0, note, noteAt: Date.now() },
            },
          }
        }),

      /* -------------------- 每日错题（艾宾浩斯） -------------------- */

      recordReview: (qid, grade) =>
        set((s) => {
          const rec = s.sched[qid]
          if (!rec) return s
          const today = todayKey()
          // 幂等：同一题同一天只回写一次（双击 / 刷新重试不重复推进）
          if (rec.lastReviewedAt && rec.lastReviewedAt.slice(0, 10) === today) return s
          return {
            sched: { ...s.sched, [qid]: applyReview(rec, grade, today) },
            processedDaily: withProcessed(s.processedDaily, qid, today),
          }
        }),
      /**
       * 每日错题：点选项即判分，不再让用户事后自评。
       * - 答对 → applyReview('got')，推进一级
       * - 答错 → applyReview('wrong')，回退/顽固归零，明天再来
       * - 未答先「看答案」→ applyReview('peek')，不推进、不算作答
       * 幂等：同一天同题只写一次（答完重练不会重复推进或重复累计正确率）。
       */
      recordDailyAnswer: (qid, correct, grade) =>
        set((s) => {
          const rec = s.sched[qid]
          if (!rec) return s
          const today = todayKey()
          // 双保险：processedDaily 已记，或今日已推进过曲线（拼卷先做的场景），都不再二次推 stage
          if ((s.processedDaily[today] ?? []).includes(qid) || reviewedToday(rec, today)) return s
          const g: ReviewGrade = grade ?? (correct ? 'got' : 'wrong')
          const dailyDone = {
            ...s.dailyDone,
            [today]: { ...(s.dailyDone[today] ?? {}), [qid]: g },
          }
          // 「看答案」不是一次作答：不动 records（否则正确率分母被灌水），只把题拉回明天
          if (g === 'peek') {
            return {
              sched: { ...s.sched, [qid]: applyReview(rec, 'peek', today) },
              processedDaily: withProcessed(s.processedDaily, qid, today),
              dailyDone,
            }
          }
          const prev = s.records[qid]
          const qrec: QRecord = {
            attempts: (prev?.attempts ?? 0) + 1,
            correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
            wrong: (prev?.wrong ?? 0) + (correct ? 0 : 1),
            // 与错题本同口径：做对不改 lastResult，题仍留在错题本里看解析
            lastResult: correct ? (prev?.lastResult ?? 'wrong') : 'wrong',
            lastAt: Date.now(),
          }
          return {
            records: { ...s.records, [qid]: qrec },
            sched: { ...s.sched, [qid]: applyReview(rec, g, today) },
            processedDaily: withProcessed(s.processedDaily, qid, today),
            dailyDone,
            daily: { ...s.daily, [today]: (s.daily[today] ?? 0) + 1 },
          }
        }),
      skipReview: (qid) =>
        set((s) => {
          const rec = s.sched[qid]
          if (!rec || !rec.active) return s
          const today = todayKey()
          if ((s.processedDaily[today] ?? []).includes(qid)) return s
          return {
            sched: { ...s.sched, [qid]: applySkip(rec, today) },
            processedDaily: withProcessed(s.processedDaily, qid, today),
          }
        }),
      assignDaily: (qids) =>
        set((s) => {
          const today = todayKey()
          const merged = new Set([...(s.assignedDaily[today] ?? []), ...qids])
          return { assignedDaily: { ...s.assignedDaily, [today]: Array.from(merged) } }
        }),
      postponeDaily: (qids, days = 1) =>
        set((s) => {
          const today = todayKey()
          const next = { ...s.sched }
          for (const qid of qids) {
            const rec = next[qid]
            if (rec?.active) next[qid] = applyPostpone(rec, today, days)
          }
          return { sched: next }
        }),
      clearToday: () =>
        set((s) => {
          const today = todayKey()
          const list = s.assignedDaily[today] ?? []
          const processedToday = new Set([
            ...(s.processedDaily[today] ?? []),
            ...Object.keys(s.dailyDone[today] ?? {}),
          ])
          const next = { ...s.sched }
          for (const qid of list) {
            // 已作答的题保留它原本的复习安排；只把还没处理的题顺延到明天
            if (processedToday.has(qid)) continue
            const rec = next[qid]
            if (rec?.active) next[qid] = applyPostpone(rec, today, 1)
          }
          return {
            sched: next,
            // 空数组而非删 key：留着表示「今天已经安排过、被用户清空了」，避免自动重选
            assignedDaily: { ...s.assignedDaily, [today]: [] },
            processedDaily: { ...s.processedDaily, [today]: [] },
            // 判定也一并清掉，否则重开后旧的对错标签还会锁住卡片
            dailyDone: { ...s.dailyDone, [today]: {} },
          }
        }),

      importExistingWrong: () => {
        const today = todayKey()
        let added = 0
        set((s) => {
          const next = { ...s.sched }
          for (const [qid, rec] of Object.entries(s.records)) {
            if (next[qid]) continue
            if (!rec || rec.wrong <= 0) continue
            next[qid] = importSched(qid, today, rec.wrong)
            added++
          }
          return added > 0 ? { sched: next } : {}
        })
        return added
      },

      importExternalWrong: () => {
        const today = todayKey()
        // 题库还没加载完就导入，会把 51 条全当成「本库没有」并错误地打上已导入标记
        if (ALL_MAP.size === 0) return 0
        let added = 0
        set((s) => {
          if (s.externalImportedAt) return {}
          const records = { ...s.records }
          const sched = { ...s.sched }
          for (const { qid, tag } of EXTERNAL_WRONG) {
            // 拼错的题号、或本库未收录的那一套（2026 卷）直接跳过，不写脏记录
            if (!ALL_MAP.has(qid)) continue
            // 「不会」按错两次计、7 天窗口；「不熟」按错一次、14 天窗口
            const heavy = tag === '不会'
            if (!records[qid]) {
              records[qid] = {
                attempts: 1,
                correct: 0,
                wrong: heavy ? 2 : 1,
                lastResult: 'wrong',
                lastAt: Date.now(),
              }
            }
            if (!sched[qid]) {
              sched[qid] = importSched(
                qid,
                today,
                heavy ? 2 : 1,
                heavy ? '方法不会' : '概念模糊',
                heavy ? 7 : 14,
              )
              added++
            }
          }
          return { records, sched, externalImportedAt: today }
        })
        return added
      },

      resetAll: () =>
        set({
          records: {},
          daily: {},
          exams: [],
          favorites: {},
          sched: {},
          assignedDaily: {},
          processedDaily: {},
          dailyDone: {},
          externalImportedAt: '',
        }),
      exportJSON: () => {
        const s = get()
        return JSON.stringify({
          schema: '408lab-backup@1',
          exportedAt: new Date().toISOString(),
          records: s.records,
          sched: s.sched,
          favorites: s.favorites,
          exams: s.exams,
          processedDaily: s.processedDaily,
          assignedDaily: s.assignedDaily,
          externalImportedAt: s.externalImportedAt,
        })
      },
      importJSON: (json: string) => {
        try {
          const data = JSON.parse(json)
          if (data.schema !== '408lab-backup@1') throw new Error('格式不对')
          const cur = get()
          let ok = 0, skipped = 0
          const records = { ...cur.records }
          const sched = { ...cur.sched }
          const favorites = { ...cur.favorites }
          const assignedDaily = { ...cur.assignedDaily }
          const processedDaily = { ...cur.processedDaily }
          if (data.records && typeof data.records === 'object' && !Array.isArray(data.records)) {
            for (const [qid, rec] of Object.entries(data.records)) {
              if (!rec || typeof rec !== 'object' || typeof (rec as any).lastAt !== 'number') continue
              const existing = records[qid]
              if (!existing || (rec as any).lastAt > (existing as any).lastAt) {
                records[qid] = rec as any
                ok++
              } else skipped++
            }
          }
          if (data.sched && typeof data.sched === 'object' && !Array.isArray(data.sched)) {
            for (const [qid, sch] of Object.entries(data.sched)) {
              if (!sched[qid]) sched[qid] = sch as any
            }
          }
          if (data.favorites && typeof data.favorites === 'object' && !Array.isArray(data.favorites)) {
            for (const [qid, fav] of Object.entries(data.favorites)) {
              if (!favorites[qid]) favorites[qid] = fav as any
            }
          }
          const exams = Array.isArray(data.exams) ? [...cur.exams, ...data.exams.filter((e: any) => e && e.id)] : cur.exams
          // 每日安排 / 已处理按日期取并集：恢复备份不能把当天已经做过的题重新变回“未处理”，
          // 也不能用旧备份覆盖掉当天新安排的题。
          mergeDailyInto(assignedDaily, data.assignedDaily)
          mergeDailyInto(processedDaily, data.processedDaily)
          const externalImportedAt = pickNewerDate(cur.externalImportedAt, data.externalImportedAt)
          set({ records, sched, favorites, exams, assignedDaily, processedDaily, externalImportedAt })
          return { ok, skipped }
        } catch (e) {
          return { ok: 0, skipped: -1 }
        }
      },
    }),
    {
      // 写 localStorage 去抖：连点「做对/又错」时只落盘一次，
      // 但 pagehide 前强制 flush，避免丢最后一次进度。
      storage: createJSONStorage(() => createDebouncedStorage()),
      name: '408lab-progress-v1',
      // 进度是本地唯一副本，加版本号 + 兜底迁移，避免将来字段改名时静默丢数据。
      // 升级规则：结构不兼容时才 bump version，并在 migrate 里显式转换。
      version: 1,
      migrate: (persisted) => persisted as ProgressState,
      // 只持久化用户数据，不存 action 与临时态（否则每次改函数签名都会污染旧存档）
      partialize: (s) => ({
        records: s.records,
        exams: s.exams,
        favorites: s.favorites,
        sched: s.sched,
        assignedDaily: s.assignedDaily,
        processedDaily: s.processedDaily,
        dailyDone: s.dailyDone,
        packDone: s.packDone,
        packPick: s.packPick,
        packPrev: s.packPrev,
        externalImportedAt: s.externalImportedAt,
      }),
    },
  ),
)

/* ---------------- UI 视图路由（单页多视图 + hash 同步） ---------------- */

export type ViewId =
  | 'home'
  | 'questions'
  | 'practice'
  | 'exam'
  | 'wrong'
  | 'daily'
  | 'favorites'
  | 'notes'
  | 'stats'
  | 'about'

interface PracticeConfig {
  qids: string[]
  title: string
  /** 成套配额说明（科目/题型达成与不足标注），仅会话级展示，不持久化进 plan */
  note?: string
}

interface UIState {
  view: ViewId
  /** 错题本的「按年份」子页：非 null 时错题本显示该年真题的独立页面 */
  wrongYear: number | null
  /** 从首页/错题本点开的题目详情 */
  focusQid: string | null
  /** 预置的刷题会话（错题重练等） */
  practicePreset: PracticeConfig | null
  /** 题库视图的科目预置筛选 */
  questionsSubject: SubjectCode | 'all' | null
  /** 题库视图的搜索预置（经验笔记考点跳转） */
  questionsKeyword: string | null
  setView: (v: ViewId) => void
  openWrongYear: (year: number | null) => void
  openQuestion: (qid: string) => void
  setFocus: (qid: string | null) => void
  startPractice: (cfg: PracticeConfig) => void
  consumePracticePreset: () => PracticeConfig | null
  openQuestionsWith: (subject: SubjectCode | 'all') => void
  openQuestionsSearch: (keyword: string) => void
  consumeQuestionsSubject: () => SubjectCode | 'all' | null
  consumeQuestionsKeyword: () => string | null
}

export const useUI = create<UIState>((set, get) => ({
  view: 'home',
  wrongYear: null,
  focusQid: null,
  practicePreset: null,
  questionsSubject: null,
  questionsKeyword: null,
  setView: (v) => set({ view: v, focusQid: null }),
  openWrongYear: (year) =>
    set(year === null ? { wrongYear: null } : { view: 'wrong', wrongYear: year, focusQid: null }),
  openQuestion: (qid) => set({ view: 'questions', focusQid: qid }),
  setFocus: (qid) => set({ focusQid: qid }),
  startPractice: (cfg) => set({ view: 'practice', practicePreset: cfg, focusQid: null }),
  consumePracticePreset: () => {
    const p = get().practicePreset
    if (p) set({ practicePreset: null })
    return p
  },
  openQuestionsWith: (subject) => set({ view: 'questions', questionsSubject: subject, focusQid: null }),
  openQuestionsSearch: (keyword) =>
    set({ view: 'questions', questionsSubject: 'all', questionsKeyword: keyword, focusQid: null }),
  consumeQuestionsSubject: () => {
    const v = get().questionsSubject
    if (v) set({ questionsSubject: null })
    return v
  },
  consumeQuestionsKeyword: () => {
    const v = get().questionsKeyword
    if (v) set({ questionsKeyword: null })
    return v
  },
}))

/* ---------------- 派生统计（供各视图复用） ---------------- */

export function accuracyOf(rec: QRecord | undefined): number | null {
  if (!rec || rec.correct + rec.wrong === 0) return null
  return rec.correct / (rec.correct + rec.wrong)
}

export function isWrongEntry(rec: QRecord | undefined): boolean {
  if (!rec) return false
  return (
    (rec.lastResult === 'wrong' || rec.lastResult === 'unmastered') &&
    rec.wrong > 0
  )
}

/** 是否已收藏（多视图复用） */
export function isFavorited(fav: FavEntry | undefined): boolean {
  return fav?.fav === true
}

/** 收藏的题号列表（按收藏时间倒序） */
export function favoritedQids(favorites: Record<string, FavEntry>): string[] {
  return Object.entries(favorites)
    .filter(([, f]) => f.fav)
    .sort((a, b) => b[1].ts - a[1].ts)
    .map(([qid]) => qid)
}
