import { useState } from 'react'
import { useQuery } from 'convex/react'
import { Headphones, Mic, MicOff, PhoneOff, VolumeX } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSelection } from '@/state/selection-context'

import { api } from '../../../../../convex/_generated/api'

// Rodapé fixo de controles de voz (Plano 03-02). `muted`/`deafened` são
// puramente cosméticos nesta fase — não entram no SelectionContext porque
// nenhum outro componente do shell precisa reagir a eles ainda (F7 troca
// isto por estado real de LiveKit). O estado de conexão (`joinedVoiceChannelId`)
// vem do contexto compartilhado, já que ChannelSidebar (mesmo plano) também
// precisa dele para refletir join/leave.
export function VoiceControlBar(): React.JSX.Element {
  const { joinedVoiceChannelId, setJoinedVoiceChannelId } = useSelection()

  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)

  // `getChannel` (não `listChannels`) é deliberado: o canal de voz conectado
  // pode pertencer a um servidor diferente do que está selecionado agora na
  // sidebar (o usuário pode navegar para outro servidor sem sair da voz),
  // então a busca não pode depender de `selectedServerId`.
  const connectedChannel = useQuery(
    api.channels.getChannel,
    joinedVoiceChannelId ? { channelId: joinedVoiceChannelId } : 'skip'
  )

  const isConnected = joinedVoiceChannelId !== null && connectedChannel != null

  function toggleMuted(): void {
    setMuted((prev) => {
      const next = !prev
      // Desativar mute enquanto ensurdecido também desativa o ensurdecimento
      // — evita o estado "falando no vácuo" (design §8).
      if (!next && deafened) {
        setDeafened(false)
      }
      return next
    })
  }

  function toggleDeafened(): void {
    setDeafened((prev) => {
      const next = !prev
      // Ativar deafen implica mute (design §8: "deafen implica mute").
      if (next) {
        setMuted(true)
      }
      return next
    })
  }

  function leaveVoiceChannel(): void {
    setJoinedVoiceChannelId(null)
  }

  return (
    <div className="flex-none h-14 border-t border-border bg-secondary px-2 flex items-center gap-2">
      <div className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
        {isConnected && connectedChannel ? (
          <span className="text-foreground font-medium">Conectado a {connectedChannel.name}</span>
        ) : (
          <span>Não conectado a nenhum canal de voz</span>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!isConnected}
            aria-pressed={muted}
            onClick={toggleMuted}
          >
            {muted ? <MicOff className="text-destructive" /> : <Mic />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{muted ? 'Ativar microfone' : 'Silenciar microfone'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!isConnected}
            aria-pressed={deafened}
            onClick={toggleDeafened}
          >
            {deafened ? <VolumeX className="text-destructive" /> : <Headphones />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{deafened ? 'Desativar surdina' : 'Ensurdecer'}</TooltipContent>
      </Tooltip>

      {isConnected && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={leaveVoiceChannel}
              aria-label="Sair do canal de voz"
            >
              <PhoneOff className="text-destructive" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Desconectar</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
