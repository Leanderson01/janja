import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from 'convex/react'

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
  servers: Doc<'servers'>[] | undefined // undefined = ainda carregando
  selectedServerId: Id<'servers'> | null // null = nenhum servidor (lista vazia)
  setSelectedServerId: (id: Id<'servers'>) => void
  selectedChannelId: Id<'channels'> | null
  setSelectedChannelId: (id: Id<'channels'>) => void
  joinedVoiceChannelId: Id<'channels'> | null
  setJoinedVoiceChannelId: (id: Id<'channels'> | null) => void
}

const SelectionContext = createContext<SelectionContextValue | undefined>(undefined)

export function SelectionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [manualServerId, setManualServerId] = useState<Id<'servers'> | null>(null)
  const [manualChannelId, setManualChannelId] = useState<Id<'channels'> | null>(null)
  const [joinedVoiceChannelId, setJoinedVoiceChannelId] = useState<Id<'channels'> | null>(null)

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

  const value = useMemo<SelectionContextValue>(
    () => ({
      servers,
      selectedServerId,
      setSelectedServerId: (id) => {
        setManualServerId(id)
        setManualChannelId(null) // força reseleção do 1º canal de texto do novo servidor
      },
      selectedChannelId,
      setSelectedChannelId: setManualChannelId,
      joinedVoiceChannelId,
      setJoinedVoiceChannelId
    }),
    [servers, selectedServerId, selectedChannelId, joinedVoiceChannelId]
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
