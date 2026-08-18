---
phase: 07-voz
plan: 02
type: tdd
wave: 2
depends_on: ["07-01"]
files_modified:
  - convex/http.ts
  - convex/voice.ts
  - convex/voice.test.ts
  - infra/livekit/livekit.yaml
autonomous: true

must_haves:
  truths:
    - "Um evento participant_left ou participant_connection_aborted do LiveKit apaga a linha de voiceStates correspondente, sem exigir nenhuma ação do cliente"
    - "Um evento room_finished apaga todas as linhas de voiceStates daquele canal, sem afetar outros canais"
    - "Um POST sem assinatura válida no header Authorization é rejeitado (401) e não altera nenhuma linha de voiceStates"
  artifacts:
    - path: "convex/http.ts"
      provides: "Rota POST /livekit/webhook que valida a assinatura com o corpo bruto da requisição antes de qualquer parse"
      contains: "request.text()"
    - path: "convex/voice.ts"
      provides: "internalMutation reconcileParticipantLeft e reconcileRoomFinished, chamadas só pelo webhook"
      exports: ["reconcileParticipantLeft", "reconcileRoomFinished"]
  key_links:
    - from: "convex/http.ts"
      to: "convex/voice.ts (internal mutations)"
      via: "ctx.runMutation(internal.voice.reconcileParticipantLeft / reconcileRoomFinished)"
      pattern: "internal.voice.reconcile"
    - from: "infra/livekit/livekit.yaml"
      to: "convex/http.ts"
      via: "bloco webhook.urls apontando pro deployment .convex.site/livekit/webhook — preenchido aqui, implantado no Plano 07-08"
      pattern: "convex.site/livekit/webhook"
---

