---
phase: 02-convex-auth-workos
plan: 02
type: execute
wave: 2
depends_on: ["02-01"]
files_modified:
  - package.json
  - src/main/auth/types.ts
  - src/main/auth/session-store.ts
  - src/main/auth/auth.ts
autonomous: true

must_haves:
  truths:
    - "O processo main sabe gerar uma URL de login PKCE válida para o WorkOS, sem precisar de nenhuma API key"
    - "O processo main sabe trocar um código de autorização por tokens, guardar a sessão de forma criptografada, e recuperar/renovar o access token depois"
    - "Se a credencial salva estiver corrompida ou ilegível, a leitura nunca lança uma exceção não tratada — sempre retorna 'sem sessão'"
  artifacts:
    - path: "src/main/auth/session-store.ts"
      provides: "Persistência da sessão via safeStorage assíncrono (encryptStringAsync/decryptStringAsync), nunca localStorage, sempre com try/catch"
      contains: "encryptStringAsync"
    - path: "src/main/auth/auth.ts"
      provides: "getSignInUrl, handleCallback, getUser, getAccessToken, clearSession, getLogoutUrl usando createWorkOS({ clientId }) sem apiKey"
      contains: "getAuthorizationUrlWithPKCE"
  key_links:
    - from: "src/main/auth/auth.ts"
      to: "src/main/auth/session-store.ts"
      via: "chamadas diretas de função (mesmo processo, sem IPC)"
      pattern: "sessionStore\\.(read|write|clear)"
---

<objective>
Construir o núcleo de autenticação do processo main: geração da URL de login PKCE, troca do
código de autorização por tokens, persistência da sessão via `safeStorage` assíncrono, e
renovação do access token via refresh token. Este plano não toca em IPC, protocolo
customizado ou UI — é só a lógica de auth "pura" do lado do main, testável por leitura de
código antes de qualquer wiring.

Purpose: É a peça que resolve diretamente AUTH-01 (login), AUTH-02 (persistência entre
reinícios), AUTH-03 (falha de leitura cai no login, nunca crash) e a metade "main process" de
AUTH-04/AUTH-05 (renovação de token / logout). Sem isso, não há nada para o IPC do próximo
plano (02-03) chamar.
Output: `src/main/auth/types.ts`, `src/main/auth/session-store.ts`, `src/main/auth/auth.ts`,
dependência `@workos-inc/node` instalada.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/research/PITFALLS.md
@.planning/phases/02-convex-auth-workos/02-RESEARCH.md

# 02-RESEARCH.md §2 traz a API exata confirmada nos tipos publicados de @workos-inc/node
# (createWorkOS, PublicWorkOS, getAuthorizationUrlWithPKCE, authenticateWithCodeAndVerifier,
# authenticateWithRefreshToken, getLogoutUrl) — seguir literalmente, não inventar variação.
# 02-RESEARCH.md §3 traz a API exata do safeStorage assíncrono (Electron docs oficiais).
# Pitfall 7 do PITFALLS.md (safeStorage irrecuperável) e Pitfall 4 (Convex trava em
# isAuthenticated:false) são o motivo de todo o cuidado de try/catch e do design de
# getAccessToken com forceRefreshToken abaixo.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Tipos compartilhados e persistência de sessão via safeStorage assíncrono</name>
  <files>src/main/auth/types.ts, src/main/auth/session-store.ts</files>
  <action>
    Adicionar ao `package.json` a dependência `@workos-inc/node` (`^10.10.0` — a versão
    estável mais recente no npm, não a release candidate usada pelo exemplo oficial da WorkOS;
    a API pública relevante é idêntica nas duas, confirmado em 02-RESEARCH.md §2). Rodar
    `npm install`.

    Criar `src/main/auth/types.ts`:
    ```ts
    export const AUTH_CHANNELS = {
      SIGN_IN: 'auth:sign-in',
      SIGN_OUT: 'auth:sign-out',
      GET_USER: 'auth:get-user',
      GET_ACCESS_TOKEN: 'auth:get-access-token',
      ON_AUTH_CHANGE: 'auth:on-auth-change',
    } as const

    export interface AuthUser {
      workosId: string
      email: string
      firstName: string | null
      lastName: string | null
      profilePictureUrl: string | null
    }

    export interface AuthIpcResult {
      success: boolean
      error?: string
    }
    ```
    (`GET_ACCESS_TOKEN` é um canal que o exemplo oficial da WorkOS não tem — o exemplo só
    expõe o objeto `User`. O janja precisa que o main devolva o JWT puro para o
    `ConvexProviderWithAuth` do renderer usar, ver plano 02-07.)

    Criar `src/main/auth/session-store.ts` — persistência manual via `safeStorage`
    assíncrono, NUNCA `electron-store` e NUNCA a API síncrona do `safeStorage` (diverge de
    propósito do exemplo oficial da WorkOS, que usa `electron-store`; aqui é exigência
    explícita desta fase):
    ```ts
    import { safeStorage, app } from 'electron'
    import { promises as fs } from 'fs'
    import path from 'path'

    interface StoredSession {
      refreshToken: string
      workosId: string
    }

    function sessionFilePath(): string {
      return path.join(app.getPath('userData'), 'auth-session.enc')
    }

    export async function writeSession(session: StoredSession): Promise<void> {
      const plainText = JSON.stringify(session)
      const encrypted = await safeStorage.encryptStringAsync(plainText)
      await fs.writeFile(sessionFilePath(), encrypted.toString('base64'), 'utf-8')
    }

    export async function readSession(): Promise<StoredSession | null> {
      try {
        const raw = await fs.readFile(sessionFilePath(), 'utf-8')
        const encrypted = Buffer.from(raw, 'base64')
        const { result } = await safeStorage.decryptStringAsync(encrypted)
        return JSON.parse(result) as StoredSession
      } catch {
        // Arquivo ausente, base64 inválido, decrypt falhando (DPAPI amarrado a outra
        // credencial de login do Windows, ou máquina/instalação diferente — Pitfall 7),
        // ou JSON corrompido: em todos os casos, tratar como "sem sessão", nunca lançar.
        return null
      }
    }

    export async function clearStoredSession(): Promise<void> {
      try {
        await fs.rm(sessionFilePath(), { force: true })
      } catch {
        // Falha ao remover não deve travar o fluxo de logout.
      }
    }
    ```
    Nunca chamar nenhuma função de `session-store.ts` antes de `app.whenReady()` resolver —
    documentar isso em comentário no topo do arquivo (a inicialização lazy do encryptor
    assíncrono do Electron depende do app estar pronto).
  </action>
  <verify>`package.json` lista `@workos-inc/node`; `npm install` roda sem erro; `session-store.ts` só usa `encryptStringAsync`/`decryptStringAsync` (grep confirma ausência de `encryptString(` síncrono e de `electron-store`); toda leitura tem try/catch retornando `null` em vez de propagar erro.</verify>
  <done>Persistência de sessão criptografada funcionando isoladamente (sem depender de IPC ou fluxo OAuth ainda), com falha de leitura sempre degradando para "sem sessão".</done>
