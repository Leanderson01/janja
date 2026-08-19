"use node"

// Assinatura do token de sala do LiveKit — isolada aqui porque precisa do runtime
// Node.js do Convex.
//
// O spike do plano 07-01 concluiu que o `livekit-server-sdk` assinava via Web Crypto e
// rodaria no runtime padrão. Passou nos testes e falhou no deploy real: o ambiente
// edge-runtime do vitest resolve `node:crypto`, o bundler do Convex para o runtime
// padrão não. Erro observado: `Could not resolve "node:crypto"` em
// `livekit-server-sdk/dist/crypto/digest.js`.
//
// Lição registrada: o spike verificou a afirmação no ambiente errado. Provar que algo
// roda sob vitest não prova que roda sob o bundler do Convex.
//
// Um arquivo com "use node" só pode conter actions — por isso as mutations e queries de
// voz continuam em `voice.ts`, no runtime padrão, e esta action as chama por referência.

import { v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'
import { AccessToken } from 'livekit-server-sdk'
import { action } from './_generated/server'
import type { Id } from './_generated/dataModel'

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
