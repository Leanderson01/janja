---
phase: 07-voz
plan: 06
subsystem: voice
tags: [uiohook-napi, electron-main, ipc, push-to-talk, react-context]

# Dependency graph
requires:
  - phase: 07-05
    provides: "voice-preferences.ts (VoiceMode = 'vad' | 'ptt', persistido em localStorage), setManualMute()/manualMuteRef, AUDIO_CAPTURE_OPTIONS centralizado em voice-context.tsx"
provides:
  - "src/main/voice/ptt.ts: hook global de teclado (uiohook-napi) no processo main, com captura nativa ligada/desligada sob demanda conforme o modo de voz salvo, e filtro de auto-repeat de keydown"
  - "src/main/voice/types.ts: VOICE_CHANNELS (PTT_KEY_DOWN, PTT_KEY_UP, SET_PTT_MODE_ACTIVE)"
  - "window.voice (preload): onPttKeyDown/onPttKeyUp/setPttModeActive, seguindo o padrão de window.auth"
  - "VoiceProvider: liga/desliga a track real do microfone em resposta aos eventos de PTT, só quando o modo salvo é 'ptt' e há canal conectado, respeitando mute manual"
affects: ["07-08 (verificação final humana em Windows — única forma de confirmar 'funciona sem foco')", "09 (empacotamento — asarUnpack de uiohook-napi, já mapeado em 09-RESEARCH.md, nada pendente deste plano)"]

# Tech tracking
tech-stack:
  added: ["uiohook-napi ^1.5.5 (dependência de runtime do processo main)"]
  patterns:
    - "Hook nativo global registrado uma vez em app.whenReady(), mas com uIOhook.start()/stop() controlado por um sinal explícito do renderer (SET_PTT_MODE_ACTIVE) — nunca captura teclado do SO por padrão, só enquanto o modo salvo é 'ptt'"
    - "Canais IPC de voz seguem o mesmo padrão de src/main/auth: types.ts com constantes de canal, preload duplicando essas constantes localmente (nunca importando runtime do processo main), window.<api> via contextBridge"

key-files:
  created:
    - "src/main/voice/ptt.ts"
    - "src/main/voice/types.ts"
  modified:
    - "src/main/index.ts"
    - "src/preload/index.ts"
    - "src/preload/index.d.ts"
    - "src/renderer/src/state/voice-context.tsx"
    - "package.json"

key-decisions:
  - "Adicionado um terceiro canal IPC (SET_PTT_MODE_ACTIVE, renderer -> main) não pedido textualmente pelo plano: o processo main só chama uIOhook.start() quando o renderer confirma que o modo salvo é 'ptt', e chama uIOhook.stop() caso contrário — nunca roda a captura nativa de teclado à toa em modo VAD (o padrão). Motivado por um hard constraint explícito do prompt de execução sobre superfície mínima de um hook global de teclado; o design original do 07-RESEARCH.md §7 (hook sempre rodando, renderer decide se age) continua válido para o FILTRO de qual tecla importa, mas não para decidir se a captura nativa liga."
  - "Tecla fixa (Right Control) mantida hardcoded em ptt.ts, sem nenhuma configuração exposta — consistente com 07-RESEARCH.md §7 (v1 não pede remapeamento)."
  - "Filtro de auto-repeat implementado com uma flag booleana local (isKeyCurrentlyDown) no processo main, não no renderer — o processo main é quem recebe o evento bruto do SO, então é o ponto certo para descartar repetições antes até de gerar o primeiro IPC."

patterns-established:
  - "Módulo nativo N-API no processo main: node-gyp-build resolve o prebuild certo em runtime sem depender do SO que rodou `npm install` — confirmado empiricamente (não só por doc) requerendo uiohook-napi dentro do processo main real do Electron via smoke test."

# Metrics
duration: ~35min
completed: 2026-08-19
---

# Phase 07 Plan 06: Push-to-Talk Summary

