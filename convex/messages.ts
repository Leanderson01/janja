import { v } from 'convex/values'
import { paginationOptsValidator } from 'convex/server'
import { mutation, query } from './_generated/server'
import { requireMembership } from './lib/membership'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

type Ctx = QueryCtx | MutationCtx

// CHAT-01/CHAT-02/CHAT-03 no nível de dados: mensagens de canal (tabela `messages`,
// separada de `dmMessages` da Fase 6 por design — ver 05-RESEARCH.md §1).

/** Resolve o canal e exige que o chamador seja membro do servidor dono dele
 * (requireMembership, convex/lib/membership.ts — SRV-06 aplicado a mensagens de
 * canal). Local e não-exportado, mesmo padrão de `assertDmMember` em convex/dms.ts
 * (Fase 6): arquivos de domínio de fases diferentes não compartilham helper interno,
 * só os já publicamente exportados de lib/membership.ts. */
async function requireChannelMembership(
  ctx: Ctx,
  channelId: Id<'channels'>
): Promise<{ channel: Doc<'channels'>; user: Doc<'users'> }> {
  const channel = await ctx.db.get(channelId)
  if (!channel) throw new Error('Canal não encontrado')

  const { user } = await requireMembership(ctx, channel.serverId)
  return { channel, user }
}

export const sendMessage = mutation({
  args: { channelId: v.id('channels'), content: v.string() },
  handler: async (ctx, { channelId, content }) => {
    const { channel, user } = await requireChannelMembership(ctx, channelId)

    if (channel.type !== 'text') {
      throw new Error('Não é possível enviar mensagem em um canal de voz')
    }

    const trimmed = content.trim()
    if (trimmed.length < 1 || trimmed.length > 2000) {
      throw new Error('Mensagem deve ter entre 1 e 2000 caracteres')
    }

    return ctx.db.insert('messages', {
      channelId,
      authorId: user._id,
      content: trimmed,
      createdAt: Date.now(),
    })
  },
})

// CHAT-03 no nível de dados: histórico paginado, mais nova primeiro. Nunca .collect()
// do canal inteiro — sempre withIndex('by_channel') + .paginate(). Enriquece cada
// mensagem com o autor (mesmo padrão de Promise.all que members.ts:listServerMembers
// já usa) e com isMine, computado sem consulta extra a partir do `user` já resolvido
// pela checagem de autorização.
export const listMessages = query({
  args: { channelId: v.id('channels'), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { channelId, paginationOpts }) => {
    const { user } = await requireChannelMembership(ctx, channelId)

    const result = await ctx.db
      .query('messages')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .order('desc')
      .paginate(paginationOpts)

    const page = await Promise.all(
      result.page.map(async (message) => {
        const author = await ctx.db.get(message.authorId)

        return {
          _id: message._id,
          channelId: message.channelId,
          content: message.content,
          createdAt: message.createdAt,
          isMine: message.authorId === user._id,
          author: author
            ? {
                userId: author._id,
                username: author.username,
                tag: author.tag,
                displayName: author.displayName,
                avatarUrl: author.avatarUrl,
              }
            : null,
        }
      })
    )

    return { ...result, page }
  },
})
