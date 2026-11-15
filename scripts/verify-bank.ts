/**
 * 408 真题整卷校验脚本
 * 用法：
 *   bun scripts/verify-bank.ts --year 2010   只校验某一年
 *   bun scripts/verify-bank.ts               校验所有已存在的年份
 *   bun scripts/verify-bank.ts --strict      18 套（2009-2026）必须齐全
 */
import type { Question, SubjectCode, VisualSpec } from '../src/data/types'
import { TEMPLATES } from '../src/data/templates'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const QDIR = `${ROOT}/src/data/questions`
const ALL_YEARS = Array.from({ length: 18 }, (_, i) => 2009 + i)

const args = process.argv.slice(2)
const yearIdx = args.indexOf('--year')
const strict = args.includes('--strict')
const yearFilter = yearIdx >= 0 ? Number(args[yearIdx + 1]) : null

/**
 * 综合题 41–47 的科目并不按题号固定，不同年份顺序会变。
 * 这里只登记与默认蓝图（41–42 ds、43–44 co、45–46 os、47 cn）不同的年份，
 * 依据是各年官方卷面题干与标准答案的分科。
 */
const COMPREHENSIVE_SUBJECT_OVERRIDES: Record<number, Record<number, SubjectCode>> = {
  2014: { 41: 'ds', 42: 'ds', 43: 'cn', 44: 'co', 45: 'co', 46: 'os', 47: 'os' },
  2016: { 41: 'cn', 42: 'ds', 43: 'ds', 44: 'co', 45: 'co', 46: 'os', 47: 'os' },
  2019: { 41: 'ds', 42: 'ds', 43: 'os', 44: 'os', 45: 'co', 46: 'co', 47: 'cn' },
}

const SUBJECT_BY_NUMBER = (n: number, y: number): SubjectCode => {
  const override = COMPREHENSIVE_SUBJECT_OVERRIDES[y]?.[n]
  if (override) return override
  // 2009 年是 408 首年：ds 选择 1-10（20分），co 选择 11-22（24分）
  // 2010 年起：ds 选择 1-11（22分），co 选择 12-22（22分）
  const dsEnd = y === 2009 ? 10 : 11
  if (n >= 1 && n <= dsEnd) return 'ds'
  if (n >= dsEnd + 1 && n <= 22) return 'co'
  if (n >= 23 && n <= 32) return 'os'
  if (n >= 33 && n <= 40) return 'cn'
  if (n === 41 || n === 42) return 'ds'
  if (n === 43 || n === 44) return 'co'
  if (n === 45 || n === 46) return 'os'
  if (n === 47) return 'cn'
  return '' as SubjectCode
}

/** 默认按 ds=45, co=45, os=35, cn=25 校验 */
const SUBJECT_TOTAL_SCORES: Record<string, number> = { ds: 45, co: 45, os: 35, cn: 25 }

/**
 * 个别年份官方卷面的分科总分与通用蓝图有 2 分偏差，按官方试卷登记；
 * 未登记的年份仍走默认蓝图。2018、2025 均已逐题核对官方分值。
 */
const SUBJECT_TOTAL_OVERRIDES: Record<number, Record<string, number>> = {
  2018: { ds: 47, co: 45, os: 35, cn: 23 },
  2025: { ds: 45, co: 43, os: 37, cn: 25 },
}

const PLACEHOLDER_RE = /TODO|FIXME|待补充|此处省略|（略）|\(略\)|占位符|XXXX+|\?\?\?+/

