// Mic e fone da própria pessoa (rodada 1 do visual Discord): estado de MÁQUINA,
// como `voice-preferences.ts` e `participant-volumes.ts` — mora no
// `localStorage` do renderer, nunca no Convex. Vale dentro e fora da call, como
// no Discord: mutar ou ensurdecer antes de entrar faz a pessoa entrar assim, e
// o estado sobrevive ao fim da call e ao reinício do app.
//
// O servidor (`voiceStates.muted/deafened`) é só o ESPELHO disto enquanto há
// call: é o que os outros veem. Quem decide é o que está salvo aqui.
//
// As regras de mic e fone moram aqui, puras, porque são a única parte desta
// feature que dá para auditar sem uma call de verdade:
// - ensurdecer sempre muta, e lembra se o mic já estava mutado antes;
// - desensurdecer devolve o mic como estava antes de ensurdecer;
// - clicar no mic ensurdecido desensurdece E desmuta (como no Discord).

import type { VoiceMode } from './voice-preferences'

export type VoiceSelfState = {
  muted: boolean
  deafened: boolean
  /** Como o mic estava no instante em que a pessoa ensurdeceu. */
  mutedBeforeDeafen: boolean
  /** `null` = dispositivo padrão do sistema. */
  inputDeviceId: string | null
  /** `null` = dispositivo padrão do sistema. */
  outputDeviceId: string | null
}

const STORAGE_KEY = 'janja:voice-self-state'

export const DEFAULT_VOICE_SELF_STATE: VoiceSelfState = {
  muted: false,
  deafened: false,
  mutedBeforeDeafen: false,
  inputDeviceId: null,
  outputDeviceId: null
}

function isDeviceId(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

// Tudo ou nada: um campo de tipo errado significa que o dado não foi escrito
// por este módulo (ou foi corrompido), e meio estado confiável é pior que o
// padrão — o padrão pelo menos é previsível ("desmutado, dispositivo padrão").
function sanitize(raw: unknown): VoiceSelfState {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_VOICE_SELF_STATE
  const c = raw as Partial<Record<keyof VoiceSelfState, unknown>>

  if (
    typeof c.muted !== 'boolean' ||
    typeof c.deafened !== 'boolean' ||
    typeof c.mutedBeforeDeafen !== 'boolean' ||
    !isDeviceId(c.inputDeviceId) ||
    !isDeviceId(c.outputDeviceId)
  ) {
    return DEFAULT_VOICE_SELF_STATE
  }

  return {
    // Ensurdecido e com o mic aberto não é estado alcançável (falar no vácuo):
    // o servidor também garante isso em `setDeafened`.
    muted: c.muted || c.deafened,
    deafened: c.deafened,
    mutedBeforeDeafen: c.mutedBeforeDeafen,
    // String vazia não é um dispositivo; é o padrão.
    inputDeviceId: c.inputDeviceId || null,
    outputDeviceId: c.outputDeviceId || null
  }
}

/** Nunca lança: storage ausente, bloqueado ou corrompido devolve o padrão. */
export function loadVoiceSelfState(): VoiceSelfState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_VOICE_SELF_STATE
    return sanitize(JSON.parse(raw))
  } catch {
    return DEFAULT_VOICE_SELF_STATE
  }
}

/** Nunca lança: sem onde gravar, o estado só não sobrevive ao reinício. */
export function saveVoiceSelfState(s: VoiceSelfState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(s)))
  } catch {
    // Quota excedida ou storage indisponível: não derruba o botão que salvou.
  }
}

/** Botão do mic. Ensurdecido, ele desensurdece e desmuta de uma vez. */
export function toggleMute(s: VoiceSelfState): VoiceSelfState {
  if (s.deafened) {
    return { ...s, muted: false, deafened: false, mutedBeforeDeafen: false }
  }
  return { ...s, muted: !s.muted }
}

/** Botão do fone. Ensurdecer muta; desensurdecer devolve o mic como estava. */
export function toggleDeafen(s: VoiceSelfState): VoiceSelfState {
  if (s.deafened) {
    return { ...s, deafened: false, muted: s.mutedBeforeDeafen, mutedBeforeDeafen: false }
  }
  return { ...s, deafened: true, muted: true, mutedBeforeDeafen: s.muted }
}

/**
 * O dispositivo salvo só vale se ainda está plugado. Fone USB tirado entre uma
 * call e outra cai para o padrão (`null`) em vez de fazer a entrada falhar.
 */
export function resolveSavedDevice(
  savedId: string | null,
  available: { deviceId: string }[]
): string | null {
  if (!savedId) return null
  return available.some((device) => device.deviceId === savedId) ? savedId : null
}

/**
 * O join publica o microfone já MUTADO? Sim sempre que ninguém deveria te
 * ouvir no instante da entrada: mic mutado, fone ensurdecido, ou modo PTT com
 * a tecla solta. Publicar aberto manda `muted:false` ao SFU, que repassa áudio
 * real até o mute do cliente chegar — o "fecha logo depois" não basta.
 *
 * Modo VAD desmutado continua publicando aberto (o VAD fecha assim que o
 * monitor sobe), como antes desta rodada.
 */
export function shouldPublishMicrophoneMuted(s: {
  muted: boolean
  deafened: boolean
  mode: VoiceMode
  pttKeyDown: boolean
}): boolean {
  if (s.muted || s.deafened) return true
  return s.mode === 'ptt' && !s.pttKeyDown
}

/** O tom que um clique no mic ou no fone toca. */
export type SelfStateTone = 'mute' | 'unmute' | 'deafen' | 'undeafen'

/**
 * Qual tom a mudança `prev` → `next` toca (follow-up 1, como no Discord). O fone
 * vence o mic: ensurdecer também muta, mas toca SÓ o tom de ensurdecer; clicar
 * no mic ensurdecido desensurdece e desmuta, e toca o de desensurdecer. Isto
 * revoga a regra do Plano 07-11 de nunca tocar tom do lado do fone (decisão do
 * Leo, seguindo o Discord). Mudança que não é de mic nem de fone (dispositivo)
 * não toca nada.
 */
export function toneForSelfStateChange(
  prev: Pick<VoiceSelfState, 'muted' | 'deafened'>,
  next: Pick<VoiceSelfState, 'muted' | 'deafened'>
): SelfStateTone | null {
  if (!prev.deafened && next.deafened) return 'deafen'
  if (prev.deafened && !next.deafened) return 'undeafen'
  if (!prev.muted && next.muted) return 'mute'
  if (prev.muted && !next.muted) return 'unmute'
  return null
}
