import { useConvexAuth } from 'convex/react'
import { useEffect, useState } from 'react'
import { auth } from '@platform/auth'

// Mitigação do Pitfall 4 (get-convex/convex-backend#259): o cliente Convex pode
// travar em isAuthenticated:false permanentemente após expiração do access token,
// mesmo com token renovado pelo AuthKit e o backend voltando a aceitar requisições.
// O TTL do access token já foi elevado a 8h no dashboard WorkOS (reduz drasticamente
// a frequência do bug), mas não o elimina — este componente é a rede de segurança:
// loga localmente quando a queda acontece e, como último recurso, recarrega a janela
// silenciosamente se a sessão continuar presa em não-autenticado por tempo demais
// enquanto a plataforma ainda considera a sessão válida.
//
// NA WEB O MESMO PITFALL REAPARECE, COM OUTRA CAUSA POSSÍVEL: o `getAccessToken`
// do AuthKit lança `LoginRequiredError` quando o refresh falha de vez, o
// adaptador devolve `null` (nunca exceção, por contrato) e o Convex trava em
// `isAuthenticated: false`. A primeira linha de defesa nesse caso é o
// `onRefreshFailure` do provider (`platform/web/auth.tsx`), que tenta entrar de
// novo; este componente é a SEGUNDA. E a saída continua legítima nos dois
// alvos: recarregar a aba refaz o handshake do AuthKit do zero, como recarregar
// a janela refaz o do IPC.
//
// A pergunta "a sessão ainda vale?" é a única parte que muda por alvo, e por
// isso ela é do contrato: no Electron ela vai ao processo main; na web, ao
// contexto do AuthKit (`user !== null`).
const RELOAD_AFTER_MS = 15_000

export function AuthWatchdog(): null {
  const { isAuthenticated, isLoading } = useConvexAuth()

  // Estado derivado durante a renderização (não em um efeito) a partir da mudança de
  // `isAuthenticated` — segue o padrão do React para "ajustar estado quando uma prop
  // muda" (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // Evita o aviso `react-hooks/set-state-in-effect` (setState síncrono dentro do corpo
  // de um efeito) e o aviso `react-hooks/purity` (nenhuma chamada impura tipo
  // `Date.now()` acontece durante a renderização — `dropped` é só um booleano). Também
  // evita o bug real de usar um `ref` no array de dependências de outro efeito: um ref
  // mutado dentro de um efeito não dispara re-render, então um array `[ref.current]`
  // captura o valor de *antes* da mutação deste render e nunca observa a mudança de
  // forma confiável — o temporizador de reload abaixo simplesmente não armaria.
  const [prevAuthenticated, setPrevAuthenticated] = useState(isAuthenticated)
  const [wasAuthenticated, setWasAuthenticated] = useState(false)
  const [dropped, setDropped] = useState(false)

  if (!isLoading && isAuthenticated !== prevAuthenticated) {
    setPrevAuthenticated(isAuthenticated)
    if (isAuthenticated) {
      setWasAuthenticated(true)
      setDropped(false)
    } else if (wasAuthenticated && !dropped) {
      // isAuthenticated caiu para false depois de já ter sido true nesta sessão do
      // processo renderer — não é o estado inicial normal de "ainda não logou".
      console.warn(
        '[auth-watchdog] isAuthenticated caiu inesperadamente para false — possível bug get-convex/convex-backend#259. Monitorando por',
        RELOAD_AFTER_MS,
        'ms antes de recarregar.'
      )
      setDropped(true)
    }
  }

  // O temporizador de reload em si é um efeito legítimo (side effect com timer +
  // chamada IPC), não sincronização de estado — permanece em useEffect.
  useEffect(() => {
    if (!dropped) return undefined
    const timeout = setTimeout(() => {
      // Confirma que a plataforma ainda considera a sessão válida antes de recarregar
      // — evita reload em loop se o usuário realmente fez logout de propósito.
      auth.hasLiveSession().then((alive) => {
        if (alive) {
          console.warn(
            '[auth-watchdog] isAuthenticated ainda false com sessão viva na plataforma — recarregando.'
          )
          window.location.reload()
        }
      })
    }, RELOAD_AFTER_MS)
    return () => clearTimeout(timeout)
  }, [dropped])

  return null
}
