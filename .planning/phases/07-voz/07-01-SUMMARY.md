---
phase: 07-voz
plan: 01
subsystem: backend
tags: [convex, livekit, jose, webcrypto, voice, authorization, tdd]

# Dependency graph
requires:
  - phase: 04-servidores-e-canais
    provides: "convex/schema.ts com channels (type: 'text' | 'voice') e serverMembers já publicados"
  - phase: 02-autenticacao
    provides: "convex/lib/membership.ts (requireIdentity) e convexTest configurado (import.meta.glob + anyApi)"
provides:
  - "Tabela voiceStates (channelId, userId, muted, deafened, sharing) com índices by_channel, by_user, by_channel_and_user"
  - "convex/voice.ts: joinVoiceChannel (action, autorização + AccessToken do LiveKit + upsert de voiceStates), leaveVoiceChannel (mutation idempotente), setMuted/setDeafened (mutations com a semântica deafen-implica-mute)"
  - "Prova (spike, teste automatizado) de que livekit-server-sdk assina JWT via jose/Web Crypto no runtime padrão do Convex, sem 'use node'"
affects: ["07-02 (webhook de reconciliação lê/apaga voiceStates por identity=userId e por channelId=room)", "07-04 (query de participantes lê voiceStates)", "qualquer UI de voz (07-03+)"]

# Tech tracking
tech-stack:
  added: [livekit-server-sdk@2.18.0]
  patterns:
    - "Action do Convex sem 'use node' assinando JWT com jose via Web Crypto — confirmado por spike isolado antes de construir autorização em cima"
    - "makeFunctionReference('modulo:funcao') para chamadas internas (runQuery/runMutation) dentro do mesmo arquivo, sem depender de convex/_generated/api.ts regenerado — necessário porque este agente não pode rodar `npx convex codegen`"
    - "Autorização de action em duas etapas via runQuery (internalQuery de validação) + runMutation (internalMutation de upsert), nunca uma transação única — token só é retornado depois que o upsert em voiceStates já completou"

key-files:
  created:
    - convex/voice.ts
    - convex/voice.test.ts
  modified:
    - convex/schema.ts
    - package.json
    - package-lock.json

key-decisions:
  - "identity do AccessToken do LiveKit é o _id do documento users do Convex (não workosId, não username#tag) — mesmo valor que voiceStates.userId usa, decisão já registrada em 07-RESEARCH.md §6 para o webhook do Plano 07-02 poder reconciliar sem resolver identidade de novo"
  - "convex/_generated/api.ts NÃO foi regenerado (proibido pelo prompt de execução — nenhum `npx convex dev`/`codegen`). Referências internas (validateVoiceJoin, upsertVoiceState) usam makeFunctionReference('voice:nomeDaFuncao') em vez de internal.voice.*, o que compila e funciona em runtime real do mesmo jeito que o codegen geraria, sem exigir edição do arquivo gerado. Quando a orquestração rodar `npx convex dev`/deploy, api.ts vai incluir voice.ts automaticamente e nada aqui precisa mudar."
  - "join não reseta muted/deafened de uma sessão anterior no mesmo canal — upsertVoiceState só insere se a linha (channelId, userId) não existir; reentrar no mesmo canal preserva o estado anterior de mute/deafen, coberto por teste explícito"

patterns-established:
  - "Spike primeiro, teste isolado da lib externa (AccessToken.toJwt() fora de qualquer convexTest), antes de construir lógica de autorização em cima — evita descobrir incompatibilidade de runtime depois de já ter escrito a feature inteira"

# Metrics
duration: ~25min
completed: 2026-08-18
---

# Phase 07 Plan 01: Backend de voz Summary

**Autorização de entrada em canal de voz (membership real, não só UI), assinatura de AccessToken do LiveKit via `jose`/Web Crypto no runtime padrão do Convex (sem `"use node"`), e semântica de mute/deafen (`setDeafened(true)` implica `muted: true`; `setMuted(false)` remove o deafen) — tudo provado por 19 testes automatizados, sem depender de credenciais reais do LiveKit.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-18
- **Tasks:** 1 plano (TDD: spike → autorização → efeitos colaterais → mute/deafen), executado como um bloco coeso
- **Files modified/created:** 5 (`convex/schema.ts`, `convex/voice.ts`, `convex/voice.test.ts`, `package.json`, `package-lock.json`)

## Accomplishments

- Spike isolado confirmando que `AccessToken` de `livekit-server-sdk` assina e produz um JWT válido (`toJwt()`) dentro do mesmo `edge-runtime` que os testes do Convex já usam — sem `"use node"`, resolvendo a incerteza aberta em `PITFALLS.md`/`07-RESEARCH.md §1`.
- Tabela `voiceStates` no schema, com os três índices exigidos (`by_channel`, `by_user`, `by_channel_and_user`).
- `joinVoiceChannel` (action): exige identidade autenticada, resolve `users` pelo `workosId`, confirma `channel.type === 'voice'` e membership real via `serverMembers` (nunca checagem só de UI), assina o token escopado a `room: channelId`, e só então faz upsert em `voiceStates` — nenhuma dessas etapas produz efeito colateral parcial sem as outras (testado: token+linha juntos, ou nenhum dos dois).
- `leaveVoiceChannel` (mutation) idempotente — chamar sem estar em canal nenhum não lança.
- `setMuted`/`setDeafened` (mutations) com a semântica exata exigida: ensurdecer muta junto; desmutar remove o ensurdecimento; os dois outros casos (mute isolado, undeafen isolado) não vazam efeito colateral um no outro.
- Falta de `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`/`LIVEKIT_URL` produz um erro explícito e legível ("LiveKit não configurado — ... ver Plano 07-00"), nunca um `undefined` silencioso passado ao SDK, nunca um crash opaco — mesma lição de runtime já aprendida na Fase 2.

