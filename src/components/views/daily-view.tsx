'use client'

import * as React from 'react'
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Eraser,
  Moon,
  Plus,
  RefreshCw,
  SkipForward,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { QuestionBody } from '@/components/question-body'
import { DifficultyBadge, SourceBadge, SubjectBadge, TopicBadge, YearBadge } from '@/components/badges'
import { getQuestion } from '@/data'
import { getPackFor } from '@/data/today-pack'
import { PackView } from '@/components/views/pack-view'
import { useProgress, useUI } from '@/lib/store'
import {
  ARCHIVE_GOT_STREAK,
  ARCHIVE_STAGE,
  EBBINGHAUS_INTERVALS,
  REST_DUE_WINDOW,
  REST_MAX_FILL,
  STUBBORN_DAILY_LIMIT,
  STUBBORN_THRESHOLD,
  addDays,
  dateKey,
  dueDateOf,
  dueDay,
  nextGap,
  overdueDaysOf,
  priorityOrder,
  selectDailyWrong,
  stageLabel,
  toDay,
  type WrongSched,
} from '@/lib/ebbinghaus'
import { cn } from '@/lib/utils'

/** 每日一批 15 道：实测稳态约 12 道/天到期，10 道会每天欠 2 道；15 道约 10 分钟 */
const DAILY_TARGET = 15

