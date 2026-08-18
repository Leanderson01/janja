---
phase: 04-servidores-e-canais
plan: 04
subsystem: database
tags: [convex, presence, authorization, members, tdd]

# Dependency graph
requires:
  - phase: 04-01-schema-e-fundacao-de-servidores
    provides: "convex/lib/membership.ts (requireMembership), tabelas servers/serverMembers/channels"
  - phase: 02-convex-auth-workos (02-06-presenca-heartbeat)
    provides: "tabela presence escrita por presence.ts:heartbeat (lastSeen por userId)"
provides:
  - "convex/members.ts: query listServerMembers(serverId) — lista membros de um servidor com status online/offline derivado de presence"
  - "convex/members.ts: isOnline(lastSeen, now) — função pura exportada para deriva de status a partir de heartbeat, limiar nomeado ONLINE_THRESHOLD_MS = 90_000"
affects: [04-07-renderer-de-servidores-e-membros]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Derivar status de presença em tempo de leitura (nunca campo manual) — mesmo espírito de 02-06, aplicado à listagem de membros"
    - "Limiar de threshold como constante nomeada e comentada, nunca valor mágico inline"

key-files:
  created:
    - convex/members.ts
    - convex/members.test.ts
  modified: []

key-decisions:
  - "ONLINE_THRESHOLD_MS = 90_000 (90s, 2x o intervalo de heartbeat de 45s fixado em 02-RESEARCH.md §7) — folga deliberada contra falso-offline entre heartbeats normais. Já estava especificado no plano; implementado como constante nomeada com comentário no topo de members.ts."
  - "lastSeen no futuro (relógio local adiantado) sempre conta como online — diferença now - lastSeen fica negativa, que é sempre <= threshold. Coberto por teste explícito."
  - "listServerMembers nunca retorna o documento users bruto: apenas userId/username/tag/displayName/avatarUrl/nickname/online — workosId nunca exposto ao client."
  - "Membro de serverMembers sem users correspondente é silenciosamente ignorado (filter fora), não derruba a query inteira — estado impossível no fluxo normal, mas defensivo por spec do plano."

patterns-established:
  - "Junção membro→users→presence: Promise.all por membro dentro de outro Promise.all na lista de memberships — paralelo, sem N+1 sequencial, sempre via índice (by_server_user para memberships, by_user para presence)."

# Metrics
duration: 12min
completed: 2026-08-18
---

# Phase 04 Plan 04: Membros e presença Summary

**Query `listServerMembers` que junta serverMembers + users + presence, deriva online/offline via `isOnline(lastSeen, now)` com limiar nomeado de 90s, e nunca expõe o documento `users` bruto.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-08-18T21:58:00Z
- **Completed:** 2026-08-18T22:00:10Z
- **Tasks:** 1 (TDD: RED → GREEN, sem REFACTOR necessário)
- **Files modified:** 2 (ambos criados)

## Accomplishments
- `isOnline(lastSeen, now)` — função pura exportada, testada isoladamente nos 5 casos do plano (undefined, exatamente no limiar, um ms depois, mesmo instante, relógio adiantado).
- `listServerMembers({ serverId })` — query que exige `requireMembership` (SRV-06), lista via `by_server_user` (prefixo do índice composto, sem full scan), junta `users` e `presence` (via `by_user`) por membro em paralelo, retorna shape público sem `workosId`.
- 9 testes cobrindo: threshold de `isOnline`, rejeição de não-membro, rejeição sem identidade, 3 membros com presença recente/antiga/ausente, isolamento entre dois servidores.

## Task Commits

Nenhum commit foi feito por este agente — instrução explícita `NO_GIT` do orquestrador (múltiplos agentes irmãos editando `convex/` em paralelo; o orquestrador commita em série). Arquivos deixados não staged/uncommitted:
- `convex/members.ts` (novo)
- `convex/members.test.ts` (novo)

## Files Created/Modified
- `convex/members.ts` - `isOnline` (função pura) + `listServerMembers` (query) — único módulo de domínio deste plano.
- `convex/members.test.ts` - 9 testes (`convexTest`, `anyApi`, `import.meta.glob`, mesmo padrão de `servers.test.ts`/`presence.test.ts`).

## Modules to register in api.ts

O orquestrador deve garantir que `convex/members.ts` está incluído na próxima geração/registro de `_generated/api.ts` (não editado por este agente, conforme `file_ownership`). Exports públicos: `listServerMembers` (query). `isOnline` é exportado do módulo mas não é uma function pública do Convex (função pura de TS, sem `query`/`mutation` wrapper) — não aparece em `api.ts`, só é importável diretamente de `./members` (como o teste já faz).

## Decisions Made
- Limiar de 90s implementado como `ONLINE_THRESHOLD_MS` no topo de `members.ts`, com comentário explicando a origem do número (2x os 45s de heartbeat de 02-RESEARCH.md §7) — não é valor mágico inline, satisfaz o hard constraint do prompt.
- `lastSeen` no futuro sempre resulta em `online: true` (diferença negativa <= threshold) — comportamento correto e testado, evita marcar erroneamente como offline por causa de relógio local adiantado.
- Nenhuma tabela/índice novo foi necessário: `by_server_user` (prefixo `serverId`) e `by_user` (presence) já existiam em `schema.ts` desde 04-01/Fase 2, então `listServerMembers` nunca faz full scan.

## Deviations from Plan

None - plan executado exatamente como escrito. O único ajuste foi na assertividade dos testes: `avatarUrl`/`nickname` (campos `v.optional`) são omitidos pelo Convex quando `undefined` na serialização de retorno da query — o teste original assumia `toHaveProperty` incondicional, ajustado para checar tipo apenas quando a chave está presente. Isso não é uma mudança de comportamento do código de produção, só uma correção da asserção do teste durante o próprio ciclo RED→GREEN (antes de qualquer commit).

## Issues Encountered
- `npm run typecheck` inicialmente reportou erro em `convex/channels.test.ts` (arquivo de outro agente irmão, plano 04-03) e um erro real em `convex/members.test.ts` (inferência de tipo do `Map` construído a partir do array de `members`, que é `any` por vir de `anyApi`). Corrigi apenas o erro no meu próprio arquivo (`members.test.ts`, tipagem explícita do `Map<Id<'users'>, MemberRow>`); o erro em `channels.test.ts` não foi tocado (não é meu arquivo) e desapareceu numa checagem seguinte, presumivelmente corrigido em paralelo pelo agente 04-03.

## User Setup Required
None - nenhuma configuração de serviço externo.

## Next Phase Readiness
- `listServerMembers` está pronta para o plano 04-07 (renderer de servidores e membros) consumir: shape estável `{ userId, username, tag, displayName, avatarUrl, nickname, online }`.
- Depende de `convex/lib/membership.ts` (04-01, já existente) e `convex/presence.ts` (Fase 2, não modificado) — nenhuma mudança de contrato nessas dependências.
- Nenhum bloqueio conhecido. O único ponto de atenção para o orquestrador: registrar `members` em `_generated/api.ts` junto com os módulos dos agentes irmãos (invites, channels) ao final da wave.

---
*Phase: 04-servidores-e-canais*
*Completed: 2026-08-18*
