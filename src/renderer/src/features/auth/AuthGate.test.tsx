// @vitest-environment jsdom
//
// O TESTE DA TELA PRETA DO PRIMEIRO CADASTRO.
//
// Sintoma relatado em uso real (web, 2026-08-25): "quando você cadastra pela
// primeira vez ele fica só com uma tela preta e você precisa dar F5 pra
// funcionar". Tela PRETA, não branca: `body` tem `bg-background`
// (`oklch(0.145 0 0)` no bloco `.dark` de `assets/main.css`), então uma tela
// preta é literalmente o `<div id="root">` VAZIO — a árvore inteira do React
// desmontou.
//
// A cadeia, que este arquivo executa de ponta a ponta:
//
//   1. Convex vira `isAuthenticated: true`.
//   2. `AuthGate` renderiza `children` NA HORA — e é só num EFEITO, depois do
//      commit, que ele chama `ensureUser` (a mutation que INSERE a linha em
//      `users`).
//   3. No mesmo commit, `SelectionProvider` (o primeiro nó de `AppShell`) abre
//      `useQuery(api.servers.listMyServers)`. Esse render não quebra: query
//      recém-assinada devolve `undefined`.
//   4. A resposta chega. Para quem acabou de se cadastrar, `requireIdentity`
//      (convex/lib/membership.ts:17) lança "Usuário sem documento em users —
//      ensureUser deveria ter rodado antes", porque a mutation do passo 2 ainda
//      está no ar.
//   5. `useQuery` do `convex/react` RELANÇA esse erro DURANTE O RENDER
//      (node_modules/convex/dist/esm/react/client.js:465). Não há error
//      boundary na árvore. O React desmonta a raiz. Tela preta.
//   6. O F5 conserta porque a mutation do passo 2 CHEGOU A SER ENVIADA e
//      gravou a linha — o segundo carregamento já encontra o usuário.
//
// Por isso o teste usa o `useQuery` DE VERDADE do `convex/react` (só o
// transporte é falso): o passo 5 é o mecanismo em julgamento, e uma imitação do
// hook provaria a imitação. `useConvexAuth`/`useMutation` entram mockados
// porque são a ENTRADA do cenário (o estado de sessão e a mutation cuja
// latência é a corrida), não o que está sob teste.
//
// O alias `@platform` aponta para o ELECTRON aqui (ver vitest.config.ts) — de
// propósito: o defeito não é do alvo web (o `AuthGate` é compartilhado), e
// rodá-lo contra o desktop é a prova de que a correção vale para os dois.
import { StrictMode } from 'react'
import { cleanup, render, screen, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import { ConvexProvider, useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'

const { convexAuthState, ensureUserMock, heartbeatMock, getProfileMock } = vi.hoisted(() => ({
  convexAuthState: { isLoading: false, isAuthenticated: false },
  ensureUserMock: vi.fn<[unknown], Promise<unknown>>(),
  heartbeatMock: vi.fn<[], Promise<unknown>>(),
  getProfileMock: vi.fn<[], Promise<unknown>>()
}))

vi.mock('convex/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('convex/react')>()
  return {
    ...actual,
    useConvexAuth: () => ({ ...convexAuthState }),
    useMutation: (reference: unknown) =>
      getFunctionName(reference as never) === 'users:ensureUser' ? ensureUserMock : heartbeatMock
  }
})

vi.mock('@platform/auth', () => ({
  auth: {
    getProfile: getProfileMock,
    // `LoginScreen` (o ramo "não autenticado") consome `useAuth()`, que lê
    // `auth.useSession` — precisa existir no dobro, senão o ramo de login
    // quebraria por motivo nenhum a ver com o defeito.
    useSession: () => ({ user: null, loading: false, error: null }),
    signIn: vi.fn(),
    signOut: vi.fn(),
    hasLiveSession: vi.fn()
  },
  isAuthConfigured: true
}))

import { AuthGate } from './AuthGate'

// ── O transporte falso do Convex ──────────────────────────────────────────
// Implementa só o que `QueriesObserver` consome de um cliente
// (`watchQuery` -> `localQueryResult` / `onUpdate` / `journal`), para que o
// `useQuery` real rode inteiro em cima dele. `localQueryResult()` LANÇANDO é
// exatamente como o cliente de verdade entrega um erro de servidor: o
// observer captura (queries_observer.js:63) e o transforma no valor `Error`
// que `useQuery` relança no render.
function makeFakeConvex(): {
  client: never
  resolve: (name: string, value: unknown) => void
} {
  const results = new Map<string, unknown>()
  const listeners = new Set<() => void>()

  const client = {
    watchQuery(query: unknown) {
      const name = getFunctionName(query as never)
      return {
        localQueryResult: () => {
          const value = results.get(name)
          if (value instanceof Error) throw value
          return value
        },
        onUpdate: (callback: () => void) => {
          listeners.add(callback)
          return () => listeners.delete(callback)
        },
        journal: () => undefined
      }
    }
  }

  return {
    client: client as never,
    resolve(name, value) {
      results.set(name, value)
      act(() => {
        for (const listener of listeners) listener()
      })
    }
  }
}

// O erro EXATO que o backend devolve para quem ainda não tem linha em `users`
// — o texto vem de convex/lib/membership.ts:18, dentro do embrulho que o
// cliente do Convex acrescenta.
const SEM_DOCUMENTO = new Error(
  `[CONVEX Q(servers:listMyServers)] [Request ID: 3f1] Server Error
Uncaught Error: Usuário sem documento em users — ensureUser deveria ter rodado antes
    at requireIdentity (../convex/lib/membership.ts:18:11)`
)

// O papel de `AppShell` no cenário: o primeiro nó de dentro do gate abre uma
// subscription que depende da linha em `users` (na vida real é o
// `useQuery(api.servers.listMyServers)` de `state/selection-context.tsx`,
// montado por `SelectionProvider`).
function AppFalso(): React.JSX.Element {
  const servers = useQuery(api.servers.listMyServers)
  return <div data-testid="app">servidores: {servers === undefined ? '…' : servers.length}</div>
}

let convex: ReturnType<typeof makeFakeConvex>
let liberaEnsureUser: (() => void) | undefined

beforeEach(() => {
  convex = makeFakeConvex()
  convexAuthState.isLoading = false
  convexAuthState.isAuthenticated = true
  getProfileMock.mockReset()
  getProfileMock.mockResolvedValue({
    email: 'novato@example.com',
    firstName: 'Novato',
    lastName: null,
    profilePictureUrl: null
  })
  heartbeatMock.mockReset()
  heartbeatMock.mockResolvedValue(null)
  ensureUserMock.mockReset()
  // A LATÊNCIA É O CENÁRIO: `ensureUser` fica no ar até o teste soltá-la, que
  // é o que acontece no navegador enquanto a query já voltou com erro.
  ensureUserMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        liberaEnsureUser = () => resolve({ _id: 'users_1' })
      })
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  // Obrigatório: o vitest deste projeto roda sem `globals: true`, então o
  // `afterEach(cleanup)` automático da Testing Library não existe e as árvores
  // de um teste vazam para o seguinte (lição do Plano 08.5-02).
  cleanup()
  liberaEnsureUser = undefined
  vi.restoreAllMocks()
})

