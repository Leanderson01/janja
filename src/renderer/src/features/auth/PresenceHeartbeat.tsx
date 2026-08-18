import { useEffect } from 'react'
import { useConvexAuth, useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'

// Heartbeat de presença: dispara assim que autenticado, e a cada 45s enquanto a
// sessão estiver ativa. 45s escolhido em 02-RESEARCH.md §7 — barato o bastante para
// não gerar tráfego de mutations desnecessário (ver PITFALLS.md, Performance Traps),
// frequente o bastante para presença parecer responsiva. Sem UI própria — só efeito.
// Extraído de main.tsx (em vez de definido inline) para satisfazer a convenção de Fast
// Refresh de que um arquivo que exporta um componente não deve também conter o
// bootstrap `createRoot`/`render`.
export function PresenceHeartbeat(): null {
  const { isAuthenticated } = useConvexAuth()
  const heartbeat = useMutation(api.presence.heartbeat)

  useEffect(() => {
    if (!isAuthenticated) return undefined
    heartbeat().catch(() => {})
    const interval = setInterval(() => {
      heartbeat().catch(() => {})
    }, 45_000)
    return () => clearInterval(interval)
  }, [isAuthenticated, heartbeat])

  return null
}
