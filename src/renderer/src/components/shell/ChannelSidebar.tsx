import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Hash,
  LogIn,
  Maximize2,
  MicOff,
  MonitorUp,
  MoreVertical,
  Plus,
  UserPlus,
  Volume2
} from 'lucide-react'
import { toast } from 'sonner'

import { CreateChannelDialog } from '@/components/shell/CreateChannelDialog'
import { InviteDialog } from '@/components/shell/InviteDialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { loadSidebarPreferences, saveSidebarPreferences } from '@/lib/sidebar-preferences'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

import { api } from '../../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../../convex/_generated/dataModel'

function initialsFor(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

// Sidebar de canais (Plano 03-02) — a partir do plano 04-06 lê canais reais
// via `api.channels.listChannels` em vez de `mock-data.ts`.
//
// O rodapé de voz e o painel do usuário NÃO moram mais aqui (correção
// pós-Windows): subiram para o `AppShell`. O painel do usuário precisava
// atravessar o rail de servidores, o que é impossível de dentro desta coluna;
// e o rodapé de voz precisava continuar visível na visão Início, onde esta
// sidebar nem é montada. Esta lista virou só a lista.
//
// Agrupamento fixo em duas seções (TEXTO/VOZ) — o modelo real de canal desta
// fase não tem `category` (era um campo só do mock). Badge de não lidas por
// canal (CHAT-06, plano 05-04) alimentado por `getUnreadCounts` — só canais
// de texto ganham badge, a query já filtra canal de voz. Lista de
// participantes de voz aninhados sob o canal (Plano 07-04) vem de
// `api.voice.voiceParticipantsByChannel` — dado real de `voiceStates`.
export function ChannelSidebar(): React.JSX.Element {
  const {
    servers,
    selectedServerId,
    selectedChannelId,
    setSelectedChannelId,
    joinedVoiceChannelId,
    setJoinedVoiceChannelId,
    showStage
  } = useSelection()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [createChannelOpen, setCreateChannelOpen] = useState(false)

  // Estado das seções recolhíveis (Plano 08.5-08). Preferência de MÁQUINA, em
  // `localStorage` — lida uma ÚNICA vez, na forma `useState(fn)` e não
  // `useState(load())`, que releria o storage a cada render. Daí em diante a
  // fonte da verdade é este estado; o storage só recebe escrita.
  const [sidebarPreferences, setSidebarPreferences] = useState(loadSidebarPreferences)

  // `saveSidebarPreferences` devolve o valor já sanitizado e mesclado com o
  // que estava persistido, então dá para alimentar o estado com o retorno dele
  // em vez de manter duas cópias da mesma verdade. O Radix fala em `open`; o
  // módulo de preferências fala em `collapsed` — a inversão mora aqui, num
  // lugar só.
  function setSectionOpen(section: 'text' | 'voice', open: boolean): void {
    setSidebarPreferences(
      saveSidebarPreferences(
        section === 'text' ? { textCollapsed: !open } : { voiceCollapsed: !open }
      )
    )
  }

  const channels = useQuery(
    api.channels.listChannels,
    selectedServerId ? { serverId: selectedServerId } : 'skip'
  )
  const unreadCounts = useQuery(
    api.channelReadState.getUnreadCounts,
    selectedServerId ? { serverId: selectedServerId } : 'skip'
  )
  const unreadByChannel = new Map((unreadCounts ?? []).map((u) => [u.channelId, u.unreadCount]))

  // Uma única assinatura de mutation para a sidebar inteira, repassada às
  // linhas de canal de texto (ver `MarkChannelAsRead` abaixo). `useMutation`
  // DENTRO de `TextChannelRow` tornaria a linha impossível de montar em teste:
  // ele lança "Could not find Convex client!" fora de um `ConvexProvider`.
  // Mesmo arranjo que o `MemberList` adotou no Plano 08.5-04.
  const markChannelAsRead = useMutation(api.channelReadState.openChannel)

  function handleTextChannelClick(channel: Doc<'channels'>): void {
    setSelectedChannelId(channel._id)
  }

  // Clicar num canal de voz NUNCA desconecta — só entra, ou volta ao palco do
  // canal em que já se está. Sair é ação exclusiva do botão de desconectar da
  // `VoiceControlBar` (`PhoneOff`, rotulado "Desconectar"). O comportamento
  // anterior era um toggle: clicar no canal em que você já estava te derrubava da
  // call. Isso é falha de affordance, não atalho — o mesmo gesto que serve para
  // "ver quem está aqui" não pode ser o gesto que encerra a chamada, e no Discord
  // real não é. Relatado pelo Leo em uso real, 2026-08-19.
  //
  // Plano 08.5-03: com o palco, o clique no canal CONECTADO é o gesto de VOLTAR
  // para a call, e por isso chama `showStage()` e mais nada. Chamar
  // `setSelectedChannelId` também aqui seria contraproducente: no provider,
  // selecionar canal desliga o palco (regra 3), então o "voltar" desligaria
  // exatamente o que veio ligar. Entrar/trocar de canal, sim, seleciona e conecta
  // — nessa ordem, porque quem fala por último sobre o palco é o join.
  function handleVoiceChannelClick(channel: Doc<'channels'>): void {
    if (joinedVoiceChannelId === channel._id) {
      showStage()
      return
    }
    setSelectedChannelId(channel._id)
    setJoinedVoiceChannelId(channel._id)
  }

  // Zero servidores (estado possível vindo do plano 04-05): não há
  // `serverId` para passar a `listChannels`, então nem tentamos — só um
  // estado vazio simples.
  if (selectedServerId === null) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 min-h-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground">
          Crie ou entre em um servidor para começar
        </div>
      </div>
    )
  }

  const selectedServer = servers?.find((s) => s._id === selectedServerId)
  const textChannels = channels?.filter((channel) => channel.type === 'text') ?? []
  const voiceChannels = channels?.filter((channel) => channel.type === 'voice') ?? []

  return (
    <div className="h-full flex flex-col">
      <div className="h-12 flex-none flex items-center px-3 border-b border-border">
        <ServerMenu
          serverName={selectedServer?.name ?? ''}
          onInvite={() => setInviteOpen(true)}
          onCreateChannel={() => setCreateChannelOpen(true)}
        />
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="py-3">
          {/* channels === undefined enquanto a subscription não resolve — não é
              erro, é carregamento; mantemos a estrutura sem itens até chegar
              dado real. */}
          {textChannels.length > 0 && (
            <ChannelSection
              label="TEXTO"
              open={!sidebarPreferences.textCollapsed}
              onOpenChange={(open) => setSectionOpen('text', open)}
            >
              {textChannels.map((channel) => (
                <TextChannelRow
                  key={channel._id}
                  channel={channel}
                  isSelected={channel._id === selectedChannelId}
                  unreadCount={unreadByChannel.get(channel._id) ?? 0}
                  onClick={() => handleTextChannelClick(channel)}
                  markAsRead={markChannelAsRead}
                />
              ))}
            </ChannelSection>
          )}

          {textChannels.length > 0 && voiceChannels.length > 0 && <Separator className="my-2" />}

          {voiceChannels.length > 0 && (
            <ChannelSection
              label="VOZ"
              open={!sidebarPreferences.voiceCollapsed}
              onOpenChange={(open) => setSectionOpen('voice', open)}
            >
              {voiceChannels.map((channel) => (
                <VoiceChannelRow
                  key={channel._id}
                  channel={channel}
                  isSelected={channel._id === selectedChannelId}
                  isJoined={channel._id === joinedVoiceChannelId}
                  onClick={() => handleVoiceChannelClick(channel)}
                />
              ))}
            </ChannelSection>
          )}
        </div>
      </ScrollArea>

      <InviteDialog serverId={selectedServerId} open={inviteOpen} onOpenChange={setInviteOpen} />
      <CreateChannelDialog
        serverId={selectedServerId}
        open={createChannelOpen}
        onOpenChange={setCreateChannelOpen}
      />
    </div>
  )
}

