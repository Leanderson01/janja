---
phase: 02-convex-auth-workos
plan: 03
type: execute
wave: 3
depends_on: ["02-02"]
files_modified:
  - src/main/auth/deep-link-handler.ts
  - src/main/auth/ipc-handlers.ts
  - src/main/index.ts
  - src/preload/index.ts
  - src/preload/index.d.ts
autonomous: true

must_haves:
  truths:
    - "Usuário pede login, o navegador do sistema abre (nunca uma BrowserWindow), e o retorno via janja://callback chega ao app através do evento second-instance existente"
    - "O renderer tem uma API mínima (window.auth) para pedir login, logout, o usuário atual e um access token fresco"
  artifacts:
    - path: "src/main/auth/deep-link-handler.ts"
      provides: "Registro do protocolo janja:// (dev vs empacotado) e parsing da URL de callback a partir do argv do second-instance"
      contains: "setAsDefaultProtocolClient"
    - path: "src/main/index.ts"
      provides: "Wiring do registerProtocol, dos handlers de IPC e da extração da URL no handler second-instance já existente do bootstrap (F0)"
      contains: "second-instance"
    - path: "src/preload/index.d.ts"
      provides: "Tipos de window.auth para o renderer"
      contains: "AuthApi"
  key_links:
    - from: "src/main/index.ts (second-instance)"
      to: "src/main/auth/deep-link-handler.ts"
      via: "argv.find(arg => arg.startsWith('janja://'))"
      pattern: "janja://"
    - from: "src/preload/index.ts"
      to: "src/main/auth/ipc-handlers.ts"
      via: "ipcRenderer.invoke('auth:*')"
      pattern: "auth:(sign-in|sign-out|get-user|get-access-token)"
---

<objective>
Ligar o núcleo de autenticação (plano 02-02) ao mundo exterior: registrar o protocolo
`janja://`, estender o handler `second-instance` que já existe desde a Fase 0 para extrair a
URL de callback do OAuth, expor os canais de IPC que o renderer vai chamar, e expor essa API
no preload como `window.auth`.

Purpose: É o "fio" que faz AUTH-01 funcionar de ponta a ponta no Windows — sem estender o
`second-instance` existente, o código de autorização do WorkOS chega ao SO mas nunca ao app
(cai numa segunda instância que só foca a janela e descarta o argv).
Output: `janja://` registrado como protocolo, `second-instance` estendido, 4 canais de IPC
funcionando, `window.auth` tipado disponível no renderer.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/02-convex-auth-workos/02-RESEARCH.md
@src/main/index.ts
@src/preload/index.ts

