import { useState } from 'react'
import { useMutation } from 'convex/react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

type ChannelType = 'text' | 'voice'

// SRV-05: criar canal de texto/voz num servidor. Recebe `serverId` como prop
// (não lê `useSelection()` diretamente) — deixa explícito, só pela
// assinatura, que este componente não funciona sem um servidor selecionado;
// quem decide quando abrir/qual servidor é o chamador (ChannelSidebar).
export function CreateChannelDialog({
  serverId,
  open,
  onOpenChange
}: {
  serverId: Id<'servers'>
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const createChannel = useMutation(api.channels.createChannel)

  const [name, setName] = useState('')
  const [type, setType] = useState<ChannelType>('text')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm(): void {
    setName('')
    setType('text')
    setPending(false)
    setError(null)
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) {
      resetForm()
    }
    onOpenChange(nextOpen)
  }

  const trimmedName = name.trim()
  const nameValid = trimmedName.length >= 1 && trimmedName.length <= 50

  async function handleCreate(): Promise<void> {
    if (!nameValid || pending) return
    setPending(true)
    setError(null)
    try {
      await createChannel({ serverId, name: trimmedName, type })
      // Sucesso: fecha e reseta o form — não navega para o canal criado, a
      // sidebar já reflete o novo canal via subscription reativa.
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o canal')
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar canal</DialogTitle>
          <DialogDescription>Escolha um nome e o tipo do canal.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            variant={type === 'text' ? 'default' : 'outline'}
            onClick={() => setType('text')}
          >
            Texto
          </Button>
          <Button
            type="button"
            variant={type === 'voice' ? 'default' : 'outline'}
            onClick={() => setType('voice')}
          >
            Voz
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="channel-name" className="text-sm font-medium text-foreground">
            Nome do canal
          </label>
          <Input
            id="channel-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="geral"
            maxLength={50}
            autoFocus
          />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" disabled={!nameValid || pending} onClick={handleCreate}>
            Criar canal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
