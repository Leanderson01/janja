---
phase: 06-amigos-e-dms
plan: 02
subsystem: database
tags: [convex, mutations, friends, authorization, tdd, convex-test]

# Dependency graph
requires:
  - phase: 06-amigos-e-dms (plan 01)
    provides: "friendRequests/friendships em convex/schema.ts com índices by_from_to/by_to/by_pair/by_userB, e users.findUserByUsernameTag como referência de padrão de índice"
provides:
  - "convex/friends.ts: mutations sendFriendRequest, acceptFriendRequest, rejectFriendRequest — ciclo de vida completo do pedido de amizade (SOCIAL-02, SOCIAL-03)"
  - "getCallerUser(ctx) e canonicalPair(a, b) — helpers internos de convex/friends.ts, não exportados, reaproveitáveis como referência de padrão para 06-03/06-04"
affects: [06-03 (lista e remoção de amigos, reaproveita canonicalPair/by_pair), 06-06 (UI do painel de amigos consome estas 3 mutations)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getCallerUser(ctx): resolve o usuário chamador uma vez no início do handler via by_workos_id, nunca aceita userId de argumento — mesmo padrão de ensureUser/heartbeat, agora replicado em friends.ts"
    - "canonicalPair(a, b): comparação lexicográfica de Id<'users'> como string para ordem determinística userA < userB, independente de quem enviou/aceitou"
    - "friendRequests sem status: existência do documento = pendente; accept insere friendships + deleta o pedido na mesma mutation (atômico); reject só deleta"
    - "Autorização por comparação direta (request.toUserId === caller._id) antes de qualquer mutação, com teste RED dedicado ao terceiro usuário e ao auto-aceite do remetente"

key-files:
  created:
    - convex/friends.ts
    - convex/friends.test.ts
  modified: []

key-decisions:
  - "assertIsRecipient lança o mesmo erro genérico para terceiro-usuário e para auto-aceite do remetente ('Só o destinatário do pedido pode responder a ele') — não há necessidade de diferenciar as duas causas no nível de mensagem, ambas são a mesma regra de autorização (toUserId === caller._id)."
  - "Erros de sendFriendRequest usam mensagens distintas e específicas por caso (usuário não encontrado / auto-adição / já amigos / pedido já enviado / pedido reverso pendente) porque a UI (06-06) precisa diferenciar esses casos para o usuário, ao contrário da autorização de accept/reject que é uma checagem binária."
  - "acceptFriendRequest insere friendships e deleta o friendRequests na mesma mutation, sem etapa intermediária — Convex garante atomicidade da mutation inteira, então não há janela onde ambos existem ou nenhum existe."

patterns-established:
  - "Toda nova mutation de autorização neste domínio (06-03, 06-04) deve seguir getCallerUser + comparação direta de campo, testada com o trio: dono age (sucesso), terceiro tenta agir (rejects.toThrow + estado inalterado verificado via t.run), self-action inválida se aplicável (rejects.toThrow)."

# Metrics
duration: ~20min
completed: 2026-08-18
---

# Phase 06 Plan 02: Pedidos de Amizade Summary

**Três mutations TDD (sendFriendRequest, acceptFriendRequest, rejectFriendRequest) em convex/friends.ts, com autorização "só o destinatário aceita/recusa" coberta por teste que confirma que um terceiro usuário não consegue mutar friendRequests/friendships alheios, e friendships sempre em ordem canônica userA < userB independente do fluxo.**

## Performance

- **Duration:** ~20 min
- **Tasks:** RED → GREEN → REFACTOR (ciclo único, TDD)
- **Files created:** 2

## Accomplishments

- `sendFriendRequest({ username, tag })`: resolve o alvo pelo mesmo índice `by_username_tag` (consultado inline, sem `ctx.runQuery`), rejeita alvo inexistente, auto-adição, par já amigo, pedido duplicado na mesma direção, e — caso especial — pedido já existente na direção reversa (orienta a aceitar em vez de duplicar).
- `acceptFriendRequest({ requestId })`: rejeita id inexistente; **autorização crítica testada e comprovada** — terceiro usuário (nem remetente nem destinatário) que tenta aceitar é rejeitado e nem `friendships` é criada nem `friendRequests` é apagado (confirmado via `t.run` inspecionando o estado após a tentativa); o próprio remetente também não pode auto-aceitar; caminho feliz insere `friendships` em ordem canônica e deleta o pedido, atomicamente na mesma mutation.
- `rejectFriendRequest({ requestId })`: mesma checagem de autorização espelhada (terceiro rejeitado, estado inalterado); caminho feliz apenas deleta o pedido, sem criar `friendships`.
- Teste dedicado de ordem canônica: dois cenários com os mesmos dois usuários (A envia→B aceita; depois B envia→A aceita) confirmando que `userA`/`userB` batem pela ordem lexicográfica dos ids, nunca pela ordem do fluxo de quem enviou/aceitou.
- `getCallerUser` e `canonicalPair` extraídos como funções internas de `convex/friends.ts` (não exportadas, não movidas para `convex/lib/` — específicas deste arquivo, conforme o plano).

## Task Commits

**NÃO COMMITADO POR ESTE AGENTE.** Conforme instrução explícita do orquestrador (`<NO_GIT>` — dois agentes irmãos rodando em paralelo em `convex/dms.ts`/`src/renderer/`), nenhum comando git foi executado. Os 2 arquivos criados permanecem untracked no working tree para o orquestrador processar:

- `convex/friends.ts` (novo)
- `convex/friends.test.ts` (novo)

`git status --short` no momento da entrega (mostrando também trabalho concorrente de outros agentes, não meu):
```
 M src/renderer/src/components/shell/ServerRail.tsx
 M src/renderer/src/state/selection-context.tsx
?? convex/dms.test.ts
?? convex/dms.ts
?? convex/friends.test.ts
?? convex/friends.ts
?? src/renderer/src/components/shell/CreateOrJoinServerDialog.tsx
?? src/renderer/src/components/ui/dialog.tsx
?? src/renderer/src/components/ui/input.tsx
```

## Módulo a registrar em `convex/_generated/api.ts`

`convex/friends.ts`, exportando as mutations `sendFriendRequest`, `acceptFriendRequest`, `rejectFriendRequest`. Os testes usam `anyApi.friends.<nome>` (via `import.meta.glob`), então nenhuma regeneração foi necessária para este plano rodar — mas o cliente (React, plano 06-06) precisará de `api.friends.sendFriendRequest` etc. depois que `npx convex dev`/codegen rodar centralmente.

## Files Created/Modified

- `convex/friends.ts` — 3 mutations exportadas + `getCallerUser`/`canonicalPair`/`assertIsRecipient` internos (não exportados). Não toca em `convex/schema.ts`, `convex/users.ts` nem `convex/_generated/api.ts`, conforme ownership do plano.
- `convex/friends.test.ts` — 14 casos de teste (`describe` por mutation), usando `convexTest(schema, modules)` com `import.meta.glob('./**/*.ts')`, `anyApi.friends.*`, `t.withIdentity({ subject })` e seed via `t.run(ctx => ctx.db.insert('users', ...))` — mesmo padrão de `convex/servers.test.ts`/`convex/users.test.ts`.

## Decisions Made

Ver `key-decisions` no frontmatter. Resumo: mensagens de erro específicas por caso em `sendFriendRequest` (a UI precisa diferenciá-las), mensagem genérica única para toda violação de autorização em accept/reject (é a mesma regra), e accept é uma mutation atômica única (insere `friendships` + deleta `friendRequests`, sem etapa intermediária).

## Deviations from Plan

None - plan executado exatamente como escrito. RED (14 testes, todos falhando por `Could not find module for: "friends"`) → GREEN (14/14 passando) → REFACTOR: `getCallerUser`/`canonicalPair` já saíram extraídos do GREEN, nenhuma mudança adicional necessária; testes continuaram passando.

## Issues Encountered

None.

## User Setup Required

None - nenhuma configuração de serviço externo.

## Verification Output

`npx vitest run convex/friends.test.ts --reporter=verbose`:
```
 RUN  v1.6.1 /home/leo/workspace/janja

 ✓ convex/friends.test.ts > friends.sendFriendRequest > rejeita sem identidade autenticada
 ✓ convex/friends.test.ts > friends.sendFriendRequest > alvo inexistente lança erro claro e não cria nada
 ✓ convex/friends.test.ts > friends.sendFriendRequest > username/tag resolvendo para o próprio chamador lança erro
 ✓ convex/friends.test.ts > friends.sendFriendRequest > já são amigos: lança erro e não cria pedido duplicado
 ✓ convex/friends.test.ts > friends.sendFriendRequest > pedido duplicado na mesma direção lança erro
 ✓ convex/friends.test.ts > friends.sendFriendRequest > pedido reverso existente orienta a aceitar em vez de duplicar
 ✓ convex/friends.test.ts > friends.sendFriendRequest > caminho feliz: cria exatamente um documento com os campos corretos
 ✓ convex/friends.test.ts > friends.acceptFriendRequest > id inexistente lança erro claro
 ✓ convex/friends.test.ts > friends.acceptFriendRequest > AUTORIZAÇÃO CRÍTICA: terceiro usuário não pode aceitar pedido alheio, e nada é criado como efeito colateral
 ✓ convex/friends.test.ts > friends.acceptFriendRequest > o próprio remetente não pode auto-aceitar o pedido que enviou
 ✓ convex/friends.test.ts > friends.acceptFriendRequest > destinatário real aceita: cria friendships em ordem canônica e apaga o pedido
 ✓ convex/friends.test.ts > friends.acceptFriendRequest > userA < userB independe de quem enviou ou aceitou o pedido
 ✓ convex/friends.test.ts > friends.rejectFriendRequest > terceiro usuário não pode recusar pedido alheio
 ✓ convex/friends.test.ts > friends.rejectFriendRequest > destinatário recusa: pedido some e nenhuma amizade é criada

 Test Files  1 passed (1)
      Tests  14 passed (14)
```

`npx tsc --noEmit -p convex/tsconfig.json`: sem output (sucesso, zero erros).

`npx vitest run` (suíte inteira, 10 arquivos incluindo `convex/dms.test.ts` do plano irmão 06-04, já presente e passando):
```
 Test Files  10 passed (10)
      Tests  86 passed (86)
```

`npm run typecheck`: `typecheck:node` e `typecheck:convex` passam sem erro. `typecheck:web` falha com 4 erros, todos em `src/renderer/src/components/shell/ChannelSidebar.tsx` e `ServerRail.tsx` — arquivos fora do meu ownership (`convex/friends.ts`/`convex/friends.test.ts` apenas), claramente do trabalho concorrente do agente irmão em `src/renderer/`. Não foi tocado nem corrigido, conforme instrução de escopo.

## Next Phase Readiness

- `convex/friends.ts` pronto para consumo pela UI (06-06 — painel de amigos) assim que `convex/_generated/api.ts` for regenerado centralmente pelo orquestrador.
- 06-03 (lista e remoção de amigos) pode reaproveitar diretamente `canonicalPair` como padrão (não como import — função não exportada, replicar o padrão) e as duas queries indexadas de `friendships` (`by_pair` para ponto exato, `by_userB` para a metade complementar da união) documentadas em `06-RESEARCH.md §2`.
- Nenhum bloqueio conhecido. O único item pendente é de infraestrutura (registrar `friends` em `api.ts`), fora do escopo deste plano.

---
*Phase: 06-amigos-e-dms*
*Completed: 2026-08-18*
