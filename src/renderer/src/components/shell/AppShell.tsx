import { ChannelListResizeHandle } from '@/components/shell/ChannelListResizeHandle'
import { ChannelSidebar } from '@/components/shell/ChannelSidebar'
import { ConversationArea } from '@/components/shell/ConversationArea'
import { MemberList } from '@/components/shell/MemberList'
import { ServerRail } from '@/components/shell/ServerRail'
import { TitleBar } from '@/components/shell/TitleBar'
import { VoiceControlBar, VoiceQuickControls } from '@/components/shell/VoiceControlBar'
import { DmConversationView } from '@/components/friends/DmConversationView'
import { DmSidebar } from '@/components/friends/DmSidebar'
import { FriendsPanel } from '@/components/friends/FriendsPanel'
import { UserPanel } from '@/features/auth/UserPanel'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { clampChannelListWidth } from '@/lib/layout-preferences'
import { LayoutProvider, useLayout } from '@/state/layout-context'
import { SelectionProvider, useSelection } from '@/state/selection-context'
import { VoiceProvider } from '@/state/voice-context'
import { screenShare } from '@platform/screenshare'
import { useEffect, useState } from 'react'

// Layout da Fase 3 (RESEARCH.md §3), reestruturado na rodada 1 da UI do
// Discord: a raiz é uma coluna — a barra de título (`TitleBar`, 32px) em cima e,
// embaixo, uma linha com o rail de servidores e a MOLDURA (`data-content-frame`).
// A moldura tem canto superior esquerdo arredondado e agrupa a lista de canais,
// o chat e a lista de membros; o rail e a barra de título ficam no fundo
// `bg-sidebar`, e é o canto da moldura que recorta esse fundo.
// `overflow-hidden` na raiz garante que a janela nunca gera scroll própria —
// só regiões internas rolam.
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
//
// O `view` escolhe só o miolo de cada região — o rodapé de voz e o painel do
// usuário existem uma vez só, nas duas visões. Eles moram embaixo da lista de
// canais, dentro da moldura, até a Tarefa 7 da rodada mudá-los de lugar.
function ShellBody(): React.JSX.Element {
  const { view, selectedDmChannelId } = useSelection()
  const { membersVisible, channelListWidth, setChannelListWidth, commitChannelListWidth } =
    useLayout()

  // A largura guardada pode ter sido escolhida numa janela maior (ou com os
  // membros fechados). Na hora de desenhar, passa de novo pelo clamp com a
  // janela de AGORA, para o chat nunca ficar com menos de 400px.
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const channelColumnWidth = clampChannelListWidth(channelListWidth, viewportWidth, membersVisible)

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-sidebar text-foreground">
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        {/* Rail: 72px, sem borda — quem separa é a moldura. */}
        <div className="w-[72px] flex-none">
          <ServerRail />
        </div>

        {/* Moldura: a borda de cima e da esquerda e o canto de 10px é o que dá
            o desenho do Discord. `overflow-hidden` recorta os filhos no canto. */}
        <div
          data-content-frame
          className="flex min-w-0 flex-1 overflow-hidden rounded-tl-[10px] border-t border-l border-sidebar-border"
        >
          {/* Coluna de canais: 240–360px, ajustável pela alça da borda direita
              (largura em `useLayout`, limitada para o chat manter 400px).
              `ChannelSidebar` e `DmSidebar` são o MESMO lugar do shell, então
              trocam entre si aqui dentro. */}
          <div
            className="relative flex flex-none flex-col bg-sidebar"
            style={{ width: channelColumnWidth }}
          >
            <ChannelListResizeHandle
              width={channelColumnWidth}
              onResize={setChannelListWidth}
              onResizeEnd={commitChannelListWidth}
            />
            <div className="min-h-0 flex-1">
              {view === 'server' ? <ChannelSidebar /> : <DmSidebar />}
            </div>

            {/* Faixas 1 e 2 do rodapé (status da call + ações da call). Vive
                aqui, e não dentro do `ChannelSidebar`, porque status de
                chamada não é assunto de servidor: quem está numa call e vai
                para a visão Início continua conectado, e precisa do
                "Conectado a {canal}" e do botão de desconectar. Montado uma
                vez só, nas duas visões. */}
            <VoiceControlBar />

            {/* Faixa 3: identidade à esquerda, microfone/fone/configurações à
                direita. Controles do APARELHO, não da chamada: existem com ou
                sem call ativa (o testador de microfone, VOICE-21, depende
                disso). Fica aqui até a Tarefa 7 da rodada. */}
            <div className="flex flex-none items-center gap-1 border-t border-sidebar-border px-2 py-1.5">
              <UserPanel />
              <VoiceQuickControls />
            </div>
          </div>

          {/* Área principal: elástica, `min-w-0` para poder encolher abaixo do
              conteúdo. */}
          <div className="flex min-w-0 flex-1 flex-col bg-background">
            {view === 'server' ? (
              <ConversationArea />
            ) : selectedDmChannelId === null ? (
              <FriendsPanel />
            ) : (
              <DmConversationView dmChannelId={selectedDmChannelId} />
            )}
          </div>

          {/* Janela estreita (Plano 08.5-05): a lista de membros é a válvula de
              escape da área principal. As colunas somam 552px no mínimo (rail 72 +
              canais 240 + membros 240) e a janela mínima é 900x600
              (`src/main/index.ts`) — esconder a lista devolve 240px para a
              conversa. A coluna central já é `flex-1 min-w-0`, então absorve o
              espaço sozinha.

              Desmontada de verdade, nunca escondida por `hidden`/`w-0`:
              `MemberList` mantém duas subscriptions do Convex
              (`listServerMembers` e `voiceParticipantsByServer`) e esconder por
              CSS as manteria vivas sem ninguém olhando.

              A visão Início não tem lista de membros (06-RESEARCH.md §7). */}
          {view === 'server' && membersVisible ? (
            <div className="w-60 flex-none border-l border-border bg-background">
              <MemberList />
            </div>
          ) : null}
        </div>
      </div>
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
          {/* O que só existe num alvo. No ELECTRON isto é o seletor de
              tela/janela (SHARE-01, Plano 08-04): uma única instância por app,
              não por canal — quem dispara o seletor é o processo main, que não
              sabe (nem precisa saber) qual canal de voz está ativo. Montado
              aqui dentro do VoiceProvider por vizinhança de assunto; não
              consome o contexto de voz.

              Na WEB isto é `() => null`: quem desenha o seletor é o Chrome, e
              o componente do Electron nem chega a entrar no bundle — o alias
              `@platform` resolve para outra pasta e o Rollup nunca o alcança.
              É por isso que aqui não há `if` nenhum. */}
          <screenShare.Extras />
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
