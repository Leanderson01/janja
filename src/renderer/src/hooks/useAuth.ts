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
  signIn: () => Promise<{ success: boolean; error?: string }>
  signOut: () => Promise<{ success: boolean; error?: string }>
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.auth.getUser().then((u) => {
      setUser(u)
      setLoading(false)
    })
    return window.auth.onAuthChange(({ user: u }) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  const signIn = useCallback(() => window.auth.signIn(), [])
  const signOut = useCallback(() => window.auth.signOut(), [])

  return { user, loading, signIn, signOut }
}
