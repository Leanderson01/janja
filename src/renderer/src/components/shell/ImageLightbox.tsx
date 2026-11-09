import { ExternalLink } from 'lucide-react'

import {
  Dialog,
  DialogClose,
  DialogOverlay,
  DialogPortal,
  DialogTitle
} from '@/components/ui/dialog'
import { Dialog as DialogPrimitive } from 'radix-ui'

// Imagem em tela cheia (estilo Discord): fundo escuro por cima do chat, a
// imagem até 90% da janela e o link "Abrir original" no navegador do sistema
// (o `setWindowOpenHandler` do main manda `_blank` para `shell.openExternal`).
export function ImageLightbox({
  src,
  name,
  open,
  onOpenChange
}: {
  src: string
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-stage/85" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col items-start gap-2 outline-none"
        >
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <img
            src={src}
            alt={name}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          />
          <div className="flex items-center gap-4 text-sm">
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="text-link inline-flex items-center gap-1 hover:underline"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Abrir original
            </a>
            <DialogClose className="text-muted-foreground hover:text-foreground">
              Fechar
            </DialogClose>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
