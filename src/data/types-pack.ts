/** 一日题包的数据结构（与 today-pack.ts 的 PACKS 配套） */
export type PackBlock = {
  /** 块名，例如「S1 计组 · 存储系统与数据表示」 */
  name: string
  /** 该块内的题号，顺序即展示顺序 */
  qids: string[]
}

export type Pack = {
  /** 本地日期 YYYY-MM-DD；只有等于今天才生效，过期自动忽略 */
  date: string
  title: string
  /** 顶部说明：本册范围、只做哪几小问等 */
  note?: string
  blocks: PackBlock[]
}
