import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AuthUser } from '../main/auth/types'
import { SCREENSHARE_CHANNELS } from '../main/screenshare-types'
import type { ScreenShareChoice, ScreenSharePickRequest } from '../main/screenshare-types'
import { SCREENSHARE_AUDIO_CHANNELS } from '../main/screenshare-audio-types'
import type {
  ScreenShareAudioStartResult,
  ScreenShareAudioStatus
} from '../main/screenshare-audio-types'

// Custom APIs for renderer
const api = {}

// Minimal auth surface exposed to the renderer. Never expose ipcRenderer
// itself — only these specific, already-named channels, matching
// src/main/auth/types.ts (AUTH_CHANNELS) exactly.
const AUTH_CHANNELS = {
  SIGN_IN: 'auth:sign-in',
  SIGN_OUT: 'auth:sign-out',
  GET_USER: 'auth:get-user',
  GET_ACCESS_TOKEN: 'auth:get-access-token',
  ON_AUTH_CHANGE: 'auth:on-auth-change'
} as const

const authApi = {
  signIn: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(AUTH_CHANNELS.SIGN_IN),
  signOut: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(AUTH_CHANNELS.SIGN_OUT),
  getUser: (): Promise<AuthUser | null> => ipcRenderer.invoke(AUTH_CHANNELS.GET_USER),
  getAccessToken: (args: { forceRefreshToken: boolean }): Promise<string | null> =>
    ipcRenderer.invoke(AUTH_CHANNELS.GET_ACCESS_TOKEN, args),
  onAuthChange: (callback: (data: { user: AuthUser | null }) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: { user: AuthUser | null }): void =>
      callback(data)
    ipcRenderer.on(AUTH_CHANNELS.ON_AUTH_CHANGE, listener)
    return () => ipcRenderer.removeListener(AUTH_CHANNELS.ON_AUTH_CHANGE, listener)
  }
}

// Superfície de push-to-talk exposta ao renderer (Plano 07-06, VOICE-11),
// matching src/main/voice/types.ts (VOICE_CHANNELS) exatamente. Nunca expõe
// ipcRenderer bruto — só estes canais já nomeados.
const VOICE_CHANNELS = {
  PTT_KEY_DOWN: 'voice:ptt-key-down',
  PTT_KEY_UP: 'voice:ptt-key-up',
  SET_PTT_MODE_ACTIVE: 'voice:set-ptt-mode-active'
} as const

const voiceApi = {
  onPttKeyDown: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(VOICE_CHANNELS.PTT_KEY_DOWN, listener)
    return () => ipcRenderer.removeListener(VOICE_CHANNELS.PTT_KEY_DOWN, listener)
  },
  onPttKeyUp: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(VOICE_CHANNELS.PTT_KEY_UP, listener)
    return () => ipcRenderer.removeListener(VOICE_CHANNELS.PTT_KEY_UP, listener)
  },
  // Informa o processo main se o modo de voz salvo agora é 'ptt', para ele
  // ligar/desligar a captura nativa do hook global de teclado de acordo —
  // um comando de uma via, sem retorno (ver src/main/voice/ptt.ts).
  setPttModeActive: (active: boolean): void => {
    ipcRenderer.send(VOICE_CHANNELS.SET_PTT_MODE_ACTIVE, active)
  }
}

