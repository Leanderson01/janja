import { useState } from 'react'
import { Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { readableConvexError } from '@/lib/convex-error'
import { parseUserTag } from '@/lib/user-tag'
import { cn } from '@/lib/utils'

// Mapeia as mensagens reais de `sendFriendRequest` (convex/friends.ts).
function friendlyError(err: unknown): string {
  const msg = readableConvexError(err)
  if (msg.includes('Usuário não encontrado')) {
    return 'Não encontramos ninguém com esse identificador. Confira as maiúsculas e o número.'
  }
  if (msg.includes('Vocês já são amigos')) return 'Vocês já são amigos.'
  if (msg.includes('Pedido já enviado')) return 'Você já enviou um pedido para essa pessoa.'
  if (msg.includes('a si mesmo')) return 'Esse é o seu próprio identificador.'
  if (msg.includes('já te enviou um pedido')) {
    return 'Essa pessoa já te enviou um pedido. Aceite na aba Pendente.'
  }
  return 'Não deu para enviar o pedido. Tente de novo.'
}

type Feedback = { kind: 'success' | 'error'; text: string } | null

export function AddFriendForm({
  onSend,
  myTag
}: {
  onSend: (username: string, tag: string) => Promise<void>
  myTag: string | null
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [copied, setCopied] = useState(false)

  const valid = parseUserTag(value) !== null

  async function submit(): Promise<void> {
    if (sending) return
    const parsed = parseUserTag(value)
    if (!parsed) {
      setFeedback({ kind: 'error', text: 'Use o formato usuário#1234.' })
      return
    }
    setSending(true)
    try {
      await onSend(parsed.username, parsed.tag)
      setFeedback({
        kind: 'success',
        text: `Pedido de amizade enviado para ${parsed.username}#${parsed.tag}.`
      })
      setValue('')
    } catch (err) {
      setFeedback({ kind: 'error', text: friendlyError(err) })
    } finally {
      setSending(false)
    }
  }

  function handleCopy(): void {
    if (!myTag) return
    navigator.clipboard
      .writeText(myTag)
      .then(() => setCopied(true))
      .catch((err: unknown) => console.error('Falha ao copiar identificador:', err))
  }

  return (
    <div className="max-w-[720px] px-8 py-5">
      <h3 className="text-xl font-semibold text-strong">Adicionar amigo</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Você pode adicionar amigos com o identificador deles, no formato usuário#1234.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className={cn(
          'mt-4 flex h-[52px] items-center gap-2 rounded-lg border bg-sidebar px-3',
          'focus-within:border-primary',
          feedback?.kind === 'success'
            ? 'border-success'
            : feedback?.kind === 'error'
              ? 'border-destructive'
              : 'border-input'
        )}
      >
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setFeedback(null)
          }}
          placeholder="Digite o identificador, ex.: leo#1234"
          aria-label="Identificador do amigo"
          // O botão fica desabilitado com texto inválido, e o navegador não envia
          // o formulário por Enter nesse caso: tratamos o Enter aqui para poder
          // mostrar "Use o formato usuário#1234.".
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            void submit()
          }}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 border-0 bg-transparent text-base text-foreground outline-none placeholder:text-hint"
        />
        <button
          type="submit"
          disabled={!valid || sending}
          className="h-8 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:bg-primary/90 disabled:opacity-50"
        >
          {sending ? 'Enviando…' : 'Enviar pedido de amizade'}
        </button>
      </form>

      {feedback ? (
        <p
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'mt-2 text-sm',
            feedback.kind === 'success' ? 'text-success' : 'text-destructive'
          )}
        >
          {feedback.text}
        </p>
      ) : null}

      {myTag ? (
        <>
          <Separator className="my-6" />
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>
              Seu identificador: <strong className="text-strong">{myTag}</strong>
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleCopy}
                  onMouseLeave={() => setCopied(false)}
                >
                  <Copy className="size-3.5" />
                  Copiar
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copied ? 'Copiado!' : 'Copiar seu identificador'}</TooltipContent>
            </Tooltip>
          </div>
        </>
      ) : null}
    </div>
  )
}
