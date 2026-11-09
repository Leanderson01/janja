import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from 'convex/react'

import {
  EMPTY_HISTORY,
  navBack,
  navForward,
  navPush,
  type NavEntry,
  type NavHistory
} from '@/lib/nav-history'
import { api } from '../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../convex/_generated/dataModel'

// Contexto de seleção compartilhado pelo shell. Na Fase 3 derivava de
// mock-data.ts; a partir da Fase 4 (plano 04-05) deriva de dado real do
// Convex (`listMyServers`/`listChannels`). A seleção em si continua sendo
// estado de UI puro — só a fonte que alimenta "o que existe para escolher"
// mudou.
//
// Estado DERIVADO, sem useEffect: o servidor/canal "selecionado de fato" é
// sempre recalculado a partir de "o que o usuário clicou por último"
// (manualServerId/manualChannelId) + "o que existe agora" (servers/channels),
// nunca sincronizado por efeito colateral copiando resultado de query para
// useState.
export type SelectionContextValue = {
  view: 'server' | 'home'
  servers: Doc<'servers'>[] | undefined // undefined = ainda carregando
  selectedServerId: Id<'servers'> | null // null = nenhum servidor (lista vazia)
  setSelectedServerId: (id: Id<'servers'>) => void
  selectedChannelId: Id<'channels'> | null
  setSelectedChannelId: (id: Id<'channels'>) => void
  joinedVoiceChannelId: Id<'channels'> | null
  setJoinedVoiceChannelId: (id: Id<'channels'> | null) => void
  // Palco da call (Plano 08.5-03): o usuário está olhando a call em que está,
  // e não o canal selecionado. Estado de SESSÃO, nunca persistido — ao reabrir
  // o app não existe call ativa, então o valor inicial correto é sempre false.
  viewingStage: boolean
  showStage: () => void
  goHome: () => void
  selectedDmChannelId: Id<'dmChannels'> | null
  setSelectedDmChannelId: (id: Id<'dmChannels'> | null) => void
  // Histórico de navegação (Voltar/Avançar da barra de título). Só gestos de
  // navegação entram nele; entrar/sair de call e alternar o palco não.
  canGoBack: boolean
  canGoForward: boolean
  goBack: () => void
  goForward: () => void
}

const SelectionContext = createContext<SelectionContextValue | undefined>(undefined)

