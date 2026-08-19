import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { requireIdentity } from './lib/membership'

// VOICE-01/03/06/07: entrar, sair, mutar e ensurdecer num canal de voz — sempre com
// autorização por membership. Convex é a fonte da verdade de quem está em qual canal
// (`voiceStates`), nunca o LiveKit; o LiveKit só obedece o token que assinamos aqui.
//
// A assinatura do token vive em `voiceToken.ts`, num runtime separado — ver o cabeçalho
// daquele arquivo para o motivo.

/**
 * Resolve `users` a partir do `workosId` da identidade e confirma, dentro de uma única
 * transação de leitura, que: (1) o canal existe, (2) é do tipo `'voice'`, e (3) o
 * usuário é membro do servidor dono do canal. Qualquer falha lança e a action nunca
 * chega a assinar um token.
 */
export const validateVoiceJoin = internalQuery({
  args: { channelId: v.id('channels'), workosId: v.string() },
  handler: async (ctx, { channelId, workosId }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('by_workos_id', (q) => q.eq('workosId', workosId))
      .unique()
    if (!user) {
      throw new Error('Usuário sem documento em users — ensureUser deveria ter rodado antes')
    }

    const channel = await ctx.db.get(channelId)
    if (!channel) throw new Error('Canal não encontrado')
    if (channel.type !== 'voice') throw new Error('Este canal não é um canal de voz')

    const membership = await ctx.db
      .query('serverMembers')
      .withIndex('by_server_user', (q) => q.eq('serverId', channel.serverId).eq('userId', user._id))
      .unique()
    if (!membership) throw new Error('Não é membro deste servidor')

    return { userId: user._id }
  },
})

/**
 * Upsert por `by_channel_and_user`: se a linha já existe (reconectar ao mesmo canal),
 * não reseta `muted`/`deafened` de uma sessão anterior — só garante que ela existe.
 * Nunca duplica linha para o mesmo (channelId, userId).
 */
export const upsertVoiceState = internalMutation({
  args: { channelId: v.id('channels'), userId: v.id('users') },
  handler: async (ctx, { channelId, userId }) => {
    const existing = await ctx.db
      .query('voiceStates')
      .withIndex('by_channel_and_user', (q) => q.eq('channelId', channelId).eq('userId', userId))
      .unique()
    if (existing) return null

    await ctx.db.insert('voiceStates', {
      channelId,
      userId,
      muted: false,
      deafened: false,
      sharing: false,
    })
    return null
  },
})

/**
 * Sai do canal de voz atual. Idempotente: se o usuário não estiver em nenhum canal,
 * não lança — cobre UI dessincronizada chamando leave mais de uma vez. Um usuário só
 * está em um canal de voz por vez neste produto, então `by_user` basta.
 */
export const leaveVoiceChannel = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireIdentity(ctx)

    const existing = await ctx.db
      .query('voiceStates')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .unique()
    if (!existing) return null

    await ctx.db.delete(existing._id)
    return null
  },
})

/** Encontra a própria linha de voiceStates ou lança — usado por setMuted/setDeafened,
 * que exigem que o usuário já esteja em algum canal de voz. */
async function requireOwnVoiceState(ctx: MutationCtx) {
  const user = await requireIdentity(ctx)
  const state = await ctx.db
    .query('voiceStates')
    .withIndex('by_user', (q) => q.eq('userId', user._id))
    .unique()
  if (!state) throw new Error('Você não está em nenhum canal de voz')
  return state
}

/**
 * `setDeafened(true)` sempre implica `muted: true` na mesma escrita — "falar no vácuo"
 * nunca é um estado alcançável. `setMuted(false)` enquanto ensurdecido também remove o
 * ensurdecimento (design §8: desmutar remove a surdina). Outros membros só enxergam
 * `muted` — `deafened` é local/privado por natureza do produto, esta mutation só
 * mantém a linha coerente no servidor.
 */
export const setMuted = mutation({
  args: { muted: v.boolean() },
  handler: async (ctx, { muted }) => {
    const state = await requireOwnVoiceState(ctx)

    if (!muted && state.deafened) {
      await ctx.db.patch(state._id, { muted: false, deafened: false })
      return null
    }

    await ctx.db.patch(state._id, { muted })
    return null
  },
})

/** `setDeafened(false)` isolado só remove a surdina — não mexe em `muted` (o microfone
 * continua como estava antes de ensurdecer). */
export const setDeafened = mutation({
  args: { deafened: v.boolean() },
  handler: async (ctx, { deafened }) => {
    const state = await requireOwnVoiceState(ctx)

    if (deafened) {
      await ctx.db.patch(state._id, { deafened: true, muted: true })
      return null
    }

    await ctx.db.patch(state._id, { deafened: false })
    return null
  },
})
