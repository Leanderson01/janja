// Canais de IPC que expõem o núcleo de autenticação (plano 02-02) ao
// renderer, via preload (contextBridge). Nenhuma lógica de OAuth vive aqui —
// este arquivo só traduz chamadas IPC em chamadas ao módulo ./auth.

import { ipcMain, shell, type BrowserWindow } from 'electron'
import { AUTH_CHANNELS, type AuthIpcResult, type AuthUser } from './types'
import { getSignInUrl, getUser, getAccessToken, clearSession, getLogoutUrl } from './auth'

export function setupAuthIpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(AUTH_CHANNELS.SIGN_IN, async (): Promise<AuthIpcResult> => {
    try {
      const url = await getSignInUrl()
      // Nunca abre uma BrowserWindow para o login — o Google (e a maioria dos
      // provedores OAuth) recusa autenticação embutida (webview). O navegador
      // do sistema é a única superfície suportada.
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(AUTH_CHANNELS.SIGN_OUT, async (): Promise<AuthIpcResult> => {
    try {
      const logoutUrl = getLogoutUrl()
      await clearSession()
      if (logoutUrl) await shell.openExternal(logoutUrl)
      notifyAuthChange(mainWindow, null)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle(AUTH_CHANNELS.GET_USER, async (): Promise<AuthUser | null> => {
    try {
      return await getUser()
    } catch {
      return null
    }
  })

  ipcMain.handle(
    AUTH_CHANNELS.GET_ACCESS_TOKEN,
    async (_event, args: { forceRefreshToken: boolean }): Promise<string | null> => {
      try {
        return await getAccessToken(args?.forceRefreshToken ?? false)
      } catch {
        return null
      }
    }
  )
}

/** Notifica o renderer (window.auth.onAuthChange) sobre uma mudança de sessão
 *  — chamado após um callback de OAuth bem-sucedido, um logout, ou ao
 *  restaurar uma sessão persistida na abertura do app. */
export function notifyAuthChange(mainWindow: BrowserWindow, user: AuthUser | null): void {
  mainWindow.webContents.send(AUTH_CHANNELS.ON_AUTH_CHANGE, { user })
}
