import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { isOnline } from './members'

// Ciclo de vida do pedido de amizade (SOCIAL-01/02/03). `friendRequests` não
// tem campo `status` por decisão de schema (06-RESEARCH.md §2): a existência
// do documento É o estado "pendente" — aceitar apaga o pedido e insere
// `friendships`, recusar só apaga.

// Resolve o usuário chamador a partir da identidade autenticada, nunca de um
// id vindo de argumento — mesmo padrão de `ensureUser`/`heartbeat`
// (convex/users.ts, convex/presence.ts), repetido aqui porque é específico
// deste arquivo (não vale a pena promover para convex/lib/ por 3 usos).
async function getCallerUser(ctx: MutationCtx | QueryCtx): Promise<Doc<'users'>> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Não autenticado')

  const user = await ctx.db
    .query('users')
    .withIndex('by_workos_id', (q) => q.eq('workosId', identity.subject))
    .unique()
  if (!user) {
    throw new Error('Usuário sem documento em users — ensureUser deveria ter rodado antes')
  }
  return user
}

// Par canônico determinístico: sempre a mesma ordem para o mesmo par de ids,
// independente de quem enviou ou aceitou o pedido (hard constraint do plano).
// Ids do Convex são strings — comparação lexicográfica basta, não precisa ter
// significado além de "sempre a mesma ordem".
function canonicalPair(a: Id<'users'>, b: Id<'users'>): [Id<'users'>, Id<'users'>] {
  return a < b ? [a, b] : [b, a]
}

// Só o destinatário pode aceitar/recusar — checagem central deste plano.
// Lançar aqui, nunca deixar o chamador prosseguir, é o que impede um terceiro
// (ou o próprio remetente) de mutar um pedido alheio.
function assertIsRecipient(request: Doc<'friendRequests'>, caller: Doc<'users'>) {
  if (request.toUserId !== caller._id) {
    throw new Error('Só o destinatário do pedido pode responder a ele')
  }
}

export const sendFriendRequest = mutation({
  args: { username: v.string(), tag: v.string() },
  handler: async (ctx, { username, tag }) => {
    const caller = await getCallerUser(ctx)

    // Mesmo índice de users.findUserByUsernameTag, consultado inline — não
    // vale a pena um ctx.runQuery dentro da mesma transação.
    const target = await ctx.db
      .query('users')
      .withIndex('by_username_tag', (q) => q.eq('username', username).eq('tag', tag))
      .unique()
    if (!target) {
      throw new Error('Usuário não encontrado')
    }

    if (target._id === caller._id) {
      throw new Error('Você não pode adicionar a si mesmo')
    }

    const [userA, userB] = canonicalPair(caller._id, target._id)
    const existingFriendship = await ctx.db
      .query('friendships')
      .withIndex('by_pair', (q) => q.eq('userA', userA).eq('userB', userB))
      .unique()
    if (existingFriendship) {
      throw new Error('Vocês já são amigos')
    }

    const existingSameDirection = await ctx.db
      .query('friendRequests')
      .withIndex('by_from_to', (q) => q.eq('fromUserId', caller._id).eq('toUserId', target._id))
      .unique()
    if (existingSameDirection) {
      throw new Error('Pedido já enviado')
    }

    const existingReverse = await ctx.db
      .query('friendRequests')
      .withIndex('by_from_to', (q) => q.eq('fromUserId', target._id).eq('toUserId', caller._id))
      .unique()
    if (existingReverse) {
      throw new Error(
        'Esse usuário já te enviou um pedido — aceite-o em vez de enviar um novo'
      )
    }

    return ctx.db.insert('friendRequests', {
      fromUserId: caller._id,
      toUserId: target._id,
      createdAt: Date.now()
    })
  }
})

export const acceptFriendRequest = mutation({
  args: { requestId: v.id('friendRequests') },
  handler: async (ctx, { requestId }) => {
    const caller = await getCallerUser(ctx)

    const request = await ctx.db.get(requestId)
    if (!request) {
      throw new Error('Pedido não encontrado')
    }

    assertIsRecipient(request, caller)

    const [userA, userB] = canonicalPair(request.fromUserId, request.toUserId)
    await ctx.db.insert('friendships', { userA, userB, createdAt: Date.now() })
    await ctx.db.delete(request._id)
  }
})

