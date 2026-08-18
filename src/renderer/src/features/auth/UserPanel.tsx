import { LogOut } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/hooks/useAuth'

function initials(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/**
 * Painel do usuário no rodapé da sidebar: identidade visível e saída da conta.
 *
 * Existe para satisfazer AUTH-05 ("usuário consegue sair da conta pelo app").
 * O plano 02-08 entregou a fase sem nenhuma chamada a `signOut` na interface,
 * o que tornava o requisito alcançável apenas pelo console do DevTools — ou
 * seja, não cumprido.
 *
 * O `USER#123` não aparece aqui porque `username`/`tag` vivem no Convex, não no
 * perfil do WorkOS. A Fase 6 expõe esse identificador no painel de amigos, que
 * é onde ele tem uso.
 */
export function UserPanel(): React.JSX.Element | null {
  const { user, signOut } = useAuth()

  if (!user) return null

  const displayName = user.firstName ?? user.email

  return (
    <div className="flex items-center gap-2 border-t px-2 py-2">
      <Avatar size="sm">
        {user.profilePictureUrl && <AvatarImage src={user.profilePictureUrl} alt={displayName} />}
        <AvatarFallback>{initials(displayName)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-medium">{displayName}</div>
        <div className="text-muted-foreground truncate text-xs" title={user.email}>
          {user.email}
        </div>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sair da conta"
            onClick={() => void signOut()}
          >
            <LogOut />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Sair da conta</TooltipContent>
      </Tooltip>
    </div>
  )
}
