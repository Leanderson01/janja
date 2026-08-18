import { query } from './_generated/server'
import { v } from 'convex/values'
import { requireMembership } from './lib/membership'

// Intervalo de heartbeat fixado em 02-RESEARCH.md §7 / plano 02-08: o cliente chama
// presence.heartbeat a cada 45s enquanto a sessão está ativa. O limiar abaixo é 2x esse
// intervalo (90s) — folga deliberada para não fazer o status "piscar" online/offline entre
// dois heartbeats normais (ex: pequeno atraso de rede não deveria já marcar alguém como
// offline).
const ONLINE_THRESHOLD_MS = 90_000

/** Função pura: deriva online/offline a partir do último heartbeat. Nunca existe um campo
 * manual de status — "online" é sempre calculado a partir de `presence.lastSeen` no momento
 * da consulta. `lastSeen` no futuro (relógio local adiantado) nunca deveria ser tratado como
 * "muito tempo atrás": a diferença fica negativa, que é sempre <= threshold. */
export function isOnline(lastSeen: number | undefined, now: number): boolean {
  if (lastSeen === undefined) return false
  return now - lastSeen <= ONLINE_THRESHOLD_MS
}

// Junta serverMembers + users + presence para a lista de membros de um servidor (SRV-07,
// APP-02). Exige participação no próprio servidor consultado (requireMembership) — não-membro
// não aprende nada sobre quem está num servidor, consistente com SRV-06.
export const listServerMembers = query({
  args: { serverId: v.id('servers') },
  handler: async (ctx, { serverId }) => {
    await requireMembership(ctx, serverId)

    const memberships = await ctx.db
      .query('serverMembers')
      .withIndex('by_server_user', (q) => q.eq('serverId', serverId))
      .collect()

    const now = Date.now()

    const members = await Promise.all(
      memberships.map(async (membership) => {
        const [user, presence] = await Promise.all([
          ctx.db.get(membership.userId),
          ctx.db
            .query('presence')
            .withIndex('by_user', (q) => q.eq('userId', membership.userId))
            .unique(),
        ])
        if (!user) return null

        return {
          userId: user._id,
          username: user.username,
          tag: user.tag,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          nickname: membership.nickname,
          online: isOnline(presence?.lastSeen, now),
        }
      })
    )

    return members.filter((m): m is NonNullable<typeof m> => m !== null)
  },
})
