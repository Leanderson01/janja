/** Início da call = entrada da primeira pessoa que ainda está nela. */
export function callStartedAt(rows: { joinedAt: number }[]): number | null {
  if (rows.length === 0) return null
  return Math.min(...rows.map((r) => r.joinedAt))
}

/** `h:mm:ss`. Nunca negativo: relógio local adiantado em relação ao servidor vira `0:00:00`. */
export function formatCallDuration(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
