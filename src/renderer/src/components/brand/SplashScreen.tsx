import type { ReactNode } from 'react'
import { HydraMark } from '@/components/brand/HydraMark'
import { WindowDragStrip } from '@/components/brand/WindowDragStrip'

// Tela cheia de espera/erro: a estrela no centro, a mensagem embaixo e ações
// opcionais. Autocontida de propósito — é usada antes de o Convex e a
// autenticação existirem (NotConfiguredScreen) e depois de a árvore cair
// (RootErrorBoundary).
export function SplashScreen({
  message,
  children
}: {
  message: string
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="bg-sidebar relative grid h-screen w-screen place-items-center">
      <WindowDragStrip />
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <HydraMark className="text-strong size-16" />
        <p className="text-muted-foreground text-sm">{message}</p>
        {children}
      </div>
    </div>
  )
}
