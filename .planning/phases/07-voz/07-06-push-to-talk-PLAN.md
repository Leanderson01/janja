---
phase: 07-voz
plan: 06
type: execute
wave: 5
depends_on: ["07-05"]
files_modified:
  - package.json
  - src/main/voice/ptt.ts
  - src/main/voice/types.ts
  - src/main/index.ts
  - src/preload/index.ts
  - src/preload/index.d.ts
  - src/renderer/src/state/voice-context.tsx
autonomous: true

must_haves:
  truths:
    - "Com o modo push-to-talk selecionado, segurar a tecla fixa liga o microfone e soltar desliga, mesmo com o app sem foco"
  artifacts:
    - path: "src/main/voice/ptt.ts"
      provides: "Hook global de teclado via uiohook-napi, emitindo keydown/keyup da tecla fixa de PTT por IPC"
      contains: "uIOhook"
  key_links:
    - from: "src/main/voice/ptt.ts"
      to: "src/renderer/src/state/voice-context.tsx"
      via: "IPC (preload) → room.localParticipant.setMicrophoneEnabled, só quando o modo salvo é 'ptt'"
      pattern: "onPttKeyDown"
---

<objective>
Implementar push-to-talk de verdade: um hook global de teclado no processo
main (`uiohook-napi`, já que `globalShortcut` do Electron não separa
keydown/keyup) que funciona mesmo com o app sem foco, encaminhado por IPC
para o renderer controlar o microfone.

Purpose: fecha VOICE-11 e a metade PTT de VOICE-09. É o plano de maior risco
técnico da fase — módulo nativo, packaging futuro (F9), e o próprio ambiente
de desenvolvimento (WSL2) não prova "funciona sem foco" de verdade. Por isso
vem depois de todo o resto do controle de voz já estar sólido (Planos
07-01 a 07-05), não antes.
Output: tecla fixa de PTT funcional em Windows nativo (validação formal no
Plano 07-08); em WSL2, só "compila e não crasha".
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/07-voz/07-RESEARCH.md
@.planning/research/PITFALLS.md
@src/main/auth/types.ts
@src/main/index.ts
@src/preload/index.ts
@src/preload/index.d.ts
@src/renderer/src/lib/voice-preferences.ts
@src/renderer/src/state/voice-context.tsx

# Seguir o MESMO padrão já estabelecido em src/main/auth/ (types.ts com
# constantes de canal IPC, wiring em preload/index.ts + index.d.ts, registro
# no processo main) — não inventar uma convenção nova para voz.
#
# A tecla de PTT é FIXA nesta versão (Right Control, ver 07-RESEARCH.md
# §7) — nenhum requisito pede remapeamento, e adicionar isso agora
# aumentaria o escopo sem necessidade.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Hook global de teclado no processo main</name>
  <files>package.json, src/main/voice/ptt.ts, src/main/voice/types.ts, src/main/index.ts</files>
  <action>
    `npm install uiohook-napi`. **Primeiro passo, antes de qualquer outra
    coisa neste plano**: confirmar que o pacote resolve um binário sem erro
    de `MODULE_NOT_FOUND`/ABI (`07-RESEARCH.md` §5 sinaliza isso como spike
    obrigatório, não confirmado por doc). Se falhar sob Electron (ABI do V8
    do Electron difere do Node puro), avaliar `@electron/rebuild` como
    devDependency e documentar no SUMMARY — não empacar isso silenciosamente
    se não resolver de primeira.

    `src/main/voice/types.ts`: seguindo o padrão de
    `src/main/auth/types.ts`, exportar
    `VOICE_CHANNELS = { PTT_KEY_DOWN: 'voice:ptt-key-down', PTT_KEY_UP: 'voice:ptt-key-up' } as const`.

    `src/main/voice/ptt.ts`: exportar `startPttHook(sendToRenderer: (channel: string) => void)`
    e `stopPttHook()`. Internamente, importar `uIOhook`/`UiohookKey` de
    `uiohook-napi`, registrar `uIOhook.on('keydown', (e) => { if (e.keycode === UiohookKey.CtrlRight) sendToRenderer(VOICE_CHANNELS.PTT_KEY_DOWN) })`
    e o par simétrico para `'keyup'`, e chamar `uIOhook.start()`. Guardar
    estado local para não reenviar `keydown` repetido enquanto a tecla
    continua pressionada (o SO gera auto-repeat de keydown; sem esse
    filtro, o IPC dispara dezenas de vezes por segundo à toa).

    Em `src/main/index.ts`: chamar `startPttHook(...)` dentro de
    `app.whenReady()` (mesmo ponto onde outras inicializações do main já
    acontecem), passando uma função que usa `mainWindow.webContents.send(channel)`.
    Chamar `stopPttHook()` no handler de `before-quit` — não deixar o hook
    nativo vivo depois do processo Electron começar a encerrar.
  </action>
  <verify>`npm run dev` sobe sem erro relacionado a `uiohook-napi` (mesmo que a captura real de teclado não seja verificável em WSL2 — ver `07-RESEARCH.md` §5). `npm run build`/typecheck do processo main passa.</verify>
  <done>Hook nativo instalado, registrado no ciclo de vida do app, emitindo os dois canais IPC ao pressionar/soltar a tecla fixa — sem duplicar eventos por auto-repeat.</done>
