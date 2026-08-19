import { v } from 'convex/values'
import { mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

// Ciclo de vida do pedido de amizade (SOCIAL-01/02/03). `friendRequests` não
// tem campo `status` por decisão de schema (06-RESEARCH.md §2): a existência
// do documento É o estado "pendente" — aceitar apaga o pedido e insere
// `friendships`, recusar só apaga.

// Resolve o usuário chamador a partir da identidade autenticada, nunca de um
// id vindo de argumento — mesmo padrão de `ensureUser`/`heartbeat`
// (convex/users.ts, convex/presence.ts), repetido aqui porque é específico
// deste arquivo (não vale a pena promover para convex/lib/ por 3 usos).
async function getCallerUser(ctx: MutationCtx): Promise<Doc<'users'>> {
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
