---
phase: 07-voz
plan: 07
subsystem: voice
tags: [web-audio-api, react-hooks, convex-reactive-query, livekit, localStorage]

# Dependency graph
requires:
  - phase: 07-04
    provides: "voiceParticipantsByChannel (Convex query reativa de quem está num canal de voz)"
  - phase: 07-05
    provides: "voice-preferences.ts (localStorage de preferências de voz por máquina) e VoiceSettingsPopover.tsx"
provides:
  - "useVoiceJoinLeaveSounds() — hook que observa voiceStates via diff e toca sons sintetizados de entrada/saída"
  - "soundsEnabled em VoicePreferences, com toggle no painel de configurações"
  - "Quatro tons sintetizados via Web Audio API (self-join, self-leave, other-join, other-leave) — zero assets binários"
affects: [07-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sons de UI sintetizados em runtime via osciladores Web Audio API (sem asset binário, sem questão de licenciamento)"
    - "Diff de duas leituras consecutivas de uma query reativa do Convex (useRef<Set> como baseline) para detectar entrada/saída sem duplicar lógica de conexão"
    - "Supressão de evento por janela de graça (setTimeout + cancelamento) para filtrar flutuação de rede de um dado reconciliado por webhook"

key-files:
  created:
    - src/renderer/src/lib/voice-sounds.ts
  modified:
    - src/renderer/src/lib/voice-preferences.ts
    - src/renderer/src/components/shell/VoiceControlBar.tsx
    - src/renderer/src/components/shell/VoiceSettingsPopover.tsx

key-decisions:
  - "Sons sintetizados via Web Audio API em vez de arquivos .mp3 — instrução explícita do orquestrador: não é possível produzir áudio de qualidade de produção neste ambiente, e baixar sons de terceiros (estilo Discord) é risco de direito autoral inaceitável para um instalador distribuído."
  - "Quatro tons distintos (não dois) — o texto original do Plano 07-07 descrevia o MESMO arquivo voice-join.mp3 para 'eu entrei' e 'alguém entrou', o que contradiz o requisito de FEATURES.md ('distingue eu entrei de alguém entrou') e a instrução explícita do orquestrador. Resolvido com chime de duas notas para eventos do próprio usuário e sweep de nota única para eventos de terceiros, mantendo subida/descida como marcador de entrada/saída dentro de cada família."
  - "Identidade do próprio usuário lida de room.localParticipant.identity (via useVoice()), não de uma nova query Convex — o token do LiveKit já usa users._id como identity (documentado em voice-context.tsx/voiceToken.ts), e o plano proíbe tocar em convex/."
  - "Deafen respeitado sem nova plumbing: a própria linha do usuário autenticado já vem dentro da lista retornada por voiceParticipantsByChannel — basta localizá-la por userId e checar deafened, sem precisar de outra fonte de estado."
  - "Toggle 'Sons de entrada/saída de canal' implementado como Button binário (Ligado/Desligado) igual ao padrão já usado para o seletor de modo VAD/PTT — não existe componente Switch no projeto, e introduzir um só para isto seria escopo fora do plano."

patterns-established:
  - "Hooks de efeito colateral de áudio/notificação da fase de voz vivem em src/renderer/src/lib/, consomem useSelection()+useVoice() e são montados de dentro de VoiceControlBar (o 'centro de controles de voz'), nunca duplicando a fila de conexão do LiveKit."

# Metrics
duration: 45min
completed: 2026-08-19
---

# Phase 07 Plan 07: Sons de canal (VOICE-17) Summary

**Quatro tons de notificação sintetizados em runtime via Web Audio API (osciladores + envelope de ganho) tocam quando o próprio usuário ou outro participante entra/sai do canal de voz conectado, com toggle persistente em `voice-preferences.ts` e supressão de 2s contra flutuação de reconexão — sem nenhum asset de áudio binário no repositório.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2/2
- **Files modified:** 3 modificados, 1 criado

## Accomplishments

- `soundsEnabled: boolean` (default `true`) adicionado a `VoicePreferences`, persistido em `localStorage` junto com `mode`/`vadThreshold`, sem novo mecanismo de storage.
- `useVoiceJoinLeaveSounds()` — hook novo em `src/renderer/src/lib/voice-sounds.ts` — compara duas leituras consecutivas de `voiceParticipantsByChannel` (restrito ao `joinedVoiceChannelId`) e toca o tom certo na diferença, sem tocar em `Room`/lógica de conexão do LiveKit.
- Quatro tons sintetizados (nenhum arquivo `.mp3`): chime de duas notas ascendente/descendente para "eu entrei"/"eu saí", tom único ascendente/descendente para "alguém entrou"/"alguém saiu".
- Nenhum som toca para quem já está no canal no primeiro snapshot da query (evita "3 pessoas já dentro = 3 sons de entrada").
- No máximo um toque de som por tick de diff, mesmo com múltiplas entradas/saídas simultâneas no mesmo batch reativo.
- Saída sempre passa por uma janela de graça de 2s antes de soar — se o mesmo `userId` reaparecer dentro da janela (reconexão/flutuação de rede reconciliada pelo webhook do Plano 07-02), o som de saída é cancelado e a reentrada não conta como uma "entrada" nova.
- Deafen respeitado: se a própria linha do usuário autenticado (achada dentro da lista de participantes) estiver `deafened`, nenhum som toca — nem no momento da detecção, nem quando o timeout de saída agendada dispara (relê o estado mais recente).
- Toggle "Sons de entrada/saída de canal" adicionado a `VoiceSettingsPopover.tsx`, sempre visível (não depende de canal conectado, é preferência de máquina).

## Task Commits

Não commitado — `NO_GIT` no prompt de execução. Arquivos deixados no working tree para o orquestrador commitar:

1. **Task 1: Toggle de som nas preferências** — `src/renderer/src/lib/voice-preferences.ts`
2. **Task 2: Hook de diff de participantes + integração** — `src/renderer/src/lib/voice-sounds.ts` (novo), `src/renderer/src/components/shell/VoiceControlBar.tsx`, `src/renderer/src/components/shell/VoiceSettingsPopover.tsx`

## Files Created/Modified

- `src/renderer/src/lib/voice-sounds.ts` — hook `useVoiceJoinLeaveSounds()`, gerador de tons via Web Audio API, diff de participantes com baseline e janela de graça de reconexão.
- `src/renderer/src/lib/voice-preferences.ts` — `soundsEnabled` adicionado ao tipo, default e `sanitize()`.
- `src/renderer/src/components/shell/VoiceControlBar.tsx` — chama `useVoiceJoinLeaveSounds()`.
- `src/renderer/src/components/shell/VoiceSettingsPopover.tsx` — toggle "Sons de entrada/saída de canal".

## Decisions Made

Ver `key-decisions` no frontmatter — resumo: sons sintetizados (não `.mp3`) por instrução explícita de não baixar/produzir áudio com risco de direito autoral; quatro tons (não dois) para cumprir o requisito de distinguir "eu"/"outro" que o texto original do plano não cumpria; identidade própria lida de `room.localParticipant.identity` (sem nova query Convex); deafen lido da própria linha do usuário dentro do resultado já buscado.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 4 aplicado como Rule 2 por instrução explícita do orquestrador — não assets binários de áudio] `resources/sounds/voice-join.mp3`/`voice-leave.mp3` substituídos por tons sintetizados**

