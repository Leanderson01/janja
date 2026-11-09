import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

/** Separador de data entre dias: linha com o rótulo no meio. */
export function DaySeparator({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="mx-4 mt-4 flex items-center gap-2" role="separator" aria-label={label}>
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

// Divisor "novas mensagens" (CHAT-05): linha vermelha com a etiqueta NOVAS à direita, antes da
// primeira não lida. `data-unread-divider="true"` é gancho da lógica de scroll inicial
// (CHAT-14, MessageList): não remover nem renomear.
export function UnreadDivider(): React.JSX.Element {
  return (
    <div
      className="relative mx-4 mt-4 flex items-center"
      role="separator"
      aria-label="Novas mensagens"
      data-unread-divider="true"
    >
      <div className="h-px flex-1 border-t border-destructive" />
      <span className="-my-1 rounded bg-destructive px-1.5 text-[10px] font-bold text-primary-foreground">
        NOVAS
      </span>
    </div>
  )
}

/** Começo do histórico do canal. */
export function ChannelWelcome({
  title,
  subtitle,
  icon
}: {
  title: string
  subtitle: string
  icon: ReactNode
}): React.JSX.Element {
  return (
    <div className="px-4 pb-4 pt-8">
      <div className="mb-2 flex size-[68px] items-center justify-center rounded-full bg-secondary text-strong">
        {icon}
      </div>
      <h1 className="break-words text-[32px] font-bold leading-10 text-strong">{title}</h1>
      <p className="break-words text-muted-foreground">{subtitle}</p>
    </div>
  )
}

/** Faixa colada acima da caixa de texto quando a pessoa está lendo mensagens antigas. */
export function JumpToPresentBar({ onJump }: { onJump(): void }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-t-lg bg-primary px-4 py-1 text-sm text-primary-foreground">
      <span>Você está vendo mensagens antigas</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 font-semibold hover:bg-transparent hover:underline"
        onClick={onJump}
      >
        Ir para o presente
      </Button>
    </div>
  )
}
