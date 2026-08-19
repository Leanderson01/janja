import { v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'
import { AccessToken } from 'livekit-server-sdk'
import { action, internalMutation, internalQuery, mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireIdentity } from './lib/membership'

// VOICE-01/03/06/07: entrar, sair, mutar e ensurdecer num canal de voz — sempre com
// autorização por membership. Convex é a fonte da verdade de quem está em qual canal
// (`voiceStates`), nunca o LiveKit; o LiveKit só obedece o token que assinamos aqui.
//
// `joinVoiceChannel` é uma `action`: ela não tem `ctx.db` (nenhuma action tem, em
// qualquer runtime), então autorização e a escrita em `voiceStates` são duas chamadas
// via runQuery/runMutation para functions internas — não uma transação única (ver
// 07-RESEARCH.md §1). Se a assinatura do token suceder mas o runMutation seguinte
// falhar, o cliente teria um token válido sem uma linha correspondente; por isso o
// token só é retornado depois que o runMutation de upsert já completou.
//
// Este arquivo não tem `_generated/api.ts` regenerado (ver SUMMARY) — as referências
// internas usam `makeFunctionReference` em vez de `internal.voice.*`, resolvendo pelo
// nome do módulo (`voice:funcao`) do mesmo jeito que o codegen faria.

const validateVoiceJoinRef = makeFunctionReference<
  'query',
  { channelId: Id<'channels'>; workosId: string },
  { userId: Id<'users'> }
>('voice:validateVoiceJoin')

const upsertVoiceStateRef = makeFunctionReference<
  'mutation',
  { channelId: Id<'channels'>; userId: Id<'users'> },
  null
>('voice:upsertVoiceState')

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

export const joinVoiceChannel = action({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }): Promise<{ token: string; url: string }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Não autenticado')

    const { userId } = await ctx.runQuery(validateVoiceJoinRef, {
      channelId,
      workosId: identity.subject,
    })

    const apiKey = process.env.LIVEKIT_API_KEY
    const apiSecret = process.env.LIVEKIT_API_SECRET
    const url = process.env.LIVEKIT_URL
    if (!apiKey || !apiSecret || !url) {
      throw new Error(
        'LiveKit não configurado — defina LIVEKIT_API_KEY, LIVEKIT_API_SECRET e LIVEKIT_URL ' +
          'nas variáveis de ambiente do Convex (ver Plano 07-00)'
      )
    }

    // `identity` do token do LiveKit é o `_id` do documento `users` do Convex, não o
    // `workosId` nem `username#tag` — é o mesmo valor que voiceStates.userId usa, e é
    // o que o webhook do Plano 07-02 vai receber de volta para reconciliar a saída.
    const accessToken = new AccessToken(apiKey, apiSecret, { identity: userId })
    accessToken.addGrant({
      room: channelId,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    })
    const jwt = await accessToken.toJwt()

    await ctx.runMutation(upsertVoiceStateRef, { channelId, userId })

    return { token: jwt, url }
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
