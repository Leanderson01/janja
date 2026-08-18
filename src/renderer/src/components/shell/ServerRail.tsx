import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { mockServers, type Server } from '@/data/mock-data'
import { useSelection } from '@/state/selection-context'

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/)
  const initials = words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
  return initials.toUpperCase()
}

function ServerIcon({ server }: { server: Server }): React.JSX.Element {
  const { selectedServerId, setSelectedServerId } = useSelection()
  const isActive = server.id === selectedServerId

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative flex items-center justify-center py-1">
          {/* Indicador de servidor ativo: barra vertical à esquerda do avatar */}
          <span
            className={
              'absolute left-0 h-2 w-1 rounded-r-full bg-foreground transition-all ' +
              (isActive ? 'h-8 opacity-100' : 'h-2 opacity-0')
            }
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => setSelectedServerId(server.id)}
            aria-label={server.name}
            aria-current={isActive ? 'true' : undefined}
            className={
              'flex items-center justify-center rounded-full transition-all ' +
              (isActive ? 'ring-2 ring-foreground' : '')
            }
          >
            <Avatar size="lg">
              {server.iconUrl ? <AvatarImage src={server.iconUrl} alt={server.name} /> : null}
              <AvatarFallback>{initialsFor(server.name)}</AvatarFallback>
            </Avatar>
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">{server.name}</TooltipContent>
    </Tooltip>
  )
}

export function ServerRail(): React.JSX.Element {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col items-center gap-2 py-3">
        {mockServers.map((server) => (
          <ServerIcon key={server.id} server={server} />
        ))}
      </div>
    </ScrollArea>
  )
}
