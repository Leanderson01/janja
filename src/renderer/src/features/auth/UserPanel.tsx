import { useState } from 'react'
import { Copy, LogOut } from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
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
 * Painel do usuário no rodapé da sidebar: identidade visível e menu da conta.
 *
 * Existe para satisfazer AUTH-05 ("usuário consegue sair da conta pelo app").
 * O plano 02-08 entregou a fase sem nenhuma chamada a `signOut` na interface,
 * o que tornava o requisito alcançável apenas pelo console do DevTools — ou
 * seja, não cumprido.
 *
 * Plano 08.5-09: a linha inteira virou o gatilho de um `DropdownMenu` e o botão
 * solto de sair saiu do rodapé para dentro do menu. Duas razões, nesta ordem:
 * a coluna era fixa em 240px e o botão consumia largura de um nome e um e-mail
 * que já precisam de `truncate`; e o brief da fase pede um padrão único de menu
 * (servidor, canal, membro, usuário).
 *
 * Correção pós-Windows: este painel deixou de ser o rodapé da coluna de canais
 * e passou a ser a célula esquerda de uma faixa que atravessa o rail de
 * servidores (344px em vez de 240px), montada pelo `AppShell`. O componente não
 * sabe mais desenhar a própria moldura — só a identidade. **AUTH-05 continua alcançável** — só
 * mudou de lugar, e agora também por teclado (Tab até a linha, Enter abre,
 * setas navegam) e por botão direito, mesmo padrão do menu de membro
 * (`MemberList.tsx`, Plano 08.5-04).
 *
 * O `USER#123` NÃO está neste menu de propósito: `username`/`tag` vivem no
 * Convex (não no perfil do WorkOS) e quem os resolve é `useMyIdentifier`, que
 * mora dentro de `FriendsPanel.tsx` — outro plano desta mesma onda. O
 * identificador continua copiável no painel de amigos, que é onde ele tem uso.
 */
export function UserPanel(): React.JSX.Element | null {
  const { user, signOut } = useAuth()
  // Menu controlado (não é o padrão `defaultOpen` do Radix) porque o botão
  // direito precisa abrir o MESMO menu: um menu só, alcançável por teclado.
  const [open, setOpen] = useState(false)

  if (!user) return null

  const displayName = user.firstName ?? user.email
  const email = user.email

  async function handleCopyEmail(): Promise<void> {
    try {
      await navigator.clipboard.writeText(email)
      toast.success('E-mail copiado')
    } catch {
      toast.error('Não foi possível copiar o e-mail')
    }
  }

  return (
    // Uma CÉLULA da faixa do usuário, não a faixa inteira: a borda superior, o
    // padding e a vizinhança com os controles rápidos de voz são do container
    // no `AppShell`, que atravessa o rail de servidores. `min-w-0 flex-1` é o
    // que faz o nome truncar em vez de empurrar os botões para fora.
    <div className="min-w-0 flex-1">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Conta de ${displayName}`}
            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-accent/50"
            onContextMenu={(event) => {
              event.preventDefault()
              setOpen(true)
            }}
          >
            <Avatar size="sm">
              {user.profilePictureUrl && (
                <AvatarImage src={user.profilePictureUrl} alt={displayName} />
              )}
              <AvatarFallback>{initials(displayName)}</AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">{displayName}</div>
              <div className="text-muted-foreground truncate text-xs" title={email}>
                {email}
              </div>
            </div>
          </button>
        </DropdownMenuTrigger>

        {/* `side="top"`: esta linha é a última coisa da janela, e um menu para
            baixo sairia da tela. O Radix já reposicionaria sozinho, mas dizer a
            direção evita o menu "pular" no primeiro frame. Confirmação visual
            só em Windows (Plano 08.5-17) — jsdom não calcula posição. */}
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuItem onSelect={() => void handleCopyEmail()}>
            <Copy />
            Copiar e-mail
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
            <LogOut />
            Sair da conta
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
