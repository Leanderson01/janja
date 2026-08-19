---
phase: 07-voz
plan: 05
subsystem: voice
tags: [livekit-client, web-audio-api, vad, localstorage, shadcn, react-context]

# Dependency graph
requires:
  - phase: 07-03
    provides: "VoiceProvider (Room real do livekit-client), fila de transições, AudioCaptureOptions explícitas em todo call-site que habilita o microfone"
provides:
  - "voice-preferences.ts: leitura/escrita de preferências de voz (modo VAD/PTT, limiar) em localStorage, com merge parcial e fallback defensivo a default"
  - "vad.ts: motor de detecção de voz puro (Web Audio API, sem React/LiveKit), threshold-crossing com hold configurável para não cortar em pausas curtas"
  - "VoiceProvider.applyVoicePreferences()/setManualMute(): liga/desliga o VAD sem reconectar a sala, e impede que o VAD reabra o microfone quando o usuário mutou manualmente"
  - "VoiceSettingsPopover: painel de configurações (modo, limiar com medidor de nível ao vivo, seleção de microfone/saída) acessível pelo rodapé de controles"
  - "Attach real de toda RemoteAudioTrack via track.attach() no VoiceProvider — pré-requisito silencioso para switchActiveDevice('audiooutput', ...) e para o áudio remoto tocar de fato"
affects: ["07-06 (push-to-talk depende do módulo de preferências e de setManualMute)", "07-08 (verificação final humana em Windows)"]

# Tech tracking
tech-stack:
  added: ["radix-ui Popover/Slider/Select (via shadcn add, já usava o pacote unificado radix-ui)"]
  patterns:
    - "Preferência de máquina (não de conta) em localStorage puro, com módulo defensivo que nunca lança — mesmo padrão de src/main/auth/session-store.ts, adaptado para o renderer"
    - "Motor de domínio (vad.ts) desacoplado de React e de LiveKit: recebe MediaStreamTrack cru, devolve {stop, setThreshold}, quem decide o efeito colateral é quem chama"
    - "Ajuste de estado durante o render (padrão já usado em VoiceControlBar) para popular snapshot de dispositivos/preferências ao abrir um popover, em vez de setState síncrono dentro de useEffect"
    - "Mute manual como um ref booleano (manualMuteRef) que a lógica automática (VAD) sempre consulta antes de reabrir a track — evita que dois controladores de mic (usuário e VAD) fiquem sem prioridade definida"

key-files:
  created:
    - "src/renderer/src/lib/voice-preferences.ts"
    - "src/renderer/src/lib/vad.ts"
    - "src/renderer/src/components/shell/VoiceSettingsPopover.tsx"
    - "src/renderer/src/components/ui/popover.tsx"
    - "src/renderer/src/components/ui/slider.tsx"
    - "src/renderer/src/components/ui/select.tsx"
  modified:
    - "src/renderer/src/state/voice-context.tsx"
    - "src/renderer/src/components/shell/VoiceControlBar.tsx"

key-decisions:
  - "vad.ts implementa RMS sobre AnalyserNode.getFloatTimeDomainData manualmente (não a função utilitária createAudioAnalyser já embutida no livekit-client, que usa getByteFrequencyData) — o plano especifica a assinatura exata (MediaStreamTrack cru, {stop, setThreshold}) e pedia um módulo independente de LiveKit; usar o helper interno do SDK acoplaria vad.ts a LocalAudioTrack/RemoteAudioTrack e a uma métrica diferente (frequência, não RMS de tempo)."
  - "O medidor de nível do painel de configurações cria SEU PRÓPRIO createVadMonitor (threshold=2, nunca cruzado, só lê onLevel) em vez de expor os internals do monitor de VAD do VoiceProvider — mantém VoiceSettingsPopover.tsx desacoplado do provider, ao custo de até dois AudioContexts simultâneos apenas enquanto o painel está aberto (nenhum vazamento: ambos fecham ao fechar o painel)."
  - "Mute manual (botão do rodapé) sempre vence sobre o VAD: adicionado manualMuteRef + setManualMute() no VoiceContextValue, chamado por VoiceControlBar antes de qualquer chamada a setMicrophoneEnabled. Sem isso, mutar manualmente com VAD ativo seria revertido no instante seguinte em que a pessoa voltasse a falar — bug de correção (Regra 1), não estava no escopo textual do plano mas é consequência direta de ligar VAD e mute manual ao mesmo controlador de track."
  - "Attach real de RemoteAudioTrack via track.attach() adicionado ao VoiceProvider (não estava em nenhum plano anterior da fase) — investigação do research (07-RESEARCH.md §3) revelou que switchActiveDevice('audiooutput', ...) e RemoteAudioTrack.setVolume()/setSinkId() só afetam elementos JÁ ANEXADOS via attach(); sem isso, nenhum áudio remoto tocaria e a troca de saída de áudio não teria nenhum elemento para alcançar. Ver Deviations."
  - "Toggle de modo (VAD/PTT) implementado com dois botões simples (variant default/outline), não com o componente radio-group do shadcn — o plano oferecia 'radio/segmented control' como alternativas equivalentes; dois Button já cobrem o caso sem adicionar mais uma dependência de componente."

