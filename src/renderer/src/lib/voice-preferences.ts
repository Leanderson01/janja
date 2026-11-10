// Preferências de voz (Plano 07-05): estado de MÁQUINA, não de conta — o
// mesmo usuário pode ter microfones diferentes em cada computador
// (07-RESEARCH.md §7, FEATURES.md). Por isso vivem em `localStorage` do
// renderer, nunca no Convex.
//
// Sensibilidade de entrada (nov/2026), no modelo do Discord: automático por
// padrão, e um limiar manual em dBFS (−100…0) — a mesma escala de `vad.ts` e do
// medidor da tela. Substitui o antigo `vadThreshold`, que era RMS LINEAR (0–1)
// com padrão 0,15 (≈ −16,5 dBFS, voz alta): a faixa útil cabia nos primeiros
// 10% do slider e fala normal não abria o microfone. Quem tinha o valor antigo
// salvo cai no automático — `sanitize` descarta o campo velho.

export type VoiceMode = 'vad' | 'ptt'

export type VoicePreferences = {
  mode: VoiceMode
  /** "Determinar automaticamente a sensibilidade de entrada". Padrão ligado. */
  vadAutoSensitivity: boolean
  /** Limiar manual de abertura em dBFS (−100…0); só vale com o automático desligado. */
  vadThresholdDb: number
  /**
   * Plano 07-07 (VOICE-17): toca um som distinto quando alguém entra/sai do
   * canal de voz conectado. Estado de MÁQUINA como o resto deste módulo —
   * mesma justificativa (07-RESEARCH.md §7): irritante em uso prolongado
   * para algumas pessoas, tem que ter um jeito rápido de desligar por
   * computador, não por conta.
   */
  soundsEnabled: boolean
}

const STORAGE_KEY = 'janja:voice-preferences'

/** Faixa do slider de sensibilidade, em dBFS — a escala de `vad.ts`. */
export const VAD_THRESHOLD_MIN_DB = -100
export const VAD_THRESHOLD_MAX_DB = 0

// −50 dB é o ponto de partida do slider MANUAL (fala normal com AGC fica em
// −35…−20 dBFS; uma sala quieta, abaixo de −60). O padrão de verdade é o
// automático, que calcula o limiar a partir do ruído de fundo.
export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  mode: 'vad',
  vadAutoSensitivity: true,
  vadThresholdDb: -50,
  soundsEnabled: true
}

function isVoiceMode(value: unknown): value is VoiceMode {
  return value === 'vad' || value === 'ptt'
}

function sanitize(raw: unknown): VoicePreferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_VOICE_PREFERENCES

  // Só os campos ATUAIS são lidos: o `vadThreshold` linear de antes (e
  // qualquer outro lixo) não passa daqui, e some do storage no próximo save.
  const candidate = raw as Partial<Record<keyof VoicePreferences, unknown>>

  const mode = isVoiceMode(candidate.mode) ? candidate.mode : DEFAULT_VOICE_PREFERENCES.mode
  const vadAutoSensitivity =
    typeof candidate.vadAutoSensitivity === 'boolean'
      ? candidate.vadAutoSensitivity
      : DEFAULT_VOICE_PREFERENCES.vadAutoSensitivity
  const vadThresholdDb =
    typeof candidate.vadThresholdDb === 'number' && !Number.isNaN(candidate.vadThresholdDb)
      ? Math.min(VAD_THRESHOLD_MAX_DB, Math.max(VAD_THRESHOLD_MIN_DB, candidate.vadThresholdDb))
      : DEFAULT_VOICE_PREFERENCES.vadThresholdDb
  const soundsEnabled =
    typeof candidate.soundsEnabled === 'boolean'
      ? candidate.soundsEnabled
      : DEFAULT_VOICE_PREFERENCES.soundsEnabled

  return { mode, vadAutoSensitivity, vadThresholdDb, soundsEnabled }
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
