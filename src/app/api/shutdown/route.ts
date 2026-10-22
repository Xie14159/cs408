import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 仅允许本机来源，避免局域网内其他机器关掉服务 */
function isLocalHost(h: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(h)
}

export async function POST(req: NextRequest) {
  const host = req.headers.get('host') ?? ''
  const origin = req.headers.get('origin') ?? ''

  if (host && !isLocalHost(host)) {
    return NextResponse.json({ ok: false, error: '仅允许本机调用' }, { status: 403 })
  }
  // 浏览器跨站请求会带 Origin；非本机来源一律拒绝（也顺带挡掉 CSRF）
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) {
    return NextResponse.json({ ok: false, error: '非法来源' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || body.confirm !== 'shutdown') {
    return NextResponse.json({ ok: false, error: '缺少确认参数' }, { status: 400 })
  }

  // 先把响应发出去，再退出进程
  setTimeout(() => {
    process.exit(0)
  }, 300)

  return NextResponse.json({ ok: true })
}