</task>

<task type="auto">
  <name>Task 2: Fluxo PKCE completo (login, callback, refresh, logout)</name>
  <files>src/main/auth/auth.ts</files>
  <action>
    Criar `src/main/auth/auth.ts` usando `createWorkOS({ clientId })` **sem** `apiKey` — o
    TypeScript já impede em tempo de compilação qualquer chamada que precisaria dela (tipo
    `PublicWorkOS`, confirmado em 02-RESEARCH.md §2):
    ```ts
    import { createWorkOS } from '@workos-inc/node'
    import { writeSession, readSession, clearStoredSession } from './session-store'
    import type { AuthUser } from './types'

    const CLIENT_ID = import.meta.env.MAIN_VITE_WORKOS_CLIENT_ID
    const REDIRECT_URI = 'janja://callback'
    const PKCE_STATE_TTL_MS = 10 * 60 * 1000 // 10 minutos

    const workos = createWorkOS({ clientId: CLIENT_ID })

    // Estado do fluxo em andamento — vive só em memória do processo main, nunca em disco;
    // é descartado assim que o callback chega ou expira.
    let pendingLogin: { state: string; codeVerifier: string; expiresAt: number } | null = null

    // Cache em memória do access token corrente + do usuário — evita decidir sobre
    // isEncryptionAvailable() e reabrir/decriptar o arquivo a cada chamada; só o refresh
    // token de longa duração precisa do disco.
    let cachedAccessToken: string | null = null
    let cachedUser: AuthUser | null = null

    export async function getSignInUrl(): Promise<string> {
      const { url, state, codeVerifier } = await workos.userManagement.getAuthorizationUrlWithPKCE({
        provider: 'authkit',
        redirectUri: REDIRECT_URI,
      })
      pendingLogin = { state, codeVerifier, expiresAt: Date.now() + PKCE_STATE_TTL_MS }
      return url
    }

    export async function handleCallback(code: string, receivedState: string): Promise<AuthUser> {
      if (!pendingLogin) throw new Error('Nenhum login em andamento')
      if (pendingLogin.expiresAt < Date.now()) {
        pendingLogin = null
        throw new Error('Login expirado, tente novamente')
      }
      if (receivedState !== pendingLogin.state) {
        // Proteção contra CSRF: um retorno que não corresponde ao state gerado por nós
        // não é tratado como login válido, mesmo que o code pareça legítimo.
        pendingLogin = null
        throw new Error('State inválido no retorno do OAuth')
      }
      const { codeVerifier } = pendingLogin
      pendingLogin = null

      const auth = await workos.userManagement.authenticateWithCodeAndVerifier({ code, codeVerifier })
      const user = toAuthUser(auth.user)
      cachedAccessToken = auth.accessToken
      cachedUser = user
      await writeSession({ refreshToken: auth.refreshToken, workosId: auth.user.id })
      return user
    }

    function toAuthUser(u: { id: string; email: string; firstName: string | null; lastName: string | null; profilePictureUrl: string | null }): AuthUser {
      return { workosId: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, profilePictureUrl: u.profilePictureUrl }
    }

    function decodeJwtPayload(token: string): Record<string, unknown> {
      return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf-8'))
    }

    function isExpired(token: string): boolean {
      try {
        const { exp } = decodeJwtPayload(token) as { exp: number }
        return Date.now() > exp * 1000 - 10_000 // 10s de margem
      } catch {
        return true
      }
    }

    /** Garante um access token válido, renovando via refresh token se preciso.
     *  forceRefreshToken=true ignora o cache e força uma renovação — usado pelo
     *  ConvexProviderWithAuth (plano 02-07) e pelo watchdog de isAuthenticated (Pitfall 4). */
    export async function getAccessToken(forceRefreshToken = false): Promise<string | null> {
      if (!forceRefreshToken && cachedAccessToken && !isExpired(cachedAccessToken)) {
        return cachedAccessToken
      }
      const session = await readSession()
      if (!session) {
        cachedAccessToken = null
        cachedUser = null
        return null
      }
      try {
        const refreshed = await workos.userManagement.authenticateWithRefreshToken({
          refreshToken: session.refreshToken,
        })
        cachedAccessToken = refreshed.accessToken
        cachedUser = toAuthUser(refreshed.user)
        await writeSession({ refreshToken: refreshed.refreshToken, workosId: refreshed.user.id })
        return cachedAccessToken
      } catch {
        // Refresh token inválido/revogado — sessão morta, cair no login.
        await clearStoredSession()
        cachedAccessToken = null
        cachedUser = null
        return null
      }
    }

    export async function getUser(): Promise<AuthUser | null> {
      const token = await getAccessToken()
      if (!token) return null
      return cachedUser
    }

    export async function clearSession(): Promise<void> {
      cachedAccessToken = null
      cachedUser = null
      await clearStoredSession()
    }

    export function getLogoutUrl(): string | null {
      if (!cachedAccessToken) return null
      const { sid } = decodeJwtPayload(cachedAccessToken) as { sid?: string }
      if (!sid) return null
      return workos.userManagement.getLogoutUrl({ sessionId: sid })
    }
    ```
    Notas de implementação que não podem ser puladas:
    - `getAuthorizationUrlWithPKCE` já gera `state` e `codeVerifier` automaticamente — não
      reimplementar isso com `workos.pkce.generate()` manual (método mais antigo, ainda
      existe no SDK, mas o oficial hoje é este).
    - A validação do `state` no callback é responsabilidade do app (o SDK gera, mas não
      valida sozinho no retorno) — é a proteção contra CSRF exigida mesmo em fluxo de custom
      protocol, não só em loopback.
    - `authenticateWithCodeAndVerifier` (não `authenticateWithCode`) é usado de propósito:
      é a variante explícita para cliente público, com `codeVerifier` obrigatório no tipo —
      evita a ambiguidade de auto-detecção do método genérico.
    - `getLogoutUrl` sem `sessionId` disponível retorna `null` — quem chama (plano 02-03,
      IPC de sign-out) precisa tratar esse caso sem quebrar o logout local (limpar a sessão
      localmente mesmo que não haja URL de logout remoto para abrir).
  </action>
  <verify>`src/main/auth/auth.ts` exporta `getSignInUrl`, `handleCallback`, `getAccessToken`, `getUser`, `clearSession`, `getLogoutUrl`; `npm run typecheck:node` passa; grep confirma que nenhuma chamada usa `apiKey` em `createWorkOS`.</verify>
  <done>Fluxo PKCE completo e testável por leitura de código: gera URL de login, valida state, troca código por tokens, persiste via session-store, renova sob expiração, e produz URL de logout.</done>
</task>

</tasks>

<verification>
- `npm run typecheck:node` passa com os novos arquivos.
- Nenhuma referência a `WORKOS_API_KEY` ou a `apiKey` em `auth.ts`.
- `session-store.ts` nunca lança para fora de `readSession()` — toda leitura cai em `catch` retornando `null`.
- `state` gerado em `getSignInUrl` é validado byte-a-byte contra o recebido no callback antes de qualquer troca de código.
</verification>

<success_criteria>
O processo main tem, isoladamente (sem IPC, sem protocolo, sem UI), toda a lógica necessária
para AUTH-01/02/03 e a base de AUTH-04/05: gerar login, trocar código, persistir, renovar,
falhar graciosamente, e produzir URL de logout.
</success_criteria>

<output>
After completion, create `.planning/phases/02-convex-auth-workos/02-02-SUMMARY.md`.
</output>
