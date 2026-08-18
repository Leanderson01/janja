import { Send } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type MessageInputProps = {
  onSend: (content: string) => void
}

// Campo de envio de mensagem — eco puramente local (RESEARCH.md, F3 sem
// backend): captura texto, chama `onSend`, limpa o campo. Não valida nem
// persiste nada; quem guarda o histórico da mensagem enviada é o componente
// pai (ConversationArea).
export function MessageInput({ onSend }: MessageInputProps): React.JSX.Element {
  const [content, setContent] = useState('')

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
        onChange={(e) => setContent(e.target.value)}
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
