---
phase: 06-amigos-e-dms
plan: 07
subsystem: ui
tags: [react, convex, usePaginatedQuery, dms, chat]

# Dependency graph
requires:
  - phase: 06-amigos-e-dms (planos 06-01 a 06-06)
    provides: backend de DMs (convex/dms.ts — getOrCreateDmChannel, listMyDmChannels,
      listDmMessages, sendDmMessage), FriendsPanel com 3 abas, selection-context.tsx
      estendido (view/selectedDmChannelId/goHome)
  - phase: 05-chat-em-tempo-real
    provides: MessageInput.tsx genérico (onSend: (content) => void), convenção de
      paginação decrescente + reverse() antes de renderizar
provides:
  - Botão "Mensagem" no FriendsPanel que cria/recupera o canal de DM e navega para ele
  - DmSidebar.tsx — lista de conversas diretas + atalho fixo "Amigos"
  - DmMessageList.tsx + DmConversationView.tsx — conversa direta real com histórico
    paginado (usePaginatedQuery) e envio de mensagem via MessageInput reaproveitado
  - AppShell.tsx decidindo entre 4 combinações de layout (servidor / início-painel-amigos
    / início-lista-vazia-de-dm / início-conversa-aberta)
affects: [06-08 (verificação humana com duas contas), fases futuras que tocarem DM UI]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DM 'é minha mensagem' resolvido sem hook de usuário atual: numa conversa de 2
      participantes, authorId !== otherUser.userId basta (evita 2ª fonte de verdade)"
    - "Reaproveitamento de subscription: DmSidebar e DmConversationView chamam a mesma
      useQuery(api.dms.listMyDmChannels) — Convex deduplica, não duplica rede"

key-files:
  created:
    - src/renderer/src/components/friends/DmSidebar.tsx
    - src/renderer/src/components/friends/DmMessageList.tsx
    - src/renderer/src/components/friends/DmConversationView.tsx
  modified:
    - src/renderer/src/components/friends/FriendsPanel.tsx
    - src/renderer/src/components/shell/AppShell.tsx

key-decisions:
  - "MessageInput.tsx reaproveitado sem nenhuma alteração — onSend é fire-and-forget
    (void), então sendDmMessage é chamado com .then/.catch em vez de esperar o
    componente genérico virar async"
  - "Erro do botão Mensagem no FriendsPanel usa o mesmo padrão de rowErrors por
    friendUserId já usado em RequestsTab (aba Pedidos), em vez de um padrão novo"
  - "DmSidebar não renderiza nada abaixo do separador enquanto listMyDmChannels está
    undefined (evita piscar estado vazio); lista vazia é estado normal, sem mensagem
    de erro"

patterns-established:
  - "Layout de 4 regiões do AppShell agora tem 2 sub-variantes dentro de view==='home':
    DmSidebar decide sozinho o que mostrar na 2ª coluna, AppShell só decide entre
    FriendsPanel/DmConversationView na região central via selectedDmChannelId"

# Metrics
duration: ~35min
completed: 2026-08-18
---

# Phase 06 Plan 07: UI de Conversa Direta Summary

**SOCIAL-05 fechado ponta a ponta: clicar em "Mensagem" num amigo abre uma conversa
direta real sobre o backend do Convex, com histórico paginado via `usePaginatedQuery`
e envio reaproveitando o `MessageInput` da Fase 5, sem duplicar composer.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-19T02:24:52Z
- **Tasks:** 4/4 completos
- **Files modified/created:** 5 (2 modificados, 3 criados)

## Accomplishments

- Botão "Mensagem" em cada linha de amigo (`FriendsPanel.tsx`) chama
  `getOrCreateDmChannel` e navega direto para a conversa via `selectedDmChannelId`,
  com erro inline por linha (mesmo padrão de `RequestsTab`).
- `DmSidebar.tsx` novo: lista de conversas diretas reais (`listMyDmChannels`) com
  atalho fixo "Amigos" no topo, mesmo padrão visual/estado-selecionado de
  `ChannelSidebar.tsx`.
- `DmMessageList.tsx` + `DmConversationView.tsx` novos: conversa direta completa —
  cabeçalho com o nome do outro usuário, histórico paginado (`usePaginatedQuery`,
  `initialNumItems: 30`, botão "Carregar mensagens antigas" quando
  `status === 'CanLoadMore'`) e envio de mensagem via `MessageInput` reaproveitado
  sem alteração.
- `AppShell.tsx` ajustado: `view === 'home'` agora renderiza `DmSidebar` na 2ª coluna
  e alterna `FriendsPanel`/`DmConversationView` na região central conforme
  `selectedDmChannelId`; `view === 'server'` inalterado.

## Task Commits

