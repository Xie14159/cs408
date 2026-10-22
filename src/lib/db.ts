import { PrismaClient } from '@prisma/client'

// standalone 模式不会自动加载 .env：必须在启动前注入 DATABASE_URL（见 start.ps1）
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL 未设置：请在启动前注入环境变量（参考 start.ps1）')
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db