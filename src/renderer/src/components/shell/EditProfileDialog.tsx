import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'

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
import { readableConvexError } from '@/lib/convex-error'

import { api } from '../../../../../convex/_generated/api'

// Edição do próprio perfil: nome de exibição, nome de usuário e tag.
//
// ISOLADO DE PROPÓSITO — este arquivo não é montado por ninguém ainda. Quem
// abre o diálogo é o menu do usuário, e essa costura é do Leo; aqui só existe
// o componente, com a assinatura combinada `({ open, onOpenChange })`. Nada
// deste arquivo importa `UserPanel`/`AppShell`, e nenhum daqueles arquivos
// precisa mudar para este compilar.
//
// AS REGRAS QUE A UI ESPELHA (a fonte é convex/lib/identity.ts — este arquivo
// NÃO revalida, para as duas versões não saírem de sincronia; ele só limita o
// `maxLength` e deixa o servidor recusar com a mensagem definitiva):
//   - nome de usuário: 2..32, canonizado para minúsculas sem acento. Digitar
//     "João Silva" grava "joao.silva", e a prévia mostra isso ANTES de salvar.
//   - tag: exatamente 4 dígitos, escolhida à mão (é o "ID" que o Leo pediu
//     para poder alterar). O sorteio automático só acontece no primeiro
//     login.
//   - nome de exibição: 1..32, livre — acento, espaço e maiúscula à vontade,
//     e SEM unicidade. Dois "João Silva" podem coexistir; o que é único é o
//     par (nome de usuário, tag).
//
// Por que a unicidade é do PAR e não do nome: é o modelo que o banco já tem
// (índice `by_username_tag`), e é o que permite dez pessoas se chamarem
// `joao` desde que com tags diferentes.

/** Espelha `USERNAME_MAX_LENGTH`/`DISPLAY_NAME_MAX_LENGTH` de convex/lib/identity.ts. */
const USERNAME_MAX_LENGTH = 32
const DISPLAY_NAME_MAX_LENGTH = 32
const TAG_LENGTH = 4

type Profile = {
  username: string
  tag: string
  displayName: string
}

export type UpdateProfileFn = (args: {
  username: string
  tag: string
  displayName: string
}) => Promise<unknown>

/**
 * Prévia da canonização do nome de usuário, para a pessoa ver o que vai ser
 * gravado enquanto digita. É uma cópia SIMPLIFICADA de `slugifyUsername`
 * (convex/lib/identity.ts) e vale só como dica visual — quem decide o valor
 * final é sempre o servidor, e é o retorno dele que preenche o formulário
 * depois de salvar.
 */
export function previewUsername(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/[._-]{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
}

/**
 * Formulário puro, exportado para poder ser testado sozinho.
 *
 * A mutation entra por PROP, não por `useMutation`: fora de um
 * `ConvexProvider` o hook joga "Could not find Convex client!", e montar o
 * provider inteiro só para testar validação seria caro — mesmo motivo já
 * documentado em `MemberList.test.tsx`.
 */
export function EditProfileForm({
  profile,
  updateProfile,
  onSaved
}: {
  profile: Profile
  updateProfile: UpdateProfileFn
  onSaved: () => void
}): React.JSX.Element {
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [username, setUsername] = useState(profile.username)
  const [tag, setTag] = useState(profile.tag)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // NÃO há efeito sincronizando os campos com a prop `profile`, de propósito.
  //
  // Dois motivos. O primeiro é que não precisa: o `DialogContent` do Radix
  // vive num portal que DESMONTA ao fechar, então cada abertura do diálogo já
  // monta este formulário do zero, com o perfil corrente como valor inicial.
  // O segundo é que seria pior: um `useEffect` reagindo à subscription do
  // Convex apagaria o que a pessoa está digitando no instante em que qualquer
  // atualização do próprio documento chegasse — e ainda cairia na regra
  // `react-hooks/set-state-in-effect` (cascata de renders), a mesma já
  // documentada em `AuthGate.tsx`.
  //
  // Depois de salvar, quem devolve a verdade é a própria mutation: o diálogo
  // fecha em `onSaved`, e a próxima abertura lê o valor já canonizado.

  const canonicalUsername = previewUsername(username)
  const identifier = `${canonicalUsername || '…'}#${tag || '…'}`
  const unchanged =
    displayName.trim() === profile.displayName &&
    canonicalUsername === profile.username &&
    tag === profile.tag

  async function handleSave(): Promise<void> {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await updateProfile({ username, tag, displayName })
      toast.success('Perfil atualizado')
      onSaved()
    } catch (err) {
      // `readableConvexError` extrai a frase em português que a mutation
      // lançou ("joao#0001 já está em uso...") do embrulho multilinha do
      // Convex. Sem isso o usuário leria um Request ID antes do motivo.
      setError(readableConvexError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void handleSave()
      }}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="profile-display-name" className="text-sm font-medium text-foreground">
          Nome de exibição
        </label>
        <Input
          id="profile-display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="João Silva"
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoFocus
        />
        <p className="text-xs text-muted-foreground">
          Como seu nome aparece para as outras pessoas. Pode repetir o de outra pessoa.
        </p>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-2">
          <label htmlFor="profile-username" className="text-sm font-medium text-foreground">
            Nome de usuário
          </label>
          <Input
            id="profile-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="joao.silva"
            maxLength={USERNAME_MAX_LENGTH}
          />
        </div>
        <div className="flex w-24 flex-col gap-2">
          <label htmlFor="profile-tag" className="text-sm font-medium text-foreground">
            Tag
          </label>
          <Input
            id="profile-tag"
            value={tag}
            onChange={(e) => setTag(e.target.value.replace(/\D/g, '').slice(0, TAG_LENGTH))}
            placeholder="0001"
            inputMode="numeric"
            maxLength={TAG_LENGTH}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Seu identificador ficará <span className="text-foreground">{identifier}</span>. É o que
        outras pessoas digitam para te adicionar — o par precisa ser único.
      </p>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="submit" disabled={pending || unchanged}>
          {pending ? 'Salvando…' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function EditProfileDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  // `undefined` = a subscription ainda não respondeu; `null` = sem sessão ou
  // sem documento em `users`. Os dois viram o mesmo texto de espera, mas o
  // diálogo NUNCA renderiza campos com valor inventado.
  const profile = useQuery(api.users.me, {})
  const updateProfile = useMutation(api.users.updateProfile)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          {/* DialogTitle é obrigatório mesmo quando o desenho não pediria um
              título: o Radix usa como rótulo acessível do diálogo, e sem ele
              o leitor de tela anuncia uma janela sem nome (além do aviso em
              desenvolvimento). */}
          <DialogTitle>Editar perfil</DialogTitle>
          <DialogDescription>
            Escolha como você aparece e qual identificador as pessoas usam para te encontrar.
          </DialogDescription>
        </DialogHeader>

        {profile ? (
          <EditProfileForm
            profile={profile}
            updateProfile={updateProfile}
            onSaved={() => onOpenChange(false)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Carregando seu perfil…</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
