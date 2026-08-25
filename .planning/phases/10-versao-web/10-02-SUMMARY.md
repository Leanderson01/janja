---
phase: 10-versao-web
plan: 02
subsystem: voz-e-compartilhamento
tags: [platform-layer, push-to-talk, getDisplayMedia, restrictOwnAudio, screenshare-audio, jsdom, movimento-puro]

requires:
  - phase: 10-versao-web/10-01
    provides: "o alias `@platform` resolvido por alvo nos cinco configs, `platform/contract.ts` com `PlatformPushToTalk`/`PlatformScreenShare` já escritos, e `verify:web-bundle` com a afirmação 3 em modo aviso"
  - phase: 07-voz
    provides: "o push-to-talk global do Plano 07-06 (`uiohook-napi`, tecla fixa `CtrlRight`, `setPttModeActive` ligando/desligando a captura nativa)"
  - phase: 08.6-audio-por-processo
    provides: "`startScreenShareAudio`/`stopScreenShareAudio` inteiros — o código que este plano MOVE de arquivo sem alterar uma vírgula de lógica"
provides:
  - "`pushToTalk` nos dois alvos: global no Electron, em foco na web — com a trava de `blur`/`visibilitychange` que impede microfone aberto para sempre, provada por 8 testes em jsdom"
  - "`screenShare` nos dois alvos: no Electron o caminho WASAPI da Fase 8.6 movido inteiro, na web as constraints que o Chrome entende"
  - "`ScreenSharePicker` (326 linhas, 23 testes) morando dentro de `platform/electron/`, inalcançável a partir do bundle web"
  - "`voice-context.tsx` com ZERO referências a `window.*` — 251 linhas a menos"
  - "afirmação 3 do `verify:web-bundle` em ZERO (com o 10-03): o portão `--strict-bridges` do Plano 10-07 já pode ser ligado"
affects: [10-05 autoplay e dispositivos na web, 10-06 restrictOwnAudio e o veredito de eco, 10-07 portao estrito de lint e bundle]

tech-stack:
  added: []
  patterns:
    - "Movimento de código provado por RECONSTRUÇÃO, não por leitura: extrair o bloco do commit de origem, aplicar dedent + a lista declarada de renomes, e afirmar igualdade byte a byte com o destino"
    - "`git mv` puro (R100 no `--find-renames`) como prova de que um teste movido não teve asserção tocada"
    - "Degradação de plataforma que DIZ: o no-op da web é comentado com o motivo, nunca um corpo vazio silencioso"
    - "Trava de foco no push-to-talk web: `blur` + `visibilitychange` contam como 'soltou a tecla'"

key-files:
  created:
    - src/renderer/src/platform/electron/ptt.ts
    - src/renderer/src/platform/web/ptt.ts
    - src/renderer/src/platform/web/ptt.test.ts
    - src/renderer/src/platform/electron/screenshare.tsx
    - src/renderer/src/platform/web/screenshare.tsx
  modified:
    - src/renderer/src/state/voice-context.tsx
    - src/renderer/src/components/shell/AppShell.tsx
  moved:
    - "src/renderer/src/components/shell/ScreenSharePicker.tsx -> src/renderer/src/platform/electron/ScreenSharePicker.tsx (R100)"
    - "src/renderer/src/components/shell/ScreenSharePicker.test.tsx -> src/renderer/src/platform/electron/ScreenSharePicker.test.tsx (R100)"

key-decisions:
  - "`captureOptions` é chamada com os DOIS argumentos do contrato (`contentHint`, `wantsAudio`), mas NENHUM dos dois alvos declara o segundo — e os dois dizem por quê no próprio arquivo. Ver Desvio 1"
  - "`screenShareAudioRef` (um `useRef`) virou um `let` de módulo: existe UMA captura de áudio de compartilhamento por app, não uma por instância de componente"
  - "O corpo de `startAudio`/`stopAudio` continua em funções nomeadas de módulo (`startProcessAudio`/`stopProcessAudio`), com o objeto `screenShare` só as envelopando — é o que preserva as duas chamadas internas de `stopProcessAudio()` exatamente onde estavam"
  - "A web NÃO ramifica `systemAudio` pela preferência salva: quem decide é a pessoa, na caixinha do próprio diálogo do Chrome, que só aparece por causa de `systemAudio: 'include'`"
  - "`QUALITY_PRESETS` FICOU em `voice-context.tsx` — é decisão de produto compartilhada pelos dois alvos, não diferença de plataforma"

