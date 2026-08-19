import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireChannelMembership, requireMembership } from './lib/membership'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

type Ctx = QueryCtx | MutationCtx

// CHAT-05/CHAT-06 no nível de dados: estado de leitura por (canal, usuário) e badge de
// contagem de não lidas por servidor. Sem `firstUnreadMessageId` armazenado — calculado
// sob demanda via range query em `_creationTime` (índice implícito de `messages.by_channel`,
// confirmado contra doc oficial — ver 05-RESEARCH.md §5/§6).

/** Primeira mensagem do canal ainda não lida em relação a um ponto de referência.
 * `afterCreatedAt === undefined` significa "nunca leu" — primeira mensagem do canal.
 * Sempre uma range query indexada sobre `messages.by_channel`, nunca um scan. */
async function findFirstUnread(
  ctx: Ctx,
  channelId: Id<'channels'>,
  afterCreatedAt: number | undefined
): Promise<Doc<'messages'> | null> {
  const first = await ctx.db
    .query('messages')
    .withIndex('by_channel', (q) =>
      afterCreatedAt === undefined
        ? q.eq('channelId', channelId)
        : q.eq('channelId', channelId).gt('_creationTime', afterCreatedAt)
    )
    .order('asc')
    .first()

  return first
}

export const openChannel = mutation({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const { user } = await requireChannelMembership(ctx, channelId)

    const existingState = await ctx.db
      .query('channelReadState')
      .withIndex('by_channel_user', (q) => q.eq('channelId', channelId).eq('userId', user._id))
      .unique()

    // Resolve a mensagem antiga lida (se existir) para calcular o divisor a partir do
    // seu _creationTime. Se a linha aponta para uma mensagem que não existe mais (não
    // deveria acontecer nesta fase — não há delete de mensagem), trata como "nunca leu".
    const oldReadMessage = existingState?.lastReadMessageId
      ? await ctx.db.get(existingState.lastReadMessageId)
      : null

    const firstUnread = await findFirstUnread(
      ctx,
      channelId,
      oldReadMessage ? oldReadMessage._creationTime : undefined
    )

    const mostRecent = await ctx.db
      .query('messages')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .order('desc')
      .first()

    if (mostRecent) {
      if (existingState) {
        await ctx.db.patch(existingState._id, { lastReadMessageId: mostRecent._id })
      } else {
        await ctx.db.insert('channelReadState', {
          channelId,
          userId: user._id,
          lastReadMessageId: mostRecent._id
        })
      }
    }

    return { firstUnreadMessageId: firstUnread ? firstUnread._id : null }
  }
})

export const getUnreadCounts = query({
  args: { serverId: v.id('servers') },
  handler: async (ctx, { serverId }) => {
    const { user } = await requireMembership(ctx, serverId)

    const channels = await ctx.db
      .query('channels')
      .withIndex('by_server', (q) => q.eq('serverId', serverId))
      .collect()

    const textChannels = channels.filter((channel) => channel.type === 'text')

    return Promise.all(
      textChannels.map(async (channel) => {
        const readState = await ctx.db
          .query('channelReadState')
          .withIndex('by_channel_user', (q) =>
            q.eq('channelId', channel._id).eq('userId', user._id)
          )
          .unique()

        if (!readState || !readState.lastReadMessageId) {
          const allMessages = await ctx.db
            .query('messages')
            .withIndex('by_channel', (q) => q.eq('channelId', channel._id))
            .collect()

          return { channelId: channel._id, unreadCount: allMessages.length }
        }

        const lastRead = await ctx.db.get(readState.lastReadMessageId)

        const unread = await ctx.db
          .query('messages')
          .withIndex('by_channel', (q) =>
            lastRead
              ? q.eq('channelId', channel._id).gt('_creationTime', lastRead._creationTime)
              : q.eq('channelId', channel._id)
          )
          .collect()

        return { channelId: channel._id, unreadCount: unread.length }
      })
    )
  }
})
