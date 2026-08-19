import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { Check, Copy, MessageCircle, UserMinus, X } from 'lucide-react'

import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { parseUserTag } from '@/lib/user-tag'
import { useSelection } from '@/state/selection-context'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

// Painel "Início" (Fase 6, plano 06-06): busca/adicionar amigo por
// USER#123, pedidos recebidos e lista de amigos com presença — tudo sobre
// dado real do Convex (convex/friends.ts, já registrado em api.ts). Segue o
// mesmo padrão visual de agrupamento/avatares de `MemberList.tsx` e a mesma
// alternância manual de estado de `VoiceControlBar.tsx` (sem componente de
// Tabs — 06-RESEARCH.md §6).

type Friend = FunctionReturnType<typeof api.friends.listFriends>[number]
type IncomingRequest = FunctionReturnType<typeof api.friends.listIncomingFriendRequests>[number]
type FoundUser = FunctionReturnType<typeof api.users.findUserByUsernameTag>

function initialsFor(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

// Meu próprio identificador USER#123. `username`/`tag` vivem em `users`
// (Convex), não no perfil WorkOS de `useAuth()` — é por isso que
// `UserPanel.tsx` deliberadamente não mostra esse identificador (ver
// comentário lá). `ensureUser` é um upsert idempotente (convex/users.ts):
// chamar de novo aqui só devolve o documento já existente, sem duplicar o
// que `AuthGate` já garantiu no login — é o único jeito de obter meu
// próprio username/tag sem uma query nova em convex/ (fora do escopo deste
// plano, que não toca em convex/).
function useMyIdentifier(): { username: string; tag: string } | null {
  const ensureUser = useMutation(api.users.ensureUser)
  const [me, setMe] = useState<{ username: string; tag: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    ensureUser()
      .then((user) => {
        if (!cancelled && user) {
          setMe({ username: user.username, tag: user.tag })
        }
      })
      .catch((err: unknown) => {
        console.error('Não foi possível carregar seu USER#123:', err)
      })
    return () => {
      cancelled = true
    }
  }, [ensureUser])

  return me
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

function FriendRow({
  friend,
  onRemove,
  onMessage,
  error
}: {
  friend: Friend
  onRemove: (friendUserId: Id<'users'>) => void
  onMessage: (friendUserId: Id<'users'>) => void
  error?: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded px-2 py-1.5 hover:bg-accent/50">
      <div className="flex items-center gap-2">
        <div className="relative shrink-0">
          <Avatar>
            {friend.avatarUrl ? (
              <AvatarImage src={friend.avatarUrl} alt={friend.username} />
            ) : null}
            <AvatarFallback>{initialsFor(friend.username)}</AvatarFallback>
          </Avatar>
          <AvatarBadge
            className={friend.online ? 'bg-green-500' : 'bg-muted-foreground'}
            aria-label={friend.online ? 'online' : 'offline'}
          />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm">
          {friend.username}
          <span className="text-muted-foreground">#{friend.tag}</span>
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Mensagem para ${friend.username}#${friend.tag}`}
              onClick={() => onMessage(friend.userId)}
            >
              <MessageCircle />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Mensagem</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remover ${friend.username}#${friend.tag}`}
              onClick={() => onRemove(friend.userId)}
            >
              <UserMinus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remover amigo</TooltipContent>
        </Tooltip>
      </div>
      {error ? <p className="pl-10 text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

function FriendGroup({
  title,
  friends,
  onRemove,
  onMessage,
  rowErrors,
  dimmed = false
}: {
  title: string
  friends: Friend[]
  onRemove: (friendUserId: Id<'users'>) => void
  onMessage: (friendUserId: Id<'users'>) => void
  rowErrors: Record<string, string>
  dimmed?: boolean
}): React.JSX.Element {
  return (
    <div className={dimmed ? 'opacity-60' : undefined}>
      <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-0.5">
        {friends.map((friend) => (
          <FriendRow
            key={friend.userId}
            friend={friend}
            onRemove={onRemove}
            onMessage={onMessage}
            error={rowErrors[friend.userId]}
          />
        ))}
      </div>
    </div>
  )
}

function FriendsTab(): React.JSX.Element {
  const friends = useQuery(api.friends.listFriends)
  const removeFriendship = useMutation(api.friends.removeFriendship)
  const getOrCreateDmChannel = useMutation(api.dms.getOrCreateDmChannel)
  const { setSelectedDmChannelId } = useSelection()
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  function clearRowError(friendUserId: Id<'users'>): void {
    setRowErrors((prev) => {
      if (!(friendUserId in prev)) return prev
      const next = { ...prev }
      delete next[friendUserId]
      return next
    })
  }

  function setRowError(friendUserId: Id<'users'>, message: string): void {
    setRowErrors((prev) => ({ ...prev, [friendUserId]: message }))
  }

  function handleRemove(friendUserId: Id<'users'>): void {
    removeFriendship({ friendUserId }).catch((err: unknown) => {
      // Sem UI de erro dedicada aqui (o plano só pede isso na aba
      // "pedidos") — mas nunca deixamos uma Promise rejeitada sem
      // tratamento, senão um segundo cliente já tendo desfeito a amizade
      // vira um erro silencioso no console do usuário.
      console.error('Falha ao remover amigo:', err)
    })
  }

  // Botão Mensagem (plano 06-07): getOrCreateDmChannel devolve o canal
  // existente ou cria um novo entre mim e o amigo. `view` já é 'home' neste
  // ponto (é onde o FriendsPanel vive) — só troca qual conteúdo aparece na
  // região central, via selectedDmChannelId (AppShell, Task 4 deste plano).
  async function handleMessage(friendUserId: Id<'users'>): Promise<void> {
    try {
      const dmChannelId = await getOrCreateDmChannel({ friendUserId })
      setSelectedDmChannelId(dmChannelId)
      clearRowError(friendUserId)
    } catch (err) {
      setRowError(friendUserId, err instanceof Error ? err.message : String(err))
    }
  }

  if (friends === undefined) {
    return <div className="p-4 text-sm text-muted-foreground">Carregando...</div>
  }

  if (friends.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Nenhum amigo ainda — use a aba Adicionar para buscar por USER#123
      </div>
    )
  }

  const onlineFriends = friends.filter((f) => f.online)
  const offlineFriends = friends.filter((f) => !f.online)

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-3">
        {onlineFriends.length > 0 ? (
          <FriendGroup
            title={`ONLINE — ${onlineFriends.length}`}
            friends={onlineFriends}
            onRemove={handleRemove}
            onMessage={(id) => void handleMessage(id)}
            rowErrors={rowErrors}
          />
        ) : null}
        {offlineFriends.length > 0 ? (
          <FriendGroup
            title={`OFFLINE — ${offlineFriends.length}`}
            friends={offlineFriends}
            onRemove={handleRemove}
            onMessage={(id) => void handleMessage(id)}
            rowErrors={rowErrors}
            dimmed
          />
        ) : null}
      </div>
    </ScrollArea>
  )
}

function RequestRow({
  request,
  onAccept,
  onReject,
  error
}: {
  request: IncomingRequest
  onAccept: (requestId: Id<'friendRequests'>) => void
  onReject: (requestId: Id<'friendRequests'>) => void
  error?: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded px-2 py-1.5 hover:bg-accent/50">
      <div className="flex items-center gap-2">
        <Avatar>
          {request.avatarUrl ? (
            <AvatarImage src={request.avatarUrl} alt={request.username} />
          ) : null}
          <AvatarFallback>{initialsFor(request.username)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate text-sm">
          {request.username}
          <span className="text-muted-foreground">#{request.tag}</span>
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Aceitar pedido de ${request.username}#${request.tag}`}
              onClick={() => onAccept(request.requestId)}
            >
              <Check className="text-green-600" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Aceitar</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Recusar pedido de ${request.username}#${request.tag}`}
              onClick={() => onReject(request.requestId)}
            >
              <X className="text-destructive" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Recusar</TooltipContent>
        </Tooltip>
      </div>
      {error ? <p className="pl-10 text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

function RequestsTab(): React.JSX.Element {
  const requests = useQuery(api.friends.listIncomingFriendRequests)
  const acceptFriendRequest = useMutation(api.friends.acceptFriendRequest)
  const rejectFriendRequest = useMutation(api.friends.rejectFriendRequest)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  function clearRowError(requestId: Id<'friendRequests'>): void {
    setRowErrors((prev) => {
      if (!(requestId in prev)) return prev
      const next = { ...prev }
      delete next[requestId]
      return next
    })
  }

  function setRowError(requestId: Id<'friendRequests'>, message: string): void {
    setRowErrors((prev) => ({ ...prev, [requestId]: message }))
  }

  async function handleAccept(requestId: Id<'friendRequests'>): Promise<void> {
    try {
      await acceptFriendRequest({ requestId })
      clearRowError(requestId)
    } catch (err) {
      setRowError(requestId, err instanceof Error ? err.message : String(err))
    }
  }

  async function handleReject(requestId: Id<'friendRequests'>): Promise<void> {
    try {
      await rejectFriendRequest({ requestId })
      clearRowError(requestId)
    } catch (err) {
      setRowError(requestId, err instanceof Error ? err.message : String(err))
    }
  }

  if (requests === undefined) {
    return <div className="p-4 text-sm text-muted-foreground">Carregando...</div>
  }

  if (requests.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">Nenhum pedido pendente</div>
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-0.5 p-3">
        {requests.map((request) => (
          <RequestRow
            key={request.requestId}
            request={request}
            onAccept={(id) => void handleAccept(id)}
            onReject={(id) => void handleReject(id)}
            error={rowErrors[request.requestId]}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

function AddFriendTab(): React.JSX.Element {
  const [rawInput, setRawInput] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<{ username: string; tag: string } | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  // Padrão oficial do Convex para pular a query até ter argumentos válidos
  // — nunca consultar com argumentos vazios/placeholder.
  const found: FoundUser | undefined = useQuery(
    api.users.findUserByUsernameTag,
    submitted ?? 'skip'
  )
  const sendFriendRequest = useMutation(api.friends.sendFriendRequest)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setConfirmation(null)
    setSendError(null)
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
    try {
      await sendFriendRequest({ username: submitted.username, tag: submitted.tag })
      setConfirmation(`Pedido de amizade enviado para ${submitted.username}#${submitted.tag}`)
      setSendError(null)
      setRawInput('')
      setSubmitted(null)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-3">
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
              <Avatar>
                {found.avatarUrl ? (
                  <AvatarImage src={found.avatarUrl} alt={found.username} />
                ) : null}
                <AvatarFallback>{initialsFor(found.username)}</AvatarFallback>
              </Avatar>
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

        {sendError ? <p className="text-xs text-destructive">{sendError}</p> : null}
        {confirmation ? <p className="text-xs text-green-600">{confirmation}</p> : null}
      </div>
    </ScrollArea>
  )
}

export function FriendsPanel(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'amigos' | 'pedidos' | 'adicionar'>('amigos')
  const me = useMyIdentifier()

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Amigos</h2>
          {me ? <MyIdentifierBadge username={me.username} tag={me.tag} /> : null}
        </div>

        <div className="mt-3 flex gap-1">
          <Button
            type="button"
            variant={activeTab === 'amigos' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('amigos')}
          >
            Amigos
          </Button>
          <Button
            type="button"
            variant={activeTab === 'pedidos' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('pedidos')}
          >
            Pedidos
          </Button>
          <Button
            type="button"
            variant={activeTab === 'adicionar' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('adicionar')}
          >
            Adicionar
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === 'amigos' ? <FriendsTab /> : null}
        {activeTab === 'pedidos' ? <RequestsTab /> : null}
        {activeTab === 'adicionar' ? <AddFriendTab /> : null}
      </div>
    </div>
  )
}
