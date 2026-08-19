---
phase: 08-compartilhamento-de-tela
plan: 02
subsystem: media
tags: [electron, desktop-capturer, livekit, screenshare, wasapi-loopback, restrictOwnAudio]

# Dependency graph
requires:
  - phase: 07-voz
    provides: "voice-context.tsx com um Room real conectado e useVoice() (Plano 07-03..07-11); VoiceControlBar.tsx com estado real de conexão/mute/deafen"
  - phase: 00-bootstrap
    provides: "Electron 43.4.0 fixado em package.json — versão mínima em que restrictOwnAudio deixa de ser ignorado"
provides:
  - "src/main/screenshare.ts: registerScreenShareHandler(), único registro de setDisplayMediaRequestHandler do app, com callback() garantido em 100% dos caminhos"
  - "useVoice().startScreenShare/stopScreenShare/isSharing — publicação de tela + áudio de sistema com restrictOwnAudio: true"
  - "Botão de compartilhar tela no rodapé de voz (VoiceControlBar)"
affects: [08-03, 08-04, 08-05, 08-06]

tech-stack:
  added: []
  patterns:
    - "Handler de setDisplayMediaRequestHandler com try envolvendo SÓ o await que pode lançar — nunca a chamada de callback, que num try/catch compartilhado poderia ser chamada duas vezes"
    - "Estado de UI de mídia derivado de evento do SDK (LocalTrackPublished/Unpublished), nunca otimista a partir do clique"

key-files:
  created:
    - src/main/screenshare.ts
    - src/main/screenshare.test.ts
  modified:
    - src/main/index.ts
    - src/renderer/src/state/voice-context.tsx
    - src/renderer/src/components/shell/VoiceControlBar.tsx

key-decisions:
  - "O try do handler envolve apenas desktopCapturer.getSources(), não a chamada de callback — estruturalmente impossível chamar callback duas vezes, ao custo de dois callback({}) literais em vez de um"
  - "thumbnailSize: { width: 0, height: 0 } — nada é exibido nesta versão, gerar bitmap de cada tela por requisição é trabalho jogado fora; o Plano 08-04 volta a pedir thumbnails quando houver seletor"
  - "Guarda de registro único em registerScreenShareHandler(): registrar de novo substitui o handler anterior silenciosamente, então a segunda chamada vira warn em vez de handler fantasma"
  - "isSharing observa só Track.Source.ScreenShare (vídeo), não ScreenShareAudio — a de áudio dispara os mesmos eventos na mesma operação e faria o estado oscilar duas vezes por início/parada, além de poder legitimamente não existir"
  - "isSharing também é resetado no evento Disconnected, não só em LocalTrackUnpublished — queda abrupta não necessariamente emite despublicação"
  - "Botão renderizado sempre e desabilitado fora de isReady (mesmo padrão de mute/deafen do arquivo), em vez de escondido"

patterns-established:
  - "Teste de contrato de handler do processo main com electron mockado (vi.mock + vi.resetModules por causa do estado de módulo do guarda de registro) — primeiro teste de src/main/ do projeto"

duration: ~25min
completed: 2026-08-19
---

# Phase 8 Plan 02: Captura núcleo Electron Summary

**Captura de tela inteira com áudio de sistema (`audio: 'loopback'`) concedida por um `setDisplayMediaRequestHandler` que chama `callback()` em 100% dos caminhos, publicada no `Room` de voz já conectado via `setScreenShareEnabled(true, { audio: { restrictOwnAudio: true, ... } })`, com `isSharing` derivado da publicação real da track — sem seletor de tela, deliberadamente.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-19T17:40:28Z
- **Tasks:** 2/2
- **Files:** 3 modificados + 2 criados

## Accomplishments

### Task 1 — `src/main/screenshare.ts` (commit `4c26dd9`)

`registerScreenShareHandler()` chamada uma única vez, dentro de
`app.whenReady()` em `src/main/index.ts` (antes disso `session.defaultSession`
não existe). Concede `{ video: sources[0], audio: 'loopback' }` a partir de
`desktopCapturer.getSources({ types: ['screen'] })`.

