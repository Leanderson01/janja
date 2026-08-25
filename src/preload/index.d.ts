import { ElectronAPI } from '@electron-toolkit/preload'
import type { AuthUser } from '../main/auth/types'
import type {
  ScreenShareChoice as SharedScreenShareChoice,
  ScreenSharePickRequest as SharedScreenSharePickRequest,
  ScreenShareSource as SharedScreenShareSource
} from '../main/screenshare-types'

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

interface ScreenShareApi {
  /** main -> renderer: abre o seletor com estas fontes. Devolve o cleanup. */
  onPickRequested(callback: (data: ScreenSharePickRequest) => void): () => void
  chooseSource(choice: ScreenShareChoice): void
  cancelPicker(): void
}

declare global {
  // Alias global do tipo definido em `src/main/screenshare-types.ts`: o
  // renderer não importa de `src/main` (processo e tsconfig separados — ver o
  // comentário de `AuthUser` em `src/renderer/src/hooks/useAuth.ts`), mas este
  // arquivo `.d.ts` está no `include` das duas configs, então a definição
  // atravessa a fronteira sem virar uma segunda cópia para sair de sincronia.
  type ScreenShareSource = SharedScreenShareSource
  type ScreenSharePickRequest = SharedScreenSharePickRequest
  type ScreenShareChoice = SharedScreenShareChoice

  interface Window {
    electron: ElectronAPI
    api: unknown
    auth: AuthApi
    voice: VoiceApi
    screenshare: ScreenShareApi
  }
}
