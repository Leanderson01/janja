import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { requireChannelMembership, requireIdentity, requireMembership } from './lib/membership'

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
  }
})

/**
 * Resolve só o `users._id` do chamador autenticado, sem checar canal ou membership
 * nenhum — usado pela action `mintMicTestTokens` (voiceToken.ts, Plano 07-09,
 * testador de microfone) para montar dois identities distintos da MESMA pessoa numa
 * sala de teste efêmera que nunca vira linha de `voiceStates`. Não reaproveita
 * `validateVoiceJoin` acima porque aquela function exige um `channelId` real — o
 * teste de microfone não tem canal nenhum envolvido, de propósito (é o que permite
 * rodar sem nunca aparecer para o resto do grupo).
 */
export const resolveAuthenticatedUserId = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireIdentity(ctx)
    return { userId: user._id }
  }
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
      sharing: false
    })
    return null
  }
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
  }
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
  }
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
  }
})

/**
 * SHARE-05 (Plano 08-01): marca/desmarca que este usuário está compartilhando tela.
 *
 * Reaproveita `requireOwnVoiceState` — o mesmo helper de `setMuted`/`setDeafened`, que
 * por sua vez usa `requireIdentity` de `lib/membership.ts`. A identidade é sempre a do
 * chamador autenticado: esta mutation NUNCA aceita um `userId` do cliente, senão
 * qualquer membro poderia marcar outra pessoa como compartilhando.
 *
 * Lançar (em vez de fazer upsert) quando não há linha é deliberado: compartilhar tela
 * só existe dentro de um canal de voz já conectado (design §6), e um upsert aqui
 * criaria uma linha de `voiceStates` sem `channelId` real para colocar nela.
 */
export const setSharing = mutation({
  args: { sharing: v.boolean() },
  handler: async (ctx, { sharing }) => {
    const state = await requireOwnVoiceState(ctx)
    await ctx.db.patch(state._id, { sharing })
    return null
  }
})

// VOICE-04 (Pitfall 3, PITFALLS.md): antídoto do usuário-fantasma. As duas mutations
// abaixo só existem para serem chamadas pela rota de webhook do LiveKit
// (`convex/http.ts`), nunca pelo cliente — daí `internalMutation`. Nada além delas (e
// do `leaveVoiceChannel` explícito acima) apaga uma linha de `voiceStates`.

/**
 * `participant_left` (saída normal, cleanup completo) ou
 * `participant_connection_aborted` (mídia caiu depois da sinalização — o caso
 * crash/Alt+F4/queda de rede do Pitfall 3): apaga a linha de `voiceStates` desse
 * `(channelId, userId)` específico. Idempotente — se a linha já não existir (removida
 * por `leaveVoiceChannel` do cliente, ou evento duplicado reenviado pelo LiveKit por
 * falta de 2xx), não lança e não afeta nenhuma outra linha.
 */
export const reconcileParticipantLeft = internalMutation({
  args: { channelId: v.id('channels'), userId: v.id('users') },
  handler: async (ctx, { channelId, userId }) => {
    const existing = await ctx.db
      .query('voiceStates')
      .withIndex('by_channel_and_user', (q) => q.eq('channelId', channelId).eq('userId', userId))
      .unique()
    if (!existing) return null

    await ctx.db.delete(existing._id)
    return null
  }
})

/**
 * `room_finished` (sala fechou — todos saíram e o timeout expirou, ou `room.close()`):
 * apaga TODAS as linhas de `voiceStates` daquele canal, como camada extra de segurança
 * caso algum `participant_left`/`participant_connection_aborted` individual tenha se
 * perdido. Nunca toca em linhas de outro `channelId` — usa `by_channel`, nunca um scan
 * de tabela inteira.
 */
export const reconcileRoomFinished = internalMutation({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const rows = await ctx.db
      .query('voiceStates')
      .withIndex('by_channel', (q) => q.eq('channelId', channelId))
      .collect()

    await Promise.all(rows.map((row) => ctx.db.delete(row._id)))
    return null
  }
})

/**
 * SHARE-06 (Plano 08-01): `track_unpublished` de uma track de tela — a captura parou,
 * mas a pessoa CONTINUA conectada à call. Por isso aqui é `patch({ sharing: false })`
 * e nunca `delete`: apagar a linha faria a pessoa sumir da lista de participantes do
 * canal de voz sem ter saído dele.
 *
 * O caso mais comum de SHARE-06 (quem compartilha crasha/fecha o app) já é coberto por
 * `reconcileParticipantLeft` acima, que apaga a linha inteira — compartilhamento sempre
 * acontece dentro de uma sala de voz já conectada (design §6). Esta mutation cobre o
 * caso mais estreito de a captura morrer sem derrubar a conexão.
 *
 * Idempotente pelo mesmo motivo de `reconcileParticipantLeft`: o LiveKit reenvia
 * eventos até receber 2xx, e o cliente pode ter chamado `setSharing(false)` antes do
 * webhook chegar. Linha inexistente ou `sharing` já `false`: não faz nada, não lança.
 */