/** 校验 visual 动画/图示规范（口径与 verify-mocks 一致） */
function checkVisual(v: VisualSpec | undefined, where: string, errs: string[], warns: string[]): boolean {
  if (!v) return false
  const w = `${where} visual`
  if (!v.title || v.title.length < 2) errs.push(`${w}: 缺少 title`)
  switch (v.kind) {
    case 'sort': {
      if (!v.frames || v.frames.length < 2) errs.push(`${w}: sort 至少 2 帧`)
      v.frames?.forEach((f, i) => {
        if (!f.arr || f.arr.length === 0) errs.push(`${w}[${i}]: arr 为空`)
        if (!f.note || f.note.length < 4) errs.push(`${w}[${i}]: note 过短`)
        if (f.range && (f.range[0] < 0 || f.range[1] >= (f.arr?.length ?? 0)))
          errs.push(`${w}[${i}]: range 越界`)
      })
      break
    }
    case 'tree': {
      if (!v.steps || v.steps.length < 2) errs.push(`${w}: tree 至少 2 步`)
      v.steps?.forEach((s, i) => {
        if (!s.nodes || s.nodes.length === 0) errs.push(`${w}[${i}]: nodes 为空`)
        const ids = new Set(s.nodes.map((n) => n.id))
        if (ids.size !== s.nodes.length) errs.push(`${w}[${i}]: 节点 id 重复`)
        s.nodes.forEach((n) => {
          if (n.parent && !ids.has(n.parent)) errs.push(`${w}[${i}]: 节点 ${n.id} 的 parent ${n.parent} 不在本步 nodes 中`)
          if (!n.label || n.label.length > 6) warns.push(`${w}[${i}]: 节点 ${n.id} label 过长（>6 字）`)
        })
        if (!s.note || s.note.length < 4) errs.push(`${w}[${i}]: note 过短`)
      })
      break
    }
    case 'graph': {
      if (!v.nodes || v.nodes.length < 2) errs.push(`${w}: nodes 至少 2 个`)
      if (!v.steps || v.steps.length < 2) errs.push(`${w}: steps 至少 2 步`)
      const ids = new Set(v.nodes?.map((n) => n.id) ?? [])
      v.nodes?.forEach((n) => {
        if (n.x < 0 || n.x > 100 || n.y < 0 || n.y > 100) errs.push(`${w}: 节点 ${n.id} 坐标越界（0-100）`)
      })
      v.edges?.forEach((e) => {
        if (!ids.has(e.from) || !ids.has(e.to)) errs.push(`${w}: 边 ${e.from}-${e.to} 引用不存在的节点`)
      })
      v.steps?.forEach((s, i) => {
        s.activeEdges?.forEach((k) => {
          const [f, t] = k.split('-')
          if (!ids.has(f) || !ids.has(t)) errs.push(`${w}[${i}]: activeEdge ${k} 引用不存在的节点`)
        })
        if (!s.note || s.note.length < 4) errs.push(`${w}[${i}]: note 过短`)
      })
      break
    }
    case 'pages': {
      if (!v.accesses || v.accesses.length < 4) errs.push(`${w}: accesses 至少 4 项`)
      if (!v.frames || v.frames < 1 || v.frames > 8) errs.push(`${w}: frames 应为 1-8`)
      if (!['FIFO', 'LRU', 'CLOCK', 'OPT'].includes(v.algo)) errs.push(`${w}: algo 非法`)
      break
    }
    case 'cwnd': {
      if (!v.points || v.points.length < 4) errs.push(`${w}: points 至少 4 项`)
      v.points?.forEach((p, i) => {
        if (p.cwnd < 1) errs.push(`${w}[${i}]: cwnd 应 ≥1`)
        if (i > 0 && p.round <= v.points[i - 1].round) errs.push(`${w}[${i}]: round 必须递增`)
      })
      break
    }
    case 'pipeline': {
      if (!v.stages || v.stages.length < 2) errs.push(`${w}: stages 至少 2 段`)
      if (!v.instrs || v.instrs.length < 2) errs.push(`${w}: instrs 至少 2 条`)
      let prev = -1
      v.instrs?.forEach((ins, i) => {
        if (ins.delay < 0) errs.push(`${w}[${i}]: delay 应 ≥0`)
        if (ins.delay < prev) errs.push(`${w}[${i}]: delay 应按序不减（顺序发射）`)
        prev = ins.delay
      })
      break
    }
    case 'seq': {
      if (!v.actors || v.actors.length < 2 || v.actors.length > 4) errs.push(`${w}: actors 应为 2-4 个`)
      const names = new Set(v.actors ?? [])
      if (!v.messages || v.messages.length < 2) errs.push(`${w}: messages 至少 2 条`)
      v.messages?.forEach((m, i) => {
        if (!names.has(m.from) || !names.has(m.to)) errs.push(`${w}[${i}]: from/to 必须是 actors 之一`)
        if (!m.label) errs.push(`${w}[${i}]: 缺 label`)
      })
      break
    }
    case 'flow': {
      if (!v.nodes || v.nodes.length < 3) errs.push(`${w}: nodes 至少 3 个`)
      const ids = new Set(v.nodes?.map((n) => n.id) ?? [])
      v.nodes?.forEach((n) => {
        if (!['start', 'proc', 'cond', 'end'].includes(n.type)) errs.push(`${w}: 节点 ${n.id} type 非法`)
        if (n.label && n.label.split('\n').some((l) => l.length > 14)) warns.push(`${w}: 节点 ${n.id} label 行过长`)
      })
      v.edges?.forEach((e, i) => {
        if (!ids.has(e.from) || !ids.has(e.to)) errs.push(`${w}: 边[${i}] 引用不存在的节点`)
      })
      if (!v.nodes?.some((n) => n.type === 'start')) warns.push(`${w}: 缺少 start 节点`)
      break
    }
    default:
      errs.push(`${w}: 未知 kind`)
  }
  return true
}

