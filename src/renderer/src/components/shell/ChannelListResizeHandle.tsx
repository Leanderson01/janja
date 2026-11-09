import { useRef } from 'react'

import { CHANNEL_LIST_MAX, CHANNEL_LIST_MIN } from '@/lib/layout-preferences'

const KEY_STEP = 8

/**
 * Alça de redimensionar a lista de canais, colada na borda direita dela. Quem a
 * usa limita o valor (`clampChannelListWidth`); aqui só se calcula o pedido.
 */
export function ChannelListResizeHandle({
  width,
  onResize,
  onResizeEnd
}: {
  width: number
  onResize: (px: number) => void
  // Uma vez só: ao soltar o ponteiro, cancelar o arrasto ou após uma tecla.
  onResizeEnd?: () => void
}): React.JSX.Element {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Largura da lista de canais"
      aria-valuemin={CHANNEL_LIST_MIN}
      aria-valuemax={CHANNEL_LIST_MAX}
      aria-valuenow={width}
      tabIndex={0}
      className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { startX: event.clientX, startWidth: width }
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        onResize(drag.current.startWidth + event.clientX - drag.current.startX)
      }}
      onPointerUp={(event) => {
        const wasDragging = drag.current !== null
        drag.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
        if (wasDragging) onResizeEnd?.()
      }}
      onPointerCancel={() => {
        if (drag.current) onResizeEnd?.()
        drag.current = null
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          onResize(width + KEY_STEP)
          onResizeEnd?.()
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onResize(width - KEY_STEP)
          onResizeEnd?.()
        }
      }}
    />
  )
}
