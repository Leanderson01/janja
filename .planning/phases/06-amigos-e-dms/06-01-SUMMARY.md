---
phase: 06-amigos-e-dms
plan: 01
subsystem: database
tags: [convex, schema, indexes, friends, dm, users]

# Dependency graph
requires:
  - phase: 02-autenticacao
    provides: "convex/users.ts com ensureUser e índice users.by_username_tag já publicado, convex-test já configurado (import.meta.glob + anyApi)"
  - phase: 04-servidores-e-canais
    provides: "convex/schema.ts com users, presence, servers, serverMembers, invites, channels já publicados"
provides:
  - "5 tabelas novas no schema: friendRequests, friendships, dmChannels, dmMembers, dmMessages, com os índices exatos decididos em 06-RESEARCH.md §8"
  - "Query pública users.findUserByUsernameTag(username, tag) — resolve USER#123 por índice, nunca varredura, nunca vaza workosId"
affects: [06-amigos-e-dms plans 06-02 a 06-05, qualquer UI de amigos/DM]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Par canônico (userA < userB) em friendships para tornar 'somos amigos?' um lookup de ponto único, calculado sempre no servidor"
    - "friendRequests sem campo status — existência do documento é o estado 'pendente'"
    - "dmMembers como join table (não array) para permitir listar DMs de um usuário via índice"

key-files:
  created: []
  modified:
    - convex/schema.ts
    - convex/users.ts
    - convex/users.test.ts

key-decisions:
  - "Schema NÃO foi republicado via `npx convex dev --once` nesta execução: (a) não há .env.local/CONVEX_DEPLOYMENT configurado no ambiente (só .env.local.example existe — dependência pendente do checkpoint 02-04), e (b) o prompt de execução proíbe explicitamente rodar `npx convex dev` neste agente. As 5 tabelas e a nova query estão escritas, testadas (convex-test) e passam `tsc --noEmit -p convex/tsconfig.json`; publicação real fica para quando o deployment estiver configurado."
  - "convex/_generated/api.ts não foi tocado, conforme instrução de ownership — permanece desatualizado até a orquestração rodar a geração/publicação centralizada."

patterns-established: []

# Metrics
duration: ~15min
completed: 2026-08-18
---

# Phase 06 Plan 01: Schema de Amigos/DMs + Busca por Tag Summary

**5 tabelas novas (friendRequests, friendships, dmChannels, dmMembers, dmMessages) adicionadas a convex/schema.ts com os índices exatos do research, e query pública `findUserByUsernameTag` em convex/users.ts resolvendo `USER#123` por índice, testada via TDD (convex-test).**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2/2 completed
- **Files modified:** 3

## Accomplishments

- Schema estendido com `friendRequests`, `friendships`, `dmChannels`, `dmMembers`, `dmMessages` — campos e índices copiados exatamente de `06-RESEARCH.md §8` (nenhum índice adicionado ou removido).
- `users.findUserByUsernameTag` implementada seguindo TDD: 3 testes RED (função inexistente) → GREEN (query via `withIndex('by_username_tag', ...)`, nunca `.filter()`).
- Query nunca retorna `workosId` — projeta explicitamente `{_id, username, tag, displayName, avatarUrl}`.
- `ensureUser` e `convex/lib/tag.ts` não foram tocados, conforme restrição do plano.

## Task Commits

**NÃO COMMITADO POR ESTE AGENTE.** Conforme instrução explícita do orquestrador (`<NO_GIT>`), nenhum comando git foi executado — os 3 arquivos modificados permanecem no working tree para o orquestrador commitar em série:

- `convex/schema.ts` (Task 1: 5 tabelas novas)
- `convex/users.ts` (Task 2: GREEN — `findUserByUsernameTag`)
- `convex/users.test.ts` (Task 2: RED — 3 casos de teste)

`git status --short` no momento da entrega:
```
 M convex/schema.ts
 M convex/users.test.ts
 M convex/users.ts
```

## Files Created/Modified

- `convex/schema.ts` — adicionadas as 5 tabelas de Fase 6 (bloco "--- Fase 6: amigos e DMs ---"), tabelas `users`/`presence` e as de Fase 4 (`servers`, `serverMembers`, `invites`, `channels`) inalteradas.
- `convex/users.ts` — adicionado `export const findUserByUsernameTag = query({...})` ao final do arquivo; `ensureUser`/`baseUsernameFromEmail` inalterados; import de `query` e `v` adicionados ao topo.
- `convex/users.test.ts` — adicionado `describe('users.findUserByUsernameTag', ...)` com 3 casos (existe, não existe, tag não bate); suíte existente de `ensureUser` inalterada.

## Módulos a registrar em `convex/_generated/api.ts` (orquestrador)

Nenhum módulo novo — tudo entrou em `convex/users.ts`, que já é exportado no `api.ts` atual (com `ensureUser`). Quando o orquestrador rodar a geração/publicação centralizada, `api.users.findUserByUsernameTag` passará a existir automaticamente junto dos demais exports desse arquivo. Nenhuma ação extra de registro é necessária além de regenerar `_generated/` a partir do schema/código atualizados.

