// @vitest-environment jsdom
//
// O TESTE QUE IMPEDE UMA REGRESSÃO ESPECÍFICA.
//
// A costura de autenticação da web tem UM ponto onde um erro não aparece em
// lugar nenhum: `fetchAccessToken({ forceRefreshToken })` precisa virar
// `getAccessToken({ forceRefresh })`. Chamar `getAccessToken()` sem argumento
// compila, passa em typecheck nas quatro passadas, sobe no navegador, loga
// normalmente — e só aparece horas depois, como "o app travou dizendo que não
// estou logado" (Pitfall 4, `get-convex/convex-backend#259`), que é justamente
// o sintoma que o `AuthWatchdog` existe para remediar.
//
// Sem argumento é EXATAMENTE o que o `@convex-dev/workos@0.0.3` faz, e é por
// isso que ele foi rejeitado na pesquisa desta fase. Este arquivo é o que
// impede alguém de "simplificar" o adaptador de volta para o comportamento
// dele.
//
// `jsdom` (e não o `edge-runtime` global do projeto) porque o que está sob
// teste É o hook: testar uma função auxiliar extraída provaria a função, não a
// travessia. `@workos-inc/authkit-react` entra mockado — o alvo aqui é a nossa
// tradução, não o cliente da WorkOS. Import relativo `./auth` de propósito: o
// alias `@platform` do vitest aponta para o Electron (ver `vitest.config.ts`).
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getAccessToken, authKitState } = vi.hoisted(() => ({
  getAccessToken: vi.fn<[{ forceRefresh?: boolean }?], Promise<string>>(),
  authKitState: {
    isLoading: false,
    user: null as null | Record<string, unknown>
  }
}))

vi.mock('@workos-inc/authkit-react', () => ({
  AuthKitProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({
    isLoading: authKitState.isLoading,
    user: authKitState.user,
    getAccessToken,
    signIn: vi.fn(),
    signOut: vi.fn()
  })
}))

import { auth, isAuthConfigured } from './auth'

const WORKOS_USER = {
  object: 'user',
  id: 'user_01m0bc3v',
  email: 'leo@example.com',
  emailVerified: true,
  firstName: 'Leo',
  lastName: 'Neves',
  profilePictureUrl: 'https://workoscdn.com/leo.png',
  lastSignInAt: null,
  externalId: undefined,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
}

beforeEach(() => {
  getAccessToken.mockReset()
  getAccessToken.mockResolvedValue('jwt.do.workos')
  authKitState.isLoading = false
  authKitState.user = null
})

describe('useConvexAuthAdapter — o forceRefreshToken atravessa', () => {
  it('forceRefreshToken: true vira getAccessToken({ forceRefresh: true })', async () => {
    const { result } = renderHook(() => auth.useConvexAuthAdapter())

    await expect(result.current.fetchAccessToken({ forceRefreshToken: true })).resolves.toBe(
      'jwt.do.workos'
    )

    expect(getAccessToken).toHaveBeenCalledWith({ forceRefresh: true })
  })

  it('forceRefreshToken: false vira getAccessToken({ forceRefresh: false })', async () => {
    const { result } = renderHook(() => auth.useConvexAuthAdapter())

    await result.current.fetchAccessToken({ forceRefreshToken: false })

    expect(getAccessToken).toHaveBeenCalledWith({ forceRefresh: false })
  })

  it('NUNCA chama getAccessToken sem argumento (o defeito do @convex-dev/workos)', async () => {
    const { result } = renderHook(() => auth.useConvexAuthAdapter())

    await result.current.fetchAccessToken({ forceRefreshToken: true })
    await result.current.fetchAccessToken({ forceRefreshToken: false })

    expect(getAccessToken).toHaveBeenCalledTimes(2)
    for (const [options] of getAccessToken.mock.calls) {
      // `getAccessToken()` sem argumento chega aqui como `undefined` — e é
      // assim que o token do backend recusado nunca seria renovado à força.
      expect(options).toBeDefined()
      expect(options).toHaveProperty('forceRefresh')
    }
  })
})

describe('useConvexAuthAdapter — falha vira token nulo, nunca exceção', () => {
  it('getAccessToken rejeitando resolve null (LoginRequiredError/RefreshError)', async () => {
    getAccessToken.mockRejectedValue(new Error('LoginRequiredError'))
    const { result } = renderHook(() => auth.useConvexAuthAdapter())

    // `.resolves.toBeNull()` e não `.rejects`: uma rejeição aqui sobe para
    // dentro do cliente do Convex, que espera "string ou null".
    await expect(result.current.fetchAccessToken({ forceRefreshToken: true })).resolves.toBeNull()
  })

  it('mapeia isLoading e isAuthenticated na forma que o ConvexProviderWithAuth exige', () => {
    authKitState.isLoading = true
    const carregando = renderHook(() => auth.useConvexAuthAdapter())
    expect(carregando.result.current).toMatchObject({ isLoading: true, isAuthenticated: false })

    authKitState.isLoading = false
    authKitState.user = WORKOS_USER
    const logado = renderHook(() => auth.useConvexAuthAdapter())
    expect(logado.result.current).toMatchObject({ isLoading: false, isAuthenticated: true })
  })
})

describe('perfil e sessão', () => {
  it('useSession devolve os quatro campos de SessionUser — os mesmos de profile-hint.ts', () => {
    authKitState.user = WORKOS_USER
    const { result } = renderHook(() => auth.useSession())

    expect(result.current).toEqual({
      loading: false,
      error: null,
      user: {
        email: 'leo@example.com',
        firstName: 'Leo',
        lastName: 'Neves',
        profilePictureUrl: 'https://workoscdn.com/leo.png'
      }
    })
  })

  it('getProfile e hasLiveSession não lançam sem o provider montado', async () => {
    // O contrato é explícito: "não deu para saber" é `null`/`false`, não
    // exceção — uma rejeição aqui deixaria o `AuthGate` numa tela "Carregando…"
    // eterna, e o watchdog com uma promise rejeitada sem `catch`.
    await expect(auth.getProfile()).resolves.toBeNull()
    await expect(auth.hasLiveSession()).resolves.toBe(false)
  })
})

describe('configuração ausente', () => {
  it('importar o módulo sem VITE_WORKOS_CLIENT_ID não lança — vira uma flag', () => {
    // Um `throw` em nível de módulo acontece ANTES de existir error boundary:
    // página branca e stack de node_modules. Quem decide o que mostrar é
    // `main.tsx`, lendo esta flag.
    expect(typeof isAuthConfigured).toBe('boolean')
    expect(isAuthConfigured).toBe(Boolean(import.meta.env.VITE_WORKOS_CLIENT_ID))
  })
})
