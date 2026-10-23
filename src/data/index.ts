import type { Question, SubjectCode, Difficulty } from './types'

/**
 * 题库门面（lazy）。
 *
 * 真题 17 套 + 精选 320 + 模拟 470，序列化后约 3.4 MB JS。如果让它进首屏包，
 * 打开页面要先下载并解析完这 3.4 MB 才能显示任何东西。
 *
 * 这里把真正的大数组挪进 `./bank`，用动态 import 在首屏绘制之后才加载：
 * 首屏只带几百 KB 的壳，题库在空闲时灌进来。所有消费者的写法不用改——
 * 下面用 `export let` 持有数组引用，`loadBank()` 完成后重新赋值，
 * ESM 的 live binding 会让 `import { ALL_QUESTIONS }` 的模块读到新值。
 */

/** 一套可开考的整卷（真题年份卷或模拟卷） */
export interface PaperInfo {
  key: string
  title: string
  mock: boolean
  questions: Question[]
}

let ready = false
let loading: Promise<void> | null = null

export let QUESTIONS: Question[] = []
export let QUESTION_MAP: Map<string, Question> = new Map()
export let CURATED: Question[] = []
export let MOCKS: Question[] = []
export let MOCK_PAPERS: PaperInfo[] = []
export let ALL_QUESTIONS: Question[] = []
export let ALL_MAP: Map<string, Question> = new Map()
export let YEARS: number[] = []
export let TOTAL = 0
export let SINGLE_COUNT = 0
export let ALL_TOPICS: string[] = []

/** 题库是否已就绪（首帧为 false，加载完成后变 true） */
export function isBankReady(): boolean {
  return ready
}

/** 载入题库；并发调用共享同一个 Promise，重复调用直接返回 */
export function loadBank(): Promise<void> {
  if (ready) return Promise.resolve()
  if (loading) return loading
  loading = import('./bank').then((m) => {
    QUESTIONS = m.QUESTIONS
    QUESTION_MAP = m.QUESTION_MAP
    CURATED = m.CURATED
    MOCKS = m.MOCKS
    MOCK_PAPERS = m.MOCK_PAPERS
    ALL_QUESTIONS = m.ALL_QUESTIONS
    ALL_MAP = m.ALL_MAP
    YEARS = m.YEARS
    TOTAL = m.TOTAL
    SINGLE_COUNT = m.SINGLE_COUNT
    ALL_TOPICS = m.ALL_TOPICS
    ready = true
  })
  return loading
}

export function countBySubject(subject: SubjectCode): number {
  return QUESTIONS.filter((q) => q.subject === subject).length
}

export function countByYear(year: number): number {
  return QUESTIONS.filter((q) => q.year === year).length
}

export function topicsBySubject(subject: SubjectCode): string[] {
  const set = new Set<string>()
  QUESTIONS.forEach((q) => {
    if (q.subject === subject) set.add(q.topic)
  })
  return Array.from(set)
}

export interface QuestionFilter {
  subjects?: SubjectCode[]
  years?: number[]
  type?: 'all' | 'single' | 'application'
  difficulty?: Difficulty | 'all'
  source?: 'all' | 'real' | 'adapted' | 'curated' | 'mock'
  keyword?: string
  /** 限定题号白名单（收藏筛选等） */
  ids?: Set<string>
}

export function filterQuestions(f: QuestionFilter): Question[] {
  const kw = f.keyword?.trim().toLowerCase() ?? ''
  return ALL_QUESTIONS.filter((q) => {
    if (f.ids && !f.ids.has(q.id)) return false
    if (f.subjects && f.subjects.length > 0 && !f.subjects.includes(q.subject)) return false
    // 年份筛选仅对真题生效（精选/模拟题 year=0，指定年份时自动排除）
    if (f.years && f.years.length > 0 && !f.years.includes(q.year)) return false
    if (f.type && f.type !== 'all' && q.type !== f.type) return false
    if (f.difficulty && f.difficulty !== 'all' && q.difficulty !== f.difficulty) return false
    if (f.source && f.source !== 'all' && q.source !== f.source) return false
    if (kw) {
      const hay = `${q.question} ${q.topic} ${q.explanation}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
}

export function getQuestion(id: string): Question | undefined {
  return ALL_MAP.get(id)
}

export type { Question, SubjectCode, Difficulty }
