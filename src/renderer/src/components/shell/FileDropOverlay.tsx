import { Upload } from 'lucide-react'

/** Camada que cobre a conversa enquanto se arrasta um arquivo por cima dela. */
export function FileDropOverlay({
  channelName,
  active
}: {
  channelName: string
  active: boolean
}): React.JSX.Element | null {
  if (!active) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-stage/70">
      <div className="flex flex-col items-center gap-2 rounded-lg bg-popover px-8 py-6 text-popover-foreground shadow-lg">
        <Upload className="size-8 text-primary" aria-hidden="true" />
        <span className="text-lg font-bold">Enviar para #{channelName}</span>
      </div>
    </div>
  )
}
