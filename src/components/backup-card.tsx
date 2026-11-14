'use client'

import * as React from 'react'
import { Database, Download, Upload, History, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useProgress } from '@/lib/store'

const BACKUP_PREFIX = '408lab-backup-'
const KEEP_BACKUPS = 7

function todayKey(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}${m}${day}`
}

/** 每日首开自动快照：写 localStorage['408lab-backup-YYYYMMDD']，留最近7份
 * 必须写 exportJSON 的结构化格式（schema=408lab-backup@1），
 * 不能直接存 zustand persist 的原始 blob —— 后者过不了 importJSON 的 schema 校验，
 * 会导致「快照能生成但恢复必失败」。force=true 用于恢复前强制留一份当前状态。 */
export function autoSnapshot(force = false) {
  if (typeof window === 'undefined') return
  try {
    const key = BACKUP_PREFIX + todayKey()
    if (!force && localStorage.getItem(key)) return // 今天已快照过
    // 直接从 persist 落盘值重建结构化快照：不依赖 store 是否已 hydrate，
    // 避免在应用刚启动、getState() 还是空对象时写出一份空备份。
    const rawProgress = localStorage.getItem('408lab-progress-v1')
    if (!rawProgress) return
    const raw = JSON.parse(rawProgress)
    const st = raw && typeof raw === 'object' ? (raw as any).state : null
    if (!st || typeof st !== 'object') return
    const snapshot = JSON.stringify({
      schema: '408lab-backup@1',
      exportedAt: new Date().toISOString(),
      records: st.records || {},
      sched: st.sched || {},
      favorites: st.favorites || {},
      exams: st.exams || [],
      processedDaily: st.processedDaily || {},
    })
    localStorage.setItem(key, snapshot)
    // 清理旧备份，保留最近7份
    const all = Object.keys(localStorage).filter((k) => k.startsWith(BACKUP_PREFIX))
    all.sort().reverse()
    for (const old of all.slice(KEEP_BACKUPS)) {
      localStorage.removeItem(old)
    }
  } catch {
    /* ignore */
  }
}

function listBackups(): string[] {
  if (typeof window === 'undefined') return []
  return Object.keys(localStorage)
    .filter((k) => k.startsWith(BACKUP_PREFIX))
    .sort()
    .reverse()
}

export function BackupCard() {
  const exportJSON = useProgress((s) => s.exportJSON)
  const importJSON = useProgress((s) => s.importJSON)
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [backups, setBackups] = React.useState<string[]>([])
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    autoSnapshot()
    setBackups(listBackups())
  }, [])

  const doExport = () => {
    const json = exportJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `408lab-backup-${todayKey()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImport = async (file: File) => {
    try {
      const text = await file.text()
      const result = importJSON(text)
      if (result.skipped === -1) {
        setMsg({ ok: false, text: '导入失败：文件格式不正确或数据损坏，未改动现有记录。' })
      } else {
        setMsg({ ok: true, text: `导入完成：合并 ${result.ok} 条，跳过 ${result.skipped} 条（较旧）。` })
        autoSnapshot()
        setBackups(listBackups())
      }
    } catch {
      setMsg({ ok: false, text: '导入失败：无法读取文件。' })
    }
  }

  const restoreBackup = (key: string) => {
    try {
      const data = localStorage.getItem(key)
      if (!data) return
      // 恢复前先快照当前状态，防误操作丢失进度（force 覆盖当日已存在的那份）
      autoSnapshot(true)
      let result = importJSON(data)
      if (result.skipped === -1) {
        // 兼容修复前的旧快照：当时存的是 zustand persist 原始 blob（{state:{...},version}）
        try {
          const raw = JSON.parse(data)
          const st = raw && typeof raw === 'object' ? (raw as any).state : null
          if (st && typeof st === 'object') {
            const migrated = JSON.stringify({
              schema: '408lab-backup@1',
              exportedAt: new Date().toISOString(),
              records: st.records || {},
              sched: st.sched || {},
              favorites: st.favorites || {},
              exams: st.exams || [],
              processedDaily: st.processedDaily || {},
            })
            result = importJSON(migrated)
          }
        } catch {
          /* 保持原始失败结果 */
        }
      }
      if (result.skipped === -1) {
        setMsg({ ok: false, text: '恢复失败：备份数据格式异常。' })
      } else {
        setMsg({ ok: true, text: `已从 ${key} 恢复：合并 ${result.ok} 条。` })
      }
    } catch {
      setMsg({ ok: false, text: '恢复失败：读取备份出错。' })
    }
  }

  return (
    <Card className="bg-card/90 p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <Database className="h-4 w-4 text-primary" />
        数据备份与恢复
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        所有进度保存在浏览器本地。换浏览器、清缓存前请先导出。每天首次打开会自动留一份快照（保留最近 {KEEP_BACKUPS} 天）。
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={doExport}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          <Download className="h-3.5 w-3.5" /> 导出备份 JSON
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <Upload className="h-3.5 w-3.5" /> 导入备份 JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) doImport(f)
            e.target.value = ''
          }}
        />
      </div>

      {msg && (
        <p className={`mt-3 rounded-md px-3 py-2 text-xs ${msg.ok ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
          {msg.text}
        </p>
      )}

      {backups.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <History className="h-3.5 w-3.5" /> 本地自动快照（{backups.length}）
          </h3>
          <ul className="space-y-1">
            {backups.map((b) => (
              <li key={b} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-muted-foreground">{b.replace(BACKUP_PREFIX, '')}</span>
                <button
                  onClick={() => restoreBackup(b)}
                  className="text-primary hover:underline"
                >
                  恢复到此版本
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