## Decisions Made

- **Publicação do schema (`npx convex dev --once`) foi pulada, não é um bloqueio funcional deste plano.** Dois motivos independentes, ambos verificados: (1) não existe `.env.local` no ambiente — só `.env.local.example`, confirmando a dependência não satisfeita do checkpoint 02-04 já antecipada no próprio plano; (2) o prompt de execução deste agente proíbe explicitamente `npx convex dev`/`login`/`codegen`, e a orquestração afirma possuir/gerenciar `convex/_generated/api.ts` centralmente. Código e testes estão prontos para quando a publicação acontecer.
- Mantido exatamente o conjunto de índices do research (2 por `friendRequests`, 2 por `friendships`, 0 por `dmChannels`, 2 por `dmMembers`, 1 por `dmMessages`) — nenhum índice extra nem removido.
- `findUserByUsernameTag` implementada como `query` pública (sem checagem de autenticação) — decisão já registrada no plano/research: qualquer usuário logado pode procurar outro por `USER#123`, essa é a própria finalidade de SOCIAL-01. Não vaza `workosId`.

## Deviations from Plan

None — plano executado exatamente como escrito, com uma exceção documentada e esperada pelo próprio plano: a etapa de `npx convex dev --once` (publicação real no deployment) não foi executada, pelos dois motivos acima (credenciais ausentes + restrição explícita do prompt de execução). O próprio texto do plano já previa esse cenário ("Se o comando falhar por falta de credenciais... não é um bug deste plano... parar e reportar como bloqueio no SUMMARY").

## Issues Encountered

- Nenhum na lógica/testes. Único ponto de atenção: schema e query ainda não estão no deployment Convex real — `convex/_generated/api.ts` no disco continua o mesmo de antes (gerado por uma execução anterior de `npx convex dev`, não atualizado por este plano). Isso é esperado dado o `<file_ownership>` deste plano (não editar `_generated/api.ts`) e será resolvido pela orquestração quando ela rodar a publicação centralizada após os planos paralelos de Fase 4/6 terminarem.

## Verification Output (actual)

```
$ npx tsc --noEmit -p convex/tsconfig.json
(sem output — 0 erros)

$ npm run typecheck
> typecheck:node — tsc --noEmit -p tsconfig.node.json --composite false   (0 erros)
> typecheck:web  — tsc --noEmit -p tsconfig.web.json --composite false    (0 erros)
> typecheck:convex — tsc --noEmit -p tsconfig.convex.json                 (0 erros)

$ npx vitest run
 ✓ convex/users.test.ts      (7 tests) 28ms
 ✓ convex/servers.test.ts    (9 tests) 43ms
 ✓ convex/members.test.ts    (9 tests) 34ms
 ✓ convex/channels.test.ts   (10 tests) 60ms
 ✓ convex/invites.test.ts    (13 tests) 79ms
 ✓ convex/lib/tag.test.ts    (5 tests) 11ms
 ✓ convex/lib/inviteCode.test.ts (6 tests) 16ms
 ✓ convex/presence.test.ts   (3 tests) 22ms

 Test Files  8 passed (8)
      Tests  62 passed (62)

$ grep -n "by_pair" convex/schema.ts
68:    .index('by_pair', ['userA', 'userB'])

$ grep -n "by_from_to\|by_channel_user\|by_dm_channel" convex/schema.ts
60:    .index('by_from_to', ['fromUserId', 'toUserId'])
80:    .index('by_channel_user', ['dmChannelId', 'userId']),
87:  }).index('by_dm_channel', ['dmChannelId']),
```

Os 8 arquivos de teste passaram, incluindo os das três agentes-irmãs (`servers.test.ts`,
`members.test.ts`, `channels.test.ts`, `invites.test.ts`) que editam `convex/` em
paralelo — nenhuma quebra cruzada observada no momento desta verificação.

## User Setup Required

**Publicação do schema no deployment Convex fica pendente até `.env.local` (com
`VITE_CONVEX_URL`/`CONVEX_DEPLOYMENT`) existir** — dependência do checkpoint humano
02-04 da Fase 2, não deste plano. Quando configurado, rodar `npx convex dev --once`
(ou `npx convex dev`) publicará as 5 tabelas novas e regenerará `convex/_generated/`
automaticamente.

## Next Phase Readiness

- Fundação de dados de Fase 6 pronta em código e testada: `friendRequests`,
  `friendships`, `dmChannels`, `dmMembers`, `dmMessages` com os índices corretos;
  `findUserByUsernameTag` pronta para os planos 06-02 a 06-05 consumirem.
- Bloqueio real (não deste plano): schema ainda não publicado no deployment Convex
  vivo — planos subsequentes que dependam de `npx convex dev` rodando com sucesso
  herdam a mesma dependência não satisfeita do checkpoint 02-04.
- `convex/_generated/api.ts` continua desatualizado (sem as novas tabelas/query) até
  a orquestração rodar a geração central — esperado, por design de ownership deste
  plano.

---
*Phase: 06-amigos-e-dms*
*Completed: 2026-08-18*
