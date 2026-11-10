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
