import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AuthUser } from '../main/auth/types'

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

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('auth', authApi)
    contextBridge.exposeInMainWorld('voice', voiceApi)
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
}
