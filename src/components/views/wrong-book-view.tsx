'use client'

import * as React from 'react'
import { BookX, Eraser, RefreshCw, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { QuestionBody } from '@/components/question-body'
import { DifficultyBadge, SourceBadge, SubjectBadge, TopicBadge, YearBadge } from '@/components/badges'
import { getQuestion, QUESTION_MAP } from '@/data'
import { SUBJECTS, SUBJECT_ORDER } from '@/data/types'
import type { SubjectCode } from '@/data/types'
import { useProgress, useUI, isWrongEntry } from '@/lib/store'
import { cn } from '@/lib/utils'

export function WrongBookView() {
  const records = useProgress((s) => s.records)
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

  const bySubject = SUBJECT_ORDER.map((code) => ({
    code,
    items: wrongQids.filter((qid) => QUESTION_MAP.get(qid)?.subject === code),
  })).filter((g) => g.items.length > 0)

  const [mode, setMode] = React.useState<'subject' | 'year'>('subject')

  // 真题套卷：按年份（= 那一套卷）分组，年份倒序，便于一年一年复盘
  const byYear = React.useMemo(() => {
    const buckets = new Map<number, string[]>()
    for (const qid of wrongQids) {
      const y = QUESTION_MAP.get(qid)?.year ?? 0
      const list = buckets.get(y)
      if (list) list.push(qid)
      else buckets.set(y, [qid])
    }
    return [...buckets.entries()].sort((a, b) => b[0] - a[0])
  }, [wrongQids])

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
            {items.map((qid) => (
              <WrongItem key={qid} qid={qid} />
            ))}
          </div>
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
        </div>
        <Button className="gap-2 font-semibold" onClick={() => startPractice({ qids: wrongQids, title: '错题重练' })}>
          <RefreshCw className="h-4 w-4" />
          重练全部错题
        </Button>
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
              {items.map((qid) => (
                <WrongItem key={qid} qid={qid} />
              ))}
            </div>
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
                openWrongYear(year)
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

function WrongItem({ qid }: { qid: string }) {
  const q = getQuestion(qid)
  const rec = useProgress((s) => s.records[qid])
  const startPractice = useUI((s) => s.startPractice)
  const submitAnswer = useProgress((s) => s.submitAnswer)
  const [open, setOpen] = React.useState(false)
  const [removed, setRemoved] = React.useState(false)

  if (!q || removed) return null
  const solved = rec ? rec.correct > 0 && rec.lastResult !== 'wrong' && rec.lastResult !== 'unmastered' : false

  return (
    <Card className={cn('bg-card/90 p-4 transition-opacity', solved && 'opacity-60')}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
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
            <QuestionBody q={q} mode="review" reviewSelected={undefined} />
          </div>
        ) : (
          <QuestionBody q={q} mode="browse" />
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
            // 标记已掌握：以“答对”覆盖最近结果
            submitAnswer(qid, 'correct')
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
}
