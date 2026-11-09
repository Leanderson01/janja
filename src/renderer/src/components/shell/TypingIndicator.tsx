import { useQuery } from 'convex/react'
import { useEffect, useState } from 'react'

import { typingText } from '@/lib/typing-text'

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
}): React.JSX.Element {
  const typers = useQuery(api.typing.listTyping, { channelId })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(interval)
  }, [])

  const active = (typers ?? []).filter((t) => now - t.updatedAt < TYPING_TTL_MS)
  const names = active.map((t) => t.displayName ?? t.username ?? 'alguém')
  const text = typingText(names)

  // Faixa de altura fixa, sempre reservada: o indicador aparecer e sumir não
  // pode empurrar a caixa de texto nem a lista para cima e para baixo.
  return (
    <div className="flex h-6 flex-none items-center gap-2 px-4 text-sm text-foreground">
      {text && (
        <>
          <span className="flex gap-0.5" aria-hidden="true">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="size-1.5 rounded-full bg-foreground motion-safe:animate-bounce"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
          <span className="min-w-0 truncate">{boldNames(text, names)}</span>
        </>
      )}
    </div>
  )
}

// Nomes em negrito, o resto da frase normal. Divide o texto pelos nomes, que
// podem repetir pedaços da frase (ex.: alguém chamado “e”), então só marca a
// ocorrência certa, na ordem em que aparecem.
function boldNames(text: string, names: string[]): React.ReactNode {
  if (names.length === 0 || names.length > 2) return text
  const parts: React.ReactNode[] = []
  let rest = text
  names.forEach((name, i) => {
    const at = rest.indexOf(name)
    if (at > 0) parts.push(rest.slice(0, at))
    parts.push(
      <strong key={i} className="font-bold">
        {name}
      </strong>
    )
    rest = rest.slice(at + name.length)
  })
  parts.push(rest)
  return parts
}
