/** Colunas da grade de blocos da call: 1, 2, 2, 2, 3… conforme o número de participantes. */
export function gridColumns(count: number): number {
  if (count <= 1) return 1
  if (count <= 4) return 2
  if (count <= 9) return 3
  return 4
}

/** A barra só existe no canal em que estou conectado; na prévia "Sair" não faria nada. */
export function shouldShowCallControls({
  channelId,
  joinedVoiceChannelId
}: {
  channelId: string
  joinedVoiceChannelId: string | null
}): boolean {
  return channelId === joinedVoiceChannelId
}
