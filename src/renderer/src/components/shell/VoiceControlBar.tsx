import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Headphones, Mic, MicOff, MonitorUp, PhoneOff, Signal, VolumeX } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { playMuteStateChangeTone, useVoiceJoinLeaveSounds } from '@/lib/voice-sounds'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

import { VoiceSettingsPopover } from './VoiceSettingsPopover'

import { api } from '../../../../../convex/_generated/api'

// Rodapé de voz do shell (Plano 03-02, redesenhado na correção pós-Windows).
//
// Era UMA linha de 56px com cinco botões de ícone e o texto de status
// espremido no que sobrasse. A conta, medida no 08.5-09-SUMMARY: 5 botões
// `size-8` + gaps + padding = ~216px dos 240px da coluna, ~24px para o texto.
// O Leo abriu o app em Windows e a primeira frase foi "está tudo muito
// apertado". Largura maior sozinha não resolve — 272px ainda deixariam ~56px
// para o texto. O que resolve é o que o Discord faz: EMPILHAR em faixas.
//
//   Faixa 1 (aqui)  status da call: "Voz conectada" + "{canal} / {servidor}",
//                   com desconectar à direita.
//   Faixa 2 (aqui)  ações da call, botões largos de largura igual.
//   Faixa 3 (`VoiceQuickControls`, montada pelo `AppShell` dentro da faixa do
//                   usuário) microfone, fone e configurações.
//
// Faixa 3 mora em outro lugar da árvore porque a faixa do usuário atravessa o
// rail de servidores (344px), e microfone/fone/engrenagem são controles do
// APARELHO, não da chamada: continuam alcançáveis sem nenhuma call ativa —
// inclusive o testador de microfone (VOICE-21).
//
// Sem botão morto: a faixa 2 do Discord tem vídeo, tela, atividades e
// soundboard; aqui só compartilhar tela existe de verdade, então só ele
// aparece, ocupando a largura toda. Se um dia outra ação existir, `flex-1` já
// divide o espaço em partes iguais.
export function VoiceControlBar(): React.JSX.Element | null {
  const { servers, joinedVoiceChannelId, setJoinedVoiceChannelId, showStage } = useSelection()
  const { connectionState, isSharing, startScreenShare, stopScreenShare } = useVoice()

  // Plano 07-07 (VOICE-17): observa `voiceStates` do canal conectado e toca
  // som de entrada/saída. Continua aqui, e agora com alcance maior: desde a
  // correção pós-Windows este componente é montado pelo `AppShell` nas duas
  // visões, então o som não depende mais de a sidebar de canais estar na tela.
  // Chamado ANTES de qualquer retorno — a regra dos hooks vale mesmo para o
  // caminho que não desenha nada.
  useVoiceJoinLeaveSounds()

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
  const isReconnecting =
    connectionState === 'reconnecting' || connectionState === 'signalReconnecting'

  // SHARE-01/02 (Plano 08-02): um único botão de alternância. Sem confirmação
  // e sem seletor aqui — quem pergunta qual tela/janela compartilhar é o
  // `ScreenSharePicker` (Plano 08-04), disparado pelo processo main.
  //
  // A qualidade ("Fluida"/"Nítida", SHARE-08) continua no popover de
  // configurações de voz, agora na faixa do usuário. O motivo original era
  // falta de largura; hoje é hierarquia: qualidade é preferência de máquina,
  // não ação de chamada.
  //
  // `voiceStates.sharing` no Convex também não é escrito daqui: quem escreve é
  // o listener de `LocalTrackPublished`/`LocalTrackUnpublished` em
  // `voice-context.tsx`, porque a track publicada é o fato, e o clique é só a
  // intenção.
  //
  // Não é `async`: `startScreenShare`/`stopScreenShare` nunca rejeitam (todo
  // erro, cancelamento incluso, já vira log dentro delas), e `isSharing` vem do
  // evento de publicação real do `Room`.
  function toggleScreenShare(): void {
    void (isSharing ? stopScreenShare() : startScreenShare())
  }

  function leaveVoiceChannel(): void {
    setJoinedVoiceChannelId(null)
  }

  // Sem intenção de voz, o rodapé inteiro deixa de existir — nem faixa, nem
  // borda, nem espaço reservado. Mesma decisão de ESPAÇO do Plano 08.5-09
  // ("desconectado não renderiza texto nenhum"), levada até o fim agora que os
  // controles que precisavam ficar sempre visíveis (microfone, fone,
  // configurações) moram na faixa do usuário. O salto de layout que o 08.5-09
  // evitava com um `div` vazio não existe mais: não há mais nada nesta faixa
  // para saltar.
  if (!hasIntention) return null

  const channelName = connectedChannel?.name
  const serverName = servers?.find((server) => server._id === connectedChannel?.serverId)?.name
  // "{canal} / {servidor}" é a segunda linha do Discord. Cai para só o canal
  // enquanto `getChannel` não resolveu ou quando o servidor não está na lista
  // (nunca deveria acontecer — `getChannel` exige participação —, mas o
  // fallback é mais barato que a suposição).
  const contextLine = [channelName, serverName].filter(Boolean).join(' / ')

  const statusLabel = isReconnecting
    ? 'Reconectando...'
    : isReady
      ? 'Voz conectada'
      : 'Conectando...'
  // `--success` / `--warning` são significado (qualidade de conexão), não
  // destaque — não contam contra a regra do tom único do Plano 08.5-01.
  const statusTone = isReconnecting ? 'text-warning' : isReady ? 'text-success' : 'text-foreground'

  const statusLines = (
    <>
      <span className={cn('flex w-full items-center gap-1.5 text-sm font-medium', statusTone)}>
        <Signal className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{statusLabel}</span>
      </span>
      <span className="w-full truncate text-xs text-muted-foreground">{contextLine}</span>
    </>
  )

  return (
    <div className="flex-none border-t border-border px-2 py-2">
      {/* FAIXA 1 — status da call */}
      <div className="flex items-center gap-1">
        {isReady ? (
          // Plano 08.5-03: o status conectado é o SEGUNDO caminho de volta ao
          // palco (o primeiro é clicar no canal de voz na sidebar). O contrato
          // é o gesto, não a frase: continua sendo o bloco de status inteiro
          // que leva ao palco, agora com o nome do canal na segunda linha em
          // vez de dentro do rótulo.
          <button
            type="button"
            onClick={showStage}
            aria-label="Voltar para a call"
            title="Voltar para a call"
            className="flex min-w-0 flex-1 flex-col items-start rounded-md px-1 py-0.5 text-left hover:bg-accent/50"
          >
            {statusLines}
          </button>
        ) : (
          // Conectando/reconectando não leva a palco nenhum: não há sala para
          // mostrar ainda, e um botão que não faz nada é pior que texto.
          <div className="flex min-w-0 flex-1 flex-col items-start px-1 py-0.5">{statusLines}</div>
        )}

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
      </div>

      {/* FAIXA 2 — ações da call. `variant="outline"` e não `ghost`: num tema
          monocromático o `bg-accent` do ghost é o mesmo cinza do fundo desta
          coluna e o botão sumiria em repouso. O outline traz borda + um véu
          mais claro, que é o que faz a faixa parecer clicável. */}
      <div className="mt-1.5 flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-w-0 flex-1"
          disabled={!isReady}
          aria-pressed={isSharing}
          onClick={toggleScreenShare}
        >
          <MonitorUp className={cn(isSharing && 'text-success')} />
          <span className="truncate">
            {isSharing ? 'Parar de compartilhar' : 'Compartilhar tela'}
          </span>
        </Button>
      </div>
    </div>
  )
}

