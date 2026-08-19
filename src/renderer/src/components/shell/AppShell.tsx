import { ChannelSidebar } from '@/components/shell/ChannelSidebar'
import { ConversationArea } from '@/components/shell/ConversationArea'
import { MemberList } from '@/components/shell/MemberList'
import { ScreenSharePicker } from '@/components/shell/ScreenSharePicker'
import { ServerRail } from '@/components/shell/ServerRail'
import { DmConversationView } from '@/components/friends/DmConversationView'
import { DmSidebar } from '@/components/friends/DmSidebar'
import { FriendsPanel } from '@/components/friends/FriendsPanel'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SelectionProvider, useSelection } from '@/state/selection-context'
import { VoiceProvider } from '@/state/voice-context'

// Layout de 4 regiões da Fase 3 (RESEARCH.md §3): rail e sidebar fixos à
// esquerda, área de conversa elástica no centro, lista de membros fixa à
// direita. `overflow-hidden` no container raiz garante que a janela nunca
// gera scroll própria — só regiões internas rolam.
//
// Fase 6 acrescenta um segundo branch (`view === 'home'`, extraído para
// `ShellBody` porque precisa de `useSelection()`, que só existe dentro de
// `SelectionProvider`): `ServerRail` continua sempre visível, mas
// `ChannelSidebar`/`MemberList` somem. No lugar de `ChannelSidebar` entra
// `DmSidebar` (lista de conversas diretas + atalho "Amigos"); no centro,
// `FriendsPanel` (selectedDmChannelId === null) ou `DmConversationView`
// (conversa aberta) — plano 06-07. Sem `MemberList` na visão Início
// (decisão registrada em 06-RESEARCH.md §7: Discord real também não mostra
// lista de membros na Home).
function ShellBody(): React.JSX.Element {
  const { view, selectedDmChannelId } = useSelection()

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
        <>
          <div className="flex-none w-60 bg-secondary border-r border-border">
            <DmSidebar />
          </div>

          <div className="flex-1 min-w-0 flex flex-col bg-background">
            {selectedDmChannelId === null ? (
              <FriendsPanel />
            ) : (
              <DmConversationView dmChannelId={selectedDmChannelId} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function AppShell(): React.JSX.Element {
  return (
    <SelectionProvider>
      <VoiceProvider>
        <TooltipProvider>
          <ShellBody />
          {/* SHARE-01 (Plano 08-04): uma única instância por app, não por
              canal — quem dispara o seletor é o processo main, que não sabe
              (nem precisa saber) qual canal de voz está ativo. Montado aqui
              dentro do VoiceProvider por vizinhança de assunto; não consome
              o contexto de voz. */}
          <ScreenSharePicker />
        </TooltipProvider>
      </VoiceProvider>
    </SelectionProvider>
  )
}
