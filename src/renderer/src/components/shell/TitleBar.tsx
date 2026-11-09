import { useQuery } from 'convex/react'
import { ArrowLeft, ArrowRight } from 'lucide-react'

import { HydraMark } from '@/components/brand/HydraMark'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { displayNameOf } from '@/lib/display-name'
import { cn } from '@/lib/utils'
import { useSelection } from '@/state/selection-context'
import { capabilities } from '@platform/capabilities'

import { api } from '../../../../../convex/_generated/api'

type NavButtonProps = {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}

function NavButton({ label, disabled, onClick, children }: NavButtonProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'flex size-7 items-center justify-center rounded-md text-icon [app-region:no-drag]',
            'hover:bg-accent hover:text-strong disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-icon'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export type TitleBarViewProps = {
  title: string
  iconUrl?: string | null
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  reserveWindowControls: boolean
}

// Parte visual da barra de título. Pura: sem Convex nem contextos, para testar.
// A barra inteira arrasta a janela; só os botões são `no-drag`.
export function TitleBarView({
  title,
  iconUrl,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  reserveWindowControls
}: TitleBarViewProps): React.JSX.Element {
  return (
    <div className="relative flex h-8 flex-none items-center bg-sidebar px-2 [app-region:drag]">
      <div className="flex items-center gap-1">
        <NavButton label="Voltar" disabled={!canGoBack} onClick={onBack}>
          <ArrowLeft size={18} />
        </NavButton>
        <NavButton label="Avançar" disabled={!canGoForward} onClick={onForward}>
          <ArrowRight size={18} />
        </NavButton>
      </div>

      {/* Título no centro absoluto da barra, independente dos lados. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-8 items-center justify-center">
        <div className="flex max-w-[50%] items-center gap-1.5">
          {iconUrl ? (
            <img src={iconUrl} alt="" className="size-4 flex-none rounded-full object-cover" />
          ) : (
            <HydraMark className="size-4 flex-none text-icon" />
          )}
          <span className="truncate text-[13px] font-semibold text-strong" title={title}>
            {title}
          </span>
        </div>
      </div>

      {reserveWindowControls ? (
        <div data-window-controls-reserve className="ml-auto w-[138px] flex-none" />
      ) : null}
    </div>
  )
}

// Contêiner: o título vem da seleção. Servidor -> nome dele; Início sem DM ->
// "Amigos"; Início com DM -> nome de quem está do outro lado.
export function TitleBar(): React.JSX.Element {
  const {
    view,
    servers,
    selectedServerId,
    selectedDmChannelId,
    canGoBack,
    canGoForward,
    goBack,
    goForward
  } = useSelection()
  const dmChannels = useQuery(api.dms.listMyDmChannels)

  let title = 'Hydra'
  let iconUrl: string | null = null
  if (view === 'server') {
    const server = servers?.find((s) => s._id === selectedServerId)
    if (server) {
      title = server.name
      iconUrl = server.iconUrl ?? null
    }
  } else if (selectedDmChannelId === null) {
    title = 'Amigos'
  } else {
    const dm = dmChannels?.find((d) => d.dmChannelId === selectedDmChannelId)
    if (dm) title = dm.otherUser ? displayNameOf(dm.otherUser) : 'Usuário desconhecido'
  }

  return (
    <TitleBarView
      title={title}
      iconUrl={iconUrl}
      canGoBack={canGoBack}
      canGoForward={canGoForward}
      onBack={goBack}
      onForward={goForward}
      reserveWindowControls={capabilities.nativeWindowControls}
    />
  )
}
