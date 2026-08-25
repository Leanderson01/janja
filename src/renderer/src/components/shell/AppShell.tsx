import { ChannelSidebar } from '@/components/shell/ChannelSidebar'
import { ConversationArea } from '@/components/shell/ConversationArea'
import { MemberList } from '@/components/shell/MemberList'
import { ServerRail } from '@/components/shell/ServerRail'
import { VoiceControlBar, VoiceQuickControls } from '@/components/shell/VoiceControlBar'
import { DmConversationView } from '@/components/friends/DmConversationView'
import { DmSidebar } from '@/components/friends/DmSidebar'
import { FriendsPanel } from '@/components/friends/FriendsPanel'
import { UserPanel } from '@/features/auth/UserPanel'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LayoutProvider, useLayout } from '@/state/layout-context'
import { SelectionProvider, useSelection } from '@/state/selection-context'
import { VoiceProvider } from '@/state/voice-context'
import { screenShare } from '@platform/screenshare'

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
//
// A correção pós-Windows agrupou rail e coluna de canais numa REGIÃO só (o
// canto esquerdo), com a faixa do usuário atravessando os dois por baixo. Por
// isso o `view` deixou de escolher entre duas árvores inteiras e passa a
// escolher só o miolo de cada região — o rodapé de voz e o painel do usuário
// existem uma vez só, nas duas visões.
function ShellBody(): React.JSX.Element {
  const { view, selectedDmChannelId } = useSelection()
  const { membersVisible } = useLayout()

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-background text-foreground">
      {/* CANTO INFERIOR ESQUERDO INTEIRO (correção pedida pelo Leo após o
          primeiro uso em Windows). Até aqui o rail de servidores era uma
          coluna de altura total e o painel do usuário morava espremido dentro
          da coluna de canais. Agora o rail e a coluna de canais são as DUAS
          colunas de uma mesma região, e o painel do usuário é a faixa que
          passa por baixo das duas — mesma disposição do Discord, e o que ele
          pediu com "a parte de configuração do usuário pode ficar um index
          acima da barra lateral onde ficam os servidores".

          Nenhum z-index é necessário para isso: a faixa não fica POR CIMA do
          rail, ela é irmã dele na mesma coluna flex. O resultado na tela é o
          mesmo (a faixa atravessa o canto), sem sobreposição para acertar.

          Largura total 344px = 72 (rail) + 272 (canais). Nenhuma borda entra
          nessa conta: a linha que separa esta região da área principal é o
          `border-l` da coluna do centro, e por isso ela corre ao lado da faixa
          do usuário também, não só ao lado da lista de canais. */}
      <div className="flex-none w-[344px] flex flex-col bg-sidebar">
        <div className="flex-1 min-h-0 flex">
          <div className="flex-none w-[72px] border-r border-sidebar-border">
            <ServerRail />
          </div>

          {/* 272px, não os 240px originais da Fase 3 ("está tudo muito
              apertado"). A conta que justifica: o rodapé de voz carregava
              cinco botões `size-8` mais gap e padding, ~216px dos 240px da
              coluna, sobrando ~24px para o texto de status (medido no
              08.5-09-SUMMARY). A largura sozinha não resolveria isso — quem
              resolve é o empilhamento em faixas do `VoiceControlBar` —, mas
              32px a mais é o que faz nome de canal, de servidor e de usuário
              pararem de truncar cedo demais.

              Continua FIXA: a decisão da Fase 3 (sem arrastar borda) não foi
              reaberta, só o número mudou. O rail segue 72px e a lista de
              membros segue 240px.

              `ChannelSidebar` e `DmSidebar` são o MESMO lugar do shell, então
              trocam entre si dentro desta coluna em vez de cada uma trazer a
              própria moldura. */}
          <div className="flex-1 min-w-0 flex flex-col bg-secondary">
            <div className="flex-1 min-h-0">
              {view === 'server' ? <ChannelSidebar /> : <DmSidebar />}
            </div>

            {/* Faixas 1 e 2 do rodapé (status da call + ações da call). Subiu
                de dentro do `ChannelSidebar` para cá porque status de chamada
                não é assunto de servidor: quem está numa call e vai para a
                visão Início continuava conectado, mas perdia da vista o
                "Conectado a {canal}" e o botão de desconectar. Montado uma vez
                só, nas duas visões. */}
            <VoiceControlBar />
          </div>
        </div>

        {/* Faixa 3: identidade à esquerda, microfone/fone/configurações à
            direita — a mesma linha do Discord. Atravessa o rail e a coluna de
            canais (os 344px inteiros), que é exatamente o espaço que faltava:
            o painel do usuário disputava 240px com cinco botões do rodapé de
            voz e perdia.

            Os três botões são controles do APARELHO, não da chamada: existem
            com ou sem call ativa (o testador de microfone, VOICE-21, depende
            disso), enquanto as faixas 1 e 2 — status e ações da call — só
            aparecem conectado, na coluna de canais.

            `border-sidebar-border` (não `border-border`) porque a faixa está
            sobre `--sidebar`. */}
        <div className="flex-none flex items-center gap-1 border-t border-sidebar-border px-2 py-1.5">
          <UserPanel />
          <VoiceQuickControls />
        </div>
      </div>

      {/* Área principal: elástica, `min-w-0` para poder encolher abaixo do
          conteúdo. O `border-l` mora aqui (e não como `border-r` da coluna de
          canais) para a linha correr de cima a baixo, ao lado da faixa do
          usuário inclusive. */}
      <div className="flex-1 min-w-0 flex flex-col bg-background border-l border-border">
        {view === 'server' ? (
          <ConversationArea />
        ) : selectedDmChannelId === null ? (
          <FriendsPanel />
        ) : (
          <DmConversationView dmChannelId={selectedDmChannelId} />
        )}
      </div>

      {/* Janela estreita (Plano 08.5-05): a lista de membros é a válvula de
          escape da área principal. As colunas fixas somam 584px (rail 72 +
          canais 272 + membros 240) e a janela mínima é 900x600
          (`src/main/index.ts`) — esconder a lista devolve 240px para a
          conversa (316px -> 556px na janela mínima). As larguras continuam
          fixas (decisão da F3, não reaberta); o que muda é a coluna existir ou
          não. A coluna central já é `flex-1 min-w-0`, então absorve o espaço
          sozinha.

          Desmontada de verdade, nunca escondida por `hidden`/`w-0`:
          `MemberList` mantém duas subscriptions do Convex
          (`listServerMembers` e `voiceParticipantsByServer`) e esconder por CSS
          as manteria vivas sem ninguém olhando.

          A visão Início não tem lista de membros (06-RESEARCH.md §7) — daí a
          condição por `view` também. */}
      {view === 'server' && membersVisible ? (
        <div className="flex-none w-60 bg-secondary border-l border-border">
          <MemberList />
        </div>
      ) : null}
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
