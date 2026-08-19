import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

// Estado de layout da JANELA (Plano 08.5-05). Hoje tem um único membro:
// se a lista de membros está visível.
//
// Por que um contexto e não uma prop: quem alterna é um botão no
// `ChannelHeader` (dentro de `ConversationArea`) e quem obedece é a coluna
// da direita do `AppShell` — dois pontos distantes na árvore, com a área de
// conversa inteira no meio. Uma prop atravessaria `ConversationArea`, que
// não tem nada a ver com o assunto e é propriedade de outro plano.
//
// Por que isto é preferência de MÁQUINA (`localStorage`) e não de conta:
// mesma justificativa de `voice-preferences.ts` e
// `screenshare-preferences.ts` — depende do tamanho do monitor e da janela
// de cada computador, não de quem está logado. A janela mínima do app é
// 900x600 (`src/main/index.ts`), e nela as colunas fixas (rail 72 +
// sidebar 240 + membros 240 = 552px) deixam ~348px de conversa; esconder a
// lista de membros devolve 240px para a área principal.
//
// ESCOPO: só a visibilidade da lista de membros. Isto NÃO é um "contexto de
// UI" genérico — o próximo item entra quando existir, não antes.

export type LayoutContextValue = {
  membersVisible: boolean
  toggleMembers: () => void
}

type LayoutPreferences = {
  membersVisible: boolean
}

const STORAGE_KEY = 'janja:layout-preferences'

// Default visível: é o layout que a Fase 3 entregou e o que o Discord real
// mostra na primeira abertura. Esconder é a exceção que o usuário escolhe.
const DEFAULT_LAYOUT_PREFERENCES: LayoutPreferences = {
  membersVisible: true
}

function sanitize(raw: unknown): LayoutPreferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_LAYOUT_PREFERENCES

  const candidate = raw as Partial<Record<keyof LayoutPreferences, unknown>>

  return {
    membersVisible:
      typeof candidate.membersVisible === 'boolean'
        ? candidate.membersVisible
        : DEFAULT_LAYOUT_PREFERENCES.membersVisible
  }
}

// Nunca lança: `localStorage` ausente/corrompido/indisponível cai no
// default. Mesmo padrão defensivo de `voice-preferences.ts`.
function loadLayoutPreferences(): LayoutPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT_PREFERENCES
    return sanitize(JSON.parse(raw))
  } catch {
    return DEFAULT_LAYOUT_PREFERENCES
  }
}

function saveLayoutPreferences(next: LayoutPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota excedida ou storage indisponível: a escolha só não sobrevive ao
    // reinício, não deve derrubar a UI que chamou isto.
  }
}

const LayoutContext = createContext<LayoutContextValue | undefined>(undefined)

export function LayoutProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // Inicializador preguiçoso: lê o `localStorage` uma vez na montagem, não a
  // cada render, e sem `useEffect` de sincronização (o valor persistido é a
  // fonte inicial, o estado de React é a fonte a partir daí).
  const [membersVisible, setMembersVisible] = useState<boolean>(
    () => loadLayoutPreferences().membersVisible
  )

  const toggleMembers = useCallback((): void => {
    setMembersVisible((current) => {
      const next = !current
      saveLayoutPreferences({ membersVisible: next })
      return next
    })
  }, [])

  const value = useMemo<LayoutContextValue>(
    () => ({ membersVisible, toggleMembers }),
    [membersVisible, toggleMembers]
  )

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}

export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext)
  if (!context) {
    throw new Error('useLayout deve ser usado dentro de um LayoutProvider')
  }
  return context
}
