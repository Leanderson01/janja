---
phase: 05-chat-em-tempo-real
plan: 02
subsystem: database
tags: [convex, index-only-queries, unread-state, membership-authorization]

# Dependency graph
requires:
  - phase: 05-01
    provides: "schema com tabelas messages, channelReadState, typing; requireMembership em convex/lib/membership.ts"
provides:
  - "convex/channelReadState.ts: mutation openChannel (marca canal como lido, retorna o divisor de não lidas) e query getUnreadCounts (badge de contagem por canal de um servidor)"
affects: [05-04, 05-05, sidebar-badge]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "requireChannelMembership local não-exportado, reimplementado (não importado de messages.ts) — mesmo padrão de assertDmMember em convex/dms.ts"
    - "Divisor de não lidas calculado sob demanda via range query indexada (_creationTime implícito), sem campo armazenado"

key-files:
  created:
    - convex/channelReadState.ts
    - convex/channelReadState.test.ts
  modified: []

key-decisions:
  - "requireChannelMembership reimplementado localmente em channelReadState.ts, idêntico ao de messages.ts, conforme 05-RESEARCH.md §5 — nenhum import cruzado entre arquivos de domínio da mesma fase"
  - "getUnreadCounts usa requireMembership(ctx, serverId) diretamente (sem passar por canal), pois o argumento já é serverId"

patterns-established:
  - "Divisor de não lidas: calculado ANTES de atualizar o ponteiro de leitura, via gt('_creationTime', ...) sobre messages.by_channel"

# Metrics
duration: ~20min
completed: 2026-08-19
---

# Phase 05 Plan 02: Não lidas (backend) Summary

**Mutation `openChannel` (marca canal como lido + retorna divisor de não lidas) e query `getUnreadCounts` (badge por canal), ambas autorizadas via `requireMembership`, sem campo `firstUnreadMessageId` armazenado — calculado sob demanda por range query indexada em `_creationTime`.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-19
- **Tasks:** 1 plano TDD (RED → GREEN, sem REFACTOR — nenhuma duplicação relevante emergiu)
- **Files modified:** 2 (ambos novos)

## Accomplishments

- `openChannel({ channelId })` (mutation): calcula o divisor de não lidas (primeira
  mensagem não lida, ou `null` se já leu tudo, ou `null` se o canal está vazio) e faz
  upsert do ponteiro de leitura para a mensagem mais recente do canal.
- `getUnreadCounts({ serverId })` (query): contagem de não lidas por canal de texto de um
  servidor, ignorando canais de voz, cada contagem via range query indexada sobre
  `messages.by_channel` (nunca scan da tabela inteira).
- Autorização por membership do servidor em ambas as functions (`requireChannelMembership`
  local em `openChannel`, `requireMembership` direto em `getUnreadCounts`).
- 7 testes cobrindo: divisor "nunca leu" → primeira mensagem; releitura sem mensagem nova →
  `null`; mensagem nova após ler tudo → divisor aponta pra ela; canal vazio → `null` sem
  criar linha em `channelReadState`; rejeição de não-membro em `openChannel`; contagem
  correta (não lido / lido / canal de voz ignorado) em `getUnreadCounts`; rejeição de
  não-membro em `getUnreadCounts`.

## Task Commits

**NENHUM COMMIT FOI FEITO** — conforme instrução explícita `<NO_GIT>` do orquestrador
(agentes irmãos rodando em paralelo: 05-03 em `convex/typing.ts`, 06-06 em
`src/renderer/`). Os dois arquivos abaixo estão no working tree, não commitados:

- `convex/channelReadState.ts` (novo)
- `convex/channelReadState.test.ts` (novo)

## Modules to register

Nenhuma edição em `convex/_generated/api.ts` (fora do meu escopo — orquestrador registra
uma vez). Novo módulo a registrar: **`channelReadState`**, exportando `openChannel`
(mutation) e `getUnreadCounts` (query). Testes usam `anyApi.channelReadState.openChannel`
/ `anyApi.channelReadState.getUnreadCounts`, mesmo padrão de `messages.test.ts`.

## Files Created/Modified

