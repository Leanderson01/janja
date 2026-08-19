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

  // Enter envia, Shift+Enter quebra linha — e a guarda de IME NÃO é enfeite.
  //
  // Quem digita em japonês, chinês ou coreano compõe a palavra dentro do campo:
  // o teclado abre uma lista de candidatos e o Enter que CONFIRMA o candidato é
  // fisicamente o mesmo Enter que enviaria a mensagem. Sem
  // `event.nativeEvent.isComposing`, a mensagem sai no meio da palavra e o
  // usuário não tem como escrever uma frase inteira. Não existe heurística de
  // texto que substitua esse sinal: quem sabe que uma composição está ativa é o
  // navegador, e `isComposing` é como ele conta.
  //
  // O `keyCode !== 229` é redundante no Chromium (o único runtime deste app),
  // mas cobre o caso conhecido de `compositionend` disparar ANTES do `keydown`
  // em alguns IMEs — nesse instante `isComposing` já voltou a ser `false` e o
  // 229 é o único sinal que resta. Uma linha custa menos que a dúvida.
  //
  // Se alguém for "simplificar" isto seis meses depois: o teste
  // `MessageInput.test.tsx` derruba a simplificação.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
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
      {/* Desabilitado com o campo vazio (ou só espaços): `submit()` já ignora
          esse caso, então um botão sempre habilitado era um estado morto —
          clicável e sem efeito nenhum. */}
      <Button
        type="button"
        size="icon"
        aria-label="Enviar mensagem"
        onClick={submit}
        disabled={content.trim().length === 0}
      >
        <Send className="size-4" aria-hidden="true" />
      </Button>
    </div>
  )
}
