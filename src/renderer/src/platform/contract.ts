/**
 * O contrato de plataforma: os tipos onde "o que existe só no Electron" e "o
 * que existe só no navegador" se encontram.
 *
 * A REGRA QUE SUSTENTA A FASE INTEIRA: nenhum `if (isElectron)` em código de
 * feature. Quem escolhe a implementação é o BUNDLER, através do alias
 * `@platform` — que resolve para `platform/electron` em
 * `electron.vite.config.ts` e para `platform/web` em `vite.config.web.ts`.
 * A consequência é o ponto: o que não existe no alvo não entra no grafo de
 * módulos. O bundle da web nunca vê `window.screenshare`, `window.voice` nem o
 * worklet de PCM — não porque um `if` os pulou em runtime, mas porque o
 * Rollup nunca chegou perto deles. E é isso que
 * `scripts/verify-web-bundle.mjs` afirma sobre o artefato compilado.
 *
 * IMPORTAR ESTE ARQUIVO SEMPRE POR `@/platform/contract`, NUNCA POR
 * `@platform/contract`. `@platform` é o alias que TROCA de alvo; o contrato é
 * o mesmo arquivo nos dois lados, e importá-lo pelo alias que muda seria
 * pedir para as duas implementações divergirem de contrato sem ninguém notar.
 *
 * Os tipos abaixo foram DERIVADOS dos arquivos que hoje falam com a ponte do
 * Electron (`src/preload/index.ts`, `hooks/useAuth.ts`,
 * `hooks/useConvexAuthAdapter.ts`, `lib/profile-hint.ts`,
 * `state/voice-context.tsx`, `features/auth/*`), não inventados. As
 * implementações de `PlatformAuth`, `PlatformPushToTalk` e
 * `PlatformScreenShare` chegam nos Planos 10-02 e 10-03 — os tipos são
 * escritos ANTES de propósito: é escrevê-los antes que os faz funcionar como
 * contrato em vez de descrição.
 */
import type { ReactNode, ComponentType } from 'react'
import type { Room, ScreenShareCaptureOptions } from 'livekit-client'

/**
 * Perfil da pessoa logada.
 *
 * Deliberadamente igual ao `AuthUserLike` de `lib/profile-hint.ts` — que por
 * sua vez é igual ao `User` do `authkit-js`
 * (`interfaces/user.interface.ts`: `email`, `firstName`, `lastName`,
 * `profilePictureUrl`). É exatamente por essa coincidência medida que
 * `profile-hint.ts` NÃO precisa mudar nesta fase.
 */
export type SessionUser = {
  email: string
  firstName: string | null
  lastName: string | null
  profilePictureUrl: string | null
}

/**
 * O que este alvo sabe fazer. Fonte ÚNICA de verdade para os textos de
 * "paridade declarada" na interface — nunca uma string duplicada por tela.
 */
export type PlatformCapabilities = {
  /** Qual implementação entrou no bundle. Diagnóstico + sentinela. */
  target: 'electron' | 'web'
  /**
   * String literal única, existente SÓ para `scripts/verify-web-bundle.mjs`.
   * É a única prova à prova de minificação de qual lado da costura entrou no
   * artefato: nomes de função e de arquivo somem no minificador, literais de
   * string sobrevivem. Não usar para lógica.
   */
  buildTargetSentinel: string
  /** PTT funciona com o app SEM foco (uiohook). Web: false. */
  globalPushToTalk: boolean
  /** O app desenha o próprio seletor de fonte. Web: false (o Chrome desenha). */
  ownScreenSourcePicker: boolean
  /** De onde vem o som do compartilhamento. */
  screenShareAudio: 'process-exclude' | 'browser-surface' | 'none'
  /** Instância única, deep link, bandeja, atualização automática. Web: false. */
  desktopIntegration: boolean
}

/**
 * A costura de autenticação. Implementação Electron: IPC para o processo main
 * (que já faz PKCE, refresh e `safeStorage`). Implementação web:
 * `@workos-inc/authkit-react` com `devMode`, que faz as mesmas coisas dentro
 * do navegador. O `convex/auth.config.ts` não muda uma linha nos dois casos —
 * o JWT é o mesmo access token da WorkOS, mesmo issuer, mesmo JWKS.
 */