export function SelectionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [view, setView] = useState<'server' | 'home'>('server')
  const [manualServerId, setManualServerIdState] = useState<Id<'servers'> | null>(null)
  const [manualChannelId, setManualChannelId] = useState<Id<'channels'> | null>(null)
  const [joinedVoiceChannelId, setJoinedVoiceChannelIdState] = useState<Id<'channels'> | null>(null)
  const [viewingStage, setViewingStage] = useState(false)
  const [selectedDmChannelId, setSelectedDmChannelIdState] = useState<Id<'dmChannels'> | null>(null)
  const [history, setHistory] = useState<NavHistory>(EMPTY_HISTORY)

  const servers = useQuery(api.servers.listMyServers)

  // Servidor "efetivo": o que o usuário escolheu manualmente, SE ainda existir na lista
  // atual; senão o primeiro da lista; senão null (zero servidores). Nunca precisa de
  // useEffect — recalcula a cada render a partir do dado real mais recente.
  const selectedServerId = useMemo<Id<'servers'> | null>(() => {
    if (!servers) return null
    if (manualServerId && servers.some((s) => s._id === manualServerId)) return manualServerId
    return servers[0]?._id ?? null
  }, [servers, manualServerId])

  const channels = useQuery(
    api.channels.listChannels,
    selectedServerId ? { serverId: selectedServerId } : 'skip'
  )

  const selectedChannelId = useMemo<Id<'channels'> | null>(() => {
    if (!channels) return null
    if (manualChannelId && channels.some((c) => c._id === manualChannelId)) return manualChannelId
    const firstText = channels.find((c) => c.type === 'text')
    return firstText?._id ?? channels[0]?._id ?? null
  }, [channels, manualChannelId])

  // Selecionar qualquer servidor sai do modo Início — mesmo padrão de efeito
  // colateral único já usado para `setSelectedServerId`/`setManualChannelId`
  // acima, não dois setters que o chamador precisa lembrar de coordenar.
  function applyServer(id: Id<'servers'>): void {
    setManualServerIdState(id)
    setManualChannelId(null) // força reseleção do 1º canal de texto do novo servidor
    setView('server')
    // Mesma regra 3 de `selectChannel` abaixo: trocar de servidor é navegar, e
    // navegar é pedir para ver o destino. Sem isto, quem está numa call e clica
    // noutro servidor não veria a tela mudar — o palco continuaria na frente do
    // canal recém-selecionado (Plano 08.5-03).
    setViewingStage(false)
  }

  // Empilha a entrada resultante de um gesto. Na primeira navegação o histórico
  // ainda está vazio, então o estado de ANTES do gesto entra primeiro — senão
  // não haveria para onde voltar.
  function record(entry: NavEntry): void {
    setHistory((h) => {
      const base =
        h.entries.length === 0 && servers !== undefined
          ? navPush(h, {
              view,
              serverId: view === 'server' ? selectedServerId : null,
              channelId: view === 'server' ? selectedChannelId : null,
              dmChannelId: view === 'home' ? selectedDmChannelId : null
            })
          : h
      return navPush(base, entry)
    })
  }

  function selectServer(id: Id<'servers'>): void {
    applyServer(id)
    record({ view: 'server', serverId: id, channelId: null, dmChannelId: null })
  }

  // As três transições de `viewingStage` (Plano 08.5-03) vivem AQUI, dentro do
  // provider, e não em cada chamador: a regra "o que a área principal mostra"
  // é do estado, e espalhá-la pelos componentes garantiria que algum caminho
  // novo esquecesse dela.
  //
  // 1. Entrar numa call põe o palco na frente.
  // 2. Sair da call devolve a área principal para o texto.
  // 3. Navegar para um canal é pedir para ver AQUELE canal, então desliga o
  //    palco. `showStage()` explícito é o único que reverte isso — os dois
  //    caminhos de volta (clicar no canal de voz conectado na sidebar e clicar
  //    em "Conectado a ..." no rodapé) chamam essa função.
  //
  // Ordem importa em `handleVoiceChannelClick` da ChannelSidebar, que chama
  // `selectChannel` e depois `joinVoiceChannel` no mesmo handler: os dois
  // `setViewingStage` são agrupados pelo React e vence o último — `true`, que é
  // o pretendido ao entrar numa call.
  function joinVoiceChannel(id: Id<'channels'> | null): void {
    setJoinedVoiceChannelIdState(id)
    setViewingStage(id !== null)
  }

  function applyChannel(id: Id<'channels'>): void {
    setManualChannelId(id)
    setViewingStage(false)
  }

  function selectChannel(id: Id<'channels'>): void {
    applyChannel(id)
    record({ view: 'server', serverId: selectedServerId, channelId: id, dmChannelId: null })
  }

  function showStage(): void {
    setViewingStage(true)
  }

  // Entrar no Início sempre volta pro painel de amigos, nunca deixa uma DM
  // "grudada" de uma visita anterior.
  function applyHome(dmId: Id<'dmChannels'> | null): void {
    setView('home')
    setSelectedDmChannelIdState(dmId)
  }

  function goHome(): void {
    applyHome(null)
    record({ view: 'home', serverId: null, channelId: null, dmChannelId: null })
  }

  function selectDm(id: Id<'dmChannels'> | null): void {
    setSelectedDmChannelIdState(id)
    record({ view: 'home', serverId: null, channelId: null, dmChannelId: id })
  }

  // Uma entrada some do histórico quando o servidor deixou de existir. O canal
  // só dá para conferir no servidor selecionado (único cujos canais estão
  // carregados); nos outros, canal que sumiu cai no primeiro de texto, pela
  // derivação de `selectedChannelId`. Conversa direta não é conferida aqui.
  function isLive(e: NavEntry): boolean {
    if (e.view === 'home') return true
    if (!servers || !servers.some((s) => s._id === e.serverId)) return false
    if (e.channelId && e.serverId === selectedServerId && channels) {
      return channels.some((c) => c._id === e.channelId)
    }
    return true
  }

  function applyEntry(e: NavEntry): void {
    if (e.view === 'home') {
      applyHome(e.dmChannelId as Id<'dmChannels'> | null)
      return
    }
    applyServer(e.serverId as Id<'servers'>)
    if (e.channelId) applyChannel(e.channelId as Id<'channels'>)
  }

  function step(move: typeof navBack): void {
    let h = history
    for (;;) {
      const r = move(h)
      if (!r) return
      h = r.history
      if (isLive(r.entry)) {
        setHistory(h)
        applyEntry(r.entry)
        return
      }
    }
  }

  const goBack = (): void => step(navBack)
  const goForward = (): void => step(navForward)

  const value = useMemo<SelectionContextValue>(
    () => ({
      view,
      servers,
      selectedServerId,
      setSelectedServerId: selectServer,
      selectedChannelId,
      setSelectedChannelId: selectChannel,
      joinedVoiceChannelId,
      setJoinedVoiceChannelId: joinVoiceChannel,
      viewingStage,
      showStage,
      goHome,
      selectedDmChannelId,
      setSelectedDmChannelId: selectDm,
      canGoBack: history.index > 0,
      canGoForward: history.index < history.entries.length - 1,
      goBack,
      goForward
    }),
    [
      view,
      servers,
      selectedServerId,
      selectedChannelId,
      joinedVoiceChannelId,
      viewingStage,
      selectedDmChannelId,
      channels,
      history
    ]
  )

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection(): SelectionContextValue {
  const context = useContext(SelectionContext)
  if (!context) {
    throw new Error('useSelection deve ser usado dentro de um SelectionProvider')
  }
  return context
}
