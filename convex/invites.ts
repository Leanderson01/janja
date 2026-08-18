import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { requireIdentity, requireMembership, requireOwnership } from './lib/membership'
import { findAvailableInviteCode } from './lib/inviteCode'

// Um único código de convite reutilizável e revogável por servidor — sem
// expiração, sem limite de usos (decisão do ROADMAP/orquestrador, reafirmada
// em 04-RESEARCH.md §7). Por isso generateInvite é idempotente: nunca cria
// um segundo convite não-revogado para o mesmo servidor.

export const generateInvite = mutation({
  args: { serverId: v.id('servers') },
  handler: async (ctx, { serverId }) => {
    const { user } = await requireOwnership(ctx, serverId)

    const existing = await ctx.db
      .query('invites')
      .withIndex('by_server', (q) => q.eq('serverId', serverId))
      .filter((q) => q.eq(q.field('revoked'), false))
      .unique()
    if (existing) {
      return existing.code
    }

    // Convex não tem constraint de unicidade nativa (04-RESEARCH.md §5): a
    // garantia de unicidade do código é 100% desta checagem de colisão
    // contra o índice by_code, dentro da mesma mutation transacional.
    const code = await findAvailableInviteCode({
      existsFn: async (candidate) => {
        const collision = await ctx.db
          .query('invites')
          .withIndex('by_code', (q) => q.eq('code', candidate))
          .unique()
        return collision !== null
      },
    })

    await ctx.db.insert('invites', { code, serverId, createdBy: user._id, revoked: false })
    return code
  },
})

export const revokeInvite = mutation({
  args: { serverId: v.id('servers') },
  handler: async (ctx, { serverId }) => {
    await requireOwnership(ctx, serverId)

    const active = await ctx.db
      .query('invites')
      .withIndex('by_server', (q) => q.eq('serverId', serverId))
      .filter((q) => q.eq(q.field('revoked'), false))
      .unique()
    if (!active) {
      // Revogar um convite que já não existe é um no-op silencioso, não um
      // erro — não deve quebrar uma UI que chama isso sem checar estado
      // antes (04-02-PLAN.md).
      return null
    }

    await ctx.db.patch(active._id, { revoked: true })
    return null
  },
})

export const joinByCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await requireIdentity(ctx)

    const invite = await ctx.db
      .query('invites')
      .withIndex('by_code', (q) => q.eq('code', code))
      .unique()
    if (!invite || invite.revoked) {
      throw new Error('Código de convite inválido ou revogado')
    }

    // Idempotente: entrar de novo com o mesmo código não duplica
    // serverMembers.
    const existingMembership = await ctx.db
      .query('serverMembers')
      .withIndex('by_server_user', (q) =>
        q.eq('serverId', invite.serverId).eq('userId', user._id)
      )
      .unique()
    if (existingMembership) {
      return invite.serverId
    }

    await ctx.db.insert('serverMembers', {
      serverId: invite.serverId,
      userId: user._id,
      joinedAt: Date.now(),
    })
    return invite.serverId
  },
})

export const getActiveInvite = query({
  args: { serverId: v.id('servers') },
  handler: async (ctx, { serverId }) => {
    await requireMembership(ctx, serverId)

    const invite = await ctx.db
      .query('invites')
      .withIndex('by_server', (q) => q.eq('serverId', serverId))
      .filter((q) => q.eq(q.field('revoked'), false))
      .unique()
    return invite ?? null
  },
})
