import { MicOff } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'

import { UserAvatar } from '@/components/shell/UserAvatar'
import { AVATAR_TILE_BG, avatarColorIndex } from '@/lib/avatar-color'
import { cn } from '@/lib/utils'

// Bloco 16:9 de um participante na grade da call. Parte pura: o menu de áudio
// (`ParticipantAudioMenu`) é decidido por quem monta a grade e envolve este bloco.
// O fundo é a cor do id (translúcida) sobre o `bg-stage` do palco, que é o pai.
export function ParticipantTile({
  userId,
  name,
  avatarUrl,
  muted,
  speaking,
  extras,
  dimmed,
  onContextMenu
}: {
  userId: string
  name: string
  avatarUrl?: string | null
  muted: boolean
  speaking: boolean
  /** Sinais extras ao lado do nome (volume ajustado, qualidade da conexão). */
  extras?: ReactNode
  /** Silenciado para mim: o avatar fica opaco pela metade. */
  dimmed?: boolean
  onContextMenu?(e: MouseEvent): void
}): React.JSX.Element {
  return (
    <div
      data-speaking={speaking}
      onContextMenu={onContextMenu}
      className={cn(
        // Largura limitada pela altura da janela (descontando barra e controles) para
        // que 1 ou 2 blocos 16:9 caibam no palco sem rolagem.
        'relative grid aspect-video w-full max-w-[calc((100dvh-15rem)*16/9)] place-items-center justify-self-center overflow-hidden rounded-lg',
        AVATAR_TILE_BG[avatarColorIndex(userId)],
        speaking && 'outline outline-2 -outline-offset-2 outline-success'
      )}
    >
      <UserAvatar
        userId={userId}
        avatarUrl={avatarUrl}
        name={name}
        size={80}
        className={cn(dimmed && 'opacity-60')}
      />
      <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md bg-stage/60 px-2 py-0.5 text-sm font-semibold text-strong">
        {muted ? (
          <MicOff className="size-3.5 shrink-0 text-destructive" aria-label="Mutado" />
        ) : null}
        <span className="truncate" title={name}>
          {name}
        </span>
        {extras}
      </div>
    </div>
  )
}
