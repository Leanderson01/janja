import { Send } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type MessageInputProps = {
  onSend: (content: string) => void
  // Opcional de propósito (CHAT-07, plano 05-05): quem fornece a função decide
  // throttle e o que ela faz por trás (ex: chamar convex/typing.ts). Este
  // componente não sabe nada de Convex — se a Fase 6 (DM) nunca passar essa
  // prop, o comportamento continua idêntico ao de antes deste plano.
  onTyping?: () => void
}

// Campo de envio de mensagem — eco puramente local (RESEARCH.md, F3 sem
// backend): captura texto, chama `onSend`, limpa o campo. Não valida nem
// persiste nada; quem guarda o histórico da mensagem enviada é o componente
// pai (ConversationArea).
export function MessageInput({ onSend, onTyping }: MessageInputProps): React.JSX.Element {
  const [content, setContent] = useState('')

  function handleChange(value: string): void {
    setContent(value)
    onTyping?.()
  }

  function submit(): void {
    const trimmed = content.trim()
    if (trimmed.length === 0) return
    onSend(trimmed)
    setContent('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex-none flex items-end gap-2 p-4">
      <Textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enviar mensagem..."
        className="min-h-11 max-h-40"
        rows={1}
      />
      <Button type="button" size="icon" aria-label="Enviar mensagem" onClick={submit}>
        <Send className="size-4" aria-hidden="true" />
      </Button>
    </div>
  )
}
