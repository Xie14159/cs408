'use client'

import * as React from 'react'
import { GitFork, Github, Star } from 'lucide-react'
import { cn } from '@/lib/utils'

const GITHUB_REPO = '43aquarius/cs408' // 本站源码仓库
const FALLBACK = { stars: 0, forks: 0 }

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

interface RepoStats {
  stars: number
  forks: number
  live: boolean
  /** 缓存写入时间戳（仅 sessionStorage 缓存对象携带） */
  fetchedAt?: number
}

/** 实时 GitHub star / fork 计数（会话级缓存 + 静默降级） */
export function GithubCounters({ compact = false }: { compact?: boolean }) {
  const [stats, setStats] = React.useState<RepoStats | null>(null)

  React.useEffect(() => {
    const CACHE_KEY = `gh:${GITHUB_REPO}`
    try {
      const cached = sessionStorage.getItem(CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached) as RepoStats
        if (parsed.fetchedAt && Date.now() - parsed.fetchedAt < 10 * 60 * 1000) {
          setStats(parsed)
          return
        }
      }
    } catch {
      /* ignore */
    }

    let cancelled = false
    // 本机 github.com 可能被 DNS 劫持到黑洞地址，浏览器默认超时可达 60s+：
    // 加 3s 超时主动中止，直接落到 FALLBACK，别让请求一直挂着。
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 3000)
    fetch(`https://api.github.com/repos/${GITHUB_REPO}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('rate limit'))))
      .then((data) => {
        if (cancelled) return
        const s: RepoStats = {
          stars: data.stargazers_count ?? FALLBACK.stars,
          forks: data.forks_count ?? FALLBACK.forks,
          live: true,
          fetchedAt: Date.now(),
        } as RepoStats
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(s))
        } catch {
          /* ignore */
        }
        setStats(s)
      })
      .catch(() => {
        if (!cancelled) {
          setStats({ ...FALLBACK, live: false, fetchedAt: Date.now() })
        }
      })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [])

  const stars = stats?.stars ?? FALLBACK.stars
  const forks = stats?.forks ?? FALLBACK.forks

  return (
    <div className={cn('flex items-center gap-2', compact && 'gap-1.5')}>
      <a
        href={`https://github.com/${GITHUB_REPO}`}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex items-center gap-1.5 rounded-full border bg-card/80 px-3 py-1.5 font-mono text-xs shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
        title={`GitHub · ${GITHUB_REPO}`}
      >
        <Github className="h-3.5 w-3.5" />
        <Star className="h-3.5 w-3.5 text-amber-500 transition-transform group-hover:scale-125" />
        <span className="tabular-nums font-semibold">
          {stats ? formatCount(stars) : '···'}
        </span>
        <span className="text-muted-foreground">stars</span>
      </a>
      <a
        href={`https://github.com/${GITHUB_REPO}/forks`}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex items-center gap-1.5 rounded-full border bg-card/80 px-3 py-1.5 font-mono text-xs shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
        title="Forks"
      >
        <GitFork className="h-3.5 w-3.5 text-primary" />
        <span className="tabular-nums font-semibold">
          {stats ? formatCount(forks) : '···'}
        </span>
        <span className="text-muted-foreground">forks</span>
      </a>
      {!stats?.live && stats && (
        <span className="font-mono text-[10px] text-muted-foreground/60" title="GitHub API 受限，显示缓存数据">
          (cached)
        </span>
      )}
    </div>
  )
}
