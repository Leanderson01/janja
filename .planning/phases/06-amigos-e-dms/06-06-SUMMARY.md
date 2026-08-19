---
phase: 06-amigos-e-dms
plan: 06
subsystem: ui
tags: [react, convex-react, shell, navigation, friends]

# Dependency graph
requires:
  - phase: 06-02
    provides: "sendFriendRequest, acceptFriendRequest, rejectFriendRequest (convex/friends.ts)"
  - phase: 06-03
    provides: "listFriends, listIncomingFriendRequests, removeFriendship (convex/friends.ts)"
provides:
  - "view: 'server' | 'home' + goHome() + selectedDmChannelId/setSelectedDmChannelId em selection-context.tsx (extensão, não novo contexto)"
  - "Botão 'Início' fixo em ServerRail.tsx que leva à visão de amigos"
  - "FriendsPanel.tsx: busca/adiciona amigo por USER#123, aceita/recusa pedidos recebidos, lista amigos com presença e remove amizade"
  - "src/renderer/src/lib/user-tag.ts: parseUserTag puro, testado"
affects: [06-07, 06-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AppShell.tsx: branch condicional em ShellBody() (view === 'server' vs 'home') dentro do mesmo componente, extraído de AppShell só para poder chamar useSelection() dentro do SelectionProvider"
    - "selectServer()/goHome() no selection-context: efeito colateral único encapsulado no setter público (setSelectedServerId sai do modo Início; goHome zera selectedDmChannelId) — chamador nunca precisa coordenar dois setters"
    - "FriendsPanel: alternância de 3 abas com useState local + Button variant='ghost'|'secondary', mesmo padrão manual de VoiceControlBar.tsx (sem componente de Tabs)"
    - "useMyIdentifier(): hook local que chama api.users.ensureUser (mutation idempotente, upsert) uma vez no mount via useEffect só para obter o username/tag do próprio usuário — evita precisar de uma query 'getCurrentUser' nova em convex/ (fora do escopo deste plano)"

key-files:
  created:
    - src/renderer/src/components/friends/FriendsPanel.tsx
    - src/renderer/src/lib/user-tag.ts
    - src/renderer/src/lib/user-tag.test.ts
  modified:
    - src/renderer/src/state/selection-context.tsx
    - src/renderer/src/components/shell/ServerRail.tsx
    - src/renderer/src/components/shell/AppShell.tsx

key-decisions:
  - "USER#123 do próprio usuário obtido chamando api.users.ensureUser de novo (idempotente, já rodado uma vez por AuthGate no login) em vez de criar uma query nova em convex/ — este plano não toca em convex/ (sibling agent editando concorrentemente)"
  - "input.tsx e a dependência do shadcn já existiam no repo (commitados em 04-05) — Task 3 não precisou instalar nada, só consumir o componente"
  - "Erros de removeFriendship (aba 'amigos') tratados com catch+console.error, sem UI dedicada — o plano só pede UI de erro inline na aba 'pedidos'; ainda assim nunca deixamos a Promise rejeitada sem handler"

patterns-established:
  - "ShellBody (novo componente interno de AppShell.tsx): único ponto que decide o layout de 4 vs 2 regiões com base em `view` — plano 06-07 estende este mesmo branch trocando ChannelSidebar/MemberList por DmSidebar/DmConversationView quando view === 'home' e uma DM está selecionada"

# Metrics
duration: ~45min
completed: 2026-08-19
---

# Phase 06 Plan 06: UI — Navegação e Painel de Amigos Summary

**Botão "Início" fixo na barra de servidores leva a uma visão dedicada (`FriendsPanel`) onde o usuário busca por `USER#123`, envia/aceita/recusa pedidos de amizade e vê/remove amigos com presença real — tudo sobre `convex/friends.ts` e `convex/users.ts` já registrados em `api`, sem alterar o comportamento da visão de servidor da Fase 3.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3 (estado de navegação + botão Início; parser USER#123; FriendsPanel completo)
- **Files created:** 3
- **Files modified:** 3

## Accomplishments

- `selection-context.tsx` ganhou `view: 'server' | 'home'`, `goHome()`,
  `selectedDmChannelId`/`setSelectedDmChannelId` — extensão do contexto único
  do shell (Fase 3), não um segundo sistema de navegação. `setSelectedServerId`
  virou um wrapper (`selectServer`) que também sai do modo Início.
- `ServerRail.tsx` ganhou `HomeButton` (mesmo padrão visual de `ServerIcon`:
  indicador de barra vertical + tooltip lateral, `Avatar`/`AvatarFallback` com
  ícone `Home` em vez de iniciais), separado da lista de servidores por um
  `Separator`.
- `AppShell.tsx`: lógica extraída para `ShellBody()` (precisa de
  `useSelection()`, só disponível dentro de `SelectionProvider`).
  `view === 'server'` renderiza exatamente como antes (`ChannelSidebar` +
  `ConversationArea` + `MemberList`); `view === 'home'` renderiza `ServerRail`
  + `FriendsPanel` no centro, sem `ChannelSidebar`/`MemberList`.
- `src/renderer/src/lib/user-tag.ts`: `parseUserTag` puro (regex
  `/^(.+)#(\d{4})$/`, normaliza minúsculo/trim), 6 testes cobrindo caso feliz,
  normalização, e as 4 rejeições (sem `#`, tag curta, tag não-numérica,
  username vazio).
- `src/renderer/src/components/friends/FriendsPanel.tsx`: 3 abas
  (Amigos/Pedidos/Adicionar) via `useState` local:
  - **Amigos**: `useQuery(api.friends.listFriends)`, agrupado ONLINE/OFFLINE
    (mesmo texto de cabeçalho e `opacity-60` de `MemberList.tsx`), botão
    remover (`UserMinus`) chama `api.friends.removeFriendship`.
  - **Pedidos**: `useQuery(api.friends.listIncomingFriendRequests)`, botões
    aceitar/recusar (`Check`/`X`) chamam `acceptFriendRequest`/
    `rejectFriendRequest`, erro de mutation mostrado inline por linha (não
    trava o formulário, não deixa a Promise sem tratamento).
  - **Adicionar**: `Input` + `parseUserTag`, `useQuery(api.users.
    findUserByUsernameTag, submitted ?? 'skip')` (padrão oficial de skip),
    estados "Buscando..."/"Nenhum usuário encontrado"/cartão com botão "Enviar
    pedido de amizade" que chama `sendFriendRequest`, com confirmação
    transitória e erro inline.
  - Cabeçalho do painel mostra o próprio `USER#123` (botão copiável) —
    exigido pelo hard constraint da execução; obtido via `useMyIdentifier()`
    (chama `api.users.ensureUser` de novo, idempotente).

## Task Commits

**Nenhum commit foi feito** — instrução explícita da orquestração (`NO_GIT`):
um sibling agent estava rodando em paralelo sobre `convex/` (plano 05-01, e
depois outros planos da Fase 6 sobre `convex/friends.ts`/`convex/dms.ts`
segundo o `git log` observado durante a execução). Todos os arquivos
permanecem modificados/untracked, não staged — o orquestrador commita em
série.

## Files Created/Modified

- `src/renderer/src/state/selection-context.tsx` - adiciona `view`, `goHome`,
  `selectedDmChannelId`/`setSelectedDmChannelId`; `setSelectedServerId` vira
  wrapper que também sai do modo Início
- `src/renderer/src/components/shell/ServerRail.tsx` - adiciona `HomeButton`
  + `Separator` antes da lista de servidores
- `src/renderer/src/components/shell/AppShell.tsx` - extrai `ShellBody()`;
  branch `view === 'server'` (inalterado) vs `view === 'home'` (`ServerRail` +
  `FriendsPanel`, sem `ChannelSidebar`/`MemberList`)
- `src/renderer/src/lib/user-tag.ts` (novo) - `parseUserTag(input): {username,
  tag} | null`
- `src/renderer/src/lib/user-tag.test.ts` (novo) - 6 testes
- `src/renderer/src/components/friends/FriendsPanel.tsx` (novo) - painel
  completo: 3 abas, `useMyIdentifier()`, componentes `FriendRow`/`FriendGroup`/
  `RequestRow`/`MyIdentifierBadge`

## Decisões Feitas

- **`Id<'servers'>`/`Id<'dmChannels'>` etc. em vez do `string` genérico do
  pseudocódigo do plano**: mantido o padrão de tipagem forte já usado no
  resto de `selection-context.tsx` (`Id<'servers'>`, `Id<'channels'>`) em vez
  do `string` simplificado da assinatura ilustrativa no corpo do plano —
  `dmChannels` já existe no schema atual (visto em `convex/schema.ts` durante
  leitura), então `Id<'dmChannels'>` resolve normalmente.
- **`useMyIdentifier()` via `ensureUser` reaproveitado**: não havia (e este
  plano não podia criar, por não tocar em `convex/`) uma query "quem sou eu"
  que devolvesse `username`/`tag`. `ensureUser` é upsert idempotente — chamar
  de novo do `FriendsPanel` só devolve o documento já existente (mesmo
  garantido por `AuthGate` no login), sem duplicar trabalho nem exigir mudança
  de schema/backend.
- **`components.json`/`package.json`/`input.tsx` não precisaram de mudança**:
  já estavam commitados (plano 04-05, aparentemente instalados então apesar
  do nome do commit não sugerir isso) — Task 3 pulou a etapa de instalação do
  shadcn `input` porque já existia e já batia com o registry oficial
  `new-york-v4/ui/input.tsx`.

## Deviations from Plan

Nenhuma das quatro regras de desvio (bug, funcionalidade crítica faltando,
bloqueio, mudança arquitetural) exigiu mudança de escopo do que o plano já
descrevia — com uma exceção pontual:

**1. [Rule 2 - Missing Critical] Exibição do próprio USER#123 no painel**
- **Found during:** Task 3
- **Issue:** O corpo do plano (seção `<action>` da Task 3) não menciona
  explicitamente mostrar o `USER#123` do próprio usuário logado, mas os
  `hard_constraints` da execução são categóricos: "é o que as pessoas trocam
  para se adicionar... deve ser visível e fácil de copiar... UserPanel.tsx
  deliberadamente deixou de fora porque... o painel de amigos é onde ele
  pertence". Sem isso, SOCIAL-01 (adicionar por `USER#123`) fica incompleto
  do ponto de vista de quem precisa *compartilhar* seu próprio identificador.
- **Fix:** cabeçalho do `FriendsPanel` mostra um botão com `username#tag` +
  ícone `Copy`, copiando para a área de transferência via
  `navigator.clipboard.writeText`. Dado obtido por `useMyIdentifier()` (ver
  Decisões Feitas).
- **Files modified:** `src/renderer/src/components/friends/FriendsPanel.tsx`
- **Verification:** `npm run typecheck`/`npm run build` limpos com o novo
  hook e componente.

## Issues Encountered

Durante a execução, `npm run typecheck:convex`/`npm run build` falharam
transitoriamente por causa de `convex/channelReadState.test.ts` referenciando
um módulo (`convex/channelReadState.ts`) que um sibling agent ainda estava
escrevendo em paralelo (arquivo apareceu como `??` no `git status` antes de
`convex/channelReadState.ts` existir por completo). Confirmado por
reexecução alguns minutos depois: `npm run typecheck`, `npm run build` e
`npx vitest run` (14 arquivos, 132 testes) passam limpos — o churn era
inteiramente do sibling, não deste plano (nenhum arquivo em `convex/` foi
tocado por esta execução).

### Saída real das verificações (estado final)

```
$ npm run typecheck
typecheck:node   -> OK
typecheck:web    -> OK
typecheck:convex -> OK

$ npm run build
✓ built in 70ms (main)
✓ built in 9ms (preload)
✓ 2020 modules transformed, built in 1.55s (renderer)

$ npx vitest run
 Test Files  14 passed (14)
      Tests  132 passed (132)
 (inclui src/renderer/src/lib/user-tag.test.ts — 6 testes)
```

`npx eslint` limpo nos arquivos deste plano, exceto 1 erro pré-existente em
`selection-context.tsx:100` (`react-refresh/only-export-components`, por
exportar `SelectionProvider` e `useSelection` do mesmo arquivo) — confirmado
via `git stash` que já existia antes desta execução, não introduzido por ela.

## User Setup Required

None - nenhuma configuração de serviço externo necessária. A navegação e o
painel não puderam ser verificados visualmente (janela Electron não renderiza
em WSL2) — verificação humana real fica para o plano 06-08.

## Next Phase Readiness

- `view`/`goHome`/`selectedDmChannelId`/`setSelectedDmChannelId` estão
  publicados em `selection-context.tsx`, prontos para o plano 06-07 trocar o
  branch `view === 'home'` de `AppShell.tsx`/`ShellBody` por
  `DmSidebar`/`DmConversationView` condicionais (hoje sempre mostra
  `FriendsPanel` puro).
- `FriendsPanel.tsx` não lê/escreve `selectedDmChannelId` — 06-07 é livre
  para decidir como a lista de DMs interage com esse estado sem conflito.
- Nenhum arquivo em `convex/` foi tocado; `api.friends`/`api.users` já
  estavam registrados em `convex/_generated/api.ts` antes desta execução e
  continuam consistentes com o que `FriendsPanel.tsx` consome.
- Ponto de atenção (não bloqueio): todos os arquivos deste plano continuam
  não commitados, por instrução explícita da orquestração (`NO_GIT`). O
  orquestrador precisa commitar/integrar antes do plano 06-08 (verificação
  humana com duas contas).

---
*Phase: 06-amigos-e-dms*
*Completed: 2026-08-19*