function renderGate(): ReturnType<typeof render> {
  return render(
    <ConvexProvider client={convex.client}>
      <AuthGate>
        <AppFalso />
      </AuthGate>
    </ConvexProvider>
  )
}

describe('AuthGate — o primeiro cadastro não pode terminar em árvore vazia', () => {
  it('não monta o app antes de `ensureUser` responder (a causa da tela preta)', async () => {
    renderGate()

    // Enquanto a conta não existe do lado do servidor, o gate NÃO pode ter
    // montado nada que dependa dela. Antes da correção, `data-testid="app"`
    // já estava na tela aqui — e era ele quem abria a subscription que
    // derrubava a árvore duas linhas abaixo.
    await waitFor(() => expect(ensureUserMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('app')).toBeNull()

    // E o que está na tela é legível, não um retângulo preto.
    expect(document.body.textContent).toMatch(/conta|carregando/i)
  })

  it('a resposta de erro do servidor NÃO desmonta a árvore', async () => {
    const { container } = renderGate()
    await waitFor(() => expect(ensureUserMock).toHaveBeenCalledTimes(1))

    // O servidor responde o que responderia para quem ainda não tem linha em
    // `users`. Com o app montado cedo demais (comportamento anterior), este
    // `resolve` lança de dentro do render e o React desmonta a raiz inteira.
    let escapou: unknown = null
    try {
      convex.resolve('servers:listMyServers', SEM_DOCUMENTO)
    } catch (err) {
      escapou = err
    }

    expect(escapou).toBeNull()
    expect(container.innerHTML).not.toBe('')
  })

  it('monta o app depois que `ensureUser` responde, e a query já funciona', async () => {
    renderGate()
    await waitFor(() => expect(ensureUserMock).toHaveBeenCalledTimes(1))

    await act(async () => {
      liberaEnsureUser?.()
      await Promise.resolve()
    })

    // Asserções em DOM puro: `@testing-library/jest-dom` não está instalado
    // neste projeto (ver o cabeçalho de `MessageInput.test.tsx`).
    expect(await screen.findByTestId('app')).not.toBeNull()

    convex.resolve('servers:listMyServers', [])
    expect(screen.getByTestId('app').textContent).toBe('servidores: 0')
  })

  it('`ensureUser` falhando vira tela legível, nunca árvore vazia', async () => {
    ensureUserMock.mockReset()
    ensureUserMock.mockRejectedValue(
      new Error(`[CONVEX M(users:ensureUser)] [Request ID: 9c2] Server Error
Uncaught Error: ensureUser requer uma identidade autenticada`)
    )

    const { container } = renderGate()

    await waitFor(() =>
      expect(container.textContent).toContain('Não foi possível preparar sua conta')
    )
    // A frase do servidor chega desembrulhada (lib/convex-error.ts), sem
    // Request ID nem stack de node_modules.
    expect(container.textContent).toContain('ensureUser requer uma identidade autenticada')
    expect(container.textContent).not.toContain('Request ID')
    expect(container.innerHTML).not.toBe('')
    expect(screen.queryByTestId('app')).toBeNull()
  })

  it('StrictMode (efeito duplo do dev) não deixa o portão travado', async () => {
    // O guard de "já disparei" é um ref, e o React em StrictMode monta,
    // desmonta e remonta o efeito. Se o guard nunca fosse solto E o primeiro
    // disparo fosse descartado, o app ficaria eternamente em "Preparando sua
    // conta…" — trocando uma tela preta por uma tela morta.
    render(
      <StrictMode>
        <ConvexProvider client={convex.client}>
          <AuthGate>
            <AppFalso />
          </AuthGate>
        </ConvexProvider>
      </StrictMode>
    )

    await waitFor(() => expect(ensureUserMock).toHaveBeenCalled())
    await act(async () => {
      liberaEnsureUser?.()
      await Promise.resolve()
    })

    expect(await screen.findByTestId('app')).not.toBeNull()
  })

  it('`ensureUser` recebe a dica de perfil lida da plataforma (comportamento preservado)', async () => {
    renderGate()
    await waitFor(() => expect(ensureUserMock).toHaveBeenCalledTimes(1))

    expect(ensureUserMock).toHaveBeenCalledWith({
      profile: expect.objectContaining({ email: 'novato@example.com' })
    })
  })
})

describe('AuthGate — o que NÃO muda para o desktop já instalado', () => {
  it('sessão carregando continua sendo a tela "Carregando…"', () => {
    convexAuthState.isLoading = true
    convexAuthState.isAuthenticated = false
    renderGate()

    expect(document.body.textContent).toContain('Carregando')
    expect(screen.queryByTestId('app')).toBeNull()
    expect(ensureUserMock).not.toHaveBeenCalled()
  })

  it('não autenticado continua caindo na tela de login, sem chamar ensureUser', () => {
    convexAuthState.isLoading = false
    convexAuthState.isAuthenticated = false
    renderGate()

    expect(screen.queryByTestId('app')).toBeNull()
    expect(ensureUserMock).not.toHaveBeenCalled()
  })
})

// ── A PROVA DE QUE "TELA PRETA" = RAIZ VAZIA ──────────────────────────────
// Este bloco não testa o `AuthGate`: testa o MECANISMO, sem gate nenhum no
// caminho, e passa tanto antes quanto depois da correção. Ele existe para que
// a próxima pessoa não precise reconstruir a cadeia de raciocínio a partir do
// relato "ficou preto" — está aqui, executável: um erro de query sem error
// boundary acima esvazia o `#root`, e um `#root` vazio sobre `body` com
// `bg-background` é literalmente um retângulo preto.
describe('o mecanismo — erro de query sem error boundary esvazia a raiz', () => {
  it('useQuery relança no render, o React desmonta e o container fica vazio', () => {
    const { container } = render(
      <ConvexProvider client={convex.client}>
        <AppFalso />
      </ConvexProvider>
    )
    expect(container.innerHTML).not.toBe('')

    let escapou: unknown = null
    try {
      convex.resolve('servers:listMyServers', SEM_DOCUMENTO)
    } catch (err) {
      escapou = err
    }

    // O erro não é engolido nem contido: sobe pelo render e leva a árvore.
    expect((escapou as Error)?.message).toContain('ensureUser deveria ter rodado antes')
    expect(container.innerHTML).toBe('')
  })
})
