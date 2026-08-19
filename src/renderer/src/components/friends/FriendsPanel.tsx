import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { Check, Copy, MessageCircle, UserMinus, X } from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { parseUserTag } from '@/lib/user-tag'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'

import { api } from '../../../../../convex/_generated/api'

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

// Mensagem crua do erro (Convex devolve texto longo com request id e stack).
// Ela vira a *descrição* do toast, nunca o título: o título diz o que falhou em
// português, a descrição preserva o que a UI antiga mostrava inline e é o que
// ainda serve para depurar.
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function FriendRow({
  friend,
  onRemove,
  onMessage
}: {
  friend: Friend
  onRemove: (friend: Friend) => void
  onMessage: (friend: Friend) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50">
      <div className="relative shrink-0">
        <Avatar>
          {friend.avatarUrl ? <AvatarImage src={friend.avatarUrl} alt={friend.username} /> : null}
          <AvatarFallback>{initialsFor(friend.username)}</AvatarFallback>
        </Avatar>
        {/* Mesmo token de presença da lista de membros: online é `--success`,
            offline é `--muted-foreground`. Os dois lugares mostram o mesmo
            conceito e não podem divergir de cor. */}
        <AvatarBadge
          className={cn(friend.online ? 'bg-success' : 'bg-muted-foreground')}
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
            onClick={() => onMessage(friend)}
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
            onClick={() => onRemove(friend)}
          >
            <UserMinus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Remover amigo</TooltipContent>
      </Tooltip>
    </div>
  )
}

function FriendGroup({
  title,
  friends,
  onRemove,
  onMessage,
  dimmed = false
}: {
  title: string
  friends: Friend[]
  onRemove: (friend: Friend) => void
  onMessage: (friend: Friend) => void
  dimmed?: boolean
}): React.JSX.Element {
  return (
    <div className={cn(dimmed && 'opacity-60')}>
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

  // Resultado de operação de rede vira toast (Fase 8.5): o Sonner cuida de
  // empilhamento, tempo de vida e aria-live, que o parágrafo inline por linha
  // não tinha — ele aparecia colado numa linha que a própria mutação podia
  // remover da lista, e nunca sumia sozinho.
  function handleRemove(friend: Friend): void {
    const label = `${friend.username}#${friend.tag}`
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
  // existente ou cria um novo entre mim e o amigo. `view` já é 'home' neste
  // ponto (é onde o FriendsPanel vive) — só troca qual conteúdo aparece na
  // região central, via selectedDmChannelId.
  async function handleMessage(friend: Friend): Promise<void> {
    try {
      const dmChannelId = await getOrCreateDmChannel({ friendUserId: friend.userId })
      setSelectedDmChannelId(dmChannelId)
    } catch (err) {
      toast.error('Não foi possível abrir a conversa', { description: errorMessage(err) })
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
            onMessage={(friend) => void handleMessage(friend)}
          />
        ) : null}
        {offlineFriends.length > 0 ? (
          <FriendGroup
            title={`OFFLINE — ${offlineFriends.length}`}
            friends={offlineFriends}
            onRemove={handleRemove}
            onMessage={(friend) => void handleMessage(friend)}
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
  onReject
}: {
  request: IncomingRequest
  onAccept: (request: IncomingRequest) => void
  onReject: (request: IncomingRequest) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50">
      <Avatar>
        {request.avatarUrl ? <AvatarImage src={request.avatarUrl} alt={request.username} /> : null}
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
            onClick={() => onAccept(request)}
          >
            <Check className="text-success" />
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
            onClick={() => onReject(request)}
          >
            <X className="text-destructive" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Recusar</TooltipContent>
      </Tooltip>
    </div>
  )
}

function RequestsTab(): React.JSX.Element {
  const requests = useQuery(api.friends.listIncomingFriendRequests)
  const acceptFriendRequest = useMutation(api.friends.acceptFriendRequest)
  const rejectFriendRequest = useMutation(api.friends.rejectFriendRequest)

  async function handleAccept(request: IncomingRequest): Promise<void> {
    const label = `${request.username}#${request.tag}`
    try {
      await acceptFriendRequest({ requestId: request.requestId })
      toast.success(`Agora você e ${label} são amigos`)
    } catch (err) {
      toast.error('Não foi possível aceitar o pedido', { description: errorMessage(err) })
    }
  }

  async function handleReject(request: IncomingRequest): Promise<void> {
    const label = `${request.username}#${request.tag}`
    try {
      await rejectFriendRequest({ requestId: request.requestId })
      toast.success(`Pedido de ${label} recusado`)
    } catch (err) {
      toast.error('Não foi possível recusar o pedido', { description: errorMessage(err) })
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
            onAccept={(r) => void handleAccept(r)}
            onReject={(r) => void handleReject(r)}
          />
        ))}
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
