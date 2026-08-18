---
phase: 08-compartilhamento-de-tela
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - convex/voice.ts
  - convex/voice.test.ts
  - convex/http.ts
autonomous: true

must_haves:
  truths:
    - "Um evento track_unpublished do LiveKit para uma track de screen_share zera voiceStates.sharing do usuário dono da track, sem exigir nenhuma ação do cliente"
    - "setSharing só funciona para quem já tem uma linha em voiceStates (está em algum canal de voz); chamar sem estar em canal falha com erro descritivo"
    - "reconcileScreenShareStopped é idempotente: chamar duas vezes seguidas, ou para uma linha que já não existe, nunca lança erro"
  artifacts:
    - path: "convex/voice.ts"
      provides: "Mutation setSharing e internalMutation reconcileScreenShareStopped, reaproveitando o helper de resolver usuário autenticado já extraído em 07-01"
      exports: ["setSharing", "reconcileScreenShareStopped"]
    - path: "convex/http.ts"
      provides: "Novo case track_unpublished no mesmo switch de eventos que 07-02 criou, filtrando por track.source === TrackSource.SCREEN_SHARE"
      contains: "TrackSource.SCREEN_SHARE"
  key_links:
    - from: "convex/http.ts"
      to: "convex/voice.ts (internal mutation)"
      via: "ctx.runMutation(internal.voice.reconcileScreenShareStopped, { channelId, userId })"
      pattern: "internal.voice.reconcileScreenShareStopped"
    - from: "convex/voice.ts setSharing"
      to: "voiceStates (linha própria do usuário, por by_user)"
      via: "mutation autenticada, nunca aceita userId do cliente"
      pattern: "by_user"
---

