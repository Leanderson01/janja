import { v } from 'convex/values'
import { mutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

type Ctx = QueryCtx | MutationCtx

// SOCIAL-05 (metade de escrita): canal de DM entre dois amigos e envio de
// mensagem de texto nele. Arquivo próprio de convex/dms.ts — não importa de
// convex/friends.ts (plano 06-02, arquivo irmão em execução paralela):
// getCallerUser é local, mesmo padrão de convex/lib/membership.ts.

/** Resolve a identidade autenticada para o documento `users` correspondente.
 * Mesmo padrão de convex/lib/membership.ts (requireIdentity) e
 * convex/users.ts (ensureUser) — nunca aceita workosId vindo do cliente. */
async function getCallerUser(ctx: Ctx): Promise<Doc<'users'>> {
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

/** Somos amigos? Par canônico (userA < userB) via friendships.by_pair — ponto
 * exato, mesmo padrão de 06-RESEARCH.md §2. */
async function areFriends(
  ctx: Ctx,
  userIdA: Id<'users'>,
  userIdB: Id<'users'>
): Promise<boolean> {
  const [userA, userB] = [userIdA, userIdB].sort()
  const friendship = await ctx.db
    .query('friendships')
    .withIndex('by_pair', (q) => q.eq('userA', userA).eq('userB', userB))
    .unique()
  return friendship !== null
}

/** Ponto central de autorização de DM (06-RESEARCH.md §4): lança se o usuário
 * não for membro do canal. Usa by_channel_user — nunca varre dmMembers
 * inteira. Reutilizada por sendDmMessage aqui e pelas queries de leitura do
 * plano 06-05. */
async function assertDmMember(
  ctx: Ctx,
  dmChannelId: Id<'dmChannels'>,
  userId: Id<'users'>
): Promise<void> {
  const membership = await ctx.db
    .query('dmMembers')
    .withIndex('by_channel_user', (q) => q.eq('dmChannelId', dmChannelId).eq('userId', userId))
    .unique()
  if (!membership) throw new Error('Você não é membro desta conversa')
}

export const getOrCreateDmChannel = mutation({
  args: { friendUserId: v.id('users') },
  handler: async (ctx, { friendUserId }) => {
    const caller = await getCallerUser(ctx)

    const isFriend = await areFriends(ctx, caller._id, friendUserId)
    if (!isFriend) {
      throw new Error('Vocês precisam ser amigos para conversar')
    }

    // Busca canal existente: lista meus dmMembers via by_user (índice, nunca
    // varredura) e para cada dmChannelId candidato faz lookup pontual em
    // by_channel_user por (dmChannelId, friendUserId) — se algum bater, é o
    // canal já existente entre os dois.
    const myMemberships = await ctx.db
      .query('dmMembers')
      .withIndex('by_user', (q) => q.eq('userId', caller._id))
      .collect()

    for (const membership of myMemberships) {
      const friendMembership = await ctx.db
        .query('dmMembers')
        .withIndex('by_channel_user', (q) =>
          q.eq('dmChannelId', membership.dmChannelId).eq('userId', friendUserId)
        )
        .unique()
      if (friendMembership) {
        return membership.dmChannelId
      }
    }

    const dmChannelId = await ctx.db.insert('dmChannels', { createdAt: Date.now() })
    await ctx.db.insert('dmMembers', { dmChannelId, userId: caller._id })
    await ctx.db.insert('dmMembers', { dmChannelId, userId: friendUserId })

    return dmChannelId
  },
})

export const sendDmMessage = mutation({
  args: { dmChannelId: v.id('dmChannels'), content: v.string() },
  handler: async (ctx, { dmChannelId, content }) => {
    const caller = await getCallerUser(ctx)

    await assertDmMember(ctx, dmChannelId, caller._id)

    const trimmed = content.trim()
    if (trimmed.length < 1) {
      throw new Error('Mensagem não pode ser vazia')
    }

    return ctx.db.insert('dmMessages', {
      dmChannelId,
      authorId: caller._id,
      content: trimmed,
      createdAt: Date.now(),
    })
  },
})