async function loadYear(y: number): Promise<{ c: Question[]; a: Question[] } | null> {
  // Windows 下 `${绝对路径}.ts` 不能直接丢给 import()，必须转成 file:// URL，
  // 否则会 throw 被 catch 吞成 null，所有年份都显示"未生成"——校验假通过。
  const cPath = `${QDIR}/y${y}-c.ts`
  const aPath = `${QDIR}/y${y}-a.ts`
  if (!existsSync(cPath) || !existsSync(aPath)) return null
  const c = (await import(pathToFileURL(cPath).href)) as Record<string, Question[]>
  const a = (await import(pathToFileURL(aPath).href)) as Record<string, Question[]>
  const cList = c[`y${y}c`]
  const aList = a[`y${y}a`]
  if (!Array.isArray(cList) || !Array.isArray(aList)) return null
  return { c: cList, a: aList }
}

function checkQuestion(q: Question, y: number, errs: string[], warns: string[]): void {
  const where = `q-${y}-${String(q.number).padStart(2, '0')}`
  if (q.id !== where) errs.push(`${where}: id 应为 ${where}，实际 ${q.id}`)
  if (q.year !== y) errs.push(`${where}: year 应为 ${y}`)
  if (typeof q.number !== 'number' || q.number < 1 || q.number > 47)
    errs.push(`${where}: 非法卷面题号 ${q.number}`)
  const expectSubj = SUBJECT_BY_NUMBER(q.number, y)
  if (q.subject !== expectSubj)
    errs.push(`${where}: 题号 ${q.number} 科目应为 ${expectSubj}，实际 ${q.subject}`)
  const expectType = q.number <= 40 ? 'single' : 'application'
  if (q.type !== expectType)
    errs.push(`${where}: 题号 ${q.number} 题型应为 ${expectType}，实际 ${q.type}`)
  if (!q.topic || q.topic.length > 10) warns.push(`${where}: topic 缺失或过长（${q.topic}）`)
  if (![1, 2, 3].includes(q.difficulty)) errs.push(`${where}: difficulty 非法`)
  if (!['real', 'adapted'].includes(q.source)) errs.push(`${where}: source 非法`)
  if (!q.question || q.question.length < 8) errs.push(`${where}: 题干过短`)
  if (PLACEHOLDER_RE.test(q.question) || PLACEHOLDER_RE.test(q.explanation ?? ''))
    errs.push(`${where}: 疑似占位文本`)
  // 单选题要求 explanation 为完整解析；综合题解答在 answerText，explanation 可为占位指针
  if (q.type === 'single' && (!q.explanation || q.explanation.length < 25))
    errs.push(`${where}: 解析过短`)

  if (q.type === 'single') {
    if (q.score !== 2) errs.push(`${where}: 单选 score 应为 2`)
    if (!q.options || q.options.length !== 4) errs.push(`${where}: 选项数应为 4`)
    if (!/^[A-D]$/.test(q.answer ?? '')) errs.push(`${where}: answer 非法（${q.answer}）`)
    if (q.answerText) warns.push(`${where}: 单选题不应有 answerText`)
  } else {
    if (typeof q.score !== 'number' || q.score <= 0) errs.push(`${where}: 综合 score 非法`)
    if (!q.answerText || q.answerText.length < 30)
      errs.push(`${where}: 综合题 answerText 缺失或过短`)
    if (q.options || q.answer) errs.push(`${where}: 综合题不应有 options/answer`)
  }

  // templateId 必须在注册表中
  if (q.templateId) {
    if (!TEMPLATES[q.templateId]) errs.push(`${where}: templateId '${q.templateId}' 不在模板注册表`)
    else if (TEMPLATES[q.templateId].subject !== q.subject)
      errs.push(`${where}: templateId '${q.templateId}' 学科不匹配（模板属 ${TEMPLATES[q.templateId].subject}）`)
  }
  checkVisual(q.visual, where, errs, warns)
}

