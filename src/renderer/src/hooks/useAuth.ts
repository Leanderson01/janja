import { useMemo } from 'react'
import { auth } from '@platform/auth'
import type { SessionUser } from '@/platform/contract'

/**
 * O caminho conhecido para a sessão — agora um reexport fino do contrato de
 * plataforma.
 *
 * O ARQUIVO NÃO FOI APAGADO de propósito: `LoginScreen.tsx` e `UserPanel.tsx`
 * já o importam desde a Fase 2, e manter o nome conhecido deixa o diff desta
 * fase do tamanho da mudança real (a FONTE do token trocou no alvo web) em vez
 * do tamanho de um rename. Quem implementa continua sendo um só lugar:
 * `@platform/auth`, escolhido pelo bundler.
 *
 * O tipo do usuário mora hoje em `platform/contract.ts` como `SessionUser` — a
 * duplicação em relação a `src/main/auth/types.ts` deixou de ser um contorno e
 * virou o formato canônico dos dois alvos (o mesmo `User` do `authkit-js`, o
 * mesmo `AuthUserLike` de `lib/profile-hint.ts`). O motivo de não importar de
 * `src/main` está escrito em `platform/electron/auth.tsx`, junto do código que
 * depende dele.
 */
export type AuthUser = SessionUser

interface UseAuthReturn {
  user: SessionUser | null
  loading: boolean
  /**
   * Electron: falha de comunicação com o processo main, ou app mal
   * configurado. Web: sempre `null` — ver o comentário de `useSession` em
   * `platform/web/auth.tsx`.
   */
  error: string | null
  /** LANÇA em caso de falha (antes devolvia `{ success, error }`). */
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

export function useAuth(): UseAuthReturn {
  const { user, loading, error } = auth.useSession()
  // `signIn`/`signOut` são funções de módulo (identidade estável nos dois
  // alvos). O `useMemo` depende dos três CAMPOS, e não do objeto devolvido por
  // `useSession`: o lado Electron devolve um objeto novo a cada render, e
  // depender dele memorizaria nada.
  return useMemo(
    () => ({ user, loading, error, signIn: auth.signIn, signOut: auth.signOut }),
    [user, loading, error]
  )
}