- **Found during:** Task 1
- **Issue:** O plano listava dois arquivos `.mp3` como artefato a criar em `resources/sounds/`. O ambiente de execução não pode produzir áudio de qualidade de produção nem baixar sons prontos — sons "estilo Discord" são conteúdo de terceiros com direito autoral, inaceitável num instalador distribuído. Esta é uma instrução explícita do prompt de execução (`<the_audio_assets_problem>`), não uma descoberta durante a execução, mas documentada aqui porque diverge do `files_modified` do frontmatter do plano.
- **Fix:** Nenhum arquivo binário criado. `voice-sounds.ts` gera os tons em runtime via `AudioContext`/`OscillatorNode`/`GainNode`.
- **Files modified:** `src/renderer/src/lib/voice-sounds.ts` (em vez de `resources/sounds/voice-join.mp3`, `resources/sounds/voice-leave.mp3`).
- **Verification:** `npm run build` empacota sem nenhum asset novo; comportamento sonoro real só é verificável por ouvido, no Plano 07-08 (Windows).

**2. [Rule 2 - Missing Critical] Quatro tons distintos em vez de dois, para cumprir "eu entrei" vs. "alguém entrou" distinguíveis**

- **Found during:** Task 2
- **Issue:** O texto da Task 2 do plano descrevia tocar o MESMO `voice-join.mp3` tanto para o próprio usuário quanto para outro participante entrando (idem para saída) — o que não cumpre o requisito de `FEATURES.md` ("distingue 'eu entrei' de 'alguém entrou'"), reforçado como crítico pelo prompt de execução (`<behaviour_that_research_flagged>`).
- **Fix:** Implementados dois pares de tons: chime de duas notas (mais rico/perceptível) para eventos do próprio usuário, tom único (mais discreto) para eventos de outro participante — subida/descida marca entrada/saída dentro de cada par.
- **Files modified:** `src/renderer/src/lib/voice-sounds.ts`.
- **Verification:** `npm run typecheck`/`npm run build` limpos; distinguibilidade de ouvido é verificação humana pendente (Plano 07-08).

