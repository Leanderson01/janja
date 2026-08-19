import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

// SRV-02/SRV-04: ver/copiar o código de convite ativo do servidor e, se
// dono, gerar um novo ou revogar o atual. Recebe `serverId` como prop (mesma
// razão de design de CreateChannelDialog). `amIOwner` controla só a exibição
// condicional dos botões de dono — nunca a autorização de fato, que é sempre
// imposta no backend por `requireOwnership` (convex/invites.ts).
export function InviteDialog({
  serverId,
  open,
  onOpenChange
}: {
  serverId: Id<'servers'>
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const isOwner = useQuery(api.servers.amIOwner, { serverId })
  const invite = useQuery(api.invites.getActiveInvite, { serverId })
  const generateInvite = useMutation(api.invites.generateInvite)
  const revokeInvite = useMutation(api.invites.revokeInvite)

  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isLoadingInvite = invite === undefined
  const hasInvite = invite !== undefined && invite !== null

  async function handleCopy(code: string): Promise<void> {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleGenerate(): Promise<void> {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await generateInvite({ serverId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gerar o convite')
    } finally {
      setPending(false)
    }
  }

  async function handleRevoke(): Promise<void> {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await revokeInvite({ serverId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível revogar o convite')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar para o servidor</DialogTitle>
          <DialogDescription>
            Compartilhe o código abaixo para outras pessoas entrarem neste servidor.
          </DialogDescription>
        </DialogHeader>

        {isLoadingInvite ? null : hasInvite ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-center font-mono text-lg tracking-widest text-foreground">
              {invite.code}
            </code>
            <Button type="button" variant="outline" onClick={() => handleCopy(invite.code)}>
              {copied ? 'Copiado!' : 'Copiar'}
            </Button>
          </div>
        ) : isOwner ? (
          <Button type="button" disabled={pending} onClick={handleGenerate}>
            Gerar código de convite
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Peça ao dono do servidor para gerar um convite.
          </p>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {hasInvite && isOwner ? (
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={handleGenerate}>
              Gerar novo código
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={handleRevoke}>
              Revogar convite
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
