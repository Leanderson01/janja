import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { useAction, useMutation } from 'convex/react'
import { ConnectionState, Room, RoomEvent, type DisconnectReason } from 'livekit-client'

import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'

import { useSelection } from './selection-context'

// VOICE-01/03/06/07: ponte real entre a INTENÇÃO de estar num canal de voz
// (`joinedVoiceChannelId`, que já mora em SelectionContext desde a Fase 3) e
// o ciclo de vida do `Room` do LiveKit. Este provider nunca guarda a
// intenção — só observa e comanda os efeitos colaterais: assinar token via
// `joinVoiceChannel`, conectar/desconectar o `Room`, publicar o microfone
// com as opções de captura corretas.
//
// `connectionState` usa exatamente os 5 valores do enum `ConnectionState` do
// `livekit-client` (07-RESEARCH.md §3) — nenhuma nomenclatura própria.
export type VoiceConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'signalReconnecting'

export type VoiceContextValue = {
  room: Room
  connectionState: VoiceConnectionState
}

const VoiceContext = createContext<VoiceContextValue | undefined>(undefined)

export function VoiceProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { joinedVoiceChannelId, setJoinedVoiceChannelId } = useSelection()
  const joinVoiceChannel = useAction(api.voiceToken.joinVoiceChannel)
  const leaveVoiceChannelMutation = useMutation(api.voice.leaveVoiceChannel)

  // Um único `Room` para a vida inteira do provider (= vida do app montado).
  // Não recriamos a instância a cada troca de canal — `room.connect()` /
  // `room.disconnect()` são chamados repetidamente sobre o mesmo objeto,
  // que é o padrão do SDK.
  const roomRef = useRef<Room | null>(null)
  if (roomRef.current === null) {
    roomRef.current = new Room()
  }
  const room = roomRef.current

  const [connectionState, setConnectionState] = useState<VoiceConnectionState>('disconnected')

  // Canal ao qual o `Room` está de fato conectado agora (não a intenção).
  // Usado para: (1) decidir se uma transição de `joinedVoiceChannelId`
  // precisa de leave antes de join, e (2) distinguir um `Disconnected` que
  // nós mesmos causamos (já zeramos esta ref antes de chamar
  // `room.disconnect()`) de um `Disconnected` que o próprio LiveKit iniciou
  // (sala fechada, expulsão, reconexão esgotada) — só o segundo caso deve
  // devolver a intenção para `null`.
  const activeChannelRef = useRef<Id<'channels'> | null>(null)

  // `setJoinedVoiceChannelId` muda de identidade a cada render de
  // SelectionProvider (é recriada via `useMemo`, mas o valor de função em si
  // é estável porque vem de `useState`) — mantemos numa ref só para não
  // precisar listar como dependência de um efeito que só deve rodar por
  // evento do Room, não por re-render do React.
  const setJoinedVoiceChannelIdRef = useRef(setJoinedVoiceChannelId)
  setJoinedVoiceChannelIdRef.current = setJoinedVoiceChannelId

  // Listeners do Room: registrados uma única vez, na vida do `Room`.
  useEffect(() => {
    function handleConnectionStateChanged(state: ConnectionState): void {
      setConnectionState(state as VoiceConnectionState)
    }

    function handleDisconnected(_reason?: DisconnectReason): void {
      // Se `activeChannelRef` já está null, fomos nós que chamamos
      // `room.disconnect()` de propósito (ver `runTransition` abaixo) — a
      // intenção já reflete a realidade, nada a fazer. Se ainda aponta para
      // um canal, o Room caiu sozinho (sala fechada, expulsão, reconexão
      // esgotada) e a UI não pode continuar mostrando "conectado" a um
      // canal do qual o app já caiu.
      if (activeChannelRef.current !== null) {
        activeChannelRef.current = null
        setJoinedVoiceChannelIdRef.current(null)
      }
    }

    room.on(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
    room.on(RoomEvent.Disconnected, handleDisconnected)

    return () => {
      room.off(RoomEvent.ConnectionStateChanged, handleConnectionStateChanged)
      room.off(RoomEvent.Disconnected, handleDisconnected)
      // Higiene de hot-reload/fechamento do app — best-effort, não é o
      // mecanismo principal de saída (isso é o webhook do Plano 07-02).
      void room.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fila serializada de transições: cada mudança de `joinedVoiceChannelId`
  // encadeia um passo na mesma promise, garantindo que um leave anterior
  // sempre termine antes do próximo join começar — mesmo que o usuário troque
  // de canal de voz rapidamente (channelA -> channelB sem passar por null).
  const transitionChainRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const target = joinedVoiceChannelId

    transitionChainRef.current = transitionChainRef.current
      .catch(() => {
        // Um passo anterior já logou seu próprio erro; só garante que a
        // cadeia não trava para sempre por causa de uma rejeição antiga.
      })
      .then(async () => {
        if (activeChannelRef.current === target) return

        if (activeChannelRef.current !== null) {
          activeChannelRef.current = null
          try {
            await leaveVoiceChannelMutation({})
          } catch (err) {
            console.error('[voice] leaveVoiceChannel falhou', err)
          }
          try {
            await room.disconnect()
          } catch (err) {
            console.error('[voice] room.disconnect falhou', err)
          }
        }

        if (target !== null) {
          try {
            const { token, url } = await joinVoiceChannel({ channelId: target })
            await room.connect(url, token)
            // VOICE-16: cancelamento de eco, supressão de ruído e ganho
            // automático nunca vêm ligados por padrão — precisam ser
            // setados explicitamente aqui, sempre.
            await room.localParticipant.setMicrophoneEnabled(true, {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            })
            activeChannelRef.current = target
          } catch (err) {
            console.error('[voice] falha ao entrar no canal de voz', err)
            // A intenção não pôde ser cumprida — devolve a UI para o estado
            // real (não conectado) em vez de ficar presa "tentando".
            setJoinedVoiceChannelIdRef.current(null)
          }
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinedVoiceChannelId])

  const value: VoiceContextValue = { room, connectionState }

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

export function useVoice(): VoiceContextValue {
  const context = useContext(VoiceContext)
  if (!context) {
    throw new Error('useVoice deve ser usado dentro de um VoiceProvider')
  }
  return context
}
