import { useCallback, useMemo } from 'react'
import { useAuth } from './useAuth'

/**
 * Formato exigido por `ConvexProviderWithAuth` (convex/react) — ver 02-RESEARCH.md §4.
 * Verificado diretamente contra os tipos publicados do pacote `convex` instalado
 * (node_modules/convex/dist/esm-types/react/ConvexAuthState.d.ts): o parâmetro `useAuth`
 * de `ConvexProviderWithAuth` deve retornar exatamente
 * `{ isLoading: boolean; isAuthenticated: boolean; fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null> }`.
 *
 * Este hook não é consumido diretamente por componentes de UI — é passado como a prop
 * `useAuth` de `ConvexProviderWithAuth` no plano 02-08.
 */
export function useConvexAuthAdapter(): {
  isLoading: boolean
  isAuthenticated: boolean
  fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>
} {
  const { user, loading } = useAuth()

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
      try {
        return await window.auth.getAccessToken({ forceRefreshToken })
      } catch {
        return null
      }
    },
    []
  )

  return useMemo(
    () => ({
      isLoading: loading,
      isAuthenticated: !!user,
      fetchAccessToken
    }),
    [loading, user, fetchAccessToken]
  )
}