O ponto do plano que não podia ser diluído — **`callback` em 100% dos
caminhos** — foi implementado mais forte do que o snippet do plano pedia. O
plano envolvia o `callback` de sucesso dentro do mesmo `try` do `catch` que
faz `callback({})`; se essa chamada de sucesso lançasse, `callback` seria
chamado **duas vezes**. A implementação usa três caminhos, cada um com
exatamente uma chamada, e o `try` envolve só o `await`:

| Caminho | Termina em |
|---|---|
| `getSources()` rejeita | `callback({})` (dentro do `catch`, seguido de `return`) |
| `sources.length === 0` | `callback({})` seguido de `return` |
| Sucesso | `callback({ video: sources[0], audio: 'loopback' })`, última instrução |

Não há nenhum `await`, `throw` ou `return` no handler depois do qual o fluxo
possa terminar sem `callback` — verificado por leitura linha a linha (o
arquivo tem 3 ocorrências de `callback(`, todas mutuamente exclusivas e
exaustivas) e por teste (abaixo).

Guarda de registro único: uma segunda chamada a `registerScreenShareHandler()`
vira `console.warn` e não re-registra, porque `setDisplayMediaRequestHandler`
**substitui** o handler anterior em silêncio em vez de empilhar.

### Task 2 — renderer (commit `a6bdf75`)

`useVoice()` ganhou `isSharing`, `startScreenShare()` e `stopScreenShare()`.
A chamada de captura usa a constante `SCREEN_SHARE_CAPTURE_OPTIONS`, escrita
logo abaixo de `AUDIO_CAPTURE_OPTIONS` de propósito: as duas são espelhos
invertidos e a diferença é o assunto inteiro da fase.

- `restrictOwnAudio: true` — sem isso, o loopback do WASAPI republica na track
  de screenshare a voz dos outros participantes que o próprio LiveKit está
  tocando no fone de quem compartilha (Pitfall 1). Fone não resolve: o
  loopback é do dispositivo de saída.
- `echoCancellation`/`noiseSuppression`/`autoGainControl: false` — o inverso
  de VOICE-16 de propósito: as três foram desenhadas para voz de microfone e
  só degradam áudio de sistema (música, jogo, vídeo).
- `contentHint: 'motion'`, `video: true`, sem `publishOptions` (bitrate/fps
  configuráveis são o Plano 08-05).

`isSharing` é derivado de `RoomEvent.LocalTrackPublished`/`LocalTrackUnpublished`
filtrando `Track.Source.ScreenShare` — nunca setado otimisticamente pelo
clique, porque entre o clique e a publicação existem o handler do main, o
seletor do SO e o cancelamento do usuário. Também é zerado no evento
`Disconnected`, senão o botão ficaria preso em "compartilhando" depois de sair
do canal (queda abrupta não emite despublicação).

`stopScreenShare()` só chama `setScreenShareEnabled(false)`: o SDK despublica
as duas tracks (vídeo + áudio de sistema) sozinho — 08-RESEARCH.md §4.

No rodapé, um botão `MonitorUp` habilitado só com a sala conectada, com o
mesmo padrão de `aria-pressed` de mute/deafen, verde quando ativo.

## Deviations from Plan

### 1. [Rule 2 — lacuna crítica de verificação] Testes do handler de captura

- **Encontrado em:** Task 1
- **Contexto:** a verificação prevista pelo plano para o critério nº 1 da fase
  ("o handler nunca trava") era **revisão manual**. É o defeito mais
  silencioso da fase inteira: nenhum erro, nenhum log, e só aparece no caminho
  de exceção — exatamente o que a verificação manual feliz nunca percorre. E é
  também a única coisa desta fase que dá para provar fora do Windows.
- **Feito:** `src/main/screenshare.test.ts`, 6 testes com `electron` mockado
  (`vi.mock` + `vi.resetModules`, porque o guarda de registro é estado de
  módulo): concessão da primeira tela com `loopback`, `types: ['screen']`,
  lista vazia → `callback({})` uma vez, `getSources` rejeitando →
  `callback({})` uma vez, rejeição não escapando do handler, e registro único.
  Todos cobram `toHaveBeenCalledTimes(1)`.
- **Arquivo:** `src/main/screenshare.test.ts` (novo — primeiro teste de
  `src/main/` do projeto)
- **Commit:** `4c26dd9`

### 2. [Rule 1 — modo de falha] `try` mais estreito que o do snippet do plano