export function DailyView() {
  const sched = useProgress((s) => s.sched)
  const assignedMap = useProgress((s) => s.assignedDaily)
  const processedMap = useProgress((s) => s.processedDaily)
  const dailyDone = useProgress((s) => s.dailyDone)
  const assignDaily = useProgress((s) => s.assignDaily)
  const clearToday = useProgress((s) => s.clearToday)
  const records = useProgress((s) => s.records)
  const importExistingWrong = useProgress((s) => s.importExistingWrong)
  const setView = useUI((s) => s.setView)
  const startPractice = useUI((s) => s.startPractice)
  const { toast } = useToast()

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
  /** 临时退出今日题包：本次会话内看常规错题，刷新后仍会回到题包（当天有效） */
  const [packOff, setPackOff] = React.useState(false)
  const doImport = () => {
    const n = importExistingWrong()
    setImportMsg(n > 0 ? `已导入 ${n} 道历史错题，按 14 天摊平排进曲线` : '没有可导入的错题')
  }

  const today = dateKey()
  /** 当天有题包就整页替换：不写 assignedDaily、不预写 sched，明天自然失效 */
  const pack = React.useMemo(() => (packOff ? null : getPackFor(today)), [packOff, today])
  const assigned = assignedMap[today]
  const processed = React.useMemo(
    () => new Set(processedMap[today] ?? []),
    [processedMap, today],
  )

  const topicOf = React.useCallback((qid: string) => getQuestion(qid)?.topic ?? '', [])

  // 当天第一次进入：按「到期优先」选一批并持久化。
  // assigned === undefined 才自动选；空数组表示今天已安排过、被用户清空了，不再自动补。
  React.useEffect(() => {
    if (pack) return
    if (assigned !== undefined) return
    const picked = selectDailyWrong({ sched, today, target: DAILY_TARGET, topicOf })
    if (picked.length > 0) assignDaily(picked)
  }, [pack, assigned, sched, today, topicOf, assignDaily])

  // 已归档/已掌握但还留在今日 assigned 里的题不再展示：否则点「标记已掌握」后刷新，
  // 这张卡会因为 processedDaily 没记而重新出现，还被算进未完成。
  // 例外：今天已经处理过的题保留（可能是刚答对触发了归档，得让用户看到判定和解析）。
  const list = React.useMemo(
    () =>
      (assigned ?? []).filter(
        (qid) => sched[qid] && (sched[qid].active !== false || processed.has(qid)),
      ),
    [assigned, sched, processed],
  )
  const pending = list.filter((qid) => !processed.has(qid))

  /**
   * 本批之外的待练错题：不占今日安排，按逾期优先排（逾期越久越靠前）。
   * 默认收起，展开后只渲染轻量行，点「练这道」进成套会话；作答回写曲线，不污染今日批次完成度。
   */
  const [showOther, setShowOther] = React.useState(false)
  const [otherLimit, setOtherLimit] = React.useState(20)
  const otherPool = React.useMemo(() => {
    const t = toDay(today) ?? 0
    const inBatch = new Set(list)
    const others: string[] = []
    for (const [qid, rec] of Object.entries(sched)) {
      if (!rec.active || rec.wrongCount <= 0) continue
      if (inBatch.has(qid)) continue
      // 折叠区只放到期/逾期题；还在间隔期内的题不提前拉出（DS D2）
      if (dueDay(rec, t) > t) continue
      if (!getQuestion(qid)) continue
      others.push(qid)
    }
    return priorityOrder(sched, others, t)
  }, [sched, list, today])
  const otherVisible = showOther ? otherPool.slice(0, otherLimit) : []

  /** 今天已处理（含「看答案」）；进度条把看答案单独标出来，避免显得全做完了 */
  const doneCount = React.useMemo(
    () => list.filter((qid) => processed.has(qid)).length,
    [list, processed],
  )
  const peekCount = React.useMemo(() => {
    let n = 0
    for (const qid of list) {
      if (processed.has(qid) && dailyDone[today]?.[qid] === 'peek') n += 1
    }
    return n
  }, [list, processed, dailyDone, today])
  const total = list.length
  const pct = total > 0 ? Math.min(100, Math.round((doneCount / total) * 100)) : 0

  /** 滚到某道题：卡片用 scroll-mt 给顶部留出吸顶空间 */
  const scrollToQid = React.useCallback((qid: string) => {
    requestAnimationFrame(() => {
      document.getElementById(`daily-q-${qid}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  /** 从第 idx 张往后找第一道还没处理的题；后面没有就回到前面找，全部做完返回 null */
  const goNextFrom = React.useCallback(
    (idx: number) => {
      const st = useProgress.getState()
      const proc = new Set(st.processedDaily[dateKey()] ?? [])
      const ok = (q: string) => !proc.has(q) && !!st.sched[q]
      const next = list.slice(idx + 1).find(ok) ?? list.find((q, i) => i !== idx && ok(q))
      if (next) scrollToQid(next)
      return next ?? null
    },
    [list, scrollToQid],
  )

  // 本批是怎么凑出来的：到期 / 顽固 / 新题 / 补位。15 是上限不是配额，
  // 补位被锁在「2 天内到期 + 每天 4 道」后，某些天就是凑不满。
  const breakdown = React.useMemo(() => {
    const t = toDay(today) ?? 0
    let due = 0
    let stubborn = 0
    let fresh = 0
    let fill = 0
    for (const qid of list) {
      const rec = sched[qid]
      if (!rec) continue
      if (dueDay(rec, t) <= t) due += 1
      else if (rec.wrongCount >= STUBBORN_THRESHOLD) stubborn += 1
      else if (rec.stage === 0 && !rec.lastReviewedAt && !rec.imported) fresh += 1
      else fill += 1
    }
    return { due, stubborn, fresh, fill }
  }, [list, sched, today])

  const stats = React.useMemo(() => {
    const t = toDay(today) ?? 0
    const tn = toDay(addDays(today, 1)) ?? 0
    let pool = 0
    let dueToday = 0
    let overdue = 0
    let dueTomorrow = 0
    let archived = 0
    let stubborn = 0
    for (const rec of Object.values(sched)) {
      if (!rec.active || rec.wrongCount <= 0) {
        if (!rec.active && rec.stage >= ARCHIVE_STAGE) archived += 1
        continue
      }
      pool += 1
      if (rec.wrongCount >= STUBBORN_THRESHOLD) stubborn += 1
      const d = dueDateOf(rec, today)
      const dn = toDay(d) ?? 0
      if (dn <= t) {
        dueToday += 1
        // 严格早于今天才算逾期；当天到期的留在「今日到期」里，避免重复计数
        if (dn < t) overdue += 1
      } else if (dn <= tn) dueTomorrow += 1
    }
    return { pool, dueToday, overdue, dueTomorrow, archived, stubborn }
  }, [sched, today])

  const startMore = () => {
    const picked = selectDailyWrong({
      sched,
      today,
      target: DAILY_TARGET,
      exclude: new Set(list),
      topicOf,
    })
    if (picked.length === 0) {
      toast({ title: '没有可追加的题', description: '到期题已经都在本批里了' })
      return
    }
    assignDaily(picked)
    toast({
      title: `已追加 ${picked.length} 道`,
      description:
        picked.length < DAILY_TARGET
          ? `池子里只够再抽 ${picked.length} 道，凑不满 ${DAILY_TARGET} 道`
          : undefined,
    })
  }

  /* --------------------------- 今日题包（仅当天） --------------------------- */
  // 放在所有 hook 之后、正常列表分支之前：pack 命中就整页替换，明天 getPackFor 返回 null 自动恢复
  if (pack) {
    return <PackView pack={pack} today={today} onExit={() => setPackOff(true)} />
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
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-primary">$ python review.py --today</p>
            <h1 className="text-2xl font-bold">每日错题</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              到期优先、逾期越久越靠前。<b className="text-foreground">点选项立即判分</b>，答对推进一级、答错隔天回炉。
            </p>
            {importMsg && <p className="mt-2 font-mono text-xs text-primary">{importMsg}</p>}
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
              再开一组（最多 {DAILY_TARGET} 道）
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  className="gap-2 font-mono text-xs text-muted-foreground"
                  title="剩余题顺延到明天，今日安排归零"
                >
                  <Trash2 className="h-4 w-4" />
                  清空今日
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>清空今日安排？</AlertDialogTitle>
                  <AlertDialogDescription>
                    本批还剩 {pending.length} 道没处理，会顺延到明天；今天的安排归零，且今天不再自动补题。
                    已答过的判定也会一并清掉，不能撤销。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => clearToday()}>确认清空</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* 本批进度：做题时一眼看到还剩几道 */}
        {list.length > 0 && (
          <div className="rounded-lg border bg-card/90 p-3">
            <div className="flex items-center justify-between gap-3 font-mono text-xs">
              <span className="text-muted-foreground">
                本批进度 <b className="tabular-nums text-foreground">{doneCount}/{total}</b>
                {peekCount > 0 && <span className="ml-1 opacity-70">（含看答案 {peekCount}）</span>}
              </span>
              <span className="text-muted-foreground">
                {pending.length > 0 ? `还剩 ${pending.length} 道` : '本批已处理完'}
              </span>
            </div>
            <Progress value={pct} className="mt-2 h-1.5" />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
              <span>到期 {breakdown.due}</span>
              <span>顽固 {breakdown.stubborn}</span>
              {breakdown.fresh > 0 && <span>新题 {breakdown.fresh}</span>}
              {breakdown.fill > 0 && <span>补位 {breakdown.fill}</span>}
              <span className="text-muted-foreground/60">
                {DAILY_TARGET} 是上限；补位只补 {REST_DUE_WINDOW} 天内到期、每天最多 {REST_MAX_FILL} 道
              </span>
              <details className="ml-auto">
                <summary className="cursor-pointer select-none text-muted-foreground/70 hover:text-foreground">
                  规则
                </summary>
                <p className="mt-1 max-w-md text-[11px] leading-relaxed">
                  走到第 {ARCHIVE_STAGE} 档、且连续 {ARCHIVE_GOT_STREAK} 次答对才归档。答错阶段回退一级（顽固题归零）、连对清零，到期日拉回明天。未作答先点「看答案」按「看了解析」处理：不推进、明天原样再来。
                </p>
              </details>
            </div>
          </div>
        )}

        {/* 概览：压成一行，把版面让给题目 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
          <span>
            待练 <b className="tabular-nums text-foreground">{stats.pool}</b>
          </span>
          <span>
            今日到期 <b className="tabular-nums text-rose-600 dark:text-rose-400">{stats.dueToday}</b>
          </span>
          <span>
            逾期 <b className="tabular-nums text-rose-600 dark:text-rose-400">{stats.overdue}</b>
          </span>
          <span>
            明日 <b className="tabular-nums text-foreground">{stats.dueTomorrow}</b>
          </span>
          <span>
            归档 <b className="tabular-nums text-foreground">{stats.archived}</b>
          </span>
          <span className="text-muted-foreground/60">顽固 {stats.stubborn} 道</span>
        </div>

        {/* 记忆曲线：折叠成一行，想看原理再展开 */}
        <details className="group rounded-lg border bg-card/90 px-3 py-2">
          <summary className="flex cursor-pointer select-none list-none items-center gap-2 text-xs">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-semibold">推题曲线</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {EBBINGHAUS_INTERVALS.slice(1, ARCHIVE_STAGE).join('d → ')}d → 归档
            </span>
            <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[11px] text-muted-foreground">
              答对 → 推进一级 · 答错 → 明天重来 · 未答先看答案 → 不推进
            </p>
            <span className="font-mono text-[11px] text-muted-foreground">
              stage {ARCHIVE_STAGE} = 归档
            </span>
          </div>
          <div className="mt-3 flex items-end gap-2 sm:gap-3">
            {EBBINGHAUS_INTERVALS.slice(1, ARCHIVE_STAGE).map((days, i) => {
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
            首次答对 → 2 天后；连对累计 2→4→7 天走完 {ARCHIVE_STAGE} 档，且最后要连续 {ARCHIVE_GOT_STREAK} 次答对才归档。任何一次答错，阶段回退一级（顽固题直接归零）、连对清零，到期日一律拉回明天。
          </p>
        </details>
      </header>

      {/* ------------------------------ 列表 ------------------------------ */}
      {list.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <Check className="h-8 w-8 text-emerald-500" />
          <p className="text-lg font-semibold">今天还没有安排</p>
          <p className="text-sm text-muted-foreground">
            {stats.dueToday > 0
              ? `点右上角「再开 ${DAILY_TARGET} 道」重新抽一批。`
              : '今天没有到期题，休息也是复习的一部分。'}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {pending.length === 0 && (
            <Card className="flex flex-col items-center gap-2 py-6 text-center">
              <Check className="h-7 w-7 text-emerald-500" />
              <p className="text-base font-semibold">今天这批做完了</p>
              <p className="text-sm text-muted-foreground">
                回写了 {doneCount} 道。答过的题留在下面，可以看答案和解析；想加练就点右上角「再开 {DAILY_TARGET} 道」。
              </p>
            </Card>
          )}
          {list.map((qid, idx) => {
            const nextQid =
              list.slice(idx + 1).find((q) => !processed.has(q) && sched[q]) ??
              list.find((q, i) => i !== idx && !processed.has(q) && sched[q])
            return (
              <DailyItem
                key={qid}
                qid={qid}
                index={idx + 1}
                rec={sched[qid]}
                today={today}
                processed={processed.has(qid)}
                hasNext={!!nextQid}
                onNext={() => goNextFrom(idx)}
              />
            )
          })}
        </div>
      )}

      {otherPool.length > 0 && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowOther((v) => !v)}
            className="flex w-full items-center gap-2 rounded-lg border bg-card/40 px-4 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-card"
          >
            {showOther ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">其他待练（逾期优先）</span>
            <span className="font-mono text-xs text-muted-foreground">{otherPool.length} 道</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">
              本批之外 · 不占今日安排
            </span>
          </button>
          {showOther && (
            <div className="flex flex-col gap-2">
              {otherVisible.map((qid) => (
                <OtherRow
                  key={qid}
                  qid={qid}
                  today={today}
                  onPractice={() => startPractice({ qids: [qid], title: '错题即练' })}
                />
              ))}
              {otherPool.length > otherLimit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full font-mono text-xs"
                  onClick={() => setOtherLimit(otherPool.length)}
                >
                  显示剩余 {otherPool.length - otherLimit} 道
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {stats.archived > 0 && (
        <p className="text-center font-mono text-[11px] text-muted-foreground">
          已归档 {stats.archived} 道 · 归档题再答错会自动重新进池
        </p>
      )}
    </div>
  )
}

/* ------------------------------ 其他待练轻量行 ------------------------------ */

function OtherRow({
  qid,
  today,
  onPractice,
}: {
  qid: string
  today: string
  onPractice: () => void
}) {
  const rec = useProgress((s) => s.sched[qid])
  const q = getQuestion(qid)
  if (!q || !rec) return null
  const t = toDay(today) ?? 0
  const od = overdueDaysOf(rec, t)
  const due = dueDateOf(rec, today)
  return (
    <Card className="flex flex-wrap items-center gap-2 bg-card/90 px-4 py-2.5">
      <span className="font-mono text-xs text-muted-foreground/70">{q.id}</span>
      <SubjectBadge subject={q.subject} />
      <TopicBadge topic={q.topic} />
      <span
        className={cn(
          'ml-auto font-mono text-[11px]',
          od > 0 ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-muted-foreground',
        )}
      >
        {od > 0 ? `逾期 ${od} 天` : `到期 ${due.slice(5)}`}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">错 {rec.wrongCount} 次</span>
      <Button size="sm" variant="outline" className="h-7 gap-1 font-mono text-xs" onClick={onPractice}>
        <RefreshCw className="h-3 w-3" />
        练这道
      </Button>
    </Card>
  )
}

/* ------------------------------ 单题卡 ------------------------------ */

function DailyItem({
  qid,
  index,
  rec,
  today,
  processed,
  hasNext,
  onNext,
}: {
  qid: string
  index: number
  rec: WrongSched | undefined
  today: string
  /** 今天已经处理过（答对 / 答错 / 看答案 / 没做）：刷新后仍要知道这张卡不该再答 */
  processed: boolean
  /** 本批后面还有没处理的题：决定要不要显示「下一题」 */
  hasNext: boolean
  /** 折叠当前卡并滚到下一道未处理 */
  onNext: () => void
}) {
  const q = getQuestion(qid)
  const recordDailyAnswer = useProgress((s) => s.recordDailyAnswer)
  const skipReview = useProgress((s) => s.skipReview)
  const masterQuestion = useProgress((s) => s.masterQuestion)
  const dailyGrade = useProgress((s) => s.dailyDone[today]?.[qid])

  const [open, setOpen] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  const [retry, setRetry] = React.useState(false)
  const [localResult, setLocalResult] = React.useState<'correct' | 'wrong' | null>(null)
  const [removed, setRemoved] = React.useState(false)
  /** 已处理的卡默认收成一行，把版面留给还没做的题；本会话刚答完仍展开，方便看解析 */
  const [collapsed, setCollapsed] = React.useState(processed)
  React.useEffect(() => {
    setOpen(false)
    setAttempt(0)
    setRetry(false)
    setLocalResult(null)
    setRemoved(false)
    // 按「今天是否已处理」决定初始折叠；不随 processed 变化重跑，否则刚答完就会立刻收起、看不到解析
    setCollapsed(processed)
  }, [qid])
  if (!q || !rec || removed) return null

  const due = dueDateOf(rec, today)
  const overdue = (toDay(today) ?? 0) - (toDay(due) ?? 0)
  const gapGot = nextGap(rec, 'got')
  const stubborn = rec.wrongCount >= STUBBORN_THRESHOLD

  /**
   * 卡片头部的判定以 store 的 dailyDone 为准；本会话刚答时 store 已同步写入。
   * 重练只做验证、不改变今天的判定，所以 localResult 不能覆盖已存在的 official grade，
   * 否则「peek 后重练答对」会在刷新后从 correct 变回 peek。
   */
  const officialGrade = retry ? undefined : dailyGrade
  const grade =
    officialGrade ??
    (retry ? undefined : localResult === 'correct' ? 'got' : localResult === 'wrong' ? 'wrong' : undefined)
  const answeredToday = processed || dailyGrade !== undefined || localResult !== null
  /** 答过就锁选项；「重练」先把本卡解锁、清掉上次选择再答一次 */
  const locked = answeredToday && !retry
  // 本会话刚答完仍留在 practice：选项锁死但解析立刻可见；刷新后才退回 browse（要解析就点「看答案」）
  const mode: 'practice' | 'browse' | 'review' =
    open ? 'review' : processed && localResult === null && !retry ? 'browse' : 'practice'

  // 已处理：默认收成一行，把版面留给还没做的题；点「展开解析」再回到完整卡
  if (collapsed && answeredToday) {
    return (
      <Card id={`daily-q-${qid}`} className="scroll-mt-24 bg-card/90 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-[11px] text-muted-foreground/60">
            {String(index).padStart(2, '0')}
          </span>
          <span className="font-mono text-xs text-muted-foreground/70">{q.id}</span>
          <SubjectBadge subject={q.subject} />
          <TopicBadge topic={q.topic} />
          <span className="flex items-center gap-2 font-mono text-[11px]">
            <DailyGradeBadge grade={grade} processed={processed} />
          </span>
          <span className="font-mono text-[11px] text-muted-foreground/70">{stageLabel(rec.stage)}</span>
          <span className="font-mono text-[11px] text-rose-600 dark:text-rose-400">
            错 {rec.wrongCount} 次
          </span>
          <span className="font-mono text-[11px] text-muted-foreground/60">
            {due === today ? '今天到期' : `下次 ${due.slice(5)}`}
          </span>
          {hasNext && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => onNext()}
            >
              下一题
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 gap-1 px-2 text-[11px]"
            onClick={() => setCollapsed(false)}
          >
            展开解析
            <ChevronDown className="h-3 w-3" />
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card
      id={`daily-q-${qid}`}
      className={cn('cv-auto scroll-mt-24 bg-card/90 p-4 transition-opacity', locked && 'opacity-80')}
    >
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
          {grade === 'got' && (
            <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
              <Check className="h-3 w-3" />答对
            </span>
          )}
          {grade === 'wrong' && (
            <span className="inline-flex items-center gap-0.5 rounded bg-rose-500/10 px-1.5 py-0.5 font-semibold text-rose-700 dark:text-rose-400">
              <X className="h-3 w-3" />答错
            </span>
          )}
          {grade === 'peek' && <span className="text-muted-foreground">已看答案</span>}
          {processed && !grade && <span className="text-muted-foreground">今日已处理</span>}
          <span className={cn('text-rose-600 dark:text-rose-400', stubborn && 'font-bold')}>
            错 {rec.wrongCount} 次
          </span>
          <span className="text-muted-foreground">
            {overdue > 0 ? `逾期 ${overdue} 天` : due === today ? '今天到期' : `到期 ${due.slice(5)}`}
          </span>
        </span>
      </div>

      <div className="mt-1">
        <QuestionBody
          key={`${qid}-${attempt}`}
          q={q}
          mode={mode}
          onSubmit={(id, correct) => {
            setLocalResult(correct ? 'correct' : 'wrong')
            setRetry(false)
            // 同一天同题只回写一次：答完再「重练」只验证，不重复推进曲线
            if (!processed && !dailyGrade) {
              recordDailyAnswer(id, correct, correct ? 'got' : 'wrong')
            }
          }}
        />
      </div>

      {localResult &&
        officialGrade &&
        officialGrade !== (localResult === 'correct' ? 'got' : 'wrong') && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            重练结果：{localResult === 'correct' ? '✓ 这次答对' : '✗ 这次答错'}
            <span className="ml-1 opacity-70">· 只验证，不改变今天的判定</span>
          </p>
        )}

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
          {gapGot === null
            ? ' · 再答对一次即归档'
            : ` · 答对 +${gapGot} 天 / 答错明天再来`}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 font-mono text-xs"
          onClick={() => {
            // 没作答就先看答案：记 peek，不推进曲线，明天原样再来
            if (!answeredToday && !open) recordDailyAnswer(qid, false, 'peek')
            setOpen((v) => !v)
          }}
        >
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {open ? '收起' : '看答案'}
        </Button>
        {answeredToday && (
          <Button
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              setAttempt((n) => n + 1)
              setRetry(true)
              setOpen(false)
              setLocalResult(null)
            }}
            title="原地重做一次，只验证不重复推进曲线"
          >
            <RefreshCw className="h-3 w-3" />
            重练
          </Button>
        )}
        {answeredToday && hasNext && (
          <Button
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              setCollapsed(true)
              onNext()
            }}
          >
            下一题
            <ArrowRight className="h-3 w-3" />
          </Button>
        )}
        {answeredToday && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 font-mono text-xs text-muted-foreground"
            onClick={() => setCollapsed(true)}
          >
            收起
            <ChevronUp className="h-3 w-3" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 font-mono text-xs text-muted-foreground"
          onClick={() => {
            masterQuestion(qid)
            setRemoved(true)
          }}
          title="不再安排复习，直接归档"
        >
          <Eraser className="h-3 w-3" />
          标记已掌握
        </Button>
        {!answeredToday && (
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
        )}
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground/60">
          <CalendarClock className="h-3 w-3" />
          入池 {rec.addedAt.slice(5)}
        </span>
      </div>
    </Card>
  )
}

/* ------------------------------ 判定标签 ------------------------------ */

/** 折叠摘要行与完整卡共用的一套判定标签 */
function DailyGradeBadge({ grade, processed }: { grade?: string; processed: boolean }) {
  if (grade === 'got') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
        <Check className="h-3 w-3" />答对
      </span>
    )
  }
  if (grade === 'wrong') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded bg-rose-500/10 px-1.5 py-0.5 font-semibold text-rose-700 dark:text-rose-400">
        <X className="h-3 w-3" />答错
      </span>
    )
  }
  if (grade === 'peek') return <span className="text-muted-foreground">已看答案</span>
  if (processed) return <span className="text-muted-foreground">今日已处理</span>
  return null
}