patterns-established:
  - "Prova de não-regressão por reconstrução mecânica: quando o teste não muda de cor, a única evidência possível é o compilador de diferenças, não a memória de quem moveu"

duration: 15min
completed: 2026-08-25
---

# Fase 10 Plano 02: Costura de voz e tela — Summary

**`voice-context.tsx` perdeu 251 linhas e a última referência a `window.*`: push-to-talk e compartilhamento de tela agora vêm do contrato, com a versão web do PTT fechando o microfone quando a janela perde o foco — o defeito que só existe na web e que ninguém percebe até estar transmitindo o quarto para dez pessoas.**

## Performance

- **Duração:** ~15 min
- **Tarefas:** 2/2
- **Commits:** 2 de tarefa + 1 de metadados
- **`voice-context.tsx`:** 1667 -> 1416 linhas

## Commits

| Hash | O quê |
|---|---|
| `654f385` | Push-to-talk atrás do contrato — global no Electron, em foco na web |
| `4586337` | Compartilhamento de tela atrás do contrato, e o seletor mudando de bairro |

## O movimento foi puro?

Esta é a seção que o plano exigiu, e ela existe porque **o teste não muda de
cor quando código muda de arquivo**. Mover é onde se perde ordem de chamada,
guarda e tratamento de erro sem o compilador reclamar.

A resposta não é "eu reli". É uma **reconstrução mecânica**: extrair o bloco
do commit de origem (`dea862d:src/renderer/src/state/voice-context.tsx`),
remover 2 espaços de indentação (o código saiu de dentro de um componente),
aplicar a lista declarada de renomes e comparar com o destino em disco.

```
== startAudio: MOVIMENTO PURO — identico apos dedent + renomes declarados (118 linhas)
== stopAudio:  MOVIMENTO PURO — identico apos dedent + renomes declarados (37 linhas)
constantes de texto: IDENTICAS
return de captureOptions: IDENTICO
publishTrack -> ['source', 'forceStereo', 'dtx', 'red', 'audioPreset']
```

### A lista completa de renomes — e não há mais nenhuma diferença

| # | De | Para | Por quê |
|---|---|---|---|
| 1 | `async function startScreenShareAudio(): Promise<void>` | `async function startProcessAudio(room: Room): Promise<void>` | `room` era closure do provider; agora é parâmetro (o contrato o entrega) |
| 2 | `screenShareAudioRef.current = { bridge, ... }` | `activeAudio = { bridge, ... }` | `useRef` -> `let` de módulo |
| 3 | `void stopScreenShareAudio()` | `void stopProcessAudio()` | nome novo, mesma função |
| 4 | `await stopScreenShareAudio()` | `await stopProcessAudio()` | idem |
| 5 | `nota histórica no topo do arquivo` (comentário) | `nota histórica em \`captureOptions\` abaixo` | a nota mudou de lugar junto |
| 6 | `async function stopScreenShareAudio(): Promise<void>` | `async function stopProcessAudio(): Promise<void>` | nome novo |
| 7 | `const active = screenShareAudioRef.current` | `const active = activeAudio` | `useRef` -> `let` |
| 8 | `screenShareAudioRef.current = null` | `activeAudio = null` | `useRef` -> `let` |

### Item a item, o que veio de `voice-context.tsx` para `platform/electron/screenshare.tsx`

