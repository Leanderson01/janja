import { ChannelSidebar } from '@/components/shell/ChannelSidebar'
import { ConversationArea } from '@/components/shell/ConversationArea'
import { MemberList } from '@/components/shell/MemberList'
import { ServerRail } from '@/components/shell/ServerRail'
import { FriendsPanel } from '@/components/friends/FriendsPanel'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SelectionProvider, useSelection } from '@/state/selection-context'

// Layout de 4 regiões da Fase 3 (RESEARCH.md §3): rail e sidebar fixos à
// esquerda, área de conversa elástica no centro, lista de membros fixa à
// direita. `overflow-hidden` no container raiz garante que a janela nunca
// gera scroll própria — só regiões internas rolam.
//
// Fase 6 acrescenta um segundo branch (`view === 'home'`, extraído para
// `ShellBody` porque precisa de `useSelection()`, que só existe dentro de
// `SelectionProvider`): `ServerRail` continua sempre visível, mas
// `ChannelSidebar`/`MemberList` somem e `FriendsPanel` ocupa o centro. O
// plano 06-07 troca essa segunda região por `DmSidebar`/`DmConversationView`
// condicionalmente; por ora `view === 'home'` sempre mostra `FriendsPanel`
// direto, sem sidebar própria.
function ShellBody(): React.JSX.Element {
  const { view } = useSelection()

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-background text-foreground">
      <div className="flex-none w-[72px] bg-sidebar border-r border-sidebar-border">
        <ServerRail />
      </div>

      {view === 'server' ? (
        <>
          <div className="flex-none w-60 bg-secondary border-r border-border">
            <ChannelSidebar />
          </div>

          <div className="flex-1 min-w-0 flex flex-col bg-background">
            <ConversationArea />
          </div>

          <div className="flex-none w-60 bg-secondary border-l border-border">
            <MemberList />
          </div>
        </>
      ) : (
        <div className="flex-1 min-w-0 flex flex-col bg-background">
          <FriendsPanel />
        </div>
      )}
    </div>
  )
}

export function AppShell(): React.JSX.Element {
  return (
    <SelectionProvider>
      <TooltipProvider>
        <ShellBody />
      </TooltipProvider>
    </SelectionProvider>
  )
}
