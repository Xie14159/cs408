'use client'

import * as React from 'react'
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Moon,
  Plus,
  SkipForward,
  Sparkles,
  Trash2,
  X,
  Download,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { QuestionBody } from '@/components/question-body'
import { DifficultyBadge, SourceBadge, SubjectBadge, TopicBadge, YearBadge } from '@/components/badges'
import { getQuestion } from '@/data'
import { useProgress, useUI } from '@/lib/store'
import {
  ARCHIVE_STAGE,
  EBBINGHAUS_INTERVALS,
  STUBBORN_THRESHOLD,
  addDays,
  dateKey,
  dueDateOf,
  nextGapIfCorrect,
  selectDailyWrong,
  stageLabel,
  toDay,
  type WrongSched,
} from '@/lib/ebbinghaus'
import { cn } from '@/lib/utils'

/** 每日一次推 10 道（与拼好卷系统同参数） */
const DAILY_TARGET = 10

export function DailyView() {
  const sched = useProgress((s) => s.sched)
  const assignedMap = useProgress((s) => s.assignedDaily)
  const processedMap = useProgress((s) => s.processedDaily)
  const assignDaily = useProgress((s) => s.assignDaily)
  const clearToday = useProgress((s) => s.clearToday)
  const records = useProgress((s) => s.records)
  const importExistingWrong = useProgress((s) => s.importExistingWrong)
  const setView = useUI((s) => s.setView)

  // 错题本里已有、但还没进调度池的题（历史纸面错题靠它一次性补登）
  const importable = React.useMemo(() => {
    let n = 0
    for (const [qid, rec] of Object.entries(records)) {
      if (sched[qid]) continue
      if (rec && rec.wrong > 0) n++
    }
    return n
  }, [records, sched])

  const [importMsg, setImportMsg] = React.useState('')
  const doImport = () => {
    const n = importExistingWrong()
    setImportMsg(n > 0 ? `已导入 ${n} 道历史错题，按 14 天摊平排进曲线` : '没有可导入的错题')
  }

  const today = dateKey()
  const assigned = assignedMap[today]
  const processed = React.useMemo(
    () => new Set(processedMap[today] ?? []),
    [processedMap, today],
  )

  const topicOf = React.useCallback((qid: string) => getQuestion(qid)?.topic ?? '', [])

  // 当天第一次进入：按「到期优先」选一批并持久化。
  // assigned === undefined 才自动选；空数组表示今天已安排过、被用户清空了，不再自动补。
  React.useEffect(() => {
    if (assigned !== undefined) return
    const picked = selectDailyWrong({ sched, today, target: DAILY_TARGET, topicOf })
    if (picked.length > 0) assignDaily(picked)
  }, [assigned, sched, today, topicOf, assignDaily])

  const list = React.useMemo(() => assigned ?? [], [assigned])
  const pending = list.filter((qid) => !processed.has(qid))

  const stats = React.useMemo(() => {
    const t = toDay(today) ?? 0
    const tn = toDay(addDays(today, 1)) ?? 0
    let pool = 0
    let dueToday = 0
    let dueTomorrow = 0
    let archived = 0
    for (const rec of Object.values(sched)) {
      if (!rec.active || rec.wrongCount <= 0) {
        if (!rec.active && rec.stage >= ARCHIVE_STAGE) archived += 1
        continue
      }
      pool += 1
      const d = dueDateOf(rec, today)
      const dn = toDay(d) ?? 0
      if (dn <= t) dueToday += 1
      else if (dn <= tn) dueTomorrow += 1
    }
    return { pool, dueToday, dueTomorrow, archived }
  }, [sched, today])

  const startMore = () => {
    const picked = selectDailyWrong({
      sched,
      today,
      target: DAILY_TARGET,
      exclude: new Set(list),
      topicOf,
    })
    if (picked.length > 0) assignDaily(picked)
  }

  /* ------------------------------ 空状态 ------------------------------ */
  if (stats.pool === 0 && stats.archived === 0) {
    return (
      <div className="flex flex-col items-center gap-5 py-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed text-muted-foreground/50">
          <Moon className="h-8 w-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">错题池是空的</h1>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            $ python review.py --today → (empty pool)
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            答错的题会自动进池，第二天开始按记忆曲线回来找你。先去刷一组？
          </p>
        </div>
        <Button className="gap-2" onClick={() => setView('practice')}>
          去刷题
        </Button>
        {importable > 0 && (
          <Button
            variant="outline"
            className="gap-2 font-mono text-xs"
            onClick={doImport}
          >
            <Download className="h-4 w-4" />
            导入已有错题（{importable} 道）
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ------------------------------ 页头 ------------------------------ */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-primary">$ python review.py --today</p>
          <h1 className="text-2xl font-bold">每日错题 · 艾宾浩斯抗遗忘</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            到期优先、逾期越久越靠前；做对间隔拉长，做错隔天回炉。
          </p>
          {importMsg && (
            <p className="mt-2 font-mono text-xs text-primary">{importMsg}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {importable > 0 && (
            <Button
              variant="outline"
              className="gap-2 font-mono text-xs"
              onClick={doImport}
              title="把错题本里已有的错题按 14 天摊平登记进记忆曲线"
            >
              <Download className="h-4 w-4" />
              导入已有错题（{importable} 道）
            </Button>
          )}
          <Button variant="outline" className="gap-2 font-mono text-xs" onClick={startMore}>
            <Plus className="h-4 w-4" />
            今天做完了，再开 {DAILY_TARGET} 道
          </Button>
          <Button
            variant="ghost"
            className="gap-2 font-mono text-xs text-muted-foreground"
            onClick={() => clearToday()}
            title="剩余题顺延到明天，今日安排归零"
          >
            <Trash2 className="h-4 w-4" />
            清空今日
          </Button>
        </div>
      </header>

      {/* ------------------------------ 记忆曲线 ------------------------------ */}
      <Card className="bg-card/90 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">推题曲线</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              stage {ARCHIVE_STAGE} = 归档
            </span>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground">
            做错 → 明天重来 · 做对 → 间隔 ×2 递减推进
          </p>
        </div>
        <div className="mt-4 flex items-end gap-2 sm:gap-3">
          {EBBINGHAUS_INTERVALS.slice(1).map((days, i) => {
            const stage = i + 1
            return (
              <div key={stage} className="flex flex-1 flex-col items-center gap-1.5">
                <div
                  className="w-full rounded-t-md bg-primary/70"
                  style={{ height: `${12 + Math.log2(days + 1) * 9}px` }}
                  aria-hidden
                />
                <span className="font-mono text-[11px] font-semibold tabular-nums">{days}d</span>
                <span className="font-mono text-[10px] text-muted-foreground">S{stage}</span>
              </div>
            )
          })}
          <div className="flex flex-1 flex-col items-center gap-1.5">
            <div className="w-full rounded-t-md bg-emerald-500/70" style={{ height: '58px' }} aria-hidden />
            <span className="font-mono text-[11px] font-semibold">归档</span>
            <span className="font-mono text-[10px] text-muted-foreground">S{ARCHIVE_STAGE}</span>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          首次做对 → 2 天后；连对 5 轮累计 2→4→7→15→30 天，第 6 次做对归档。任何一次做错，
          阶段回退一级（顽固题直接归零），到期日一律拉回明天。
        </p>
      </Card>

      {/* ------------------------------ 概览 ------------------------------ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="待练池" value={stats.pool} hint="含今天与未来到期" />
        <Stat label="今日到期" value={stats.dueToday} hint="逾期越久越靠前" tone="rose" />
        <Stat label="今天已处理" value={processed.size} hint={`本批共 ${list.length} 道`} />
        <Stat label="明日到期" value={stats.dueTomorrow} hint={`已归档 ${stats.archived} 道`} tone="muted" />
      </div>

      {/* ------------------------------ 列表 ------------------------------ */}
      {pending.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <Check className="h-8 w-8 text-emerald-500" />
          <p className="text-lg font-semibold">
            {list.length === 0 ? '今天还没有安排' : '今天这批做完了'}
          </p>
          <p className="text-sm text-muted-foreground">
            {list.length === 0
              ? stats.dueToday > 0
                ? '点右上角「再开 10 道」重新抽一批。'
                : '今天没有到期题，休息也是复习的一部分。'
              : `回写了 ${processed.size} 道。想加练就点右上角「再开 ${DAILY_TARGET} 道」。`}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((qid, idx) => (
            <DailyItem key={qid} qid={qid} index={idx + 1} rec={sched[qid]} today={today} />
          ))}
        </div>
      )}

      {stats.archived > 0 && (
        <p className="text-center font-mono text-[11px] text-muted-foreground">
          已归档 {stats.archived} 道 · 归档题再答错会自动重新进池
        </p>
      )}
    </div>
  )
}

/* ------------------------------ 统计卡 ------------------------------ */

function Stat({
  label,
  value,
  hint,
  tone = 'primary',
}: {
  label: string
  value: number
  hint: string
  tone?: 'primary' | 'rose' | 'muted'
}) {
  return (
    <Card className="bg-card/90 p-3">
      <p className="font-mono text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-2xl font-bold tabular-nums',
          tone === 'rose' && 'text-rose-600 dark:text-rose-400',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </Card>
  )
}

/* ------------------------------ 单题卡 ------------------------------ */

function DailyItem({
  qid,
  index,
  rec,
  today,
}: {
  qid: string
  index: number
  rec: WrongSched | undefined
  today: string
}) {
  const q = getQuestion(qid)
  const recordReview = useProgress((s) => s.recordReview)
  const skipReview = useProgress((s) => s.skipReview)

  const [open, setOpen] = React.useState(false)
  if (!q || !rec) return null

  const due = dueDateOf(rec, today)
  const overdue = (toDay(today) ?? 0) - (toDay(due) ?? 0)
  const gap = nextGapIfCorrect(rec)
  const stubborn = rec.wrongCount >= STUBBORN_THRESHOLD

  return (
    <Card className="bg-card/90 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] text-muted-foreground/60">
          {String(index).padStart(2, '0')}
        </span>
        <span className="font-mono text-xs text-muted-foreground/70">{q.id}</span>
        <YearBadge year={q.year} origin={q.origin} />
        <SubjectBadge subject={q.subject} />
        <TopicBadge topic={q.topic} />
        <DifficultyBadge difficulty={q.difficulty} />
        <SourceBadge source={q.source} />
        <span className="ml-auto flex items-center gap-2 font-mono text-[11px]">
          <span className={cn('text-rose-600 dark:text-rose-400', stubborn && 'font-bold')}>
            错 {rec.wrongCount} 次
          </span>
          <span className="text-muted-foreground">
            {overdue > 0 ? `逾期 ${overdue} 天` : due === today ? '今天到期' : `到期 ${due.slice(5)}`}
          </span>
        </span>
      </div>

      <p className="line-clamp-2-safe text-sm text-foreground/85">{q.question}</p>

      {/* 阶段点 + 阶段文案 */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1" aria-label={stageLabel(rec.stage)}>
          {Array.from({ length: ARCHIVE_STAGE }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-2 w-2 rounded-full',
                i < rec.stage ? 'bg-primary' : 'bg-muted-foreground/25',
              )}
            />
          ))}
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
          {stageLabel(rec.stage)}
          {gap !== null ? ` · 做对推进到 +${gap} 天` : ' · 再做对一次即归档'}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 font-mono text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {open ? '收起' : '展开'}
        </Button>
        <Button
          size="sm"
          className="h-7 gap-1 bg-emerald-600 text-xs hover:bg-emerald-700"
          onClick={() => recordReview(qid, true)}
        >
          <Check className="h-3 w-3" />
          做对
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="h-7 gap-1 text-xs"
          onClick={() => recordReview(qid, false)}
        >
          <X className="h-3 w-3" />
          又错
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 font-mono text-xs text-muted-foreground"
          onClick={() => skipReview(qid)}
          title="不动阶段，明天继续推"
        >
          <SkipForward className="h-3 w-3" />
          没做
        </Button>
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground/60">
          <CalendarClock className="h-3 w-3" />
          入池 {rec.addedAt.slice(5)}
        </span>
      </div>

      {open && (
        <div className="mt-4 rounded-lg border bg-muted/30 p-4">
          <QuestionBody q={q} mode="review" reviewSelected={undefined} />
        </div>
      )}
    </Card>
  )
}