patterns-established:
  - "Preferências de máquina (voice-preferences.ts) como modelo para qualquer futura preferência local não-Convex: merge parcial sobre o valor persistido atual, sanitização defensiva de cada campo, nunca lança."
  - "AUDIO_CAPTURE_OPTIONS centralizado em voice-context.tsx — qualquer novo call-site que habilite o microfone (Plano 07-06/PTT incluso) deve importar a mesma constante, não duplicar o objeto literal."

# Metrics
duration: ~55min
completed: 2026-08-19
---

# Phase 07 Plan 05: VAD, Dispositivos e Preferências Summary

**VAD ligado por padrão sobre AnalyserNode com hold de 300ms, limiar/modo persistidos em localStorage e aplicados sem reconectar, seleção de microfone/saída via `switchActiveDevice`, e o gap silencioso de `track.attach()` que impedia o áudio remoto de tocar — fechado no mesmo plano.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3/3
- **Files modified:** 8 (6 criados: `voice-preferences.ts`, `vad.ts`, `VoiceSettingsPopover.tsx`, `popover.tsx`, `slider.tsx`, `select.tsx`; 2 modificados: `voice-context.tsx`, `VoiceControlBar.tsx`)

## Accomplishments

- `voice-preferences.ts`: `loadVoicePreferences()`/`saveVoicePreferences()` sobre
  `localStorage['janja:voice-preferences']`, com `DEFAULT_VOICE_PREFERENCES = { mode: 'vad', vadThreshold: 0.15 }`, sanitização defensiva por campo (nunca lança, mesmo com JSON corrompido ou valor fora de faixa) e merge parcial (mudar só o limiar não reseta o modo).
- `vad.ts`: `createVadMonitor(track, opts)` — `AnalyserNode` + RMS sobre
  `getFloatTimeDomainData`, laço via `requestAnimationFrame`. Cruzar para
  acima do limiar dispara `onSpeakingChange(true)` imediatamente; cruzar
  para abaixo aguarda `holdMs` (padrão 300ms) antes de `onSpeakingChange(false)`,
  para não cortar o mic em pausas curtas de respiração. `setThreshold()`
  ajusta em runtime; `stop()` fecha o `AudioContext` sem vazar. Extensão
  aditiva não pedida pelo plano: `onLevel?(level)` para o medidor de volume
  do painel de configurações reaproveitar a mesma leitura de RMS.
- `VoiceProvider` (`voice-context.tsx`): ao publicar o microfone com
  sucesso, chama `applyVoicePreferences()` — em modo VAD, desabilita a
  track e liga `createVadMonitor` sobre ela (o VAD é quem liga/desliga a
  partir daí); em modo PTT, não inicia nada (Plano 07-06 assume). O monitor
  é parado e nunca reaproveitado em toda transição de canal, desconexão
  inesperada, ou cleanup de hot-reload. `applyVoicePreferences()` é exposto
  em `useVoice()` para o painel de configurações reconfigurar em runtime
  sem reconectar (VOICE-13).
- `VoiceSettingsPopover.tsx`: popover no rodapé (ícone de engrenagem, só
  quando há intenção de canal) com toggle de modo, slider de limiar (0-1,
  desabilitado fora do modo VAD) com uma barra de nível ao vivo para
  calibrar vendo a própria voz, e dois `Select` (microfone/saída)
  populados via `Room.getLocalDevices(...)` e aplicados via
  `room.switchActiveDevice(...)` — nunca `room.disconnect()`/`connect()`.
- `VoiceControlBar.tsx`: adiciona o botão de engrenagem e passa a chamar
  `setManualMute(next)` em todo caminho que muta/ensurdece manualmente.

