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

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('auth', authApi)
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
}
