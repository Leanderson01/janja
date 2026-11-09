// Preferências de layout da JANELA, guardadas por máquina em `localStorage`
// (mesma justificativa de `voice-preferences.ts`: dependem do monitor e da
// janela de cada computador, não de quem está logado).

export type LayoutPreferences = {
  membersVisible: boolean
  channelListWidth: number
}

export const CHANNEL_LIST_MIN = 240
export const CHANNEL_LIST_MAX = 360
// Chão da área de conversa: o chat nunca fica com menos que isto.
export const CHAT_MIN = 400

// Colunas fixas que dividem a janela com a lista de canais e o chat.
const RAIL_WIDTH = 72
const MEMBERS_WIDTH = 240

const STORAGE_KEY = 'janja:layout-preferences'

const DEFAULT_LAYOUT_PREFERENCES: LayoutPreferences = {
  membersVisible: true,
  channelListWidth: CHANNEL_LIST_MIN
}

/**
 * Largura da lista de canais dentro de [240, 360] e, além disso, limitada para
 * que o chat mantenha 400px. Na janela mínima (900px) com membros abertos sobram
 * 188px, menos que o mínimo da lista: o mínimo vence, porque a lista não pode
 * ficar menor que 240.
 */
export function clampChannelListWidth(
  px: number,
  viewportWidth: number,
  membersVisible: boolean
): number {
  if (!Number.isFinite(px)) return CHANNEL_LIST_MIN
  const room = viewportWidth - RAIL_WIDTH - (membersVisible ? MEMBERS_WIDTH : 0) - CHAT_MIN
  const upper = Math.max(CHANNEL_LIST_MIN, Math.min(CHANNEL_LIST_MAX, room))
  return Math.round(Math.min(upper, Math.max(CHANNEL_LIST_MIN, px)))
}

function sanitize(raw: unknown): LayoutPreferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_LAYOUT_PREFERENCES

  const candidate = raw as Partial<Record<keyof LayoutPreferences, unknown>>
  const width = candidate.channelListWidth

  return {
    membersVisible:
      typeof candidate.membersVisible === 'boolean'
        ? candidate.membersVisible
        : DEFAULT_LAYOUT_PREFERENCES.membersVisible,
    channelListWidth:
      typeof width === 'number' && Number.isFinite(width)
        ? Math.min(CHANNEL_LIST_MAX, Math.max(CHANNEL_LIST_MIN, Math.round(width)))
        : DEFAULT_LAYOUT_PREFERENCES.channelListWidth
  }
}

// Nunca lança: `localStorage` ausente/corrompido/indisponível cai no default.
export function loadLayoutPreferences(): LayoutPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT_PREFERENCES
    return sanitize(JSON.parse(raw))
  } catch {
    return DEFAULT_LAYOUT_PREFERENCES
  }
}

export function saveLayoutPreferences(next: LayoutPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota excedida ou storage indisponível: a escolha só não sobrevive ao
    // reinício, não deve derrubar a UI que chamou isto.
  }
}
