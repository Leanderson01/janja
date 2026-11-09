// Histórico de navegação do shell (botões Voltar/Avançar da barra de título).
// Funções puras sobre uma pilha com cursor: quem guarda o estado é o
// `SelectionProvider`. Os ids são strings porque a lib não depende do Convex.
export type NavEntry = {
  view: 'server' | 'home'
  serverId: string | null
  channelId: string | null
  dmChannelId: string | null
}

export type NavHistory = { entries: NavEntry[]; index: number }

export const MAX_HISTORY = 50

export const EMPTY_HISTORY: NavHistory = { entries: [], index: -1 }

function sameEntry(a: NavEntry, b: NavEntry): boolean {
  return (
    a.view === b.view &&
    a.serverId === b.serverId &&
    a.channelId === b.channelId &&
    a.dmChannelId === b.dmChannelId
  )
}

// Navegar descarta o "futuro" (o que estava à frente do cursor), ignora a
// mesma entrada seguida e guarda só as MAX_HISTORY últimas.
export function navPush(h: NavHistory, e: NavEntry): NavHistory {
  const current = h.entries[h.index]
  if (current && sameEntry(current, e)) return h
  const entries = [...h.entries.slice(0, h.index + 1), e].slice(-MAX_HISTORY)
  return { entries, index: entries.length - 1 }
}

export function navBack(h: NavHistory): { history: NavHistory; entry: NavEntry } | null {
  if (h.index <= 0) return null
  const index = h.index - 1
  return { history: { entries: h.entries, index }, entry: h.entries[index] }
}

export function navForward(h: NavHistory): { history: NavHistory; entry: NavEntry } | null {
  if (h.index >= h.entries.length - 1) return null
  const index = h.index + 1
  return { history: { entries: h.entries, index }, entry: h.entries[index] }
}

// Variantes que pulam entradas mortas (servidor/conversa que não existe mais):
// devolvem a entrada viva mais próxima na direção, ou null se não sobrou nenhuma.
function stepWhere(
  h: NavHistory,
  dir: -1 | 1,
  isLive: (e: NavEntry) => boolean
): { history: NavHistory; entry: NavEntry } | null {
  for (let i = h.index + dir; i >= 0 && i < h.entries.length; i += dir) {
    if (isLive(h.entries[i]))
      return { history: { entries: h.entries, index: i }, entry: h.entries[i] }
  }
  return null
}

export function navBackWhere(
  h: NavHistory,
  isLive: (e: NavEntry) => boolean
): { history: NavHistory; entry: NavEntry } | null {
  return stepWhere(h, -1, isLive)
}

export function navForwardWhere(
  h: NavHistory,
  isLive: (e: NavEntry) => boolean
): { history: NavHistory; entry: NavEntry } | null {
  return stepWhere(h, 1, isLive)
}