## Files Created/Modified

- `convex/schema.ts` — adiciona `voiceStates` (channelId, userId, muted, deafened, sharing) com 3 índices.
- `convex/voice.ts` — `validateVoiceJoin` (internalQuery), `upsertVoiceState` (internalMutation), `joinVoiceChannel` (action pública), `leaveVoiceChannel`, `setMuted`, `setDeafened` (mutations públicas). **Módulo a registrar quando a orquestração rodar `npx convex dev`/deploy** — não está em `convex/_generated/api.ts` porque este agente não pode rodar codegen (ver Decisões).
- `convex/voice.test.ts` — 19 testes: spike do SDK, todas as rejeições de `joinVoiceChannel` (sem identidade, sem `users`, canal inexistente, canal `text`, não-membro, sem env vars do LiveKit), sucesso + idempotência + preservação de estado no reentrar, `leaveVoiceChannel` (remoção + idempotência + rejeição sem identidade), e as 6 combinações de semântica de `setMuted`/`setDeafened`.
- `package.json`/`package-lock.json` — `livekit-server-sdk@2.18.0` como dependência de produção (roda dentro de uma action, não é devDependency).

## Decisions Made

- `identity` do `AccessToken` = `_id` do documento `users` do Convex (não `workosId`), para o webhook do Plano 07-02 poder reconciliar `voiceStates` diretamente pelo `identity` do payload, sem resolver usuário de novo — decisão já pré-registrada em `07-RESEARCH.md §6`, aplicada aqui.
- Como `convex/_generated/api.ts` não pode ser editado por este agente e não foi regenerado (nenhum `npx convex dev`/`codegen` rodado), as duas chamadas internas da action (`ctx.runQuery`/`ctx.runMutation`) usam `makeFunctionReference('voice:validateVoiceJoin')` e `makeFunctionReference('voice:upsertVoiceState')` de `convex/server` em vez de `internal.voice.*`. Isso resolve pelo nome do módulo em runtime exatamente como o codegen faria, e passa `npx tsc --noEmit -p convex/tsconfig.json` sem exigir o arquivo gerado atualizado. Quando a orquestração publicar o deployment, `api.ts` vai ganhar o módulo `voice` automaticamente — nenhuma mudança de código é necessária nesse momento.
- Reentrar no mesmo canal (join duas vezes, ou reconectar depois de uma queda) não reseta `muted`/`deafened` de uma sessão anterior — `upsertVoiceState` só insere se a linha `(channelId, userId)` ainda não existir. Coberto por teste explícito.

## Deviations from Plan

None — plano executado exatamente como escrito, incluindo a ordem RED→GREEN determinada no `<implementation>` (spike isolado primeiro, confirmado antes de escrever qualquer lógica de autorização).

## Issues Encountered

- `convex/_generated/api.ts` não pôde ser regenerado (proibido pelo prompt de execução), o que impediria o padrão usual `internal.voice.*` de compilar. Resolvido com `makeFunctionReference` (utilitário oficial do `convex/server` para exatamente este caso — referenciar functions sem depender de codegen), documentado acima como decisão, não como bug.

## User Setup Required

**Credenciais reais do LiveKit ainda não foram configuradas no Convex — isso é o Plano 07-00 (checkpoint humano), que não rodou.** Para `joinVoiceChannel` funcionar em runtime real (fora dos testes, que usam `convex-test` sem rede), é necessário configurar no ambiente do deployment Convex (dashboard ou `npx convex env set`, fora do escopo deste agente):

- `LIVEKIT_API_KEY` — API Key do servidor LiveKit (`wss://livekit.usesenju.com`, já verificado como live).
- `LIVEKIT_API_SECRET` — API Secret correspondente. **Nunca commitar este valor em nenhum arquivo do repositório.**
- `LIVEKIT_URL` — URL do servidor LiveKit para o cliente conectar (`wss://livekit.usesenju.com`, a confirmar exatamente com o runbook de infra em `infra/livekit/`).

Sem as três, `joinVoiceChannel` lança `"LiveKit não configurado — defina LIVEKIT_API_KEY, LIVEKIT_API_SECRET e LIVEKIT_URL nas variáveis de ambiente do Convex (ver Plano 07-00)"` — falha legível, não um crash nem um hang, e nenhuma linha é escrita em `voiceStates` quando isso acontece (testado).

Além disso, `npx convex dev`/deploy real precisa rodar (fora do escopo deste agente, per `<safety>`) para que `convex/_generated/api.ts` passe a incluir o módulo `voice` e o schema publique a tabela `voiceStates` no deployment real.

## Next Phase Readiness

- VOICE-01 (autorização de entrada), VOICE-03 (saída) e a semântica de VOICE-06/VOICE-07 (mute/deafen) estão corretas no nível de dados, provadas por 19 testes automatizados (151 no repo inteiro, sem regressão).
- `voiceStates` está desenhada para o Plano 07-02 (webhook) limpar linhas de forma direta: `by_channel_and_user` já é a chave que o evento `participant_left`/`participant_connection_aborted` (identity=userId, room=channelId) precisa, e `by_channel` serve para o evento `room_finished` limpar todas as linhas de um canal de uma vez.
- Nenhum blocker novo. O único gap conhecido é o checkpoint humano do Plano 07-00 (credenciais reais), documentado acima com o passo a passo exato.

---
*Phase: 07-voz*
*Completed: 2026-08-18*
