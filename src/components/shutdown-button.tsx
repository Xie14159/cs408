'use client'

import * as React from 'react'
import { Power } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

/** 关闭后台 node 服务：调用 /api/shutdown，进程退出后页面仍停留在关闭提示页 */
export function ShutdownButton() {
  const [closed, setClosed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  async function shutdown(e: React.MouseEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await fetch('/api/shutdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'shutdown' }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${r.status}`)
      }
      setClosed(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '关闭失败')
      setBusy(false)
    }
  }

  if (closed) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background/95 px-6 text-center backdrop-blur">
        <p className="font-mono text-xs text-muted-foreground">
          <span className="text-primary">$</span> systemctl stop 408lab.service
        </p>
        <p className="text-xl font-semibold">服务已关闭</p>
        <p className="max-w-md text-sm text-muted-foreground">
          后台 node 进程已退出，现在可以直接关闭这个页面。
          下次从「开始菜单 → 408Lab 刷题系统」或任务栏图标启动。
        </p>
        <p className="max-w-md text-xs text-muted-foreground/70">
          学习进度保存在浏览器本地与账号同步中，未丢失。
        </p>
      </div>
    )
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭服务"
          title="关闭后台服务"
          className="text-muted-foreground hover:text-destructive"
        >
          <Power className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>关闭 408Lab 服务？</AlertDialogTitle>
          <AlertDialogDescription>
            会终止后台运行的 node 进程，浏览器页面将断开，需要重新启动才能继续刷题。
            学习进度保存在浏览器本地与账号同步中，不会丢失。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={shutdown} disabled={busy}>
            {busy ? '关闭中…' : '关闭服务'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
