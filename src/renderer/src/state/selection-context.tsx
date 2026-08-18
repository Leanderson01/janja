import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import { mockChannels, mockServers } from '@/data/mock-data'

// Contexto de seleção compartilhado pelo shell (Fase 3). Cobre TUDO que os
// planos 02-04 vão precisar de uma vez, mesmo que só uma parte seja
// consumida agora — isso evita que planos que rodam em paralelo (sem
// depender um do outro) precisem editar este mesmo arquivo e colidam.
//
// Quando F4 substituir os dados mockados por Convex, esta interface
// provavelmente sobrevive: seleção de servidor/canal continua sendo estado
// de UI puro, não dado de domínio.
export type SelectionContextValue = {
  selectedServerId: string
  setSelectedServerId: (id: string) => void
  selectedChannelId: string
  setSelectedChannelId: (id: string) => void
  joinedVoiceChannelId: string | null
  setJoinedVoiceChannelId: (id: string | null) => void
}

const SelectionContext = createContext<SelectionContextValue | undefined>(undefined)

function firstTextChannelId(serverId: string): string {
  const channel = mockChannels.find((c) => c.serverId === serverId && c.type === 'text')
  if (!channel) {
    throw new Error(`Nenhum canal de texto mockado encontrado para o servidor ${serverId}`)
  }
  return channel.id
}

export function SelectionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const initialServerId = mockServers[0].id

  const [selectedServerId, setSelectedServerId] = useState<string>(initialServerId)
  const [selectedChannelId, setSelectedChannelId] = useState<string>(
    firstTextChannelId(initialServerId)
  )
  const [joinedVoiceChannelId, setJoinedVoiceChannelId] = useState<string | null>(null)

  const value = useMemo<SelectionContextValue>(
    () => ({
      selectedServerId,
      setSelectedServerId,
      selectedChannelId,
      setSelectedChannelId,
      joinedVoiceChannelId,
      setJoinedVoiceChannelId
    }),
    [selectedServerId, selectedChannelId, joinedVoiceChannelId]
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
