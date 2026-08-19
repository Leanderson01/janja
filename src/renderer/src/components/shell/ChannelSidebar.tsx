import { useState } from 'react'
import { useQuery } from 'convex/react'
import { ChevronRight, Hash, MicOff, MonitorUp, Plus, UserPlus, Volume2 } from 'lucide-react'

import { CreateChannelDialog } from '@/components/shell/CreateChannelDialog'
import { InviteDialog } from '@/components/shell/InviteDialog'
import { VoiceControlBar } from '@/components/shell/VoiceControlBar'
import { UserPanel } from '@/features/auth/UserPanel'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { loadSidebarPreferences, saveSidebarPreferences } from '@/lib/sidebar-preferences'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

import { api } from '../../../../../convex/_generated/api'
import type { Doc } from '../../../../../convex/_generated/dataModel'

function initialsFor(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

// Sidebar de canais (Plano 03-02) — a partir do plano 04-06 lê canais reais
// via `api.channels.listChannels` em vez de `mock-data.ts`. `VoiceControlBar`
// (mesmo plano da Fase 3) segue como rodapé fixo, fora da área rolável.
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
        <VoiceControlBar />
        <UserPanel />
      </div>
    )
  }

  const selectedServer = servers?.find((s) => s._id === selectedServerId)
  const textChannels = channels?.filter((channel) => channel.type === 'text') ?? []
  const voiceChannels = channels?.filter((channel) => channel.type === 'voice') ?? []

  return (
    <div className="h-full flex flex-col">
      <div className="h-12 flex-none flex items-center justify-between px-3 border-b border-border">
        <span className="font-semibold text-foreground truncate">{selectedServer?.name}</span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Convidar"
                onClick={() => setInviteOpen(true)}
              >
                <UserPlus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Convidar</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Criar canal"
                onClick={() => setCreateChannelOpen(true)}
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Criar canal</TooltipContent>
          </Tooltip>
        </div>
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

      <VoiceControlBar />
      <UserPanel />

      <InviteDialog serverId={selectedServerId} open={inviteOpen} onOpenChange={setInviteOpen} />
      <CreateChannelDialog
        serverId={selectedServerId}
        open={createChannelOpen}
        onOpenChange={setCreateChannelOpen}
      />
    </div>
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

function TextChannelRow({
  channel,
  isSelected,
  unreadCount,
  onClick
}: {
  channel: Doc<'channels'>
  isSelected: boolean
  unreadCount: number
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors',
        isSelected
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
      )}
    >
      <Hash className="size-4 shrink-0" />
      <span className="flex-1 truncate">{channel.name}</span>
      {unreadCount > 0 && (
        <Badge variant="secondary" className="shrink-0">
          {unreadCount}
        </Badge>
      )}
    </button>
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

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors',
          isSelected
            ? 'bg-accent text-accent-foreground'
            : isJoined
              ? 'text-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
        )}
      >
        <Volume2 className="size-4 shrink-0" />
        <span className="flex-1 truncate">{channel.name}</span>
      </button>

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
                <Avatar size="sm" className={isSpeaking ? 'ring-2 ring-green-500' : undefined}>
                  <AvatarFallback>{initialsFor(participant.username)}</AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate">{participant.username}</span>
                {/* SHARE-05 (Plano 08-06): `sharing` já vem na mesma linha de
                    `voiceStates` que esta query devolve desde 07-04 — nenhuma
                    query nova. E, ao contrário do anel de fala acima, ele NÃO
                    depende de `isJoined`: o ponto do indicador é justamente
                    ser visto por quem ainda não entrou no canal. */}
                {participant.sharing ? (
                  <MonitorUp
                    className="size-3 shrink-0 text-green-500"
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
