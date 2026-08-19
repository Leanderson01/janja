import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { toast } from 'sonner'

import { MessageInput } from '@/components/shell/MessageInput'
import { Button } from '@/components/ui/button'
import { readableConvexError } from '@/lib/convex-error'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

import { DmMessageList } from './DmMessageList'

// Conversa direta real (plano 06-07): histórico paginado + envio de
// mensagem, sobre o backend dos planos 06-04/06-05. MessageInput.tsx (Fase
// 3) é reaproveitado tal como está — já é genérico (`onSend: (content:
// string) => void`), não amarrado a canal de servidor.
type DmConversationViewProps = {
  dmChannelId: Id<'dmChannels'>
}

export function DmConversationView({ dmChannelId }: DmConversationViewProps): React.JSX.Element {
  // Mesma query já usada por DmSidebar — Convex reaproveita a subscription,
  // não duplica rede.
  const dmChannels = useQuery(api.dms.listMyDmChannels)
  const otherUser = dmChannels?.find((channel) => channel.dmChannelId === dmChannelId)?.otherUser

  const { results, status, loadMore } = usePaginatedQuery(
    api.dms.listDmMessages,
    { dmChannelId },
    { initialNumItems: 30 }
  )

  const sendDmMessage = useMutation(api.dms.sendDmMessage)

  // Mesmo tratamento do canal de servidor (`ConversationArea.tsx`): falha de
  // envio vira toast, com a frase do Convex na descrição.
  //
  // Isto substituiu um `<p>` de erro inline acima do composer, que tinha dois
  // problemas: empurrava o campo de texto para baixo ao aparecer, e só sumia no
  // próximo envio bem-sucedido — um erro de 3 minutos atrás continuava na tela.
  // O toast some sozinho e não mexe no layout.
  function handleSend(content: string): void {
    sendDmMessage({ dmChannelId, content }).catch((err: unknown) => {
      toast.error('Não foi possível enviar a mensagem. Tente de novo.', {
        description: readableConvexError(err)
      })
    })
  }

  if (otherUser === undefined) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Carregando conversa...
      </div>
    )
  }

  // results vem em ordem decrescente (mais recente primeiro, decisão do
  // plano 06-05); invertido antes de passar pra DmMessageList, que espera
  // ordem crescente (mesma convenção de MessageList.tsx).
  const messages = [...results].reverse()

  return (
    // `min-w-0` na raiz e no nome: em janela estreita esta coluna é a que
    // encolhe, e sem ele o `truncate` do nome não corta nada — um filho flex tem
    // `min-width: auto` e se recusa a ficar menor que o próprio conteúdo.
    <div className="h-full min-w-0 flex flex-col">
      <div className="h-12 flex-none flex items-center gap-2 px-4 border-b border-border">
        <span className="min-w-0 font-semibold text-foreground truncate">
          {otherUser ? `${otherUser.username}#${otherUser.tag}` : 'Conversa'}
        </span>
      </div>

      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        {status === 'CanLoadMore' ? (
          <div className="flex-none flex justify-center py-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => loadMore(30)}>
              Carregar mensagens antigas
            </Button>
          </div>
        ) : null}

        <div className="flex-1 min-h-0 min-w-0">
          {otherUser ? (
            <DmMessageList messages={messages} otherUser={otherUser} />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Não foi possível carregar esta conversa
            </div>
          )}
        </div>
      </div>

      <MessageInput onSend={handleSend} />
    </div>
  )
}
