import { useState, useEffect, useCallback } from 'react'

/**
 * Mirrors `AuthUser` from `src/main/auth/types.ts`, duplicated locally rather than imported.
 * `src/main` is not part of the renderer's `tsconfig.web.json` `include` glob (separate
 * process, separate TS config), so importing across that boundary does not resolve cleanly —
 * the official WorkOS Electron example makes the same call (its `useAuth.ts` redefines `User`
 * locally instead of importing from main). Keep these fields in sync with
 * `src/main/auth/types.ts` by hand if that shape ever changes.
 */
export interface AuthUser {
  workosId: string
  email: string
  firstName: string | null
  lastName: string | null
  profilePictureUrl: string | null
}

interface UseAuthReturn {
  user: AuthUser | null
  loading: boolean
  /** Falha de comunicação com o processo main, ou app mal configurado. */
  error: string | null
  signIn: () => Promise<{ success: boolean; error?: string }>
  signOut: () => Promise<{ success: boolean; error?: string }>
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // `.catch` + `.finally` não são zelo excessivo: sem eles, qualquer rejeição
    // desta promise deixa `loading` em true para sempre, e o app fica numa tela
    // "Carregando…" eterna, sem erro visível e sem caminho de saída. Foi
    // exatamente o que aconteceu quando o clientId do WorkOS não estava
    // configurado — o handler de IPC lançava, a promise rejeitava, e o app
    // travava em silêncio.
    //
    // Falhar aqui significa "não há sessão utilizável": tratamos como deslogado,
    // guardamos a causa para a interface poder mostrá-la, e liberamos o loading.
    window.auth
      .getUser()
      .then((u) => setUser(u))
      .catch((err: unknown) => {
        console.error('Falha ao consultar a sessão:', err)
        setUser(null)
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoading(false))

    return window.auth.onAuthChange(({ user: u }) => {
      setUser(u)
      setError(null)
      setLoading(false)
    })
  }, [])

  const signIn = useCallback(() => window.auth.signIn(), [])
  const signOut = useCallback(() => window.auth.signOut(), [])

  return { user, loading, error, signIn, signOut }
}
