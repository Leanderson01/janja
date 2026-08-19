/**
 * SHARE-02 / SHARE-06 — reconciliação da lista de tracks de tela EM EXIBIÇÃO.
 *
 * Dado 100% efêmero do LiveKit (quem está compartilhando AGORA, o frame que
 * de fato chega), no mesmo espírito de `speakingUserIds`/`connectionQualities`
 * do Plano 07-04: nunca vem do Convex, nunca sobrevive a uma desconexão. O
 * reflexo durável (`voiceStates.sharing`, para quem NÃO está conectado à sala)
 * é assunto do Plano 08-05 + webhook do 08-01.
 *
 * Este módulo é PURO de propósito — genérico sobre o tipo da track, sem
 * importar `livekit-client` nem tocar no DOM. Não é preciosismo: o ambiente de
 * teste do projeto é `edge-runtime` (sem DOM, sem `HTMLVideoElement`), e a
 * regra que mais importa da fase — "a região de vídeo some em TODOS os
 * caminhos, inclusive quando o apresentador cai" — é lógica de lista, não de
 * mídia. Separada aqui, ela é provável por teste automatizado; misturada ao
 * provider, só seria verificável com um Electron real em Windows.
 *
 * Toda função devolve o MESMO array quando nada muda. Isso é contrato, não
 * detalhe: cada evento do `Room` vira um `setState`, e um array novo a cada
 * evento re-renderizaria a área de vídeo à toa (o `<video>` em si não é
 * recriado — o efeito de anexação depende da identidade da TRACK — mas o
 * trabalho de render é desperdiçado do mesmo jeito).
 */

export type ScreenShareEntry<TTrack> = {
  /** `publication.trackSid` — chave estável, atribuída pelo servidor. */
  trackSid: string
  /** `identity` do LiveKit = `users._id` do Convex (ver `convex/voiceToken.ts`). */
  participantIdentity: string
  /** A própria tela sendo compartilhada por este cliente (auto-visualização). */
  isLocal: boolean
  track: TTrack
}

/**
 * Adiciona (ou substitui) a entrada de `trackSid`.
 *
 * Substituir em vez de ignorar cobre o caso real de re-inscrição: o SFU pode
 * entregar uma track NOVA para o mesmo `trackSid` depois de uma reconexão, e
 * manter a antiga deixaria um `<video>` ligado a uma `MediaStreamTrack` morta —
 * o frame congelado por outro caminho. A posição na lista é preservada para a
 * grade não pular de lugar.
 */
export function addScreenShareEntry<T>(
  entries: ScreenShareEntry<T>[],
  entry: ScreenShareEntry<T>
): ScreenShareEntry<T>[] {
  const index = entries.findIndex((existing) => existing.trackSid === entry.trackSid)
  if (index === -1) return [...entries, entry]

  const existing = entries[index]
  if (
    existing.track === entry.track &&
    existing.participantIdentity === entry.participantIdentity &&
    existing.isLocal === entry.isLocal
  ) {
    return entries
  }

  const next = [...entries]
  next[index] = entry
  return next
}

/**
 * Remove por `trackSid`. Deliberadamente SEM filtro por origem/tipo: remover
 * um sid que não está na lista é um no-op, então quem chama nunca precisa
 * saber se aquela despublicação era de tela, de câmera ou de áudio. Menos
 * condição para errar no caminho que precisa ser infalível.
 */
export function removeScreenShareEntryBySid<T>(
  entries: ScreenShareEntry<T>[],
  trackSid: string
): ScreenShareEntry<T>[] {
  const next = entries.filter((entry) => entry.trackSid !== trackSid)
  return next.length === entries.length ? entries : next
}

/**
 * Remove TODAS as entradas de um participante — o caminho sujo de SHARE-06:
 * quem compartilhava fechou o app à força, caiu da rede ou foi derrubado pelo
 * SFU. Nesse cenário não há garantia de receber despublicação por track, mas
 * `ParticipantDisconnected` sempre chega.
 */
export function removeScreenShareEntriesOfParticipant<T>(
  entries: ScreenShareEntry<T>[],
  participantIdentity: string
): ScreenShareEntry<T>[] {
  const next = entries.filter((entry) => entry.participantIdentity !== participantIdentity)
  return next.length === entries.length ? entries : next
}

/**
 * Zera a lista — usado na desconexão do próprio cliente. Nenhuma track de tela
 * sobrevive a sair da sala, e deixar uma sobrando é exatamente o frame
 * congelado que a fase existe para não ter.
 */
export function clearScreenShareEntries<T>(entries: ScreenShareEntry<T>[]): ScreenShareEntry<T>[] {
  return entries.length === 0 ? entries : []
}