export const reconcileScreenShareStopped = internalMutation({
  args: { channelId: v.id('channels'), userId: v.id('users') },
  handler: async (ctx, { channelId, userId }) => {
    const existing = await ctx.db
      .query('voiceStates')
      .withIndex('by_channel_and_user', (q) => q.eq('channelId', channelId).eq('userId', userId))
      .unique()
    if (!existing) return null

    await ctx.db.patch(existing._id, { sharing: false })
    return null
  }
})

// VOICE-05/06/08/15 (Plano 07-04): leitura de "quem está presente" e
// "quem está mutado/ensurdecido" — sempre a partir de `voiceStates`, nunca
// do LiveKit (que só sabe quem está falando agora e a qualidade da
// conexão, dado efêmero que este arquivo nunca persiste). As duas queries
// abaixo reaproveitam a mesma checagem de membership das mutations acima
// (`requireChannelMembership`/`requireMembership` de `lib/membership.ts`),
// nunca uma cópia paralela dela.

/** Enriquece linhas cruas de `voiceStates` com identidade legível
 * (`displayName`/`username`/`tag`/`avatarUrl`) — nunca `workosId`, que nenhum
 * outro participante deveria aprender.
 *
 * `displayName` entrou junto com a correção de identidade (2026-08-19): é o
 * nome humano com acento e maiúscula ("João Silva"), enquanto `username` é o
 * handle canônico que compõe o identificador `joao.silva#0001`. A UI de voz
 * ainda mostra `username` — a troca para `displayName` no ladrilho e no
 * cabeçalho ficou de fora porque `CallStage.tsx`/`VoiceControlBar.tsx`
 * estavam sendo reorganizados em paralelo. O campo já vem pronto no payload
 * para essa costura ser de uma linha. Linhas cujo `userId` não resolve mais para
 * um documento `users` (não deveria acontecer, mas não é motivo pra
 * quebrar a UI) são descartadas silenciosamente. */
async function enrichVoiceStates(ctx: QueryCtx, rows: Doc<'voiceStates'>[]) {
  const enriched = await Promise.all(
    rows.map(async (row) => {
      const user = await ctx.db.get(row.userId)
      if (!user) return null
      return {
        channelId: row.channelId,
        userId: row.userId,
        muted: row.muted,
        deafened: row.deafened,
        sharing: row.sharing,
        username: user.username,
        tag: user.tag,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl
      }
    })
  )
  return enriched.filter((row): row is NonNullable<typeof row> => row !== null)
}

/**
 * Participantes de UM canal de voz específico (usado por `ConversationArea`
 * e, por canal, por `ChannelSidebar`). Exige que o chamador seja membro do
 * servidor dono do canal — mesma regra de `joinVoiceChannel` (Plano 07-01) —
 * então quem não é membro não aprende nada sobre quem está numa call.
 */
export const voiceParticipantsByChannel = query({
  args: { channelId: v.id('channels') },
  handler: async (ctx, { channelId }) => {
    const { channel } = await requireChannelMembership(ctx, channelId)

    const rows = await ctx.db
      .query('voiceStates')
      .withIndex('by_channel', (q) => q.eq('channelId', channel._id))
      .collect()

    return enrichVoiceStates(ctx, rows)
  }
})

/**
 * Participantes de TODOS os canais de voz de um servidor (usado por
 * `MemberList`, que precisa saber quem está em qualquer call do servidor
 * pra desenhar o anel/badge, independente de canal). Com ~10 pessoas e
 * poucos canais de voz por servidor, buscar `voiceStates` canal a canal em
 * loop é suficiente — sem índice adicional.
 */
export const voiceParticipantsByServer = query({
  args: { serverId: v.id('servers') },
  handler: async (ctx, { serverId }) => {
    await requireMembership(ctx, serverId)

    const voiceChannels = await ctx.db
      .query('channels')
      .withIndex('by_server', (q) => q.eq('serverId', serverId))
      .filter((q) => q.eq(q.field('type'), 'voice'))
      .collect()

    const rowsByChannel = await Promise.all(
      voiceChannels.map((channel) =>
        ctx.db
          .query('voiceStates')
          .withIndex('by_channel', (q) => q.eq('channelId', channel._id))
          .collect()
      )
    )

    return enrichVoiceStates(ctx, rowsByChannel.flat())
  }
})
