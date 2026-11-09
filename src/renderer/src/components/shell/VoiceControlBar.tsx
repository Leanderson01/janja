import { useQuery } from 'convex/react'
import { ConnectionQuality } from 'livekit-client'
import {
  ChevronDown,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Signal
} from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useVoiceJoinLeaveSounds } from '@/lib/voice-sounds'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

import { DeviceMenu } from './DeviceMenu'
import { VoiceSettingsPopover } from './VoiceSettingsPopover'

import { api } from '../../../../../convex/_generated/api'

// Peças de voz do cartão do usuário (`UserArea`): a seção "Voz conectada"
// (só com intenção de call) e os botões de microfone/fone/configurações.
// Antes eram três faixas empilhadas embaixo da lista de canais; agora moram
// dentro do cartão flutuante do Discord, que atravessa o rail e a lista.
// Microfone e fone são controles do APARELHO e existem com ou sem call
// (testador de microfone, VOICE-21).

// A cor do sinal segue a qualidade da PRÓPRIA conexão. `unknown`/ausente conta
// como boa: ainda não há medição, e alarmar sem dado seria pior que silêncio.
function qualityTone(quality: ConnectionQuality | undefined): string {
  if (quality === ConnectionQuality.Lost) return 'text-destructive'
  if (quality === ConnectionQuality.Poor) return 'text-warning'
  return 'text-voice'
}

export function VoiceConnectedSection(): React.JSX.Element | null {
  const { servers, joinedVoiceChannelId, setJoinedVoiceChannelId, showStage } = useSelection()
  const { connectionState, connectionQualities, isSharing, startScreenShare, stopScreenShare } =
    useVoice()
  const me = useQuery(api.users.me, {})

  // Plano 07-07 (VOICE-17): som de entrada/saída. Chamado ANTES de qualquer
  // retorno (regra dos hooks) e montado sempre, pois `UserArea` é montada
  // sempre, nas duas visões.
  useVoiceJoinLeaveSounds()

  // `getChannel` (não `listChannels`): o canal conectado pode ser de outro
  // servidor que o selecionado na sidebar.
  const connectedChannel = useQuery(
    api.channels.getChannel,
    joinedVoiceChannelId ? { channelId: joinedVoiceChannelId } : 'skip'
  )

  const hasIntention = joinedVoiceChannelId !== null
  const isReady = hasIntention && connectionState === 'connected'
  const isReconnecting =
    connectionState === 'reconnecting' || connectionState === 'signalReconnecting'

  // Não é `async`: start/stop nunca rejeitam (erros já viram log dentro delas)
  // e `isSharing` vem do evento de publicação real do `Room`.
  function toggleScreenShare(): void {
    void (isSharing ? stopScreenShare() : startScreenShare())
  }

  if (!hasIntention) return null

  const channelName = connectedChannel?.name
  const serverName = servers?.find((server) => server._id === connectedChannel?.serverId)?.name
  const contextLine = [channelName, serverName].filter(Boolean).join(' / ')

  const statusLabel = isReconnecting ? 'Reconectando…' : isReady ? 'Voz conectada' : 'Conectando…'
  const statusTone = isReady ? 'text-voice' : 'text-warning'
  const signalTone = isReady
    ? qualityTone(me ? connectionQualities.get(me._id) : undefined)
    : 'text-warning'

  const statusLines = (
    <>
      <span className={cn('block w-full truncate text-sm font-semibold', statusTone)}>
        {statusLabel}
      </span>
      <span className="block w-full truncate text-xs text-muted-foreground" title={contextLine}>
        {contextLine}
      </span>
    </>
  )

  return (
    <div className="border-b border-border p-2.5">
      <div className="flex items-center gap-2">
        <span
          className="flex size-8 flex-none items-center justify-center rounded-md bg-voice/15"
          aria-hidden="true"
        >
          <Signal className={cn('size-4', signalTone)} />
        </span>

        {isReady ? (
          // Segundo caminho de volta ao palco (o primeiro é clicar no canal de
          // voz na sidebar): o bloco de status inteiro é o botão.
          <button
            type="button"
            onClick={showStage}
            aria-label="Voltar para a call"
            title="Voltar para a call"
            className="min-w-0 flex-1 rounded-md text-left hover:bg-accent/50"
          >
            {statusLines}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{statusLines}</div>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setJoinedVoiceChannelId(null)}
              aria-label="Desconectar"
            >
              <PhoneOff />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Desconectar</TooltipContent>
        </Tooltip>
      </div>

      <Button
        type="button"
        variant="ghost"
        className="mt-2 h-8 w-full rounded-lg bg-secondary hover:bg-secondary/80"
        disabled={!isReady}
        aria-pressed={isSharing}
        onClick={toggleScreenShare}
      >
        <MonitorUp className={cn(isSharing && 'text-voice')} />
        <span className="truncate">
          {isSharing ? 'Parar de compartilhar' : 'Compartilhar tela'}
        </span>
      </Button>
    </div>
  )
}

// Parte pura dos botões, sem contexto nenhum, para poder ser testada.
// `inputMenu`/`outputMenu` são os `DeviceMenu` (a setinha ao lado de cada botão).
export function VoiceButtonsView({
  muted,
  deafened,
  onToggleMute,
  onToggleDeafen,
  inputMenu,
  outputMenu,
  settings
}: {
  muted: boolean
  deafened: boolean
  onToggleMute(): void
  onToggleDeafen(): void
  inputMenu: ReactNode
  outputMenu: ReactNode
  settings?: ReactNode
}): React.JSX.Element {
  const muteLabel = muted ? 'Ativar microfone' : 'Desativar microfone'
  const deafenLabel = deafened ? 'Desensurdecer' : 'Ensurdecer'

  return (
    <div className="flex flex-none items-center gap-0.5">
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn('h-8 rounded-md', muted && 'bg-destructive/15 hover:bg-destructive/20')}
              aria-label={muteLabel}
              aria-pressed={muted}
              onClick={onToggleMute}
            >
              {muted ? <MicOff className="text-destructive" /> : <Mic />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{muteLabel}</TooltipContent>
        </Tooltip>
        {inputMenu}
      </div>

      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                'h-8 rounded-md',
                deafened && 'bg-destructive/15 hover:bg-destructive/20'
              )}
              aria-label={deafenLabel}
              aria-pressed={deafened}
              onClick={onToggleDeafen}
            >
              {deafened ? <HeadphoneOff className="text-destructive" /> : <Headphones />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{deafenLabel}</TooltipContent>
        </Tooltip>
        {outputMenu}
      </div>

      {settings}
    </div>
  )
}

