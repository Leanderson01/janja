import { mutation } from './_generated/server'

// Heartbeat de presença: upsert por identidade autenticada, nunca aceita um
// userId vindo do cliente. Frequência de chamada (45s, decidida em
// 02-RESEARCH.md §7) é responsabilidade de quem chama esta mutation (plano
// 02-08, renderer) — este arquivo só garante que cada chamada é barata
// (uma leitura indexada + um patch/insert, nunca mais de uma linha por
// usuário) e nunca escreve presença para alguém não autenticado ou sem
// documento em `users`.
export const heartbeat = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Não autenticado')

    const user = await ctx.db
      .query('users')
      .withIndex('by_workos_id', (q) => q.eq('workosId', identity.subject))
      .unique()
    if (!user) {
      throw new Error('Usuário sem documento em users — ensureUser deveria ter rodado antes')
    }

    const existing = await ctx.db
      .query('presence')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, { lastSeen: Date.now() })
    } else {
      await ctx.db.insert('presence', { userId: user._id, lastSeen: Date.now() })
    }
  },
})
