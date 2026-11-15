/**
 * 备份恢复时的纯合并逻辑，抽出来便于单独验证。
 * 语义：恢复备份只做并集，不删除当天已有的任何安排或已处理标记。
 */
export function mergeDailyInto(target: Record<string, string[]>, src: unknown): void {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return
  for (const [day, qids] of Object.entries(src as Record<string, unknown>)) {
    if (!Array.isArray(qids)) continue
    const valid = qids.filter((x): x is string => typeof x === 'string')
    target[day] = Array.from(new Set([...(target[day] ?? []), ...valid]))
  }
}

/** 两个 YYYY-MM-DD 取较新者；缺失的一方不参与比较。 */
export function pickNewerDate(current: string | undefined, incoming: unknown): string | undefined {
  if (typeof incoming !== 'string' || !incoming) return current
  if (current && current > incoming) return current
  return incoming
}