// Copiar texto para a área de transferência, com aviso nos dois desfechos
// (Plano 08.5-12). O `catch` não é decorativo: `navigator.clipboard` rejeita
// quando o documento não está em contexto seguro ou perde o foco, e um item de
// menu que não faz nada e não diz nada é pior do que não existir. Mesmo
// tratamento do menu do membro (Plano 08.5-04).
async function copyToClipboard(text: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
  } catch {
    toast.error('Não foi possível copiar')
  }
}

// Menu do servidor (Plano 08.5-12). O gatilho é o PRÓPRIO nome do servidor.
//
// Por que o nome virou gatilho: o cabeçalho antes gastava ~64px dos 240px da
// coluna com dois botões de ícone (Convidar, Criar canal), e o nome do servidor
// — a única informação permanente do cabeçalho — começava a truncar cedo
// demais. Na janela estreita que o 08.5-RESEARCH previu, o aperto é maior
// ainda. As duas ações continuam a um clique de distância, agora dentro do
// menu.
//
// Padrão único da fase (planos 08.5-02 e 08.5-04): `DropdownMenu` CONTROLADO,
// aberto por clique/Enter no gatilho E por `onContextMenu` no mesmo elemento.
// O `context-menu` do Radix não foi instalado de propósito — dois componentes
// de menu significariam dois comportamentos de teclado para manter.
//
// Exportado para o teste: `ChannelSidebar` inteira depende de três `useQuery`
// do Convex e de dois contextos; este componente não depende de nada.
export function ServerMenu({
  serverName,
  onInvite,
  onCreateChannel
}: {
  serverName: string
  onInvite: () => void
  onCreateChannel: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Menu do servidor ${serverName}`}
          onContextMenu={(event) => {
            event.preventDefault()
            setOpen(true)
          }}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md text-left font-semibold text-foreground transition-colors hover:text-muted-foreground"
        >
          <span className="min-w-0 flex-1 truncate">{serverName}</span>
          {/* `aria-haspopup` e `aria-expanded` são do Radix; o chevron é só
              affordance visual e por isso fica escondido do leitor de tela. */}
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      {/* SÓ o que já existe neste componente ou no backend de hoje. Fora, por
          decisão explícita: renomear/apagar servidor, sair do servidor e
          qualquer gerenciamento de permissão — não existe mutation para
          nenhum deles em `convex/`, e criá-las seria reescrever a autorização
          do backend. Menu não inventa capacidade. */}
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={onInvite}>
          <UserPlus />
          Convidar pessoas
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCreateChannel}>
          <Plus />
          Criar canal
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void copyToClipboard(serverName, 'Nome do servidor copiado')}
        >
          <Copy />
          Copiar nome do servidor
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Seção recolhível da sidebar (Plano 08.5-08). O `Collapsible` do Radix é
// quem fornece `aria-expanded`, `aria-controls` e o `data-state` — nada disso
// é escrito à mão aqui, e nenhum `onKeyDown` foi preciso: o gatilho é um
// `<button>` nativo, então Tab chega nele e Enter/Espaço alternam a seção de
// graça.
//
// Caso de borda conhecido e aceito: com a seção VOZ recolhida, os
// participantes aninhados sob cada canal somem junto — é o conteúdo da seção.
// Quem está CONECTADO não fica sem referência visual porque a
// `VoiceControlBar` do rodapé continua mostrando "Conectado a {canal}"; é ela
// que cobre esse caso, e por isso não existe estado especial aqui.
// Marcador de canal SELECIONADO (Plano 08.5-08). Mesmo vocabulário visual do
// indicador de servidor ativo do `ServerRail`: barra vertical fina, colada na
// borda esquerda, arredondada só do lado de fora, em `bg-highlight`.
//
// Por que ele existe, já que a linha selecionada tem `bg-accent`: num tema
// monocromático `bg-accent` é "um cinza a mais" e some ao lado do `hover`.
// Pela regra do tom único da fase (08.5-01), o destaque só aparece em estado
// ativo/selecionado, anel de foco e marcador de não-lido — este é o primeiro
// caso. O marcador COMPLEMENTA o `bg-accent`, não o substitui.
//
// Renderizado sempre (não condicionalmente) e escondido por opacidade, como
// no rail: assim a transição existe nos dois sentidos em vez de o nó aparecer
// e sumir do DOM. A 16px de altura, centralizado, ele nunca encosta no
// `rounded-md` de 6px da própria linha.
function SelectedMarker({ isSelected }: { isSelected: boolean }): React.JSX.Element {
  return (
    <span
      className={cn(
        'absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-highlight transition-all',
        isSelected ? 'h-4 opacity-100' : 'h-1 opacity-0'
      )}
      aria-hidden="true"
    />
  )
}

function ChannelSection({
  label,
  open,
  onOpenChange,
  children
}: {
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1 rounded-md px-3 pb-1 text-xs font-semibold uppercase text-muted-foreground transition-colors hover:text-foreground">
        {/* Um ícone só, girado por CSS, em vez de alternar
            ChevronRight/ChevronDown no JSX: assim a transição de 90° é
            animável e não há troca de nó no DOM a cada clique. */}
        <ChevronRight
          className="size-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90"
          aria-hidden="true"
        />
        <span className="truncate">{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="flex flex-col gap-0.5 px-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// Assinatura da mutation `channelReadState.openChannel` como a linha de canal
// a enxerga. Mesmo motivo do `SendFriendRequest` do Plano 08.5-04: o tipo mora
// aqui para a linha poder receber a mutation por prop e ser montada sozinha em
// teste, sem `ConvexProvider`.
export type MarkChannelAsRead = (args: { channelId: Id<'channels'> }) => Promise<unknown>

// Gatilho + casca do menu de canal (Plano 08.5-12), compartilhado pelas linhas
// de texto e de voz — só os itens mudam.
//
// Por que um botão irmão e não a linha inteira como gatilho, ao contrário do
// menu do membro (Plano 08.5-04): aqui a linha JÁ TEM ação primária (selecionar
// o canal, entrar na call). Se ela virasse o gatilho do menu, o clique esquerdo
// deixaria de navegar. E `<button>` dentro de `<button>` é HTML inválido — o
// aviso que o Plano 08.5-08 deixou registrado —, então a linha passou a ser um
// `<div>` com dois botões irmãos: o da ação primária e este.
//
// `opacity-0 group-hover:opacity-100` é o comportamento de mouse esperado. O
// `focus-visible:opacity-100` é o que impede o clássico "parece funcionar, não
// funciona no teclado": sem ele o botão RECEBE o foco por Tab e continua
// invisível, e quem navega por teclado fica sem saber onde está. O
// `data-[state=open]` mantém o botão visível enquanto o menu dele está aberto,
// inclusive quando foi o botão direito que o abriu e o ponteiro está longe.
//
// O espaço do botão é reservado sempre (ele não sai do fluxo), então a linha
// não muda de largura no hover e o nome do canal não "pula".
function ChannelRowMenu({
  channelName,
  open,
  onOpenChange,
  children
}: {
  channelName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Opções do canal ${channelName}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      {/* `align="end"`: o gatilho fica colado na borda direita de uma coluna de
          240px, então ancorar pelo começo jogaria o menu de 224px para fora da
          janela. */}
      <DropdownMenuContent align="end" className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Exportada para o teste de teclado (`ChannelSidebar.test.tsx`): a
// `ChannelSidebar` inteira depende de três `useQuery` do Convex, do
// `useSelection` e do `useVoice`; esta linha não depende de nenhum contexto.
export function TextChannelRow({
  channel,
  isSelected,
  unreadCount,
  onClick,
  markAsRead
}: {
  channel: Doc<'channels'>
  isSelected: boolean
  unreadCount: number
  onClick: () => void
  markAsRead: MarkChannelAsRead
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleMarkAsRead(): Promise<void> {
    try {
      await markAsRead({ channelId: channel._id })
      toast.success('Canal marcado como lido')
    } catch {
      toast.error('Não foi possível marcar o canal como lido')
    }
  }

  return (
    // Era um `<button>` até o Plano 08.5-12. Virou `<div>` com dois botões
    // irmãos porque o menu precisa de gatilho próprio e menu aninhado dentro de
    // `<button>` é HTML inválido. O estado visual (fundo, cor, hover) subiu
    // para este container para que o botão do menu fique SOBRE o mesmo fundo da
    // linha; o `relative` continua aqui por causa do `SelectedMarker`, que é
    // `absolute left-0`.
    <div
      className={cn(
        'group relative flex items-center rounded-md pr-1 transition-colors',
        isSelected
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
      )}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuOpen(true)
      }}
    >
      <SelectedMarker isSelected={isSelected} />
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
      >
        <Hash className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        {/* CHAT-06: "marcador de não-lido" é um dos três usos autorizados do
            `--highlight` (Plano 08.5-01). O `variant="secondary"` anterior era
            cinza sobre fundo cinza — o número existia, mas não chamava. */}
        {unreadCount > 0 && (
          <Badge className="shrink-0 bg-highlight text-highlight-foreground">{unreadCount}</Badge>
        )}
      </button>
      {/* Só ações com backend hoje. Apagar canal, renomear canal e silenciar
          canal ficam de fora: não existe mutation para nenhuma delas em
          `convex/`. */}
      <ChannelRowMenu channelName={channel.name} open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuItem onSelect={() => void handleMarkAsRead()}>
          <Check />
          Marcar como lido
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void copyToClipboard(channel.name, 'Nome do canal copiado')}
        >
          <Copy />
          Copiar nome do canal
        </DropdownMenuItem>
      </ChannelRowMenu>
    </div>
  )
}

function VoiceChannelRow({
  channel,
  isSelected,
  isJoined,
  onClick
}: {
  channel: Doc<'channels'>
  isSelected: boolean
  isJoined: boolean
  onClick: () => void
}): React.JSX.Element {
  // `undefined` enquanto a subscription não resolve — tratado como "sem
  // participantes ainda" (mesma convenção de `channels`/`unreadCounts`
  // acima), não como erro.
  const participants = useQuery(api.voice.voiceParticipantsByChannel, { channelId: channel._id })
  const { speakingUserIds } = useVoice()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="flex flex-col gap-0.5">
      {/* Mesma reestruturação da linha de texto (Plano 08.5-12): container
          `relative` com dois botões irmãos. Os participantes aninhados
          continuam fora dele, um nível acima. */}
      <div
        className={cn(
          'group relative flex items-center rounded-md pr-1 transition-colors',
          isSelected
            ? 'bg-accent text-accent-foreground'
            : isJoined
              ? 'text-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
        )}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenuOpen(true)
        }}
      >
        <SelectedMarker isSelected={isSelected} />
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
        >
          <Volume2 className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        </button>
        {/* O item chama o MESMO `onClick` da linha — nenhuma lógica de junção
            duplicada aqui. Por isso ele é rotulado pelo que o handler REALMENTE
            faz em cada estado: no canal em que você já está, o gesto é voltar
            ao palco (contrato do Plano 08.5-03), não sair. Um item "Sair do
            canal" ligado a este handler mentiria; e ligá-lo a uma desconexão
            de verdade duplicaria o botão Desconectar da `VoiceControlBar`, que
            desde o Plano 08.5-03 é o ÚNICO lugar que encerra a chamada. */}
        <ChannelRowMenu channelName={channel.name} open={menuOpen} onOpenChange={setMenuOpen}>
          {isJoined ? (
            <DropdownMenuItem onSelect={onClick}>
              <Maximize2 />
              Voltar ao palco
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onClick}>
              <LogIn />
              Entrar no canal
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => void copyToClipboard(channel.name, 'Nome do canal copiado')}
          >
            <Copy />
            Copiar nome do canal
          </DropdownMenuItem>
        </ChannelRowMenu>
      </div>

      {participants && participants.length > 0 ? (
        <div className="flex flex-col gap-0.5 pl-7">
          {participants.map((participant) => {
            // VOICE-08: anel de fala só é significativo dentro do canal ao
            // qual o próprio usuário está conectado — `speakingUserIds` é
            // dado do `Room` local, não existe para quem só está sendo
            // exibido na sidebar sem conexão real a esse canal.
            const isSpeaking = isJoined && speakingUserIds.has(participant.userId)
            return (
              <div
                key={participant.userId}
                className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground"
              >
                {/* VOICE-08: `--success` é significado (alguém está falando), não
                    destaque — não conta contra a regra do tom único. */}
                <Avatar size="sm" className={cn(isSpeaking && 'ring-2 ring-success')}>
                  <AvatarFallback>{initialsFor(participant.username)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate">{participant.username}</span>
                {/* SHARE-05 (Plano 08-06): `sharing` já vem na mesma linha de
                    `voiceStates` que esta query devolve desde 07-04 — nenhuma
                    query nova. E, ao contrário do anel de fala acima, ele NÃO
                    depende de `isJoined`: o ponto do indicador é justamente
                    ser visto por quem ainda não entrou no canal. */}
                {participant.sharing ? (
                  <MonitorUp
                    className="size-3 shrink-0 text-success"
                    aria-label="compartilhando a tela"
                  />
                ) : null}
                {participant.muted ? (
                  <MicOff className="size-3 shrink-0" aria-label="mutado" />
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