# src/main/index.ts já tem, desde F0: requestSingleInstanceLock() antes de qualquer janela,
# e um handler `app.on('second-instance', ...)` que hoje só restaura/foca a janela. Este
# plano ESTENDE esse handler para também extrair a URL `janja://` do argv — não recriar o
# handler do zero, não remover a lógica de foco já existente.
#
# ATENÇÃO A CONFLITO DE ARQUIVO: a Fase 3 (paralela a esta) tem um plano (03-05) que também
# edita src/main/index.ts, adicionando `minWidth`/`minHeight` à BrowserWindow. Ao executar
# este plano, ler o estado ATUAL do arquivo antes de editar (pode já conter essas duas
# chaves, adicionadas em paralelo) e integrar por cima sem apagar nada que já esteja lá —
# a mesma disciplina que 03-05 usa em relação ao que a F0 já deixou.
#
# 02-RESEARCH.md §1 e §6 trazem o código real do exemplo oficial da WorkOS para
# app.setAsDefaultProtocolClient (dev vs empacotado) e o parsing via second-instance —
# seguir esse padrão, adaptado para o protocolo `janja` em vez de `workos-auth`.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Registro do protocolo janja:// e parsing do callback</name>
  <files>src/main/auth/deep-link-handler.ts</files>
  <action>
    Criar `src/main/auth/deep-link-handler.ts`:
    ```ts
    import path from 'path'

    const PROTOCOL = 'janja'

    /** Chamar antes de app.whenReady() resolver, uma única vez. */
    export function registerProtocol(): void {
      if (process.defaultApp && process.argv.length >= 2) {
        // electron-vite dev: o executável é o binário genérico do Electron, não um .exe
        // empacotado — sem passar execPath + o caminho do script, o registro no Windows
        // aponta para "electron.exe" sem saber qual projeto abrir.
        globalThis.app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
          path.resolve(process.argv[1]),
        ])
      } else {
        globalThis.app.setAsDefaultProtocolClient(PROTOCOL)
      }
    }

    export function extractCallbackUrl(argv: string[]): string | null {
      return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`)) ?? null
    }

    export function parseCallbackParams(url: string): { code: string | null; state: string | null; error: string | null } {
      const params = new URL(url).searchParams
      return {
        code: params.get('code'),
        state: params.get('state'),
        error: params.get('error'),
      }
    }
    ```
    Ajustar para importar `app` de `'electron'` diretamente em vez de `globalThis.app` (o
    pseudocódigo acima usa `globalThis.app` só para deixar explícito que é a mesma instância
    global do módulo `app` do Electron — na implementação real, `import { app } from
    'electron'` no topo do arquivo e usar `app.setAsDefaultProtocolClient(...)` normalmente).

    Não implementar `open-url` (macOS) como caminho funcional — o alvo é Windows
    exclusivamente (PROJECT.md). Se quiser deixar o listener por paridade com o exemplo
    oficial, comentar explicitamente que é inerte no Windows; não gastar tempo testando esse
    caminho.
  </action>
  <verify>`deep-link-handler.ts` exporta `registerProtocol`, `extractCallbackUrl`, `parseCallbackParams`; `npm run typecheck:node` passa.</verify>
  <done>Funções puras de registro de protocolo e parsing de URL, testáveis por leitura, sem nenhuma dependência de estado de janela ainda.</done>
</task>

<task type="auto">
  <name>Task 2: IPC, wiring em index.ts e exposição via preload</name>
  <files>src/main/auth/ipc-handlers.ts, src/main/index.ts, src/preload/index.ts, src/preload/index.d.ts</files>
  <action>
    Criar `src/main/auth/ipc-handlers.ts`:
    ```ts
    import { ipcMain, shell, BrowserWindow } from 'electron'
    import { AUTH_CHANNELS, type AuthIpcResult, type AuthUser } from './types'
    import { getSignInUrl, getUser, getAccessToken, clearSession, getLogoutUrl } from './auth'

    export function setupAuthIpcHandlers(mainWindow: BrowserWindow): void {
      ipcMain.handle(AUTH_CHANNELS.SIGN_IN, async (): Promise<AuthIpcResult> => {
        try {
          const url = await getSignInUrl()
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
        },
      )
    }

    export function notifyAuthChange(mainWindow: BrowserWindow, user: AuthUser | null): void {
      mainWindow.webContents.send(AUTH_CHANNELS.ON_AUTH_CHANGE, { user })
    }
    ```

    Em `src/main/index.ts`, integrar (sem remover nada existente de F0/F3):
    1. Importar `registerProtocol`, `extractCallbackUrl`, `parseCallbackParams` de
       `./auth/deep-link-handler`, `handleCallback` e `getUser` de `./auth/auth`,
       `setupAuthIpcHandlers`, `notifyAuthChange` de `./auth/ipc-handlers`.
    2. Chamar `registerProtocol()` logo depois de `app.requestSingleInstanceLock()` ter sido
       concedido (antes de `app.whenReady()`), no branch onde a instância é a principal.
    3. Dentro do handler `second-instance` já existente, ANTES ou DEPOIS do foco da janela
       (ordem não importa, mas não remover o foco): extrair a URL com
       `extractCallbackUrl(argv)` — o segundo parâmetro do listener já recebe `argv`, ajustar
       a assinatura do handler existente de `() => {...}` para `(_event, argv) => {...}` sem
       alterar o corpo que já faz foco/restore. Se a URL existir, `parseCallbackParams` e, se
       houver `code`+`state`, chamar `handleCallback(code, state)` e, em caso de sucesso,
       `notifyAuthChange(mainWindow, user)`; em caso de erro (`state` inválido, expirado,
       ou `error` presente na query string), apenas logar no console — não travar o app.
    4. Dentro de `app.whenReady().then(...)`, depois que `mainWindow` existe, chamar
       `setupAuthIpcHandlers(mainWindow)`.
    5. Ainda em `whenReady`, tentar obter a sessão já existente (`await getUser()`) e, se
       houver usuário, chamar `notifyAuthChange(mainWindow, user)` depois que o
       `webContents` disparar `did-finish-load` — replica o comportamento do exemplo oficial
       de restaurar sessão ao abrir o app sem esperar um novo login.

    Em `src/preload/index.ts`, adicionar ao objeto exposto (mantendo o `api = {}` existente
    e o `electronAPI` já expostos por F0):
    ```ts
    import { ipcRenderer } from 'electron'
    // ...
    const AUTH_CHANNELS = {
      SIGN_IN: 'auth:sign-in',
      SIGN_OUT: 'auth:sign-out',
      GET_USER: 'auth:get-user',
      GET_ACCESS_TOKEN: 'auth:get-access-token',
      ON_AUTH_CHANGE: 'auth:on-auth-change',
    } as const

    const authApi = {
      signIn: () => ipcRenderer.invoke(AUTH_CHANNELS.SIGN_IN),
      signOut: () => ipcRenderer.invoke(AUTH_CHANNELS.SIGN_OUT),
      getUser: () => ipcRenderer.invoke(AUTH_CHANNELS.GET_USER),
      getAccessToken: (args: { forceRefreshToken: boolean }) =>
        ipcRenderer.invoke(AUTH_CHANNELS.GET_ACCESS_TOKEN, args),
      onAuthChange: (callback: (data: { user: unknown }) => void) => {
        const listener = (_: Electron.IpcRendererEvent, data: { user: unknown }): void => callback(data)
        ipcRenderer.on(AUTH_CHANNELS.ON_AUTH_CHANGE, listener)
        return () => ipcRenderer.removeListener(AUTH_CHANNELS.ON_AUTH_CHANGE, listener)
      },
    }
    ```
    Expor via `contextBridge.exposeInMainWorld('auth', authApi)` junto com o `electron` e
    `api` já existentes (mesmo bloco `if (process.contextIsolated)`).

    Em `src/preload/index.d.ts` (criar se não existir, ou estender se já existir de F0),
    declarar:
    ```ts
    import type { AuthUser } from '../main/auth/types'

    interface AuthApi {
      signIn(): Promise<{ success: boolean; error?: string }>
      signOut(): Promise<{ success: boolean; error?: string }>
      getUser(): Promise<AuthUser | null>
      getAccessToken(args: { forceRefreshToken: boolean }): Promise<string | null>
      onAuthChange(callback: (data: { user: AuthUser | null }) => void): () => void
    }

    declare global {
      interface Window {
        auth: AuthApi
      }
    }
    ```
  </action>
  <verify>`npm run typecheck` (node + web) passa; `npm run dev` abre o app sem crash; abrir uma segunda instância do app enquanto a primeira está aberta ainda foca a janela existente (comportamento de F0 preservado); grep confirma que `src/main/index.ts` não perdeu `requestSingleInstanceLock`, `contextIsolation`/`nodeIntegration` explícitos, nem (se já presentes) `minWidth`/`minHeight` de F3.</verify>
  <done>window.auth disponível e tipado no renderer; second-instance extrai e processa a URL de callback; nenhuma regressão nas garantias de F0 (instância única) ou nas adições paralelas de F3.</done>
</task>

</tasks>

<verification>
- `npm run typecheck` passa.
- `src/main/index.ts` preserva todo o conteúdo de F0 (single instance lock, contextIsolation/nodeIntegration) e qualquer adição paralela de F3 (minWidth/minHeight, se já presente).
- `window.auth` existe e expõe exatamente `signIn`, `signOut`, `getUser`, `getAccessToken`, `onAuthChange`.
</verification>

<success_criteria>
O caminho completo SO → app está fechado: um retorno real de `janja://callback` (mesmo que
disparado manualmente via segunda instância simulada) chega ao `handleCallback` do plano
02-02 e o renderer é capaz de pedir login/logout/usuário/token via `window.auth`.
</success_criteria>

<output>
After completion, create `.planning/phases/02-convex-auth-workos/02-03-SUMMARY.md`.
</output>
