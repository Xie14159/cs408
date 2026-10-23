'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SubjectCode } from '@/data/types'
import { EXTERNAL_WRONG } from '@/data/external-wrong'
import { ALL_MAP } from '@/data'
import {
  addDays,
  applyPostpone,
  applyReview,
  applySkip,
  createSched,
  importSched,
  type ReviewGrade,
  type WrongSched,
} from '@/lib/ebbinghaus'

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
  /** 外部错题本补登完成日期；非空表示已跑过，不再重复导入 */
  externalImportedAt: string
  submitAnswer: (qid: string, result: 'correct' | 'wrong') => void
  markApplication: (qid: string, mastered: boolean) => void
  addExam: (rec: Omit<ExamRecord, 'id' | 'ts'> & { id?: string }) => void
  updateExam: (id: string, patch: Partial<ExamRecord>) => void
  toggleFavorite: (qid: string) => void
  setNote: (qid: string, note: string) => void
  /** 每日错题回写：四档判定（一眼就会 / 想了一会儿 / 看解析才懂 / 又错），同一天幂等 */
  recordReview: (qid: string, grade: ReviewGrade) => void
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
}

function todayKey(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
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
    (set) => ({
      records: {},
      daily: {},
      exams: [],
      favorites: {},
      sched: {},
      assignedDaily: {},
      processedDaily: {},
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
          return { assignedDaily: { [today]: Array.from(merged) } }
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
          const next = { ...s.sched }
          for (const qid of list) {
            const rec = next[qid]
            if (rec?.active) next[qid] = applyPostpone(rec, today, 1)
          }
          return {
            sched: next,
            // 空数组而非删 key：留着表示「今天已经安排过、被用户清空了」，避免自动重选
            assignedDaily: { [today]: [] },
            processedDaily: { [today]: [] },
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
          externalImportedAt: '',
        }),
    }),
    {
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
}

interface UIState {
  view: ViewId
  /** 从首页/错题本点开的题目详情 */
  focusQid: string | null
  /** 预置的刷题会话（错题重练等） */
  practicePreset: PracticeConfig | null
  /** 题库视图的科目预置筛选 */
  questionsSubject: SubjectCode | 'all' | null
  /** 题库视图的搜索预置（经验笔记考点跳转） */
  questionsKeyword: string | null
  setView: (v: ViewId) => void
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
  focusQid: null,
  practicePreset: null,
  questionsSubject: null,
  questionsKeyword: null,
  setView: (v) => set({ view: v, focusQid: null }),
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
