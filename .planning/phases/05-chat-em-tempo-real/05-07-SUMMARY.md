---
phase: 05-chat-em-tempo-real
plan: 07
subsystem: ui
tags: [react, useLayoutEffect, scroll-anchoring, radix-scroll-area, chat]

# Dependency graph
requires:
  - phase: 05-chat-em-tempo-real (plano 05-04)
    provides: "MessageList.tsx dono de usePaginatedQuery + openChannel, âncora de scroll para histórico (CHAT-03) e não-roubo de scroll em mensagem nova (CHAT-04)"
provides:
  - "Posição inicial de scroll correta ao montar MessageList: primeira não lida (com folga acima) quando existe, fim quando tudo lido"
  - "data-unread-divider=\"true\" no elemento UnreadDivider — âncora de DOM para localizar o divisor sem precisar de ref por mensagem"
affects: ["05-06 (verificação humana Windows — este defeito foi encontrado lá, precisa reverificação)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useLayoutEffect autossuficiente: busca o viewport direto via querySelector (com fallback pro ref já resolvido), em vez de depender de um useEffect separado ter rodado antes — elimina a corrida entre efeito passivo (roda após pintura) e efeito de layout (roda antes da pintura, mesmo commit)"
    - "Estado tri-valor (undefined/null/Id) para distinguir 'ainda não sei' de 'sei que não há' — decidir a posição inicial do scroll com undefined tratado como null trava a decisão errada para sempre, porque a flag hasScrolledToBottomOnceRef só permite uma tentativa"

key-files:
  created: []
  modified:
    - src/renderer/src/components/shell/MessageList.tsx

key-decisions:
  - "Divisor localizado via querySelector('[data-unread-divider=\"true\"]') dentro do containerRef, não via ref por mensagem — mais simples, e a presença/ausência do elemento no DOM já reflete corretamente se a primeira não lida está na página carregada."
  - "openChannel().catch() agora cai em setDividerMessageId(null) em vez de engolir o erro silenciosamente — sem isso, uma falha de rede deixaria a posição inicial pendurada em 'undefined' para sempre, reintroduzindo o mesmo defeito por um caminho diferente (Rule 2 — tratamento de erro crítico para a correção funcionar em todos os casos, não só no caminho feliz)."
  - "Offset do divisor calculado via getBoundingClientRect() (divider vs viewport), não offsetTop/offsetParent — robusto à estrutura interna do Radix ScrollArea, que não é um único elemento posicionado simples."

# Metrics
duration: ~20min
completed: 2026-08-19
---

# Phase 05 Plan 07: Posição inicial do scroll Summary

**Corrigida a causa raiz do defeito relatado pelo Leo — o scroll nunca era efetivamente setado no mount porque o `useLayoutEffect` de posicionamento rodava antes do `useEffect` que resolvia o viewport real do Radix ScrollArea; agora o próprio `useLayoutEffect` busca o viewport de forma autossuficiente e decide entre "primeira não lida com folga acima" ou "fim", sem nenhum `setTimeout`.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 1/1
- **Files modified:** 1

## Accomplishments

- Identificada a causa raiz exata do defeito: `viewportRef.current` era populado por um `useEffect` (efeito passivo, roda depois da pintura) declarado antes, no código, do `useLayoutEffect` que decide a posição inicial — mas como React sempre executa TODOS os `useLayoutEffect` antes de QUALQUER `useEffect` no mesmo commit, o efeito de posicionamento rodava com `viewportRef.current` ainda `null` na transição crítica (de "Carregando mensagens..." para o `ScrollArea` real), fazia `if (!viewport) return` e nunca marcava `hasScrolledToBottomOnceRef.current = true`. Sem nenhuma mensagem nova chegando depois para disparar o efeito de novo, o `scrollTop` nunca era setado — ficava no padrão do navegador (0, topo), exatamente a "posição sem significado" relatada.
- Corrigido tornando o `useLayoutEffect` autossuficiente: busca o viewport via `querySelector('[data-slot="scroll-area-viewport"]')` diretamente (com fallback para `viewportRef.current` já resolvido, evitando refazer a busca em todo render subsequente).
- Implementada a decisão de posição pedida pelo `must_haves`: existe primeira não lida na página carregada → `UnreadDivider` ganhou `data-unread-divider="true"`, localizado via `querySelector`, scroll calculado por `getBoundingClientRect()` (divider vs viewport) com `DIVIDER_SCROLL_PADDING_PX = 96` de folga acima; tudo lido, ou primeira não lida fora da página de 30 mensagens carregada → vai para o fim (`scrollTop = scrollHeight`), documentado como limitação conhecida em vez de encadear `loadMore` atrás dela.
- `dividerMessageId` virou estado tri-valor (`undefined | null | Id`) para o `useLayoutEffect` conseguir esperar o `openChannel` resolver antes de decidir — decidir com `undefined` tratado como "sem divisor" travaria a posição errada para sempre, já que `hasScrolledToBottomOnceRef` só permite uma tentativa de posicionamento inicial.
- Nenhum `setTimeout` introduzido — a "espera" pelo layout pronto é inteiramente resolvida pela própria mecânica de commit do React (`useLayoutEffect` roda de novo quando `dividerMessageId` muda de `undefined` para um valor resolvido, e nesse ponto o DOM do commit atual, incluindo o divisor se houver, já está montado).
- CHAT-03 (sem pulo ao carregar histórico) e CHAT-04 (mensagem nova não rouba o scroll de quem lê) não foram tocados: a lógica de compensação por `oldestId` e a decisão de auto-scroll/aviso por `newestId` continuam exatamente como o plano 05-04 deixou, dentro do mesmo `if (!hasScrolledToBottomOnceRef.current) { ...; return }` que isola o caso de posicionamento inicial dos demais.

## Task Commits

Nenhum commit foi feito — instrução explícita do orquestrador (`<NO_GIT>`: agente irmão rodando em paralelo no popover de configurações de voz). Arquivo fica não commitado:
- `src/renderer/src/components/shell/MessageList.tsx` (modificado)

## Files Created/Modified

- `src/renderer/src/components/shell/MessageList.tsx` - `useLayoutEffect` de posicionamento agora busca o viewport de forma autossuficiente (corrige a corrida de efeitos que causava o defeito); `dividerMessageId` virou estado tri-valor; `UnreadDivider` ganhou `data-unread-divider="true"`; nova constante `DIVIDER_SCROLL_PADDING_PX`; posição inicial decide entre divisor (com folga) e fim, conforme `must_haves` do plano.

## Decisions Made

- **Causa raiz não era "medir antes da altura calculada" no sentido literal do plano** (este componente não usa virtualização — `05-RESEARCH.md §4` decidiu deliberadamente não introduzir `react-virtual`/`react-window`), mas sim uma corrida de timing entre dois efeitos do React (`useEffect` vs `useLayoutEffect`) resolvendo o mesmo ref em momentos diferentes do ciclo de commit. O espírito da orientação do plano ("não usar `setTimeout`, usar o evento de layout pronto que a lista expõe") foi seguido: a correção usa exclusivamente a mecânica de commit/effect do próprio React como "evento de layout pronto", sem nenhum timer.
- Localização do divisor por `querySelector` de atributo (`data-unread-divider="true"`) em vez de um `ref` dedicado por mensagem — mais simples, e a ausência do elemento no DOM já é, por construção, exatamente o sinal de "sem divisor" ou "divisor fora da página carregada", sem precisar de uma checagem separada.
- `openChannel().catch()` passou a resolver para `null` em vez de engolir o erro em silêncio — sem isso, uma falha na mutation (rede instável, por exemplo) deixaria `dividerMessageId` em `undefined` para sempre, e a posição inicial nunca seria decidida, reproduzindo o mesmo sintoma do defeito original por um caminho diferente (Rule 2 do fluxo de deviations — tratamento de erro necessário para a correção valer em todos os casos, não só no caminho feliz).

## Deviations from Plan

Nenhuma além da correção de erro descrita acima (Rule 2 — funcionalidade crítica ausente: fallback decisivo no `.catch()` do `openChannel`, sem o qual a correção do defeito principal teria uma lacuna). O restante seguiu o `<what>` do plano à risca, incluindo a explícita evitação de `setTimeout`.

## Issues Encountered

None. `npm run typecheck`, `npm run build` e `npx vitest run` passaram de primeira, sem nenhum arquivo fora de `MessageList.tsx` tocado.

## User Setup Required

None - nenhuma configuração de serviço externo.

## Verification Output

`npm run typecheck` — limpo (node, web, convex).

`npm run build` — build completo, sem erros.

`npx vitest run` — 164/164 passam (15 arquivos de teste), nenhuma regressão. Não existe arquivo de teste dedicado a `MessageList.tsx` no repo (mesmo estado de antes deste plano — a verificação de scroll é inerentemente de DOM real/visual, fora do alcance de unit test neste projeto).

## Next Phase Readiness

**Confirmação visual só é possível no Windows.** O que o Leo precisa reproduzir, especificamente para validar esta correção:

1. **Canal com mensagens não lidas:** abrir um canal de texto que tenha mensagens novas desde a última visita (ex.: mandar uma mensagem por uma segunda conta enquanto a primeira está em outro canal, depois voltar para o canal na primeira conta). Esperado: a lista abre já rolada até perto do divisor vermelho "NOVAS MENSAGENS", com pelo menos uma mensagem lida visível acima dele (não colado no topo do viewport).
2. **Canal totalmente lido:** abrir um canal sem nada de novo desde a última visita. Esperado: a lista abre rolada até o fim, mostrando a mensagem mais recente, sem precisar rolar manualmente.
3. **Alternar entre dois canais várias vezes:** trocar de canal (com o canal anterior tendo mensagens não lidas ou não) e voltar, repetidamente. Esperado: cada abertura reposiciona corretamente (caso 1 ou 2 acima) — nunca fica "no topo" numa posição arbitrária, que era exatamente o defeito relatado.

**Limitação conhecida, documentada no próprio plano:** se a primeira mensagem não lida estiver fora da primeira página carregada (mais de 30 mensagens de histórico entre a última leitura e agora), a lista abre no fim em vez de rolar até a não lida — comportamento deliberado (evita encadear `loadMore` atrás do divisor), não um bug.

**Não afeta CHAT-03/CHAT-04** (verificados no 05-04, reconfirmação recomendada mas sem mudança de lógica nesta execução): carregar histórico antigo rolando para cima continua sem pular, e mensagem nova chegando enquanto o usuário lê histórico continua não roubando o scroll (só incrementa o aviso "N novas mensagens").

---
*Phase: 05-chat-em-tempo-real*
*Completed: 2026-08-19*
