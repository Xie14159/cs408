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

/** FNV-1a：给 sched 做稳定指纹，用来判断「这次到底有没有变」 */
function hash(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function WrongbookAutoSync() {
  const records = useProgress((s) => s.records)
  const sched = useProgress((s) => s.sched)
  const lastSig = React.useRef('')
  const timer = React.useRef<number | null>(null)

  React.useEffect(() => {
    const entries = Object.entries(records)
    if (entries.length === 0) return

    // 指纹必须覆盖所有会影响导出的字段。
    // 曾经只统计 wrong/correct/stage/errorTag，结果「看了解析（peek）」「跳过」「推迟」
    // 只改 nextReviewAt 的操作不会触发同步，md 里的「下次复习」就一直是旧值。
    const sigParts = entries.map(([qid, r]) => {
      const sc = sched[qid]
      return `${qid}|${r.wrong}|${r.correct}|${r.attempts}|${r.lastAt}|${sc?.stage ?? ''}|${sc?.nextReviewAt ?? ''}|${sc?.lastReviewedAt ?? ''}|${sc?.errorTag ?? ''}|${sc?.active ?? ''}`
    })
    const sig = `${entries.length}:${hash(sigParts.join(';'))}`
    if (sig === lastSig.current) return

    const run = () => {
      // 题库异步加载：还没 ready 时题干/选项/解析都是空的，等它一会儿再写
      if (QUESTION_MAP.size === 0) {
        timer.current = window.setTimeout(run, 800)
        return
      }
      lastSig.current = sig
      void saveWrongbookToDisk(buildWrongbookPayload(records, sched)).then((res) => {
        // 之前这里 void 掉，失败完全静默：换个域名打开页面时会「什么都没发生」
        if (!res.ok) console.warn('[wrongbook] 同步到本地失败：', res.error)
      })
    }

    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(run, 1500)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [records, sched])

  return null
}
