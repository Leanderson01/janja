import { ElectronAPI } from '@electron-toolkit/preload'
import type { AuthUser } from '../main/auth/types'
import type {
  ScreenShareChoice as SharedScreenShareChoice,
  ScreenSharePickRequest as SharedScreenSharePickRequest,
  ScreenShareSource as SharedScreenShareSource
} from '../main/screenshare-types'
import type {
  ScreenShareAudioFormat as SharedScreenShareAudioFormat,
  ScreenShareAudioStartResult as SharedScreenShareAudioStartResult,
  ScreenShareAudioStatus as SharedScreenShareAudioStatus,
  ScreenShareAudioUnavailableReason as SharedScreenShareAudioUnavailableReason
} from '../main/screenshare-audio-types'

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

/**
 * Áudio do compartilhamento por processo (Fase 8.6). Subobjeto de
 * `ScreenShareApi`, não uma superfície global nova — é a mesma feature.
 */
interface ScreenShareAudioApi {
  /** Resolve SEMPRE; `{ ok: false, reason }` é resultado, não exceção. */
  start(): Promise<ScreenShareAudioStartResult>
  /** Uma via, idempotente do lado do main. */
  stop(): void
  /**
   * Canal de maior volume do app (~100 msg/s). O retorno é o cleanup, e
   * chamá-lo é requisito, não higiene — ver o comentário em src/preload/index.ts.
   */
  onChunk(callback: (chunk: Uint8Array) => void): () => void
  onStatus(callback: (status: ScreenShareAudioStatus) => void): () => void
}

interface ScreenShareApi {
  /** main -> renderer: abre o seletor com estas fontes. Devolve o cleanup. */
  onPickRequested(callback: (data: ScreenSharePickRequest) => void): () => void
  chooseSource(choice: ScreenShareChoice): void
  cancelPicker(): void
  audio: ScreenShareAudioApi
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
  // Idem para o contrato de áudio de `src/main/screenshare-audio-types.ts`.
  // `ScreenShareAudioFormat` viaja no resultado do `start()`: o renderer usa o
  // formato que o main disse que está entregando em vez de duplicar 48000/2/16.
  type ScreenShareAudioFormat = SharedScreenShareAudioFormat
  type ScreenShareAudioStartResult = SharedScreenShareAudioStartResult
  type ScreenShareAudioStatus = SharedScreenShareAudioStatus
  type ScreenShareAudioUnavailableReason = SharedScreenShareAudioUnavailableReason

  interface Window {
    electron: ElectronAPI
    api: unknown
    auth: AuthApi
    voice: VoiceApi
    screenshare: ScreenShareApi
  }
}
