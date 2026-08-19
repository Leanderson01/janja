// Preferências de voz (Plano 07-05): estado de MÁQUINA, não de conta — o
// mesmo usuário pode ter microfones diferentes em cada computador
// (07-RESEARCH.md §7, FEATURES.md). Por isso vivem em `localStorage` do
// renderer, nunca no Convex. `vadThreshold` usa a mesma escala 0-1 do nível
// RMS calculado por `vad.ts`, comparável diretamente sem conversão.

export type VoiceMode = 'vad' | 'ptt'

export type VoicePreferences = {
  mode: VoiceMode
  vadThreshold: number
}

const STORAGE_KEY = 'janja:voice-preferences'

// 0.15 é um chute de partida documentado, não um valor calibrado — o
// usuário ajusta pelo slider do painel de configurações (Task 3) vendo o
// próprio nível de áudio em tempo real.
export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  mode: 'vad',
  vadThreshold: 0.15
}

function isVoiceMode(value: unknown): value is VoiceMode {
  return value === 'vad' || value === 'ptt'
}

function sanitize(raw: unknown): VoicePreferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_VOICE_PREFERENCES

  const candidate = raw as Partial<Record<keyof VoicePreferences, unknown>>

  const mode = isVoiceMode(candidate.mode) ? candidate.mode : DEFAULT_VOICE_PREFERENCES.mode
  const vadThreshold =
    typeof candidate.vadThreshold === 'number' && Number.isFinite(candidate.vadThreshold)
      ? Math.min(1, Math.max(0, candidate.vadThreshold))
      : DEFAULT_VOICE_PREFERENCES.vadThreshold

  return { mode, vadThreshold }
}

// Nunca lança — `localStorage` ausente/corrompido/indisponível (modo
// privado, quota, ambiente sem DOM) sempre cai no default, mesmo padrão
// defensivo de `src/main/auth/session-store.ts` (lá é o arquivo cifrado do
// processo main; aqui é só `localStorage` do renderer).
export function loadVoicePreferences(): VoicePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_VOICE_PREFERENCES
    return sanitize(JSON.parse(raw))
  } catch {
    return DEFAULT_VOICE_PREFERENCES
  }
}

// Faz merge com o valor persistido atual (não com o default) — mudar só o
// limiar não deve resetar o modo escolhido, e vice-versa.
export function saveVoicePreferences(partial: Partial<VoicePreferences>): VoicePreferences {
  const next = sanitize({ ...loadVoicePreferences(), ...partial })
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota excedida ou storage indisponível: a escolha só não persiste
    // entre reinícios, não deve derrubar a UI que chamou isto.
  }
  return next
}