**Hook global de teclado via `uiohook-napi` no processo main, com captura nativa ligada/desligada sob demanda pelo modo de voz salvo (nunca capturando teclado em modo VAD), encaminhando keydown/keyup da tecla fixa (Right Control) por IPC para o `VoiceProvider` controlar a track real do microfone.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2/2
- **Files modified:** 6 (2 criados: `src/main/voice/ptt.ts`, `src/main/voice/types.ts`; 4 modificados: `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/src/state/voice-context.tsx`) + `package.json`/`package-lock.json`

## Accomplishments

- **Spike de instalação (primeiro passo, antes de qualquer código):**
  `npm install uiohook-napi` resolveu sem erro. Confirmado que o pacote
  publicado (`1.5.5`) já embute prebuilds N-API por plataforma
  (`node_modules/uiohook-napi/prebuilds/{darwin,linux,win32}-{x64,arm64}/`),
  incluindo `win32-x64` — bate exatamente com o que `09-RESEARCH.md §2`
  já tinha verificado inspecionando o tarball publicado. Testei além do
  que o plano pedia como mínimo: além do `require()` em Node puro, rodei
  o módulo **dentro do processo main real do Electron** (`xvfb-run
  node_modules/.bin/electron` apontando para um app mínimo que só faz
  `app.whenReady().then(() => require('uiohook-napi'))`) — carregou sem
  `MODULE_NOT_FOUND`/erro de ABI, sem precisar de `@electron/rebuild`.
  Script descartável, não commitado.
- `src/main/voice/types.ts`: `VOICE_CHANNELS` com três canais —
  `PTT_KEY_DOWN`/`PTT_KEY_UP` (main -> renderer) e `SET_PTT_MODE_ACTIVE`
  (renderer -> main, ver Decisions).
- `src/main/voice/ptt.ts`: `startPttHook(sender)` registra os listeners
  `keydown`/`keyup` do `uIOhook` uma única vez (chamado em
  `app.whenReady()`), filtrando por `UiohookKey.CtrlRight` e descartando
  auto-repeat via uma flag local (`isKeyCurrentlyDown`). `setPttModeActive(active)`
  liga/desliga a captura nativa (`uIOhook.start()`/`stop()`) — idempotente,
  nunca herda o estado de tecla pressionada de uma janela de captura
  anterior. `stopPttHook()` para tudo (captura + listeners), chamado em
  `before-quit`.
- `src/main/index.ts`: `startPttHook(...)` chamado dentro de
  `app.whenReady()` (mesmo bloco de `setupAuthIpcHandlers`), enviando pelo
  `mainWindow.webContents.send(channel)` com guarda `!isDestroyed()`.
  `ipcMain.on(VOICE_CHANNELS.SET_PTT_MODE_ACTIVE, ...)` encaminha para
  `setPttModeActive`. `stopPttHook()` no handler de `before-quit`.
- `src/preload/index.ts`/`index.d.ts`: `voiceApi`
  (`onPttKeyDown`/`onPttKeyUp`/`setPttModeActive`) exposto via
  `contextBridge.exposeInMainWorld('voice', voiceApi)`, seguindo
  exatamente o padrão de `authApi` (canais duplicados localmente, nunca
  importa runtime do processo main).
- `VoiceProvider` (`voice-context.tsx`): novo `useEffect` (mount-only)
  registra `window.voice.onPttKeyDown`/`onPttKeyUp`. `PTT_KEY_DOWN` liga o
  microfone (`setMicrophoneEnabled(true, AUDIO_CAPTURE_OPTIONS)`) só se
  `loadVoicePreferences().mode === 'ptt'`, há canal conectado
  (`activeChannelRef.current !== null`) e não há mute manual ativo
  (`manualMuteRef.current`) — mesma prioridade que o VAD já respeita.
  `PTT_KEY_UP` desliga incondicionalmente (harmless mesmo com mute
  manual). `applyVoicePreferences()` foi estendida para chamar
  `window.voice.setPttModeActive(prefs.mode === 'ptt')` sempre que a
  preferência é (re)lida — no boot do provider, a cada join bem-sucedido, e
  a cada mudança feita no painel de configurações — mantendo o processo
  main sincronizado com o modo real independente de haver canal conectado.

