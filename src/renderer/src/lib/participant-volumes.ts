// VOICE-18 (Plano 08.5-11): volume individual por participante e "silenciar
// para mim". Estado de MÁQUINA, não de conta — exatamente a mesma
// justificativa de `voice-preferences.ts` (07-05) e
// `screenshare-preferences.ts` (08-05): o volume que você dá para o microfone
// estourado do fulano vale para ESTE computador, com ESTE fone. Guardar isso
// no Convex faria a escolha viajar com a conta para a máquina errada.
//
// A chave do mapa é a `identity` do LiveKit, que neste projeto é o `users._id`
// do Convex (07-RESEARCH.md §6) — a mesma chave de `speakingUserIds` e
// `connectionQualities`.
//
// Este módulo NÃO importa `livekit-client` de propósito: é só persistência e
// uma regra pura. Quem fala com o SDK é `voice-context.tsx`, num único lugar.

export type ParticipantAudioPreference = {
  /**
   * 0..2 — 1 é o volume normal. O teto ARMAZENADO é 2 (o dobro, como o
   * Discord permite), mas o teto que chega ao SDK hoje é
   * `MAX_PLAYBACK_VOLUME` = 1. Ver o comentário desse constante: o limite é
   * do HTMLMediaElement, não uma escolha de produto.
   */
  volume: number
  /**
   * Silenciado SÓ PARA MIM. Três coisas diferentes moram perto uma da outra e
   * não podem ser confundidas:
   * - `muted` (voiceStates, Convex): a pessoa fechou o próprio microfone;
   * - `deafened` (rodapé): EU não ouço NINGUÉM;
   * - `silenced` (aqui): EU não ouço ESTA pessoa. É reprodução local, não
   *   moderação — não muta ninguém para os outros, e não existe cargo nem
   *   mutation por trás disto.
   */
  silenced: boolean
}

/** Preferências por `identity` (= `users._id`). Ausente = padrão (volume 1). */
export type ParticipantVolumes = Record<string, ParticipantAudioPreference>

const STORAGE_KEY = 'janja:participant-volumes'

/** Volume de quem nunca foi ajustado. Entrada ausente no mapa significa isto. */
export const DEFAULT_PARTICIPANT_VOLUME = 1

/** Teto do que pode ser ARMAZENADO/sanitizado (o dobro do normal). */
export const MAX_STORED_VOLUME = 2

/**
 * Teto do que pode ser ENTREGUE a `RemoteAudioTrack.setVolume`.
 *
 * Não é preferência: é limite do navegador. Com `webAudioMix: false` — que é o
 * DEFAULT do `livekit-client` 2.22 e o que este projeto usa (`new Room()` sem
 * opções, `voice-context.tsx`) —, `RemoteAudioTrack.setVolume(v)` executa
 * literalmente `el.volume = v` no `<audio>` anexado (verificado no bundle
 * instalado, `livekit-client.esm.mjs`). E `HTMLMediaElement.volume` LANÇA
 * `IndexSizeError` para qualquer valor fora de 0..1 — ou seja, mandar 1.5 não
 * "não faz nada": derruba o efeito que aplica o volume, e junto com ele o
 * ENSURDECIMENTO dos outros participantes daquela passada.
 *
 * Amplificar acima de 100% exige o caminho de Web Audio (`webAudioMix: true`
 * no `new Room()`, que faz o SDK rotear o áudio por um `GainNode` e MUTAR o
 * elemento). Isso mudaria o caminho de reprodução de toda a call e o de
 * `switchActiveDevice('audiooutput')` (VOICE-20, Plano 07-05) — mudança
 * arquitetural, fora deste plano. Registrada no SUMMARY como decisão para o
 * usuário.
 */
export const MAX_PLAYBACK_VOLUME = 1

/** Grampeia no intervalo armazenável. Valor não finito vira o padrão. */
export function clampStoredVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_PARTICIPANT_VOLUME
  return Math.min(MAX_STORED_VOLUME, Math.max(0, volume))
}

/**
 * Entrada que não diz nada além do padrão. Higiene de tamanho: guardar
 * `{volume: 1, silenced: false}` para 200 pessoas é lixo que cresce sozinho e
 * nunca é lido — `effectiveVolume(undefined, ...)` já devolve exatamente o
 * mesmo resultado.
 */
