import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  Check,
  ChevronDown,
  Copy,
  Hash,
  HeadphoneOff,
  LogIn,
  Maximize2,
  MicOff,
  Plus,
  UserPlus,
  Volume2
} from 'lucide-react'
import { toast } from 'sonner'

import { CallTimer } from '@/components/shell/CallTimer'
import { CreateChannelDialog } from '@/components/shell/CreateChannelDialog'
import { InviteDialog } from '@/components/shell/InviteDialog'
import { UserAvatar } from '@/components/shell/UserAvatar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { callStartedAt } from '@/lib/call-timer'
import { displayNameOf } from '@/lib/display-name'
import { loadSidebarPreferences, saveSidebarPreferences } from '@/lib/sidebar-preferences'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

import { api } from '../../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../../convex/_generated/dataModel'

// Sidebar de canais (Plano 03-02) — a partir do plano 04-06 lê canais reais
// via `api.channels.listChannels` em vez de `mock-data.ts`.
//
// O rodapé de voz e o painel do usuário NÃO moram mais aqui (correção
// pós-Windows): subiram para o `AppShell`. O painel do usuário precisava
// atravessar o rail de servidores, o que é impossível de dentro desta coluna;
// e o rodapé de voz precisava continuar visível na visão Início, onde esta
// sidebar nem é montada. Esta lista virou só a lista.
//
// Agrupamento fixo em duas seções (Canais de texto / Canais de voz) — o modelo real de canal desta
// fase não tem `category` (era um campo só do mock). Badge de não lidas por
// canal (CHAT-06, plano 05-04) alimentado por `getUnreadCounts` — só canais
// de texto ganham badge, a query já filtra canal de voz. Lista de
// participantes de voz aninhados sob o canal (Plano 07-04) vem de
// `api.voice.voiceParticipantsByServer` (uma assinatura para o servidor todo) — dado real de `voiceStates`.
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

  // Uma assinatura só para o servidor inteiro (em vez de uma por canal de voz):
  // alimenta as linhas de voz e decide quais canais de voz ficam fixados quando
  // a seção está recolhida.
  const voiceParticipants = useQuery(
    api.voice.voiceParticipantsByServer,
    selectedServerId ? { serverId: selectedServerId } : 'skip'
  )
  const participantsByChannel = new Map<Id<'channels'>, NonNullable<typeof voiceParticipants>>()
  for (const participant of voiceParticipants ?? []) {
    const list = participantsByChannel.get(participant.channelId) ?? []
    list.push(participant)
    participantsByChannel.set(participant.channelId, list)
  }

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
  // `VoiceConnectedSection` (`PhoneOff`, rotulado "Desconectar"). O comportamento
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

  const renderTextRow = (channel: Doc<'channels'>): React.JSX.Element => (
    <TextChannelRow
      key={channel._id}
      channel={channel}
      isSelected={channel._id === selectedChannelId}
      unreadCount={unreadByChannel.get(channel._id) ?? 0}
      onClick={() => handleTextChannelClick(channel)}
      markAsRead={markChannelAsRead}
      onInvite={() => setInviteOpen(true)}
    />
  )

  const renderVoiceRow = (channel: Doc<'channels'>): React.JSX.Element => (
    <VoiceChannelRow
      key={channel._id}
      channel={channel}
      participants={participantsByChannel.get(channel._id) ?? []}
      isSelected={channel._id === selectedChannelId}
      isJoined={channel._id === joinedVoiceChannelId}
      onClick={() => handleVoiceChannelClick(channel)}
    />
  )

  // Com a seção recolhida continuam visíveis: o canal de texto aberto e os
  // canais de voz com gente (ou o aberto/conectado).
  const pinnedText = textChannels.filter((channel) => channel._id === selectedChannelId)
  const pinnedVoice = voiceChannels.filter(
    (channel) =>
      (participantsByChannel.get(channel._id)?.length ?? 0) > 0 ||
      channel._id === selectedChannelId ||
      channel._id === joinedVoiceChannelId
  )

  return (
    <div className="h-full flex flex-col">
      <div className="flex h-12 flex-none items-center gap-1 border-b border-sidebar-border px-4">
        <ServerMenu
          serverName={selectedServer?.name ?? ''}
          onInvite={() => setInviteOpen(true)}
          onCreateChannel={() => setCreateChannelOpen(true)}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Convidar pessoas"
              onClick={() => setInviteOpen(true)}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-strong"
            >
              <UserPlus className="size-5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Convidar pessoas</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-2 pb-[calc(var(--user-area-height,0px)+16px)]">
          {/* channels === undefined enquanto a subscription não resolve — não é
              erro, é carregamento; mantemos a estrutura sem itens até chegar
              dado real. */}
          {textChannels.length > 0 && (
            <ChannelSection
              label="Canais de texto"
              open={!sidebarPreferences.textCollapsed}
              onOpenChange={(open) => setSectionOpen('text', open)}
              pinned={pinnedText.map(renderTextRow)}
            >
              {textChannels.map(renderTextRow)}
            </ChannelSection>
          )}

          {voiceChannels.length > 0 && (
            <ChannelSection
              label="Canais de voz"
              open={!sidebarPreferences.voiceCollapsed}
              onOpenChange={(open) => setSectionOpen('voice', open)}
              pinned={pinnedVoice.map(renderVoiceRow)}
            >
              {voiceChannels.map(renderVoiceRow)}
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
  onCreateChannel,
  children
}: {
  serverName: string
  onInvite: () => void
  onCreateChannel: () => void
  // Gatilho próprio (rail de servidores): o clique esquerdo continua sendo do
  // filho; só o clique direito abre o menu. O gatilho do Radix vira uma âncora
  // invisível sobre o filho, só para posicionar o menu e devolver o foco.
  children?: ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {children ? (
        <div
          ref={wrapperRef}
          className="relative w-full"
          onContextMenu={(event) => {
            event.preventDefault()
            setOpen(true)
          }}
        >
          {children}
          <DropdownMenuTrigger asChild>
            <span aria-hidden="true" className="pointer-events-none absolute inset-0" />
          </DropdownMenuTrigger>
        </div>
      ) : (
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Menu do servidor ${serverName}`}
            onContextMenu={(event) => {
              event.preventDefault()
              setOpen(true)
            }}
            className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-md text-left text-base font-bold text-strong transition-colors hover:text-muted-foreground"
          >
            <span className="min-w-0 flex-1 truncate">{serverName}</span>
            {/* `aria-haspopup` e `aria-expanded` são do Radix; o chevron é só
              affordance visual e por isso fica escondido do leitor de tela. */}
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
      )}
      {/* SÓ o que já existe neste componente ou no backend de hoje. Fora, por
          decisão explícita: renomear/apagar servidor, sair do servidor e
          qualquer gerenciamento de permissão — não existe mutation para
          nenhum deles em `convex/`, e criá-las seria reescrever a autorização
          do backend. Menu não inventa capacidade. */}
      <DropdownMenuContent
        align="start"
        className="w-56"
        onCloseAutoFocus={(event) => {
          // Com gatilho próprio o foco volta para o botão do filho, não para a
          // âncora invisível.
          const target = wrapperRef.current?.querySelector('button')
          if (children && target) {
            event.preventDefault()
            target.focus()
          }
        }}
      >
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
// `pinned` são as linhas que continuam visíveis com a seção recolhida (canal
// aberto, canais de voz com gente) — como no Discord, recolher não esconde onde
// você está nem quem está falando. Com a seção aberta o conteúdo completo já as
// inclui, então `pinned` só é desenhado recolhido (nada aparece duas vezes).
export function ChannelSection({
  label,
  open,
  onOpenChange,
  pinned,
  children
}: {
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  pinned?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1 rounded-md px-2 pb-1 pt-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        <span className="truncate">{label}</span>
        {/* Um ícone só, girado por CSS: a transição é animável e não há troca
            de nó no DOM a cada clique. */}
        <ChevronDown
          className="size-3 shrink-0 transition-transform duration-200 group-data-[state=closed]:-rotate-90"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="flex flex-col gap-0.5">{children}</div>
      </CollapsibleContent>
      {open ? null : <div className="flex flex-col gap-0.5">{pinned}</div>}
    </Collapsible>
  )
}

// Assinatura da mutation `channelReadState.openChannel` como a linha de canal
// a enxerga. Mesmo motivo do `SendFriendRequest` do Plano 08.5-04: o tipo mora
// aqui para a linha poder receber a mutation por prop e ser montada sozinha em
// teste, sem `ConvexProvider`.
export type MarkChannelAsRead = (args: { channelId: Id<'channels'> }) => Promise<unknown>

// Menu do botão direito de uma linha de canal. Mesmo padrão do `ServerMenu`:
// `DropdownMenu` CONTROLADO, aberto pelo `onContextMenu` da linha, com uma
// âncora invisível para posicionar o menu. O `⋮` visível saiu na rodada 1 da UI
// do Discord — o clique direito é o gesto, como no app de referência.
function ChannelRowMenu({
  open,
  onOpenChange,
  focusRef,
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Botão principal da linha: recebe o foco de volta quando o menu fecha.
  focusRef: React.RefObject<HTMLButtonElement | null>
  children: ReactNode
}): React.JSX.Element {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" className="pointer-events-none absolute inset-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-56"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          focusRef.current?.focus()
        }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Exportada para o teste: a `ChannelSidebar` inteira depende de `useQuery`, do
// `useSelection` e do `useVoice`; esta linha não depende de nenhum contexto
// (o `Tooltip` do botão de convite só precisa de um `TooltipProvider`).
export function TextChannelRow({
  channel,
  isSelected,
  unreadCount,
  onClick,
  markAsRead,
  onInvite
}: {
  channel: Doc<'channels'>
  isSelected: boolean
  unreadCount: number
  onClick: () => void
  markAsRead: MarkChannelAsRead
  onInvite: () => void
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // Não lido NÃO mostra número: o Discord só acende o nome e a pílula.
  const unread = unreadCount > 0

  async function handleMarkAsRead(): Promise<void> {
    try {
      await markAsRead({ channelId: channel._id })
      toast.success('Canal marcado como lido')
    } catch {
      toast.error('Não foi possível marcar o canal como lido')
    }
  }

  return (
    <div
      className={cn(
        'group relative flex h-8 items-center gap-1.5 rounded-md px-2 transition-colors',
        isSelected
          ? 'bg-secondary text-strong'
          : cn(
              'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              unread ? 'text-strong' : 'text-muted-foreground'
            )
      )}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuOpen(true)
      }}
    >
      {unread && !isSelected ? (
        <span
          aria-hidden="true"
          className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r bg-strong"
        />
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        data-unread={unread ? 'true' : undefined}
        className={cn(
          'flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-base',
          unread ? 'font-semibold' : 'font-medium'
        )}
      >
        <Hash className="size-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate" title={channel.name}>
          {channel.name}
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Criar convite"
            onClick={onInvite}
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-opacity hover:text-strong focus-visible:opacity-100 group-hover:opacity-100',
              isSelected ? 'opacity-100' : 'opacity-0'
            )}
          >
            <UserPlus className="size-4" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Criar convite</TooltipContent>
      </Tooltip>
      {/* Só ações com backend hoje. Apagar canal, renomear canal e silenciar
          canal ficam de fora: não existe mutation para nenhuma delas em
          `convex/`. */}
      <ChannelRowMenu open={menuOpen} onOpenChange={setMenuOpen} focusRef={buttonRef}>
        <DropdownMenuItem onSelect={() => void handleMarkAsRead()}>
          <Check />
          Marcar como lido
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyToClipboard(channel.name, 'Nome copiado')}>
          <Copy />
          Copiar nome
        </DropdownMenuItem>
      </ChannelRowMenu>
    </div>
  )
}

type VoiceParticipant = {
  userId: string
  displayName: string
  username: string
  avatarUrl?: string | null
  muted: boolean
  deafened: boolean
  sharing: boolean
}

// Participante de voz aninhado sob o canal. Exportado para teste (não precisa de
// contexto nenhum; `speaking` entra por prop).
export function VoiceParticipantRow({
  participant,
  speaking
}: {
  participant: VoiceParticipant
  speaking: boolean
}): React.JSX.Element {
  const name = displayNameOf({
    displayName: participant.displayName,
    username: participant.username
  })

  return (
    <div className="flex h-[30px] items-center gap-2 pl-7 pr-2 text-muted-foreground">
      {/* VOICE-08: `--success` é significado (alguém está falando), não
          destaque. */}
      <UserAvatar
        userId={participant.userId}
        avatarUrl={participant.avatarUrl}
        name={name}
        size={24}
        className={cn(
          'rounded-full',
          speaking && 'ring-2 ring-success ring-offset-2 ring-offset-sidebar'
        )}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>
        {name}
      </span>
      {/* SHARE-05: `sharing` não depende de `isJoined` — o ponto do indicador é
          justamente ser visto por quem ainda não entrou no canal. */}
      {participant.sharing ? (
        <span className="shrink-0 rounded bg-destructive px-1.5 text-[10px] font-bold text-primary-foreground">
          AO VIVO
        </span>
      ) : null}
      {participant.deafened ? (
        <HeadphoneOff className="size-4 shrink-0" aria-label="Ensurdecido" />
      ) : participant.muted ? (
        <MicOff className="size-4 shrink-0" aria-label="Mutado" />
      ) : null}
    </div>
  )
}

function VoiceChannelRow({
  channel,
  participants,
  isSelected,
  isJoined,
  onClick
}: {
  channel: Doc<'channels'>
  participants: (VoiceParticipant & { joinedAt: number })[]
  isSelected: boolean
  isJoined: boolean
  onClick: () => void
}): React.JSX.Element {
  const { speakingUserIds } = useVoice()
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const startedAt = callStartedAt(participants)

  return (
    <div className="flex flex-col gap-0.5">
      <div
        className={cn(
          'group relative flex h-8 items-center gap-1.5 rounded-md px-2 transition-colors',
          isSelected
            ? 'bg-secondary text-strong'
            : cn(
                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                isJoined ? 'text-strong' : 'text-muted-foreground'
              )
        )}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenuOpen(true)
        }}
      >
        <button
          ref={buttonRef}
          type="button"
          onClick={onClick}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-base font-medium"
        >
          <Volume2 className="size-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" title={channel.name}>
            {channel.name}
          </span>
        </button>
        {/* Cronômetro só no canal em que você está, e só com gente nele. */}
        {isJoined && startedAt !== null ? <CallTimer since={startedAt} /> : null}
        {/* O item chama o MESMO `onClick` da linha — nenhuma lógica de junção
            duplicada. No canal em que você já está o gesto é voltar ao palco
            (contrato do Plano 08.5-03), não sair: sair é só o botão Desconectar
            da `VoiceConnectedSection`. */}
        <ChannelRowMenu open={menuOpen} onOpenChange={setMenuOpen} focusRef={buttonRef}>
          {isJoined ? (
            <DropdownMenuItem onSelect={onClick}>
              <Maximize2 />
              Voltar ao palco
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onClick}>
              <LogIn />
              Entrar
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void copyToClipboard(channel.name, 'Nome copiado')}>
            <Copy />
            Copiar nome
          </DropdownMenuItem>
        </ChannelRowMenu>
      </div>

      {participants.map((participant) => (
        // VOICE-08: anel de fala só é significativo dentro do canal ao qual o
        // próprio usuário está conectado — `speakingUserIds` é dado do `Room`
        // local.
        <VoiceParticipantRow
          key={participant.userId}
          participant={participant}
          speaking={isJoined && speakingUserIds.has(participant.userId)}
        />
      ))}
    </div>
  )
}
