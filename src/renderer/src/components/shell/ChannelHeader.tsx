import { Hash, Volume2 } from 'lucide-react'

import { mockChannels } from '@/data/mock-data'
import { useSelection } from '@/state/selection-context'

// Barra fixa no topo da área de conversa (RESEARCH.md §1: ~48px). Mostra o
// ícone (Hash para texto, Volume2 para voz) e o nome do canal atualmente
// selecionado no SelectionProvider (Plano 03-01).
export function ChannelHeader(): React.JSX.Element {
  const { selectedChannelId } = useSelection()
  const channel = mockChannels.find((c) => c.id === selectedChannelId)

  if (!channel) {
    // Estado impossível dado o Plano 01 (selectedChannelId sempre inicializa
    // com um canal válido), mas tratado para não quebrar a UI.
    return (
      <div className="flex-none h-12 flex items-center gap-2 px-4 border-b border-border text-sm text-muted-foreground">
        Nenhum canal selecionado
      </div>
    )
  }

  const Icon = channel.type === 'voice' ? Volume2 : Hash

  return (
    <div className="flex-none h-12 flex items-center gap-2 px-4 border-b border-border">
      <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      <span className="font-semibold text-foreground">{channel.name}</span>
    </div>
  )
}