## Files Created/Modified

- `src/renderer/src/lib/voice-preferences.ts` - preferências de voz em localStorage, defensivo, merge parcial
- `src/renderer/src/lib/vad.ts` - motor de VAD puro sobre Web Audio API, com hold e `onLevel` opcional
- `src/renderer/src/components/shell/VoiceSettingsPopover.tsx` - painel de configurações de voz
- `src/renderer/src/components/ui/popover.tsx`, `slider.tsx`, `select.tsx` - componentes shadcn adicionados (`npx shadcn add`)
- `src/renderer/src/state/voice-context.tsx` - `applyVoicePreferences()`, `setManualMute()`, attach real de áudio remoto, `AUDIO_CAPTURE_OPTIONS` centralizado
- `src/renderer/src/components/shell/VoiceControlBar.tsx` - botão de engrenagem, sincronização de mute manual com o VAD

## Decisions Made

Ver `key-decisions` no frontmatter. Resumo dos pontos com mais impacto:

1. **VAD manual em vez do `createAudioAnalyser` embutido do livekit-client.**
   O SDK já expõe uma função utilitária equivalente, mas opera sobre
   `LocalAudioTrack | RemoteAudioTrack` (não `MediaStreamTrack` cru, como o
   plano especifica) e usa `getByteFrequencyData` (domínio de frequência),
   não a métrica RMS de domínio de tempo pedida. Implementar manualmente
   manteve `vad.ts` exatamente com a assinatura e independência de LiveKit
   que o plano define como artefato (`exports: ["createVadMonitor"]`).
2. **Mute manual sempre vence sobre o VAD** — a lacuna mais importante
   descoberta durante a execução, não estava explícita no texto do plano.
   Sem `manualMuteRef`/`setManualMute()`, mutar pelo botão do rodapé com
   VAD ativo seria silenciosamente revertido assim que a pessoa voltasse a
   falar (o `onSpeakingChange(true)` do VAD reabriria a track). Tratado
   como Regra 1 (bug de correção): o botão de mute precisa mutar de
   verdade, incondicionalmente, até o próprio usuário desmutar.
