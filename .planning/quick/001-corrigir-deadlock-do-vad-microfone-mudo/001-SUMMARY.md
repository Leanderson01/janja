---
phase: quick/001-corrigir-deadlock-do-vad-microfone-mudo
plan: 001
subsystem: voice
tags: [livekit, webrtc, web-audio, vad, mediastreamtrack, react]

requires:
  - phase: 07-05
    provides: monitor de VAD (lib/vad.ts) e painel de configuracoes de voz
  - phase: 07-06
    provides: push-to-talk e o contrato `applyVoicePreferences()` sincrono
provides:
  - VAD analisando um clone da track publicada, imune ao mute do LiveKit
  - Ordenacao fail-open (monitor de pe antes de qualquer mute)
  - Cleanup do clone em 6 caminhos, incluindo falha no meio do setup
  - VAD seguindo troca de microfone (RoomEvent.ActiveDeviceChanged)
  - Medidor de nivel do painel lendo fonte viva
affects: [07-08, 09-03]

tech-stack:
  added: []
  patterns:
    - "Track de analise clonada: quem SILENCIA uma track nunca pode ser quem a ANALISA"
    - "Fail-open em setup de captura: falha deixa o microfone aberto com erro, nunca mudo silencioso"
    - "Contador de geracao (vadGenerationRef) para invalidar setup assincrono interrompido por teardown"
    - "ownsTrack: so para a track que voce mesmo criou; track emprestada tem dono"

key-files:
  created:
    - .planning/quick/001-corrigir-deadlock-do-vad-microfone-mudo/001-SUMMARY.md
  modified:
    - src/renderer/src/state/voice-context.tsx
    - src/renderer/src/components/shell/VoiceSettingsPopover.tsx

key-decisions:
  - "Clone da track publicada em vez de segundo getUserMedia: nao abre dispositivo novo (sem NotReadableError em drivers Windows de modo exclusivo), e sincrono, herda AUDIO_CAPTURE_OPTIONS da captura original e nao pode divergir dela — VOICE-16 continua satisfeito sem um terceiro call-site"
  - "getVadAnalysisTrack com useCallback deps [] — o medidor do painel usa a funcao como dependencia de efeito; instavel derrubaria e recriaria um AudioContext a cada render do provider"
  - "ActiveDeviceChanged nao pode entrar em loop: todos os emit sites do livekit-client 2.22 sao guardados por mudanca real de deviceId; mutar via setMicrophoneEnabled nao republica a track"

patterns-established:
  - "Fonte de analise != fonte de publicacao: qualquer medidor/detector ligado na track que o SDK muta le silencio digital"
  - "Toda captura/clone aberto tem caminho de parada em 100% dos caminhos, inclusive no catch do meio do setup"

duration: ~35min
completed: 2026-08-19
tasks_completed: 2
tasks_total: 3
status: aguardando checkpoint humano (Task 3, Windows nativo)
---

# Quick 001: deadlock do VAD (microfone mudo) — Summary

**O VAD deixou de analisar a mesma `MediaStreamTrack` que ele manda o LiveKit
silenciar: passa a ler um `clone()` vivo, com `enabled` proprio, e so muta a
publicacao depois de o monitor estar de pe.**

## Performance

- **Duracao:** ~35 min
- **Tasks:** 2 de 3 (a Task 3 e checkpoint humano em Windows nativo — nao executada)
- **Arquivos modificados:** 2

## O defeito

Em modo `vad` (o padrao de todo usuario novo), `startVadMonitor` ligava o
`AnalyserNode` na `MediaStreamTrack` **da publicacao do LiveKit**. Em
`livekit-client` 2.22, `LocalTrack.setTrackMuted` faz
`this._mediaStreamTrack.enabled = !muted` — e track com `enabled = false`
entrega **silencio digital** ao Web Audio, nao "menos volume".

Deadlock: microfone fechado pelo VAD -> RMS ~= 0 -> limiar (0.15) nunca cruzado
-> `onSpeakingChange(true)` nunca dispara -> microfone nunca reabre. Usuario
permanentemente mudo, sem nenhum erro visivel.

Falha secundaria no mesmo caminho: `setMicrophoneEnabled(false)` era disparado
**sem `await` e antes** de `startVadMonitor`, que por sua vez tinha um
`if (!mediaStreamTrack) return` silencioso — se a publicacao ainda nao existisse,
o mute ja tinha acontecido e nenhum monitor era criado. Mudo identico, igualmente
silencioso.

## Accomplishments

### Task 1 — VAD sobre track de analise clonada (commit `fcecbed`)

