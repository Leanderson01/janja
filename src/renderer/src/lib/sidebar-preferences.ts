// Preferência de quais seções da sidebar de canais estão recolhidas (Plano
// 08.5-08): estado de MÁQUINA, não de conta — o mesmo raciocínio de
// `voice-preferences.ts` (07-05) e `screenshare-preferences.ts` (08-05).
// Recolher a seção VOZ é uma escolha sobre o formato desta janela, neste
// monitor; ela não deve viajar junto com a conta para o notebook de 13" nem
// para o computador do trabalho. Por isso NÃO vai para o Convex: não é dado
// do usuário, é dado do lugar onde o app está aberto.
//
// Nota de escopo deliberada: a preferência é GLOBAL, não por servidor. O
// modelo de canal desta fase não tem categoria (as duas seções são derivadas
// do campo `type`), então "TEXTO" e "VOZ" significam a mesma coisa em todo
// servidor — guardar um mapa `serverId -> estado` só criaria chaves órfãs
// quando alguém sai de um servidor.

export type SidebarPreferences = {
  /** Seção TEXTO recolhida. `false` (o default) = expandida. */
  textCollapsed: boolean
  /** Seção VOZ recolhida. `false` (o default) = expandida. */
  voiceCollapsed: boolean
}

const STORAGE_KEY = 'janja:sidebar-preferences'

// Tudo expandido no primeiro uso: recolher é uma escolha, nunca o padrão.
// Abrir o app pela primeira vez e não encontrar os canais que você acabou de
// criar seria o pior estado inicial possível.
export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
  textCollapsed: false,
  voiceCollapsed: false
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function sanitize(raw: unknown): SidebarPreferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SIDEBAR_PREFERENCES

  const candidate = raw as Partial<Record<keyof SidebarPreferences, unknown>>

  return {
    textCollapsed: booleanOr(candidate.textCollapsed, DEFAULT_SIDEBAR_PREFERENCES.textCollapsed),
    voiceCollapsed: booleanOr(candidate.voiceCollapsed, DEFAULT_SIDEBAR_PREFERENCES.voiceCollapsed)
  }
}

// Nunca lança — `localStorage` ausente/corrompido/indisponível (modo privado,
// quota, ambiente sem DOM) sempre cai no default. Mesmo padrão defensivo dos
// outros dois módulos de preferência: esta função é chamada no primeiro
// render da sidebar, e uma exceção aqui derrubaria a árvore inteira da UI por
// causa de uma preferência cosmética.
export function loadSidebarPreferences(): SidebarPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SIDEBAR_PREFERENCES
    return sanitize(JSON.parse(raw))
  } catch {
    return DEFAULT_SIDEBAR_PREFERENCES
  }
}

// Faz merge com o valor persistido atual (não com o default), pelo mesmo
// motivo de `saveScreenSharePreferences`: aqui já existem DOIS campos, então
// sem o merge alternar a seção VOZ resetaria silenciosamente a seção TEXTO.
export function saveSidebarPreferences(partial: Partial<SidebarPreferences>): SidebarPreferences {
  const next = sanitize({ ...loadSidebarPreferences(), ...partial })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota excedida ou storage indisponível: a escolha só não persiste entre
    // reinícios, não deve derrubar a UI que chamou isto.
  }
  return next
}
