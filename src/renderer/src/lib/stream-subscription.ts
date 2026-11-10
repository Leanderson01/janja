import { Track } from 'livekit-client'

/**
 * Rodada 1 do visual Discord (Tarefa 13): quais publicações remotas este
 * cliente ASSINA. A sala conecta com `autoSubscribe: false` e quem decide é
 * este módulo, puro e testado, porque errar aqui tem dois sintomas opostos e
 * os dois são graves:
 *
 * - um MIC que fica de fora deixa a pessoa MUDA para mim, sem erro nenhum;
 * - uma TELA que entra sem clique traz de volta o que a rodada removeu (vídeo
 *   abrindo sozinho e o som do jogo tocando para todo mundo).
 *
 * A regra automática é uma lista de exclusão, não de inclusão: só a tela e o
 * som da tela esperam o clique em "Assistir transmissão". Microfone, câmera e
 * qualquer fonte que o SDK venha a ganhar (ou `Unknown`) continuam automáticos
 * — uma fonte nova esquecida aqui vira "assinada demais", nunca "pessoa muda".
 */
export function shouldAutoSubscribe(source: Track.Source): boolean {
  return source !== Track.Source.ScreenShare && source !== Track.Source.ScreenShareAudio
}

/** O que a decisão lê de uma publicação remota. */
export type PublicationLike = { trackSid: string; source: Track.Source }

/** O que a decisão lê de um participante remoto (formato do `RemoteParticipant`). */
export type ParticipantLike<TPublication extends PublicationLike> = {
  identity: string
  trackPublications: ReadonlyMap<string, TPublication>
}

/**
 * A publicação de VÍDEO da tela que a pessoa transmite agora, se houver.
 */
export function screenSharePublicationOf<TPublication extends PublicationLike>(
  participant: ParticipantLike<TPublication>
): TPublication | undefined {
  for (const publication of participant.trackPublications.values()) {
    if (publication.source === Track.Source.ScreenShare) return publication
  }
  return undefined
}

/**
 * A decisão para UMA publicação remota.
 *
 * "Assistir" é guardado pelo `trackSid` do VÍDEO da transmissão (o conjunto
 * `watchedShareSids`), não pela pessoa. É isso que faz o clique valer para
 * ESTA transmissão e só para ela, como no Discord:
 *
 * - quando a pessoa para e volta a transmitir, ou sai e volta para a call, o
 *   servidor dá um `trackSid` novo — a transmissão nova espera outro clique;
 * - quando sou EU que caio e reconecto, o SDK recria os participantes, mas os
 *   `trackSid` são das publicações DELA no servidor e voltam iguais — quem
 *   assistia continua assistindo.
 *
 * O SOM da transmissão chega numa publicação separada (às vezes segundos
 * depois do vídeo) e segue o vídeo: é assinado quando o vídeo atual da mesma
 * pessoa está sendo assistido.
 */
export function shouldSubscribe<TPublication extends PublicationLike>(
  publication: TPublication,
  participant: ParticipantLike<TPublication>,
  watchedShareSids: ReadonlySet<string>
): boolean {
  if (shouldAutoSubscribe(publication.source)) return true
  if (publication.source === Track.Source.ScreenShare) {
    return watchedShareSids.has(publication.trackSid)
  }
  const video = screenSharePublicationOf(participant)
  return video !== undefined && watchedShareSids.has(video.trackSid)
}

/**
 * Uma passada pela sala inteira: as publicações a assinar agora. Existe porque
 * `RoomEvent.TrackPublished` NÃO cobre tudo — as publicações de quem já estava
 * na sala chegam enquanto ela ainda está conectando, e o SDK não emite o evento
 * para elas (`emitWhenConnected`, livekit-client 2.22). Quem chama é o fim do
 * `room.connect` e o `Reconnected`.
 *
 * Genérica sobre a publicação para ser testável sem `Room`: o formato é o de
 * `room.remoteParticipants.values()`.
 */
export function publicationsToSubscribe<TPublication extends PublicationLike>(
  participants: Iterable<ParticipantLike<TPublication>>,
  watchedShareSids: ReadonlySet<string>
): TPublication[] {
  const result: TPublication[] = []
  for (const participant of participants) {
    for (const publication of participant.trackPublications.values()) {
      if (shouldSubscribe(publication, participant, watchedShareSids)) {
        result.push(publication)
      }
    }
  }
  return result
}

/**
 * Quem eu estou assistindo AGORA, por `identity`: quem tem uma transmissão no
 * ar cujo vídeo está em `watchedShareSids`. É o que a tela da call lê para
 * desenhar o bloco AO VIVO — uma transmissão encerrada some daqui sozinha, e a
 * seguinte da mesma pessoa não entra.
 */