</task>

<task type="auto">
  <name>Task 2: Expor por IPC e consumir no VoiceProvider</name>
  <files>src/preload/index.ts, src/preload/index.d.ts, src/renderer/src/state/voice-context.tsx</files>
  <action>
    Em `src/preload/index.ts`, seguindo o padrão de `authApi` já existente:
    adicionar `voiceApi` com `onPttKeyDown(callback)`/`onPttKeyUp(callback)`,
    cada um registrando um listener em `ipcRenderer.on(...)` e retornando a
    função de cleanup (mesmo formato de `onAuthChange`). Expor via
    `contextBridge.exposeInMainWorld('voice', voiceApi)`. Atualizar
    `index.d.ts` com a interface `VoiceApi` e `window.voice: VoiceApi`.

    No `VoiceProvider` (`voice-context.tsx`): registrar
    `window.voice.onPttKeyDown(...)`/`onPttKeyUp(...)` num `useEffect` (uma
    vez, no mount do provider — não depende de estar conectado, já que o
    usuário pode segurar a tecla antes mesmo de entrar num canal, e nesse
    caso o handler simplesmente não faz nada por não haver
    `localParticipant`). Ao receber `PTT_KEY_DOWN`: se
    `loadVoicePreferences().mode === 'ptt'` **e** há uma conexão ativa,
    chamar `room.localParticipant.setMicrophoneEnabled(true)`. Ao receber
    `PTT_KEY_UP`, o inverso (`false`). Se o modo salvo for `'vad'`, ignorar
    os eventos por completo — nunca deixar PTT e VAD brigando pelo controle
    da mesma track ao mesmo tempo.

    Limpar os listeners (chamar as funções de cleanup retornadas) no
    unmount do provider.
  </action>
  <verify>Verificação humana formal no Plano 07-08 (Windows nativo, app sem foco). Localmente: `window.voice` existe no `DevTools` console do renderer, e chamar manualmente os callbacks simulados confirma que o modo é respeitado (PTT ignora eventos quando `mode === 'vad'`).</verify>
  <done>PTT liga/desliga a track real do microfone só quando o modo salvo é 'ptt', reagindo aos eventos IPC do processo main.</done>
</task>

</tasks>

<verification>
- `grep -n "CtrlRight\|keydown\|keyup" src/main/voice/ptt.ts` confirma o filtro de auto-repeat.
- `voice-context.tsx` nunca aciona `setMicrophoneEnabled` a partir de eventos de PTT quando `loadVoicePreferences().mode === 'vad'`.
</verification>

<success_criteria>
VOICE-11 e a metade PTT de VOICE-09 implementadas no nível de código — a
prova de "funciona sem foco" em máquina Windows real é o Plano 07-08.
</success_criteria>

<output>
After completion, create `.planning/phases/07-voz/07-06-SUMMARY.md`
</output>
