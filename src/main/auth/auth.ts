// Núcleo de autenticação do processo main: geração da URL de login PKCE,
// troca do código de autorização por tokens, persistência da sessão via
// session-store.ts, e renovação do access token via refresh token.
//
// Usa `createWorkOS({ clientId })` SEM `apiKey` — o TypeScript recusa em
// tempo de compilação qualquer chamada que precisaria de uma API key
// (tipo `PublicWorkOS`, confirmado em 02-RESEARCH.md §2). Nenhum valor
// `sk_...` aparece neste arquivo, nunca.
//
// Este arquivo não toca em IPC, protocolo customizado ou UI — é chamado
// diretamente (mesmo processo) pelo módulo de IPC do plano 02-03.

import { createWorkOS } from '@workos-inc/node'
import { writeSession, readSession, clearStoredSession } from './session-store'
import type { AuthUser } from './types'

declare global {
  interface ImportMetaEnv {
    MAIN_VITE_WORKOS_CLIENT_ID: string
  }
}

const CLIENT_ID = import.meta.env.MAIN_VITE_WORKOS_CLIENT_ID
const REDIRECT_URI = 'janja://callback'
const PKCE_STATE_TTL_MS = 10 * 60 * 1000 // 10 minutos

// Inicialização preguiçosa e deliberada.
//
// `createWorkOS` lança se o clientId vier vazio. Chamando no nível do módulo,
// um `.env.local` sem MAIN_VITE_WORKOS_CLIENT_ID derruba o app inteiro no
// carregamento, com um popup de "Uncaught Exception" e um stack trace do
// node_modules — nenhuma pista do que fazer. Quem instalar o app e esquecer
// de configurar veria exatamente isso.
//
// Adiando para o primeiro uso, a falha acontece dentro de um handler de IPC,
// onde vira uma mensagem legível na interface em vez de um crash na inicialização.
// A tipagem passa por esta função porque `createWorkOS` tem sobrecargas: com
// clientId ela devolve `PublicWorkOS` (sem os métodos que exigem API key), e é
// justamente essa a garantia em tempo de compilação de que nenhuma chave
// secreta é necessária. `ReturnType<typeof createWorkOS>` escolheria a
// sobrecarga errada e apagaria essa garantia.
function createPublicClient() {
  return createWorkOS({ clientId: CLIENT_ID })
}

let workosClient: ReturnType<typeof createPublicClient> | null = null

export class AuthNotConfiguredError extends Error {
  constructor() {
    super(
      'MAIN_VITE_WORKOS_CLIENT_ID não está definida. Crie um arquivo .env.local na ' +
        'raiz do projeto com essa variável (veja .env.local.example) e reinicie o app.'
    )
    this.name = 'AuthNotConfiguredError'
  }
}

export function isAuthConfigured(): boolean {
  return typeof CLIENT_ID === 'string' && CLIENT_ID.length > 0
}

function workos(): ReturnType<typeof createPublicClient> {
  if (!isAuthConfigured()) throw new AuthNotConfiguredError()
  workosClient ??= createPublicClient()
  return workosClient
}

// Estado do fluxo em andamento — vive só em memória do processo main, nunca em disco;
// é descartado assim que o callback chega ou expira.
let pendingLogin: { state: string; codeVerifier: string; expiresAt: number } | null = null

// Cache em memória do access token corrente + do usuário — evita decidir sobre
// isEncryptionAvailable() e reabrir/decriptar o arquivo a cada chamada; só o refresh
// token de longa duração precisa do disco.
let cachedAccessToken: string | null = null
let cachedUser: AuthUser | null = null

export async function getSignInUrl(): Promise<string> {
  const { url, state, codeVerifier } = await workos().userManagement.getAuthorizationUrlWithPKCE({
    provider: 'authkit',
    redirectUri: REDIRECT_URI
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

  const auth = await workos().userManagement.authenticateWithCodeAndVerifier({ code, codeVerifier })
  const user = toAuthUser(auth.user)
  cachedAccessToken = auth.accessToken
  cachedUser = user
  await writeSession({ refreshToken: auth.refreshToken, workosId: auth.user.id })
  return user
}

function toAuthUser(u: {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  profilePictureUrl: string | null
}): AuthUser {
  return {
    workosId: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    profilePictureUrl: u.profilePictureUrl
  }
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
    const refreshed = await workos().userManagement.authenticateWithRefreshToken({
      refreshToken: session.refreshToken
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
  return workos().userManagement.getLogoutUrl({ sessionId: sid })
}
