import { MicOff } from 'lucide-react'
import type { MouseEvent, ReactNode, Ref } from 'react'

import { UserAvatar } from '@/components/shell/UserAvatar'
import { AVATAR_TILE_BG, avatarColorIndex } from '@/lib/avatar-color'
import { cn } from '@/lib/utils'

// Bloco 16:9 de um participante na grade da call. Parte pura: o menu de áudio
// (`ParticipantAudioMenu`) é decidido por quem monta a grade e envolve este bloco.
// O fundo é a cor do id (translúcida) sobre o `bg-stage` do palco, que é o pai.
//
// `live` (Tarefa 13): a pessoa está transmitindo a tela. O bloco ganha a etiqueta
// AO VIVO e vira um botão que cobre o bloco inteiro — "Assistir transmissão"
// enquanto não assisto, "Ver transmissão" (volta o palco para a tela) quando já
// assisto, como clicar no bloco de uma transmissão no Discord. O clique direito
// continua chegando a `onContextMenu`, que fica no elemento raiz: o evento sobe
// do botão. Por ter um botão DENTRO, quem monta um bloco ao vivo não pode
// envolvê-lo noutro `<button>` (ver `GridTile` em `CallStage.tsx`).
export function ParticipantTile({
  userId,
  name,
  avatarUrl,
  muted,
  speaking,
  extras,
  dimmed,
  live,
  liveButtonRef,
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
  /** Transmitindo a tela (só para OUTRA pessoa, no canal em que estou). */
  live?: { watching: boolean; onWatch(): void }
  /** O botão do bloco ao vivo: o menu de áudio devolve o foco a ele ao fechar. */
  liveButtonRef?: Ref<HTMLButtonElement>
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
      {live ? (
        <>
          <span className="pointer-events-none absolute left-2 top-2 rounded bg-destructive px-1.5 text-[10px] font-bold text-primary-foreground">
            AO VIVO
          </span>
          <button
            ref={liveButtonRef}
            type="button"
            onClick={live.onWatch}
            className="group absolute inset-0 grid place-items-center rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {live.watching ? (
              <span className="rounded-full bg-stage/80 px-4 py-2 text-sm font-semibold text-strong opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                Ver transmissão
              </span>
            ) : (
              <span className="rounded-full bg-stage/80 px-4 py-2 text-sm font-semibold text-strong transition-colors group-hover:bg-stage">
                Assistir transmissão
              </span>
            )}
          </button>
        </>
      ) : null}
    </div>
  )
}
