import { Headphones, HeadphoneOff, Maximize, Mic, MicOff, MonitorUp, PhoneOff } from 'lucide-react'
import type { ReactNode } from 'react'

import { DeviceMenu } from '@/components/shell/DeviceMenu'
import { DeviceChevron } from '@/components/shell/VoiceControlBar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shouldShowCallControls } from '@/lib/call-grid'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

const BUTTON =
  'inline-flex h-11 min-w-[52px] items-center justify-center rounded-xl bg-panel text-strong outline-none transition-colors hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5'

function ControlButton({
  label,
  pressed,
  disabled,
  className,
  onClick,
  children
}: {
  label: string
  pressed?: boolean
  disabled?: boolean
  className?: string
  onClick(): void
  children: ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className={cn(BUTTON, className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// Barra de controles da call, parte pura. Escondida (ociosa) ela continua no DOM
// mas inerte: `pointer-events-none` e transparente; foco por teclado a revela.
export function CallControlsView({
  visible,
  isSharing,
  canShare,
  muted,
  deafened,
  onToggleShare,
  onToggleMute,
  onToggleDeafen,
  onLeave,
  onFullscreen,
  inputMenu,
  outputMenu
}: {
  visible: boolean
  isSharing: boolean
  canShare: boolean
  muted: boolean
  deafened: boolean
  onToggleShare(): void
  onToggleMute(): void
  onToggleDeafen(): void
  onLeave(): void
  onFullscreen(): void
  inputMenu: ReactNode
  outputMenu: ReactNode
}): React.JSX.Element {
  const muteLabel = muted ? 'Ativar microfone' : 'Desativar microfone'
  const deafenLabel = deafened ? 'Desensurdecer' : 'Ensurdecer'
  const shareLabel = isSharing ? 'Parar de compartilhar' : 'Compartilhar tela'
  const interactive = visible ? 'pointer-events-auto' : 'pointer-events-none'

  return (
    <div
      data-visible={visible}
      className={cn(
        'group pointer-events-none absolute inset-x-0 bottom-6 flex justify-center transition-opacity focus-within:opacity-100',
        !visible && 'opacity-0'
      )}
    >
      <div className={cn('flex gap-2', interactive)}>
        <ControlButton
          label={shareLabel}
          pressed={isSharing}
          disabled={!canShare}
          onClick={onToggleShare}
        >
          <MonitorUp className={cn(isSharing && 'text-voice')} />
        </ControlButton>

        <div className="flex items-center gap-0.5">
          <ControlButton label={muteLabel} pressed={muted} onClick={onToggleMute}>
            {muted ? <MicOff className="text-destructive" /> : <Mic />}
          </ControlButton>
          {inputMenu}
        </div>

        <div className="flex items-center gap-0.5">
          <ControlButton label={deafenLabel} pressed={deafened} onClick={onToggleDeafen}>
            {deafened ? <HeadphoneOff className="text-destructive" /> : <Headphones />}
          </ControlButton>
          {outputMenu}
        </div>

        <div className="my-2 w-px bg-border" role="separator" aria-orientation="vertical" />

        <ControlButton
          label="Sair da call"
          onClick={onLeave}
          className="bg-destructive hover:bg-destructive/90"
        >
          <PhoneOff className="text-primary-foreground" />
        </ControlButton>
      </div>

      <div className={cn('absolute bottom-0 right-6', interactive)}>
        <ControlButton label="Tela cheia" onClick={onFullscreen}>
          <Maximize />
        </ControlButton>
      </div>
    </div>
  )
}

// Ligada ao contexto: mic/fone/compartilhar vêm de `useVoice()`, sair é
// `setJoinedVoiceChannelId(null)` (o mesmo do botão Desconectar do cartão).
export function CallControls({
  channelId,
  visible,
  onFullscreen
}: {
  channelId: string
  visible: boolean
  onFullscreen(): void
}): React.JSX.Element | null {
  const { joinedVoiceChannelId, setJoinedVoiceChannelId } = useSelection()
  const {
    connectionState,
    muted,
    deafened,
    toggleMuted,
    toggleDeafened,
    isSharing,
    startScreenShare,
    stopScreenShare
  } = useVoice()

  if (!shouldShowCallControls({ channelId, joinedVoiceChannelId })) return null

  return (
    <CallControlsView
      visible={visible}
      isSharing={isSharing}
      canShare={connectionState === 'connected'} // conectado AQUI: o gate acima garante o canal
      muted={muted}
      deafened={deafened}
      onToggleShare={() => void (isSharing ? stopScreenShare() : startScreenShare())}
      onToggleMute={() => void toggleMuted()}
      onToggleDeafen={() => void toggleDeafened()}
      onLeave={() => setJoinedVoiceChannelId(null)}
      onFullscreen={onFullscreen}
      inputMenu={
        <DeviceMenu kind="audioinput">
          <DeviceChevron label="Dispositivo de entrada" />
        </DeviceMenu>
      }
      outputMenu={
        <DeviceMenu kind="audiooutput">
          <DeviceChevron label="Dispositivo de saída" />
        </DeviceMenu>
      }
    />
  )
}
