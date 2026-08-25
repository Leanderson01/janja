---
phase: 10-versao-web
plan: 02
type: execute
wave: 2
depends_on: ["10-01"]
files_modified:
  - src/renderer/src/platform/electron/ptt.ts
  - src/renderer/src/platform/web/ptt.ts
  - src/renderer/src/platform/web/ptt.test.ts
  - src/renderer/src/platform/electron/screenshare.tsx
  - src/renderer/src/platform/web/screenshare.tsx
  - src/renderer/src/platform/electron/ScreenSharePicker.tsx
  - src/renderer/src/platform/electron/ScreenSharePicker.test.tsx
  - src/renderer/src/components/shell/ScreenSharePicker.tsx
  - src/renderer/src/components/shell/ScreenSharePicker.test.tsx
  - src/renderer/src/state/voice-context.tsx
  - src/renderer/src/components/shell/AppShell.tsx
autonomous: true

must_haves:
  truths:
    - "`voice-context.tsx` não contém nenhuma referência a `window.voice` nem a `window.screenshare` — as duas passaram a vir de `@platform`"
    - "No alvo Electron, push-to-talk e áudio por processo continuam funcionando exatamente pelo mesmo caminho de antes (só mudou de arquivo)"
    - "No alvo web, segurar CtrlRight abre o microfone e soltá-lo fecha; e perder o foco da janela FECHA o microfone mesmo com a tecla ainda pressionada"
    - "No alvo web, digitar CtrlRight dentro de um campo de texto não aciona push-to-talk"
    - "O seletor de tela próprio só existe no alvo Electron: no web, `Extras` não monta nada e o `ScreenSharePicker` não entra no bundle"
    - "O compartilhamento no alvo web pede áudio ao Chrome pelo caminho documentado (restrictOwnAudio dentro de `audio`, systemAudio include, selfBrowserSurface exclude)"
  artifacts:
    - path: "src/renderer/src/platform/web/ptt.ts"
      provides: "push-to-talk em foco, com as travas de blur e visibilitychange"
      exports: ["pushToTalk"]
      min_lines: 70
    - path: "src/renderer/src/platform/web/ptt.test.ts"
      provides: "prova das quatro regras: down abre, up fecha, blur fecha, campo de texto não aciona"
      min_lines: 90
    - path: "src/renderer/src/platform/electron/ptt.ts"
      provides: "o mesmo push-to-talk global de sempre, agora atrás do contrato"
      exports: ["pushToTalk"]
    - path: "src/renderer/src/platform/web/screenshare.tsx"
      provides: "constraints do getDisplayMedia no navegador e o gancho de leitura pós-publicação"
      exports: ["screenShare"]
    - path: "src/renderer/src/platform/electron/screenshare.tsx"
      provides: "as constraints só-vídeo de hoje, o caminho WASAPI da Fase 8.6 e o seletor próprio como Extras"
      exports: ["screenShare"]
    - path: "src/renderer/src/platform/electron/ScreenSharePicker.tsx"
      provides: "o seletor próprio, movido para dentro do lado Electron da costura, com os 23 testes intactos"
      min_lines: 300
  key_links:
    - from: "src/renderer/src/state/voice-context.tsx"
      to: "@platform/ptt"
      via: "pushToTalk.subscribe / pushToTalk.setActive"
      pattern: "@platform/ptt"
    - from: "src/renderer/src/state/voice-context.tsx"
      to: "@platform/screenshare"
      via: "screenShare.captureOptions / startAudio / stopAudio"
      pattern: "@platform/screenshare"
    - from: "src/renderer/src/components/shell/AppShell.tsx"
      to: "@platform/screenshare"
      via: "<screenShare.Extras /> no lugar do <ScreenSharePicker />"
      pattern: "Extras"
    - from: "src/renderer/src/platform/web/screenshare.tsx"
      to: "getDisplayMedia"
      via: "restrictOwnAudio dentro de audio, nunca no nível de cima"
      pattern: "restrictOwnAudio"
---

<objective>
Tirar `window.voice` e `window.screenshare` de dentro do código de feature e
colocá-los atrás do contrato — e, no mesmo movimento, entregar a versão web dos
dois: push-to-talk em foco (com a trava que impede microfone aberto para
sempre) e as constraints de compartilhamento que o Chrome entende.

