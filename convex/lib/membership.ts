import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

type Ctx = QueryCtx | MutationCtx

/** Resolve a identidade autenticada para o documento `users` correspondente. Lança se não
 * houver sessão, ou se a sessão não tiver um documento `users` (ensureUser deveria ter
 * rodado antes — Fase 2, 02-05). Mesmo padrão de convex/presence.ts. */
export async function requireIdentity(ctx: Ctx): Promise<Doc<'users'>> {
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

/** Ponto central de SRV-06: lança se o usuário autenticado não for membro do servidor.
 * Usa o índice composto by_server_user — nunca varre serverMembers inteira. */
export async function requireMembership(
  ctx: Ctx,
  serverId: Id<'servers'>
): Promise<{ user: Doc<'users'>; membership: Doc<'serverMembers'> }> {
  const user = await requireIdentity(ctx)
  const membership = await ctx.db
    .query('serverMembers')
    .withIndex('by_server_user', (q) => q.eq('serverId', serverId).eq('userId', user._id))
    .unique()
  if (!membership) throw new Error('Não é membro deste servidor')
  return { user, membership }
}

/** Para ações restritas ao dono (SRV-02/SRV-04: gerar/revogar convite). Implica
 * requireMembership — o dono é sempre membro. */
export async function requireOwnership(
  ctx: Ctx,
  serverId: Id<'servers'>
): Promise<{ user: Doc<'users'>; server: Doc<'servers'> }> {
  const { user } = await requireMembership(ctx, serverId)
  const server = await ctx.db.get(serverId)
  if (!server) throw new Error('Servidor não encontrado')
  if (server.ownerId !== user._id) throw new Error('Apenas o dono do servidor pode fazer isso')
  return { user, server }
}
