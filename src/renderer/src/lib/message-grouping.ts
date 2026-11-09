import { formatDayLabel } from './message-time'

export const GROUP_WINDOW_MS = 7 * 60 * 1000

export type TimelineItem<T> =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'unread'; key: 'unread' }
  | { kind: 'message'; key: string; message: T; isGroupStart: boolean }

function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/**
 * Monta a linha do tempo: separador de data a cada dia novo, divisor NOVAS antes da primeira
 * não lida e `isGroupStart` por mensagem. Separador e divisor sempre quebram o grupo; autor
 * desconhecido (null) nunca agrupa. `messages` em ordem cronológica.
 */
export function buildTimeline<T>(
  messages: T[],
  opts: {
    getId(m: T): string
    getAuthorId(m: T): string | null
    getCreatedAt(m: T): number
    unreadMessageId?: string | null
  }
): TimelineItem<T>[] {
  const items: TimelineItem<T>[] = []
  let prev: T | null = null
  let broken = true

  for (const message of messages) {
    const at = opts.getCreatedAt(message)
    const id = opts.getId(message)
    if (prev === null || dayKey(opts.getCreatedAt(prev)) !== dayKey(at)) {
      items.push({ kind: 'day', key: `day-${dayKey(at)}`, label: formatDayLabel(at) })
      broken = true
    }
    if (opts.unreadMessageId != null && id === opts.unreadMessageId) {
      items.push({ kind: 'unread', key: 'unread' })
      broken = true
    }
    const author = opts.getAuthorId(message)
    const isGroupStart =
      broken ||
      prev === null ||
      author === null ||
      author !== opts.getAuthorId(prev) ||
      at - opts.getCreatedAt(prev) > GROUP_WINDOW_MS
    items.push({ kind: 'message', key: id, message, isGroupStart })
    broken = false
    prev = message
  }
  return items
}
