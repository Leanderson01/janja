import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireChannelMembership } from './lib/membership'

// CHAT-07 no nível de dados: quem está digitando num canal, agora. Metade de backend —
// expiração/TTL/tick e a UI do indicador são do plano 05-05 (05-RESEARCH.md §7).

// Registra "estou digitando" no canal. Chamada pelo cliente com throttle (no máximo
// 1x a cada ~2s enquanto o usuário digita — responsabilidade do cliente, plano 05-05).
// Aqui a mutation em si é barata e idempotente: upsert por (channelId, userId) via
// busca pontual no índice by_channel_user, nunca insere uma segunda linha para o
// mesmo par — mesmo raciocínio de presence.ts. Nenhuma mutation de "parar de
// digitar" existe: expiração é 100% responsabilidade do cliente (05-RESEARCH.md §7 —
// uma query Convex não reavalia sozinha só porque o tempo passou, sem escrita nova).
export const setTyping = mutation({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const { user } = await requireChannelMembership(ctx, channelId)

    const existing = await ctx.db
      .query('typing')
      .withIndex('by_channel_user', (q) => q.eq('channelId', channelId).eq('userId', user._id))
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, { updatedAt: Date.now() })
    } else {
      await ctx.db.insert('typing', { channelId, userId: user._id, updatedAt: Date.now() })
    }
  }
})

// Lista quem está digitando no canal, excluindo o próprio chamador — ninguém precisa
// ver "você está digitando" sobre si mesmo. Devolve linhas cruas com updatedAt, sem
// filtrar por idade aqui: a decisão de "isso ainda conta como digitando?" é do cliente
// (05-05), comparando updatedAt contra Date.now() local recalculado a cada tick
// (05-RESEARCH.md §7 explica por que essa filtragem não pode viver só no servidor).
export const listTyping = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const { user } = await requireChannelMembership(ctx, channelId)

    const rows = await ctx.db
      .query('typing')
      .withIndex('by_channel_user', (q) => q.eq('channelId', channelId))
      .collect()

    const others = rows.filter((row) => row.userId !== user._id)

    return await Promise.all(
      others.map(async (row) => {
        const author = await ctx.db.get(row.userId)

        return {
          userId: row.userId,
          username: author?.username ?? null,
          displayName: author?.displayName ?? null,
          updatedAt: row.updatedAt
        }
      })
    )
  }
})
