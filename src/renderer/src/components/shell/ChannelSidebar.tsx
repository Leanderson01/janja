import { useSelection } from '@/state/selection-context'

// Stub mínimo (Plano 03-01). O Plano 03-02 substitui isto pela sidebar real
// de canais agrupados por categoria. Este stub existe só para provar, já
// nesta fase, que a seleção de servidor propaga via SelectionProvider até
// as regiões dependentes.
export function ChannelSidebar(): React.JSX.Element {
  const { selectedServerId } = useSelection()

  return (
    <div className="h-full flex items-center justify-center p-4 text-sm text-muted-foreground">
      Sidebar de canais — servidor selecionado: {selectedServerId}
    </div>
  )
}
