import { useMutation, useQuery } from 'convex/react'
import { useRef } from 'react'
import { toast } from 'sonner'

import { CallStage, VoiceParticipantGrid } from '@/components/shell/CallStage'
import { ChannelHeader } from '@/components/shell/ChannelHeader'
import { MessageInput } from '@/components/shell/MessageInput'
import { MessageList } from '@/components/shell/MessageList'
import { TypingIndicator } from '@/components/shell/TypingIndicator'
import { readableConvexError } from '@/lib/convex-error'
import { resolveMainView } from '@/lib/stage-view'
import { useSelection } from '@/state/selection-context'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

// Throttle de escrita de "estou digitando" (CHAT-07): no máximo 1 mutation a
// cada ~2s por usuário digitando, independente da velocidade de digitação —
// mesma folga 2x-3x que TYPING_TTL_MS do TypingIndicator usa como referência
// (05-RESEARCH.md §7). Evita escrever no banco a cada tecla (PITFALLS.md,
// Performance Traps).
const TYPING_THROTTLE_MS = 2000

// Visão de chat para canal de texto: histórico real e envio real, ambos via
// Convex. `MessageList` é remontada com `key={channelId}` pelo chamador
// (ConversationArea) ao trocar de canal — reseta o estado interno de scroll
// da lista (mesmo padrão de remount por `key` já usado desde a Fase 3).
function TextChannelView({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
  const sendMessage = useMutation(api.messages.sendMessage)
  const setTyping = useMutation(api.typing.setTyping)
  const lastTypingCallRef = useRef(0)

  // Falha de envio PRECISA aparecer. Antes era `.catch(() => {})`: quem perdia a
  // rede via a mensagem sumir do campo e nunca chegar na lista, sem nenhuma
  // explicação — o pior tipo de defeito, o que parece que o app comeu a mensagem.
  //
  // Continua `void`/`.catch` em vez de handler `async`: o contrato de `onSend` do
  // MessageInput é síncrono (`(content: string) => void`), e mudar isso mexeria
  // no composer inteiro por um motivo que não existe.
  //
  // Sem toast de SUCESSO de propósito: a mensagem enviada já se prova aparecendo
  // na lista, e um toast por mensagem seria ruído constante.
  function handleSend(content: string): void {
    sendMessage({ channelId, content }).catch((err: unknown) => {
      toast.error('Não foi possível enviar a mensagem. Tente de novo.', {
        description: readableConvexError(err)
      })
    })
  }

  // A assimetria com `handleSend` acima é deliberada, não esquecimento: falhar em
  // avisar "está digitando" não é algo que o usuário precise saber, nada se perde,
  // e numa rede ruim isto dispararia um toast a cada 2s — o remédio seria pior que
  // a doença. Este `.catch(() => {})` fica silencioso.
  function handleTyping(): void {
    const now = Date.now()
    if (now - lastTypingCallRef.current < TYPING_THROTTLE_MS) return
    lastTypingCallRef.current = now
    setTyping({ channelId }).catch(() => {})
  }

  return (
    <>
      <div className="flex-1 min-h-0">
        <MessageList channelId={channelId} />
      </div>
      <TypingIndicator channelId={channelId} />
      <MessageInput onSend={handleSend} onTyping={handleTyping} />
    </>
  )
}

// Área principal (Plano 03-03; repaginada no Plano 08.5-03). Deixou de ser "a
// área de conversa" e passou a ser o roteador de um palco: entrar numa call põe
// `CallStage` na frente, navegar para um canal de texto mostra o texto SEM
// derrubar a call, e há dois caminhos de volta ao palco (clicar no canal de voz
// conectado na sidebar, clicar em "Conectado a ..." no rodapé).
//
// A decisão de QUAL região aparece não mora mais no JSX daqui: é
// `resolveMainView` (`@/lib/stage-view`), função pura com tabela de verdade
// testada. Este componente só traduz o resultado em markup.
//
// O canal em si vem de `api.channels.getChannel` (mesma query de ChannelHeader —
// subscrição compartilhada pelo cliente do Convex, não duplicada).
export function ConversationArea(): React.JSX.Element {
  const { selectedChannelId, joinedVoiceChannelId, viewingStage } = useSelection()
  const channel = useQuery(
    api.channels.getChannel,
    selectedChannelId ? { channelId: selectedChannelId } : 'skip'
  )

  const view = resolveMainView({
    joinedVoiceChannelId,
    viewingStage,
    selectedChannelId,
    selectedChannelType: channel?.type ?? null
  })

  // O palco ocupa a área inteira: sem `ChannelHeader`, que descreveria o canal
  // SELECIONADO (durante uma call, possivelmente um canal de texto) e não o que
  // está na tela. A barra do palco vive dentro de `CallStage`.
  //
  // Sair do palco DESMONTA `CallStage`, e com ele o `<video>` da tela
  // compartilhada — é o contrato de mídia da Fase 8 (08-06-SUMMARY.md), não um
  // descuido: o elemento existe enquanto o componente existe. O vídeo volta ao
  // se voltar para o palco, porque `screenShareTracks` vive em `voice-context`,
  // não neste componente. Primeira coisa que alguém vai achar que é bug.
  if (view.kind === 'stage') {
    return (
      <div className="h-full flex flex-col">
        <CallStage channelId={view.channelId} />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <ChannelHeader />
      {view.kind === 'text' ? (
        // `key` remonta a visão inteira ao trocar de canal, resetando o estado
        // de scroll da lista — padrão desde a Fase 3, verificado com usuário
        // real (CHAT-14, 2026-08-19). Não remover.
        <TextChannelView key={view.channelId} channelId={view.channelId} />
      ) : view.kind === 'voice-preview' ? (
        // Canal de voz onde NÃO estou: ver quem está lá sem entrar. Mesmo grid
        // do palco, sem a região de vídeo — que não existe para quem não está
        // conectado ao canal (o `ScreenShareStage` já devolvia só o convite
        // "Entre no canal para ver a tela compartilhada").
        <div className="flex-1 min-h-0 flex flex-col items-center gap-4 overflow-y-auto p-8">
          <VoiceParticipantGrid channelId={view.channelId} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground">
          Nenhum canal selecionado
        </div>
      )}
    </div>
  )
}