// FAIXA 3 — controles rápidos, montados pelo `AppShell` ao lado do painel do
// usuário (ver a nota de disposição no topo deste arquivo).
//
// O estado de mute veio junto com os botões: `muted` é `useState` local — não
// porque é mock, mas porque não existe ainda (Plano 07-04) uma query pública
// de "minha linha de voiceStates" para ler a fonte da verdade do servidor. Por
// isso, ao completar um NOVO join, o estado local reseta para "destravado" —
// mesma linha de base que `upsertVoiceState` usa para uma linha nova.
//
// `deafened` NÃO é local: mora em `voice-context.tsx` desde o Plano 08.5-11,
// porque volume individual (VOICE-18) e ensurdecimento escrevem na MESMA
// propriedade das tracks remotas e um efeito só aplica os dois.
export function VoiceQuickControls(): React.JSX.Element {
  const { joinedVoiceChannelId } = useSelection()
  const { room, connectionState, setManualMute, deafened, setDeafened } = useVoice()

  const setMutedMutation = useMutation(api.voice.setMuted)
  const setDeafenedMutation = useMutation(api.voice.setDeafened)

  const [muted, setMutedState] = useState(false)

  const hasIntention = joinedVoiceChannelId !== null
  const isReady = hasIntention && connectionState === 'connected'

  // Reconciliação mínima ao (re)conectar: uma nova intenção de join sempre
  // nasce destravada — não dispara em reconexões automáticas do próprio
  // LiveKit (connectionState oscilando connected -> reconnecting -> connected
  // sem `joinedVoiceChannelId` mudar), só quando o usuário de fato troca de
  // canal de voz. Ajuste de estado durante o render (não dentro de um
  // `useEffect`) — padrão recomendado pelo React para "resetar estado quando
  // uma prop muda", sem o commit extra de um efeito rodando depois do primeiro
  // paint. O reset do ENSURDECER não está aqui de propósito: acontece dentro
  // de `voice-context.tsx`, no join bem-sucedido (Plano 08.5-11).
  const [syncedChannelId, setSyncedChannelId] = useState(joinedVoiceChannelId)
  if (joinedVoiceChannelId !== syncedChannelId) {
    setSyncedChannelId(joinedVoiceChannelId)
    if (joinedVoiceChannelId !== null) {
      setMutedState(false)
    }
  }

  async function toggleMuted(): Promise<void> {
    const next = !muted
    try {
      await setMutedMutation({ muted: next })
    } catch (err) {
      console.error('[voice] setMuted falhou', err)
      return
    }
    // Plano 07-05: sincroniza o mute manual com o VAD ANTES de tocar na track —
    // sem isso, um monitor de VAD já em andamento poderia reabrir o microfone
    // no instante seguinte se a pessoa estivesse falando.
    setManualMute(next)
    // VOICE-16: mesmo neste caminho de toggle (que na prática só muta/desmuta a
    // track já publicada com as opções do join), as três opções são passadas de
    // novo explicitamente. Nunca ficam implícitas em nenhum caminho que
    // habilita o microfone.
    await room.localParticipant.setMicrophoneEnabled(!next, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    })
    setMutedState(next)
    // Plano 07-11: tom de mute/desmute do PRÓPRIO microfone. Chamado SÓ aqui —
    // o único lugar onde a mudança de mute é uma decisão manual real. Nunca do
    // VAD nem do push-to-talk (`voice-context.tsx`), nem do lado "ensurdecer
    // implica mutar" de `toggleDeafened`.
    playMuteStateChangeTone(next)
    // Desativar mute enquanto ensurdecido também desativa o ensurdecimento — a
    // mutation já aplicou essa semântica no servidor (design §8); aqui só
    // refletimos o resultado na UI e na reprodução local.
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
    // Plano 08.5-11: esta chamada é o que atualiza o ícone (o estado mora no
    // contexto), o que faz o efeito de volume de lá reexecutar zerando ou
    // restaurando a reprodução de todo mundo, e o que informa ao tom de "eu
    // saí" que ele deve ficar em silêncio (Plano 07-11). Uma chamada, três
    // consequências, um lugar só.
    setDeafened(next)
    // Ativar deafen implica mute (design §8) — a mutation já aplicou isso no
    // servidor; aqui refletimos no microfone real e no ícone.
    if (next && !muted) {
      setManualMute(true)
      await room.localParticipant.setMicrophoneEnabled(false)
      setMutedState(true)
    }
  }

  return (
    <div className="flex flex-none items-center gap-0.5">
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

      {/* Plano 07-09: sempre renderizado, não só com `hasIntention` — o
          testador de microfone (VOICE-21) precisa ser alcançável sem nenhum
          canal conectado. As seções que dependem de um `Room` real continuam
          gated por `hasVoiceIntention` dentro do próprio popover. */}
      <VoiceSettingsPopover disabled={hasIntention && !isReady} hasVoiceIntention={hasIntention} />
    </div>
  )
}
