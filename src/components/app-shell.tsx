'use client'

import * as React from 'react'
import { Github, Menu, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { ReadingProgress } from '@/components/reading-progress'
import { ThemeToggle } from '@/components/theme-toggle'
import { AuthMenu } from '@/components/auth-menu'
import { ShutdownButton } from '@/components/shutdown-button'
import { useSyncBridge } from '@/lib/use-auth'
import { HomeView } from '@/components/views/home-view'
import { QuestionsView } from '@/components/views/questions-view'
import { PracticeView } from '@/components/views/practice-view'
import { ExamView } from '@/components/views/exam-view'
import { WrongBookView } from '@/components/views/wrong-book-view'
import { FavoritesView } from '@/components/views/favorites-view'
const NotesView = dynamic(() => import('@/components/views/notes-view').then((m) => m.NotesView), {
  loading: () => (
    <div className="py-24 text-center font-mono text-xs text-muted-foreground">
      $ loading notes ...
    </div>
  ),
})
import { StatsView } from '@/components/views/stats-view'
import { AboutView } from '@/components/views/about-view'
import { DailyView } from '@/components/views/daily-view'
import { ALL_QUESTIONS, isBankReady, loadBank } from '@/data'
import { useUI, useProgress } from '@/lib/store'
import dynamic from 'next/dynamic'
import type { ViewId } from '@/lib/store'
import { cn } from '@/lib/utils'

const NAV: Array<{ id: ViewId; label: string }> = [
  { id: 'home', label: '首页' },
  { id: 'questions', label: '题库' },
  { id: 'practice', label: '刷题训练' },
  { id: 'exam', label: '模拟考试' },
  { id: 'wrong', label: '错题本' },
  { id: 'daily', label: '每日错题' },
  { id: 'favorites', label: '收藏夹' },
  { id: 'notes', label: '经验笔记' },
  { id: 'stats', label: '数据统计' },
  { id: 'about', label: '关于' },
]

const VIEW_TITLES: Record<ViewId, string> = {
  home: '首页',
  questions: '题库 · 真题 + 精选 + 模拟卷',
  practice: '刷题训练',
  exam: '模拟考试',
  wrong: '错题本',
  daily: '每日错题 · 艾宾浩斯抗遗忘',
  favorites: '收藏夹',
  notes: '经验笔记',
  stats: '数据统计',
  about: '关于',
}

/** 单页应用外壳：hash 路由 + 页头页脚 + 顶部阅读进度条 */
export function AppShell() {
  const view = useUI((s) => s.view)
  const setView = useUI((s) => s.setView)
  const [menuOpen, setMenuOpen] = React.useState(false)

  // 账号初始化 + 云同步桥（登录状态下进度变化防抖推送）
  useSyncBridge()

  // 题库是 ~3.4 MB 的静态数据，不阻塞首屏：先画出外壳，空闲时再灌进来
  const [bankReady, setBankReady] = React.useState(isBankReady())
  React.useEffect(() => {
    if (isBankReady()) {
      setBankReady(true)
      return
    }
    let alive = true
    const run = () => {
      loadBank().then(() => {
        if (alive) setBankReady(true)
      })
    }
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    const hasIdle = typeof w.requestIdleCallback === 'function'
    const id = hasIdle ? w.requestIdleCallback!(run, { timeout: 1200 }) : window.setTimeout(run, 0)
    return () => {
      alive = false
      if (hasIdle) w.cancelIdleCallback?.(id)
      else window.clearTimeout(id)
    }
  }, [])

  // 一次性把外部错题本（不会 / 不熟）并入错题本与记忆曲线；标记写在 localStorage，只跑一次
  const externalImportedAt = useProgress((s) => s.externalImportedAt)
  const importExternalWrong = useProgress((s) => s.importExternalWrong)
  React.useEffect(() => {
    if (externalImportedAt || !bankReady) return
    importExternalWrong()
  }, [externalImportedAt, importExternalWrong, bankReady])

  // hash <-> view 双向同步
  React.useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace('#', '')
      if (NAV.some((n) => n.id === h)) setView(h as ViewId)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [setView])

  const prevView = React.useRef(view)
  React.useEffect(() => {
    if (prevView.current !== view) {
      window.scrollTo({ top: 0 })
      if (window.location.hash !== `#${view}`) {
        window.history.replaceState(null, '', `#${view}`)
      }
      document.title = `408Lab · ${VIEW_TITLES[view]}`
      prevView.current = view
    }
  }, [view])

  const go = (v: ViewId) => {
    setView(v)
    setMenuOpen(false)
  }

  return (
    <div className="flex min-h-screen flex-col">
      <ReadingProgress />

      {/* ================= 页头 ================= */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <button
            type="button"
            onClick={() => go('home')}
            className="flex items-center gap-2 font-mono text-sm font-bold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="回到首页"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Terminal className="h-4 w-4" />
            </span>
            <span>
              ~/408<span className="text-primary">Lab</span>
            </span>
          </button>

          {/* 桌面导航 */}
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="主导航">
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => go(n.id)}
                aria-current={view === n.id ? 'page' : undefined}
                className={cn(
                  'rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  view === n.id
                    ? 'font-medium text-foreground after:absolute'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {view === n.id && (
                  <span className="mr-1 font-mono text-[10px] text-primary">▸</span>
                )}
                {n.label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <AuthMenu />
            <a
              href="https://github.com/Xie14159/cs408"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub 仓库"
              className="hidden h-9 w-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:flex"
            >
              <Github className="h-4 w-4" />
            </a>
            <ShutdownButton />
            <ThemeToggle />

            {/* 移动端菜单 */}
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="md:hidden" aria-label="打开菜单">
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-64">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 font-mono">
                    <Terminal className="h-4 w-4 text-primary" /> ~/408Lab
                  </SheetTitle>
                </SheetHeader>
                <nav className="mt-2 flex flex-col gap-1 px-4" aria-label="移动端导航">
                  {NAV.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => go(n.id)}
                      aria-current={view === n.id ? 'page' : undefined}
                      className={cn(
                        'rounded-lg px-3 py-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                        view === n.id
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                    >
                      {n.label}
                    </button>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* ================= 主体 ================= */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 md:py-14">
        {bankReady ? (
          <>
            {view === 'home' && <HomeView />}
            {view === 'questions' && <QuestionsView />}
            {view === 'practice' && <PracticeView />}
            {view === 'exam' && <ExamView />}
            {view === 'wrong' && <WrongBookView />}
            {view === 'daily' && <DailyView />}
            {view === 'favorites' && <FavoritesView />}
            {view === 'notes' && <NotesView />}
            {view === 'stats' && <StatsView />}
            {view === 'about' && <AboutView />}
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 py-28 text-center">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            <p className="font-mono text-xs text-muted-foreground">
              $ loading question bank ...
            </p>
          </div>
        )}
      </main>

      {/* ================= 页脚（粘底） ================= */}
      <footer className="mt-auto border-t bg-card/40">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs text-muted-foreground">
              <span className="text-primary">$</span> echo "考研加油" && ./ship --offer
            </p>
            <p className="font-mono text-[11px] text-muted-foreground/70">
              {ALL_QUESTIONS.length || 1589} 道题 · 真题 2009–2025 · 登录后记录云端同步
            </p>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground/60">
            408Lab · 题库依据 2009–2026 年全国硕士研究生招生考试计算机学科专业基础综合（408）真题整理，
            含图题目已文本化改编，仅供个人备考学习。
          </p>
        </div>
      </footer>
    </div>
  )
}