<feature>
  <name>Estado de compartilhamento no backend — setSharing e reconciliação por webhook (base de SHARE-05, SHARE-06)</name>
  <files>convex/voice.ts, convex/voice.test.ts, convex/http.ts</files>
  <behavior>
    **Pré-requisito de execução (não de código):** este plano assume que a
    Fase 7 já rodou — `convex/voice.ts` já tem `joinVoiceChannel`,
    `leaveVoiceChannel`, `setMuted`, `setDeafened` (Plano 07-01) e
    `convex/http.ts` já tem a rota `POST /livekit/webhook` com o switch de
    eventos `participant_left`/`participant_connection_aborted`/
    `room_finished` chamando `internal.voice.reconcileParticipantLeft`/
    `reconcileRoomFinished` (Plano 07-02). Se esses arquivos ainda não
    existirem no formato descrito, **parar e reportar o bloqueio** — este
    plano estende os dois, não os recria.

    O campo `voiceStates.sharing` já existe no schema desde 07-01 (sempre
    `false` na criação da linha) — nenhuma migração de schema é necessária
    aqui, só passa a ser escrito de verdade.

    **`setSharing({ sharing: v.boolean() })` (mutation, identidade
    autenticada obrigatória)**: reaproveita o mesmo helper de "resolver
    usuário autenticado ou lançar" que 07-01 já extraiu (mesmo padrão de
    `convex/presence.ts`: `ctx.auth.getUserIdentity()` +
    `by_workos_id`) — não duplicar essa lógica se o helper já existir; se
    ainda não foi extraído como helper reutilizável, extrair agora e usar
    também na nova internalMutation abaixo. Encontra a própria linha de
    `voiceStates` por `by_user`; se não existir (usuário não está em nenhum
    canal de voz), lança erro descritivo ("Não é possível compartilhar tela
    fora de um canal de voz"). Se existir, `ctx.db.patch(row._id, {
    sharing })`. Caso de teste: chamar sem nunca ter entrado em canal
    nenhum, espera rejeição, nenhuma linha é criada como efeito colateral.

    **`reconcileScreenShareStopped({ channelId: v.id('channels'), userId:
    v.id('users') })` (internalMutation, chamada só pelo webhook)**: busca a
    linha de `voiceStates` por `by_channel_and_user`; se existir, `patch`
    para `sharing: false` (nunca apaga a linha inteira — a pessoa continua
    no canal de voz, só parou de compartilhar tela; isso é diferente de
    `reconcileParticipantLeft`, que apaga a linha porque a pessoa saiu do
    canal). Se não existir (já não está mais no canal, ou `sharing` já é
    `false`), não faz nada, não lança. Caso de teste: chamar duas vezes
    seguidas com os mesmos argumentos, e chamar para um `channelId`/`userId`
    sem linha correspondente — nenhum dos dois lança.

    **Extensão de `convex/http.ts`**: adicionar um `case` ao switch de
    `event.event` que 07-02 já criou (não criar uma segunda rota nem uma
    segunda validação de assinatura):
    - `'track_unpublished'`: verificar `event.track?.source`. Importar
      `TrackSource` de `@livekit/protocol` (dependência transitiva de
      `livekit-server-sdk`, já usada em 07-02 — ver `08-RESEARCH.md` §7
      sobre por que comparar contra o enum importado, não uma string
      hardcoded) e só agir se
      `event.track?.source === TrackSource.SCREEN_SHARE`. Nesse caso,
      chamar `ctx.runMutation(internal.voice.reconcileScreenShareStopped, { channelId: event.room.name as Id<'channels'>, userId: event.participant.identity as Id<'users'> })`
      — mesmo mapeamento de `room.name`→`channelId` e
      `participant.identity`→`userId` que 07-02 já usa (o token foi
      assinado assim em `joinVoiceChannel`, 07-01). Qualquer outro
      `track.source` em `track_unpublished` (câmera, microfone,
      screen_share_audio): ignorar, responder 200 normalmente — não é dado
      que `voiceStates` rastreia.
    - Manter o comportamento já existente para os três eventos de 07-02
      intactos; este plano só adiciona um `case`, não reescreve o switch.

    **Nota sobre cobertura**: `participant_left`/`participant_connection_aborted`/
    `room_finished` (07-02) já apagam a linha inteira de `voiceStates`
    quando a pessoa sai da call — isso já cobre "quem compartilha cai
    (crash/fecha o app) enquanto conectado à call" (SHARE-06), porque
    compartilhar tela sempre acontece dentro da mesma sala de voz já
    conectada (design §6). O `case` novo deste plano cobre o caso mais
    estreito: a track de tela para de ser publicada mas a pessoa continua
    conectada à call (ex.: falha pontual da captura sem derrubar o app) —
    sem ele, `sharing` ficaria `true` para sempre nesse cenário específico,
    mesmo com a pessoa presente e o crash-completo já coberto.
  </behavior>
  <implementation>
    Nenhuma dependência nova — `livekit-server-sdk` e `@livekit/protocol`
    (transitiva) já estão instaladas desde 07-01/07-02.

    Testar a extensão da rota http com o mesmo padrão de 07-02
    (`t.fetch('/livekit/webhook', { method: 'POST', body: rawBodyString,
    headers: { Authorization: authHeaderValue } })`), construindo um evento
    `track_unpublished` assinado com `track.source` igual a
    `TrackSource.SCREEN_SHARE` — reaproveitar o mesmo utilitário de teste
    (assinar payload/header) que 07-02 já escreveu em `voice.test.ts`, não
    reimplementar.

    RED → GREEN → REFACTOR:
    1. RED: `setSharing` sem estar em canal de voz → rejeição, nenhuma linha
       de `voiceStates` criada/alterada.
    2. GREEN: implementação de `setSharing`.
    3. RED: `reconcileScreenShareStopped` chamada duas vezes seguidas
       (idempotência) e para `channelId`/`userId` sem linha correspondente —
       nenhuma lança, via `t.mutation` direto (não precisa passar pela rota
       http para testar a lógica isolada).
    4. GREEN: implementação de `reconcileScreenShareStopped`.
    5. RED: evento `track_unpublished` com `track.source ===
       TrackSource.SCREEN_SHARE` via `t.fetch` ponta a ponta, confirmando
       que `voiceStates.sharing` vira `false`; e um segundo caso com
       `track.source` de câmera/microfone confirmando que a linha NÃO é
       tocada (prova que o filtro por `TrackSource.SCREEN_SHARE` está
       correto, não um catch-all de `track_unpublished`).
    6. GREEN: o `case` novo no switch de `convex/http.ts`.
    7. REFACTOR se a extração do helper de usuário autenticado ainda não
       tiver sido feita em 07-01 e este plano acabar duplicando a lógica.

    Rodar com `npx vitest run convex/voice.test.ts`.
  </implementation>
</feature>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-compartilhamento-de-tela/08-RESEARCH.md
@.planning/research/PITFALLS.md
@.planning/phases/07-voz/07-01-backend-de-voz-PLAN.md
@.planning/phases/07-voz/07-02-webhook-reconciliacao-PLAN.md
@convex/voice.ts
@convex/voice.test.ts
@convex/http.ts
@convex/presence.ts

# Este plano não mexe em nada de Electron/renderer — é puramente Convex, e
# roda em paralelo ao Plano 08-02 (main process) porque não compartilha
# nenhum arquivo com ele. Os Planos 08-04/08-05 (mais à frente, waves
# seguintes) é que vão chamar `setSharing` a partir do cliente real.
</context>

<verification>
- `npx vitest run convex/voice.test.ts` passa, cobrindo `setSharing` (sucesso
  e rejeição fora de canal), `reconcileScreenShareStopped` (idempotência) e
  o roteamento do evento `track_unpublished` filtrado por `TrackSource.SCREEN_SHARE`.
- Nenhuma regressão nos testes já existentes de 07-01/07-02
  (`joinVoiceChannel`, `leaveVoiceChannel`, `setMuted`, `setDeafened`,
  `reconcileParticipantLeft`, `reconcileRoomFinished`).
- `reconcileScreenShareStopped` nunca apaga a linha de `voiceStates` — só
  faz `patch` de `sharing`, diferente de `reconcileParticipantLeft`.
</verification>

<success_criteria>
A base de dados para SHARE-05 (parar compartilhamento) e SHARE-06 (queda do
apresentador) está correta e testada no nível de Convex, reaproveitando
exatamente o mecanismo de webhook que a Fase 7 já validou para o problema
análogo do usuário-fantasma — antes de qualquer UI ou conexão real de mídia
depender dela.
</success_criteria>

<output>
After completion, create `.planning/phases/08-compartilhamento-de-tela/08-01-SUMMARY.md`
</output>
</output>
