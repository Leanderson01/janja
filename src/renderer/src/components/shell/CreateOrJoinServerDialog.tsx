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
import { useSelection } from '@/state/selection-context'

import { api } from '../../../../../convex/_generated/api'

type Tab = 'create' | 'join'

// Dois pontos de entrada reais para o usuário sair do estado "zero
// servidores" (SRV-01 criar / SRV-03 entrar por código). Duas abas simples
// (botões de texto) em vez de um primitivo de Tabs dedicado — não é
// necessário introduzir mais um componente shadcn só para isto.
export function CreateOrJoinServerDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { setSelectedServerId } = useSelection()
  const createServer = useMutation(api.servers.createServer)
  const joinByCode = useMutation(api.invites.joinByCode)

  const [tab, setTab] = useState<Tab>('create')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm(): void {
    setTab('create')
    setName('')
    setCode('')
    setPending(false)
    setError(null)
  }

  function handleOpenChange(nextOpen: boolean): void {
    // Fechar (via botão de fechar, clique fora, ou Esc do Radix — todos
    // passam por aqui) sempre reseta o form interno, para não vazar estado
    // de uma tentativa anterior para a próxima abertura.
    if (!nextOpen) {
      resetForm()
    }
    onOpenChange(nextOpen)
  }

  const trimmedName = name.trim()
  const nameValid = trimmedName.length >= 2 && trimmedName.length <= 50
  const codeValid = code.trim().length > 0

  async function handleCreate(): Promise<void> {
    if (!nameValid || pending) return
    setPending(true)
    setError(null)
    try {
      const serverId = await createServer({ name: trimmedName })
      setSelectedServerId(serverId)
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar o servidor')
      setPending(false)
    }
  }

  async function handleJoin(): Promise<void> {
    if (!codeValid || pending) return
    setPending(true)
    setError(null)
    try {
      const serverId = await joinByCode({ code: code.trim().toUpperCase() })
      setSelectedServerId(serverId)
      handleOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar no servidor')
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar servidor</DialogTitle>
          <DialogDescription>
            Crie um servidor novo ou entre num existente com um código de convite.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 border-b border-border">
          <button
            type="button"
            onClick={() => {
              setTab('create')
              setError(null)
            }}
            className={
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' +
              (tab === 'create'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground')
            }
          >
            Criar
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('join')
              setError(null)
            }}
            className={
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ' +
              (tab === 'join'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground')
            }
          >
            Entrar com código
          </button>
        </div>

        {tab === 'create' ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="server-name" className="text-sm font-medium text-foreground">
              Nome do servidor
            </label>
            <Input
              id="server-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Galera do Sinuca"
              maxLength={50}
              autoFocus
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor="invite-code" className="text-sm font-medium text-foreground">
              Código de convite
            </label>
            <Input
              id="invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD2345"
              maxLength={8}
              autoFocus
            />
          </div>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          {tab === 'create' ? (
            <Button type="button" disabled={!nameValid || pending} onClick={handleCreate}>
              Criar servidor
            </Button>
          ) : (
            <Button type="button" disabled={!codeValid || pending} onClick={handleJoin}>
              Entrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
