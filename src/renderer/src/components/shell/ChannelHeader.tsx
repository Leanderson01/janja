import { useQuery } from 'convex/react'
import { Hash, Volume2 } from 'lucide-react'

import { useSelection } from '@/state/selection-context'

import { api } from '../../../../../convex/_generated/api'

// Barra fixa no topo da área de conversa (RESEARCH.md §1: ~48px). Mostra o
// ícone (Hash para texto, Volume2 para voz) e o nome do canal atualmente
// selecionado no SelectionProvider — a partir do plano 04-06, lido via
// `api.channels.getChannel` em vez de `mock-data.ts`.
export function ChannelHeader(): React.JSX.Element {
  const { selectedChannelId } = useSelection()
  const channel = useQuery(
    api.channels.getChannel,
    selectedChannelId ? { channelId: selectedChannelId } : 'skip'
  )

  // Três estados colapsam no mesmo fallback: `selectedChannelId === null`
  // (zero canais/servidores), `channel === undefined` (query ainda
  // carregando — transição rápida, não vale um spinner dedicado) e
  // `channel === null` (id inexistente/não-membro — não deveria acontecer
  // no fluxo normal, mas `getChannel` retorna `null` para isso).
  if (!channel) {
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
