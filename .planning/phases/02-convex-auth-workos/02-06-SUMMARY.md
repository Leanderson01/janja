---
phase: 02-convex-auth-workos
plan: 06
subsystem: database
tags: [convex, presence, mutation, convex-test, vitest]

# Dependency graph
requires:
  - phase: 02-01
    provides: "convex/schema.ts com tabela presence(userId, lastSeen) e índice by_user; users(workosId, ...) e índice by_workos_id"
  - phase: 02-04
    provides: "deployment Convex provisionado (checkpoint humano na máquina Windows) — não replicável neste ambiente Linux, ver Issues Encountered"
provides:
  - "convex/presence.ts com a mutation heartbeat() — upsert autenticado de presença por userId"
  - "convex/presence.test.ts — 3 testes cobrindo rejeição não-autenticada, rejeição de identidade órfã, e upsert sem duplicata"
affects: [F4 (lista de membros), F6 (lista de amigos), 02-08 (renderer chama heartbeat a cada 45s)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mutations de escrita própria (heartbeat, ensureUser) nunca aceitam id como argumento do cliente — sempre derivam de ctx.auth.getUserIdentity()"
    - "Upsert por índice: query com withIndex(...).unique() seguida de patch ou insert, nunca dois writes concorrentes possíveis dentro da mesma mutation transacional"

key-files:
  created:
    - convex/presence.ts
    - convex/presence.test.ts
    - convex/_generated/dataModel.ts (scaffold local, ver Issues Encountered)
    - convex/_generated/server.ts (scaffold local, ver Issues Encountered)
  modified: []

key-decisions:
  - "Heartbeat de 45s (decidido em 02-RESEARCH.md §7, não nesta execução) evita a armadilha de performance do PITFALLS.md (\"Presença escrevendo em presence a cada poucos segundos\"); presence.ts só garante que cada chamada é barata (1 leitura indexada + 1 write), a cadência em si é responsabilidade de quem chama (plano 02-08)"
  - "heartbeat() falha alto se não houver documento users correspondente, em vez de criar uma linha de presença órfã — mantém a integridade referencial sem constraint nativa do Convex"

patterns-established: []

# Metrics
duration: 35min
completed: 2026-08-18
---

# Phase 02 Plan 06: Presença (heartbeat) Summary

**Mutation `presence.heartbeat` com upsert autenticado por índice `by_user`, sem escrita possível para usuário não-autenticado ou sem documento em `users`, coberta por 3 testes `convex-test`.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-18T20:27:00Z (aprox.)
- **Completed:** 2026-08-18T21:02:33Z
- **Tasks:** 2/2 do plano
- **Files modified:** 2 no escopo do plano (+2 fora do escopo, ver Issues Encountered)

## Accomplishments
- `convex/presence.ts`: mutation `heartbeat` sem argumentos, que resolve o usuário via `ctx.auth.getUserIdentity()` → `users.by_workos_id`, e faz upsert em `presence` via `presence.by_user` (patch se existir, insert caso contrário).
- `convex/presence.test.ts`: 3 testes com `convex-test` cobrindo exatamente os 3 `must_haves.truths` do plano (não-autenticado rejeitado, upsert sem duplicata, `lastSeen` cresce entre chamadas).
- Confirmei que a suíte de testes inteira do repo (12 testes, incluindo `convex/users.test.ts` e `convex/lib/tag.test.ts` dos planos irmãos) passa junto com os meus, sem conflito.

## Task Commits

Execução sob a diretiva `NO_GIT` desta tarefa — nenhum commit foi criado. Todos os arquivos foram escritos e deixados sem commit para o orquestrador consolidar em série.

## Files Created/Modified

**No escopo do plano (`files_modified`):**
- `convex/presence.ts` - mutation `heartbeat`, upsert de presença por identidade autenticada
- `convex/presence.test.ts` - 3 testes: rejeição não-autenticada, rejeição de identidade sem `users` correspondente, upsert idempotente

**Fora do escopo original do plano, criados para destravar verificação (ver Issues Encountered):**
- `convex/_generated/dataModel.ts` - scaffold local do tipo `DataModel`, derivado de `schema.ts`
- `convex/_generated/server.ts` - scaffold local de `mutation`/`query`/`action`/etc.

## Decisions Made
- Confirmei a decisão já registrada em `02-RESEARCH.md §7` (heartbeat de 45s, não um write a cada poucos segundos, não o componente `@convex-dev/presence`) e apliquei o princípio dela dentro de `presence.ts`: a mutation em si é O(1) — uma leitura indexada (`by_user`) seguida de um único `patch` ou `insert`, nunca uma segunda leitura/escrita ou full scan. Isso é o que mantém "barato" mesmo que a cadência de chamada aumente no futuro.
- `heartbeat()` lança erro claro ("Usuário sem documento em users") em vez de inserir uma linha de presença com `userId` inválido/órfão — mesma escolha já descrita no plano, mantida como está.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `convex/_generated/` ausente neste ambiente — criei um scaffold local a partir dos templates reais do pacote `convex` instalado**

- **Found during:** Task 1, ao tentar rodar `npm run typecheck`/`npx vitest run` conforme o `<verify>` do plano.
- **Issue:** Este worktree Linux nunca rodou `npx convex dev` autenticado — `.env.local` (com `CONVEX_DEPLOYMENT`) só existe na máquina Windows do usuário, conforme documentado no próprio `02-04-SUMMARY.md` ("No `.env.local` da máquina Windows (gitignored)"). Sem isso, `convex/_generated/` não existe, `npx convex codegen` falha com "You don't have access to the selected project" (exige sessão autenticada), e `npx convex dev` está explicitamente proibido nesta tarefa. Sem `_generated/server`, nem `presence.ts` importa, nem `convex-test` consegue localizar a raiz de módulos (erro: `Could not find the "_generated" directory`).
- **Fix:** Li o código-fonte real dos templates de codegen do pacote `convex` já instalado (`node_modules/convex/src/cli/codegen_templates/{server,dataModel}.ts`) — são deployment-agnostic (dependem só de `schema.ts` local, nunca de round-trip com o backend) — e escrevi `convex/_generated/dataModel.ts` e `convex/_generated/server.ts` reproduzindo literalmente esse template (mesmo texto, mesmos imports, mesmo `DataModelFromSchemaDefinition<typeof schema>`). Não inventei nada: é o mesmo conteúdo que `npx convex dev` geraria localmente antes mesmo de fazer o primeiro push ao backend (comentário do próprio código-fonte: "initial codegen before server analysis"). Não escrevi `api.ts` (ninguém no repo ainda importa `_generated/api`) nem `tsconfig.json`/`README.md` do Convex — mantive o escopo mínimo necessário para destravar `presence.ts`/`presence.test.ts` (e, como efeito colateral benéfico, também `convex/users.ts` do plano irmão 02-05, que tem a mesma dependência).
- **Files modified:** `convex/_generated/dataModel.ts`, `convex/_generated/server.ts` (novos, fora da lista `files_modified` do plano)
- **Verification:** `npx vitest run` — 12/12 testes passam (3 meus + 9 dos planos irmãos). `tsc --noEmit` isolado sobre `convex/**/*.ts` (config temporária, descartada depois, ver Issues Encountered) — 0 erros.
- **Committed in:** N/A (execução em modo `NO_GIT`; arquivos deixados sem commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessário para poder executar qualquer verificação real (typecheck/test) do código deste plano e do plano irmão 02-05 neste ambiente. Nenhum código de negócio foi alterado; `_generated/` é conteúdo gerado, reconstruído de forma decorrente de `schema.ts` e será sobrescrito automaticamente na próxima vez que alguém rodar `npx convex dev` de verdade (na máquina Windows autenticada). Recomendo ao orquestrador confirmar com o usuário se este scaffold deve permanecer versionado (facilita rodar `npx vitest run` neste ambiente Linux daqui pra frente) ou ser tratado como artefato local/gitignored — não tomei essa decisão sozinho porque `.gitignore` atual não lista `convex/_generated`, mas também nunca foi commitado antes.

## Issues Encountered

- **`npm run typecheck` e `npm run build` não cobrem `convex/`.** Nenhum dos `tsconfig.node.json`/`tsconfig.web.json` inclui `convex/**/*` — só `src/main`, `src/preload`, `src/renderer`. Rodei ambos os comandos como pedido (`npm run typecheck`: passa; `npm run build`: passa, gera `out/`), mas eles passam trivialmente porque nunca tocam em `convex/presence.ts` — não são, sozinhos, verificação real do meu código. Para compensar, rodei um `tsc --noEmit` isolado com uma `tsconfig.json` temporária (`include: ["convex/**/*.ts"]`, `strict: true`, mesma config de módulo/resolução que o Convex usa de verdade), que **de fato tipou `presence.ts` e `presence.test.ts`** contra os tipos reais do `convex/server` — 0 erros. Apaguei essa tsconfig temporária depois (não fazia parte do escopo do plano, era só ferramenta de verificação; não deixei arquivo residual no repo).
- **Bloqueio de ambiente pré-existente, não causado por este plano:** confirmado no próprio `02-04-SUMMARY.md` que as env vars do Convex (`CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, etc.) só foram configuradas na máquina Windows do usuário — este worktree Linux nunca teve uma sessão `npx convex dev` autenticada. Isso significa que **nenhum plano futuro que dependa de `convex/_generated/` vai rodar `npx convex dev`/`codegen` de verdade neste ambiente** até que alguém traga o `.env.local` (ou rode login) aqui — vale o orquestrador sinalizar isso ao usuário antes da Fase 2 fechar, para a verificação final (02-09, "Windows") não ser a primeira vez que o `_generated` real é gerado e comparado com o scaffold que deixei aqui.
- Não toquei em `convex/schema.ts`, `convex/users.ts`, `package.json`/`package-lock.json` (modificados por siblings enquanto eu trabalhava — `@workos-inc/node`, `vitest`, `@edge-runtime/vm`) ou em nada sob `src/`. `vitest.config.ts` (environment `edge-runtime`) foi criado pelo plano irmão 02-05 durante minha execução; reexecutei a suíte inteira depois que ele apareceu para confirmar que meus testes continuam passando sob esse ambiente — confirmado.

## User Setup Required

None - nenhuma configuração externa nova. (A configuração do deployment Convex em si já é responsabilidade do 02-04, já concluído; o gap é só a réplica local dessas credenciais neste worktree Linux, mencionado acima.)

## Next Phase Readiness

- `presence.heartbeat` está pronta para ser chamada pelo plano 02-08 (renderer, a cada 45s, só quando `isAuthenticated === true`), e para F4/F6 lerem `presence` por `userId`/`by_user` quando chegar a vez delas — nenhuma peça de exibição foi implementada aqui, conforme escopo do plano.
- Concern para o orquestrador: decidir explicitamente se `convex/_generated/` (scaffold que deixei) deve ser versionado ou gitignored, e garantir que a verificação final da Fase 2 (02-09, na máquina Windows) rode `npx convex dev` de verdade lá para confirmar que o `_generated` real bate com o scaffold usado aqui (schema não mudou desde 02-01, então a expectativa é que sejam equivalentes, mas não testei isso empiricamente contra o backend real).

---
*Phase: 02-convex-auth-workos*
*Completed: 2026-08-18*
