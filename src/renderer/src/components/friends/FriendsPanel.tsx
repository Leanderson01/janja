import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { Copy, MoreVertical, Users } from 'lucide-react'
import { toast } from 'sonner'

import { UserAvatar } from '@/components/shell/UserAvatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { displayNameOf } from '@/lib/display-name'
import { friendsForTab, type FriendsTab } from '@/lib/friends-tabs'
import { parseUserTag } from '@/lib/user-tag'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'
import { readableConvexError } from '@/lib/convex-error'

import { api } from '../../../../../convex/_generated/api'

import { FriendRowView } from './FriendRowView'

// Painel "Início" (Fase 6, plano 06-06): busca/adicionar amigo por
// USER#123, pedidos recebidos e lista de amigos com presença — tudo sobre
// dado real do Convex (convex/friends.ts, já registrado em api.ts). Segue o
// mesmo padrão visual de agrupamento/avatares de `MemberList.tsx` e a mesma
// alternância manual de estado de `VoiceControlBar.tsx` (sem componente de
// Tabs — 06-RESEARCH.md §6).

type Friend = FunctionReturnType<typeof api.friends.listFriends>[number]
type IncomingRequest = FunctionReturnType<typeof api.friends.listIncomingFriendRequests>[number]
type FoundUser = FunctionReturnType<typeof api.users.findUserByUsernameTag>

// Meu próprio identificador USER#123. `username`/`tag` vivem em `users`
// (Convex), não no perfil WorkOS de `useAuth()` — é por isso que
// `UserPanel.tsx` deliberadamente não mostra esse identificador (ver
// comentário lá).
//
// Antes isto chamava a MUTATION `ensureUser` só para ler o documento de
// volta, porque não existia query de "eu". Agora existe (`users.me`), e a
// diferença não é de estilo: `useQuery` é uma subscription, então renomear
// o perfil no diálogo de edição atualiza este crachá na hora, sem remontar
// o painel. `undefined` = ainda carregando; `null` = sem sessão.
function useMyIdentifier(): { username: string; tag: string } | null {
  const me = useQuery(api.users.me, {})
  if (!me) return null
  return { username: me.username, tag: me.tag }
}