// Gatilho do `DeviceMenu`. O `DropdownMenuTrigger asChild` (Radix Slot) injeta
// handlers, `aria-*`, `data-state` e a `ref` aqui: tudo precisa ir para o
// `<button>`, senão o menu nunca abre. No React 19 `ref` é uma prop comum.
export function DeviceChevron({
  label,
  ...props
}: { label: string } & React.ComponentProps<'button'>): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex h-8 w-4 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-strong"
      {...props}
    >
      <ChevronDown className="size-3" />
    </button>
  )
}

// Os botões ligados ao contexto de voz. `muted`/`deafened` moram em
// `voice-context.tsx` (salvos em `localStorage`) e funcionam FORA da call:
// mutar antes de entrar faz a pessoa entrar mutada. Por isso nunca ficam
// desabilitados.
export function SelfVoiceButtons(): React.JSX.Element {
  const { joinedVoiceChannelId } = useSelection()
  const { connectionState, muted, deafened, toggleMuted, toggleDeafened } = useVoice()

  const hasIntention = joinedVoiceChannelId !== null
  const isReady = hasIntention && connectionState === 'connected'

  return (
    <VoiceButtonsView
      muted={muted}
      deafened={deafened}
      onToggleMute={() => void toggleMuted()}
      onToggleDeafen={() => void toggleDeafened()}
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
      // Sempre renderizado: o testador de microfone (VOICE-21) precisa ser
      // alcançável sem canal conectado.
      settings={
        <VoiceSettingsPopover
          disabled={hasIntention && !isReady}
          hasVoiceIntention={hasIntention}
        />
      }
    />
  )
}