export function isDefaultPreference(pref: ParticipantAudioPreference): boolean {
  return pref.volume === DEFAULT_PARTICIPANT_VOLUME && !pref.silenced
}

function sanitize(raw: unknown): ParticipantVolumes {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}

  const result: ParticipantVolumes = {}

  for (const [identity, value] of Object.entries(raw as Record<string, unknown>)) {
    // Chave cujo valor não é um objeto é descartada inteira: não dá para
    // adivinhar o que a pessoa quis dizer com `{"user1": 0.5}` e inventar um
    // significado aqui é pior que ignorar.
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue

    const candidate = value as Partial<Record<keyof ParticipantAudioPreference, unknown>>

    result[identity] = {
      volume:
        typeof candidate.volume === 'number'
          ? clampStoredVolume(candidate.volume)
          : DEFAULT_PARTICIPANT_VOLUME,
      silenced: typeof candidate.silenced === 'boolean' ? candidate.silenced : false
    }
  }

  return result
}

// Nunca lança — `localStorage` ausente/corrompido/indisponível (modo privado,
// quota, ambiente sem DOM) sempre cai no mapa vazio, que é o mesmo que "todo
// mundo no volume normal". Mesmo padrão defensivo de `loadVoicePreferences`
// (07-05): esta função é chamada na inicialização do `VoiceProvider`, e uma
// exceção aqui derrubaria a voz inteira por causa de uma preferência cosmética.
export function loadParticipantVolumes(): ParticipantVolumes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return sanitize(JSON.parse(raw))
  } catch {
    return {}
  }
}

/**
 * Salva o mapa INTEIRO (não faz merge, ao contrário de
 * `saveVoicePreferences`): aqui o chamador é dono do mapa completo — ele veio
 * de `loadParticipantVolumes` e é mantido em estado no `VoiceProvider` —, e um
 * merge impediria REMOVER alguém, que é justamente o que a poda faz.
 *
 * Devolve o mapa sanitizado e podado, que é o que de fato ficou guardado.
 */
export function saveParticipantVolumes(map: ParticipantVolumes): ParticipantVolumes {
  const sanitized = sanitize(map)

  const pruned: ParticipantVolumes = {}
  for (const [identity, pref] of Object.entries(sanitized)) {
    if (isDefaultPreference(pref)) continue
    pruned[identity] = pref
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned))
  } catch {
    // Quota excedida ou storage indisponível: a escolha só não persiste entre
    // reinícios, não deve derrubar a UI (nem a call) de quem chamou isto.
  }

  return pruned
}

/**
 * A REGRA CENTRAL desta feature, e a razão de ela ser uma função pura e
 * exportada: ENSURDECER e VOLUME INDIVIDUAL escrevem na MESMA propriedade
 * (`RemoteAudioTrack.setVolume`). Antes do Plano 08.5-11 o ensurdecimento
 * morava num efeito do `VoiceControlBar` que aplicava `deafened ? 0 : 1` em
 * TODA track remota e reaplicava em `TrackSubscribed`. Se o volume individual
 * morasse em outro lugar, o último efeito a rodar venceria — e o sintoma seria
 * "o volume que eu ajustei voltou sozinho", aparecendo toda vez que alguém
 * entrasse na call, longe da causa.
 *
 * Precedência, sempre nesta ordem:
 *   1. ensurdecido  -> 0 (ganha de tudo; ensurdecido ninguém toca)
 *   2. silenciado   -> 0 (só esta pessoa, só para mim)
 *   3. volume       -> o ajuste, ou 1 se nunca foi ajustado
 *
 * O resultado é grampeado em `MAX_PLAYBACK_VOLUME` porque é ele, e mais nada,
 * que vai para o SDK.
 */
export function effectiveVolume(
  pref: ParticipantAudioPreference | undefined,
  deafened: boolean
): number {
  if (deafened) return 0
  if (pref?.silenced) return 0
  return Math.min(
    MAX_PLAYBACK_VOLUME,
    clampStoredVolume(pref?.volume ?? DEFAULT_PARTICIPANT_VOLUME)
  )
}
