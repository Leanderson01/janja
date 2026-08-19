---
phase: 05-chat-em-tempo-real
plan: 03
subsystem: api
tags: [convex, chat, typing-indicator, presence-pattern, tdd]

# Dependency graph
requires:
  - phase: 05-01
    provides: "tabela `typing` no schema (`channelId`, `userId`, `updatedAt`, índice `by_channel_user`)"
provides:
  - "Mutation `typing.setTyping({ channelId })` — upsert barato e idempotente por (canal, usuário), sem escrita nova a cada tecla"
  - "Query `typing.listTyping({ channelId })` — linhas cruas `{ userId, username, displayName, updatedAt }[]`, excluindo o próprio chamador, sem filtro de idade"
affects: ["05-05 (indicador de digitando no cliente: throttle de escrita, TTL de exibição, tick de setInterval)"]

# Tech tracking
tech-stack:
  added: []
  patterns: ["upsert por índice composto (mesmo padrão de convex/presence.ts)", "requireChannelMembership local não-exportado (terceira cópia, mesmo padrão de messages.ts/channelReadState.ts)", "expiração 100% client-side — servidor nunca filtra por idade"]

key-files:
  created: [convex/typing.ts, convex/typing.test.ts]
  modified: []

key-decisions:
  - "Nenhuma mutation 'pararDeDigitar' nem cron/scheduled function de limpeza — expiração é responsabilidade do cliente (05-05), porque uma query Convex só reavalia quando um documento que ela leu muda; TTL só no servidor deixaria o indicador travado se o cliente que digitava travasse/fechasse sem nenhuma escrita nova."
  - "listTyping devolve linhas cruas com updatedAt sem filtrar por idade — decisão deliberada testada explicitamente (linha de 5min atrás ainda aparece), não uma lacuna."
  - "setTyping é upsert único por (channelId, userId) via busca pontual no índice by_channel_user — nunca cria uma segunda linha por chamada repetida, mesma classe de solução que presence.ts (heartbeat). O throttle de ~2s entre chamadas é responsabilidade do cliente (05-05); este arquivo só garante que a mutation em si nunca é cara nem duplica linhas, não importa a frequência com que for chamada."
  - "requireChannelMembership reimplementado localmente (terceira cópia idêntica à de messages.ts/channelReadState.ts) — deliberado, não duplicação acidental, por design da fase."

patterns-established:
  - "Padrão 'ephemeral state com expiração client-side': quando não existe fonte de verdade externa a reconciliar (diferente do usuário-fantasma de voz, que tem webhook do LiveKit), a expiração de estado efêmero vive inteiramente no cliente via tick de setInterval comparando updatedAt contra Date.now() local — nenhum cron, nenhuma mutation de limpeza."

# Metrics
duration: 20min
completed: 2026-08-19
---

# Phase 05 Plan 03: Digitando (backend) Summary

**Mutation `setTyping` (upsert idempotente, uma linha por canal+usuário) e query `listTyping` (linhas cruas sem filtro de idade, exclui o próprio chamador) para o indicador "está digitando" — expiração é 100% responsabilidade do cliente, não existe TTL nem cron no servidor.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-19T01:22:47Z
- **Tasks:** 1 (plano TDD de arquivo único: RED → GREEN, sem REFACTOR necessário)
- **Files modified:** 2 (ambos novos)

## Accomplishments
- `convex/typing.ts` criado com `setTyping` (mutation) e `listTyping` (query), ambos exigindo `requireChannelMembership` local (mesmo padrão de `messages.ts`/`channelReadState.ts`).
- `setTyping` é upsert por índice composto `by_channel_user` — nunca gera uma segunda linha para o mesmo par (canal, usuário), testado explicitamente chamando 2x seguidas e confirmando `_id` estável + `updatedAt` estritamente maior.
- `listTyping` exclui a própria linha do chamador, junta `username`/`displayName` do autor sem vazar `workosId`, e devolve todas as linhas cruas sem filtrar por idade (testado com uma linha "de 5 minutos atrás" que ainda aparece — comportamento esperado, não bug).
- Autorização SRV-06 testada nos dois sentidos: não-membro rejeitado tanto em `setTyping` (nenhuma linha criada) quanto em `listTyping` (query lança).
- 8 testes novos em `convex/typing.test.ts`, todos passando; suíte completa (`npx vitest run`) com 132 testes passando (117 pré-existentes + 8 novos meus + 7 de `channelReadState.test.ts` do sibling 05-02 rodando em paralelo).

## Task Commits

Nenhum commit foi feito — instrução explícita do orquestrador (`NO_GIT`) porque siblings (05-02 em `convex/channelReadState.ts`, 06-06 em `src/renderer/`) estão rodando em paralelo no mesmo working tree. Arquivos ficam não commitados para o orquestrador consolidar:
- `convex/typing.ts` (novo)
- `convex/typing.test.ts` (novo)

