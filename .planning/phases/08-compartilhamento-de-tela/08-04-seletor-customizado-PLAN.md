---
phase: 08-compartilhamento-de-tela
plan: 04
type: execute
wave: 3
depends_on: ["08-02", "08-03"]
files_modified:
  - src/main/screenshare.ts
  - src/preload/index.ts
  - src/preload/index.d.ts
  - src/renderer/src/components/shell/ScreenSharePicker.tsx
  - src/renderer/src/state/voice-context.tsx
autonomous: true

must_haves:
  truths:
    - "Usuário vê miniaturas de todas as telas e janelas disponíveis e escolhe qual compartilhar, em vez de sempre pegar a primeira tela"
    - "Cancelar o seletor (fechar o diálogo sem escolher) não deixa o botão de compartilhar tela travado, e uma nova tentativa imediatamente depois funciona"
    - "Lista de fontes vazia (desktopCapturer.getSources() retorna []) é tratada sem exceção não tratada, mesmo sem esse cenário ser reproduzível em teste manual"
  artifacts:
    - path: "src/main/screenshare.ts"
      provides: "Handler estendido: em vez de pegar sources[0] direto, manda a lista (com thumbnails em data URL) pro renderer via IPC e aguarda a escolha (ou cancelamento) antes de chamar callback"
      contains: "toDataURL"
    - path: "src/renderer/src/components/shell/ScreenSharePicker.tsx"
      provides: "Dialog com grid de miniaturas (telas e janelas), abas ou seção separada por tipo, botão de cancelar explícito"
      min_lines: 40
  key_links:
    - from: "src/main/screenshare.ts"
      to: "src/renderer/src/components/shell/ScreenSharePicker.tsx"
      via: "IPC: main manda 'screenshare:pick-requested' com a lista de fontes; renderer responde 'screenshare:source-chosen' ou 'screenshare:picker-cancelled'"
      pattern: "pick-requested"
    - from: "src/preload/index.ts"
      to: "electron ipcRenderer"
      via: "contextBridge expõe só os 3 canais nomeados (getSources implícito no evento, chooseSource, cancelPicker) — nunca ipcRenderer cru, mesmo padrão de auth já usado neste arquivo"
      pattern: "contextBridge.exposeInMainWorld"
---

<objective>
Substituir a escolha automática da primeira tela (Plano 08-02) por um
seletor customizado de verdade — telas e janelas, com miniaturas — já que o
Electron não tem um picker nativo (`08-RESEARCH.md` §2). Sem quebrar a
garantia central do Pitfall 2: cancelar o seletor, ou não ter nenhuma fonte
disponível, nunca deixa a Promise do renderer pendurada.

Purpose: fecha SHARE-01 (miniaturas) por completo e a base de SHARE-07
(cancelamento não trava tentativas futuras) — construído só depois do Plano
08-03 confirmar que o caminho de mídia por baixo funciona, para não polir UI
em cima de um alicerce quebrado.
Output: clicar em "Compartilhar tela" abre um diálogo com miniaturas reais
de telas e janelas; escolher uma compartilha; cancelar fecha o diálogo sem
efeito colateral e sem travar a próxima tentativa.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/08-compartilhamento-de-tela/08-RESEARCH.md
@.planning/research/PITFALLS.md
@src/main/screenshare.ts
@src/main/index.ts
@src/preload/index.ts
@src/preload/index.d.ts
@src/renderer/src/state/voice-context.tsx
@src/renderer/src/components/shell/VoiceControlBar.tsx

