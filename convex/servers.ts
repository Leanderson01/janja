import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { requireIdentity, requireMembership } from './lib/membership'

export const createServer = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 50) {
      throw new Error('Nome do servidor deve ter entre 2 e 50 caracteres')
    }

    const user = await requireIdentity(ctx)
    const serverId = await ctx.db.insert('servers', { name: trimmed, ownerId: user._id })
    await ctx.db.insert('serverMembers', { serverId, userId: user._id, joinedAt: Date.now() })
    return serverId
  },
})

export const listMyServers = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireIdentity(ctx)
    const memberships = await ctx.db
      .query('serverMembers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect()

    const servers = await Promise.all(memberships.map((m) => ctx.db.get(m.serverId)))
    return servers.filter((s): s is NonNullable<typeof s> => s !== null)
  },
})

// Existe só para a UI (plano 04-06) decidir, sem gambiarra, se mostra os botões de "gerar
// novo código"/"revogar convite" — que continuam sendo aplicados no backend por
// requireOwnership dentro de convex/invites.ts (plano 04-02); esta query nunca é a fonte de
// verdade da autorização, só evita mostrar um botão que vai falhar.
//
// Opera sobre um serverId arbitrário vindo do cliente, então precisa confirmar participação
// (requireMembership) antes de revelar até mesmo esse booleano — não-membro não deveria
// aprender nada sobre um servidor, consistente com SRV-06.
export const amIOwner = query({
  args: { serverId: v.id('servers') },
  handler: async (ctx, { serverId }) => {
    const { user } = await requireMembership(ctx, serverId)
    const server = await ctx.db.get(serverId)
    return server?.ownerId === user._id
  },
})
