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
//
// Plano 07-02 (VOICE-04, Pitfall 3): `verifyLiveKitWebhook`, abaixo, tem o MESMO
// problema por um motivo mais sutil. `WebhookReceiver` não usa `node:crypto`
// diretamente — mas `livekit-server-sdk/dist/index.js` reexporta TUDO com
// `export * from "./WebhookReceiver.js"`, e `WebhookReceiver.js` importa
// `crypto/digest.js`, o mesmo arquivo com `await import("node:crypto")` que já quebrou
// o bundler do runtime padrão para `AccessToken`. Ou seja: **qualquer** import de
// `livekit-server-sdk` — mesmo só `{ AccessToken }` — arrasta esse módulo inteiro para
// dentro do grafo de bundling. `convex/http.ts` (onde a rota HTTP do webhook precisa
// morar — `mustBeIsolate` do bundler do Convex força esse arquivo a ficar no runtime
// padrão, "use node" não é permitido nele) não pode importar nada de
// `livekit-server-sdk` diretamente por esse motivo. A verificação de assinatura mora
// aqui, no runtime Node, e `http.ts` chama esta action por referência
// (`ctx.runAction`), do mesmo jeito que faz para as mutations de `voice.ts`.

import { v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'
import { AccessToken, WebhookReceiver } from 'livekit-server-sdk'
import { action, internalAction } from './_generated/server'
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

/**
 * Valida a assinatura de um webhook do LiveKit e devolve o evento já decodificado como
 * dado simples (serializável entre runtimes — `WebhookEvent` é uma classe de protobuf,
 * não atravessa `ctx.runAction` como está). Chamada só por `convex/http.ts`.
 *
 * `rawBody` PRECISA ser o corpo bruto da requisição (`await request.text()` no
 * chamador, nunca `request.json()` antes) — `WebhookReceiver.receive` recalcula o
 * SHA-256 sobre exatamente essa string para conferir contra o hash assinado no JWT do
 * header `Authorization`; qualquer re-serialização (mesmo preservando o conteúdo
 * lógico do JSON) muda os bytes e derruba a verificação (Pitfall 3, PITFALLS.md).
 *
 * Assinatura ausente, inválida, ou corpo que não bate com o hash assinado: `receive`
 * lança, e esta action deixa a exceção propagar — `http.ts` é quem decide responder
 * 401, sem ter chamado nenhuma mutation de reconciliação.
 */
export const verifyLiveKitWebhook = internalAction({
  args: { rawBody: v.string(), authHeader: v.string() },
  handler: async (
    _ctx,
    { rawBody, authHeader }
  ): Promise<{ event: string; channelId: string | null; userId: string | null }> => {
    const apiKey = process.env.LIVEKIT_API_KEY
    const apiSecret = process.env.LIVEKIT_API_SECRET
    if (!apiKey || !apiSecret) {
      throw new Error(
        'LiveKit não configurado — defina LIVEKIT_API_KEY e LIVEKIT_API_SECRET nas ' +
          'variáveis de ambiente do Convex (ver Plano 07-00)'
      )
    }

    const receiver = new WebhookReceiver(apiKey, apiSecret)
    const event = await receiver.receive(rawBody, authHeader)

    return {
      event: event.event,
      channelId: event.room?.name ?? null,
      userId: event.participant?.identity ?? null,
    }
  },
})
