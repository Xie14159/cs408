'use client'

import * as React from 'react'

/**
 * 顶部阅读进度条：随页面滚动填充（程序员博客风）
 *
 * 性能约束：滚动时每帧都会触发 scroll 事件，所以
 * 1) 不用 state（避免整棵组件重渲染）；
 * 2) 不用 width（会触发布局），只改 transform: scaleX（合成层，零布局）；
 * 3) 事件里只登记 rAF，真正的计算每帧最多一次。
 */
export function ReadingProgress() {
  const barRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    let raf = 0

    const apply = () => {
      raf = 0
      const doc = document.documentElement
      const total = doc.scrollHeight - doc.clientHeight
      const progress = total > 0 ? Math.min(1, Math.max(0, doc.scrollTop / total)) : 0
      if (barRef.current) barRef.current.style.transform = `scaleX(${progress})`
    }

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply)
    }

    apply()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[60] h-[3px] bg-transparent"
      role="presentation"
    >
      <div
        ref={barRef}
        className="h-full origin-left scale-x-0 bg-gradient-to-r from-emerald-400 via-teal-400 to-amber-400 will-change-transform"
      />
    </div>
  )
}
