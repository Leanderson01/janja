import { useState } from 'react'
import { Home, Plus } from 'lucide-react'

import { CreateOrJoinServerDialog } from '@/components/shell/CreateOrJoinServerDialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSelection } from '@/state/selection-context'

import type { Doc } from '../../../../../convex/_generated/dataModel'

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/)
  const initials = words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
  return initials.toUpperCase()
}

// Botão fixo "Início" (Fase 6): leva à visão de amigos, fora do fluxo de
// servidores. Mesmo padrão visual de `ServerIcon` (indicador de barra
// vertical + tooltip lateral), sem imagem — Avatar/AvatarFallback com o
// ícone `Home` dentro em vez de iniciais.
function HomeButton(): React.JSX.Element {
  const { view, goHome } = useSelection()
  const isActive = view === 'home'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative flex items-center justify-center py-1">
          <span
            className={
              'absolute left-0 h-2 w-1 rounded-r-full bg-foreground transition-all ' +
              (isActive ? 'h-8 opacity-100' : 'h-2 opacity-0')
            }
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => goHome()}
            aria-label="Início"
            aria-current={isActive ? 'true' : undefined}
            className={
              'flex items-center justify-center rounded-full transition-all ' +
              (isActive ? 'ring-2 ring-foreground' : '')
            }
          >
            <Avatar size="lg">
              <AvatarFallback>
                <Home className="size-4" />
              </AvatarFallback>
            </Avatar>
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">Início</TooltipContent>
    </Tooltip>
  )
}

function ServerIcon({ server }: { server: Doc<'servers'> }): React.JSX.Element {
  const { selectedServerId, setSelectedServerId } = useSelection()
  const isActive = server._id === selectedServerId

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
            onClick={() => setSelectedServerId(server._id)}
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

function AddServerButton(): React.JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon-lg"
            className="rounded-full"
            aria-label="Criar ou entrar num servidor"
            onClick={() => setDialogOpen(true)}
          >
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Adicionar servidor</TooltipContent>
      </Tooltip>
      <CreateOrJoinServerDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}

export function ServerRail(): React.JSX.Element {
  const { servers } = useSelection()

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col items-center gap-2 py-3">
        <HomeButton />
        <Separator className="w-8" />
        {/* servers === undefined enquanto a subscription inicial não resolve — não
            travamos em spinner, só não desenhamos ícone nenhum até chegar dado real
            (ou lista vazia, que também não desenha ícone nenhum). */}
        {servers?.map((server) => (
          <ServerIcon key={server._id} server={server} />
        ))}
        <AddServerButton />
      </div>
    </ScrollArea>
  )
}