## Task Commits

Nenhum commit foi feito — `NO_GIT` no prompt de execução: arquivos ficam
não commitados, o orquestrador commita.

## Files Created/Modified

- `src/main/voice/types.ts` - `VOICE_CHANNELS` (3 canais IPC de voz)
- `src/main/voice/ptt.ts` - hook global de teclado, captura ligada/desligada sob demanda
- `src/main/index.ts` - registra o hook no ciclo de vida do app (`whenReady`/`before-quit`)
- `src/preload/index.ts` - `voiceApi` exposto via `contextBridge`
- `src/preload/index.d.ts` - `VoiceApi`, `window.voice`
- `src/renderer/src/state/voice-context.tsx` - listeners de PTT, sincronização de modo com o main
- `package.json`/`package-lock.json` - dependência `uiohook-napi`

## Decisions Made

Ver `key-decisions` no frontmatter. Resumo do ponto com mais impacto:

**Captura nativa liga/desliga conforme o modo, não roda sempre.** O
`07-RESEARCH.md §7` desenhava um processo main "burro" — sempre escutando
a mesma tecla fixa, encaminhando `keydown`/`keyup` continuamente, deixando
o renderer decidir se age com base no modo. Esse desenho continua correto
para o **filtro de qual tecla importa** (`CtrlRight`, decidido no main,
nunca reconfigurável). Mas o prompt de execução trouxe um requisito
explícito adicional: um hook global de teclado lê todo evento de tecla do
SO por natureza, e por isso a captura nativa em si (`uIOhook.start()`) só
deve rodar quando push-to-talk é de fato o modo ativo — nunca por padrão,
já que o modo padrão é VAD. Implementado com um terceiro canal IPC
(`SET_PTT_MODE_ACTIVE`) que o renderer dispara a cada leitura de
preferência (`applyVoicePreferences()`), incluindo no boot do provider.
Resultado: em instalação nova (modo VAD, o default), o processo main nunca
chega a chamar `uIOhook.start()` — o hook só liga quando o usuário
explicitamente escolhe push-to-talk no painel de configurações.

## Deviations from Plan

### Auto-fixed Issues

**1. [Regra 2 - Funcionalidade crítica ausente] Captura nativa de teclado não tinha como ser desligada quando o modo não é PTT**

- **Found during:** Task 1, ao ler o prompt de execução (hard constraints sobre superfície mínima de um hook global de teclado) antes de escrever `ptt.ts`
- **Issue:** O desenho original (`07-RESEARCH.md §7`) tinha o hook nativo sempre rodando (`uIOhook.start()` incondicional em `app.whenReady()`), delegando toda decisão de modo ao renderer. Isso significa que, mesmo em modo VAD (o padrão, nunca alterado por ninguém), o processo main estaria permanentemente com um hook global de teclado ativo capturando todo evento de tecla do sistema operacional — superfície desnecessária para uma feature que o usuário nem escolheu usar.
- **Fix:** Separado registro de listeners (`startPttHook`, sempre chamado uma vez) de ligar/desligar a captura de fato (`setPttModeActive`, controlado por IPC vindo do renderer). Renderer chama `window.voice.setPttModeActive(mode === 'ptt')` a cada leitura de preferência — boot do provider, join bem-sucedido, e qualquer mudança no painel de configurações — via `applyVoicePreferences()`.
- **Files modified:** `src/main/voice/ptt.ts`, `src/main/voice/types.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/src/state/voice-context.tsx`
- **Verification:** `npm run typecheck`, `npm run build`, `npx vitest run` (173/173). Comportamento real do liga/desliga só é observável em Windows com o app rodando (Plano 07-08) — WSL2 não valida captura global confiável (07-RESEARCH.md §5).
- **Committed in:** não commitado (NO_GIT)

---

**Total deviations:** 1 auto-fixado (1 funcionalidade crítica ausente)
**Impact on plan:** Nenhuma mudança arquitetural — nenhuma tabela nova, nenhuma lib nova além da já prevista (`uiohook-napi`), nenhum contrato quebrado. O terceiro canal IPC é aditivo dentro dos mesmos arquivos já listados em `files_modified` do plano. A API pública exportada por `ptt.ts` ganhou uma função extra (`setPttModeActive`) além das duas previstas (`startPttHook`/`stopPttHook`), mas manteve as duas exatamente com a assinatura pedida.

