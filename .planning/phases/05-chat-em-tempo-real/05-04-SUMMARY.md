---
phase: 05-chat-em-tempo-real
plan: 04
subsystem: ui
tags: [convex, react, usePaginatedQuery, scroll-anchoring, chat]

# Dependency graph
requires:
  - phase: 05-01
    provides: "convex/messages.ts (sendMessage, listMessages paginado com order desc + join de autor + isMine)"
  - phase: 05-02
    provides: "convex/channelReadState.ts (openChannel, getUnreadCounts)"
provides:
  - "MessageList.tsx dono de usePaginatedQuery(api.messages.listMessages) + useMutation(api.channelReadState.openChannel), consumível só com channelId"
  - "Técnica de scroll pinned-cursor: nenhum jump ao carregar histórico (CHAT-03), nenhum roubo de scroll por mensagem nova (CHAT-04), aviso 'N novas mensagens'"
  - "TextChannelView (ConversationArea.tsx) envia mensagem real via api.messages.sendMessage, sem mockMessages/eco local"
  - "Badge de não lidas por canal na sidebar via api.channelReadState.getUnreadCounts"
affects: ["05-06 (verificação humana Windows — scroll/CHAT-03/04 só confirmável visualmente, não em WSL2)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MessageList 'inteligente' — dono da própria query/mutation (mesmo padrão de ChannelHeader.tsx), recebe só channelId"
    - "Viewport real do Radix ScrollArea obtido via querySelector('[data-slot=\"scroll-area-viewport\"]') a partir de um wrapper ref, sem editar o primitivo compartilhado"
    - "Compensação de scroll só no caso de histórico antigo (oldestId muda) via delta de scrollHeight em useLayoutEffect; mensagem nova (newestId muda) nunca recebe compensação — só decide auto-scroll ou incrementa aviso"

key-files:
  created: []
  modified:
    - src/renderer/src/components/shell/MessageList.tsx
    - src/renderer/src/components/shell/ConversationArea.tsx
    - src/renderer/src/components/shell/ChannelSidebar.tsx

key-decisions:
  - "EnrichedMessage (tipo local em MessageList.tsx) ajustado para bater com o retorno real de listMessages: sem authorId solto, author.userId presente, author.avatarUrl opcional — o plano já previa corrigir o tipo local em vez do backend."
  - "TextChannelView perdeu a prop firstUnreadMessageId — o divisor agora é 100% interno a MessageList, resolvido no mount via openChannel."

patterns-established:
  - "Detecção de 'qual caso de scroll estou tratando' por comparação de id (newestId/oldestId), nunca por results.length — imune a página crescer/encolher por escrita concorrente (doc oficial Convex, citada em 05-RESEARCH.md §3)."

# Metrics
duration: ~35min
completed: 2026-08-19
---

# Phase 05 Plan 04: Mensagens, scroll e não lidas (UI) Summary

**MessageList paginada com usePaginatedQuery + âncora de scroll por delta de scrollHeight (nunca jump ao carregar histórico) e aviso "N novas mensagens" (nunca rouba scroll de quem lê histórico), envio real via sendMessage sem eco local, badge de não lidas reativo na sidebar via getUnreadCounts.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-19T02:23:53Z
- **Tasks:** 3/3
- **Files modified:** 3

## Accomplishments
- `MessageList.tsx` reescrito por completo: `usePaginatedQuery(api.messages.listMessages, { channelId }, { initialNumItems: 30 })`, `useMutation(api.channelReadState.openChannel)` disparado no mount do canal (snapshot único do divisor) e de novo sempre que mensagem nova chega com o usuário no fim do scroll.
- Técnica de âncora implementada exatamente como descrita em `05-RESEARCH.md §3/§4`: gatilho de `loadMore` é só o evento `scroll` nativo (`scrollTop < TOP_THRESHOLD_PX`), nunca uma reação a `results.length`; distinção do caso "histórico antigo" (compara `oldestId`, compensa `scrollHeight` em `useLayoutEffect`) vs. "mensagem nova" (compara `newestId`, decide auto-scroll se `isAtBottomRef.current` ou incrementa `newMessageCount`) — nenhum `setTimeout`, nenhum polling.
- Divisor "NOVAS MENSAGENS" (`role="separator"`) reintroduzido como parte interna de `MessageList`, posicionado por `dividerMessageId` vindo do retorno de `openChannel`.
- `TextChannelView` (`ConversationArea.tsx`) não usa mais `mockMessages`/eco local — `handleSend` chama `sendMessage({ channelId, content })` diretamente; `MessageList` segue reativa via subscrição, sem passar `messages` como prop.
- `ChannelSidebar.tsx` ganhou `useQuery(api.channelReadState.getUnreadCounts, ...)`, um `Map` por `channelId`, e o `Badge` condicional em `TextChannelRow` — canal de voz não ganha badge (a própria query já filtra só canais de texto).

## Task Commits

Nenhum commit foi feito — instrução explícita do orquestrador (`NO_GIT`): siblings 06-07 (`src/renderer/src/components/friends/`, `AppShell.tsx`) e 07-01 (`convex/`) rodam em paralelo no mesmo working tree. Arquivos ficam não commitados:
- `src/renderer/src/components/shell/MessageList.tsx` (reescrito)
- `src/renderer/src/components/shell/ConversationArea.tsx` (modificado)
- `src/renderer/src/components/shell/ChannelSidebar.tsx` (modificado)

## Files Created/Modified
- `src/renderer/src/components/shell/MessageList.tsx` - Lista de mensagens paginada e reativa, dona da própria query/mutation; âncora de scroll para histórico, aviso de mensagem nova, divisor de não lidas.
- `src/renderer/src/components/shell/ConversationArea.tsx` - `TextChannelView` envia mensagem real via `api.messages.sendMessage`; `mockMessages`/`Message`/`useState` de eco local removidos; `mockVoiceParticipants`/`mockMembers` seguem em uso só por `VoiceChannelView` (F7).
- `src/renderer/src/components/shell/ChannelSidebar.tsx` - Badge de não lidas por canal em `TextChannelRow`, alimentado por `api.channelReadState.getUnreadCounts`.

## Decisions Made
- **Tipo `EnrichedMessage` ajustado ao retorno real do backend** (não ao exemplo literal do plano): `author.userId` presente, `avatarUrl` opcional (`?:`, não `| undefined` explícito redundante), sem `authorId` solto no nível da mensagem — o campo real que `listMessages` devolve é só `author.userId`/etc dentro do objeto `author`, e a mensagem em si não repete `authorId`. O plano já autorizava essa correção ("corrija ESTE tipo para bater com o retorno real — nunca o contrário").
- **`TextChannelView` perdeu a prop `firstUnreadMessageId`**, conforme o plano — o divisor é resolvido inteiramente dentro de `MessageList` via `openChannel` no mount, sem depender de nada vindo de `ConversationArea`/`mock-data.ts`.
- Nenhum `useEffect`/`useLayoutEffect` novo foi introduzido além dos três já especificados no plano (mount/divisor, listener de scroll, âncora); nenhum `setTimeout` usado em lugar nenhum — seguindo a instrução explícita de "se você se pegar lutando com o scroll com timeouts ou refs-em-effects, pare".

## Deviations from Plan

None - plano executado exatamente como escrito, incluindo o snippet de código fornecido (com o ajuste de tipo já previsto pelo próprio plano).

## Issues Encountered
`npm run typecheck:web` reporta um erro pré-existente em `src/renderer/src/components/friends/DmSidebar.tsx` (incompatibilidade `avatarUrl: string | undefined` vs `string | null`) — arquivo de propriedade do sibling 06-07, não tocado por este plano, gerado pelo trabalho concorrente do sibling 07-01 em `convex/`. Confirmado via `grep` que nenhum erro de typecheck aparece nos três arquivos deste plano. `npx vitest run` reporta 10 falhas em `convex/voice.test.ts` ("Could not find module for: voice") — arquivo não-rastreado (`?? convex/voice.test.ts` no `git status`) de outro plano em andamento (07-01), não relacionado a mensagens/scroll/não-lidas. Rodando só o escopo deste plano (`npx vitest run src/renderer/src/components/shell convex/messages.test.ts convex/channelReadState.test.ts`): 17/17 passam.

## Verification Output

`npm run typecheck:web` (erro isolado ao sibling, confirmado por grep):
```
$ npm run typecheck:web 2>&1 | grep -E "shell/(MessageList|ConversationArea|ChannelSidebar)"
(sem output — nenhum erro nos 3 arquivos deste plano)
```

`npm run build` falha no mesmo passo de typecheck (mesmo erro único, `DmSidebar.tsx`, fora do meu escopo) — não é possível rodar o build completo até o sibling 06-07/07-01 resolver essa incompatibilidade de tipo.

`npx vitest run src/renderer/src/components/shell convex/messages.test.ts convex/channelReadState.test.ts`:
```
 ✓ convex/channelReadState.test.ts  (7 tests) 43ms
 ✓ convex/messages.test.ts  (10 tests) 54ms

 Test Files  2 passed (2)
      Tests  17 passed (17)
```

`npx vitest run` (repo inteiro): 141 passed, 10 failed — todas as 10 falhas em `convex/voice.test.ts` (module resolution do sibling 07-01 em andamento), nenhuma em arquivo deste plano.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness

CHAT-01, CHAT-03, CHAT-04, CHAT-05 e CHAT-06 implementados e prontos para verificação visual humana (05-06) — **não verificáveis aqui**: o ambiente de execução é WSL2, a janela Electron não renderiza. Especificamente precisam de confirmação humana no Windows:
1. Abrir canal com histórico → mais recente embaixo, divisor "NOVAS MENSAGENS" na posição correta.
2. Rolar até o topo com 30+ mensagens → histórico antigo carrega sem a posição visual pular (mesmo com mensagem nova chegando durante a rolagem, se testável com duas contas).
3. Estar no meio do histórico e uma mensagem nova chegar (via segunda conta/janela) → não deve rolar sozinho; botão flutuante "N novas mensagens" aparece; clicar rola para o fim.
4. Badge de não lidas aparece em canal não selecionado ao chegar mensagem nova; some ao abrir o canal.

Bloqueio conhecido para `npm run build` completo: erro de tipo em `src/renderer/src/components/friends/DmSidebar.tsx` (fora do meu escopo, sibling 06-07/07-01) — não impede que os 3 arquivos deste plano estejam corretos isoladamente (confirmado via typecheck filtrado + vitest escopado), mas impede build/typecheck full-repo até o sibling resolver.

---
*Phase: 05-chat-em-tempo-real*
*Completed: 2026-08-19*
