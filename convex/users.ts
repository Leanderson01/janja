import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import * as tag from './lib/tag'

// Deriva um username base a partir da parte antes do "@" do e-mail da
// identidade: minúsculo, caracteres fora de [a-z0-9_] viram "_".
function baseUsernameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

// Upsert por workosId — primeiro login gera um username#tag único (AUTH-06),
// logins seguintes só retornam o documento já existente. Nunca aceita
// workosId vindo do cliente: tudo deriva de ctx.auth.getUserIdentity(), que
// é validado pelo JWT do WorkOS (ver auth.config.ts / 02-RESEARCH.md §4).
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error('ensureUser requer uma identidade autenticada')
    }

    const existing = await ctx.db
      .query('users')
      .withIndex('by_workos_id', (q) => q.eq('workosId', identity.subject))
      .unique()
    if (existing) {
      return existing
    }

    const username = baseUsernameFromEmail(identity.email ?? identity.subject)
    const displayName = identity.name ?? username

    // Convex não tem constraint de unicidade nativa (02-RESEARCH.md §5): o
    // índice by_username_tag só acelera "esse par já existe?" — a garantia
    // de unicidade é 100% desta checagem antes do insert, dentro da mesma
    // mutation transacional (sem corrida real entre execuções concorrentes).
    const newTag = await tag.findAvailableTag({
      generateTag: tag.generateFourDigitTag,
      existsFn: async (candidate) => {
        const collision = await ctx.db
          .query('users')
          .withIndex('by_username_tag', (q) => q.eq('username', username).eq('tag', candidate))
          .unique()
        return collision !== null
      },
    })

    const userId = await ctx.db.insert('users', {
      workosId: identity.subject,
      username,
      tag: newTag,
      displayName,
      avatarUrl: identity.pictureUrl ?? undefined,
    })

    return await ctx.db.get(userId)
  },
})

// Busca pública por identificador `USER#123` (SOCIAL-01): resolve o par
// (username, tag) pelo índice by_username_tag já publicado, nunca por
// varredura. Qualquer usuário autenticado pode procurar outro por esse
// identificador — é o próprio propósito da busca de amigos.
export const findUserByUsernameTag = query({
  args: { username: v.string(), tag: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_username_tag', (q) => q.eq('username', args.username).eq('tag', args.tag))
      .unique()
    if (!user) return null
    // Nunca devolver workosId a outro usuário — é um identificador interno
    // do provedor de auth, não parte da identidade pública USER#123.
    return {
      _id: user._id,
      username: user.username,
      tag: user.tag,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    }
  },
})
