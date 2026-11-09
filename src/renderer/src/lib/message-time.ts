const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' })
const LONG_DATE = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** HH:mm em hora local. */
export function formatShortTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "8 de novembro de 2026". */
export function formatDayLabel(ts: number): string {
  return LONG_DATE.format(new Date(ts))
}

/** "sábado, 7 de novembro de 2026 23:25" (montado em partes para não ganhar o "às" do Intl). */
export function formatFullTimestamp(ts: number): string {
  const d = new Date(ts)
  return `${WEEKDAY.format(d)}, ${LONG_DATE.format(d)} ${formatShortTime(ts)}`
}

function dayStart(ts: number): Date {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** "Hoje às 08:05", "Ontem às 23:25" ou "07/11/2026 23:25". Compara dias do calendário local. */
export function formatMessageTimestamp(ts: number, now: number): string {
  const today = dayStart(now)
  const day = dayStart(ts)
  // Date(y, m, d - 1) lida com virada de mês e ano; subtrair 24h erraria em dia de horário de verão.
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (day.getTime() === today.getTime()) return `Hoje às ${formatShortTime(ts)}`
  if (day.getTime() === yesterday.getTime()) return `Ontem às ${formatShortTime(ts)}`
  return `${pad(day.getDate())}/${pad(day.getMonth() + 1)}/${day.getFullYear()} ${formatShortTime(ts)}`
}
