// A escala que o slider de sensibilidade e o medidor de nível DIVIDEM: dBFS de
// −100 (silêncio) a 0 (amplitude cheia), linear em dB. É o que faz a marca do
// limiar no medidor cair exatamente embaixo do polegar do slider — como no
// Discord. A escala antiga era RMS linear 0–1: a faixa útil da fala cabia nos
// primeiros 10% e o medidor mal se mexia.
import { VAD_MAX_DB, VAD_SILENCE_DB } from './vad'

/** dBFS -> posição (0–100%) na barra. NaN vai para o começo. */
export function dbToPercent(db: number): number {
  if (Number.isNaN(db)) return 0
  const clamped = Math.min(VAD_MAX_DB, Math.max(VAD_SILENCE_DB, db))
  return ((clamped - VAD_SILENCE_DB) / (VAD_MAX_DB - VAD_SILENCE_DB)) * 100
}

/** "−50 dB" — inteiro, com o sinal de menos tipográfico (U+2212). */
export function formatDb(db: number): string {
  const rounded = Math.round(Number.isNaN(db) ? VAD_SILENCE_DB : db)
  // `|| 0` também normaliza o −0 de `Math.round(-0.4)`.
  const value = rounded || 0
  return `${value < 0 ? '−' : ''}${Math.abs(value)} dB`
}