export const rejectFriendRequest = mutation({
  args: { requestId: v.id('friendRequests') },
  handler: async (ctx, { requestId }) => {
    const caller = await getCallerUser(ctx)

    const request = await ctx.db.get(requestId)
    if (!request) {
      throw new Error('Pedido não encontrado')
    }

    assertIsRecipient(request, caller)

    await ctx.db.delete(request._id)
  }
})

// Lista de amigos (SOCIAL-04), com presença. "Online" nunca é redefinido
// aqui: reaproveita `isOnline`/`ONLINE_THRESHOLD_MS` de `convex/members.ts`
// (hard constraint deste plano) — uma segunda definição do limiar é como um
// amigo aparece online numa lista e offline em outra.
export const listFriends = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCallerUser(ctx)

    // "Todas as amizades de X" é a união de duas queries indexadas (X como
    // userA via prefixo de `by_pair`, X como userB via `by_userB`) — nunca
    // um `.filter()` de tabela inteira (06-RESEARCH.md §2).
    const asUserA = await ctx.db
      .query('friendships')
      .withIndex('by_pair', (q) => q.eq('userA', me._id))
      .collect()
    const asUserB = await ctx.db
      .query('friendships')
      .withIndex('by_userB', (q) => q.eq('userB', me._id))
      .collect()

    const friendIds = [...asUserA.map((f) => f.userB), ...asUserB.map((f) => f.userA)]

    const now = Date.now()
    return await Promise.all(
      friendIds.map(async (friendId) => {
        const [friend, presence] = await Promise.all([
          ctx.db.get(friendId),
          ctx.db
            .query('presence')
            .withIndex('by_user', (q) => q.eq('userId', friendId))
            .unique()
        ])
        return {
          userId: friendId,
          username: friend?.username ?? '???',
          tag: friend?.tag ?? '????',
          displayName: friend?.displayName ?? '???',
          avatarUrl: friend?.avatarUrl,
          online: isOnline(presence?.lastSeen, now)
        }
      })
    )
  }
})

// Pedidos de amizade recebidos, pendentes de resposta (SOCIAL-04/06 dependem
// de saber quem me pediu amizade). Só o que eu recebi — nunca o que eu enviei
// — via índice `by_to`, nunca `.filter()`.
export const listIncomingFriendRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCallerUser(ctx)
    const requests = await ctx.db
      .query('friendRequests')
      .withIndex('by_to', (q) => q.eq('toUserId', me._id))
      .collect()

    return await Promise.all(
      requests.map(async (request) => {
        const fromUser = await ctx.db.get(request.fromUserId)
        return {
          requestId: request._id,
          fromUserId: request.fromUserId,
          username: fromUser?.username ?? '???',
          tag: fromUser?.tag ?? '????',
          displayName: fromUser?.displayName ?? '???',
          avatarUrl: fromUser?.avatarUrl
        }
      })
    )
  }
})

// Remoção de amizade (SOCIAL-06). Autorizada implicitamente pelo par
// canônico: só quem é `userA` ou `userB` do par calculado a partir do
// próprio chamador consegue localizar (e portanto apagar) o documento — um
// terceiro nunca forma esse par, logo `friendship` vem `null` e a mutation
// lança antes de tocar no banco.
export const removeFriendship = mutation({
  args: { friendUserId: v.id('users') },
  handler: async (ctx, args) => {
    const me = await getCallerUser(ctx)
    const [userA, userB] = canonicalPair(me._id, args.friendUserId)

    const friendship = await ctx.db
      .query('friendships')
      .withIndex('by_pair', (q) => q.eq('userA', userA).eq('userB', userB))
      .unique()
    if (!friendship) {
      throw new Error('Vocês não são amigos')
    }

    // dmChannels/dmMembers/dmMessages associados não são apagados — histórico
    // de conversa permanece mesmo depois de desfazer a amizade (decisão
    // registrada em 06-RESEARCH.md; nenhum SOCIAL-0x pede apagar histórico).
    await ctx.db.delete(friendship._id)
  }
})
