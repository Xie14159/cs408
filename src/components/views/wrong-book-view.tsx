'use client'

import * as React from 'react'
import { BookX, Download, Eraser, ListChecks, RefreshCw, Save, Target, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { QuestionBody } from '@/components/question-body'
import { DifficultyBadge, SourceBadge, SubjectBadge, TopicBadge, YearBadge } from '@/components/badges'
import { getQuestion, QUESTION_MAP } from '@/data'
import { SUBJECTS, SUBJECT_ORDER } from '@/data/types'
import type { SubjectCode } from '@/data/types'
import { useProgress, useUI, isWrongEntry } from '@/lib/store'
import { priorityOrder, dateKey, toDay } from '@/lib/ebbinghaus'
import { selectBalancedPaper } from '@/lib/balanced-pack'
import type { BalancedPack, PackMeta } from '@/lib/balanced-pack'
import { buildWrongbookPayload, saveWrongbookToDisk } from '@/lib/wrongbook-export'
import { cn } from '@/lib/utils'

/** 题号（q-2009-36 → 36）；解析失败按 0 处理，不抛错也不打乱其他项 */
function qNum(qid: string): number {
  const n = Number(qid.split('-').pop())
  return Number.isFinite(n) ? n : 0
}

/** 配额说明：按科×题型列 actual/planned，池内不足格单独标注；未入选题一并提示 */
function buildQuotaNote(bal: BalancedPack): string {
  const parts = bal.plan
    .filter((r) => r.planned > 0 || r.actual > 0)
    .map(
      (r) =>
        `${SUBJECTS[r.subject].name}${r.type === 'application' ? '综合' : '单选'} ${r.actual}/${r.planned}`,
    )
  // unavailable = planned − quota：池里物理无题可选（非算法未选），才标注「池内不足」
  const short = bal.plan.filter((r) => r.unavailable > 0)
  const notes: string[] = parts
  if (short.length > 0) {
    notes.push(
      short
        .map(
          (r) =>
            `${SUBJECTS[r.subject].name}${r.type === 'application' ? '综合' : '单选'}池内不足（${r.actual}/${r.planned}）`,
        )
        .join('、'),
    )
  }
  if (bal.skipped > 0) notes.push(`${bal.skipped} 道题元数据缺失或非法，未入选`)
  return notes.filter(Boolean).join('；')
}

export function WrongBookView() {  const records = useProgress((s) => s.records)
  const sched = useProgress((s) => s.sched)
  const startPractice = useUI((s) => s.startPractice)
  const setView = useUI((s) => s.setView)
  const wrongYear = useUI((s) => s.wrongYear)
  const openWrongYear = useUI((s) => s.openWrongYear)

  const wrongQids = React.useMemo(
    () =>
      Object.entries(records)
        .filter(([, r]) => isWrongEntry(r))
        .sort((a, b) => b[1].lastAt - a[1].lastAt)
        .map(([qid]) => qid),
    [records],
  )

  // 只在「按科目」列表里用得到；进年份子页时不该为它再扫一遍
  const bySubject = React.useMemo(
    () =>
      SUBJECT_ORDER.map((code) => ({
        code,
        items: wrongQids.filter((qid) => QUESTION_MAP.get(qid)?.subject === code),
      })).filter((g) => g.items.length > 0),
    [wrongQids],
  )

  const [mode, setMode] = React.useState<'subject' | 'year'>('year')
  // 每科默认只渲染前 8 道：错题上百时，一次性铺开会把主线程占满（实测 61 道 = 2630 个 DOM 节点）
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})
  const PAGE = 8

  /* ---------------- 错题拼卷：勾选成卷 / 逾期优先自动成套 ---------------- */
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const [autoCount, setAutoCount] = React.useState(15)

  /** 题库里真实存在的错题（缺题不进卷） */
  const validQids = React.useMemo(
    () => wrongQids.filter((qid) => QUESTION_MAP.has(qid)),
    [wrongQids],
  )

  /** 题库元数据查不到的题不归类、不进卷（计入 skipped，由配额说明提示） */
  const metaOf = React.useCallback(
    (qid: string): PackMeta | undefined => {
      const q = QUESTION_MAP.get(qid)
      return q ? { subject: q.subject, type: q.type } : undefined
    },
    [],
  )

  /** 自动成套：有待巩固调度记录的按逾期优先排，无记录的历史错题排后补足；再按四科×题型配额切卷 */
  const balanced = React.useMemo(() => {
    const t = toDay(dateKey()) ?? 0
    const scheduled = validQids.filter((qid) => sched[qid]?.active)
    const rest = validQids.filter((qid) => !sched[qid])
    const ordered = [...priorityOrder(sched, scheduled, t), ...rest]
    return selectBalancedPaper(ordered, autoCount, metaOf)
  }, [validQids, sched, autoCount, metaOf])

  const autoQids = balanced.qids
  const quotaNote = React.useMemo(() => buildQuotaNote(balanced), [balanced])

  const togglePick = (qid: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(qid)) next.delete(qid)
      else next.add(qid)
      return next
    })
  }

  const pickedValid = React.useMemo(
    () => [...picked].filter((qid) => validQids.includes(qid)),
    [picked, validQids],
  )

  const startAutoPaper = () => {
    if (autoQids.length === 0) return
    startPractice({
      qids: autoQids,
      title: `错题成套 · 逾期优先 ${autoQids.length} 道`,
      note: quotaNote,
    })
  }
  const startPickedPaper = () => {
    if (pickedValid.length === 0) return
    startPractice({ qids: pickedValid, title: `错题拼卷 · 自选 ${pickedValid.length} 道` })
  }

  // 真题套卷：按年份（= 那一套卷）分组，年份倒序，便于一年一年复盘
  // 组内按题号升序（q-2009-36 → 36），这样一年错题按 1、2、3… 顺序摆，重练顺序也一致
  const byYear = React.useMemo(() => {
    const buckets = new Map<number, string[]>()
    for (const qid of wrongQids) {
      const y = QUESTION_MAP.get(qid)?.year ?? 0
      const list = buckets.get(y)
      if (list) list.push(qid)
      else buckets.set(y, [qid])
    }
    for (const list of buckets.values()) list.sort((a, b) => qNum(a) - qNum(b))
    return [...buckets.entries()].sort((a, b) => b[0] - a[0])
  }, [wrongQids])

  /**
   * 导出错题 JSON（下载文件）：把**所有做错过的题**（含已归档掌握）连同科目/章节/考点/调度一起落成文件。
   * 进度只存在浏览器 localStorage，导不出来就没法做跨设备分析或备份。
   * 注意：导出范围是全部做错过的题，不只是当前「待巩固」列表——已掌握的也要留档，
   * 否则备份是残缺的，也看不出「错过又掌握」的比例。
   * 载荷构造统一在 lib/wrongbook-export.ts，和「同步到本地」共用一份，避免两边字段漂移。
   */
  const exportWrong = React.useCallback(() => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    const payload = buildWrongbookPayload(records, sched)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `408Lab-错题-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [records, sched])

  /**
   * 同步到本机磁盘：POST /api/wrongbook → exports/wrongbook_latest.json + .md。
   * 豆包等本机工具直接读文件即可，不用再从浏览器下载一次。
   */
  const [syncState, setSyncState] = React.useState<{ at: number; count: number; error?: string } | null>(null)
  const [syncing, setSyncing] = React.useState(false)
  const syncToDisk = React.useCallback(async () => {
    if (Object.keys(records).length === 0) return
    // 题库是异步加载的：还没 ready 时题干/解析都是空的，这时候落盘等于写了个残缺文件
    if (QUESTION_MAP.size === 0) return
    setSyncing(true)
    const payload = buildWrongbookPayload(records, sched)
    const res = await saveWrongbookToDisk(payload)
    setSyncing(false)
    setSyncState({
      at: Date.now(),
      count: res.count ?? payload.items.length,
      error: res.ok ? undefined : res.error,
    })
  }, [records, sched])

  // 自动同步不在这里：它挂在 app-shell 的 <WrongbookAutoSync /> 上，
  // 这样在练习页/套卷页判分也会落盘，而不是只有打开错题本才同步。
  // 本页只保留手动「同步到本地」按钮，用于立即刷一次。

  // 进入/切换单年页时滚到顶部：view 仍是 'wrong'，外壳只在 view 变化时滚顶
  React.useEffect(() => {
    if (wrongYear !== null) window.scrollTo({ top: 0 })
  }, [wrongYear])

  if (wrongQids.length === 0) {
    return (
      <div className="flex flex-col items-center gap-5 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed text-muted-foreground/50">
          <BookX className="h-8 w-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">错题本是空的</h1>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            $ cat ./wrong-book.txt → (empty file)
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            答错的题目会自动收录到这里。先去刷几组题练练手？
          </p>
        </div>
        <Button className="gap-2" onClick={() => setView('practice')}>
          <Target className="h-4 w-4" />
          去刷题
        </Button>
      </div>
    )
  }

  // ---------- 单年详情页（#wrong/YYYY）----------
  if (wrongYear !== null) {
    const items = byYear.find(([y]) => y === wrongYear)?.[1] ?? []
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => {
                window.history.pushState(null, '', '#wrong')
                openWrongYear(null)
              }}
              className="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              ← 返回错题本
            </button>
            <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold">
              <YearBadge year={wrongYear} />
              {wrongYear > 0 ? `${wrongYear} 年真题错题` : '未标注年份错题'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              共 <b className="text-foreground tabular-nums">{items.length}</b> 道待巩固 · 只含这一套卷
            </p>
          </div>
          {items.length > 0 && (
            <Button
              className="gap-2 font-semibold"
              onClick={() =>
                startPractice({
                  qids: items,
                  title: wrongYear > 0 ? `${wrongYear} 年真题错题` : '未标注年份错题',
                })
              }
            >
              <RefreshCw className="h-4 w-4" />
              重练这一年
            </Button>
          )}
        </header>

        {items.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            这一年已经没有待巩固的错题了（重练答对后会自动移出）。
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {(expanded['year'] ? items : items.slice(0, PAGE)).map((qid) => (
              <WrongItem
                key={qid}
                qid={qid}
                checked={picked.has(qid)}
                onToggle={() => togglePick(qid)}
              />
            ))}
          </div>
        )}
        {items.length > PAGE && (
          <Button
            variant="outline"
            size="sm"
            className="w-full font-mono text-xs"
            onClick={() => setExpanded((e) => ({ ...e, year: !e.year }))}
          >
            {expanded['year'] ? '收起' : `显示剩余 ${items.length - PAGE} 道`}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-primary">$ cat ./wrong-book.txt</p>
          <h1 className="text-2xl font-bold">错题本</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            共 <b className="text-foreground tabular-nums">{wrongQids.length}</b> 道待巩固 · 重练答对后自动移出
          </p>
          {syncState && (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {syncState.error
                ? `本地同步失败：${syncState.error}`
                : `已同步 ${syncState.count} 条到 exports/wrongbook_latest.json · ${new Date(syncState.at).toLocaleTimeString('zh-CN', { hour12: false })}`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => void syncToDisk()}
            disabled={syncing}
            title="写到 D:\考研备考\408\zhenti\exports\wrongbook_latest.json 与 .md；豆包等本机工具可直接读，不用下载"
          >
            <Save className="h-4 w-4" />
            {syncing ? '同步中…' : '同步到本地'}
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={exportWrong}
            title="导出全部做错过的题（含已标记『已掌握』的），带科目/考点/调度/完整题干与解析；用于备份或交给 AI 分析"
          >
            <Download className="h-4 w-4" />
            导出错题 JSON
          </Button>
          <label>
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                const reader = new FileReader()
                reader.onload = () => {
                  const res = useProgress.getState().importJSON(String(reader.result))
                  if (res.skipped === -1) alert('导入失败：文件格式不对')
                  else alert(`导入完成：${res.ok}条，跳过${res.skipped}条（已有更新）`)
                }
                reader.readAsText(f)
              }}
            />
            <Button variant="outline" className="gap-2" asChild>
              <span><Upload className="h-4 w-4" /> 导入 JSON</span>
            </Button>
          </label>
          <Button className="gap-2 font-semibold" onClick={() => startPractice({ qids: wrongQids, title: '错题重练' })}>
            <RefreshCw className="h-4 w-4" />
            重练全部错题
          </Button>
          <div className="flex flex-wrap items-center gap-1.5">
            {[10, 15, 20, 30].map((n) => (
              <Button
                key={n}
                size="sm"
                variant={autoCount === n ? 'default' : 'outline'}
                className="h-7 px-2 font-mono text-xs"
                onClick={() => setAutoCount(n)}
              >
                {n}
              </Button>
            ))}
            <Button
              size="sm"
              variant={autoCount >= validQids.length ? 'default' : 'outline'}
              className="h-7 px-2 font-mono text-xs"
              onClick={() => setAutoCount(validQids.length)}
            >
              全部
            </Button>
          </div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={startAutoPaper}
            disabled={autoQids.length === 0}
            title="按逾期优先成套，并按四科×题型配额均分；某科/题型池内不足时少出并标注"
          >
            <Target className="h-4 w-4" />
            成套重练（{autoQids.length}）
          </Button>
          <Button
            className="gap-2 font-semibold"
            onClick={startPickedPaper}
            disabled={pickedValid.length === 0}
            title="把下方勾选的错题组成一套卷"
          >
            <ListChecks className="h-4 w-4" />
            自选成卷{pickedValid.length > 0 ? `（${pickedValid.length}）` : ''}
          </Button>
        </div>
        {autoQids.length > 0 && quotaNote && (
          <p className="w-full font-mono text-[11px] text-muted-foreground">{quotaNote}</p>
        )}
      </header>

      <div className="flex items-center gap-2" role="tablist" aria-label="错题分组方式">
        <Button
          size="sm"
          variant={mode === 'subject' ? 'default' : 'outline'}
          role="tab"
          aria-selected={mode === 'subject'}
          onClick={() => setMode('subject')}
        >
          按科目
        </Button>
        <Button
          size="sm"
          variant={mode === 'year' ? 'default' : 'outline'}
          role="tab"
          aria-selected={mode === 'year'}
          onClick={() => setMode('year')}
        >
          真题套卷
        </Button>
        {mode === 'year' && (
          <span className="font-mono text-xs text-muted-foreground">
            {byYear.length} 套 · 点年份展开
          </span>
        )}
      </div>

      {mode === 'subject' &&
        bySubject.map(({ code, items }) => (
          <section key={code} aria-label={SUBJECTS[code].name}>
            <div className="mb-3 flex items-center gap-2">
              <SubjectBadge subject={code as SubjectCode} />
              <span className="font-mono text-xs text-muted-foreground">{items.length} 题</span>
            </div>
            <div className="flex flex-col gap-3">
              {(expanded[code] ? items : items.slice(0, PAGE)).map((qid) => (
                <WrongItem
                key={qid}
                qid={qid}
                checked={picked.has(qid)}
                onToggle={() => togglePick(qid)}
              />
              ))}
            </div>
            {items.length > PAGE && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full font-mono text-xs"
                onClick={() => setExpanded((e) => ({ ...e, [code]: !e[code] }))}
              >
                {expanded[code] ? '收起' : `显示剩余 ${items.length - PAGE} 道`}
              </Button>
            )}
          </section>
        ))}

      {mode === 'year' && (
        <div className="flex flex-col gap-3">
          {byYear.map(([year, items]) => (
            <button
              key={year}
              type="button"
              onClick={() => {
                window.history.pushState(null, '', `#wrong/${year}`)
                // 年份页要铺一整页卡片，同样降级为可中断更新，点下去立刻有反应
                React.startTransition(() => openWrongYear(year))
              }}
              className="flex w-full items-center gap-3 rounded-lg border bg-card/40 px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-card"
            >
              <YearBadge year={year} />
              <span className="text-sm font-medium">
                {year > 0 ? `${year} 年真题` : '未标注年份'}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{items.length} 题</span>
              <span className="ml-auto font-mono text-xs text-primary">进入 ›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const WrongItem = React.memo(function WrongItem({
  qid,
  checked,
  onToggle,
}: {
  qid: string
  checked: boolean
  onToggle: () => void
}) {
  const q = getQuestion(qid)
  const rec = useProgress((s) => s.records[qid])
  const startPractice = useUI((s) => s.startPractice)
  const resolveWrongFromBook = useProgress((s) => s.resolveWrongFromBook)
  const masterQuestion = useProgress((s) => s.masterQuestion)
  const [open, setOpen] = React.useState(false)
  const [removed, setRemoved] = React.useState(false)
  const [justSolved, setJustSolved] = React.useState(false)

  if (!q || removed) return null

  return (
    <Card className={cn('cv-auto bg-card/90 p-4 transition-opacity', justSolved && 'opacity-60 border-emerald-500/50')}>
      {justSolved && (
        <p className="mb-2 font-mono text-xs text-emerald-600">✓ 已做对，记忆曲线已推进</p>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label="选入错题拼卷"
          title="选入错题拼卷"
          className="h-4 w-4 accent-primary"
        />
        <span className="font-mono text-xs text-muted-foreground/70">{q.id}</span>
        <YearBadge year={q.year} origin={q.origin} />
        <TopicBadge topic={q.topic} />
        <DifficultyBadge difficulty={q.difficulty} />
        <SourceBadge source={q.source} />
        <span className="ml-auto font-mono text-[11px] text-rose-600 dark:text-rose-400">
          错 {rec?.wrong ?? 0} 次
        </span>
      </div>
      <div className="mt-1">
        {open ? (
          <div className="rounded-lg border bg-muted/30 p-4">
            <QuestionBody
              key={`r-${q.id}`}
              q={q}
              mode="review"
              reviewSelected={undefined}
              onSubmit={(submitQid, correct) => {
                resolveWrongFromBook(submitQid, correct)
                if (correct) setJustSolved(true)
              }}
              onMastered={(submitQid) => {
                masterQuestion(submitQid)
                setRemoved(true)
              }}
            />
          </div>
        ) : (
          <QuestionBody
            key={`z-${q.id}`}
            q={q}
            mode="practice"
            onSubmit={(submitQid, correct) => {
              resolveWrongFromBook(submitQid, correct)
              if (correct) setJustSolved(true)
            }}
            onMastered={(submitQid) => {
              masterQuestion(submitQid)
              setRemoved(true)
            }}
          />
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 font-mono text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '收起' : '看答案'}
        </Button>
        <Button
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => startPractice({ qids: [qid], title: '单题重练' })}
        >
          <RefreshCw className="h-3 w-3" />
          重练
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 font-mono text-xs text-muted-foreground"
          onClick={() => {
            // 标记已掌握：记为 mastered 并归档，直接移出错题本与复习池
            masterQuestion(qid)
            setRemoved(true)
          }}
          title="手动移出错题本"
        >
          <Eraser className="h-3 w-3" />
          标记已掌握
        </Button>
      </div>
    </Card>
  )
})