---

**Total deviations:** 2 (ambas por instrução explícita do prompt de execução, não descobertas independentes — documentadas por completude e porque o `files_modified` do plano diverge do que foi de fato entregue).
**Impact on plan:** Sem scope creep — mesmo objetivo (VOICE-17), mesma superfície de arquivos além da troca de assets binários por síntese em runtime.

## Issues Encountered

- **Nenhuma query Convex expõe "usuário autenticado atual" para o renderer**, e o plano proíbe editar `convex/`. Resolvido observando que o `identity` do token LiveKit já é o `users._id` (documentado em `voice-context.tsx`/`voiceToken.ts`), então `room.localParticipant.identity` (via `useVoice()`, já usado por `VoiceControlBar`) serve como fonte de "quem sou eu" sem nenhuma query nova.
- **Ambiente de teste (`vitest.config.ts`) roda em `environment: 'edge-runtime'`**, sem DOM/`AudioContext`/`localStorage`. Não existiam testes prévios para `voice-preferences.ts` nem `vad.ts` (mesma classe de módulo, dependente de Web APIs de browser) — seguido o mesmo precedente: sem teste automatizado unitário para `voice-sounds.ts`, verificação fica para 07-08 (Windows real) e para os checks estáticos (typecheck/build/lint), que passam limpos.

## User Setup Required

None - nenhuma configuração de serviço externo. Nada a instalar (síntese via Web Audio API nativa do Chromium/Electron).

## Next Phase Readiness

**Pronto para 07-08 (verificação humana final em Windows, dez pessoas).** O que precisa ser confirmado por ouvido nessa etapa, especificamente para este plano:

1. **Distinção "eu entrei" vs. "alguém entrou"** — o chime de duas notas (self) deve soar nitidamente diferente do tom único (outro).
2. **Entrar num canal com gente já dentro não deve soar N vezes** — só o próprio "eu entrei" deve tocar; os já presentes, silêncio.
3. **Toggle desliga tudo** — com `soundsEnabled=false`, nenhum dos quatro sons deve tocar, em nenhum evento.
4. **Ensurdecer (deafen) silencia os sons** — com o próprio usuário ensurdecido, nenhum som de entrada/saída de terceiros deve ser ouvido, mesmo com o toggle ligado.
5. **Reconexão não deve produzir um "saiu" seguido de um "entrou" audíveis** — este é o caso mais provável de passar despercebido no código e ser notado só ao vivo: uma queda de wifi breve de alguém no canal (ou do próprio usuário reconectando via LiveKit) não deve soar como "fulano saiu, fulano entrou" se a reentrada acontecer dentro de ~2s. Se o webhook de reconciliação (Plano 07-02) demorar mais que isso para atualizar `voiceStates`, um "saiu" isolado e tardio ainda pode soar — comportamento aceito e documentado, não um bug a corrigir às pressas.
6. **Saída deliberada do próprio usuário não deve soar "eu saí"** — ao clicar o botão de desconectar, a intenção de canal vira `null` antes da query de participantes registrar a própria ausência, então nenhum som de auto-saída deve ser ouvido nesse fluxo comum (only a reconciliação anômala via webhook, com o usuário ainda "conectado" na UI mas removido da tabela, produziria esse som — cenário raro, não o caminho normal).

Nenhum bloqueio identificado para 07-08. `npm run typecheck`, `npm run build` e `npx vitest run` (173/173) passam limpos.

---
*Phase: 07-voz*
*Completed: 2026-08-19*