function MyIdentifierBadge({
  username,
  tag
}: {
  username: string
  tag: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const label = `${username}#${tag}`

  function handleCopy(): void {
    navigator.clipboard
      .writeText(label)
      .then(() => setCopied(true))
      .catch((err: unknown) => console.error('Falha ao copiar USER#123:', err))
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="font-mono"
          onClick={handleCopy}
          onMouseLeave={() => setCopied(false)}
        >
          {label}
          <Copy className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copiado!' : 'Copiar seu USER#123'}</TooltipContent>
    </Tooltip>
  )
}

// Mensagem crua do erro (Convex devolve texto longo com request id e stack).
// Ela vira a *descrição* do toast, nunca o título: o título diz o que falhou em
// português, a descrição preserva o que a UI antiga mostrava inline e é o que
// ainda serve para depurar.
// Antes devolvia `err.message` cru — o que colocava o ID de request e o stack do
// servidor na `description` de cinco toasts, enterrando a frase em português que a
// mutation escreveu para o usuário. Ver `lib/convex-error.ts`.
function errorMessage(err: unknown): string {
  return readableConvexError(err)
}

function FriendCount({ label, count }: { label: string; count: number }): React.JSX.Element {
  return (
    <h3 className="px-5 pb-2 pt-4 text-xs font-semibold text-muted-foreground">
      {label} — {count}
    </h3>
  )
}

function EmptyState({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="p-6 text-sm text-muted-foreground">{children}</div>
}

function FriendMenu({
  label,
  onRemove
}: {
  label: string
  onRemove: () => void
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="rounded-full"
              aria-label={`Mais opções de ${label}`}
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Mais</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem variant="destructive" onSelect={onRemove}>
          Remover amizade
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FriendsListTab({ tab }: { tab: 'online' | 'todos' }): React.JSX.Element {
  const friends = useQuery(api.friends.listFriends)
  const removeFriendship = useMutation(api.friends.removeFriendship)
  const getOrCreateDmChannel = useMutation(api.dms.getOrCreateDmChannel)
  const { setSelectedDmChannelId } = useSelection()

  // Resultado de operação de rede vira toast (Fase 8.5): o Sonner cuida de
  // empilhamento, tempo de vida e aria-live.
  function handleRemove(friend: Friend): void {
    const label = displayNameOf(friend)
    removeFriendship({ friendUserId: friend.userId })
      .then(() => {
        toast.success(`${label} removido dos seus amigos`)
      })
      .catch((err: unknown) => {
        // Nunca deixar a Promise rejeitada sem tratamento: um segundo cliente
        // já tendo desfeito a amizade viraria erro silencioso no console.
        toast.error('Não foi possível remover o amigo', { description: errorMessage(err) })
      })
  }

  // Botão Mensagem (plano 06-07): getOrCreateDmChannel devolve o canal
  // existente ou cria um novo entre mim e o amigo.
  async function handleMessage(friend: Friend): Promise<void> {
    try {
      const dmChannelId = await getOrCreateDmChannel({ friendUserId: friend.userId })
      setSelectedDmChannelId(dmChannelId)
    } catch (err) {
      toast.error('Não foi possível abrir a conversa', { description: errorMessage(err) })
    }
  }

  if (friends === undefined) {
    return <EmptyState>Carregando...</EmptyState>
  }

  if (friends.length === 0) {
    return (
      <EmptyState>
        Nenhum amigo ainda — use a aba Adicionar amigo para buscar por USER#123
      </EmptyState>
    )
  }

  const shown = friendsForTab(friends, tab)
  if (shown.length === 0) {
    return <EmptyState>Ninguém está online agora</EmptyState>
  }

  return (
    <ScrollArea className="h-full">
      <FriendCount label={tab === 'online' ? 'Online' : 'Todos os amigos'} count={shown.length} />
      <div className="flex flex-col pb-4">
        {shown.map((friend) => (
          <FriendRowView
            key={friend.userId}
            userId={friend.userId}
            displayName={displayNameOf(friend)}
            username={friend.username}
            avatarUrl={friend.avatarUrl}
            online={friend.online}
            onMessage={() => void handleMessage(friend)}
            menu={
              <FriendMenu label={displayNameOf(friend)} onRemove={() => handleRemove(friend)} />
            }
          />
        ))}
      </div>
    </ScrollArea>
  )
}

function PendingTab(): React.JSX.Element {
  const incoming = useQuery(api.friends.listIncomingFriendRequests)
  const outgoing = useQuery(api.friends.listOutgoingFriendRequests)
  const acceptFriendRequest = useMutation(api.friends.acceptFriendRequest)
  const rejectFriendRequest = useMutation(api.friends.rejectFriendRequest)

  async function handleAccept(request: IncomingRequest): Promise<void> {
    const label = displayNameOf(request)
    try {
      await acceptFriendRequest({ requestId: request.requestId })
      toast.success(`Agora você e ${label} são amigos`)
    } catch (err) {
      toast.error('Não foi possível aceitar o pedido', { description: errorMessage(err) })
    }
  }

  async function handleReject(request: IncomingRequest): Promise<void> {
    const label = displayNameOf(request)
    try {
      await rejectFriendRequest({ requestId: request.requestId })
      toast.success(`Pedido de ${label} recusado`)
    } catch (err) {
      toast.error('Não foi possível recusar o pedido', { description: errorMessage(err) })
    }
  }

  if (incoming === undefined || outgoing === undefined) {
    return <EmptyState>Carregando...</EmptyState>
  }

  if (incoming.length === 0 && outgoing.length === 0) {
    return <EmptyState>Nenhum pedido pendente</EmptyState>
  }

  return (
    <ScrollArea className="h-full">
      <div className="pb-4">
        {incoming.length > 0 ? (
          <>
            <FriendCount label="Recebidos" count={incoming.length} />
            {incoming.map((request) => (
              <FriendRowView
                key={request.requestId}
                userId={request.fromUserId}
                displayName={displayNameOf(request)}
                username={request.username}
                avatarUrl={request.avatarUrl}
                online={false}
                pending="recebido"
                onAccept={() => void handleAccept(request)}
                onReject={() => void handleReject(request)}
              />
            ))}
          </>
        ) : null}
        {outgoing.length > 0 ? (
          <>
            <FriendCount label="Enviados" count={outgoing.length} />
            {outgoing.map((request) => (
              <FriendRowView
                key={request.requestId}
                userId={request.toUserId}
                displayName={displayNameOf(request)}
                username={request.username}
                avatarUrl={request.avatarUrl}
                online={false}
                pending="enviado"
              />
            ))}
          </>
        ) : null}
      </div>
    </ScrollArea>
  )
}

function AddFriendTab(): React.JSX.Element {
  const [rawInput, setRawInput] = useState('')
  // `formError` é o ÚNICO feedback que continua inline neste painel, de
  // propósito: é validação do que o usuário acabou de digitar no campo, e erro
  // de campo pertence ao campo — num toast ele sumiria enquanto o valor
  // inválido continua na tela. Resultado de mutation (rede) vai para toast.
  const [formError, setFormError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<{ username: string; tag: string } | null>(null)

  // Padrão oficial do Convex para pular a query até ter argumentos válidos
  // — nunca consultar com argumentos vazios/placeholder.
  const found: FoundUser | undefined = useQuery(
    api.users.findUserByUsernameTag,
    submitted ?? 'skip'
  )
  const sendFriendRequest = useMutation(api.friends.sendFriendRequest)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = parseUserTag(rawInput)
    if (!parsed) {
      setFormError('Formato inválido — use usuario#0001')
      setSubmitted(null)
      return
    }
    setFormError(null)
    setSubmitted(parsed)
  }

  async function handleSendRequest(): Promise<void> {
    if (!submitted) return
    const label = `${submitted.username}#${submitted.tag}`
    try {
      await sendFriendRequest({ username: submitted.username, tag: submitted.tag })
      toast.success(`Pedido de amizade enviado para ${label}`)
      setRawInput('')
      setSubmitted(null)
    } catch (err) {
      toast.error('Não foi possível enviar o pedido', { description: errorMessage(err) })
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-6">
        <form className="flex gap-2" onSubmit={handleSubmit}>
          <Input
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder="usuario#0001"
            aria-label="Buscar por USER#123"
          />
          <Button type="submit">Buscar</Button>
        </form>

        {formError ? <p className="text-xs text-destructive">{formError}</p> : null}

        {submitted ? (
          found === undefined ? (
            <p className="text-sm text-muted-foreground">Buscando...</p>
          ) : found === null ? (
            <p className="text-sm text-muted-foreground">
              Nenhum usuário encontrado com esse USER#123
            </p>
          ) : (
            <div className="flex items-center gap-2 rounded border border-border p-2">
              <UserAvatar
                userId={found._id}
                avatarUrl={found.avatarUrl}
                name={displayNameOf(found)}
                size={40}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{found.displayName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {found.username}#{found.tag}
                </div>
              </div>
              <Button type="button" size="sm" onClick={() => void handleSendRequest()}>
                Enviar pedido de amizade
              </Button>
            </div>
          )
        ) : null}
      </div>
    </ScrollArea>
  )
}

const TABS: { id: Exclude<FriendsTab, 'adicionar'>; label: string }[] = [
  { id: 'online', label: 'Online' },
  { id: 'todos', label: 'Todos' },
  { id: 'pendente', label: 'Pendente' }
]

export function FriendsPanel(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<FriendsTab>('online')
  const me = useMyIdentifier()

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 flex-none items-center gap-3 border-b border-border px-4">
        <Users className="size-5 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-base font-semibold text-strong">Amigos</h2>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <div role="tablist" aria-label="Amigos" className="flex items-center gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'rounded-md px-2 py-0.5 text-base font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-secondary text-strong'
                  : 'text-muted-foreground hover:bg-accent hover:text-strong'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'adicionar'}
          onClick={() => setActiveTab('adicionar')}
          className={cn(
            'rounded-md px-2 py-0.5 text-base font-medium transition-colors',
            activeTab === 'adicionar'
              ? 'text-primary'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          )}
        >
          Adicionar amigo
        </button>
        <div className="ml-auto">
          {me ? <MyIdentifierBadge username={me.username} tag={me.tag} /> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === 'online' || activeTab === 'todos' ? (
          <FriendsListTab tab={activeTab} />
        ) : null}
        {activeTab === 'pendente' ? <PendingTab /> : null}
        {activeTab === 'adicionar' ? <AddFriendTab /> : null}
      </div>
    </div>
  )
}