**Nenhum commit foi feito neste plano.** A tarefa que disparou esta execução incluiu
a restrição explícita `<NO_GIT>` (dois agentes irmãos — 05-04 em
`MessageList.tsx`/`ConversationArea.tsx`/`ChannelSidebar.tsx` e 07-01 em `convex/` —
rodando em paralelo neste mesmo worktree). Todas as mudanças descritas abaixo estão
no working tree, não commitadas, exatamente como instruído.

## Files Created/Modified

- `src/renderer/src/components/friends/FriendsPanel.tsx` — adiciona botão "Mensagem"
  (ícone `MessageCircle`) por amigo, chamando `useMutation(api.dms.getOrCreateDmChannel)`
  e `setSelectedDmChannelId` do `useSelection()`; erro inline por linha.
- `src/renderer/src/components/friends/DmSidebar.tsx` (novo) — lista de conversas
  diretas via `listMyDmChannels` + linha fixa "Amigos".
- `src/renderer/src/components/friends/DmMessageList.tsx` (novo) — lista de mensagens
  de uma DM, "é minha" resolvido por `authorId !== otherUser.userId` (sem hook de
  usuário atual, nota do 06-RESEARCH.md).
- `src/renderer/src/components/friends/DmConversationView.tsx` (novo) — conversa
  completa: cabeçalho + `DmMessageList` (`usePaginatedQuery`) + `MessageInput`
  reaproveitado.
- `src/renderer/src/components/shell/AppShell.tsx` — `view === 'home'` passa a
  renderizar `DmSidebar` + (`FriendsPanel` | `DmConversationView`) em vez de só
  `FriendsPanel`.

## Decisions Made

- **`MessageInput` sem alteração alguma:** o componente é `onSend: (content: string)
  => void` (fire-and-forget). Em vez de mudar sua assinatura para `Promise<void>`
  (o que forçaria também revisitar `ConversationArea.tsx`, fora do meu escopo de
  arquivos), `DmConversationView` chama `sendDmMessage(...).then(...).catch(...)`
  dentro de uma função síncrona — mesmo efeito, zero mudança no componente
  compartilhado.
- **Erro do botão Mensagem:** reaproveitei o padrão `rowErrors: Record<string,
  string>` por id já usado em `RequestsTab` (aba Pedidos) em vez de inventar um
  padrão de erro novo — mesma UX em todo o painel de amigos.
- **`avatarUrl` como `string | undefined` (não `string | null`)** em `DmSidebar.tsx`:
  o typecheck revelou que o retorno real de `listMyDmChannels` usa `undefined` para
  "sem avatar" (schema `v.optional(v.string())`), não `null` como eu tinha escrito
  inicialmente — corrigido para bater com o tipo real inferido pelo Convex.

## Deviations from Plan

None - plan executado como escrito, com uma correção de tipo (`avatarUrl:
string | undefined` em vez de `string | null`) feita durante a Task 2, coberta pela
Rule 3 (bloqueava o `typecheck`).

## Verification

- `npm run typecheck` — passa (node + web + convex).
- `npm run build` — passa (main/preload/renderer, sem erros).
- `npx vitest run` — 132/132 testes passam nos arquivos deste plano e em todo o
  restante do repo, **exceto** `convex/voice.test.ts` (10 falhas, `"Could not find
  module for: \"voice\""`). Essa falha é do trabalho em andamento do agente irmão
  07-01 em `convex/` (o arquivo `convex/voice.test.ts` já existe no working tree mas
  `convex/voice.ts` ainda não — não toquei em `convex/` em nenhum momento, respeitando
  `file_ownership`). Rodando com esse arquivo excluído: `132 passed (132)`, igual ao
  baseline informado no contexto.
- Confirmado por `git diff --stat` que este plano só tocou
  `FriendsPanel.tsx`/`AppShell.tsx` (modificados) + os 3 arquivos novos em
  `components/friends/`; `ChannelSidebar.tsx`, `ConversationArea.tsx`,
  `MessageList.tsx` e `convex/schema.ts` aparecem no diff mas pertencem aos agentes
  irmãos (05-04 e 07-01), não a esta execução.
- **Não verificado (requer Windows):** renderização visual real do layout de 4
  colunas com `DmSidebar` + `DmConversationView` — a janela Electron não roda neste
  ambiente. Fica para o plano 06-08 (verificação humana com duas contas).

## Next Phase Readiness

SOCIAL-01 a SOCIAL-06 têm UI funcional ponta a ponta sobre dado real do Convex.
Falta apenas a verificação humana com duas contas simultâneas (plano 06-08) — em
especial confirmar visualmente no Windows que o layout de 4 regiões (`DmSidebar` +
`DmConversationView`) está correto, e que enviar/receber mensagem entre duas contas
reais atualiza a UI da forma esperada (reatividade do Convex, sem novo `loadMore`).