- **Encontrado em:** Task 1
- **Contexto:** o snippet do plano põe o `callback` de sucesso dentro do mesmo
  `try` cujo `catch` chama `callback({})` — se o `callback` de sucesso
  lançasse, o `catch` chamaria `callback` uma segunda vez.
- **Feito:** o `try` envolve apenas `desktopCapturer.getSources()`. Mesma
  semântica, uma classe de falha a menos. Custo: dois `callback({})` literais
  em vez de um (o contrato `contains: "callback({})"` do plano continua
  satisfeito).
- **Commit:** `4c26dd9`

### 3. [Extensão pequena] `thumbnailSize: { width: 0, height: 0 }` e guarda de registro único

- Nenhuma thumbnail é exibida nesta versão (a escolha é sempre a primeira
  tela), então gerar um bitmap por tela a cada requisição é trabalho jogado
  fora. O Plano 08-04 volta a pedir thumbnails quando existir seletor.
- O guarda de registro único torna visível (warn) o erro que o próprio plano
  descreve como perigoso, em vez de deixá-lo silencioso.
- **Commit:** `4c26dd9`

Nada mais: nenhuma dependência nova (`package.json` intocado), nenhum arquivo
fora dos declarados no plano (mais o teste), nenhuma mudança arquitetural.

## Verification — saída real

Ambiente: WSL2, sem Windows, sem tela e sem dispositivo de áudio.

```
$ npm run typecheck

> janja@1.0.0 typecheck
> npm run typecheck:node && npm run typecheck:web && npm run typecheck:convex

> janja@1.0.0 typecheck:node
> tsc --noEmit -p tsconfig.node.json --composite false

> janja@1.0.0 typecheck:web
> tsc --noEmit -p tsconfig.web.json --composite false

> janja@1.0.0 typecheck:convex
> tsc --noEmit -p tsconfig.convex.json

(exit 0, sem nenhum erro)
```

```
$ npx vitest run

 ✓ convex/dms.test.ts  (15 tests) 300ms
 ✓ convex/messages.test.ts  (10 tests) 369ms
 ✓ convex/invites.test.ts  (13 tests) 371ms
 ✓ convex/friends.test.ts  (24 tests) 430ms
 ✓ convex/voice.test.ts  (57 tests) 906ms
 ✓ convex/typing.test.ts  (8 tests) 212ms
 ✓ convex/channels.test.ts  (10 tests) 214ms
 ✓ convex/members.test.ts  (9 tests) 191ms
 ✓ convex/channelReadState.test.ts  (7 tests) 245ms
 ✓ convex/servers.test.ts  (9 tests) 148ms
 ✓ convex/lib/inviteCode.test.ts  (6 tests) 77ms
 ✓ convex/lib/tag.test.ts  (5 tests) 49ms
 ✓ convex/presence.test.ts  (3 tests) 111ms
 ✓ convex/users.test.ts  (7 tests) 141ms
 ✓ src/renderer/src/lib/user-tag.test.ts  (6 tests) 72ms
 ✓ src/main/screenshare.test.ts  (6 tests) 59ms

 Test Files  16 passed (16)
      Tests  195 passed (195)
```

Ressalva de leitura honesta: a suíte roda numa árvore compartilhada com o
executor do Plano 08-01, que estava alterando `convex/` ao mesmo tempo — os 57
testes de `convex/voice.test.ts` incluem os que ele acrescentou. **Deste
plano, são os 6 de `src/main/screenshare.test.ts`.**

Verificações do `<verification>` do plano:

```
$ grep -rn "restrictOwnAudio" src/
src/renderer/src/state/voice-context.tsx:48:// - `restrictOwnAudio: true` é o que impede o eco descrito no Pitfall 1. O
src/renderer/src/state/voice-context.tsx:66:    restrictOwnAudio: true,
src/main/screenshare.ts:73:    // não o microfone. O filtro do próprio áudio da call (`restrictOwnAudio`,

$ grep -rn "setScreenShareEnabled" src/   (linhas de código, fora comentários)
src/renderer/src/state/voice-context.tsx:505:  await room.localParticipant.setScreenShareEnabled(true, SCREEN_SHARE_CAPTURE_OPTIONS)
src/renderer/src/state/voice-context.tsx:520:  await room.localParticipant.setScreenShareEnabled(false)
```

