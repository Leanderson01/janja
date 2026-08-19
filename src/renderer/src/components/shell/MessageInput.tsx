import { Loader2, Paperclip, Send, X } from 'lucide-react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatBytes, validateFiles } from '@/lib/attachments'

type MessageInputProps = {
  onSend: (content: string) => void
  // Opcional de propósito (CHAT-07, plano 05-05): quem fornece a função decide
  // throttle e o que ela faz por trás (ex: chamar convex/typing.ts). Este
  // componente não sabe nada de Convex — se a Fase 6 (DM) nunca passar essa
  // prop, o comportamento continua idêntico ao de antes deste plano.
  onTyping?: () => void
  // CHAT-10 (Plano 08.5-14) — anexos. Também opcional, e por um motivo de
  // escopo: anexo vale para canal de texto de servidor, NÃO para DM nesta fase
  // (`dmMessages` é outra tabela, com mutation e lista próprias). Quem não passa
  // esta prop — que hoje é exatamente o `DmConversationView` — não ganha botão
  // de clipe e continua com o composer de antes. É isso que permitiu este plano
  // não tocar em `DmConversationView.tsx`.
  //
  // É `Promise` e não `void` porque o composer PRECISA saber se falhou: a
  // seleção do usuário só pode ser limpa em caso de sucesso.
  onSendWithAttachments?: (content: string, files: File[]) => Promise<void>
}

// Campo de envio de mensagem — eco puramente local (RESEARCH.md, F3 sem
// backend): captura texto, chama `onSend`, limpa o campo. Não valida nem
// persiste nada; quem guarda o histórico da mensagem enviada é o componente
// pai (ConversationArea).
export function MessageInput({
  onSend,
  onTyping,
  onSendWithAttachments
}: MessageInputProps): React.JSX.Element {
  const [content, setContent] = useState('')
  const [selected, setSelected] = useState<File[]>([])
  const [isSending, setIsSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canAttach = onSendWithAttachments !== undefined
  const hasSomethingToSend = content.trim().length > 0 || selected.length > 0

  function handleChange(value: string): void {
    setContent(value)
    onTyping?.()
  }

  function handleFilesChosen(list: FileList | null): void {
    if (list) {
      const { accepted, rejected } = validateFiles(Array.from(list), selected.length)
      if (accepted.length > 0) setSelected((prev) => [...prev, ...accepted])
      // Um toast por arquivo recusado, com o nome e o motivo. A validação
      // acontece AQUI, antes de qualquer byte subir: descobrir o limite depois
      // de esperar o upload de 40 MB terminar é a pior versão desse erro. Quem
      // decide de verdade continua sendo o servidor (08.5-13-SUMMARY.md); esta
      // checagem existe só para poupar a espera.
      for (const file of rejected) {
        toast.error(`${file.name}: ${file.message}`)
      }
    }

    // Zerar o valor do input é obrigatório, não higiene: sem isso, remover um
    // arquivo da lista e escolher O MESMO de novo não dispara `change` nenhum
    // (o valor do input não mudou) e o usuário fica achando que o clique não
    // funcionou.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeSelected(index: number): void {
    setSelected((prev) => prev.filter((_, i) => i !== index))
  }

  function submit(): void {
    if (isSending) return
    const trimmed = content.trim()

    // Mensagem só com imagem, sem texto, é o caso NORMAL de anexo — por isso a
    // condição de "vazio" olha os dois lados. (Sem anexo, nada mudou: campo
    // vazio continua não enviando.)
    if (trimmed.length === 0 && selected.length === 0) return

    if (selected.length > 0 && onSendWithAttachments) {
      setIsSending(true)
      onSendWithAttachments(trimmed, selected)
        .then(() => {
          setContent('')
          setSelected([])
        })
        .catch(() => {
          // FALHA NÃO LIMPA A SELEÇÃO. O erro já virou toast lá no pai; aqui o
          // que importa é que os arquivos escolhidos continuem na lista e os
          // controles voltem a ficar ativos. Perder a seleção depois de um
          // upload de cinco arquivos que caiu no meio faria o usuário refazer
          // toda a escolha — o app puniria quem tem rede ruim.
        })
        .finally(() => {
          setIsSending(false)
        })
      return
    }

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
    <div className="flex-none flex flex-col gap-2 p-4">
      {/* Os arquivos escolhidos, ANTES de enviar. Sem esta lista o usuário não
          teria como saber o que anexou nem como desistir de um item — e um
          seletor de arquivo sem revisão é onde a pessoa manda o print errado. */}
      {selected.length > 0 && (
        <div className="flex flex-col gap-1">
          {selected.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1"
            >
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatBytes(file.size)}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-6 shrink-0"
                aria-label={`Remover ${file.name}`}
                onClick={() => removeSelected(index)}
                disabled={isSending}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
          {isSending && <span className="text-xs text-muted-foreground">Enviando…</span>}
        </div>
      )}

      <div className="flex items-end gap-2">
        {canAttach && (
          <>
            {/* `hidden` e não `sr-only`: este input nunca é o alvo do usuário,
                quem recebe o foco de teclado é o botão do clipe. */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => handleFilesChosen(e.target.files)}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Anexar arquivo"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSending}
                >
                  <Paperclip className="size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Anexar arquivo</TooltipContent>
            </Tooltip>
          </>
        )}
        <Textarea
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enviar mensagem..."
          className="min-h-11 max-h-40"
          rows={1}
          disabled={isSending}
        />
        {/* Desabilitado com o campo vazio (ou só espaços) E sem anexo:
            `submit()` já ignora esse caso, então um botão sempre habilitado era
            um estado morto — clicável e sem efeito nenhum.

            SEM BARRA DE PROGRESSO, por decisão: `fetch` não expõe progresso de
            upload, e a única forma de tê-la seria trocar o transporte por
            `XMLHttpRequest`. Trocar o transporte por causa de uma barra é custo
            alto para ganho pequeno num grupo de dez pessoas mandando arquivos de
            até 25 MB. O que existe é o estado "Enviando…" com tudo travado. */}
        <Button
          type="button"
          size="icon"
          aria-label={isSending ? 'Enviando…' : 'Enviar mensagem'}
          onClick={submit}
          disabled={isSending || !hasSomethingToSend}
        >
          {isSending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  )
}