3. **`track.attach()` adicionado ao VoiceProvider — gap silencioso de todos
   os planos anteriores da fase.** Investigando a doc do LiveKit
   (07-RESEARCH.md §3, "todo elemento de áudio remoto do app precisa ser
   criado via `track.attach()`") e o código-fonte de `RemoteAudioTrack`,
   confirmei que `setVolume()`/`setSinkId()` só afetam
   `attachedElements` — a lista interna populada exclusivamente por
   `attach()`. Nenhum plano anterior (07-03, 07-04) chamava `attach()` em
   lugar nenhum: `VoiceControlBar` já ajustava `setVolume()` para
   deafen, mas sobre tracks que nunca tinham sido anexadas a um elemento —
   ou seja, **o áudio remoto nunca teria tocado**, e a troca de saída de
   áudio deste plano não teria nenhum elemento real para alcançar. Corrigido
   adicionando um listener de `TrackSubscribed`/`TrackUnsubscribed` no
   `VoiceProvider` que chama `track.attach()`/`track.detach()` sobre um
   `<div>` oculto anexado a `document.body` (mantém a referência viva sem
   poluir a árvore visual). Ver Deviations.
4. **Toggle de modo com dois `Button` simples**, não `radio-group` do
   shadcn — o plano oferece "radio/segmented control" como alternativas
   equivalentes; evitar mais uma dependência de componente para um caso que
   dois botões (`variant="default"` no ativo) já resolvem visualmente.
5. **`npx shadcn add popover slider select` escreveu num diretório literal
   `@/` na raiz do repo** (comportamento conhecido do CLI apontado no
   prompt de verificação) — movidos manualmente para
   `src/renderer/src/components/ui/` e o diretório `@/` removido.

## Deviations from Plan

### Auto-fixed Issues

**1. [Regra 2 - Funcionalidade crítica ausente] Áudio remoto nunca tocava — nenhum `track.attach()` em nenhum plano anterior**
- **Found during:** Task 3, ao implementar a troca de dispositivo de saída e revisar `07-RESEARCH.md §3` sobre a lacuna de `switchActiveDevice('audiooutput', ...)`
- **Issue:** `RemoteAudioTrack.setVolume()`/`.setSinkId()` só afetam elementos HTML já registrados via `track.attach()`. Nenhum código do app (07-03, 07-04) chamava `attach()` — o deafen (`setVolume(0/1)`) já rodava sobre tracks nunca anexadas, então tecnicamente nunca havia áudio de saída real para silenciar, e a seleção de saída deste plano não teria como alcançar nada.
- **Fix:** Novo efeito em `VoiceProvider` (`voice-context.tsx`) que escuta `RoomEvent.TrackSubscribed`/`TrackUnsubscribed`, chama `track.attach()`/`detach()` sobre um `<div style="display:none">` anexado a `document.body` (mantém referência viva, evita GC do elemento), incluindo uma varredura inicial de participantes já inscritos (higiene de hot-reload).
- **Files modified:** `src/renderer/src/state/voice-context.tsx`
- **Verification:** `npm run typecheck`, `npm run build`, `npx vitest run` (164/164). Áudio real só é verificável em Windows com dois participantes (Plano 07-08) — WSL2 não tem dispositivo de áudio nem janela.
- **Committed in:** não commitado (NO_GIT) — permanece como alteração não commitada em `voice-context.tsx`

**2. [Regra 1 - Bug] Mute manual seria revertido pelo VAD**
- **Found during:** Task 2, ao ligar `applyVoicePreferences()`/o monitor de VAD ao `VoiceProvider` e revisar o caminho de `toggleMuted`/`toggleDeafened` em `VoiceControlBar.tsx`
- **Issue:** Com VAD ativo, `onSpeakingChange(true)` chama `setMicrophoneEnabled(true)` incondicionalmente. Se o usuário tivesse acabado de mutar manualmente pelo botão do rodapé, a primeira vez que voltasse a falar o VAD reabriria o microfone silenciosamente — mute "não pegava" de verdade.
- **Fix:** `manualMuteRef` + `setManualMute()` expostos em `VoiceContextValue`; o VAD consulta `manualMuteRef.current` antes de reabrir a track (`if (speaking && manualMuteRef.current) return`). `VoiceControlBar` chama `setManualMute(next)` em `toggleMuted` e no caminho de mute implícito de `toggleDeafened`, sempre antes de tocar na track. Resetado para `false` a cada novo join bem-sucedido.
- **Files modified:** `src/renderer/src/state/voice-context.tsx`, `src/renderer/src/components/shell/VoiceControlBar.tsx`
- **Verification:** `npm run typecheck` limpo; leitura manual do fluxo confirma que `onSpeakingChange(true)` só chama `setMicrophoneEnabled` quando `manualMuteRef.current` é `false`. Comportamento fim-a-fim (falar com VAD ativo enquanto mutado) só é verificável com áudio real em Windows (Plano 07-08).
- **Committed in:** não commitado (NO_GIT)

**3. [Regra 3 - Bloqueio] `npx shadcn add` escreveu em `@/components/ui/` na raiz do repo**
- **Found during:** Task 3, ao instalar `popover`/`slider`/`select`
- **Issue:** O CLI do shadcn resolveu o alias `@/` como um diretório literal na raiz (`./@/components/ui/*.tsx`) em vez de `src/renderer/src/components/ui/`, apesar de `components.json` apontar o alias corretamente — comportamento já antecipado no prompt de verificação deste plano.
- **Fix:** Movidos os 3 arquivos para `src/renderer/src/components/ui/` e removido o diretório `@/` stray.
- **Files modified:** nenhum arquivo de conteúdo alterado, só localização
- **Verification:** `npm run typecheck`/`npm run build` resolvem os imports `@/components/ui/popover` etc. normalmente
- **Committed in:** não commitado (NO_GIT)

---

**Total deviations:** 3 auto-fixed (1 funcionalidade crítica ausente, 1 bug, 1 bloqueio de ferramenta)
**Impact on plan:** A Deviation 1 (attach real) é a mais significativa — sem ela, o áudio remoto simplesmente não tocaria em nenhuma configuração, tornando a troca de dispositivo de saída (o próprio objetivo deste plano) inobservável. Nenhum scope creep arquitetural: nenhuma das três exigiu nova tabela, nova lib ou mudança de contrato — todas dentro dos arquivos já listados no plano.

## Issues Encountered

- **`react-hooks/set-state-in-effect` em `VoiceSettingsPopover.tsx`**: a
  primeira versão chamava `setActiveInputId`/`setActiveOutputId`/`setPrefs`
  de forma síncrona dentro do `useEffect` que também disparava
  `enumerateDevices()`. Reestruturado para o mesmo padrão de "ajuste de
  estado durante o render" que `VoiceControlBar.tsx` já usa (comparar
  `open` com um espelho `syncedOpen`), mantendo só a parte genuinamente
  assíncrona (`Room.getLocalDevices`) dentro do `useEffect`. Não é uma
  regressão de nenhum plano anterior — só um erro de primeira tentativa
  corrigido antes de qualquer commit.