export type PlatformAuth = {
  /**
   * No Electron é um passa-adiante (`<>{children}</>`): não existe provider de
   * auth, quem guarda a sessão é o processo main. Na web é o
   * `<AuthKitProvider devMode>`. Existir nos dois lados é o que permite
   * `main.tsx` montá-lo incondicionalmente.
   */
  AuthProvider: ComponentType<{ children: ReactNode }>
  /** O que a UI de login/perfil consome. */
  useSession(): { user: SessionUser | null; loading: boolean; error: string | null }
  /**
   * Formato EXIGIDO por `ConvexProviderWithAuth` (verificado em
   * `node_modules/convex/dist/esm-types/react/ConvexAuthState.d.ts`).
   */
  useConvexAuthAdapter(): {
    isLoading: boolean
    isAuthenticated: boolean
    /**
     * `forceRefreshToken` é OBRIGATÓRIO no tipo, e o motivo precisa estar
     * escrito aqui para ninguém "simplificar" depois:
     *
     * o `ConvexProviderWithAuth` chama `fetchAccessToken({ forceRefreshToken:
     * true })` quando o backend recusa o token. Essa é exatamente a alavanca
     * que o `AuthWatchdog` existe para puxar (Pitfall 4,
     * `get-convex/convex-backend#259`). Foi por descartá-la que o
     * `@convex-dev/workos` foi REJEITADO na pesquisa desta fase: o wrapper
     * chama `getAccessToken()` sem argumento nenhum, jogando fora o
     * `forceRefresh` que o `authkit-js` aceita e que o Electron já implementa
     * (`window.auth.getAccessToken({ forceRefreshToken })`).
     *
     * Nunca lança: falha vira `null`, que o Convex lê como "sem token".
     */
    fetchAccessToken(args: { forceRefreshToken: boolean }): Promise<string | null>
  }
  /** Electron: IPC + `shell.openExternal`. Web: navegação de topo. */
  signIn(): Promise<void>
  signOut(): Promise<void>
  /**
   * Perfil para a dica do `ensureUser` (ver `lib/profile-hint.ts`).
   * **Nunca lança** — "não deu para saber" é `null`, não exceção: uma rejeição
   * aqui deixa o `AuthGate` numa tela "Carregando…" eterna.
   */
  getProfile(): Promise<SessionUser | null>
  /** O watchdog pergunta isto ANTES de tomar qualquer medida drástica. */
  hasLiveSession(): Promise<boolean>
}

/**
 * Push-to-talk. Electron: `uiohook-napi` no processo main, funciona com o app
 * sem foco. Web: `keydown`/`keyup` na `window`, só com a janela em foco — e a
 * degradação precisa estar DITA na interface (`capabilities.globalPushToTalk`).
 */
export type PlatformPushToTalk = {
  /** Registra os dois handlers; devolve o cleanup. */
  subscribe(h: { onDown(): void; onUp(): void }): () => void
  /**
   * Electron: liga/desliga a captura nativa do hook global de teclado.
   * Web: além de habilitar os listeners, é onde mora a obrigação de forçar
   * `onUp()` em `blur` e `visibilitychange` — sem isso, Alt+Tab com a tecla
   * presa deixa o microfone aberto para sempre.
   */
  setActive(active: boolean): void
}

/** Dica de conteúdo do encoder; vem dos `QUALITY_PRESETS` de `voice-context`. */
export type ContentHint = NonNullable<ScreenShareCaptureOptions['contentHint']>

/**
 * Compartilhamento de tela. A diferença entre os alvos não é cosmética: no
 * Electron o áudio é um SEGUNDO passo (WASAPI por processo, Fase 8.6), na web
 * ele vem no mesmo `getDisplayMedia` e o LiveKit publica sozinho.
 */
export type PlatformScreenShare = {
  /** Opções que vão para `room.localParticipant.setScreenShareEnabled`. */
  captureOptions(hint: ContentHint, wantsAudio: boolean): ScreenShareCaptureOptions
  /**
   * Electron: o 2º passo — inicia a captura por processo no main e monta a
   * ponte de PCM.
   * Web: **NÃO é um no-op vazio.** É a LEITURA DE VOLTA do que o Chrome
   * concedeu — `track.getSettings().restrictOwnAudio` é a única prova de que o
   * pedido de excluir o próprio áudio foi atendido (a spec permite ao agente
   * ignorá-lo, ou excluir todo o áudio da aba, sem avisar). Ver Plano 10-06.
   */
  startAudio(room: Room): Promise<void>
  stopAudio(): Promise<void>
  /**
   * Componentes que só existem num alvo. Electron: monta o
   * `<ScreenSharePicker />` (326 linhas, 23 testes). Web: `() => null` — quem
   * desenha o seletor é o Chrome.
   */
  Extras: ComponentType
}
