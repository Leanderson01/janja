import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

import {
  clampChannelListWidth,
  loadLayoutPreferences,
  saveLayoutPreferences,
  type LayoutPreferences
} from '@/lib/layout-preferences'

// Estado de layout da JANELA (Plano 08.5-05): se a lista de membros está
// visível e a largura da lista de canais (rodada 1 da UI do Discord).
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
// canais 240 mínimo + membros 240 = 552px) deixam ~348px de conversa; esconder
// a lista de membros devolve 240px para a área principal. A largura da lista
// de canais (240–360) é limitada por `clampChannelListWidth` para o chat nunca
// ficar com menos de 400px quando a janela comporta isso.
//
// ESCOPO: visibilidade dos membros e largura da lista de canais. Isto NÃO é um
// "contexto de UI" genérico — o próximo item entra quando existir, não antes.

export type LayoutContextValue = {
  membersVisible: boolean
  toggleMembers: () => void
  channelListWidth: number
  setChannelListWidth: (px: number) => void
  // Persiste a largura atual (chamado uma vez ao fim do arrasto ou da tecla).
  commitChannelListWidth: () => void
}

const LayoutContext = createContext<LayoutContextValue | undefined>(undefined)

export function LayoutProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // Inicializador preguiçoso: lê o `localStorage` uma vez na montagem, não a
  // cada render, e sem `useEffect` de sincronização (o valor persistido é a
  // fonte inicial, o estado de React é a fonte a partir daí).
  const [preferences, setPreferences] = useState(loadLayoutPreferences)
  // Espelho síncrono do estado: permite gravar no storage FORA de qualquer
  // updater de `setState` (que o StrictMode pode executar duas vezes).
  const latest = useRef(preferences)
  const { membersVisible, channelListWidth } = preferences

  const update = useCallback((next: LayoutPreferences): void => {
    latest.current = next
    setPreferences(next)
  }, [])

  const toggleMembers = useCallback((): void => {
    const next = { ...latest.current, membersVisible: !latest.current.membersVisible }
    update(next)
    saveLayoutPreferences(next)
  }, [update])

  // A largura sempre passa pelo clamp com a janela de AGORA: o chat nunca fica
  // com menos de 400px, mesmo com os membros abertos. Só atualiza a memória:
  // durante um arrasto isto roda a cada pointermove, e a gravação em
  // `localStorage` fica para `commitChannelListWidth` (fim do arrasto / tecla).
  const setChannelListWidth = useCallback(
    (px: number): void => {
      const current = latest.current
      const width = clampChannelListWidth(px, window.innerWidth, current.membersVisible)
      if (width === current.channelListWidth) return
      update({ ...current, channelListWidth: width })
    },
    [update]
  )

  const commitChannelListWidth = useCallback((): void => {
    saveLayoutPreferences(latest.current)
  }, [])

  const value = useMemo<LayoutContextValue>(
    () => ({
      membersVisible,
      toggleMembers,
      channelListWidth,
      setChannelListWidth,
      commitChannelListWidth
    }),
    [membersVisible, toggleMembers, channelListWidth, setChannelListWidth, commitChannelListWidth]
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