Uma única chamada com `restrictOwnAudio`, exatamente como o plano exige.
`git diff` confirma `package.json` intocado — nenhuma dependência nova.

Versão do Electron confirmada com o pacote instalado, não com o intervalo do
`package.json`:

```
$ node -e "console.log(require('./node_modules/electron/package.json').version)"
43.4.0
```

É a versão exata em que `restrictOwnAudio` deixou de ser ignorado dentro de
`setDisplayMediaRequestHandler` (Pitfall 1). Nas versões anteriores a flag era
aceita e ignorada — sem erro nenhum, com eco garantido.

`npx eslint` nos arquivos tocados: limpo, exceto dois achados **pré-existentes
e não introduzidos aqui** (`prettier/prettier` numa linha de import de
`src/main/index.ts` que já estava assim em `HEAD`, e
`react-refresh/only-export-components` no `export function useVoice` de
`voice-context.tsx`, que existe desde 07-03). Nada foi reformatado: a árvore é
compartilhada com outro executor.

## O que este ambiente NÃO consegue provar — vai para o checkpoint 08-03

Dito com todas as letras: **nada do comportamento real de captura foi
verificado.** WSL2 não tem Windows, não tem tela, não tem dispositivo de áudio
e não renderiza a janela do Electron. `desktopCapturer` real nunca rodou. O
que existe é typecheck limpo, 6 testes de contrato do handler com `electron`
mockado, e revisão por leitura.

Fica **inteiramente** para o Plano 08-03, em Windows nativo:

1. **Não há eco (critério de sucesso nº 2 do projeto).** Duas máquinas, uma
   compartilha tela com áudio de sistema tocando; a outra pessoa fala e quem
   compartilha **não** devolve a voz dela. Só isso prova que
   `restrictOwnAudio` funciona na prática — o Pitfall 1 avisa que não há
   garantia documentada de 100% de eficácia em todos os cenários, e o plano B
   (silenciar a reprodução local e re-rotear, ou documentar como limitação)
   nem foi tocado aqui. Idealmente 3+ pessoas, como o PITFALLS.md pede.
2. **A segunda tentativa de compartilhar na mesma sessão funciona.** Iniciar e
   parar 3x seguidas; e forçar o caminho de cancelamento. Os testes provam o
   contrato do handler no processo main, **não** provam o comportamento do
   Chromium/`getDisplayMedia` do outro lado dele.
3. **A tela chega ao outro participante.** Nenhum vídeo remoto foi renderizado
   por este plano — o consumo remoto (SHARE-06) é plano posterior; no 08-03 a
   verificação é pelo estado de publicação/logs, ou junto do plano que
   renderiza.
4. **Áudio de sistema é de fato audível** para o outro lado (o loopback do
   WASAPI só existe no Windows).
5. **Multi-monitor:** sempre pega a primeira tela. Em máquina com dois
   monitores, se a "primeira" não for a que o usuário quer, é comportamento
   esperado desta versão — não é defeito, é o Plano 08-04.
6. **Interação com o VAD/microfone:** o compartilhamento publica tracks novas
   enquanto o VAD segue mutando/desmutando o microfone. Nada indica conflito
   (são tracks independentes), mas isso é raciocínio, não observação.

## Next Phase Readiness

- **08-03 (checkpoint humano)** está desbloqueado: existe botão funcional e
  caminho completo de publicação. É onde as 6 perguntas acima são respondidas.
- **08-04 (seletor de tela)** estende `src/main/screenshare.ts` sem descartar
  nada: troca o `sources[0]` por uma ida e volta ao renderer, volta a pedir
  `thumbnailSize` real, e acrescenta `types: ['screen', 'window']`. O contrato
  de "callback em 100% dos caminhos" fica **mais** difícil ali (o caminho novo
  é o usuário fechar o seletor sem escolher) — os 6 testes deste plano são a
  rede de segurança que já existe para isso, e devem ganhar um caso a mais.
- **08-05 (qualidade)** entra pelo terceiro argumento de
  `setScreenShareEnabled`, hoje ausente de propósito.
- **Risco conhecido em aberto:** se o eco aparecer no 08-03, a correção não é
  neste código — é o plano B do Pitfall 1 (mixagem manual ou limitação
  documentada), e vale reabrir o assunto antes de 08-04/08-05.