# Este plano assume que o checkpoint 08-03 foi aprovado (o caminho de
# captura+áudio funciona sem eco). Se 08-03 revelou que restrictOwnAudio não
# é suficiente sozinho, este plano NÃO resolve isso — só constrói o seletor
# em cima da mesma chamada de setScreenShareEnabled já existente. Mitigação
# de eco, se necessária, é um ajuste ao Plano 08-02/08-05, não a este.
#
# `VoiceControlBar.tsx` NÃO precisa mudar neste plano — o botão "Compartilhar
# tela" já existe (Plano 08-02) e já chama `startScreenShare()`; a diferença
# agora é o que acontece DENTRO do handler do processo main enquanto essa
# chamada está pendente. Não editar este arquivo aqui.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Handler main aguarda escolha do renderer via IPC, com timeout defensivo</name>
  <files>src/main/screenshare.ts, src/preload/index.ts, src/preload/index.d.ts</files>
  <action>
    Estender `registerScreenShareHandler` (Plano 08-02) para, em vez de
    pegar `sources[0]` direto:
    1. `desktopCapturer.getSources({ types: ['screen', 'window'],
       thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })`.
    2. Se `sources.length === 0`: `callback({})` e retornar — mesmo
       tratamento de Pitfall 2 já existente, sem depender do renderer.
    3. Converter cada `source.thumbnail` (`NativeImage`) para
       `thumbnail.toDataURL()` (string) e `source.appIcon?.toDataURL()`
       antes de mandar por IPC — `NativeImage` não atravessa `ipcMain.send`
       como objeto serializável.
    4. Mandar a lista para o `mainWindow` via
       `mainWindow.webContents.send('screenshare:pick-requested', { sources: [...] })`.
    5. Aguardar a resposta do renderer com uma `Promise` que resolve via
       dois `ipcMain.handle` (registrados uma única vez, fora do handler
       de captura, na mesma `registerScreenShareHandler`):
       `'screenshare:choose-source'` (recebe `sourceId`, resolve a Promise
       pendente com o `source` correspondente) e
       `'screenshare:cancel-picker'` (resolve a Promise pendente com
       `null`). Usar uma variável de closure (`let pendingResolve:
       ((source: DesktopCapturerSource | null) => void) | null`) para
       conectar os handlers de IPC à `Promise` que o `setDisplayMediaRequestHandler`
       está aguardando — se um novo pedido de captura chegar enquanto um
       anterior ainda está pendente (não deveria acontecer, mas é uma
       defesa barata), resolver o anterior com `null` antes de criar um
       novo, para nunca deixar dois pendentes ao mesmo tempo.
    6. **Timeout defensivo de 60s**: se nem `choose-source` nem
       `cancel-picker` chegarem nesse prazo (ex.: renderer travou, usuário
       nunca decide), resolver a Promise pendente com `null` sozinho — é a
       mesma categoria de proteção do Pitfall 2 ("garantir callback mesmo
       se a escolha demorar demais"), implementada aqui porque é o único
       lugar que sabe que uma escolha está pendente.
    7. Se a Promise resolver com um `source` (não `null`):
       `callback({ video: source, audio: 'loopback' })`. Se resolver com
       `null` (cancelamento ou timeout): `callback({})`.
    8. Envolver o bloco inteiro (desde `getSources` até o `callback` final)
       em `try/catch`; qualquer exceção também termina em `callback({})`.

    Em `src/preload/index.ts` e `index.d.ts`: adicionar um objeto
    `screenshare` exposto via `contextBridge` (mesmo padrão de `authApi`
    já existente neste arquivo — nunca `ipcRenderer` cru):
    ```ts
    const screenshareApi = {
      onPickRequested: (callback: (data: { sources: ScreenShareSource[] }) => void): (() => void) => {
        const listener = (_: Electron.IpcRendererEvent, data: { sources: ScreenShareSource[] }): void => callback(data)
        ipcRenderer.on('screenshare:pick-requested', listener)
        return () => ipcRenderer.removeListener('screenshare:pick-requested', listener)
      },
      chooseSource: (sourceId: string): void => ipcRenderer.send('screenshare:choose-source', sourceId),
      cancelPicker: (): void => ipcRenderer.send('screenshare:cancel-picker')
    }
    ```
    (usar `ipcRenderer.send`/`ipcMain.on`, não `invoke`/`handle`, para os
    dois canais de resposta do picker — é um evento de UI, não uma chamada
    que precisa devolver valor ao renderer; `ipcMain.on` do lado main já
    resolve a `Promise` pendente por efeito colateral). Definir
    `ScreenShareSource = { id: string; name: string; thumbnailDataUrl: string; appIconDataUrl?: string; isScreen: boolean }`
    (derivar `isScreen` de `source.id.startsWith('screen:')`) em
    `index.d.ts`, exportado para o componente da Task 2 importar.
  </action>
  <verify>`npm run typecheck` passa. Revisão manual do handler: todo caminho (lista vazia, escolha, cancelamento, timeout, exceção) termina em exatamente uma chamada a `callback(...)`, nunca zero, nunca duas.</verify>
  <done>Handler manda a lista de fontes pro renderer, aguarda escolha/cancelamento/timeout, e sempre resolve com `callback(...)`.</done>
</task>

<task type="auto">
  <name>Task 2: ScreenSharePicker.tsx — diálogo de miniaturas</name>
  <files>src/renderer/src/components/shell/ScreenSharePicker.tsx, src/renderer/src/state/voice-context.tsx</files>
  <action>
    Criar `ScreenSharePicker.tsx`: componente que usa `Dialog` do shadcn
    (mesmo padrão de diálogo já usado em outras partes do shell — reutilizar
    o componente `ui/dialog` existente, não criar um novo). Estado interno:
    `sources: ScreenShareSource[] | null` (null = fechado). Efeito que
    registra `window.screenshare.onPickRequested(({ sources }) => setSources(sources))`
    no mount (cleanup no unmount, mesmo padrão de `onAuthChange` em
    `useAuth`).

    Quando `sources !== null`, o diálogo abre mostrando:
    - Seção "Telas" (fontes com `isScreen: true`) e seção "Janelas"
      (`isScreen: false`), cada uma um grid de cards com
      `<img src={thumbnailDataUrl} />` + `name` abaixo (truncar nomes
      longos de janela com `truncate`, mesmo padrão de outros textos no
      shell).
    - Clique num card: `window.screenshare.chooseSource(source.id)`, fecha o
      diálogo (`setSources(null)`).
    - Botão "Cancelar" (ou fechar o diálogo pelo X/Esc, tratando
      `onOpenChange(false)` do `Dialog` do shadcn da mesma forma):
      `window.screenshare.cancelPicker()`, fecha o diálogo. **Todo caminho
      de fechar o diálogo sem escolher precisa chamar `cancelPicker()`** —
      não só o botão explícito, também Esc e clique fora, se o `Dialog` do
      shadcn expuser esses caminhos via `onOpenChange` (verificar o
      componente já instalado; se não expuser, pelo menos o botão
      "Cancelar" cobre o caso principal e documentar a lacuna no SUMMARY).

    Montar `<ScreenSharePicker />` uma vez, dentro do `VoiceProvider` (ou
    logo abaixo dele em `AppShell.tsx`, onde fizer mais sentido sem criar
    import circular) — só precisa existir uma instância por app, não por
    canal.
  </action>
  <verify>`npm run typecheck` passa. `grep -rn "sources\[0\]" src/main/screenshare.ts` não retorna nada — confirma que a Task 1 removeu a escolha automática.</verify>
  <done>Diálogo de miniaturas existe, monta uma vez no app, e todo caminho de fechá-lo (escolher ou cancelar) chama o canal de IPC correspondente.</done>
</task>

</tasks>

<verification>
- Handler do processo main nunca chama `callback` mais de uma vez nem zero
  vezes, incluindo o caminho de timeout.
- `ScreenSharePicker.tsx` chama `cancelPicker()` em todo caminho de fechar
  sem escolher que o `Dialog` do shadcn expõe.
- Nenhuma referência a `sources[0]` (escolha automática) restante em
  `src/main/screenshare.ts`.
</verification>

<success_criteria>
SHARE-01 está completo (miniaturas reais de telas e janelas, escolha
explícita do usuário) e a base de SHARE-07 (cancelamento não trava) está
implementada — a prova formal com múltiplas tentativas reais de
cancelamento fica para o checkpoint final (Plano 08-07).
</success_criteria>

<output>
After completion, create `.planning/phases/08-compartilhamento-de-tela/08-04-SUMMARY.md`
</output>
