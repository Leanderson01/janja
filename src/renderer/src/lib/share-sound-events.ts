/**
 * Follow-up 1 da rodada 1: sons de "transmissão começou" e "transmissão
 * terminou", como no Discord. Toca para TODOS na call — cada cliente toca ao ver
 * a mudança — inclusive para quem transmite.
 *
 * Fonte da verdade: a coluna `sharing` das linhas de `voiceParticipantsByChannel`
 * do canal em que estou, a mesma assinatura que os sons de entrar/sair já usam
 * (`useVoiceJoinLeaveSounds`). Puro, para testar sem call de verdade.
 *
 * Só conta a TRANSIÇÃO de quem estava nos dois retratos:
 * - `prev === null` é o retrato inicial (acabei de entrar): quem já transmitia
 *   não toca nada;
 * - quem SAI da call transmitindo não gera "terminou": sair já tem o som de
 *   saída;
 * - quem CHEGA não gera "começou": entrar já tem o som de entrada (e a linha
 *   nasce com `sharing: false`; a transmissão começa num retrato seguinte).
 */
export type ShareRow = { userId: string; sharing: boolean }

export type ShareSoundEvent = 'start' | 'stop'

/** Um evento por pessoa que começou ou parou de transmitir entre os retratos. */
export function shareSoundEvents(
  prev: readonly ShareRow[] | null,
  next: readonly ShareRow[]
): ShareSoundEvent[] {
  if (prev === null) return []
  const wasSharing = new Map(prev.map((row) => [row.userId, row.sharing]))
  const events: ShareSoundEvent[] = []
  for (const row of next) {
    const before = wasSharing.get(row.userId)
    if (before === undefined || before === row.sharing) continue
    events.push(row.sharing ? 'start' : 'stop')
  }
  return events
}
