import { HydraMark } from '@/components/brand/HydraMark'
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { AVATAR_BG, avatarColorIndex } from '@/lib/avatar-color'
import { cn } from '@/lib/utils'

type AvatarSize = 16 | 24 | 32 | 40 | 80

const BOX: Record<AvatarSize, string> = {
  16: 'size-4',
  24: 'size-6',
  32: 'size-8',
  40: 'size-10',
  80: 'size-20'
}

// A estrela ocupa ~55% do avatar.
const MARK: Record<AvatarSize, string> = {
  16: 'size-2',
  24: 'size-3',
  32: 'size-4',
  40: 'size-5',
  80: 'size-11'
}

// Tamanho e borda da bolinha (o AvatarBadge já fixa tamanho por `data-size`, daí o prefixo).
const DOT: Record<AvatarSize, string> = {
  16: 'group-data-[size=default]/avatar:size-2 border-2',
  24: 'group-data-[size=default]/avatar:size-2.5 border-2',
  32: 'group-data-[size=default]/avatar:size-3.5 border-[3px]',
  40: 'group-data-[size=default]/avatar:size-4 border-[3px]',
  80: 'group-data-[size=default]/avatar:size-6 border-[5px]'
}

/**
 * Avatar do Hydra. Sem foto (ou com foto que não carrega) mostra a estrela sobre a cor do id,
 * nunca iniciais nem imagem quebrada. A cor da borda da bolinha vem de `--avatar-ring`, definida
 * pela região pai (`[--avatar-ring:var(--sidebar)]`, etc.).
 */
export function UserAvatar({
  userId,
  avatarUrl,
  name,
  size,
  status,
  className
}: {
  userId: string
  avatarUrl?: string | null
  name: string
  size: AvatarSize
  status?: 'online' | 'offline'
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('group/avatar relative shrink-0', BOX[size], className)} data-size="default">
      <Avatar className="size-full">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
        <AvatarFallback className={cn(AVATAR_BG[avatarColorIndex(userId)], 'text-primary-foreground')}>
          <HydraMark className={MARK[size]} />
        </AvatarFallback>
      </Avatar>
      {status ? (
        <AvatarBadge
          aria-label={status === 'online' ? 'Online' : 'Offline'}
          className={cn(
            'ring-0 border-solid border-[color:var(--avatar-ring,var(--background))]',
            status === 'online' ? 'bg-success' : 'bg-muted-foreground',
            DOT[size]
          )}
        />
      ) : null}
    </div>
  )
}
