// Hook global de teclado (uiohook-napi) para push-to-talk (Plano 07-06,
// VOICE-11). Só roda no processo main — o `globalShortcut` do Electron não
// separa keydown/keyup, então é a única forma de "segurar para falar"
// funcionar mesmo com o app sem foco (07-RESEARCH.md §5).
//
// Spike de instalação confirmado antes deste arquivo existir: `uiohook-napi`
// 1.5.5 já embute prebuilds N-API por plataforma dentro do próprio pacote
// publicado (`prebuilds/win32-x64/`, `prebuilds/linux-x64/`, etc. —
// 09-RESEARCH.md §2), resolvidos em runtime por `node-gyp-build` sem
// depender de qual SO rodou `npm install`. Testado localmente rodando o
// módulo dentro do processo main real do Electron (não só Node puro): carga
// bem-sucedida, sem `MODULE_NOT_FOUND`/erro de ABI, sem precisar de
// `@electron/rebuild`.
//
// O QUE ESTE HOOK OBSERVA: um hook global de teclado recebe, por natureza,
// todo evento de tecla do sistema operacional inteiro — não tem como o SO
// filtrar isso antes de entregar o evento. O código abaixo, porém, só
// inspeciona o campo `keycode` de cada evento e descarta imediatamente
// qualquer tecla que não seja a fixa de push-to-talk (Right Control,
// 07-RESEARCH.md §7); nenhuma outra tecla é lida, armazenada ou logada em
// lugar nenhum, e nenhum handler aqui loga o conteúdo de uma tecla
// pressionada, nem mesmo a própria tecla de PTT.
//
// QUANDO ESTÁ RODANDO: os listeners `keydown`/`keyup` são registrados uma
// única vez (`startPttHook`, chamado em `app.whenReady()`), mas a captura
// nativa de fato (`uIOhook.start()`) só liga quando o renderer informa que o
// modo de voz salvo é 'ptt' (`setPttModeActive(true)`, acionado a partir de
// `voice-context.tsx` no mount do provider e sempre que a preferência é
// reaplicada). Em modo 'vad' — o padrão — ou antes do renderer sequer
// carregar a preferência salva, a captura nativa nunca chega a iniciar: não
// existe hook de teclado rodando à toa quando push-to-talk não é o modo
// ativo.
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import { VOICE_CHANNELS } from './types'

// Tecla fixa de push-to-talk nesta versão — não configurável em v1, nenhum
// requisito (VOICE-09..VOICE-12) pede remapeamento (07-RESEARCH.md §7).
const PTT_KEYCODE: number = UiohookKey.CtrlRight

let isCaptureActive = false
// Filtra o auto-repeat de `keydown` que o SO gera enquanto uma tecla
// continua pressionada — sem isto o IPC dispararia o canal PTT_KEY_DOWN
// dezenas de vezes por segundo à toa enquanto a tecla fica presa.
let isKeyCurrentlyDown = false
let sendToRenderer: ((channel: string) => void) | null = null

function handleKeyDown(event: UiohookKeyboardEvent): void {
  if (event.keycode !== PTT_KEYCODE) return
  if (isKeyCurrentlyDown) return
  isKeyCurrentlyDown = true
  sendToRenderer?.(VOICE_CHANNELS.PTT_KEY_DOWN)
}

function handleKeyUp(event: UiohookKeyboardEvent): void {
  if (event.keycode !== PTT_KEYCODE) return
  isKeyCurrentlyDown = false
  sendToRenderer?.(VOICE_CHANNELS.PTT_KEY_UP)
}

/**
 * Registra os listeners do hook global — chamado uma única vez, dentro de
 * `app.whenReady()`. NÃO inicia a captura nativa por conta própria (ver
 * `setPttModeActive`): sem uma chamada explícita informando que o modo é
 * 'ptt', `uIOhook.start()` nunca é chamado.
 */
export function startPttHook(sender: (channel: string) => void): void {
  sendToRenderer = sender
  uIOhook.on('keydown', handleKeyDown)
  uIOhook.on('keyup', handleKeyUp)
}

/**
 * Liga/desliga a captura nativa de teclado conforme o modo de voz ativo no
 * renderer (`voice-preferences.ts`, lido só no renderer — o processo main
 * nunca persiste essa preferência, só reage ao que chega por IPC).
 * Idempotente: chamar com o mesmo valor repetido é um no-op.
 */
export function setPttModeActive(active: boolean): void {
  if (active === isCaptureActive) return
  isCaptureActive = active
  // Nunca herdar o estado de "tecla pressionada" de uma janela de captura
  // anterior — evita um KEY_UP fantasma se a captura for desligada no meio
  // de um keydown sustentado.
  isKeyCurrentlyDown = false
  if (active) {
    uIOhook.start()
  } else {
    uIOhook.stop()
  }
}

/**
 * Para tudo — captura nativa (se ligada) e os próprios listeners. Chamado
 * no handler de `before-quit`: nunca deixar o hook nativo vivo depois que o
 * processo Electron começa a encerrar.
 */
export function stopPttHook(): void {
  if (isCaptureActive) {
    uIOhook.stop()
    isCaptureActive = false
  }
  uIOhook.removeListener('keydown', handleKeyDown)
  uIOhook.removeListener('keyup', handleKeyUp)
  sendToRenderer = null
}
