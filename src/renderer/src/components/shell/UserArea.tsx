import { useEffect, useRef } from 'react'

import { UserPanel } from '@/features/auth/UserPanel'
import { useLayout } from '@/state/layout-context'

import { SelfVoiceButtons, VoiceConnectedSection } from './VoiceControlBar'

const RAIL_WIDTH = 72

// Cartão flutuante do Discord: fica por cima do rail e da lista de canais,
// colado no canto inferior esquerdo (8px de folga). Montado uma vez só, nas
// duas visões. Quem o posiciona é a linha `relative` do `AppShell`.
//
// A altura do cartão varia (a seção "Voz conectada" aparece e some). Um
// `ResizeObserver` escreve a altura em `--user-area-height` no pai (que cobre o
// rail e a moldura), e as áreas rolantes do rail e da lista de canais usam
// `pb-[calc(var(--user-area-height)+16px)]` para o último item nunca ficar
// escondido atrás do cartão.
export function UserArea({
  channelColumnWidth
}: {
  /** Largura já limitada pelo clamp; sem ela, cai para a largura guardada. */
  channelColumnWidth?: number
}): React.JSX.Element {
  const { channelListWidth } = useLayout()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    const host = el?.parentElement
    if (!el || !host) return
    const write = (): void => host.style.setProperty('--user-area-height', `${el.offsetHeight}px`)
    write()
    const observer = new ResizeObserver(write)
    observer.observe(el)
    return () => {
      observer.disconnect()
      host.style.removeProperty('--user-area-height')
    }
  }, [])

  const width = RAIL_WIDTH + (channelColumnWidth ?? channelListWidth) - 16

  return (
    <div
      ref={ref}
      style={{ width }}
      className="absolute bottom-2 left-2 z-10 overflow-hidden rounded-lg border border-panel-border bg-panel [--avatar-ring:var(--panel)]"
    >
      <VoiceConnectedSection />
      <div className="flex items-center gap-1 p-2">
        <UserPanel />
        <SelfVoiceButtons />
      </div>
    </div>
  )
}