export function watchedIdentities<TPublication extends PublicationLike>(
  participants: Iterable<ParticipantLike<TPublication>>,
  watchedShareSids: ReadonlySet<string>
): ReadonlySet<string> {
  const result = new Set<string>()
  if (watchedShareSids.size === 0) return result
  for (const participant of participants) {
    const video = screenSharePublicationOf(participant)
    if (video !== undefined && watchedShareSids.has(video.trackSid)) {
      result.add(participant.identity)
    }
  }
  return result
}

/** Os dois conjuntos têm exatamente os mesmos membros. */
export function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const member of a) {
    if (!b.has(member)) return false
  }
  return true
}

/** Acrescenta `key`. Devolve o MESMO conjunto se nada mudou. */
export function withWatched(watched: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (watched.has(key)) return watched
  return new Set([...watched, key])
}

/** Tira `key`. Devolve o MESMO conjunto se nada mudou. */
export function withoutWatched(watched: ReadonlySet<string>, key: string): ReadonlySet<string> {
  if (!watched.has(key)) return watched
  const next = new Set(watched)
  next.delete(key)
  return next
}

/**
 * Follow-up 1 da rodada 1: o AO VIVO da lista de canais leva para a
 * transmissão. O clique pode chegar ANTES da publicação na sala — é o mesmo
 * clique que entra na call, ou o `sharing` do Convex chegou alguns
 * milissegundos antes do LiveKit — e "assistir" é guardado pelo `trackSid`, que
 * ainda não existe para mim.
 *
 * Daí uma INTENÇÃO pendente, de UM uso: a primeira publicação do vídeo da tela
 * DESSA pessoa que aparecer vira um "assistir" pelo sid e a intenção some. Ela
 * nunca vira "assistir esta pessoa": uma transmissão seguinte espera outro
 * clique, como sempre (regra de `shouldSubscribe`).
 *
 * Três travas para que ela não faça uma transmissão FUTURA chegar sem clique:
 * - um uso só (consumida, vira `null`);
 * - prazo curto (`PENDING_WATCH_TTL_MS`, contado do clique): se a pessoa parou
 *   antes de a publicação chegar, a intenção morre em vez de esperar a próxima;
 * - a call do clique (`channelId`): trocar para outra call ou sair a descarta
 *   (`keepPendingWatchFor`).
 */
export const PENDING_WATCH_TTL_MS = 10_000

export type PendingWatch = {
  /** Quem transmite (`users._id`, a identity no LiveKit). */
  identity: string
  /** A call em que a transmissão foi clicada. */
  channelId: string
  /** Depois deste instante (`Date.now()`) a intenção não vale mais. */
  expiresAt: number
}

export function createPendingWatch(identity: string, channelId: string, now: number): PendingWatch {
  return { identity, channelId, expiresAt: now + PENDING_WATCH_TTL_MS }
}

/**
 * O que fazer com a intenção diante de algo que apareceu na sala:
 * `watchSid` é o sid a assistir agora (ou `null`), `pending` é a intenção que
 * sobra (`null` quando foi usada ou venceu; a MESMA quando nada mudou).
 */
export type PendingWatchResult = { watchSid: string | null; pending: PendingWatch | null }

/** A decisão para UMA publicação remota que acabou de aparecer. */
export function consumePendingWatch(
  pending: PendingWatch | null,
  publication: PublicationLike,
  participant: { identity: string },
  now: number
): PendingWatchResult {
  if (pending === null || now > pending.expiresAt) return { watchSid: null, pending: null }
  // Só o VÍDEO da tela conta: o mic é sempre assinado por conta própria, e o
  // som da tela segue o vídeo assistido (`shouldSubscribe`).
  if (publication.source !== Track.Source.ScreenShare) return { watchSid: null, pending }
  if (participant.identity !== pending.identity) return { watchSid: null, pending }
  return { watchSid: publication.trackSid, pending: null }
}

/**
 * A mesma decisão para a sala inteira, na passada pós-conexão (as publicações
 * de quem já estava na call chegam sem `TrackPublished`).
 */
export function consumePendingWatchInRoom<TPublication extends PublicationLike>(
  pending: PendingWatch | null,
  participants: Iterable<ParticipantLike<TPublication>>,
  now: number
): PendingWatchResult {
  if (pending === null || now > pending.expiresAt) return { watchSid: null, pending: null }
  for (const participant of participants) {
    const video = screenSharePublicationOf(participant)
    if (video === undefined) continue
    const result = consumePendingWatch(pending, video, participant, now)
    if (result.watchSid !== null) return result
  }
  return { watchSid: null, pending }
}

/**
 * A intenção só atravessa uma mudança de call se for DA call de destino: o
 * clique no AO VIVO de uma call em que eu não estava guarda a intenção ANTES
 * de a entrada começar (e da saída da call anterior, que emite `Disconnected`).
 * Qualquer outra mudança (sair, trocar para outra call) a descarta.
 */
export function keepPendingWatchFor(
  pending: PendingWatch | null,
  channelId: string | null
): PendingWatch | null {
  if (pending === null || channelId === null) return null
  return pending.channelId === channelId ? pending : null
}
