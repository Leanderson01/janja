---
created: 2026-08-19T00:00
title: Voz não sai no modo VAD (padrão) — usuário novo fica mudo
area: voice
files:
  - src/renderer/src/state/voice-context.tsx:232-250
  - src/renderer/src/state/voice-context.tsx:255-280
  - src/renderer/src/lib/vad.ts:34-80
  - src/renderer/src/lib/voice-preferences.ts:26-31
---

## Problem

Reportado pelo Leo em 2026-08-19, em uso real: quando um usuário **novo** entra
num canal de voz, a voz dele **não sai** para os outros participantes. O único
caminho que ele encontrou para destravar foi: abrir as configurações de voz →
ativar push-to-talk → testar o microfone pelo painel → sair da call → entrar de
novo. Só então os outros passam a ouvi-lo.

O sintoma "só funciona depois de ativar PTT" é a pista: o padrão de
`DEFAULT_VOICE_PREFERENCES` é `mode: 'vad'`
(`src/renderer/src/lib/voice-preferences.ts:26-31`), então **o usuário novo
nunca está em PTT** — ele está em VAD. Ativar PTT não conserta o VAD, apenas
troca para um caminho de código que funciona (o hook global de teclado do
07-06 comanda a track direto). Ou seja: o bug provável é **o modo VAD nunca
transmitir**, e não algo sobre "primeira entrada".

Hipótese principal (deadlock de VAD sobre track mutada), a confirmar:

`applyVoicePreferences()` em modo `vad`
(`voice-context.tsx:268-278`) dispara `setMicrophoneEnabled(false)` — sem
`await` — e em seguida chama `startVadMonitor()`, que liga um `AnalyserNode`
**na mesma `MediaStreamTrack` publicada** (`voice-context.tsx:233-237`). Quando
o LiveKit desabilita o microfone, essa track vai para `enabled = false` e passa
a entregar **silêncio digital**. O VAD então lê RMS ≈ 0 para sempre, nunca
cruza o `threshold` (0.15), nunca chama `onSpeakingChange(true)` e nunca
reabre o microfone. Microfone fechado → VAD lê silêncio → microfone
permanece fechado.

Hipótese secundária (ordem/corrida, pode coexistir): se
`applyVoicePreferences()` roda antes de a publicação do microfone existir,
`startVadMonitor()` cai no `if (!mediaStreamTrack) return`
(`voice-context.tsx:235`) e **nenhum** monitor é criado — mas o
`setMicrophoneEnabled(false)` da linha anterior já aconteceu. Resultado
idêntico: mudo permanente, sem nada no estado indicando erro.

Impacto: atinge o caminho padrão de todo usuário novo, e o critério de sucesso
do projeto é o grupo largar o Discord — alguém que entra e não é ouvido
desiste antes de chegar em qualquer outra funcionalidade.

## Solução

TBD — decidir na investigação. Direções candidatas:

1. **Separar a track de análise da track publicada**: o VAD monitora um
   `getUserMedia` próprio (ou um clone da track, `track.clone()`), que nunca é
   mutado pelo LiveKit. Elimina o deadlock por construção — o analisador
   sempre enxerga áudio real, independente do estado de publicação.
2. **Não mutar a track, e sim a publicação**: verificar se
   `stopMicTrackOnMute`/`setMute` do `livekit-client` permite manter a
   `MediaStreamTrack` viva (capturando) enquanto a publicação é silenciada
   para os outros. Se sim, o VAD continua lendo nível real.
3. **Garantir a ordem**: `await setMicrophoneEnabled(...)` antes de
   `startVadMonitor`, e falhar alto (log/estado visível) quando não houver
   track — hoje o `return` silencioso esconde a falha.

Verificação: reproduzir com perfil limpo (`localStorage` sem
`janja:voice-preferences`), entrar num canal com 2 máquinas e falar **sem tocar
em nenhuma configuração**. Testar também o caminho de volta: depois de ativar
PTT e voltar para VAD, a voz precisa continuar saindo. Ver a lição
"verificar no ambiente errado não é verificar" no `HANDOFF.md` — o teste
que vale é em Windows nativo.
