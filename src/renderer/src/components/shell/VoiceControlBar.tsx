import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Headphones, Mic, MicOff, MonitorUp, PhoneOff, VolumeX } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { playMuteStateChangeTone, useVoiceJoinLeaveSounds } from '@/lib/voice-sounds'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

import { VoiceSettingsPopover } from './VoiceSettingsPopover'

import { api } from '../../../../../convex/_generated/api'

// Rodapé fixo de controles de voz (Plano 03-02). A partir da Fase 7 (Plano
// 07-03), `muted`/`deafened` deixam de ser cosméticos: cada toggle chama a
// mutation real do Plano 07-01 (`setMuted`/`setDeafened`, que já aplicam a
// semântica de "desmutar remove surdina"/"ensurdecer implica mutar" no
// servidor) e comanda a track/reprodução real do `Room` via `useVoice()`.
//
// `muted`/`deafened` locais continuam sendo `useState` — não porque são
// mock, mas porque não existe ainda (Plano 07-04) uma query pública de
// "minha linha de voiceStates" para ler a fonte da verdade do servidor sem
// tocar em `convex/` (fora do escopo de arquivos deste plano, que pertence
// ao Plano 07-02 nesta wave). Por isso, ao completar um NOVO join (transição
// de `joinedVoiceChannelId` null -> canal, ou canal -> outro canal), o
// estado local reseta para "destravado" — mesma linha de base que
// `upsertVoiceState` usa para uma linha nova. Isso não cobre o caso raro de
// reconectar a uma linha de `voiceStates` pré-existente ainda não limpa pelo
// webhook (ver 07-03-SUMMARY.md); o Plano 07-04 fecha essa lacuna quando
// adicionar a query de participantes.
//
// Plano 07-05 acrescenta o botão de engrenagem (`VoiceSettingsPopover`) e
// `setManualMute(next)` em todo caminho que muta manualmente: sem isso, um
// monitor de VAD em andamento reabriria o microfone assim que a pessoa
// voltasse a falar, ignorando o mute manual.
export function VoiceControlBar(): React.JSX.Element {
  const { joinedVoiceChannelId, setJoinedVoiceChannelId, showStage } = useSelection()
  const {
    room,
    connectionState,
    setManualMute,
    // Plano 08.5-11: ENSURDECER passou a ser lido e escrito pelo contexto.
    // Não havia mais como manter a cópia local: volume individual (VOICE-18) e
    // ensurdecimento escrevem na MESMA propriedade das tracks remotas, então a
    // aplicação foi centralizada em `voice-context.tsx` — e um efeito que mora
    // lá precisa do estado morando lá também, senão ele não reexecuta quando o
    // botão daqui é clicado. O botão, o `aria-pressed`, a mutation
    // `setDeafened` do Convex e a regra "ensurdecer implica mutar" continuam
    // exatamente como estavam: este plano NÃO redesenha o ensurdecimento, só
    // muda quem aplica o volume.
    deafened,
    setDeafened,
    isSharing,
    startScreenShare,
    stopScreenShare
  } = useVoice()

  // Plano 07-07 (VOICE-17): observa `voiceStates` do canal conectado e toca
  // som de entrada/saída — vive aqui porque este já é o "centro de
  // controles de voz" do shell, sem criar um novo ponto de montagem.
  useVoiceJoinLeaveSounds()

  const setMutedMutation = useMutation(api.voice.setMuted)
  const setDeafenedMutation = useMutation(api.voice.setDeafened)

  const [muted, setMutedState] = useState(false)

  // `getChannel` (não `listChannels`) é deliberado: o canal de voz conectado
  // pode pertencer a um servidor diferente do que está selecionado agora na
  // sidebar (o usuário pode navegar para outro servidor sem sair da voz),
  // então a busca não pode depender de `selectedServerId`.
  const connectedChannel = useQuery(
    api.channels.getChannel,
    joinedVoiceChannelId ? { channelId: joinedVoiceChannelId } : 'skip'
  )

  const hasIntention = joinedVoiceChannelId !== null
  const isReady = hasIntention && connectionState === 'connected'

  // Reconciliação mínima ao (re)conectar: uma nova intenção de join sempre
  // nasce destrava (nem mutada, nem ensurdecida) — não dispara em
  // reconexões automáticas do próprio LiveKit (connectionState oscilando
  // connected -> reconnecting -> connected sem `joinedVoiceChannelId`
  // mudar), só quando o usuário de fato troca de canal de voz. Ajuste de
  // estado durante o render (não dentro de um `useEffect`) — padrão
  // recomendado pelo React para "resetar estado quando uma prop muda", sem
  // o commit extra de um efeito rodando depois do primeiro paint.
  const [syncedChannelId, setSyncedChannelId] = useState(joinedVoiceChannelId)
  if (joinedVoiceChannelId !== syncedChannelId) {
    setSyncedChannelId(joinedVoiceChannelId)
    if (joinedVoiceChannelId !== null) {
      setMutedState(false)
      // O reset do ENSURDECER saiu daqui no Plano 08.5-11 e passou a acontecer
      // dentro de `voice-context.tsx`, no join bem-sucedido — onde
      // `deafenedRef` já era zerado pela mesma linha de base desde o Plano
      // 07-11. Não é uma escolha de estilo: `deafened` agora é estado de OUTRO
      // componente (o provider), e chamar o setter dele durante a renderização
      // DESTE é exatamente o "Cannot update a component while rendering a
      // different component" do React.
      //
      // O que muda na prática: o ícone só volta de "ensurdecido" quando o join
      // conclui, em vez de na hora do clique no canal. Nesse intervalo o botão
      // está `disabled={!isReady}` de qualquer forma — e o estado passa a ser
      // CONSISTENTE com o que a reprodução de fato está fazendo, que antes não
      // era: um join que falhava deixava este ícone destravado com o
      // `deafenedRef` ainda em `true`.
    }
  }

  // O efeito que ajustava o volume de reprodução (0 ou 1) de toda track remota
  // (e o reaplicava em `TrackSubscribed`) SAIU daqui no Plano 08.5-11, inteiro,
  // para `voice-context.tsx`. Volume individual por participante (VOICE-18) e
  // ensurdecimento escrevem na mesma propriedade do SDK, e dois efeitos
  // separados brigando por ela significam "o volume que eu ajustei voltou
  // sozinho" toda vez que alguém entra na call. Agora existe UM ponto de
  // aplicação no app inteiro, com a precedência (ensurdecer > silenciado >
  // volume) decidida por uma função pura e testada.

  async function toggleMuted(): Promise<void> {
    const next = !muted
    try {
      await setMutedMutation({ muted: next })
    } catch (err) {
      console.error('[voice] setMuted falhou', err)
      return
    }
    // Plano 07-05: sincroniza o mute manual com o VAD ANTES de tocar na
    // track — sem isso, um monitor de VAD já em andamento poderia reabrir
    // o microfone no instante seguinte se a pessoa estivesse falando.
    setManualMute(next)
    // VOICE-16: mesmo neste caminho de toggle (que na prática só
    // muta/desmuta a track já publicada com as opções do join — ver
    // `setTrackEnabled` do SDK, que reusa a track existente via
    // `track.unmute()` em vez de recriar), as três opções são passadas de
    // novo explicitamente. Nunca ficam implícitas em nenhum caminho que
    // habilita o microfone.
    await room.localParticipant.setMicrophoneEnabled(!next, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    })
    setMutedState(next)
    // Plano 07-11 (pedido do usuário após teste em Windows): tom de
    // mute/desmute do PRÓPRIO microfone. Chamado SÓ aqui — o único lugar
    // onde a mudança de mute é uma decisão manual real (clique no botão do
    // rodapé). Nunca chamado do VAD nem do push-to-talk (`voice-context.tsx`),
    // que ligam/desligam a track a cada fala/tecla, nem do lado "ensurdecer
    // implica mutar" de `toggleDeafened` abaixo — ver justificativa em
    // `playMuteStateChangeTone` (voice-sounds.ts).
    playMuteStateChangeTone(next)
    // Desativar mute enquanto ensurdecido também desativa o ensurdecimento
    // — a mutation já aplicou essa semântica no servidor (design §8); aqui
    // só refletimos o resultado na UI e na reprodução local.
    if (!next && deafened) {
      setDeafened(false)
    }
  }

  async function toggleDeafened(): Promise<void> {
    const next = !deafened
    try {
      await setDeafenedMutation({ deafened: next })
    } catch (err) {
      console.error('[voice] setDeafened falhou', err)
      return
    }
    // Plano 07-11: espelha em `voice-context.tsx` (`deafenedRef`), para que
    // o tom de "eu saí" (disparado na transição de saída, ver
    // `voice-context.tsx`) saiba se deve ficar em silêncio — mesma
    // sincronização de `setManualMute`, mas para ensurdecer.
    // Plano 08.5-11: esta mesma chamada agora é TAMBÉM o que atualiza o ícone
    // (o estado mora no contexto) e o que faz o efeito de volume de lá
    // reexecutar, zerando/restaurando a reprodução de todo mundo. Uma
    // chamada, três consequências, um lugar só.
    setDeafened(next)
    // Ativar deafen implica mute (design §8) — a mutation já aplicou isso no
    // servidor; aqui refletimos no microfone real e no ícone.
    if (next && !muted) {
      // Mesma sincronização de VOICE-05 acima: sem isto, VAD ativo
      // reabriria o microfone na próxima fala mesmo com o usuário
      // ensurdecido (que implica mutado).
      setManualMute(true)
      await room.localParticipant.setMicrophoneEnabled(false)
      setMutedState(true)
    }
  }

  // SHARE-01/02 (Plano 08-02): um único botão de alternância. Sem
  // confirmação e sem seletor aqui — quem pergunta qual tela/janela
  // compartilhar é o `ScreenSharePicker` (Plano 08-04), disparado pelo
  // processo main.
  //
  // A qualidade ("Fluida"/"Nítida", SHARE-08) NÃO tem controle neste rodapé:
  // mora no popover de configurações de voz, o botão de engrenagem logo ao
  // lado (Plano 08-05). Motivo em `VoiceSettingsPopover.tsx` — a coluna é
  // fixa em 240px e não sobra largura para dois botões de texto.
  //
  // `voiceStates.sharing` no Convex também não é escrito daqui: quem
  // escreve é o listener de `LocalTrackPublished`/`LocalTrackUnpublished`
  // em `voice-context.tsx`, porque a track publicada é o fato, e o clique é
  // só a intenção.
  //
  // Não é `async`: `startScreenShare`/`stopScreenShare` nunca rejeitam (todo
  // erro, cancelamento incluso, já vira log dentro delas), e `isSharing` vem
  // do evento de publicação real do `Room`, não de um estado otimista daqui
  // — não há nada para aguardar neste componente.
  function toggleScreenShare(): void {
    void (isSharing ? stopScreenShare() : startScreenShare())
  }

  function leaveVoiceChannel(): void {
    setJoinedVoiceChannelId(null)
  }

  const isReconnecting =
    connectionState === 'reconnecting' || connectionState === 'signalReconnecting'
  const channelName = connectedChannel?.name

  return (
    <div className="flex-none h-14 border-t border-border bg-secondary px-2 flex items-center gap-2">
      {/* Plano 08.5-09: sem conexão nenhuma, o texto "Não conectado a nenhum
          canal de voz" NÃO é renderizado. A decisão é de ESPAÇO, não de
          estética: a coluna é fixa em 240px e o estado conectado já consome
          ~216px só com os 5 botões e os espaçamentos (5×32 + 5×8 + px-2), de
          modo que qualquer texto aqui é útil apenas quando há algo a dizer
          sobre a conexão. Desconectado é evidente pela ausência do botão de
          desconectar e pelos controles de voz desabilitados.
          O `div` vazio com `flex-1` fica de propósito: sem ele os controles
          saltariam da direita para a esquerda ao conectar/desconectar, porque
          é o bloco de status que hoje os empurra. Ele encolhe a zero quando
          falta largura (`flex-1` = `flex: 1 1 0%`), então não rouba nada. */}
      {!hasIntention ? (
        <div className="flex-1" aria-hidden="true" />
      ) : (
        <div className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
          {isReconnecting ? (
            <span className="text-warning font-medium">Reconectando...</span>
          ) : connectionState === 'connected' ? (
            // Plano 08.5-03: o status conectado é o SEGUNDO caminho de volta ao
            // palco (o primeiro é clicar no canal de voz na sidebar) — mesmo lugar
            // onde o Discord põe o painel da call. Custa um elemento: o texto que
            // já existia vira botão, sem mudar o que está escrito.
            <button
              type="button"
              onClick={showStage}
              aria-label="Voltar para a call"
              title="Voltar para a call"
              className="max-w-full truncate text-left text-foreground font-medium hover:underline"
            >
              Conectado a {channelName}
            </button>
          ) : (
            <span className="text-foreground font-medium">
              Conectando a {channelName ?? '...'}...
            </span>
          )}
        </div>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!isReady}
            aria-pressed={muted}
            onClick={() => void toggleMuted()}
          >
            {muted ? <MicOff className="text-destructive" /> : <Mic />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{muted ? 'Ativar microfone' : 'Silenciar microfone'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!isReady}
            aria-pressed={deafened}
            onClick={() => void toggleDeafened()}
          >
            {deafened ? <VolumeX className="text-destructive" /> : <Headphones />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{deafened ? 'Desativar surdina' : 'Ensurdecer'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!isReady}
            aria-pressed={isSharing}
            aria-label={isSharing ? 'Parar compartilhamento de tela' : 'Compartilhar tela'}
            onClick={toggleScreenShare}
          >
            <MonitorUp className={cn(isSharing && 'text-success')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isSharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
        </TooltipContent>
      </Tooltip>

      {/* Plano 07-09: sempre renderizado, não só com `hasIntention` — o testador de
          microfone (VOICE-21) precisa ser alcançável sem nenhum canal conectado. As
          seções que dependem de um `Room` real continuam gated por
          `hasVoiceIntention` dentro do próprio popover. */}
      <VoiceSettingsPopover disabled={hasIntention && !isReady} hasVoiceIntention={hasIntention} />

      {hasIntention && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={leaveVoiceChannel}
              aria-label="Sair do canal de voz"
            >
              <PhoneOff className="text-destructive" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Desconectar</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