- **`react-refresh/only-export-components` em `voice-context.tsx`**:
  confirmado via `git stash`/lint que este erro já existia ANTES deste
  plano (mesma convenção do repo de exportar `Provider` + hook do mesmo
  arquivo, já presente em `selection-context.tsx` e assinalada como não-regressão
  no `07-03-SUMMARY.md`). Não corrigido — corrigir exigiria separar
  `VoiceProvider`/`useVoice` em arquivos distintos, mudança estrutural fora
  do escopo deste plano e inconsistente com o padrão já estabelecido no
  resto do código.
- Nenhum bloqueio de autenticação (CLI/API) — nada neste plano depende de
  credenciais externas.
- **Nenhuma verificação com áudio real** foi possível: WSL2 não tem
  dispositivo de áudio nem janela do Electron. `vad.ts` foi verificado
  manualmente fora do app com Web Audio API mockada (threshold-crossing
  imediato ao subir, hold de 300ms ao descer sem cortar pausas curtas
  `<300ms`, `setThreshold` em runtime, `stop()` sem vazar o loop de
  `requestAnimationFrame`) — script descartável, não commitado no repo.
  `voice-preferences.ts` foi verificado manualmente com um `localStorage`
  mockado (default, merge parcial, JSON corrompido nunca lança, clamp de
  valor fora de faixa). Nenhum dos dois foi adicionado como teste
  `vitest` formal porque o `vitest.config.ts` do projeto roda em
  `environment: 'edge-runtime'` (sem DOM/`localStorage`/`AudioContext`
  reais) — adicionar jsdom só para dois arquivos ficaria fora do escopo de
  arquivos deste plano e afetaria a configuração global de testes do
  projeto.

## User Setup Required

None - nenhuma configuração externa nova. Toda a superfície deste plano é
local (localStorage do renderer) ou já configurada em planos anteriores
(credenciais do LiveKit, Plano 07-00).

## Next Phase Readiness

**Pronto para 07-06 (push-to-talk):**
- `voice-preferences.ts` já define `VoiceMode = 'vad' | 'ptt'` e persiste a
  escolha — 07-06 só precisa ler o modo e ligar o hook nativo de teclado
  quando `mode === 'ptt'`.
- `setManualMute()` e `AUDIO_CAPTURE_OPTIONS` (centralizados em
  `voice-context.tsx`) são a superfície que 07-06 deve reaproveitar para
  manter a mesma prioridade de mute manual sobre qualquer controlador
  automático da track (VAD hoje, PTT depois).
- `applyVoicePreferences()` já sabe não iniciar nada quando o modo é
  `'ptt'` — 07-06 assume a partir daí sem precisar tocar na lógica de VAD.

**Não verificado neste plano (ambiente WSL2 sem dispositivo de áudio nem
janela) — todos pendentes do Plano 07-08 com dois clientes Windows reais:**
- Que o VAD de fato liga/desliga o microfone ao falar/parar de falar com
  um microfone real, incluindo a sensação do `holdMs` de 300ms em uso
  real (não só na simulação com Web Audio API mockada).
- Que trocar microfone ou saída de áudio pelo painel de configurações não
  derruba a chamada (a chamada de API `room.switchActiveDevice` nunca é
  seguida de `disconnect()`/`connect()` no código — confirmável por leitura,
  mas o efeito real do dispositivo trocando precisa de hardware).
- Que `track.attach()` (Deviation 1) de fato faz o áudio remoto tocar e
  que a troca de saída alcança esses elementos — é o teste mais importante
  pendente desta fase, porque nenhum plano anterior tinha essa cobertura.
- Que o slider de limiar calibra de forma útil contra ruído de fundo real
  (teclado mecânico, ventilador) — o valor default `0.15` é um chute de
  partida documentado, não calibrado contra hardware real.
- `localStorage.getItem('janja:voice-preferences')` sobrevivendo a um
  reinício completo do app (não só F5 do renderer) — só testável com a
  janela do Electron aberta.

---
*Phase: 07-voz*
*Completed: 2026-08-19*