<feature>
  <name>Reconciliação de usuário-fantasma via webhook do LiveKit (VOICE-04)</name>
  <files>convex/http.ts, convex/voice.ts, convex/voice.test.ts, infra/livekit/livekit.yaml</files>
  <behavior>
    Este é o Pitfall 3 de `PITFALLS.md` virando código: nada além deste
    webhook remove uma linha de `voiceStates` quando o app do usuário morre
    sem rodar `leaveVoiceChannel` (crash, `Alt+F4`, Windows Update, perda de
    rede). Sem ele, VOICE-04 é falso mesmo que todo o resto da fase funcione.

    **Rota `POST /livekit/webhook`** (`convex/http.ts`, `httpRouter` +
    `httpAction`, seguindo o padrão documentado do Convex):
    1. Ler `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` de `process.env`; faltando,
       responder 500 sem tentar validar nada.
    2. **Ler o corpo com `await request.text()` — nunca `request.json()`
       antes.** Este é o detalhe que quebra em silêncio (`PITFALLS.md`
       Pitfall 3, confirmado em `07-RESEARCH.md` §2 contra a doc oficial).
       Caso de teste: um payload deliberadamente re-serializado (JSON.parse
       seguido de JSON.stringify, mudando espaçamento) na mesma assinatura
       deve falhar a validação — prova de que o handler usa o texto bruto,
       não uma versão re-parseada.
    3. Construir `new WebhookReceiver(apiKey, apiSecret)` e chamar
       `receiver.receive(rawBody, request.headers.get('Authorization') ?? '')`.
       Assinatura inválida ou header ausente: capturar a exceção, responder
       401, **não alterar nenhuma linha de `voiceStates`**.
    4. Roteamento por `event.event`:
       - `'participant_left'` ou `'participant_connection_aborted'`:
         `ctx.runMutation(internal.voice.reconcileParticipantLeft, { channelId: event.room.name as Id<'channels'>, userId: event.participant.identity as Id<'users'> })`.
         O nome da sala É o `channelId` (foi assim que o Plano 07-01 assinou o
         token) e o `identity` do participante É o `user._id` do Convex — não
         precisa resolver identidade de novo, ver `07-RESEARCH.md` §6.
       - `'room_finished'`: `ctx.runMutation(internal.voice.reconcileRoomFinished, { channelId: event.room.name as Id<'channels'> })`.
       - Qualquer outro evento: ignorar, responder 200 (o LiveKit reenvia
         com retry se não receber 2xx — nunca deixar um evento desconhecido
         virar erro 500).
    5. Responder 200 em qualquer caminho tratado com sucesso.

    **`reconcileParticipantLeft` (internalMutation, args `{ channelId, userId }`)**:
    apaga a linha de `voiceStates` que casa `(channelId, userId)` via
    `by_channel_and_user`. Se não existir (já removida por
    `leaveVoiceChannel` do cliente, ou evento duplicado), não faz nada — não
    lança erro. Caso de teste: chamar duas vezes seguidas com os mesmos
    argumentos, segunda chamada não lança e não afeta outras linhas.

    **`reconcileRoomFinished` (internalMutation, args `{ channelId }`)**:
    apaga **todas** as linhas de `voiceStates` com aquele `channelId` (via
    `by_channel`), deixando linhas de outros canais intactas. Caso de teste:
    popular `voiceStates` com 3 usuários no canal A e 1 no canal B, rodar
    `reconcileRoomFinished` pro canal A, confirmar 0 linhas restantes pro
    canal A e a linha do canal B intocada.

    **`infra/livekit/livekit.yaml`**: descomentar e preencher o bloco
    `webhook` (hoje comentado, reservado desde a Fase 1):
    ```yaml
    webhook:
      api_key: <mesma LIVEKIT_API_KEY do Convex>
      urls:
        - https://<deployment-real>.convex.site/livekit/webhook
    ```
    O `<deployment-real>` é o mesmo host que aparece em
    `VITE_CONVEX_SITE_URL` no `.env.local` do projeto (não em `.env` — é a
    URL de HTTP actions, `.convex.site`, diferente da URL de client SDK
    `.convex.cloud`). **Este arquivo editado aqui ainda não está implantado
    na VPS** — o redeploy da stack do LiveKit no Coolify e a prova de ponta a
    ponta (matar o processo do Electron com alguém em canal de voz e
    confirmar que a linha some em segundos) acontecem no checkpoint do
    Plano 07-08, não aqui. Deixar isso explícito no SUMMARY deste plano.
  </behavior>
  <implementation>
    `WebhookReceiver` já vem de `livekit-server-sdk` (instalado no Plano
    07-01, mesma dependência). Nenhuma dependência nova.

    Testar a rota http com `t.fetch('/livekit/webhook', { method: 'POST',
    body: rawBodyString, headers: { Authorization: authHeaderValue } })`
    (suporte confirmado do `convex-test`, `07-RESEARCH.md`). Para gerar um
    payload/assinatura válidos dentro do teste, usar o próprio
    `WebhookReceiver`/utilitário de emissão do `livekit-server-sdk` do lado
    do "servidor LiveKit simulado" (ver exemplos oficiais do SDK de como
    construir um `WebhookEvent` assinado para teste, ou construir o header
    `Authorization` manualmente assinando um JWT `HS256` com o mesmo
    `apiSecret` e um hash SHA-256 do corpo, replicando o que o `WebhookReceiver`
    espera decodificar — checar a implementação de `receive()` se a doc não
    for suficiente).

    RED → GREEN → REFACTOR:
    1. RED: caso "assinatura inválida → 401, nenhuma alteração em voiceStates".
    2. GREEN: rota + validação, sem lógica de evento ainda (responde 200/401
       genérico).
    3. RED: `reconcileParticipantLeft` (remove uma linha, idempotente) e
       `reconcileRoomFinished` (remove todas de um canal, preserva outros)
       como internalMutations testadas diretamente via `t.mutation` (não
       precisa passar pela rota http para testar a lógica de reconciliação
       isoladamente).
    4. GREEN: as duas internalMutations.
    5. RED: os dois eventos (`participant_left`/`participant_connection_aborted`
       e `room_finished`) via `t.fetch`, ponta a ponta, confirmando que a
       rota chama a mutation certa com os argumentos certos.
    6. GREEN: roteamento por `event.event` na `httpAction`.
    7. REFACTOR se a extração de `channelId`/`userId` do payload estiver
       duplicada entre os dois branches do switch.

    Rodar com `npx vitest run convex/voice.test.ts`.
  </implementation>
</feature>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/07-voz/07-RESEARCH.md
@.planning/research/PITFALLS.md
@convex/voice.ts
@convex/voice.test.ts
@infra/livekit/livekit.yaml
@infra/livekit/DEPLOY-RUNBOOK.md

# Este plano só cria a rota e a lógica de reconciliação — não mexe no
# processo de deploy da VPS (isso é um botão em Coolify, não algo que este
# agente automatiza) nem no cliente Electron. O Plano 07-08 é quem implanta
# de fato e prova com um teste real de "matar o processo".
</context>

<verification>
- `npx vitest run convex/voice.test.ts` passa, cobrindo os 3 eventos e o
  caso de assinatura inválida.
- `reconcileRoomFinished` nunca apaga linhas de um canal diferente do
  informado.
- `livekit.yaml` tem o bloco `webhook` preenchido com a URL `.convex.site`
  real do deployment (não um placeholder).
</verification>

<success_criteria>
VOICE-04 está resolvido no nível de código e testado sem depender de rede
real — a prova de ponta a ponta (matar o app, usuário some em segundos)
acontece no Plano 07-08, mas a lógica que a sustenta já está correta e
coberta por teste aqui.
</success_criteria>

<output>
After completion, create `.planning/phases/07-voz/07-02-SUMMARY.md`
</output>
