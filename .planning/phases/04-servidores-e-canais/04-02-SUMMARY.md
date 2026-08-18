---
phase: 04-servidores-e-canais
plan: 02
subsystem: api
tags: [convex, tdd, invites, authorization, uniqueness-retry]

# Dependency graph
requires:
  - phase: 04-servidores-e-canais (plano 04-01)
    provides: "convex/lib/membership.ts (requireIdentity/requireMembership/requireOwnership), tabelas servers/serverMembers/invites/channels em convex/schema.ts"
provides:
  - "convex/lib/inviteCode.ts: generateInviteCode() pura + findAvailableInviteCode() com retry testável (mesmo padrão de convex/lib/tag.ts)"
  - "convex/invites.ts: generateInvite (idempotente, dono), revokeInvite (dono, no-op silencioso se não houver convite ativo), joinByCode (autenticado, idempotente), getActiveInvite (membro)"
affects: ["04-06 (UI de convite consome estas 4 functions)", "qualquer fase futura que precise entrar em servidor por código"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Retry de unicidade sem constraint nativa: findAvailableInviteCode(existsFn, generateCode?, maxAttempts?) — mesmo padrão de findAvailableTag (plano 02-05), lança erro explícito ao esgotar tentativas em vez de retornar candidato não confirmado"
    - "Convite único e revogável por servidor: no máximo um invite com revoked:false por serverId, garantido por generateInvite ser idempotente (retorna o código existente em vez de criar um segundo)"

key-files:
  created:
    - convex/lib/inviteCode.ts
    - convex/lib/inviteCode.test.ts
    - convex/invites.ts
    - convex/invites.test.ts
  modified: []

key-decisions:
  - "Alfabeto do código de convite segue literalmente o alfabeto/regex do plano (ABCDEFGHJKLMNPQRSTUVWXYZ23456789 / /^[A-HJ-NP-Z2-9]{8}$/), que exclui 0/O e 1/I mas mantém L — a prosa do plano ('sem 0/O, 1/I/L') era imprecisa; o teste de caracteres banidos foi ajustado para /[01IO]/ (sem L) para bater com o artefato concreto (alfabeto + regex), não com a prosa"
  - "Busca do convite ativo de um servidor usa withIndex('by_server', ...).filter(revoked === false).unique() — narrado pelo índice by_server antes do filtro em memória, nunca um table scan; .unique() reforça a invariante de 'no máximo um ativo' lançando alto se for violada"
  - "revokeInvite é no-op silencioso (retorna null) quando não há convite ativo, não lança erro — UI pode chamar sem checar estado antes"

patterns-established:
  - "findAvailableInviteCode: mesma forma de findAvailableTag (existsFn injetado, generateCode injetável, maxAttempts configurável) para qualquer futura necessidade de 'gerar código único sem constraint nativa'"

# Metrics
duration: ~15min
completed: 2026-08-18
---

# Phase 04 Plan 02: Convites de servidor Summary

**Convite de servidor via código de 8 caracteres implementado com TDD: gerar (idempotente, só dono), revogar (só dono, no-op se já não houver ativo, nunca remove membros existentes) e entrar por código (autenticado, idempotente) — toda autorização delegada a `convex/lib/membership.ts`, unicidade do código garantida por retry contra o índice `by_code`.**

## Performance

- **Duration:** ~15 min
- **Tasks:** RED → GREEN (código e testes escritos diretamente já corretos após um único ajuste de teste; ver Deviations) → verificação
- **Files modified:** 4 (todos criados, nenhum arquivo existente tocado)

## Accomplishments

- `convex/lib/inviteCode.ts`: `generateInviteCode()` (função pura, 8 caracteres, alfabeto sem ambiguidade visual) e `findAvailableInviteCode()` (retry testável, mesmo padrão de `findAvailableTag`).
- `convex/invites.ts`: `generateInvite`, `revokeInvite`, `joinByCode`, `getActiveInvite` — todas as checagens de autorização vêm de `convex/lib/membership.ts` (`requireIdentity`/`requireMembership`/`requireOwnership`), nenhuma lógica de autorização reimplementada.
- 19 testes novos (6 em `inviteCode.test.ts`, 13 em `invites.test.ts`) cobrindo: geração de código válida (1000 iterações contra a regex do plano), retry de colisão (candidato repetido, esgotamento de tentativas, `maxAttempts` customizado), autorização dono vs. membro vs. não-membro nas 4 functions, idempotência de `generateInvite` e `joinByCode`, e o caso central — revogar não remove `serverMembers` de quem já entrou, mas bloqueia novos ingressos com o código antigo.
- Suite completa do repositório (`npx vitest run`) permanece verde: 59 testes em 8 arquivos, incluindo os módulos dos agentes-irmãos (`channels.ts`/`channels.test.ts`, `members.ts`/`members.test.ts`) já presentes no working tree no momento da verificação.

## Files Created/Modified

- `convex/lib/inviteCode.ts` — `generateInviteCode()` pura + `findAvailableInviteCode()` com retry testável (export: `generateInviteCode`, `findAvailableInviteCode`, `INVITE_CODE_DEFAULT_MAX_ATTEMPTS`).
- `convex/lib/inviteCode.test.ts` — 6 testes (formato do código, ausência de caracteres banidos, retry: primeiro candidato livre, colisão-depois-livre, esgotamento de `maxAttempts` padrão e customizado).
- `convex/invites.ts` — `generateInvite`, `revokeInvite`, `joinByCode`, `getActiveInvite` (mutations/query Convex).
- `convex/invites.test.ts` — 13 testes cobrindo autorização (dono/membro/não-membro/não-autenticado), idempotência, e a invariante de revogação não remover membros existentes.

## Modules to register in `_generated/api.ts`

Este agente **não editou** `convex/_generated/api.ts` (propriedade do orquestrador, conforme instrução). O módulo novo a registrar:

- `invites` → expõe `generateInvite`, `revokeInvite`, `joinByCode`, `getActiveInvite`

(`convex/lib/inviteCode.ts` não é uma function pública do Convex — é um helper interno importado por `invites.ts`, não precisa de entrada em `api.ts`.)

## Decisions Made

- Alfabeto e regex do código de convite seguidos literalmente do plano (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, `/^[A-HJ-NP-Z2-9]{8}$/`) — este alfabeto exclui `0`/`O` e `1`/`I`, mas **mantém `L`** (a prosa do plano dizia "sem 0/O, 1/I/L", que contradiz o próprio alfabeto/regex fornecidos ali mesmo). Priorizei os artefatos concretos e verificáveis (string do alfabeto + regex de teste) sobre a prosa, e ajustei meu teste extra de "caracteres banidos" para `/[01IO]/` (sem `L`) para não conflitar com o alfabeto real.
- Lookup do convite ativo usa `.withIndex('by_server', ...).filter(q => q.eq(q.field('revoked'), false)).unique()` em vez de `.collect()` + `.find()` — mantém o escopo pelo índice (nunca varre `invites` inteira) e usa `.unique()` para lançar alto caso a invariante "no máximo um convite ativo por servidor" seja violada, em vez de mascarar silenciosamente com o primeiro resultado.
- `revokeInvite` retorna `null` tanto no caso de sucesso quanto no no-op (sem convite ativo) — comportamento idêntico do ponto de vista do chamador, sem exigir que a UI verifique estado antes de chamar.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Teste próprio com regex de caracteres banidos incorreta**

- **Found during:** primeira rodada de `npx vitest run convex/lib/inviteCode.test.ts convex/invites.test.ts`
- **Issue:** escrevi um teste adicional (não pedido explicitamente pelo plano, mas natural de se adicionar) que checava `code` contra `/[01IOL]/` — banindo `L`, que na verdade está presente no alfabeto real do plano (`...HJKLMN...`). O teste falhava contra a implementação correta.
- **Fix:** corrigido o teste para `/[01IO]/` (sem `L`), consistente com o alfabeto e a regex `/^[A-HJ-NP-Z2-9]{8}$/` fornecidos textualmente no plano. Nenhuma mudança em `convex/lib/inviteCode.ts` foi necessária — a implementação já seguia o alfabeto correto desde o início.
- **Files modified:** `convex/lib/inviteCode.test.ts`
- **Verification:** `npx vitest run convex/lib/inviteCode.test.ts convex/invites.test.ts` — 19/19 testes passando.

Nenhum outro desvio. Nenhuma mudança arquitetural, nenhum gate de autenticação.

## Verification Results

- `npx tsc --noEmit -p convex/tsconfig.json` — sem erros.
- `npm run typecheck` (node + web + convex) — sem erros.
- `npx vitest run convex/lib/inviteCode.test.ts convex/invites.test.ts` — **19 passed** (6 + 13).
- `npx vitest run` (suite completa do repo, incluindo arquivos dos agentes-irmãos já presentes) — **59 passed** em 8 arquivos:
  ```
  ✓ convex/users.test.ts        (4 tests)
  ✓ convex/servers.test.ts      (9 tests)
  ✓ convex/channels.test.ts     (10 tests)
  ✓ convex/members.test.ts      (9 tests)
  ✓ convex/invites.test.ts      (13 tests)
  ✓ convex/lib/inviteCode.test.ts (6 tests)
  ✓ convex/lib/tag.test.ts      (5 tests)
  ✓ convex/presence.test.ts     (3 tests)

  Test Files  8 passed (8)
       Tests  59 passed (59)
  ```

## Next Phase Readiness

- SRV-02, SRV-03, SRV-04 satisfeitos no nível de dados: gerar, revogar e entrar por código funcionam ponta a ponta, com autorização dono/membro/não-membro coberta por teste automatizado.
- Nenhum bloqueio conhecido para o plano 04-06 (UI de convite), que pode importar `generateInvite`, `revokeInvite`, `joinByCode`, `getActiveInvite` assim que `_generated/api.ts` for atualizado pelo orquestrador.
- `convex/schema.ts` está sendo modificado concorrentemente por outro agente-irmão (06-01, tabelas de amigos/DM) — confirmado via `git diff` que nenhuma dessas mudanças vieram deste plano; não afeta `invites`/`servers`/`serverMembers`/`channels`.