// Superfície do seletor de tela exposta ao renderer (Plano 08-04, SHARE-01).
// Ao contrário de AUTH_CHANNELS/VOICE_CHANNELS, os nomes dos canais NÃO são
// duplicados aqui: são importados de `src/main/screenshare-types.ts` (arquivo
// sem imports, só constantes e tipos, seguro de bundlar no preload). O motivo
// é o Pitfall 2 — um nome de canal divergente entre os dois lados não gera
// erro, gera um `send` que cai no vazio e uma captura que só destrava no
// timeout de 60s do processo main. Continua valendo a regra que importa:
// nunca expor `ipcRenderer` bruto, só estes três canais já nomeados.
const screenshareApi = {
  /** Registra o diálogo de escolha; devolve a função de remoção do listener. */
  onPickRequested: (callback: (data: ScreenSharePickRequest) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: ScreenSharePickRequest): void =>
      callback(data)
    ipcRenderer.on(SCREENSHARE_CHANNELS.PICK_REQUESTED, listener)
    return () => ipcRenderer.removeListener(SCREENSHARE_CHANNELS.PICK_REQUESTED, listener)
  },
  /**
   * O usuário escolheu esta fonte, com ou sem áudio de sistema. Uma via, sem
   * retorno. `systemAudio` viaja JUNTO com a fonte de propósito: é uma única
   * decisão do usuário, tomada num único clique, e separá-la em dois canais
   * abriria a chance de o main conceder com base num valor de outro pedido.
   */
  chooseSource: (choice: ScreenShareChoice): void => {
    ipcRenderer.send(SCREENSHARE_CHANNELS.CHOOSE_SOURCE, choice)
  },
  /**
   * O usuário fechou o diálogo sem escolher. Precisa ser chamado em TODO
   * caminho de fechamento sem escolha (botão, Esc, clique fora, X) — é o que
   * destrava o `getDisplayMedia()` que o processo main está segurando.
   */
  cancelPicker: (): void => {
    ipcRenderer.send(SCREENSHARE_CHANNELS.CANCEL_PICKER)
  },
  /**
   * Áudio do compartilhamento por PROCESSO (Fase 8.6). Fica como subchave de
   * `screenshare` em vez de um sexto objeto global porque é a MESMA feature: o
   * renderer que pede a tela é o mesmo que pede o som dela, e quem procurar
   * "como ligo o áudio do compartilhamento" vai olhar aqui primeiro.
   *
   * Os nomes de canal vêm de `src/main/screenshare-audio-types.ts` — mesmo
   * motivo já escrito acima para `SCREENSHARE_CHANNELS` (Pitfall 2: nome
   * divergente não gera erro, gera um `send` que cai no vazio).
   */
  audio: {
    /**
     * Pede ao main para começar a captura. **Resolve SEMPRE, nunca rejeita**:
     * "não dá para capturar" é um resultado (`{ ok: false, reason }`), não uma
     * exceção. Quem chama trata `ok: false` como "compartilha sem som, com o
     * motivo na tela" — jamais como falha do compartilhamento.
     */
    start: (): Promise<ScreenShareAudioStartResult> =>
      ipcRenderer.invoke(SCREENSHARE_AUDIO_CHANNELS.START),
    /** Uma via, sem retorno. Idempotente do lado do main. */
    stop: (): void => {
      ipcRenderer.send(SCREENSHARE_AUDIO_CHANNELS.STOP)
    },
    /**
     * main -> renderer: um chunk de PCM cru (s16le, estéreo intercalado, 48k).
     * Devolve a função de remoção do listener, como `onPickRequested`.
     *
     * ATENÇÃO — este é o canal de MAIOR VOLUME do app: ~100 mensagens/s,
     * ~192 KB/s, ~1,9 KB por mensagem. Um listener vazado aqui não é
     * vazamento cosmético: é trabalho acumulado POR SEGUNDO, em cima do
     * thread principal do renderer, para o resto da vida da janela. Chamar o
     * cleanup em TODO caminho de saída não é higiene, é requisito.
     *
     * E não existe fluxo contínuo: o addon descarta buffers silenciosos
     * (-70 dBFS), então "parou de chegar chunk" é o som normal do silêncio,
     * não sinal de falha. Ver SILENCE_WATCHDOG_MS.
     */
    onChunk: (callback: (chunk: Uint8Array) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, chunk: Uint8Array): void => callback(chunk)
      ipcRenderer.on(SCREENSHARE_AUDIO_CHANNELS.CHUNK, listener)
      return () => ipcRenderer.removeListener(SCREENSHARE_AUDIO_CHANNELS.CHUNK, listener)
    },
    /** main -> renderer: capturando / não chegou áudio / parou / falhou. */
    onStatus: (callback: (status: ScreenShareAudioStatus) => void): (() => void) => {
      const listener = (_: Electron.IpcRendererEvent, status: ScreenShareAudioStatus): void =>
        callback(status)
      ipcRenderer.on(SCREENSHARE_AUDIO_CHANNELS.STATUS, listener)
      return () => ipcRenderer.removeListener(SCREENSHARE_AUDIO_CHANNELS.STATUS, listener)
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('auth', authApi)
    contextBridge.exposeInMainWorld('voice', voiceApi)
    contextBridge.exposeInMainWorld('screenshare', screenshareApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.auth = authApi
  // @ts-ignore (define in dts)
  window.voice = voiceApi
  // @ts-ignore (define in dts)
  window.screenshare = screenshareApi
}
