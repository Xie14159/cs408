'use client'

import * as React from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronUp, Info, Undo2, X, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { QuestionBody } from '@/components/question-body'
import {
  DifficultyBadge,
  SourceBadge,
  SubjectBadge,
  TopicBadge,
  YearBadge,
} from '@/components/badges'
import { getQuestion } from '@/data'
import { packQids } from '@/data/today-pack'
import type { Pack } from '@/data/types-pack'
import { dueDay, toDay } from '@/lib/ebbinghaus'
import { useProgress } from '@/lib/store'
import { cn } from '@/lib/utils'

/**
 * 一日题包视图：只在 pack.date === 今天时由 DailyView 渲染。
 * 不读写 assignedDaily，不预写 sched；过期后这里整段不再进入，页面回到正常抽题。
 */
export function PackView({ pack, today, onExit }: { pack: Pack; today: string; onExit: () => void }) {
  const sched = useProgress((s) => s.sched)
  const doneMap = useProgress((s) => s.packDone[today])

  const all = React.useMemo(() => packQids(pack), [pack])
  const done = doneMap ?? {}
  const enrollPackAnswers = useProgress((s) => s.enrollPackAnswers)
  /** 是否展开今天已经清掉的题（默认不展开，避免做完的题一直占着列表） */
  const [showHidden, setShowHidden] = React.useState(false)

  /** 题号 -> 做题本里的原始序号；清掉后不重排，缺号就是已清掉 */
  const indexMap = React.useMemo(() => {
    const map = new Map<string, number>()
    all.forEach((qid, i) => map.set(qid, i + 1))
    return map
  }, [all])

  /** 今天已在别处处理：错题本/每日错题今天处理过的、已归档的；本页答过的题不隐藏，留在原位看对错 */
  const hidden = React.useMemo(() => {
    const set = new Set<string>()
    for (const qid of all) {
      const rec = sched[qid]
      // 已归档（含标记已掌握后归档、移出复习池）的题不再出现在今日题包
      if (rec && !rec.active) {
        set.add(qid)
        continue
      }
      // 本页已经答过的题不隐藏，保证答完还能核对对错；只隐藏今天在别处处理过的题
      if (!done[qid] && rec?.lastReviewedAt && rec.lastReviewedAt.slice(0, 10) === today) set.add(qid)
    }
    return set
  }, [all, sched, today, done])

  /** 今天做过的题自动登记进记忆曲线（做对的也登记）；已在池里的不重复登记 */
  React.useEffect(() => {
    if (!doneMap) return
    const answered = Object.keys(doneMap)
    if (answered.length === 0) return
    if (answered.every((qid) => sched[qid])) return
    enrollPackAnswers(today)
  }, [doneMap, sched, today, enrollPackAnswers])

  const stats = React.useMemo(() => {
    let correct = 0
    let wrong = 0
    const answeredSet = new Set<string>()
    for (const qid of all) {
      const r = done[qid]
      if (r === 'correct') {
        correct += 1
        answeredSet.add(qid)
      } else if (r === 'wrong') {
        wrong += 1
        answeredSet.add(qid)
      }
    }
    const answered = answeredSet.size
    // 按唯一 qid 过滤，避免某题同时 answered 和 hidden 时被扣两次
    const pending = all.filter((qid) => !answeredSet.has(qid) && !hidden.has(qid)).length
    return { answered, correct, wrong, pending }
  }, [all, done, hidden])

  /** 题包构成（按题库真实题型统计，避免把「第 43 题」写成 43 道题） */
  const composition = React.useMemo(() => {
    let single = 0
    let application = 0
    for (const qid of all) {
      const q = getQuestion(qid)
      if (q?.type === 'single') single += 1
      else if (q?.type === 'application') application += 1
    }
    return { single, application }
  }, [all])

  /** 已答且已经在调度池里的题数：用来确认「今天做过的题是否都进了曲线」 */
  const enrolled = React.useMemo(() => {
    let n = 0
    for (const qid of all) if (done[qid] && sched[qid]) n += 1
    return n
  }, [all, done, sched])

  // 今天原本到期的常规错题：pack 激活时不动它们，明天会作为逾期题回来
  const backlog = React.useMemo(() => {
    const t = toDay(today) ?? 0
    let n = 0
    for (const rec of Object.values(sched)) {
      if (!rec.active || rec.wrongCount <= 0) continue
      if (dueDay(rec, t) <= t) n += 1
    }
    return n
  }, [sched, today])

  const visibleBlocks = React.useMemo(
    () =>
      pack.blocks
        .map((b) => ({
          name: b.name,
          qids: showHidden ? b.qids : b.qids.filter((q) => !hidden.has(q)),
        }))
        .filter((b) => b.qids.length > 0),
    [pack, showHidden, hidden],
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-primary">$ python review.py --today --pack</p>
          <h1 className="text-2xl font-bold">今日题包 · {pack.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            今天临时用这份题单替换每日错题，<strong className="text-foreground">只今天生效</strong>
            ，明天自动恢复艾宾浩斯抽题。今天做过的题会自动登记进记忆曲线：做错的按错题优先排，
            做对的也会在两周内安排一轮复习。
          </p>
          {pack.note && (
            <p className="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <Info className="h-3 w-3 shrink-0" />
              {pack.note}
            </p>
          )}
          {backlog > 0 && (
            <p className="mt-1 font-mono text-xs text-muted-foreground/80">
              常规到期 {backlog} 道本次不推送，顺延回明天的正常抽题。
            </p>
          )}
          {hidden.size > 0 && (
            <button
              type="button"
              className="mt-2 flex items-center gap-1 font-mono text-xs font-semibold text-primary hover:underline"
              onClick={() => setShowHidden((v) => !v)}
            >
              {showHidden ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showHidden
                ? '收起已清掉的题'
                : `今天已在别处清掉 ${hidden.size} 道 · 点击显示`}
            </button>
          )}
        </div>
        <Button variant="outline" className="gap-2 font-mono text-xs" onClick={onExit}>
          <ArrowLeft className="h-3.5 w-3.5" />
          退出题包（看常规错题）
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PackStat
          label="本批"
          value={all.length}
          hint={
            composition.application > 0
              ? `${composition.single} 单选 + ${composition.application} 综合`
              : `${composition.single} 单选`
          }
        />
        <PackStat label="已答" value={stats.answered} hint={`已进曲线 ${enrolled} / ${stats.answered}`} />
        <PackStat label="待答" value={stats.pending} hint="答完留在列表，可核对对错" />
        <PackStat
          label="已错"
          value={stats.wrong}
          hint={stats.wrong > 0 ? '已自动进错题池' : '暂无'}
          tone={stats.wrong > 0 ? 'rose' : 'primary'}
        />
      </div>

      {stats.pending === 0 && !showHidden && (
        <Card className="border-dashed p-6 text-center">
          <p className="font-mono text-sm font-semibold">今日题包已全部处理完（{all.length} 道）</p>
          <p className="mt-1 text-xs text-muted-foreground">
            答过的题保留在下面，可以逐题核对对错和解析；明天打开会回到正常的艾宾浩斯抽题。
          </p>
        </Card>
      )}

      {visibleBlocks.map((block) => (
        <section key={block.name} className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold">{block.name}</h2>
            <span className="font-mono text-[11px] text-muted-foreground">{block.qids.length} 道</span>
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>
          {block.qids.map((qid) => (
            <PackItem key={qid} qid={qid} index={indexMap.get(qid) ?? 0} today={today} />
          ))}
        </section>
      ))}
    </div>
  )
}

function PackStat({
  label,
  value,
  hint,
  tone = 'primary',
}: {
  label: string
  value: number
  hint: string
  tone?: 'primary' | 'rose'
}) {
  return (
    <Card className="bg-card/90 p-3">
      <p className="font-mono text-[11px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-2xl font-bold tabular-nums',
          tone === 'rose' && 'text-rose-600 dark:text-rose-400',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </Card>
  )
}

function PackItem({ qid, index, today }: { qid: string; index: number; today: string }) {
  const q = getQuestion(qid)
  const result = useProgress((s) => s.packDone[today]?.[qid])
  const picked = useProgress((s) => s.packPick[today]?.[qid])
  const schedRec = useProgress((s) => s.sched[qid])
  const mastered = useProgress((s) => s.records[qid]?.lastResult === 'mastered')
  const recordPackAnswer = useProgress((s) => s.recordPackAnswer)
  const undoPackAnswer = useProgress((s) => s.undoPackAnswer)
  const retireQuestion = useProgress((s) => s.retireQuestion)

  const [open, setOpen] = React.useState(false)
  const [confirmUndo, setConfirmUndo] = React.useState(false)
  const [confirmRetire, setConfirmRetire] = React.useState(false)

  // 所有 hook 已在上方调用完，这里才可以条件返回
  if (!q) {
    return (
      <Card className="border-dashed p-4">
        <p className="font-mono text-xs text-rose-600 dark:text-rose-400">
          !! 题号 {qid} 在题库里找不到（第 {index} 题），请检查题包配置
        </p>
      </Card>
    )
  }

  const answered = result !== undefined || mastered
  // 已答后锁成 browse（选项不可再点、不直接露答案）；点「看答案」切 review
  const mode: 'practice' | 'browse' | 'review' = open ? 'review' : answered ? 'browse' : 'practice'

  return (
    <Card className={cn('cv-auto bg-card/90 p-4', answered && !open && 'opacity-90')}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs font-semibold text-muted-foreground/70">
          {String(index).padStart(2, '0')}
        </span>
        <span className="font-mono text-xs text-muted-foreground/70">{q.id}</span>
        <YearBadge year={q.year} origin={q.origin} />
        <SubjectBadge subject={q.subject} />
        <TopicBadge topic={q.topic} />
        <DifficultyBadge difficulty={q.difficulty} />
        <SourceBadge source={q.source} />
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px]">
          {result === 'correct' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
              <Check className="h-3 w-3" />已记录·对
            </span>
          )}
          {result === 'wrong' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 font-semibold text-rose-700 dark:text-rose-400">
              <X className="h-3 w-3" />已记录·错
            </span>
          )}
          {mastered && result === undefined && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-semibold text-muted-foreground">
              <Archive className="h-3 w-3" />已掌握
            </span>
          )}
          {!answered && <span className="text-muted-foreground/70">待答</span>}
          {answered && picked && (
            <span className="text-muted-foreground/80">你选了 {picked}</span>
          )}
        </span>
      </div>

      <QuestionBody
        key={answered ? 'done' : 'todo'}
        q={q}
        mode={mode}
        reviewSelected={picked}
        onSubmit={
          mode === 'practice'
            ? (id, correct, letter) => recordPackAnswer(today, id, correct, letter)
            : undefined
        }
      />

      {q.type === 'application' && (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          本册只做 (3)–(6) 四小问；对错按整题记录。
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 font-mono text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {open ? '收起' : '看答案'}
        </Button>
        {answered && (
          <>
            {confirmUndo ? (
              <>
                <span className="font-mono text-[11px] text-muted-foreground">撤销这次记录？</span>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 gap-1 text-xs"
                  onClick={() => {
                    undoPackAnswer(today, qid)
                    setConfirmUndo(false)
                    setOpen(false)
                  }}
                >
                  <Undo2 className="h-3 w-3" />
                  确认撤销
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setConfirmUndo(false)}
                >
                  取消
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 font-mono text-xs text-muted-foreground"
                onClick={() => setConfirmUndo(true)}
                title="回滚这道题的作答记录（含本次进池）"
              >
                <Undo2 className="h-3 w-3" />
                撤销
              </Button>
            )}
          </>
        )}
        {schedRec && (
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            {schedRec.active ? (
              confirmRetire ? (
                <>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    教材口径不一致，今后不再复习这道题？
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 text-xs"
                    onClick={() => {
                      retireQuestion(qid)
                      setConfirmRetire(false)
                    }}
                  >
                    确认移出
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setConfirmRetire(false)}
                  >
                    取消
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 font-mono text-xs text-muted-foreground"
                  onClick={() => setConfirmRetire(true)}
                  title="从复习池归档，不再安排到期复习"
                >
                  <Archive className="h-3 w-3" />
                  移出复习池
                </Button>
              )
            ) : (
              <span className="font-mono text-[11px] text-muted-foreground">已移出复习池</span>
            )}
          </span>
        )}
      </div>
    </Card>
  )
}
