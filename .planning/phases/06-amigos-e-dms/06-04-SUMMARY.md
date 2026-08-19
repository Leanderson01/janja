---
phase: 06-amigos-e-dms
plan: 04
subsystem: database
tags: [convex, convex-test, dm, mensagens, autorização, tdd]

# Dependency graph
requires:
  - phase: 06-01
    provides: "Tabelas friendRequests, friendships, dmChannels, dmMembers, dmMessages no schema"
provides:
  - "getOrCreateDmChannel — mutation idempotente que resolve/cria o canal de DM entre dois amigos"
  - "sendDmMessage — mutation que envia mensagem restrita a membros do canal"
  - "assertDmMember (interno, não exportado) — helper de autorização reutilizável pelo plano 06-05 (leitura/paginação de mensagens)"
affects: [06-05, 06-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getCallerUser local ao arquivo (não importado de convex/lib/membership.ts nem de convex/friends.ts) — resolve identidade autenticada para Doc<'users'>, nunca aceita workosId do cliente"
    - "Par canônico (userA < userB) calculado no servidor antes de qualquer leitura em friendships.by_pair — nunca confia em ordem vinda do cliente"
    - "Deduplicação de canal de DM via join table (dmMembers), nunca array: lista dmMembers do chamador por by_user (índice), e para cada candidato faz lookup pontual em by_channel_user — nunca scan de dmChannels"

key-files:
  created:
    - convex/dms.ts
    - convex/dms.test.ts
  modified: []

key-decisions:
  - "assertDmMember foi extraída como função interna não-exportada em convex/dms.ts (não em convex/lib/membership.ts) — plano 06-05 (leitura/paginação) vai importá-la de convex/dms.ts, conforme instruído no plano"
  - "Testes inserem friendships diretamente via t.run em ordem canônica, sem depender de convex/friends.ts (módulo do plano 06-02, arquivo irmão) — mantém os dois arquivos de teste independentes"

patterns-established:
  - "sendDmMessage/getOrCreateDmChannel: autorização (amizade ou membership) verificada antes de qualquer leitura/escrita substantiva, mesmo padrão de requireMembership em convex/lib/membership.ts"

# Metrics
duration: ~15min
completed: 2026-08-18
---

# Phase 06 Plan 04: Canal e Mensagens de DM Summary

**`convex/dms.ts` com `getOrCreateDmChannel` (idempotente, restrito a amigos) e `sendDmMessage` (restrito a membros do canal), cobertos por 10 testes `convex-test` incluindo os dois casos centrais do hard constraint (dedup de canal e bloqueio de não-membro).**

## Performance

- **Duration:** ~15 min
- **Tasks:** 1 (feature TDD única: RED → GREEN, sem REFACTOR necessário)
- **Files created:** 2

## Accomplishments

- `getOrCreateDmChannel({ friendUserId })`: verifica amizade via `friendships.by_pair`
  (par canônico), depois procura canal existente varrendo `dmMembers` do chamador
  via `by_user` (índice) e checando cada candidato pontualmente em
  `by_channel_user` — se não encontrar, cria `dmChannels` + 2 `dmMembers`.
  Comprovadamente idempotente e simétrico (não importa quem chama primeiro).
- `sendDmMessage({ dmChannelId, content })`: `assertDmMember` primeiro (lança se
  não-membro), valida `content.trim()` não-vazio, insere `dmMessages`.
- `assertDmMember(ctx, dmChannelId, userId)` extraída como helper interno não
  exportado, pronta para ser importada pelo plano 06-05 (query paginada de
  mensagens).
- 10 testes `convex-test` cobrindo: rejeição sem identidade, rejeição de par
  não-amigo (nenhum canal criado), criação exata de 1 canal + 2 membros na
  primeira chamada, idempotência (mesma chamada 2x → mesmo id, sem documentos
  extras), simetria (o outro lado do par encontra o mesmo canal), envio válido
  por ambos os membros, rejeição de não-membro (mensagens continuam vazias),
  rejeição de conteúdo vazio/só espaços.

## Task Commits

**Nenhum commit foi feito** — a orquestração explicitamente instruiu esta
execução a não rodar nenhum comando git (dois agentes irmãos, 06-02 e 04-05,
estão editando `convex/` e `src/renderer/` em paralelo). Arquivos permanecem
não-staged (`git status` mostra `convex/dms.ts` e `convex/dms.test.ts` como
`??`, não rastreados). O orquestrador deve commitar/registrar estes arquivos
quando integrar os planos da fase.

## Files Created/Modified

- `convex/dms.ts` - `getOrCreateDmChannel` e `sendDmMessage`, com `getCallerUser`
  e `assertDmMember` internos (não exportados)
- `convex/dms.test.ts` - 10 testes `convex-test` cobrindo autorização de
  amizade, idempotência/simetria da criação de canal, autorização de
  membership e validação de conteúdo

## Módulos a registrar em `convex/_generated/api.ts`

O orquestrador (dono do `codegen`) precisa garantir que `dms` apareça no `api`
gerado, expondo:

- `api.dms.getOrCreateDmChannel` (mutation)
- `api.dms.sendDmMessage` (mutation)

Os testes usam `anyApi.dms.<nome>` (padrão já em uso no repo, não depende do
`api` gerado estar atualizado).

## Decisões Feitas

- **`assertDmMember` vive em `convex/dms.ts`, não em `convex/lib/membership.ts`**:
  o plano pediu explicitamente para extrair como função interna deste arquivo,
  reutilizável pelo plano 06-05 via import de `convex/dms.ts` — não é um helper
  genérico de servidor/canal como `requireMembership`, é específico de DM.
- **Testes não importam de `convex/friends.ts`**: amizades são inseridas
  diretamente via `t.run(ctx => ctx.db.insert('friendships', ...))` em ordem
  canônica, exatamente como o plano instruiu, para manter `dms.test.ts`
  independente do arquivo irmão do plano 06-02 (que estava em execução
  paralela e cujo conteúdo eu não deveria editar/depender).
- **Sem REFACTOR separado**: o GREEN já saiu com `getCallerUser`/`assertDmMember`
  extraídos como funções internas — não havia duplicação a limpar depois.

## Deviations from Plan

None - plano executado exatamente como escrito. Nenhuma das quatro regras de
desvio (bug, funcionalidade crítica faltando, bloqueio, mudança arquitetural)
se aplicou.

## Issues Encountered

Nenhum. `npx tsc --noEmit -p convex/tsconfig.json` limpo. `npm run typecheck`
reporta 4 erros pré-existentes em `src/renderer/src/components/shell/
ChannelSidebar.tsx` e `ServerRail.tsx` (tipos `string` vs `Id<"channels">`/
`Id<"servers">`) — arquivos que não toquei, pertencentes ao plano irmão 04-05
em execução concorrente sobre `src/renderer/`; não são causados por
`convex/dms.ts`. `npx vitest run` (suíte completa, 10 arquivos) passa 100%: 86
testes, incluindo os 14 de `convex/friends.test.ts` (plano irmão 06-02, já
presente no disco) e os 10 novos de `convex/dms.test.ts`.

### Saída real dos testes

```
$ npx vitest run convex/dms.test.ts
 ✓ convex/dms.test.ts  (10 tests) 44ms
 Test Files  1 passed (1)
      Tests  10 passed (10)

$ npx tsc --noEmit -p convex/tsconfig.json
(sem output — limpo)

$ npm run typecheck
typecheck:node -> OK
typecheck:web  -> 4 erros em src/renderer/src/components/shell/
                   ChannelSidebar.tsx e ServerRail.tsx (não relacionados a
                   este plano — arquivos do plano irmão 04-05)
typecheck:convex -> (não alcançado por causa da falha acima em typecheck:web,
                      mas rodado isoladamente com sucesso, ver acima)

$ npx vitest run
 ✓ convex/friends.test.ts  (14 tests) 45ms
 ✓ convex/dms.test.ts  (10 tests) 48ms
 ✓ convex/members.test.ts  (9 tests) 34ms
 ✓ convex/channels.test.ts  (10 tests) 73ms
 ✓ convex/invites.test.ts  (13 tests) 100ms
 ✓ convex/lib/inviteCode.test.ts  (6 tests) 29ms
 ✓ convex/servers.test.ts  (9 tests) 43ms
 ✓ convex/lib/tag.test.ts  (5 tests) 13ms
 ✓ convex/presence.test.ts  (3 tests) 33ms
 ✓ convex/users.test.ts  (7 tests) 32ms
 Test Files  10 passed (10)
      Tests  86 passed (86)
```

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plano 06-05 (leitura/paginação de mensagens de DM) pode importar
  `assertDmMember` de `convex/dms.ts` para checar membership antes de paginar
  `dmMessages` via `by_dm_channel` (conforme 06-RESEARCH.md §3-4).
- `getOrCreateDmChannel`/`sendDmMessage` estão prontos para uso da UI de DM
  (plano 04-05/06-06, fora do escopo deste plano) assim que o `api` gerado
  incluir `dms`.
- Nenhum bloqueio conhecido. O único ponto de atenção é a integração de
  commits/`codegen`: `convex/dms.ts`/`convex/dms.test.ts` estão no disco mas
  não commitados, por instrução explícita da orquestração desta execução.

---
*Phase: 06-amigos-e-dms*
*Completed: 2026-08-18*
