import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { requireMembership } from './lib/membership'

// SRV-05/SRV-06: canais (texto e voz) dentro de um servidor. Toda function exige
// requireMembership antes de tocar em `channels` — qualquer membro cria/lista/lê, não só o
// dono (SRV-05 não restringe a dono). Mensagens (F5) e estado de voz (voiceStates, F7) são
// fora de escopo deste arquivo.

export const createChannel = mutation({
  args: {
    serverId: v.id('servers'),
    name: v.string(),
    type: v.union(v.literal('text'), v.literal('voice')),
  },
  handler: async (ctx, { serverId, name, type }) => {
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 50) {
      throw new Error('Nome do canal deve ter entre 1 e 50 caracteres')
    }

    await requireMembership(ctx, serverId)

    const existing = await ctx.db
      .query('channels')
      .withIndex('by_server', (q) => q.eq('serverId', serverId))
      .collect()

    return ctx.db.insert('channels', {
      serverId,
      name: trimmed,
      type,
      position: existing.length,
    })
  },
})

export const listChannels = query({
  args: { serverId: v.id('servers') },
  handler: async (ctx, { serverId }) => {
    await requireMembership(ctx, serverId)

    const channels = await ctx.db
      .query('channels')
      .withIndex('by_server', (q) => q.eq('serverId', serverId))
      .collect()

    return channels.sort((a, b) => a.position - b.position)
  },
})

export const getChannel = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId)
    if (!channel) return null

    await requireMembership(ctx, channel.serverId)

    return channel
  },
})
