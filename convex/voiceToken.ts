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

const resolveAuthenticatedUserIdRef = makeFunctionReference<
  'query',
  Record<string, never>,
  { userId: Id<'users'> }
>('voice:resolveAuthenticatedUserId')

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
 * Testador de microfone (Plano 07-09, VOICE-21/VOICE-22): assina DOIS tokens para uma
 * sala efêmera dedicada — nunca criada em `channels`, nunca gera linha em
 * `voiceStates`, nunca aparece para o resto do grupo. LiveKit cria a sala sozinho na
 * primeira conexão e a fecha sozinho quando fica vazia (comportamento padrão do
 * servidor, sem `room.create` explícito).
 *
 * `joinVoiceChannel` (acima) não serve para este teste: ele sempre assina
 * `identity: userId`, e duas conexões SIMULTÂNEAS com o MESMO identity no MESMO room
 * fazem o LiveKit derrubar a sessão mais antiga assim que a segunda entra (dedup de
 * identity é o comportamento padrão do SFU). O teste de ida-e-volta precisa das duas
 * conexões vivas ao mesmo tempo — por isso dois identities distintos para a mesma
 * pessoa (`${userId}-mictest-pub` / `${userId}-mictest-sub`).
 *
 * TTL curto (5 minutos): não existe nenhuma linha em tabela nenhuma para revogar
 * depois — o próprio token expirando é o único mecanismo que fecha o acesso a essa
 * sala.
 */
export const mintMicTestTokens = action({
  args: {},
  handler: async (
    ctx
  ): Promise<{
    url: string
    publisherToken: string
    subscriberToken: string
    roomName: string
  }> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Não autenticado')

    const { userId } = await ctx.runQuery(resolveAuthenticatedUserIdRef, {})

    const apiKey = process.env.LIVEKIT_API_KEY
    const apiSecret = process.env.LIVEKIT_API_SECRET
    const url = process.env.LIVEKIT_URL
    if (!apiKey || !apiSecret || !url) {
      throw new Error(
        'LiveKit não configurado — defina LIVEKIT_API_KEY, LIVEKIT_API_SECRET e LIVEKIT_URL ' +
          'nas variáveis de ambiente do Convex (ver Plano 07-00)'
      )
    }

    // Nome único por execução — nunca colide com uma sala de teste anterior que por
    // algum motivo ainda não tenha fechado.
    const roomName = `mic-test-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

    async function mint(role: 'pub' | 'sub'): Promise<string> {
      const accessToken = new AccessToken(apiKey, apiSecret, {
        identity: `${userId}-mictest-${role}`,
        ttl: '5m'
      })
      accessToken.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true
      })
      return accessToken.toJwt()
    }

    const [publisherToken, subscriberToken] = await Promise.all([mint('pub'), mint('sub')])

    return { url, publisherToken, subscriberToken, roomName }
  }
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
 *
 * Plano 08-01: `trackSource` entrou no retorno porque `track_unpublished` (tela parou
 * de ser publicada) precisa distinguir tela de câmera/microfone, e `http.ts` só enxerga
 * o que esta action devolve — o `WebhookEvent` de protobuf não atravessa `runAction`.
 * Devolvido como o valor NUMÉRICO do enum `TrackSource` do protocolo (SCREEN_SHARE = 3),
 * que é o que `receive` decodifica a partir do nome serializado no JSON; quem compara
 * contra `TrackSource.SCREEN_SHARE` é `http.ts`, nunca uma string literal (08-RESEARCH.md §7).
 */
export const verifyLiveKitWebhook = internalAction({
  args: { rawBody: v.string(), authHeader: v.string() },
  handler: async (
    _ctx,
    { rawBody, authHeader }
  ): Promise<{
    event: string
    channelId: string | null
    userId: string | null
    trackSource: number | null
  }> => {
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
      trackSource: event.track?.source ?? null,
    }
  },
})