- `vadAnalysisTrackRef`: o clone vivo da track publicada. Compartilha a MESMA
  fonte de captura (mesmo dispositivo, mesmo `getUserMedia`, mesmo
  eco/ruido/ganho de `AUDIO_CAPTURE_OPTIONS`), mas tem `enabled` proprio e
  independente. **Nunca e publicado** — so vai para `createVadMonitor`, que e
  Web Audio puro e nao liga nada ao `destination`. O LiveKit continua publicando
  exatamente uma track de microfone.
- `startVadMonitor` agora retorna `boolean` e **nunca retorna em silencio**:
  sem publicacao, falha de `clone()`, clone morto (`readyState !== 'live'`) ou
  falha de `createVadMonitor` -> `console.error` com "microfone permanece
  ABERTO" e `false`.
- Sucesso loga `[voice] VAD ativo sobre clone de analise da track publicada` —
  e o que torna o checkpoint em Windows diagnosticavel pelo DevTools sem outra
  rodada de ida e volta.
- `applyVoicePreferences` virou par sync/async. A ordem obrigatoria agora e
  **obter track -> clonar -> iniciar monitor -> so entao mutar**; o mute so
  roda se `startVadMonitor` devolveu `true`. O join (`await
  applyVoicePreferencesAsync()`) so termina com o estado de transmissao de fato
  aplicado.
- `vadGenerationRef`, incrementado por todo `stopVadMonitor()`, invalida um
  `applyVoicePreferencesAsync` que passou por um `await` e teve seu monitor
  derrubado no meio por leave/troca de canal/troca de modo/desmonte.
- `manualMuteRef` intacto: a guarda `if (speaking && manualMuteRef.current)
  return` continua identica dentro de `onSpeakingChange`.
- VOICE-16 intacto: nenhum `getUserMedia` novo foi introduzido — o clone herda
  o processamento da captura original, e todos os call-sites existentes
  continuam passando `AUDIO_CAPTURE_OPTIONS`.

### Task 2 — fonte de analise segue o dispositivo; medidor le fonte viva (commit `a20786a`)

Duas pontas da MESMA classe de defeito: analisar uma fonte que nao representa o
audio real.

- **`RoomEvent.ActiveDeviceChanged`** registrado no efeito de listeners do
  `Room`, guardado por `kind === 'audioinput'` (trocar a SAIDA nao pode
  reiniciar o VAD a toa) e por `activeChannelRef.current !== null`. Reinstala
  monitor e clone pelo caminho unico de `applyVoicePreferences`. Sem ele o clone
  ficava preso ao microfone ANTIGO: o VAD decidiria "esta falando" ouvindo um
  dispositivo abandonado, e ainda manteria esse dispositivo aberto.
  `room.off(...)` correspondente no cleanup do mesmo efeito.
- **`getVadAnalysisTrack`** no `VoiceContextValue`, com TSDoc explicito de que o
  dono e o provider e que quem consome **nao pode** chamar `.stop()` nela.
- **Medidor do painel** (`VoiceSettingsPopover`): prefere a track de analise do
  provider (`readyState === 'live'`), e so se ela nao existir (modo PTT) clona a
  publicada. `ownsTrack` decide quem pode parar a track no cleanup — a do
  provider **nunca** e parada ao fechar o painel. `prefs.mode` e `activeInputId`
  entraram nas deps do efeito.

## Deviations from Plan

**1. [Regra 1 — Bug] `getVadAnalysisTrack` precisou de `useCallback`**

- **Encontrado em:** Task 2, ao adicionar a funcao as deps do efeito do medidor.
- **Problema:** o plano especificava
  `getVadAnalysisTrack: () => vadAnalysisTrackRef.current` inline no objeto
  `value`. O `value` e recriado a cada render do provider, entao a funcao seria
  uma referencia nova a cada render — e como o plano tambem manda usa-la no
  efeito do medidor, o efeito derrubaria e recriaria um `AudioContext` a **cada
  render** enquanto o painel estivesse aberto.
- **Correcao:** `const getVadAnalysisTrack = useCallback(() => vadAnalysisTrackRef.current, [])`,
  estavel por toda a vida do provider (le so uma ref). `useCallback` adicionado
  ao import de `react`.
- **Arquivo:** `src/renderer/src/state/voice-context.tsx`
- **Commit:** `a20786a`

## Revisao de cleanup do clone (conferida por leitura, exigida pelo plano)

`stopVadMonitor()` agora para o monitor **e** o clone. Call-sites conferidos no
arquivo apos as duas tasks:

| # | Caminho | Onde |
|---|---|---|
| a | Saida do canal / troca de canal | `stopVadMonitor()` na transicao de leave da fila serializada |
| b | `RoomEvent.Disconnected` inesperado | dentro de `handleDisconnected`, no ramo `activeChannelRef.current !== null` |
| c | Desmonte do provider | cleanup do efeito de listeners do `Room` |
| d | Troca de modo VAD -> PTT | topo de `applyVoicePreferencesAsync`, antes do `return` de `prefs.mode !== 'vad'` |
| e | Reaplicacao de preferencias (limiar, troca de dispositivo) | mesmo ponto de (d) |
| f | Falha no meio de `startVadMonitor` | `analysisTrack.stop()` no ramo de `readyState` morto e no `catch` de `createVadMonitor`, ambos antes de `return false` |

