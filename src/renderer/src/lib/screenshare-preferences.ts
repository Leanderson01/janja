// Preferência de qualidade do compartilhamento de tela (Plano 08-05,
// SHARE-08): estado de MÁQUINA, não de conta — exatamente o mesmo raciocínio
// de `voice-preferences.ts` (07-05). O mesmo usuário tem upload doméstico
// diferente em cada computador: o desktop na fibra aguenta 1080p, o notebook
// no 4G da casa da mãe não. Guardar isso no Convex faria a escolha viajar
// junto com a conta para a máquina errada.
//
// A escolha vale para a PRÓXIMA vez que compartilhar: `startScreenShare()`
// (voice-context.tsx) relê este módulo a cada início. Trocar de qualidade
// não reinicia um compartilhamento em andamento — reiniciar a track
// derrubaria a imagem de quem está assistindo, e ninguém pede isso ao mexer
// num toggle.

export type ScreenShareQuality = 'fluida' | 'nitida'

export type ScreenSharePreferences = {
  /**
   * 'fluida' → 720p a 30fps (`ScreenSharePresets.h720fps30`, `contentHint:
   * 'motion'`): prioriza movimento contínuo, sobrevive a upload instável.
   * 'nitida' → 1080p a 15fps (`ScreenSharePresets.h1080fps15`, `contentHint:
   * 'detail'`): prioriza resolução, para texto/código legível.
   * Mapeamento em `08-RESEARCH.md §5`; a tradução para os presets do SDK
   * mora em `voice-context.tsx`, não aqui — este módulo não importa
   * `livekit-client` de propósito, para continuar sendo só persistência.
   */
  quality: ScreenShareQuality
}

const STORAGE_KEY = 'janja:screenshare-preferences'

// 'fluida' é o default deliberado: o público do projeto é um grupo de amigos
// em upload doméstico brasileiro, e o modo de falha de "nítida" numa conexão
// fraca (imagem travando em slideshow) é bem pior que o de "fluida" numa
// conexão boa (texto um pouco menos nítido).
export const DEFAULT_SCREEN_SHARE_PREFERENCES: ScreenSharePreferences = {
  quality: 'fluida'
}

function isScreenShareQuality(value: unknown): value is ScreenShareQuality {
  return value === 'fluida' || value === 'nitida'
}

function sanitize(raw: unknown): ScreenSharePreferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SCREEN_SHARE_PREFERENCES

  const candidate = raw as Partial<Record<keyof ScreenSharePreferences, unknown>>

  const quality = isScreenShareQuality(candidate.quality)
    ? candidate.quality
    : DEFAULT_SCREEN_SHARE_PREFERENCES.quality

  return { quality }
}

// Nunca lança — `localStorage` ausente/corrompido/indisponível (modo privado,
// quota, ambiente sem DOM) sempre cai no default. Mesmo padrão defensivo de
// `loadVoicePreferences` (07-05): esta função é chamada no caminho de iniciar
// um compartilhamento, e uma exceção aqui derrubaria o compartilhamento
// inteiro por causa de uma preferência cosmética.
export function loadScreenSharePreferences(): ScreenSharePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SCREEN_SHARE_PREFERENCES
    return sanitize(JSON.parse(raw))
  } catch {
    return DEFAULT_SCREEN_SHARE_PREFERENCES
  }
}

// Faz merge com o valor persistido atual (não com o default) — hoje só existe
// um campo, mas a assinatura é a mesma de `saveVoicePreferences` para que
// acrescentar um segundo campo depois não vire uma mudança de contrato que
// silenciosamente reseta o primeiro.
export function saveScreenSharePreferences(
  partial: Partial<ScreenSharePreferences>
): ScreenSharePreferences {
  const next = sanitize({ ...loadScreenSharePreferences(), ...partial })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota excedida ou storage indisponível: a escolha só não persiste
    // entre reinícios, não deve derrubar a UI que chamou isto.
  }
  return next
}
