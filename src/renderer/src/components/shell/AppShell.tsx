import { ChannelSidebar } from '@/components/shell/ChannelSidebar'
import { ConversationArea } from '@/components/shell/ConversationArea'
import { MemberList } from '@/components/shell/MemberList'
import { ScreenSharePicker } from '@/components/shell/ScreenSharePicker'
import { ServerRail } from '@/components/shell/ServerRail'
import { DmConversationView } from '@/components/friends/DmConversationView'
import { DmSidebar } from '@/components/friends/DmSidebar'
import { FriendsPanel } from '@/components/friends/FriendsPanel'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LayoutProvider, useLayout } from '@/state/layout-context'
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
  const { membersVisible } = useLayout()

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

          {/* Janela estreita (Plano 08.5-05): a lista de membros é a válvula
              de escape da área principal. As colunas fixas somam 552px
              (rail 72 + sidebar 240 + membros 240) e a janela mínima é
              900x600 (`src/main/index.ts`) — esconder a lista devolve 240px
              para a conversa. As larguras continuam fixas (decisão da F3,
              não reaberta); o que muda é a coluna existir ou não. A coluna
              central já é `flex-1 min-w-0`, então absorve o espaço sozinha.

              Desmontada de verdade, nunca escondida por `hidden`/`w-0`:
              `MemberList` mantém duas subscriptions do Convex
              (`listServerMembers` e `voiceParticipantsByServer`) e esconder
              por CSS as manteria vivas sem ninguém olhando.

              A visão Início não tem lista de membros e não ganha o botão
              (06-RESEARCH.md §7) — nada a condicionar no outro branch. */}
          {membersVisible ? (
            <div className="flex-none w-60 bg-secondary border-l border-border">
              <MemberList />
            </div>
          ) : null}
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
          {/* Estado de layout da janela (Plano 08.5-05): mora acima do
              `ShellBody` porque quem alterna a lista de membros é um botão do
              `ChannelHeader`, lá dentro da área de conversa, e quem obedece é
              a coluna da direita — dois pontos distantes na árvore, com a
              área de conversa inteira no meio. Envolve só o `ShellBody`:
              nem o seletor de tela nem o Toaster têm layout de janela. */}
          <LayoutProvider>
            <ShellBody />
          </LayoutProvider>
          {/* SHARE-01 (Plano 08-04): uma única instância por app, não por
              canal — quem dispara o seletor é o processo main, que não sabe
              (nem precisa saber) qual canal de voz está ativo. Montado aqui
              dentro do VoiceProvider por vizinhança de assunto; não consome
              o contexto de voz. */}
          <ScreenSharePicker />
          {/* Toasts são o canal de feedback padrão da Fase 8.5: envio de
              mensagem que falhou, ação de menu concluída, convite copiado.
              Substituem os `.catch(() => {})` mudos que hoje engolem o erro
              sem contar nada a quem está usando o app.

              Uma única instância no app inteiro — `toast()` de `sonner` é uma
              API global e um segundo <Toaster /> renderizaria cada toast duas
              vezes. `richColors={false}` porque a UI é escura e monocromática:
              as cores próprias do sonner brigariam com os tokens do Plano
              08.5-01 (--success / --warning / --destructive). */}
          <Toaster position="bottom-right" richColors={false} />
        </TooltipProvider>
      </VoiceProvider>
    </SelectionProvider>
  )
}
