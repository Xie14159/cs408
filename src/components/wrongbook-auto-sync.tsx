'use client'

import * as React from 'react'
import { QUESTION_MAP } from '@/data'
import { useProgress } from '@/lib/store'
import { buildWrongbookPayload, saveWrongbookToDisk } from '@/lib/wrongbook-export'

/**
 * 全局错题落盘：挂在 app-shell 上，任何页面判分都会写 exports/wrongbook_latest.json。
 *
 * 之前这段逻辑写在 WrongBookView 里，而那个视图只在 view==='wrong' 时挂载，
 * 所以在练习页/套卷页判分根本不会触发同步——磁盘上的文件会一直是旧的。
 */
export function WrongbookAutoSync() {
  const records = useProgress((s) => s.records)
  const sched = useProgress((s) => s.sched)
  const lastSig = React.useRef('')
  const timer = React.useRef<number | null>(null)

  React.useEffect(() => {
    const entries = Object.entries(records)
    if (entries.length === 0) return

    // 指纹：题数 + 错/对次数 + 复习阶段 + 是否标了错因。
    // 只用长度会被「同一题又错一次」漏掉，全是数字运算，成本可忽略。
    let acc = 0
    for (const [qid, r] of entries) {
      const sc = sched[qid]
      acc += (r.wrong ?? 0) * 1000 + (r.correct ?? 0) * 10 + (sc?.stage ?? 0) + (sc?.errorTag ? 1 : 0)
    }
    const sig = `${entries.length}:${acc}`
    if (sig === lastSig.current) return

    const run = () => {
      // 题库异步加载：还没 ready 时题干/选项/解析都是空的，等它一会儿再写
      if (QUESTION_MAP.size === 0) {
        timer.current = window.setTimeout(run, 800)
        return
      }
      lastSig.current = sig
      void saveWrongbookToDisk(buildWrongbookPayload(records, sched))
    }

    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(run, 1500)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [records, sched])

  return null
}