## Issues Encountered

- **Nenhum bloqueio de autenticação** — `uiohook-napi` não depende de nenhuma credencial externa.
- **`react-refresh/only-export-components` em `voice-context.tsx`**:
  confirmado (via `git show HEAD:... | eslint --stdin`, sem alterar o
  working tree) que este erro já existia ANTES deste plano — mesma
  convenção já assinalada como não-regressão em `07-03-SUMMARY.md`/`07-05-SUMMARY.md`.
  Não é uma linha nova introduzida aqui; não corrigido, fora de escopo.
- **`prettier/prettier` (warning) em `src/main/index.ts`**: formatação do
  bloco de import de `./auth/deep-link-handler`, também pré-existente e
  não tocado por este plano — confirmado por não estar na região do meu
  diff.
- **Verificação real de "funciona sem foco" não é possível neste
  ambiente.** WSL2 roda sob WSLg (compositor Wayland com camada de
  compatibilidade X11) — `uiohook-napi` no Linux depende de X11
  (XRecord/XTest), e essa camada não garante hooks globais de teclado
  como um X server completo (07-RESEARCH.md §5). O que foi verificado
  aqui: (1) o módulo carrega sem erro dentro do processo main real do
  Electron (smoke test descrito em Accomplishments); (2) `npm run dev`
  sobe sem nenhum erro relacionado a `uiohook-napi`/`node-gyp-build`
  (rodado sob `xvfb-run`, sem crash em ~20s de execução); (3) o código
  compila e os 173 testes existentes continuam passando. Nada disso prova
  que segurar `Right Control` liga o microfone com a janela minimizada —
  essa prova só existe no Plano 07-08, em Windows nativo.

## User Setup Required

None - nenhuma configuração externa nova. `uiohook-napi` não requer
credenciais nem serviço externo.

## Next Phase Readiness

**Pronto para 07-08 (verificação final):**
- Código de push-to-talk completo no nível de fonte: hook global
  registrado, captura liga/desliga com o modo, IPC exposto, `VoiceProvider`
  reagindo aos eventos com a mesma prioridade de mute manual que o VAD já
  respeita.
- `applyVoicePreferences()` é o único ponto de sincronização entre
  `localStorage` (renderer) e o processo main — qualquer novo call-site
  futuro que precise saber "o modo mudou" deve chamar essa função, não
  duplicar a leitura de preferência.

**Não verificado neste plano (exige Windows nativo — Plano 07-08):**
- Que segurar `Right Control` de fato liga o microfone com o app sem foco
  (minimizado ou atrás de outra janela) — o requisito central de VOICE-11,
  inteiramente dependente de hardware/SO real.
- Que soltar a tecla desliga o microfone sem atraso perceptível.
- Que trocar de VAD para PTT no painel de configurações efetivamente para
  a captura de teclado do modo anterior (VAD nunca liga captura nenhuma,
  mas o inverso — PTT para VAD — deve confirmar que `uIOhook.stop()` foi
  chamado e nenhum evento de teclado residual chega depois).
- Que o binário `win32-x64` embutido no pacote publicado (confirmado por
  inspeção estática em `09-RESEARCH.md §2` e por leitura do diretório
  local `node_modules/uiohook-napi/prebuilds/win32-x64/` nesta execução)
  de fato funciona quando `npm install` roda a partir de uma máquina
  Windows real, não só quando inspecionado a partir do WSL2.
- Sobrevivência ao empacotamento (`electron-builder`) — fora do escopo
  deste plano por design (07-RESEARCH.md §5, "risco cross-fase F7→F9"),
  tratado no Fase 9 (`asarUnpack` explícito, já decidido em
  `09-RESEARCH.md §2`, `npmRebuild: false` mantido).

---
*Phase: 07-voz*
*Completed: 2026-08-19*