- `convex/channelReadState.ts` — `openChannel` (mutation) e `getUnreadCounts` (query),
  mais dois helpers locais não-exportados: `requireChannelMembership` (idêntico ao de
  `messages.ts`, reimplementado) e `findFirstUnread` (range query indexada sobre
  `messages.by_channel`, usada pelo cálculo do divisor).
- `convex/channelReadState.test.ts` — 7 testes, mesmo estilo de `messages.test.ts`
  (`convexTest`, `anyApi`, `t.withIdentity`, `t.run` para popular dados diretamente).

## Decisions Made

- `requireChannelMembership` reimplementado localmente (não importado de `messages.ts`),
  conforme `05-RESEARCH.md §1/§5` — arquivos de domínio da mesma fase não compartilham
  helper interno não-exportado entre si.
- Nenhum REFACTOR aplicado: o cálculo "mensagens depois de X" aparece de forma levemente
  diferente em `openChannel` (via `findFirstUnread`, já extraído) e `getUnreadCounts`
  (contagem, não busca do primeiro item) — não são duplicação idêntica o suficiente para
  justificar extração forçada; mantido como está.

## Deviations from Plan

None - plan executed exactly as written. Único ajuste fora do escopo do `<behavior>` do
plano: a query de teste `getUnreadCounts` retornava `any` via `anyApi`, o que quebrava
`npm run typecheck:convex` (tsconfig.convex.json, que inclui os `*.test.ts` — a diferença
de cobertura entre `convex/tsconfig.json` e `tsconfig.convex.json` que a instrução de
verificação avisou existir). Corrigido anotando o tipo do retorno de
`asAna.query(anyApi.channelReadState.getUnreadCounts, ...)` explicitamente no teste —
mudança só no arquivo de teste que já é meu, não é uma mudança de código de produção,
então não se enquadra nas Rules 1-4 de desvio (não há bug/funcionalidade faltando/bloqueio
em `channelReadState.ts`, só um tipo implícito no teste).

## Issues Encountered

Nenhum além do ajuste de tipo acima.

## User Setup Required

None.

## Next Phase Readiness

Base pronta para os planos 05-04 (divisor de não lidas na UI, ao abrir um canal) e a
sidebar (badge de contagem, consumindo `getUnreadCounts`). Nenhum arquivo de UI foi
tocado. `convex/typing.ts` (05-03) e `src/renderer/` (06-06) seguem intocados, conforme
`<file_ownership>`.

**Verificação executada (saída real):**

```
$ npx vitest run convex/channelReadState.test.ts
 ✓ convex/channelReadState.test.ts  (7 tests) 44-56ms
 Test Files  1 passed (1)
      Tests  7 passed (7)

$ npx tsc --noEmit -p convex/tsconfig.json
(sem saída — passou limpo)

$ npm run typecheck
> typecheck:node   — passou
> typecheck:web    — passou
> typecheck:convex — passou (após anotar o tipo do retorno de getUnreadCounts no teste)

$ npx vitest run
 ✓ convex/dms.test.ts (15)
 ✓ convex/channels.test.ts (10)
 ✓ convex/messages.test.ts (10)
 ✓ convex/invites.test.ts (13)
 ✓ convex/friends.test.ts (24)
 ✓ convex/channelReadState.test.ts (7)
 ✓ convex/members.test.ts (9)
 ✓ convex/typing.test.ts (8)      <- criado em paralelo pelo agente 05-03
 ✓ convex/servers.test.ts (9)
 ✓ convex/users.test.ts (7)
 ✓ convex/lib/inviteCode.test.ts (6)
 ✓ convex/lib/tag.test.ts (5)
 ✓ convex/presence.test.ts (3)
 ✓ src/renderer/src/lib/user-tag.test.ts (6)
 Test Files  14 passed (14)
      Tests  132 passed (132)
```

Nenhum teste pré-existente quebrou. `convex/typing.test.ts` (8 testes) apareceu durante a
execução — trabalho concorrente do agente irmão 05-03, não deste plano.

---
*Phase: 05-chat-em-tempo-real*
*Completed: 2026-08-19*