## Files Created/Modified
- `convex/typing.ts` - Mutation `setTyping` (upsert idempotente por canal+usuário) e query `listTyping` (linhas cruas, exclui o próprio chamador, join de autor sem `workosId`, sem filtro de idade).
- `convex/typing.test.ts` - 8 testes: upsert nunca duplica + `updatedAt` avança, autorização SRV-06 em `setTyping` e `listTyping` (não-membro rejeitado, nenhuma linha criada), rejeição sem identidade, exclusão da própria linha (Ana/Bruno), join de autor sem vazar `workosId`, linha antiga ainda aparece sem filtro.

## Decisions Made
- **Expiração 100% client-side, sem cron/TTL de servidor:** honrando `05-RESEARCH.md §7` — uma query Convex só reavalia quando um documento lido por ela muda; se o cliente que estava digitando travar/fechar sem nenhuma escrita nova, um TTL só de servidor deixaria a query presa no último valor. Por isso `listTyping` devolve linhas cruas (`updatedAt`) sem filtrar por idade, e não existe mutation `pararDeDigitar` nem scheduled function de limpeza neste arquivo — 05-05 aplica o tick de `setInterval` no cliente.
- **`setTyping` não tem lógica de throttle** — a mutation em si é só um upsert barato (uma leitura indexada + um patch/insert), idempotente não importa a frequência de chamada. O throttle de ~2s entre chamadas é responsabilidade explícita do cliente (05-05), não deste arquivo — testado aqui apenas que chamar 2x seguidas nunca duplica linha.
- **`requireChannelMembership` reimplementado localmente** (terceira cópia idêntica de `messages.ts`/`channelReadState.ts`) — decisão já tomada em `05-RESEARCH.md §5`, arquivos de domínio diferentes desta fase não compartilham helper interno não-exportado entre si.
- **`listTyping` não usa `getCurrentUser`/`convex/users.ts`** — o campo "excluir a própria linha" é computado a partir do `user` já resolvido dentro de `requireChannelMembership`, sem consulta extra e sem tocar em arquivo de F2 (mesma decisão de `05-RESEARCH.md §1` sobre `isMine` em `listMessages`).

## Deviations from Plan

None - plan executado exatamente como escrito. Nenhuma mutation extra, nenhum índice extra, nenhuma alteração em `convex/schema.ts` (tabela `typing` já existia de 05-01, não foi tocada).

## Issues Encountered
Nenhum problema bloqueante. `npm run typecheck` reporta 3 erros de `implicit any` em `convex/channelReadState.test.ts` (linhas 169-173) — arquivo de propriedade do sibling 05-02 (`?? convex/channelReadState.test.ts` no `git status`, não rastreado por mim), não relacionado a `convex/typing.ts`/`convex/typing.test.ts`. `npx tsc --noEmit -p convex/tsconfig.json` (o comando real que `npx convex dev` roda, que exclui arquivos `.test.ts`) passa limpo. `npx vitest run` (que não faz checagem de tipo completa) passa com 132/132, incluindo `channelReadState.test.ts`.

## Verification Output

`npx tsc --noEmit -p convex/tsconfig.json`:
```
(sem output — passou limpo)
```

`npm run typecheck` (`typecheck:convex` falha, mas em arquivo de outro plano):
```
> tsc --noEmit -p tsconfig.convex.json

convex/channelReadState.test.ts(169,33): error TS7006: Parameter 'c' implicitly has an 'any' type.
convex/channelReadState.test.ts(170,31): error TS7006: Parameter 'c' implicitly has an 'any' type.
convex/channelReadState.test.ts(173,25): error TS7006: Parameter 'c' implicitly has an 'any' type.
```
(`convex/typing.ts`/`convex/typing.test.ts` não aparecem nos erros — `channelReadState.test.ts` é arquivo não-rastreado do sibling 05-02, não tocado por este plano.)

`npx vitest run`:
```
 Test Files  14 passed (14)
      Tests  132 passed (132)
```

`npx vitest run convex/typing.test.ts`:
```
 ✓ convex/typing.test.ts  (8 tests) 52ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Backend de "digitando" pronto para 05-05 consumir: `api.typing.setTyping` (chamar com throttle client-side de ~2s) e `api.typing.listTyping` (aplicar TTL de exibição ~6s e tick de `setInterval` de 1s no cliente, conforme números já decididos em `05-RESEARCH.md §7`).

**Módulos a registrar (o orquestrador registra `_generated/api.ts` uma vez; testes usam `anyApi`):**
- `convex/typing.ts` → exporta `setTyping` (mutation), `listTyping` (query)

Nenhum bloqueio conhecido. Nenhum arquivo de outro plano foi editado.

---
*Phase: 05-chat-em-tempo-real*
*Completed: 2026-08-19*