Purpose: `voice-context.tsx` tem 1667 linhas e é o arquivo mais caro do
projeto. Ele é o ÚNICO consumidor de `window.voice` e o único de
`window.screenshare.audio`. Enquanto a troca não acontecer ali, o alvo web
carrega uma bomba: o bundle referencia objetos que não existem no navegador, e
o modo de falha é `undefined is not an object` no meio de uma call. Fazer a
troca uma vez, atrás de um contrato, é mais barato do que descobrir cada
chamada quando ela explodir.

Output: dois módulos de plataforma por alvo (ptt e screenshare), o
`ScreenSharePicker` mudado de bairro (de `components/shell/` para
`platform/electron/`, onde ele passa a ser inalcançável a partir do bundle
web), e `voice-context.tsx` sem uma única referência a `window.*`.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/10-versao-web/10-RESEARCH.md
@.planning/phases/10-versao-web/10-01-SUMMARY.md
@src/renderer/src/platform/contract.ts

# O que está sendo movido, e de onde
@src/renderer/src/state/voice-context.tsx
@src/renderer/src/components/shell/ScreenSharePicker.tsx
@src/renderer/src/components/shell/AppShell.tsx
@src/preload/index.ts

# O motivo de o áudio do desktop NÃO poder virar constraint de novo
@src/main/screenshare-audio-types.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Push-to-talk atrás do contrato — global no Electron, em foco na web</name>
  <files>src/renderer/src/platform/electron/ptt.ts, src/renderer/src/platform/web/ptt.ts, src/renderer/src/platform/web/ptt.test.ts, src/renderer/src/state/voice-context.tsx</files>
  <action>
    **`platform/electron/ptt.ts`** — só empacota o que já existe, sem mudar
    nenhum comportamento:

        import type { PlatformPushToTalk } from '@/platform/contract'
        export const pushToTalk: PlatformPushToTalk = {
          subscribe(h) {
            const offDown = window.voice.onPttKeyDown(h.onDown)
            const offUp = window.voice.onPttKeyUp(h.onUp)
            return () => { offDown(); offUp() }
          },
          setActive(active) { window.voice.setPttModeActive(active) }
        }

    Comentário obrigatório: `setActive` é o que mantém a promessa do Plano
    07-06 — o hook nativo de teclado só captura enquanto o modo salvo é 'ptt',
    nunca em modo VAD (o padrão). Perder essa chamada faria o app ficar lendo
    o teclado do sistema à toa.

    **`platform/web/ptt.ts`** — a versão que degrada DIZENDO. Requisitos, todos
    obrigatórios:

    - `subscribe(h)` registra `keydown` e `keyup` em `window` e filtra
      `event.code === 'ControlRight'` (a mesma tecla fixa do
      `src/main/voice/ptt.ts:38` — a web não inventa uma tecla diferente).
    - **Ignorar quando o alvo é campo de texto**: se
      `event.target` for `input`, `textarea` ou tiver `isContentEditable`,
      retornar sem acionar. Sem isso, escrever no chat com a mão perto do
      CtrlRight abre o microfone.
    - **Anti-repeat**: `keydown` dispara repetidamente enquanto a tecla está
      presa (`event.repeat === true`). Só chamar `onDown` na primeira.
    - **A trava que não pode faltar — `blur` e `visibilitychange` forçam
      `onUp`.** Este é o modo de falha que a pesquisa mandou tratar por
      extenso: Alt+Tab com a tecla pressionada faz o `keyup` acontecer numa
      janela que não é a nossa, o evento nunca chega, e **o microfone fica
      aberto para sempre** — a pessoa vai embora falando. Registrar
      `window.addEventListener('blur', forceUp)` e
      `document.addEventListener('visibilitychange', ...)` chamando `onUp` (e
      zerando o estado de "tecla presa") quando `document.hidden`. Escrever o
      porquê em comentário do tamanho do estrago.
    - `onUp` só é chamado se `onDown` tiver sido chamado antes (guardar o
      estado numa variável do closure). Chamar `setMicrophoneEnabled(false)`
      sem nunca ter aberto é inofensivo, mas o teste precisa poder afirmar
      "não houve chamada", e isso só é possível com o estado explícito.
    - O retorno de `subscribe` remove **os quatro** listeners.
    - `setActive` é no-op **documentado**: não existe hook nativo para ligar ou
      desligar; os listeners de teclado da própria janela custam nada e ficam
      registrados enquanto o provider viver. Comentar que é no-op de propósito,
      não esquecimento.

    **`platform/web/ptt.test.ts`** — ambiente jsdom
    (`// @vitest-environment jsdom` + `import '@/test/jsdom-setup'`),
    importando por caminho relativo (`./ptt`) porque o alias `@platform` do
    vitest aponta para o Electron. Quatro provas, uma por regra:
    1. `keydown` de `ControlRight` chama `onDown` uma vez; um segundo `keydown`
       com `repeat: true` NÃO chama de novo; `keyup` chama `onUp`.
    2. `keydown`/`keyup` de outra tecla (`KeyA`, `ControlLeft`) não chama nada.
    3. `keydown` com `target` sendo um `<input>` montado não chama nada.
    4. **`keydown` seguido de `window.dispatchEvent(new Event('blur'))` chama
       `onUp`** — e um `keyup` posterior não chama `onUp` de novo.
    Mais uma quinta: o cleanup de `subscribe` remove tudo (após ele, nenhum
    evento aciona nada).

    **`voice-context.tsx`** — trocar os três call-sites, sem tocar em mais nada:
    - linha ~648 (`applyVoicePreferencesAsync`):
      `window.voice.setPttModeActive(...)` -> `pushToTalk.setActive(...)`.
    - linhas ~1441-1462 (o efeito de PTT): os dois `window.voice.onPttKey*`
      viram uma única chamada `pushToTalk.subscribe({ onDown, onUp })`, com os
      MESMOS corpos de handler (early-return por `activeChannelRef.current ===
      null`, por modo != 'ptt' e por `manualMuteRef.current` — a regra "mute
      manual sempre vence" não muda).
    - linha ~1465 (cleanup): `window.voice.setPttModeActive(false)` ->
      `pushToTalk.setActive(false)`.
    Import: `import { pushToTalk } from '@platform/ptt'`.
    **Não alterar a lógica de VAD, nem a fila de transições, nem nada mais
    deste arquivo neste plano.** Autoplay é do Plano 10-05.
  </action>
  <verify>
    `grep -n "window.voice" src/renderer/src/state/voice-context.tsx` não retorna nada.
    `npx vitest run src/renderer/src/platform/web/ptt.test.ts` — 5+ testes passando.
    `npm run typecheck` e `npm run typecheck:web-target` exit 0.
    `npx vitest run` sem regressão sobre os 644.
  </verify>
  <done>PTT tem duas implementações conformes ao contrato; a web fecha o microfone ao perder o foco e isso está provado por teste; o Electron faz exatamente o que fazia.</done>
</task>

<task type="auto">
  <name>Task 2: Compartilhamento de tela atrás do contrato, e o seletor próprio mudando de bairro</name>
  <files>src/renderer/src/platform/electron/screenshare.tsx, src/renderer/src/platform/web/screenshare.tsx, src/renderer/src/platform/electron/ScreenSharePicker.tsx, src/renderer/src/platform/electron/ScreenSharePicker.test.tsx, src/renderer/src/components/shell/ScreenSharePicker.tsx, src/renderer/src/components/shell/ScreenSharePicker.test.tsx, src/renderer/src/components/shell/AppShell.tsx</files>
  <action>
    **Mover** (com `git mv`, preservando histórico) `ScreenSharePicker.tsx` e
    `ScreenSharePicker.test.tsx` de `src/renderer/src/components/shell/` para
    `src/renderer/src/platform/electron/`. Ajustar apenas os imports que
    quebrarem (o teste importa `./ScreenSharePicker` — continua válido; os
    imports de `@/lib/...` e `@/components/ui/...` continuam válidos porque são
    por alias). **Os 23 testes precisam continuar passando sem nenhuma
    alteração de asserção.** Se alguma asserção precisar mudar, é sinal de que
    algo além do caminho mudou — parar e reportar.

    Por que mover: o seletor é 326 linhas que falam `window.screenshare`
    diretamente. Enquanto ele viver em `components/shell/`, (a) o bundler web
    poderia alcançá-lo por um import descuidado e (b) a guarda de lint do Plano
    10-07 precisaria de uma exceção nominal para ele. Movido, ele fica atrás do
    alias, e a regra "nada de `window.*` fora de `platform/electron/**`" fica
    sem exceções.

    **`platform/electron/screenshare.tsx`:**

        export const screenShare: PlatformScreenShare = {
          captureOptions(contentHint) { return { audio: false, video: true, contentHint } },
          startAudio: (room) => startProcessAudio(room),   // o caminho da Fase 8.6
          stopAudio: () => stopProcessAudio(),
          Extras: ScreenSharePicker
        }

    **Este arquivo recebe, MOVIDO de `voice-context.tsx`, todo o corpo de
    `startScreenShareAudio` e `stopScreenShareAudio`** (linhas ~760-975), junto
    com as constantes de texto (`AUDIO_UNAVAILABLE_MESSAGES`,
    `AUDIO_BRIDGE_FAILED_MESSAGE`, `NO_AUDIO_YET_MESSAGE`,
    `AUDIO_PUBLISH_FAILED_MESSAGE`), o `screenShareAudioRef` (que vira um
    módulo-level `let active: ... | null`, com o mesmo contrato de
    idempotência) e o import de `createScreenShareAudioBridge`.
    **Regras que NÃO podem se perder no movimento** — cada uma custou uma
    sessão de depuração e está comentada no código de origem; copiar os
    comentários junto:
    - a preferência `systemAudio` é relida DEPOIS de `setScreenShareEnabled`
      resolver (FIX de 2026-08-25) — nunca antes do diálogo;
    - `publishTrack` com `source: Track.Source.ScreenShareAudio`,
      `forceStereo: true`, `dtx: false`, `red: false`,
      `audioPreset: musicHighQualityStereo`;
    - `screenShareAudioRef` zerado no INÍCIO de `stopAudio`, não no fim;
    - cada passo do teardown no seu próprio try/catch;
    - a proibição por extenso de `startSystemAudio()` / loopback de dispositivo;
    - a NOTA HISTÓRICA sobre `restrictOwnAudio` no Electron (o comentário de
      `voice-context.tsx:73-96`) vai junto — **e ganha um parágrafo novo**
      dizendo que na WEB a história é outra (a concessão não é do processo
      main; ver `platform/web/screenshare.tsx`), para ninguém ler a proibição
      do desktop e concluir que a web também não pode.

    **`platform/web/screenshare.tsx`:**

        captureOptions(contentHint) {
          return {
            audio: { restrictOwnAudio: true },  // DENTRO de audio: é constraint de áudio
            video: true,
            contentHint,
            systemAudio: 'include',
            selfBrowserSurface: 'exclude',
            surfaceSwitching: 'include'
          }
        }

    Comentário obrigatório, verificado no SDK instalado
    (`livekit-client.esm.mjs:13350-13359`): `screenCaptureToDisplayMediaStreamOptions`
    repassa ao `getDisplayMedia` apenas `{ audio, video, controller,
    selfBrowserSurface, surfaceSwitching, systemAudio, preferCurrentTab }` — o
    `suppressLocalAudioPlayback` do nível de cima **NÃO é repassado**. Quem
    precisar dele tem que mandá-lo dentro de `audio: { ... }`. Ignorado em
    silêncio é pior que erro; deixar isso escrito aqui é o que impede a
    próxima pessoa de "ligar a opção" e não entender por que nada mudou.

    `Extras: () => null` — o Chrome desenha o próprio seletor; não montar nada.
    Comentar que os 23 testes do seletor continuam válidos, para o alvo
    Electron.

    `startAudio(room)` neste plano é um **stub honesto**: um `console.info`
    dizendo que na web o áudio já veio (ou não veio) junto do
    `getDisplayMedia`, e nada mais. A leitura de volta de
    `getSettings().restrictOwnAudio`, o veredito e os textos são o Plano 10-06,
    que é dono deste arquivo depois. `stopAudio()` é no-op documentado: não há
    captura nativa própria para encerrar — o LiveKit despublica a faixa de
    áudio junto com a de vídeo, porque ela nasceu com
    `source = ScreenShareAudio` (`livekit-client.esm.mjs:29010-29013`).

    **`voice-context.tsx`:**
    - importar `import { screenShare } from '@platform/screenshare'`;
    - `screenShareCaptureOptions(contentHint)` (linhas 73-105) é REMOVIDA daqui
      e o call-site de `setScreenShareEnabled` (linha ~728) passa a usar
      `screenShare.captureOptions(contentHint)`;
    - `startScreenShareAudio()` / `stopScreenShareAudio()` viram
      `screenShare.startAudio(room)` / `screenShare.stopAudio()`, mantendo
      **exatamente** os mesmos pontos de chamada e a mesma ordem (em
      particular: `stopAudio` ANTES de `setScreenShareEnabled(false)`, e o
      gancho de `LocalTrackUnpublished` continua chamando o mesmo teardown);
    - `QUALITY_PRESETS` FICA em `voice-context.tsx` — é decisão de produto
      compartilhada pelos dois alvos, não diferença de plataforma.

    **`AppShell.tsx`:** trocar `import { ScreenSharePicker } from
    '@/components/shell/ScreenSharePicker'` por
    `import { screenShare } from '@platform/screenshare'` e o `<ScreenSharePicker />`
    da linha ~174 por `<screenShare.Extras />`. Nada mais deste arquivo.
  </action>
  <verify>
    `grep -n "window.screenshare" src/renderer/src/state/voice-context.tsx` não retorna nada (nem em comentário: o comentário da linha ~1147 também precisa ser reescrito para falar do contrato).
    `grep -rn "window\." src/renderer/src --include=*.ts --include=*.tsx | grep -v "src/renderer/src/platform/electron/" | grep -E "window\.(auth|voice|screenshare|electron)"` retorna SOMENTE os arquivos de auth (Plano 10-03), e nenhum de voz/tela.
    `npx vitest run src/renderer/src/platform/electron/ScreenSharePicker.test.tsx` — 23 testes, todos passando, asserções inalteradas.
    `npm run typecheck` + `npm run typecheck:web-target` exit 0.
    `npm run build` (desktop) exit 0; `npm run verify:renderer-runtime` exit 0.
    `npm run build:web && npm run verify:web-bundle` — a afirmação 2 (sentinela electron ausente) continua passando, e o aviso da afirmação 3 caiu para SÓ os arquivos de auth.
  </verify>
  <done>Compartilhamento de tela tem duas implementações conformes; o seletor próprio vive dentro de `platform/electron/` com os 23 testes intactos; `voice-context.tsx` não fala mais com `window` para nada de voz ou tela.</done>
</task>

</tasks>

<verification>
**O que passou a ser verificável NESTE ambiente (WSL2):**
- A trava de `blur` do push-to-talk web — provada por teste em jsdom, sem
  precisar de teclado, microfone ou navegador gráfico. É o defeito mais caro
  desta costura (microfone aberto para sempre) e ele fica coberto por
  automação, não por lembrança.
- Que o bundle web não contém mais `window.voice` nem `window.screenshare`
  (`verify:web-bundle`, afirmação 3, comparado com a baseline do 10-01).
- Que os 23 testes do seletor sobreviveram à mudança de diretório.

**O que continua exigindo o Chrome do Leo (localhost:5173, WSL2 alcança):**
- PTT de verdade abrindo e fechando o microfone numa call — o teste prova o
  contrato dos eventos, não que o áudio sai.
- O diálogo do Chrome aparecendo com as opções certas (aba/janela/tela) e o
  `selfBrowserSurface: 'exclude'` de fato escondendo a própria aba.

**O que continua exigindo Windows nativo:**
- Todo o caminho de áudio por processo do desktop (Fase 8.6): este plano MOVE
  esse código de arquivo sem alterar uma vírgula de lógica, mas mover código
  não é verificar código. O roteiro da Parte 3 de
  `.planning/CHECKPOINT-WINDOWS.md` continua sendo a única prova.

**Prova de que o desktop não regrediu:**
1. Os 644 testes + os 23 do seletor movido continuam passando.
2. `npm run typecheck` e `npm run build` verdes.
3. `npm run verify:renderer-runtime` verde.
4. **A prova que mais importa é de leitura, não de comando:** o diff do
   caminho Electron precisa ser puro movimento. Ao escrever o SUMMARY,
   afirmar explicitamente, chamada por chamada, que
   `startScreenShareAudio`/`stopScreenShareAudio` mantiveram ordem, guardas,
   try/catch por passo e os cinco parâmetros de `publishTrack`. Qualquer
   diferença de comportamento aqui é regressão de uma fase que ainda nem foi
   verificada em Windows.
</verification>

<success_criteria>
- Zero ocorrências de `window.voice`/`window.screenshare` fora de
  `src/renderer/src/platform/electron/`.
- `platform/web/ptt.test.ts` prova as cinco regras, incluindo blur.
- 23 testes do `ScreenSharePicker` passando no novo diretório, sem edição de
  asserção.
- `restrictOwnAudio` aparece DENTRO de `audio: { ... }` no
  `platform/web/screenshare.tsx`, com o comentário sobre o que o SDK repassa e
  o que não repassa.
- `npm run build`, `npm run build:web`, `npm run typecheck`,
  `npm run typecheck:web-target` e `npx vitest run` todos verdes.
</success_criteria>

<output>
Ao terminar, criar `.planning/phases/10-versao-web/10-02-SUMMARY.md`, com uma
seção obrigatória "O movimento foi puro?" listando, item a item, o que foi
movido de `voice-context.tsx` para `platform/electron/screenshare.tsx` e a
afirmação explícita de que nenhuma regra de ordem/guarda/parâmetro mudou.
</output>
