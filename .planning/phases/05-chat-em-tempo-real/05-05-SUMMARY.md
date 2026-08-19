---
phase: 05-chat-em-tempo-real
plan: 05
subsystem: ui
tags: [react, convex, typing-indicator, throttle, client-side-ttl]

# Dependency graph
requires:
  - phase: 05-chat-em-tempo-real (plano 05-03)
    provides: "convex/typing.ts (setTyping/listTyping), sem TTL server-side por design"
  - phase: 05-chat-em-tempo-real (plano 05-04)
    provides: "ConversationArea.tsx com TextChannelView já usando mensagens/envio reais"
provides:
  - "MessageInput.tsx com prop opcional onTyping, sem nenhum conhecimento de Convex"
  - "TypingIndicator.tsx: expiração client-side (tick de 1s) sobre listTyping"
  - "TextChannelView (ConversationArea.tsx) com throttle de 2s para setTyping e indicador montado entre a lista de mensagens e o campo de envio"
affects: [06-dm (reaproveita MessageInput.tsx sem passar onTyping), 05-06 (checkpoint humano de verificação final com duas contas)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TTL client-side via setInterval(1000) recalculando now local, não filtro no handler da query Convex — necessário porque uma query Convex só reavalia com escrita nova, não com o passar do tempo"
    - "Throttle de mutation por useRef (lastTypingCallRef) comparado a Date.now(), sem debounce/setTimeout — mutation dispara na primeira tecla elegível e é ignorada até o cooldown passar"
    - "Prop opcional (onTyping?) como único ponto de acoplamento entre um componente genérico (MessageInput) e um comportamento de domínio (digitando) — quem decide o que a prop faz é sempre o componente pai"

key-files:
  created:
    - src/renderer/src/components/shell/TypingIndicator.tsx
  modified:
    - src/renderer/src/components/shell/MessageInput.tsx
    - src/renderer/src/components/shell/ConversationArea.tsx

key-decisions:
  - "TYPING_TTL_MS=6000 (3x o throttle) e TYPING_THROTTLE_MS=2000, exatamente os números do 05-RESEARCH.md §7 — não foram recalculados, só implementados como planejado"
  - "displayName com fallback para username e depois 'alguém' no texto do indicador (listTyping pode devolver displayName: null se o autor não tiver um) — pequeno reforço sobre o exemplo do plano, que assumia displayName sempre presente"
  - "Nenhuma mudança em convex/typing.ts — TTL segue 100% client-side, confirmado pelo teste 'linha antiga... este arquivo não filtra por idade' em convex/typing.test.ts, que continua passando sem alteração"

patterns-established:
  - "Componente de domínio (TypingIndicator) que lê uma query 'crua' e aplica sua própria janela de validade via tick local, reaproveitável para qualquer outra feature com o mesmo formato de problema (presença momentânea sem evento explícito de fim)"

# Metrics
duration: ~15min
completed: 2026-08-19
---

# Phase 05 Plan 05: Indicador de "está digitando" (UI) Summary

**Indicador "X está digitando..." ligado a `convex/typing.ts`, com TTL de 6s recalculado no cliente a cada 1s e throttle de escrita de 2s por usuário/canal — `MessageInput.tsx` ganhou só um prop opcional, sem nenhum import de Convex.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 3/3 completos
- **Files modified:** 3 (1 criado, 2 modificados)

## Accomplishments

- `MessageInput.tsx` aceita `onTyping?: () => void`, chamado a cada mudança de texto, sem saber o que a função faz por trás (continua compilando e funcionando idêntico a antes se a prop não for passada — verificado por grep: nenhum `import ... from 'convex` no arquivo).
- `TypingIndicator.tsx` criado: consome `api.typing.listTyping`, mantém `now` local via `setInterval(1000)` e filtra `now - updatedAt < 6000` a cada tick — garante que o indicador some sozinho mesmo sem nenhuma nova escrita chegar do servidor (cliente travando no meio da digitação, por exemplo). Retorna `null` (sem elemento algum) quando ninguém conta como digitando.
- `ConversationArea.tsx` (`TextChannelView`): `TypingIndicator` montado entre `MessageList` e `MessageInput`; `handleTyping` usa `useRef` para throttle de 2000ms antes de chamar `setTyping`, evitando uma mutation por tecla.

## Task Commits

**Nenhum commit foi criado.** Por instrução explícita da execução (`<NO_GIT>`: dois agentes irmãos — 07-02 em `convex/`, 07-03 em arquivos de voz — rodando em paralelo), nenhum comando git foi executado. Os três arquivos ficaram modificados/criados sem stage/commit:

1. **Task 1: MessageInput ganha onTyping opcional** - sem commit (arquivo deixado modificado)
2. **Task 2: Componente TypingIndicator com expiração client-side** - sem commit (arquivo deixado criado)
3. **Task 3: Ligar TypingIndicator e onTyping em ConversationArea** - sem commit (arquivo deixado modificado)

**Plan metadata:** nenhum commit de docs criado por este mesmo motivo. STATE.md não foi tocado (não está na lista de ownership deste plano e é um arquivo compartilhado entre os agentes concorrentes).

## Files Created/Modified

- `src/renderer/src/components/shell/MessageInput.tsx` - prop opcional `onTyping?: () => void`, chamada em `handleChange` (novo wrapper do `onChange` do `Textarea`); nenhum import de Convex.
- `src/renderer/src/components/shell/TypingIndicator.tsx` (novo) - lê `listTyping`, aplica TTL de 6s via tick de 1s, renderiza texto "X está digitando..." / "X e Y estão digitando..." / "N pessoas estão digitando..." ou `null`.
- `src/renderer/src/components/shell/ConversationArea.tsx` - `TextChannelView` ganhou `setTyping` (mutation), `lastTypingCallRef` (throttle de 2000ms) e montagem de `TypingIndicator` entre a lista de mensagens e o campo de envio; `TYPING_THROTTLE_MS` extraído como constante de módulo.

## Decisions Made

- Seguiu-se exatamente os números do `05-RESEARCH.md §7` (throttle 2000ms, TTL 6000ms, tick 1000ms) — nenhum recálculo, só implementação.
- `displayName` recebeu fallback (`?? username ?? 'alguém'`) no texto do indicador, porque `listTyping` tipa `displayName` como `string | null`; o exemplo do plano assumia presença garantida. Pequeno reforço defensivo, não uma mudança de comportamento planejado.
- Nenhuma alteração em `convex/typing.ts` — não é meu arquivo (`07-02` o possui nesta execução) e o plano já deixa explícito que a filtragem por idade não deve migrar para o servidor; o teste `convex/typing.test.ts` que pina esse comportamento ("linha antiga... este arquivo não filtra por idade") segue passando sem qualquer edição no arquivo de backend.

## Deviations from Plan

None - plan executado exatamente como escrito. As únicas diferenças em relação aos snippets do plano são o fallback de `displayName` citado acima (defensivo, não corretivo de um bug real observado) e a ausência de commits (constraint explícito desta execução, não do plano em si).

## Issues Encountered

None. `npm run typecheck`, `npm run build` e `npx vitest run` passaram de primeira, sem nenhum conflito percebido com os arquivos que os agentes irmãos (`07-02` em `convex/`, `07-03` em `voice-context.tsx`/`VoiceControlBar.tsx`/`AppShell.tsx`) possam estar editando em paralelo — nenhum desses arquivos foi tocado aqui.

## User Setup Required

None - nenhuma configuração de serviço externo.

## Next Phase Readiness

- CHAT-07 está implementado ponta a ponta (backend do 05-03 + UI deste plano), mas a verificação final com duas contas reais (janela não pode ser renderizada neste ambiente) fica para o checkpoint humano do plano 05-06, como já estava previsto no `<success_criteria>` deste plano.
- `MessageInput.tsx` permanece genérico o bastante para a Fase 6 (DM) reaproveitar sem qualquer ajuste — não recebe `channelId` nem importa Convex; basta não passar `onTyping` para manter o comportamento anterior a este plano.
- **Trabalho não commitado:** os três arquivos (`MessageInput.tsx`, `TypingIndicator.tsx` novo, `ConversationArea.tsx`) ficaram no working tree sem stage/commit, por instrução explícita de não rodar git nesta execução (agentes irmãos concorrentes). Alguém (orquestrador ou usuário) precisa revisar e commitar essas mudanças depois que os agentes irmãos (`07-02`, `07-03`) também terminarem, para não haver conflito de commit no meio da execução paralela.
- STATE.md não foi atualizado por este plano (fora do escopo de ownership desta execução) — precisa de atualização manual/por outro agente depois que os três planos em paralelo (05-05, 07-02, 07-03) consolidarem.

---
*Phase: 05-chat-em-tempo-real*
*Completed: 2026-08-19*
