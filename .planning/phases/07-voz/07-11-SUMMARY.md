---
phase: 07-voz
plan: 11
subsystem: voice
tags: [web-audio-api, react-hooks, livekit, localStorage]

# Dependency graph
requires:
  - phase: 07-07
    provides: "voice-sounds.ts (síntese de tons via Web Audio API), soundsEnabled em voice-preferences.ts"
  - phase: 07-05
    provides: "voice-context.tsx (setManualMute, ciclo de vida do Room/VAD)"
provides:
  - "playMuteStateChangeTone(muted) — tom de mute/desmute do PRÓPRIO microfone, disparado só no toggle manual (botão do rodapé)"
  - "playSelfLeaveTone exportado e chamado direto da transição de saída em voice-context.tsx — corrige defeito onde a saída própria nunca soava"
  - "setDeafened(deafened) em VoiceContextValue — espelha ensurdecer em voice-context.tsx, mesmo padrão de setManualMute"
affects: [07-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Evento de INTENÇÃO do usuário dispara som no ponto da ação (toggle manual, transição de saída), nunca por observação posterior de um dado reativo — reafirmado duas vezes neste plano (mute e saída própria) depois de um defeito real causado por depender de diff de query para um evento que é, por natureza, uma ação e não um dado observável depois do fato."
    - "ToneNote ganhou waveform/gain opcionais em voice-sounds.ts — família de tons de mute usa 'triangle' + duração/volume menores, deliberadamente diferente da família 'sine' de entrada/saída de canal, para não serem confundidas de ouvido."

key-files:
  created: []
  modified:
    - src/renderer/src/lib/voice-sounds.ts
    - src/renderer/src/state/voice-context.tsx
    - src/renderer/src/components/shell/VoiceControlBar.tsx

key-decisions:
  - "Tom de mute/desmute dispara SÓ em toggleMuted() de VoiceControlBar.tsx — nunca em voice-context.tsx (VAD/push-to-talk), que ligam/desligam a track a cada fala/tecla. Disparar lá tocaria em todo utterance, inutilizável. É o requisito mais importante desta tarefa."
  - "Ensurdecer NÃO toca o tom de mute, mesmo implicando mute no servidor. Decisão deliberada: (1) o evento real ali é 'eu ensurdeci', não 'eu me mutei' — o usuário não apertou o botão de microfone, apertou o de fone; (2) quem acabou de ensurdecer pediu explicitamente para não ouvir mais nada agora, então tocar QUALQUER som de confirmação nesse instante contraria o próprio pedido."
  - "Tons de mute/desmute usam onda 'triangle' (não 'sine', usada pelas quatro notas de entrada/saída), nota única muito mais curta (60ms vs. 90-140ms) e mais baixa em volume — diferença de timbre inteira, não só de pitch, para não confundir 'eu me mutei' com 'alguém saiu' de ouvido numa call ao vivo. Também mais discreto de propósito: mutar acontece dezenas de vezes por sessão, entrar/sair de canal não."
  - "Defeito real descoberto durante a tarefa (relatado pelo usuário, confirmado por leitura de código antes de corrigir): a saída do PRÓPRIO usuário nunca tocava som. Causa raiz: `useVoiceJoinLeaveSounds` usa `useQuery(..., joinedVoiceChannelId ? {...} : 'skip')` — no instante em que o usuário sai, `joinedVoiceChannelId` vira `null` e a query passa a `'skip'` no MESMO tick, então nunca existe um snapshot seguinte mostrando a lista sem ele para o diff comparar. Mesmo que existisse, a janela de graça de 2s (`RECONNECT_GRACE_MS`, correta para a saída de OUTROS, que é dado observado por webhook e pode ser flutuação de rede) não faz sentido para uma ação própria e imediata."
  - "Correção: `playSelfLeaveTone` passou a ser exportado de voice-sounds.ts e chamado DIRETO de voice-context.tsx, no ponto exato da transição de saída (antes de `leaveVoiceChannelMutation`/`room.disconnect()`), sem janela de graça — mesmo princípio do tom de mute: evento de intenção dispara na intenção, não no efeito colateral observado depois. O caso de saída própria foi removido do diff em voice-sounds.ts (filtrado de `leftIds`) para não haver dois caminhos concorrentes tentando tocar o mesmo som."
  - "Disparo cobre tanto desconexão de verdade (`target === null`, clique no botão de sair) quanto troca direta de canal (`target !== null`, join ao canal novo roda logo em seguida) — nos dois casos a sessão de voz anterior de fato terminou, e o bloco de código onde o fix vive (`if (activeChannelRef.current !== null)`) roda igualmente nos dois casos. Não foi restrito a `target === null` porque o defeito relatado é sobre 'sair do canal', que troca de canal também satisfaz na prática (a call anterior acabou)."
  - "Novo `setDeafened(deafened)` em VoiceContextValue + `deafenedRef` em voice-context.tsx, mesmo padrão já existente de `setManualMute`/`manualMuteRef` — necessário porque o novo disparo de `playSelfLeaveTone` vive em voice-context.tsx, que não tinha acesso a estado de ensurdecer (isso vivia só localmente em VoiceControlBar.tsx). Resetado a `false` a cada novo join bem-sucedido, mesma linha de base de `manualMuteRef`."
  - "Import circular aceito entre voice-sounds.ts (já importava useVoice de voice-context.tsx) e voice-context.tsx (agora importa playSelfLeaveTone de voice-sounds.ts): ambos os módulos só usam a exportação um do outro dentro de corpos de função/efeito, nunca em tempo de avaliação do módulo, e ambas as funções são function declarations (hoisted) — build e typecheck confirmam que não há problema em runtime. Preferido a duplicar a lógica de síntese de tom em voice-context.tsx, o que violaria a posse de arquivo ('você é dono de voice-sounds.ts')."

patterns-established:
  - "Toda vez que um som de voz representa uma AÇÃO do usuário (mute manual, saída própria) — em oposição a um EVENTO OBSERVADO sobre outra pessoa (alguém entrou/saiu) — o disparo mora no ponto exato da ação, não num diff de query reativa. Diff de query continua correto só para eventos de terceiros, onde a janela de graça contra flutuação de rede faz sentido."

# Metrics
duration: 40min
completed: 2026-08-19
---

# Phase 07 Plan 11: Sons de mute/desmute + correção do som de saída própria Summary

**Dois tons novos (mute/desmute do próprio microfone, síntese Web Audio API em onda triangular, disparados só no toggle manual do botão do rodapé) e correção de um defeito real onde a saída do próprio usuário nunca tocava som — causa raiz era o diff de `useVoiceJoinLeaveSounds` depender de uma query que vira `'skip'` no exato instante em que o usuário sai, então o evento de saída própria passou a ser disparado direto do ponto de transição em `voice-context.tsx`, sem passar mais pelo diff.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2 (tom de mute/desmute + correção do som de saída própria)
- **Files modified:** 3

## Accomplishments

- `playMuteStateChangeTone(muted)` — exportado de `voice-sounds.ts`, tom único de onda `triangle` (320Hz para mutar, 720Hz para desmutar), 60ms, volume reduzido (`MUTE_TONE_PEAK_GAIN = 0.1`) — deliberadamente diferente em timbre e não só em pitch das quatro notas `sine` de entrada/saída de canal já existentes (07-07).
- Chamado SÓ em `toggleMuted()` de `VoiceControlBar.tsx` (o clique real no botão de microfone) — confirmado por leitura de `voice-context.tsx` que nenhum dos dois outros caminhos que ligam/desligam a track (VAD em `startVadMonitor`, push-to-talk em `onPttKeyDown`/`onPttKeyUp`) chama a mutation `setMuted`/passa por este código — eles comandam a track do LiveKit diretamente, sem tocar em `toggleMuted`.
- Ensurdecer (`toggleDeafened`) NUNCA chama o novo tom, mesmo no ramo que implica mute no servidor — decisão deliberada, ver `key-decisions`.
- **Defeito real corrigido:** saída do próprio usuário (clique em "Desconectar" ou troca de canal de voz) nunca tocava som — confirmado a causa raiz por leitura de código antes de alterar: a query de `useVoiceJoinLeaveSounds` vira `'skip'` no mesmo tick em que `joinedVoiceChannelId` fica `null`, então o diff nunca alcança um snapshot mostrando a ausência do próprio usuário.
- `playSelfLeaveTone` passou a ser `export`ado de `voice-sounds.ts` e chamado direto de `voice-context.tsx`, no ponto exato da transição de saída (dentro do bloco que executa `leaveVoiceChannelMutation`/`room.disconnect()`, antes desses dois rodarem) — sem janela de graça de 2s, porque é uma ação do usuário, não um dado observado.
- O diff de `voice-sounds.ts` deixou de tentar detectar a saída do próprio usuário (`leftIds` agora filtra `selfId` antes de agendar qualquer som de saída) — evita dois caminhos concorrentes tentando tocar o mesmo som.
- Novo `setDeafened(deafened)` em `VoiceContextValue`/`deafenedRef` em `voice-context.tsx`, mesmo padrão de `setManualMute`/`manualMuteRef` já existente — permite ao novo disparo de saída própria checar `soundsEnabled` e `!deafened` no momento exato da saída, sem precisar de uma query nova.

## Files Created/Modified

- `src/renderer/src/lib/voice-sounds.ts` — `ToneNote` ganhou `waveform`/`gain` opcionais; `playMuteTone`/`playUnmuteTone`/`playMuteStateChangeTone` (exportado) novos; `playSelfLeaveTone` passou a ser `export`ado; diff de saída (`leftIds`) filtra `selfId` e não toca mais som para a saída própria.
- `src/renderer/src/state/voice-context.tsx` — `deafenedRef` + `setDeafened` (novo, no valor do contexto); chamada de `playSelfLeaveTone()` no ponto da transição de saída, gated por `soundsEnabled` e `!deafenedRef.current`; `deafenedRef.current = false` resetado a cada novo join bem-sucedido (mesma linha de `manualMuteRef`).
- `src/renderer/src/components/shell/VoiceControlBar.tsx` — `toggleMuted()` chama `playMuteStateChangeTone(next)` e `setDeafened(false)` quando desmutar também desensurdece; `toggleDeafened()` chama `setDeafened(next)` a cada toggle.

## Decisions Made

Ver `key-decisions` no frontmatter. Resumo: (1) tom de mute só no toggle manual, nunca em VAD/PTT — requisito mais crítico da tarefa; (2) deafen não toca o tom de mute, por ser um evento diferente e porque quem ensurdece pediu silêncio; (3) tons de mute usam timbre `triangle` + duração/volume menores para não se confundir com entrada/saída de canal; (4) o som de saída própria (defeito reportado) foi movido do diff reativo para o ponto de ação em `voice-context.tsx`, sem janela de graça, cobrindo tanto desconexão real quanto troca direta de canal.

## Deviations from Plan

Não há PLAN.md formal para esta tarefa (pedido direto do usuário, escopo pequeno). O escopo cresceu durante a execução por instrução explícita do orquestrador, não por descoberta independente:

**1. [Instrução explícita do orquestrador, aplicada como Rule 1 — bug real] Correção do som de saída própria ausente**

- **Found during:** revisão do orquestrador em paralelo à implementação do tom de mute, comunicada como mensagem intermediária.
- **Issue:** a saída do próprio usuário do canal de voz nunca tocava som, apesar de 07-07 alegar que o caso estava coberto. Causa raiz confirmada por leitura de código (ver `key-decisions`): a query de participantes vira `'skip'` no mesmo tick em que a intenção de canal vira `null`, então o diff reativo nunca alcança um snapshot com o próprio usuário ausente.
- **Fix:** `playSelfLeaveTone` exportado de `voice-sounds.ts`, chamado direto do ponto de transição de saída em `voice-context.tsx` (não mais via diff), sem janela de graça. Caso removido do diff de `voice-sounds.ts` para não haver dois caminhos concorrentes.
- **Files modified:** `src/renderer/src/lib/voice-sounds.ts`, `src/renderer/src/state/voice-context.tsx`.
- **Verification:** `npm run typecheck`, `npm run build` e `npx vitest run` (173/173) passam limpos. Comportamento sonoro real (incluindo se o som toca corretamente ao clicar "Desconectar" e ao trocar de canal) é verificação humana pendente — ver `User Setup Required`/`Next Phase Readiness` abaixo.

---

**Total deviations:** 1 (instrução explícita do orquestrador durante a execução, não descoberta independente — documentada por completude).
**Impact on plan:** Sem scope creep injustificado — o próprio orquestrador identificou e pediu a correção, dentro do mesmo tema (sons de voz) e nos mesmos arquivos já sob posse desta tarefa.

## Issues Encountered

- **Import circular entre `voice-sounds.ts` e `voice-context.tsx`:** `voice-sounds.ts` já importava `useVoice` de `voice-context.tsx` (desde 07-07); a correção do som de saída própria exigiu o caminho inverso (`voice-context.tsx` importando `playSelfLeaveTone` de `voice-sounds.ts`). Resolvido sem problema: ambos os módulos só usam a exportação um do outro dentro de corpos de função (nunca em tempo de avaliação do módulo), e as duas funções são `function` declarations (hoisted) — `npm run build` (bundle via electron-vite/Rollup) e `npm run typecheck` confirmam que não há erro nem warning de dependência circular quebrada em runtime.
- **Nenhum teste automatizado novo:** mesmo precedente de 07-07 — `vitest.config.ts` roda em `environment: 'edge-runtime'`, sem DOM/`AudioContext`/`localStorage`, então `voice-sounds.ts` e `voice-context.tsx` continuam sem cobertura unitária direta. Verificação fica para checks estáticos (limpos) e para confirmação humana em Windows.

## User Setup Required

None — nenhuma configuração de serviço externo. Nada a instalar.

## Next Phase Readiness

**O que precisa ser confirmado por ouvido no Windows, especificamente para esta tarefa:**

1. **Tom de mute/desmute toca ao clicar no botão de microfone** — som curto, diferente em timbre (mais "seco"/curto) dos quatro tons de entrada/saída de canal já existentes (07-07), não confundível com "alguém saiu".
2. **CRÍTICO — o tom de mute NÃO deve tocar em nenhuma transição automática da track:** falar em modo VAD (o mic liga/desliga sozinho a cada frase) e segurar/soltar a tecla de push-to-talk NÃO devem produzir nenhum som de mute/desmute, em nenhuma repetição. Se isso tocar a cada utterance, é regressão grave — o requisito mais importante desta tarefa.
3. **Ensurdecer não toca o tom de mute** — clicar no botão de fone (ensurdecer), mesmo sabendo que isso também muta no servidor, não deve produzir nenhum som de mute.
4. **Desmutar enquanto ensurdecido toca o tom de desmute normalmente** (esse caminho passa por `toggleMuted`, uma ação manual real) e também desensurdece — confirmar que os dois efeitos (desmutar + desensurdecer) acontecem juntos sem som duplicado.
5. **Toggle "Sons de entrada/saída de canal" desliga também o tom de mute** — com a preferência desligada, nenhum dos seis sons (quatro de canal + dois de mute) deve tocar.
6. **Correção do defeito relatado — sair do canal agora deve soar:** clicar "Desconectar" deve tocar o chime de "eu saí" (duas notas, descendente) imediatamente, sem atraso perceptível de 2s (a janela de graça foi removida para este caso específico).
7. **Trocar diretamente de um canal de voz para outro** (sem clicar em desconectar) também deve tocar "eu saí" do canal antigo, seguido, pouco depois, de "eu entrei" no canal novo — confirmar que os dois não soam sobrepostos/confusos.
8. **Ensurdecido e clicando em "Desconectar" não deve tocar nenhum som** — nem o de saída própria.

Nenhum bloqueio identificado. `npm run typecheck`, `npm run build` e `npx vitest run` (173/173) passam limpos.

---
*Phase: 07-voz*
*Completed: 2026-08-19*
