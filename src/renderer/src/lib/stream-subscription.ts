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
 * A regra é uma lista de exclusão, não de inclusão: só a tela e o som da tela
 * esperam o clique em "Assistir transmissão". Microfone, câmera e qualquer
 * fonte que o SDK venha a ganhar (ou `Unknown`) continuam automáticos — uma
 * fonte nova esquecida aqui vira "assinada demais", nunca "pessoa muda".
 */
export function shouldAutoSubscribe(source: Track.Source): boolean {
  return source !== Track.Source.ScreenShare && source !== Track.Source.ScreenShareAudio
}

/**
 * A decisão para UMA publicação remota: automática, ou tela de alguém que eu
 * escolhi assistir. Vale para o vídeo E para o som da transmissão — o som do
 * jogo chega numa publicação separada, às vezes segundos depois do vídeo, e
 * precisa entrar sozinho para quem já clicou.
 */
export function shouldSubscribe(
  source: Track.Source,
  participantIdentity: string,
  watched: ReadonlySet<string>
): boolean {
  return shouldAutoSubscribe(source) || watched.has(participantIdentity)
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
export function publicationsToSubscribe<TPublication extends { source: Track.Source }>(
  participants: Iterable<{
    identity: string
    trackPublications: ReadonlyMap<string, TPublication>
  }>,
  watched: ReadonlySet<string>
): TPublication[] {
  const result: TPublication[] = []
  for (const participant of participants) {
    for (const publication of participant.trackPublications.values()) {
      if (shouldSubscribe(publication.source, participant.identity, watched)) {
        result.push(publication)
      }
    }
  }
  return result
}

/** Passa a assistir `identity`. Devolve o MESMO conjunto se nada mudou. */
export function withWatched(watched: ReadonlySet<string>, identity: string): ReadonlySet<string> {
  if (watched.has(identity)) return watched
  return new Set([...watched, identity])
}

/** Deixa de assistir `identity`. Devolve o MESMO conjunto se nada mudou. */
export function withoutWatched(
  watched: ReadonlySet<string>,
  identity: string
): ReadonlySet<string> {
  if (!watched.has(identity)) return watched
  const next = new Set(watched)
  next.delete(identity)
  return next
}