No painel, `if (ownsTrack) meterTrack.stop()` — a unica `.stop()` de track do
componente, e so sobre o clone que ele mesmo criou.

## Verificacao — o que foi de fato rodado

```
$ npm run typecheck:web
> tsc --noEmit -p tsconfig.web.json --composite false
(sem saida — limpo)

$ npx vitest run
Test Files  15 passed (15)
     Tests  173 passed (173)
```

`npm run lint` **ja falhava antes desta mudanca** e continua falhando pelos
mesmos motivos pre-existentes. Baseline medido no commit `cb232ce` (com `git
stash`, antes de qualquer edicao) e depois das duas tasks:

| | problems | errors | warnings |
|---|---|---|---|
| Baseline (`cb232ce`) | 428 | 81 | 347 |
| Depois das Tasks 1 e 2 | 428 | 81 | 347 |

Ou seja: **zero achados novos** introduzidos. Os dois arquivos tocados nao tem
nenhuma pendencia atribuivel a esta mudanca — `VoiceSettingsPopover.tsx` esta
sem nenhum achado, e o unico achado de `voice-context.tsx` e o
`react-refresh/only-export-components` do export de `useVoice`, que ja existia.
Uma unica advertencia de `prettier` introduzida pela Task 1 foi corrigida com
`npx prettier --write` no arquivo antes do commit.

Greps de verificacao exigidos pelo plano, saida real:

- `clone()` criado em `startVadMonitor` (linha 283) e clone parado em
  `stopVadMonitor` (linha 260).
- `startVadMonitor` (linha 369) vem ANTES de
  `setMicrophoneEnabled(false, ...)` (linha 380) em
  `applyVoicePreferencesAsync` — nunca o contrario. A outra ocorrencia de
  `setMicrophoneEnabled(false` (linha 523) e o keyup do PTT, nao tocado.
- `RoomEvent.ActiveDeviceChanged` registrado (linha 526) e removido no cleanup
  (linha 533).
- No painel: `getVadAnalysisTrack()` na linha 125, `clone()` na 134,
  `if (ownsTrack) meterTrack.stop()` na 160.

## NAO verificado — pendente de Windows nativo (Task 3)

Este ambiente e WSL2: **nao existe microfone, nem Windows, nem alto-falante**.
Nada abaixo foi provado, e nada abaixo pode ser inferido de typecheck/testes
verdes (HANDOFF, licao nº 1: "verificar no ambiente errado nao e verificar";
licao nº 2: "build verde nao significa app funcionando"):

1. Perfil limpo (sem `janja:voice-preferences` no localStorage), entrar no canal
   e falar sem tocar em nada -> o outro participante ouve. **Este e o caso do
   bug.**
2. Console mostra `[voice] VAD ativo sobre clone de analise da track publicada`
   e nenhuma linha `[voice] VAD:` de erro.
3. Mute manual continua vencendo o VAD.
4. PTT -> VAD na mesma call volta a transmitir.
5. Troca de microfone com o VAD ativo passa a ouvir o dispositivo NOVO.
6. Medidor de nivel do painel se mexe em modo VAD.
7. Nenhum microfone continua aberto apos sair do canal / trocar de modo /
   trocar de dispositivo (icone de microfone em uso do Windows some).
8. Sem eco novo nem audio duplicado com duas maquinas de alto-falante ligado.

Exige **duas maquinas** (ou uma maquina + um segundo usuario real). O roteiro
completo, passo a passo, esta em `001-PLAN.md`, Task 3.

## Next Phase Readiness

- O todo `.planning/todos/pending/2026-08-19-voz-nao-sai-em-modo-vad-no-primeiro-uso.md`
  **continua em `pending/`** — de proposito. So sai de la depois do "aprovado"
  da Task 3; enquanto o checkpoint em Windows nao passar, o defeito continua
  aberto.
- Encaixa naturalmente na mesma sessao de Windows ja reservada para 07-08 e
  09-03.
- Risco residual conhecido: no join, a publicacao emite `ActiveDeviceChanged`
  (deviceId indo de indefinido para o real), o que pode reinstalar o VAD uma
  vez logo apos o setup inicial e imprimir o log de "VAD ativo" duas vezes.
  Benigno — o estado final e o mesmo, um unico monitor vivo e a publicacao
  mutada — mas se aparecer no Console durante o checkpoint, **nao e erro**.
