import { httpRouter } from 'convex/server'
import { makeFunctionReference } from 'convex/server'
import { httpAction } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { renderCompletionPage } from './lib/authCompletionPage'

// Plano 07-02 (VOICE-04): antídoto do usuário-fantasma (Pitfall 3, PITFALLS.md).
// Nada além desta rota apaga uma linha de `voiceStates` quando o app do usuário morre
// sem rodar `leaveVoiceChannel` — crash, Alt+F4, Windows Update, perda de rede.
//
// Este arquivo é FORÇADO a rodar no runtime padrão/isolate do Convex — o bundler do
// Convex (`mustBeIsolate`) proíbe `"use node"` em `http.ts`, junto com `crons.ts`,
// `schema.ts` e `auth.config.ts`. Por isso a verificação de assinatura do webhook (que
// precisa de `livekit-server-sdk`, e portanto do runtime Node — ver o comentário no
// topo de `voiceToken.ts` para o motivo exato) NÃO pode acontecer aqui: mora numa
// `internalAction` em `voiceToken.ts`, chamada via `ctx.runAction`. Este arquivo só
// lê o corpo bruto da requisição, decide 500/401/200, e delega a reconciliação de
// `voiceStates` para as internalMutations de `voice.ts`.
//
// `makeFunctionReference` em vez de `internal.voice.X`/`internal.voiceToken.X`: o
// mesmo motivo já documentado em `voiceToken.ts` — `_generated/api.ts` só é
// regenerado por `npx convex dev`, que não roda neste fluxo de execução. Referenciar
// por string ("módulo:função") evita depender de codegen para compilar ou testar.

const verifyLiveKitWebhookRef = makeFunctionReference<
  'action',
  { rawBody: string; authHeader: string },
  { event: string; channelId: string | null; userId: string | null }
>('voiceToken:verifyLiveKitWebhook')

const reconcileParticipantLeftRef = makeFunctionReference<
  'mutation',
  { channelId: Id<'channels'>; userId: Id<'users'> },
  null
>('voice:reconcileParticipantLeft')

const reconcileRoomFinishedRef = makeFunctionReference<
  'mutation',
  { channelId: Id<'channels'> },
  null
>('voice:reconcileRoomFinished')

const http = httpRouter()

http.route({
  path: '/livekit/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    // Passo 1: sem as chaves, nem tenta validar nada — 500 direto (a instrução do
    // plano é explícita: "faltando, responder 500 sem tentar validar nada").
    const apiKey = process.env.LIVEKIT_API_KEY
    const apiSecret = process.env.LIVEKIT_API_SECRET
    if (!apiKey || !apiSecret) {
      return new Response(null, { status: 500 })
    }

    // Passo 2: corpo BRUTO, sempre. `request.json()` aqui quebraria a verificação de
    // HMAC/JWT em silêncio — o pior tipo de falha para uma checagem de segurança
    // (Pitfall 3, PITFALLS.md; confirmado contra a doc oficial em 07-RESEARCH.md §2).
    const rawBody = await request.text()
    const authHeader = request.headers.get('Authorization') ?? ''

    // Passo 3: assinatura inválida ou header ausente → 401, e a exceção da action
    // impede que qualquer mutation de reconciliação seja sequer chamada.
    let event: { event: string; channelId: string | null; userId: string | null }
    try {
      event = await ctx.runAction(verifyLiveKitWebhookRef, { rawBody, authHeader })
    } catch {
      return new Response(null, { status: 401 })
    }

    // Passo 4: roteamento por evento. Qualquer evento fora dos três tratados aqui é
    // ignorado com 200 — o LiveKit reenvia com retry se não receber 2xx, e um evento
    // desconhecido nunca deve virar 500. `track_unpublished` (tela congelada
    // compartilhando, Fase 8) estende este mesmo switch depois — um único mecanismo
    // de reconciliação, não dois.
    switch (event.event) {
      case 'participant_left':
      case 'participant_connection_aborted': {
        if (event.channelId && event.userId) {
          await ctx.runMutation(reconcileParticipantLeftRef, {
            channelId: event.channelId as Id<'channels'>,
            userId: event.userId as Id<'users'>,
          })
        }
        break
      }
      case 'room_finished': {
        if (event.channelId) {
          await ctx.runMutation(reconcileRoomFinishedRef, {
            channelId: event.channelId as Id<'channels'>,
          })
        }
        break
      }
      default:
        break
    }

    // Passo 5: 200 em qualquer caminho tratado com sucesso.
    return new Response(null, { status: 200 })
  }),
})

// Rota AUTH-07 (página de conclusão de login). Ver a "Decisão registrada —
// 2026-08-18" em .planning/STATE.md e convex/lib/authCompletionPage.ts para o
// raciocínio completo. Servida em https://<deployment>.convex.site/auth/complete —
// o mesmo host de VITE_CONVEX_SITE_URL, cadastrado no dashboard da WorkOS como
// redirect URI (ver src/main/auth/auth.ts).
http.route({
  path: '/auth/complete',
  method: 'GET',
  handler: httpAction(async (_ctx, request) => {
    const params = new URL(request.url).searchParams
    const hasCallbackParams = params.has('code') || params.has('error')
    const callbackUrl = `janja://callback?${params.toString()}`
    const html = renderCompletionPage(hasCallbackParams, callbackUrl)
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })
  })
})

export default http