async function main(): Promise<void> {
  const years = yearFilter ? [yearFilter] : ALL_YEARS
  const errors: string[] = []
  const warns: string[] = []
  const summaries: string[] = []
  const stemSeen = new Map<string, string>() // normalized -> "year-number"
  const idSeen = new Map<string, string>()
  let okCount = 0

  for (const y of years) {
    const data = await loadYear(y)
    if (!data) {
      if (strict || yearFilter) errors.push(`${y}: 数据文件缺失或导出名错误（y${y}c / y${y}a）`)
      else summaries.push(`${y}: —— 未生成（跳过）`)
      continue
    }
    const all = [...data.c, ...data.a]
    const yErrs: string[] = []
    const yWarns: string[] = []

    if (data.c.length !== 40) yErrs.push(`${y}: 单选数量 ${data.c.length} ≠ 40`)
    if (data.a.length !== 7) yErrs.push(`${y}: 综合题数量 ${data.a.length} ≠ 7`)

    const nums = all.map((q) => q.number).sort((x, z) => x - z)
    const expect = Array.from({ length: 47 }, (_, i) => i + 1)
    if (JSON.stringify(nums) !== JSON.stringify(expect))
      yErrs.push(`${y}: 卷面题号不是 1..47 连续（实际 ${nums.join(',')}）`)

    all.forEach((q) => checkQuestion(q, y, yErrs, yWarns))

    const totalScore = all.reduce((s, q) => s + (q.score ?? 0), 0)
    if (totalScore !== 150) yErrs.push(`${y}: 全卷分值 ${totalScore} ≠ 150`)
    for (const [subj, expect] of Object.entries(SUBJECT_TOTAL_OVERRIDES[y] ?? SUBJECT_TOTAL_SCORES)) {
      const s = all.filter((q) => q.subject === subj).reduce((x, q) => x + (q.score ?? 0), 0)
      if (s !== expect) yErrs.push(`${y}: ${subj} 学科总分 ${s} ≠ ${expect}`)
    }

    all.forEach((q) => {
      if (idSeen.has(q.id)) yErrs.push(`ID 重复：${q.id} 同时出现在 ${idSeen.get(q.id)} 和 ${y}`)
      idSeen.set(q.id, `${y}`)
      const norm = (q.question ?? '').replace(/[\s\p{P}]/gu, '').slice(0, 24)
      if (norm.length >= 20) {
        const prev = stemSeen.get(norm)
        if (prev && prev !== `${y}-${q.number}`)
          yWarns.push(`疑似跨年重复：${prev} 与 ${y}-${q.number} 题干前缀相同`)
        stemSeen.set(norm, `${y}-${q.number}`)
      }
    })

    if (yErrs.length === 0) {
      okCount++
      summaries.push(`${y}: 47 题（单选40 综合7）150 分 ✓`)
    } else {
      summaries.push(`${y}: ${yErrs.length} 处错误 ✗`)
      errors.push(...yErrs)
    }
    warns.push(...yWarns)
  }

  console.log('=== 408 题库校验 ===')
  summaries.forEach((s) => console.log(s))
  if (warns.length) {
    console.log(`\n--- 警告 ${warns.length} 条 ---`)
    warns.forEach((w) => console.log(`WARN  ${w}`))
  }
  if (errors.length) {
    console.log(`\n--- 错误 ${errors.length} 条 ---`)
    errors.forEach((e) => console.log(`ERROR ${e}`))
    process.exit(1)
  }
  console.log(`\nALL CHECKS PASSED（${okCount} 套整卷）`)
}

main()
