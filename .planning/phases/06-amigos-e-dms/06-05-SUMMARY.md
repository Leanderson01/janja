---
phase: 06-amigos-e-dms
plan: 05
subsystem: database
tags: [convex, convex-test, dm, paginação, autorização]

# Dependency graph
requires:
  - phase: 06-04
    provides: "getOrCreateDmChannel, sendDmMessage, getCallerUser e assertDmMember internos em convex/dms.ts"
provides:
  - "listMyDmChannels — query que lista as conversas diretas do usuário chamador com o outro participante resolvido"
  - "listDmMessages — query paginada (paginationOptsValidator) do histórico de uma conversa, membership-gated"
affects: [06-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "listMyDmChannels: lista dmMembers do chamador via by_user (índice), e para cada canal resolve o outro membro via by_channel_user (prefixo) — nunca varre dmChannels"
    - "listDmMessages: assertDmMember roda antes de .paginate() — nunca pagina primeiro e checa depois, que vazaria existência/contagem de mensagens de canal alheio"
    - "paginate() no servidor devolve { page, isDone, continueCursor } — não confundir com { results, status } que é a forma exposta por usePaginatedQuery no cliente (plano 06-07)"

key-files:
  created: []
  modified:
    - convex/dms.ts
    - convex/dms.test.ts

key-decisions:
  - "otherUser: null é caminho defensivo para membership corrompida (dmMembers com != 2 linhas), não removido mesmo sendo caso não esperado no MVP (DMs em grupo fora de escopo)"
  - "Testes de listDmMessages seedam mensagens via t.run com createdAt idêntico entre elas (Date.now() no mesmo tick) — a ordenação testada (order('desc')) depende de _creationTime, não de createdAt, então isso não mascara o comportamento real"

patterns-established:
  - "Autorização de leitura testada com o mesmo padrão RED de autorização de escrita (06-04): não-membro rejeitado com .rejects.toThrow(), nunca uma página vazia silenciosa"

# Metrics
duration: ~20min
completed: 2026-08-18
---

# Phase 06 Plan 05: Listagem e Paginação de DM Summary

**`convex/dms.ts` ganha `listMyDmChannels` (lista de conversas com o outro participante resolvido) e `listDmMessages` (histórico paginado via `paginationOptsValidator`, membership-gated antes de qualquer paginação), fechando a metade de leitura de SOCIAL-05.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 (listMyDmChannels; listDmMessages paginado)
- **Files created:** 0
- **Files modified:** 2

## Accomplishments

- `listMyDmChannels()`: sem args, resolve o chamador, lista seus `dmMembers` via
  `by_user` (índice), e para cada canal resolve o outro membro via
  `by_channel_user` (prefixo) + `ctx.db.get`. Retorna
  `{ dmChannelId, otherUser: { userId, username, tag, displayName, avatarUrl } | null }[]`
  — nunca vaza `workosId`.
- `listDmMessages({ dmChannelId, paginationOpts })`: `assertDmMember` (reaproveitado
  de 06-04) roda **antes** de qualquer leitura de `dmMessages`, depois
  `.withIndex('by_dm_channel', ...).order('desc').paginate(paginationOpts)`.
- 5 novos testes em `convex/dms.test.ts` (10 → 15 no total do arquivo):
  - `listMyDmChannels`: usuário sem conversas vê `[]`; usuário com 2 conversas
    simultâneas (seed via `t.run`, 2 `dmChannels` + 4 `dmMembers`) vê as 2 sem
    confundir qual `otherUser` pertence a qual canal.
  - `listDmMessages`: rejeita sem identidade; **caso central da fase** — não-membro
    (terceiro usuário, sem `dmMembers` no canal) é rejeitado antes de qualquer
    paginação, mesmo sabendo o `dmChannelId`; membro recebe página respeitando
    `numItems` menor que o total (`numItems: 2` contra 3 mensagens seedadas →
    `page.length === 2`, `isDone === false`), ordenada da mais recente para a
    mais antiga.

## Task Commits

**Nenhum commit foi feito** — instrução explícita da orquestração (modo yolo,
sem git; três agentes irmãos rodando em paralelo: 06-03 em `convex/friends.ts`,
04-06/04-07 em `src/renderer/`). `convex/dms.ts` e `convex/dms.test.ts`
permanecem modificados, não staged (`git status --short` mostra `M`, não `??`,
porque o plano 06-04 já havia criado esses arquivos antes desta execução).

## Files Created/Modified

- `convex/dms.ts` - adiciona `listMyDmChannels` (query) e `listDmMessages`
  (query paginada), importa `paginationOptsValidator` de `convex/server` e
  `query` de `./_generated/server`
- `convex/dms.test.ts` - adiciona `describe('dms.listMyDmChannels', ...)` (2
  testes) e `describe('dms.listDmMessages', ...)` (3 testes)

## Módulos a registrar em `convex/_generated/api.ts`

O `api.ts` atual (gerado antes desta fase) só lista `channels`, `invites`,
`lib/inviteCode`, `lib/membership`, `lib/tag`, `members`, `presence`, `servers`,
`users` — ainda não inclui `dms` nem `friends`. O orquestrador (dono do
`codegen`, `npx convex dev`) precisa garantir que, após integrar os planos da
fase 06, `dms` apareça no `api` gerado expondo:

- `api.dms.getOrCreateDmChannel` (mutation, plano 06-04)
- `api.dms.sendDmMessage` (mutation, plano 06-04)
- `api.dms.listMyDmChannels` (query, este plano)
- `api.dms.listDmMessages` (query paginada, este plano)

Os testes usam `anyApi.dms.<nome>` (padrão já em uso no repo), não dependem do
`api` gerado estar atualizado. A UI do plano 06-07 (`usePaginatedQuery`,
`useQuery`) vai depender do `api` gerado real.

## Decisões Feitas

- **`otherUser: null` mantido como caminho defensivo**: o plano avisou
  explicitamente para não remover essa checagem "só porque não deveria
  acontecer" — DMs em grupo estão fora do MVP, `dmMembers` só deveria ter 2
  linhas por canal, mas o código não assume isso silenciosamente.
- **`page`, não `results`, na forma bruta do servidor**: descoberto durante a
  execução do teste de paginação — `ctx.db.query(...).paginate(...)` no
  handler devolve `{ page, isDone, continueCursor, splitCursor, pageStatus }`.
  `{ results, status }` é a forma que `usePaginatedQuery` expõe no **cliente**
  (React), não a forma bruta da query. O plano e o `06-RESEARCH.md` §3 citam
  `usePaginatedQuery` no cliente mas não detalham a forma bruta do retorno da
  query em si — corrigido no teste sem precisar tocar no handler (que já
  estava correto, só devolvendo o objeto de paginação nativo do Convex sem
  transformação, como deveria).

## Deviations from Plan

Nenhuma das quatro regras de desvio (bug, funcionalidade crítica faltando,
bloqueio, mudança arquitetural) se aplicou ao código de produção
(`convex/dms.ts` saiu exatamente como o plano especificou). O único ajuste foi
de teste: correção do nome do campo (`page.page` em vez de `page.results`) ao
descobrir a forma real do retorno de `paginate()` no servidor — não é uma regra
de desvio de código de produção, é uma correção de asserção de teste para
refletir a API real do Convex.

## Issues Encountered

`npx tsc --noEmit -p convex/tsconfig.json` limpo (mesmo check que `npx convex
dev` roda). `npm run typecheck:convex` (que também typecheca `*.test.ts`, ao
contrário de `convex/tsconfig.json`) reportou inicialmente 5 erros de tipo
implícito `any` em `convex/dms.test.ts` — corrigidos anotando explicitamente o
tipo de retorno esperado de `listMyDmChannels` no teste (não um problema do
handler, só da inferência de tipo de `anyApi.query(...)` no teste). Depois da
correção, `npm run typecheck:convex` mostra apenas 2 erros pré-existentes em
`convex/friends.test.ts` (linhas 360-361, parâmetro `f` implicitamente `any`)
— arquivo do plano irmão 06-03 (em execução paralela), não tocado por esta
execução. `npm run typecheck:web` mostrou, em execuções intermediárias, erros
transitórios em `src/renderer/src/components/shell/MemberList.tsx` e
`ChannelSidebar.tsx` (módulo não encontrado) — confirmado por reexecução que
eram churn dos agentes irmãos 04-06/04-07 editando `src/renderer/`
concorrentemente; na verificação final `typecheck:web` passou limpo.

### Saída real dos testes

```
$ npx vitest run convex/dms.test.ts
 ✓ convex/dms.test.ts  (15 tests) 55-58ms
 Test Files  1 passed (1)
      Tests  15 passed (15)

$ npx tsc --noEmit -p convex/tsconfig.json
(sem output — limpo, exit 0)

$ npm run typecheck
typecheck:node   -> OK
typecheck:web    -> OK (limpo na verificação final)
typecheck:convex -> 2 erros pré-existentes em convex/friends.test.ts
                     (plano irmão 06-03, não tocado por esta execução)

$ npx vitest run convex
 ✓ convex/members.test.ts    (9 tests) 27ms
 ✓ convex/dms.test.ts        (15 tests) 58ms
 ✓ convex/channels.test.ts   (10 tests) 83ms
 ✓ convex/friends.test.ts    (24 tests) 85ms
 ✓ convex/invites.test.ts    (13 tests) 105ms
 ✓ convex/lib/inviteCode.test.ts (6 tests) 25ms
 ✓ convex/servers.test.ts    (9 tests) 42ms
 ✓ convex/users.test.ts      (7 tests) 26ms
 ✓ convex/lib/tag.test.ts    (5 tests) 28ms
 ✓ convex/presence.test.ts   (3 tests) 55ms
 Test Files  10 passed (10)
      Tests  101 passed (101)
```

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `convex/dms.ts` está completo no nível de dados: `getOrCreateDmChannel`,
  `sendDmMessage` (06-04) + `listMyDmChannels`, `listDmMessages` (este plano) —
  SOCIAL-05 completo no backend.
- Plano 06-07 (UI de conversa direta) pode usar
  `usePaginatedQuery(api.dms.listDmMessages, { dmChannelId }, { initialNumItems: N })`
  e `useQuery(api.dms.listMyDmChannels)` assim que o `api` gerado incluir `dms`
  — nenhum bloqueio de schema/índice pendente.
- Nenhuma query nova usa `.filter()` como substituto de índice — confirmado por
  leitura do handler final (`by_user`, `by_channel_user`, `by_dm_channel`, todos
  índices declarados no schema).
- Ponto de atenção (não bloqueio): `convex/dms.ts`/`convex/dms.test.ts`
  continuam não commitados, por instrução explícita da orquestração desta
  execução (modo yolo, sem git). O orquestrador precisa commitar/integrar e
  rodar `npx convex dev`/`codegen` para que `dms` apareça no `api` gerado antes
  do plano 06-07 poder importar de `convex/_generated/api`.

---
*Phase: 06-amigos-e-dms*
*Completed: 2026-08-18*
