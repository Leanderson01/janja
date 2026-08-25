import { auth } from '@platform/auth'

/**
 * O adaptador que `ConvexProviderWithAuth` recebe como prop `useAuth` — agora
 * um reexport fino do contrato de plataforma.
 *
 * A IMPLEMENTAÇÃO MUDOU DE LUGAR, NÃO DE FORMA: continua sendo o mesmo
 * `useMemo` sobre `{ isLoading, isAuthenticated, fetchAccessToken }` exigido
 * por `node_modules/convex/dist/esm-types/react/ConvexAuthState.d.ts` (ver
 * 02-RESEARCH.md §4). O que muda por alvo é a FONTE do token: no Electron o
 * processo main, por IPC; na web o `@workos-inc/authkit-react`.
 *
 * O `forceRefreshToken` atravessa nos dois — é a alavanca do Pitfall 4
 * (`get-convex/convex-backend#259`), e foi por descartá-la que o
 * `@convex-dev/workos` foi rejeitado nesta fase. `platform/web/auth.test.ts`
 * prova a travessia nas duas direções.
 *
 * `main.tsx` passa `auth.useConvexAuthAdapter` direto; este arquivo fica como
 * o nome conhecido desde a Fase 2 (mesma decisão de `hooks/useAuth.ts`), para
 * que quem procurar o adaptador por onde ele sempre esteve encontre a porta em
 * vez de um 404.
 */
export const useConvexAuthAdapter = auth.useConvexAuthAdapter
