import { ElectronAPI } from '@electron-toolkit/preload'
import type { AuthUser } from '../main/auth/types'

interface AuthApi {
  signIn(): Promise<{ success: boolean; error?: string }>
  signOut(): Promise<{ success: boolean; error?: string }>
  getUser(): Promise<AuthUser | null>
  getAccessToken(args: { forceRefreshToken: boolean }): Promise<string | null>
  onAuthChange(callback: (data: { user: AuthUser | null }) => void): () => void
}

interface VoiceApi {
  onPttKeyDown(callback: () => void): () => void
  onPttKeyUp(callback: () => void): () => void
  setPttModeActive(active: boolean): void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    auth: AuthApi
    voice: VoiceApi
  }
}
