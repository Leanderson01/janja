import { FileText, PlusCircle, Trash2 } from 'lucide-react'
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref
} from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { validateFiles } from '@/lib/attachments'

export type MessageInputHandle = { addFiles(files: File[]): void }

type MessageInputProps = {
  placeholder: string
  ref?: Ref<MessageInputHandle>
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
  placeholder,
  ref,
  onSend,
  onTyping,
  onSendWithAttachments
}: MessageInputProps): React.JSX.Element {
  const [content, setContent] = useState('')
  const [selected, setSelected] = useState<File[]>([])
  const [isSending, setIsSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canAttach = onSendWithAttachments !== undefined

  function handleChange(value: string): void {
    setContent(value)
    onTyping?.()
  }

  function addValidated(files: File[]): void {
    const { accepted, rejected } = validateFiles(files, selected.length)
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

  function handleFilesChosen(list: FileList | null): void {
    if (list) addValidated(Array.from(list))

    // Zerar o valor do input é obrigatório, não higiene: sem isso, remover um
    // arquivo da lista e escolher O MESMO de novo não dispara `change` nenhum
    // (o valor do input não mudou) e o usuário fica achando que o clique não
    // funcionou.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Arrastar para a conversa (ConversationArea) e colar passam pelo mesmo
  // caminho do seletor: mesma validação, mesmos toasts. Sem anexo habilitado
  // (DM) não faz nada.
  useImperativeHandle(ref, () => ({
    addFiles(files: File[]) {
      if (!canAttach || files.length === 0) return
      if (isSending) {
        toast.error('Aguarde o envio terminar para anexar mais arquivos.')
        return
      }
      addValidated(files)
    }
  }))

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const files = Array.from(event.clipboardData?.files ?? [])
    if (!canAttach || files.length === 0) return
    event.preventDefault()
    addValidated(files)
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
    <div className="flex-none">
      <div className="mx-2 flex min-h-[52px] flex-col rounded-lg border border-input bg-composer">
        {/* Miniaturas dentro da caixa, acima do texto (Discord). Sem esta revisão
            o usuário não teria como saber o que anexou nem como desistir de um
            item — e um seletor de arquivo sem revisão é onde a pessoa manda o
            print errado. */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-3 px-4 pt-3">
            {selected.map((file, index) => (
              <SelectedFile
                key={`${file.name}-${index}`}
                file={file}
                disabled={isSending}
                onRemove={() => removeSelected(index)}
              />
            ))}
            {isSending && (
              <span className="self-end text-xs text-muted-foreground">Enviando…</span>
            )}
          </div>
        )}

        <div className="flex items-start gap-3 px-4">
          {canAttach && (
            <>
              {/* `hidden` e não `sr-only`: este input nunca é o alvo do usuário,
                  quem recebe o foco de teclado é o botão do “+”. */}
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
                    className="mt-[10px] size-8 shrink-0 text-muted-foreground hover:bg-transparent"
                    aria-label="Enviar um arquivo"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSending}
                  >
                    <PlusCircle className="size-[22px]" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Enviar um arquivo</TooltipContent>
              </Tooltip>
            </>
          )}
          {/* SEM BOTÃO ENVIAR, como no Discord: Enter envia. SEM BARRA DE
              PROGRESSO, por decisão: `fetch` não expõe progresso de upload, e a
              única forma de tê-la seria trocar o transporte por
              `XMLHttpRequest`. O que existe é "Enviando…" com tudo travado. */}
          <Textarea
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            className="min-h-[52px] max-h-40 flex-1 rounded-none border-0 bg-transparent px-0 py-[14px] text-base shadow-none placeholder:text-hint focus-visible:ring-0 dark:bg-transparent"
            rows={1}
            disabled={isSending}
          />
        </div>
      </div>
    </div>
  )
}

function SelectedFile({
  file,
  disabled,
  onRemove
}: {
  file: File
  disabled: boolean
  onRemove(): void
}): React.JSX.Element {
  const isImage = file.type.startsWith('image/')
  // Uma URL por arquivo, criada e revogada no MESMO efeito: no StrictMode
  // (mount → cleanup → mount) cada montagem ganha a sua URL e a anterior é
  // revogada, sem deixar <img> apontando para um blob morto.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!isImage) return
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
      setPreviewUrl(null)
    }
  }, [file, isImage])

  return (
    <div className="relative flex w-40 flex-col gap-1 rounded-md bg-secondary p-2">
      <div className="flex h-24 items-center justify-center overflow-hidden rounded-sm">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="size-full object-cover" />
        ) : (
          <FileText className="size-10 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <span className="truncate text-xs text-foreground" title={file.name}>
        {file.name}
      </span>
      <Button
        type="button"
        size="icon"
        variant="secondary"
        className="absolute -right-2 -top-2 size-7 text-destructive"
        aria-label={`Remover ${file.name}`}
        onClick={onRemove}
        disabled={disabled}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </div>
  )
}