| O que | Estado |
|---|---|
| `AUDIO_UNAVAILABLE_MESSAGES` (4 textos, incl. o comentário do HRESULT) | idêntico |
| `AUDIO_BRIDGE_FAILED_MESSAGE` | idêntico |
| `NO_AUDIO_YET_MESSAGE` (com a referência ao issue #414) | idêntico |
| `AUDIO_PUBLISH_FAILED_MESSAGE` | idêntico |
| `screenShareAudioRef` -> `activeAudio` | mesmo tipo, mesma semântica de `null` |
| `screenShareCaptureOptions` -> `screenShare.captureOptions` | `return { audio: false, video: true, contentHint }` idêntico |
| a NOTA HISTÓRICA sobre `restrictOwnAudio` | idêntica **+ um parágrafo novo** (ver abaixo) |
| corpo de `startScreenShareAudio` (118 linhas) | idêntico |
| corpo de `stopScreenShareAudio` (37 linhas) | idêntico |
| `createScreenShareAudioBridge` (import) | mesmo módulo, agora por alias `@/lib/...` |

### As afirmações que o plano pediu por extenso

- **Ordem preservada.** `startProcessAudio`: reler `loadScreenSharePreferences()`
  -> `if (!systemAudio) return` -> `window.screenshare.audio.start()` ->
  `createScreenShareAudioBridge` -> `onChunk` -> `onStatus` -> **guardar em
  `activeAudio` ANTES de publicar** -> `publishTrack`. `stopProcessAudio`:
  `const active = activeAudio` -> **`activeAudio = null` no INÍCIO** ->
  `if (!active) return` -> `unsubscribeChunk` -> `unsubscribeStatus` ->
  `window.screenshare.audio.stop()` -> `await active.bridge.stop()`.
- **A releitura da preferência continua DEPOIS do diálogo.** O FIX de
  2026-08-25 está inteiro: `loadScreenSharePreferences()` é chamada dentro de
  `startProcessAudio`, que só roda depois de `setScreenShareEnabled` resolver.
  O valor que passa por `captureOptions` (ver Desvio 1) **não** é consumido por
  nenhum dos alvos e não pode desfazer isso.
- **Try/catch por passo no teardown.** Os quatro passos de `stopProcessAudio`
  continuam em quatro `try/catch` independentes, com os mesmos quatro
  `console.warn`. Um `unsubscribe` que lance continua não impedindo a captura
  nativa de parar.
- **Os cinco parâmetros de `publishTrack`, na mesma ordem:** `source:
  Track.Source.ScreenShareAudio`, `forceStereo: true`, `dtx: false`,
  `red: false`, `audioPreset: AudioPresets.musicHighQualityStereo` — com os
  três comentários originais (o gancho de `29822/30743/30067`, o "NÃO É
  OTIMIZAÇÃO" do estéreo, o "NÃO passar `stream`").
- **A proibição por extenso ficou.** "nunca, jamais, um fallback para loopback
  de dispositivo" veio junto, palavra por palavra.
- **Ordem preservada em `voice-context.tsx` também:** `stopAudio` continua
  ANTES de `setScreenShareEnabled(false)` em `stopScreenShare`, e o handler de
  `LocalTrackUnpublished` (filtrado por `source !== Track.Source.ScreenShare`),
  o de `Disconnected` e o cleanup do efeito continuam chamando o mesmo
  teardown — as três chamadas, nos três lugares.

### O parágrafo novo (o único conteúdo acrescentado à nota histórica)

A NOTA HISTÓRICA do `restrictOwnAudio` proíbe apostar nela **no desktop**.
Sozinha, no arquivo do Electron, ela levaria a próxima pessoa a concluir que a
web também não pode — e a web é justamente onde ela funciona. O parágrafo
acrescentado diz por quê a diferença é estrutural: no Electron quem concede a
fonte é o processo main, e `Streams.audio` só aceita `'loopback'`,
`'loopbackWithMute'` ou um `WebFrameMain` — a fonte já está fixada como "o
dispositivo inteiro" antes de qualquer constraint ser avaliada. No navegador
não existe esse passo.

### E o seletor de tela: `R100`

```
R100  src/renderer/src/components/shell/ScreenSharePicker.tsx      -> src/renderer/src/platform/electron/ScreenSharePicker.tsx
R100  src/renderer/src/components/shell/ScreenSharePicker.test.tsx -> src/renderer/src/platform/electron/ScreenSharePicker.test.tsx
```

`R100` = 100% de similaridade: **zero bytes de conteúdo alterados** nos dois
arquivos. Nenhum import precisou de ajuste (o teste importa `./ScreenSharePicker`,
que continua válido; o resto é por alias `@/`). Os 23 testes passam no diretório
novo sem uma asserção tocada — e a prova disso não é a contagem, é o `R100`.

## A trava de push-to-talk na web

O Electron escuta o teclado do sistema inteiro. O navegador não escuta — e não
vai escutar, porque capturar tecla fora de foco é keylogger. Até aí é
degradação declarada (`capabilities.globalPushToTalk === false`).

**O defeito novo é outro, e é só da web:** a pessoa segura `CtrlRight` para
falar e faz Alt+Tab **ainda segurando**. O `keyup` acontece numa janela que não
é a nossa e **nunca chega**. Sem tratamento, `isDown` fica `true` para sempre e
o microfone fica **aberto para sempre** — dentro do canal, com todo mundo
ouvindo, e sem nenhum outro evento no sistema capaz de fechá-lo.

Como ficou, em `platform/web/ptt.ts`:

| Regra | Como |
|---|---|
| Mesma tecla do desktop | `event.code === 'ControlRight'` (o `UiohookKey.CtrlRight` de `src/main/voice/ptt.ts:38`) |
| Anti-repeat | `event.repeat` + o `isDown` do closure (mesmo papel do `isKeyCurrentlyDown` do main) |
| Digitar não abre microfone | `input` / `textarea` / `isContentEditable` retornam sem acionar |
| **Perder o foco = soltou** | `window.addEventListener('blur', forceUp)` |
| **Aba no fundo = soltou** | `document.addEventListener('visibilitychange', ...)` quando `document.hidden` |
| `onUp` nunca sem `onDown` | `forceUp()` sai cedo se `!isDown` |
| Cleanup | remove os **quatro** listeners |
| `setActive` | no-op **comentado** — não há captura nativa para ligar/desligar |

`visibilitychange` **não** é redundante com `blur`: trocar de aba dentro da
mesma janela dispara o primeiro e não necessariamente o segundo. Os dois custam
duas linhas.

Fechar cedo demais é um inconveniente (a pessoa aperta de novo). **Não fechar
não tem conserto do lado de quem está falando.**

Oito testes em jsdom (`platform/web/ptt.test.ts`), um por regra, incluindo o
negativo que só é afirmável por causa do `isDown` explícito: depois do `blur`,
um `keyup` posterior **não** chama `onUp` de novo.

`platform/electron/ptt.ts` não implementa nada — empacota `window.voice`. O
comentário obrigatório de `setActive` está lá: perder essa chamada não quebraria
teste nenhum e não apareceria na tela, o app só passaria a ler o teclado do
sistema inteiro à toa, para sempre, para quem nem usa push-to-talk.

## O alvo web do compartilhamento

`restrictOwnAudio` está **dentro** de `audio: { ... }`, com a nota verificada no
SDK instalado: `screenCaptureToDisplayMediaStreamOptions`
(`livekit-client.esm.mjs:13350-13359`) repassa ao `getDisplayMedia` apenas
`{ audio, video, controller, selfBrowserSurface, surfaceSwitching, systemAudio,
preferCurrentTab }` — o irmão `suppressLocalAudioPlayback` do nível de cima
**não é repassado**, e some sem erro, sem aviso e sem log.

`startAudio` é stub honesto (`console.info` nomeando o Plano 10-06 como dono da
leitura de volta); `stopAudio` é no-op documentado (a faixa nasce com
`source = ScreenShareAudio` dentro do SDK, e some junto com o vídeo);
`Extras: () => null`.

## Verificação — saída real

| Comando | Resultado |
|---|---|
| `npm run typecheck` (node + web + convex) | **exit 0** |
| `npm run typecheck:web-target` | **exit 0** |
| `npm run build` (electron-vite) | **✓ built in 4.79s** |
| `npm run verify:renderer-runtime` | `✓ Renderer sem runtime de servidor do Convex (2 arquivos verificados)` |
| `npm run verify:native-audio` | `✓ Empacotamento do áudio nativo verificado (6 asserções, 0 pulada(s))` |
| `npm run verify:convex-paths` | `✓ Nomes de módulo do Convex válidos` |
| `npm run build:web` | **✓ built in 4.42s** |
| `npx vitest run` | **41 arquivos, 664 testes passando** |

`npm run verify:web-bundle` — **as quatro afirmações passam**, incluindo a 3,
que estava em modo aviso com 3 marcadores desde o 10-01:

```
✓ [1] Implementacao web presente (dist-web/assets/index-DKRHLce5.js)
✓ [2] Nenhum vestigio da implementacao Electron
✓ [3] Nenhuma ponte de Electron no bundle web
✓ [4] CSS real: dist-web/assets/index-C8k-Kv45.css, 51083 bytes ...
```

Contagem crua no artefato: `window.voice` **0**, `window.screenshare` **0**,
`window.auth` **0**, `uiohook` **0**.

**Separando o que é deste plano:** dos 3 marcadores da linha de base do 10-01,
**2 eram meus** (`window.voice`, `window.screenshare`) e 1 era do Plano 10-03
(`window.auth`), executado em paralelo no mesmo diretório. Os dois planos
juntos zeraram a afirmação 3 — **o Plano 10-07 já pode ligar
`--strict-bridges` dentro do `build:web`**.

**Idem para a contagem de testes:** a suíte foi de 39/648 para 41/664. Deste
plano vêm **+1 arquivo e +8 testes** (`platform/web/ptt.test.ts`); o outro
arquivo e os outros 8 testes são do 10-03 (`platform/web/auth.test.ts`). Os 23
do `ScreenSharePicker` não mudaram de contagem — mudaram de endereço.

### Os greps que o plano pediu

```
$ grep -n "window.voice" src/renderer/src/state/voice-context.tsx        -> nada
$ grep -n "window.screenshare" src/renderer/src/state/voice-context.tsx  -> nada

$ grep -rn "window\." src/renderer/src --include=*.ts --include=*.tsx \
    | grep -v "src/renderer/src/platform/electron/" \
    | grep -E "window\.(auth|voice|screenshare|electron)"
src/renderer/src/lib/profile-hint.ts:13:            * `window.auth.getUser()`. Este módulo só traduz ...
src/renderer/src/lib/screenshare-audio-bridge.ts:7:  //  -> IPC ... -> window.screenshare.audio.onChunk
src/renderer/src/platform/contract.ts:10:           * O bundle da web nunca vê `window.screenshare` ...
src/renderer/src/platform/contract.ts:107:          * (`window.auth.getAccessToken({ forceRefreshToken })`)
```

Os quatro achados restantes são **comentário**, nos três arquivos que o 10-01
já tinha listado como não contáveis. Comentário não chega ao bundle — e o
artefato confirma: zero.

### A prova de que o caminho do Electron não foi tocado

```
$ git diff --stat dea862d -- src/main src/preload convex scripts \
    electron.vite.config.ts vite.config.web.ts \
    src/renderer/src/platform/contract.ts src/renderer/src/lib src/renderer/index.html
(vazio)
```

Zero linhas em `src/main`, `src/preload`, `convex`, `scripts`, `lib`, no
contrato e nos configs de build.

## Desvios do plano

**1. [Regra 3 — bloqueio] `captureOptions` tem DOIS parâmetros no contrato, e o plano mostrou a chamada com um**

O `<action>` da Task 2 e o `<verify>` mandavam escrever
`screenShare.captureOptions(contentHint)`. Mas `PlatformScreenShare` (escrito
no Plano 10-01, e que este plano **não pode reescrever para caber no que for
mais fácil**) declara `captureOptions(hint: ContentHint, wantsAudio: boolean)`.
O call-site é tipado pelo contrato: chamar com um argumento não compila.

Resolvi sem tocar em `contract.ts` e sem mexer no FIX de 2026-08-25:

- o call-site passa os dois: `screenShare.captureOptions(contentHint, wantsAudio)`,
  onde `wantsAudio` sai da **chamada de `loadScreenSharePreferences()` que já
  existia ali** (só acrescentei um campo ao destructuring — nenhuma leitura
  nova, nenhum acesso a disco a mais);
- **nenhuma das duas implementações declara o segundo parâmetro**, e as duas
  dizem por quê no próprio arquivo. Electron: o áudio nunca vem do
  `getDisplayMedia`, ele é um segundo passo decidido DEPOIS que o seletor
  fecha — ramificar as constraints por `wantsAudio` aqui desfaria o FIX sem
  parecer que desfaz. Web: quem decide é a pessoa, na caixinha do diálogo do
  Chrome que `systemAudio: 'include'` faz aparecer; pré-excluir por preferência
  salva tiraria dela a escolha no exato momento em que ela está sendo feita.

O objeto devolvido pela web é **literalmente** o do plano e o da pesquisa §5.3.

**2. [Regra 1 — comentário que ficaria mentindo] Três comentários reescritos em `voice-context.tsx`**

Não são mudanças de lógica; são comentários que o movimento tornou falsos:

- o cabeçalho do efeito de PTT dizia "via hook global de teclado no processo
  main" — verdade só no Electron agora;
- a justificativa de `deps: [room]` dizia que `stopScreenShareAudio` "é
  redeclarada a cada render (função do corpo do componente)" — agora é um
  método de módulo, com identidade estável, o que torna a dep list ainda mais
  correta, por outro motivo;
- o mesmo comentário citava `window.screenshare`, que este arquivo não conhece
  mais (era o achado que o `<verify>` mandava reescrever).

Nenhuma linha executável mudou nesses três pontos.

## O que passou a ser verificável no WSL2 — e o que não

**Passou a ser verificável aqui, por automação, e não era:**

- **A trava de `blur` e a de `visibilitychange`** — o defeito mais caro desta
  costura (microfone aberto para sempre) está coberto por teste em jsdom, sem
  teclado, sem microfone e sem navegador gráfico. Ele não depende de ninguém
  lembrar de tentar Alt+Tab.
- Que o bundle web não contém mais `window.voice` nem `window.screenshare`
  (contagem 0 no artefato, afirmação 3 do `verify:web-bundle`).
- Que os 23 testes do seletor sobreviveram à mudança de diretório — e, mais
  forte, que os arquivos não mudaram nem um byte (`R100`).
- Que o movimento do código da Fase 8.6 foi puro (reconstrução mecânica).

**Passou a ser verificável pelo Leo, no Chrome do Windows, por `localhost`
(WSL2 encaminha; só `localhost` é secure context):**

```bash
cd /home/leo/workspace/janja && npm run dev:web
```
e abrir **`http://localhost:5173`**.

- **Push-to-talk de verdade**: segurar `CtrlRight` numa call e o microfone
  abrir; soltar e fechar. O teste prova o contrato dos eventos, **não que o
  áudio sai**.
- **A trava, na vida real**: segurar `CtrlRight`, fazer Alt+Tab ainda
  segurando, e confirmar que os outros pararam de ouvir.
- **O diálogo do Chrome** aparecendo com aba/janela/tela, a caixinha de áudio
  presente (é o `systemAudio: 'include'`), e a própria aba do Hydra **ausente**
  da lista (é o `selfBrowserSurface: 'exclude'`).
- Que digitar no chat com a mão perto do `CtrlRight` **não** abre o microfone.

**Continua exigindo Windows nativo, e nada aqui mudou isso:**

- **Todo o caminho de áudio por processo do desktop (Fase 8.6).** Este plano
  MOVEU esse código de arquivo sem alterar uma vírgula de lógica — e **mover
  código não é verificar código**. A reconstrução mecânica acima prova que o
  que está rodando é o mesmo texto; ela não prova que o texto funciona, porque
  isso nunca foi provado em Windows. O roteiro da **Parte 3 de
  `.planning/CHECKPOINT-WINDOWS.md` continua sendo a única prova**, e continua
  pendente.
- O push-to-talk global (`uiohook-napi`) no app empacotado.
- O seletor próprio de fontes abrindo a partir do processo main.
- O experimento do `restrictOwnAudio` da §5.4 da pesquisa — que é do Plano
  10-06 e é o que pode dizer se a web resolve o eco que o desktop não resolveu.

## Estado para o próximo plano

- **`platform/web/screenshare.tsx` tem dono depois de mim: o Plano 10-06.** O
  `startAudio` de lá é um `console.info` explícito; substituí-lo pela leitura
  de `track.getSettings().restrictOwnAudio`, pelo veredito e pelos textos é o
  trabalho daquele plano, e o arquivo diz isso por escrito.
- **`platform/web/ptt.ts` encosta no Plano 10-05** (autoplay e dispositivos na
  web): a UI de configurações precisa dizer "só com a janela em foco", lendo de
  `capabilities.globalPushToTalk` — nunca de uma string duplicada por tela.
- **O Plano 10-07 pode ligar o portão.** A afirmação 3 do `verify:web-bundle`
  está em **0**, e é o pré-requisito escrito no próprio script para mover
  `--strict-bridges` para dentro do `build:web`. O comentário do script ainda
  descreve a linha de base do fim do 10-01 (com `voice-context.tsx` e
  `components/shell/ScreenSharePicker.tsx` na lista) — está correto **como
  história**, e atualizá-lo é do 10-07, dono daquele arquivo.
- A regra de lint "nada de `window.*` fora de `platform/electron/**`" que o
  10-07 vai escrever **não precisa de nenhuma exceção nominal**: os quatro
  achados que sobram na fonte são comentário, em `lib/profile-hint.ts`,
  `lib/screenshare-audio-bridge.ts` e `platform/contract.ts`.
- Nenhuma dependência nova. `contract.ts` não teve uma linha alterada.
