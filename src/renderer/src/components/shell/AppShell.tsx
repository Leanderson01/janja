import { ChannelSidebar } from '@/components/shell/ChannelSidebar'
import { ConversationArea } from '@/components/shell/ConversationArea'
import { MemberList } from '@/components/shell/MemberList'
import { SelectionProvider } from '@/state/selection-context'

// Layout de 4 regiões da Fase 3 (RESEARCH.md §3): rail e sidebar fixos à
// esquerda, área de conversa elástica no centro, lista de membros fixa à
// direita. `overflow-hidden` no container raiz garante que a janela nunca
// gera scroll própria — só regiões internas rolam.
export function AppShell(): React.JSX.Element {
  return (
    <SelectionProvider>
      <div className="h-screen w-screen overflow-hidden flex bg-background text-foreground">
        {/* Barra de servidores — placeholder até o Plano 03-01/Task 3
            substituir por ServerRail. */}
        <div className="flex-none w-[72px] bg-sidebar border-r border-sidebar-border" />

        <div className="flex-none w-60 bg-secondary border-r border-border">
          <ChannelSidebar />
        </div>

        <div className="flex-1 min-w-0 flex flex-col bg-background">
          <ConversationArea />
        </div>

        <div className="flex-none w-60 bg-secondary border-l border-border">
          <MemberList />
        </div>
      </div>
    </SelectionProvider>
  )
}
