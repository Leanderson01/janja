import { useQuery } from 'convex/react'
import { useEffect, useState } from 'react'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

const TYPING_TTL_MS = 6000
const TICK_MS = 1000

// Expiração é aplicada aqui, no cliente, por tick de setInterval — não no servidor
// (05-RESEARCH.md §7: uma query Convex não reavalia sozinha só por causa do tempo
// passar, sem escrita nova). O tick força este componente a recalcular "quem ainda
// conta como digitando" a cada segundo, mesmo sem nenhum dado novo chegar do
// servidor — é o que garante o indicador sumir sozinho se o autor travar/fechar o
// app no meio da digitação.
export function TypingIndicator({
  channelId
}: {
  channelId: Id<'channels'>
}): React.JSX.Element | null {
  const typers = useQuery(api.typing.listTyping, { channelId })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(interval)
  }, [])

  const active = (typers ?? []).filter((t) => now - t.updatedAt < TYPING_TTL_MS)

  if (active.length === 0) return null

  const names = active.map((t) => t.displayName ?? t.username ?? 'alguém')
  const text =
    names.length === 1
      ? `${names[0]} está digitando...`
      : names.length === 2
        ? `${names[0]} e ${names[1]} estão digitando...`
        : `${names.length} pessoas estão digitando...`

  return (
    <div className="px-4 h-5 flex items-center text-xs text-muted-foreground italic">{text}</div>
  )
}
