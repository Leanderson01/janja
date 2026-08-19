import { useQuery } from 'convex/react'
import { Hash, Users, Volume2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLayout } from '@/state/layout-context'
import { useSelection } from '@/state/selection-context'

import { api } from '../../../../../convex/_generated/api'

// Botão de alternar a lista de membros (Plano 08.5-05). Ícone sem texto
// visível ganha tooltip, convenção da fase; o `aria-label` acompanha o
// estado (é a ação que o clique faz) e `aria-pressed` expõe o estado em si
// para o leitor de tela.
//
// Só existe na visão de servidor, e isso sai de graça: `ChannelHeader` é
// renderizado apenas por `ConversationArea`, que só aparece quando
// `view === 'server'` (`AppShell.tsx`). A visão Início não tem lista de
// membros (06-RESEARCH.md §7) e por isso também não tem este botão.
function MembersToggleButton(): React.JSX.Element {
  const { membersVisible, toggleMembers } = useLayout()
  const label = membersVisible ? 'Esconder lista de membros' : 'Mostrar lista de membros'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={membersVisible}
          onClick={toggleMembers}
        >
          <Users />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// Barra fixa no topo da área de conversa (RESEARCH.md §1: ~48px). Mostra o
// ícone (Hash para texto, Volume2 para voz) e o nome do canal atualmente
// selecionado no SelectionProvider — a partir do plano 04-06, lido via
// `api.channels.getChannel` em vez de `mock-data.ts`.
//
// O que este cabeçalho deliberadamente NÃO tem (Plano 08.5-05, decisão
// registrada no 08.5-CONTEXT.md):
//
// - Botões de notificações, pins e busca. O brief original pedia os três, e
//   nenhum tem backend: não existe conceito de mensagem fixada nem de
//   silenciar canal no schema, e busca no histórico é CHAT-13, explicitamente
//   fora do v1. Botão que não faz nada é pior que botão ausente — e ocuparia
//   exatamente o espaço que a janela mínima de 900px não tem.
// - Descrição do canal. O brief pede "nome e descrição"; `channels` não tem
//   campo de descrição no schema do Convex. Inventar um lugar para um dado
//   que não existe é como se cria campo fantasma.
export function ChannelHeader(): React.JSX.Element {
  const { selectedChannelId } = useSelection()
  const channel = useQuery(
    api.channels.getChannel,
    selectedChannelId ? { channelId: selectedChannelId } : 'skip'
  )

  // Três estados colapsam no mesmo fallback: `selectedChannelId === null`
  // (zero canais/servidores), `channel === undefined` (query ainda
  // carregando — transição rápida, não vale um spinner dedicado) e
  // `channel === null` (id inexistente/não-membro — não deveria acontecer
  // no fluxo normal, mas `getChannel` retorna `null` para isso).
  //
  // O botão de membros aparece aqui também, de propósito: sem ele, um
  // servidor sem canal nenhum viraria uma armadilha — lista escondida e
  // nenhum lugar para trazê-la de volta.
  if (!channel) {
    return (
      <div className="flex-none h-12 flex items-center gap-2 px-4 border-b border-border">
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          Nenhum canal selecionado
        </span>
        <MembersToggleButton />
      </div>
    )
  }

  const Icon = channel.type === 'voice' ? Volume2 : Hash

  return (
    <div className="flex-none h-12 flex items-center gap-2 px-4 border-b border-border">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {/* `min-w-0` no item flex + `truncate`: sem os dois, um nome de canal
          longo empurra o botão de membros para fora da barra em vez de
          cortar o próprio texto (item flex tem `min-width: auto` por
          padrão, e `truncate` sozinho não vence isso). */}
      <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{channel.name}</span>
      <MembersToggleButton />
    </div>
  )
}
