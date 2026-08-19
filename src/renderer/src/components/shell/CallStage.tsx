import { useQuery } from 'convex/react'
import {
  Eye,
  EyeOff,
  Maximize2,
  MicOff,
  Minimize2,
  Users,
  Volume2,
  VolumeX,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  ConnectionQualityIcon,
  ParticipantStrip,
  initialsFor,
  useVoiceParticipants,
  type VoiceParticipantView
} from '@/components/shell/ParticipantStrip'
import { ScreenShareStage, ScreenSharePreviewNotice } from '@/components/shell/ScreenShareStage'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DEFAULT_PARTICIPANT_VOLUME,
  MAX_PLAYBACK_VOLUME,
  type ParticipantAudioPreference
} from '@/lib/participant-volumes'
import { cn } from '@/lib/utils'
import { useLayout } from '@/state/layout-context'
import { useSelection } from '@/state/selection-context'
import { useVoice } from '@/state/voice-context'

import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

// Palco da call (Plano 08.5-03, layout de compartilhamento no Plano 08.5-07).
//
// O arquivo nasceu de `ConversationArea.tsx` por MOVIMENTO, não por reescrita.
// No Plano 08.5-07 ele se dividiu de novo, também por movimento:
//
// - `ScreenShareStage.tsx` — a região de vídeo e o `ScreenShareTile`, com o
//   `useEffect` de `attach`/`detach` da Fase 8 intocado (a prova por `diff`
//   está no summary do plano).
// - `ParticipantStrip.tsx` — a faixa horizontal de participantes E as regras
//   comuns de participante de voz (`initialsFor`, `ConnectionQualityIcon`,
//   `useVoiceParticipants`), que a grade abaixo importa em vez de duplicar.
//
// A importação vai só numa direção (`CallStage` → os dois arquivos novos), de
// propósito: `ParticipantStrip` importando de volta daqui criaria ciclo.

// VOICE-18 (Plano 08.5-11): o passo dos itens de teclado, em porcentagem. O
// slider anda de 5 em 5 (arrastar é fino); os itens do menu andam de 10 em 10,
// porque cada passo custa um Enter.
const VOLUME_KEYBOARD_STEP = 10
const MAX_VOLUME_PERCENT = Math.round(MAX_PLAYBACK_VOLUME * 100)

function toPercent(volume: number): number {
  return Math.min(MAX_VOLUME_PERCENT, Math.max(0, Math.round(volume * 100)))
}

// Ladrilho da grade do palco. Quando o participante é OUTRA pessoa no canal ao
// qual eu estou de fato conectado, ele vira gatilho do menu de áudio individual
// — mesmo padrão único de menu da fase (Plano 08.5-02/08.5-04): um
// `DropdownMenu` controlado, aberto por clique/Enter no `<button>` e pelo botão
// direito no mesmo elemento. Sem `context-menu` do Radix, que não foi instalado
// de propósito.
//
// Sem menu em dois casos, os dois deliberados:
// - EU MESMO: não me ouço, então volume da minha própria voz aqui não existe.
// - Canal apenas VISUALIZADO (prévia, não conectado): não há track tocando
//   para ajustar, e o menu prometeria um efeito que não aconteceria.
// Nesses casos o ladrilho volta a ser exatamente o `<div>` que era antes deste
// plano — nenhuma semântica de botão para quem não tem ação.
function ParticipantTile({
  participant,
  preference,
  onVolumeChange,
  onToggleSilenced
}: {
  participant: VoiceParticipantView
  preference: ParticipantAudioPreference | undefined
  onVolumeChange: ((volume: number) => void) | null
  onToggleSilenced: (() => void) | null
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const silenced = preference?.silenced ?? false
  const percent = toPercent(preference?.volume ?? DEFAULT_PARTICIPANT_VOLUME)
  const hasMenu = onVolumeChange !== null && onToggleSilenced !== null

  const tile = (
    <>
      <div className="relative">
        {/* Silenciado para mim precisa APARECER: sem isso o usuário esquece
            que silenciou alguém e conclui que a pessoa sumiu da call ou que o
            microfone dela quebrou. Opacidade + ícone, os dois — cor sozinha
            não é sinal acessível. */}
        <Avatar
          className={cn(
            'size-20',
            participant.isSpeaking && 'ring-4 ring-success',
            silenced && 'opacity-60'
          )}
        >
          <AvatarFallback className="text-lg">{initialsFor(participant.username)}</AvatarFallback>
        </Avatar>
        {participant.muted ? (
          <span className="absolute bottom-0 right-0 flex size-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground ring-2 ring-background">
            <MicOff className="size-3.5" aria-hidden="true" />
          </span>
        ) : null}
        {silenced ? (
          // Canto superior ESQUERDO, a mesma vaga livre que a faixa usa para
          // "compartilhando" — o canto inferior direito é do mute (que é da
          // PESSOA) e os dois não podem se sobrepor, porque significam coisas
          // diferentes: um é o microfone dela, o outro é a minha decisão.
          <span
            className="absolute -left-0.5 -top-0.5 flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground ring-2 ring-background"
            aria-label="Silenciado para mim"
          >
            <VolumeX className="size-3.5" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-foreground">{participant.username}</span>
        {/* Mesmo argumento do ícone acima, para o caso menos óbvio: um volume
            baixado e esquecido é indistinguível de "essa pessoa fala baixo". */}
        {!silenced && percent !== 100 ? (
          <span className="text-xs text-muted-foreground">{percent}%</span>
        ) : null}
        <ConnectionQualityIcon quality={participant.quality} />
      </div>
    </>
  )

  if (!hasMenu) {
    return <div className="flex flex-col items-center gap-2">{tile}</div>
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Opções de áudio de ${participant.username}`}
          className="flex flex-col items-center gap-2 rounded-md p-1"
          onContextMenu={(event) => {
            event.preventDefault()
            setOpen(true)
          }}
        >
          {tile}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-60">
        <DropdownMenuLabel className="truncate">{participant.username}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* O slider NÃO é um `DropdownMenuItem`: item de menu captura as setas
            para a navegação do próprio menu e "selecionar" fecharia o menu a
            cada arrasto. Fica numa área não-item, com `onKeyDown` parando a
            propagação para que ArrowLeft/ArrowRight cheguem ao `Slider` em vez
            de virarem navegação.

            ISTO NÃO PÔDE SER VERIFICADO AQUI (WSL2, sem janela: nenhum pixel
            foi renderizado nesta execução). Por isso o teclado NÃO depende
            dele: os dois itens logo abaixo fazem a mesma coisa e são
            acessíveis por construção. Se o slider se provar bom no checkpoint
            humano, os itens podem sair; se ele se provar ruim, o slider sai e
            os itens ficam. Os dois caminhos escrevem no mesmo lugar. */}
        <div
          className="px-2 py-1.5"
          onKeyDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Volume</span>
            <span>{percent}%</span>
          </div>
          <Slider
            value={[percent]}
            min={0}
            max={MAX_VOLUME_PERCENT}
            step={5}
            aria-label={`Volume de ${participant.username}`}
            onValueChange={(values) => onVolumeChange((values[0] ?? 100) / 100)}
          />
        </div>

        {/* `preventDefault` no `onSelect` mantém o menu aberto: ajustar volume
            é uma ação repetida, e fechar a cada 10% obrigaria a reabrir o menu
            para cada passo. */}
        <DropdownMenuItem
          disabled={percent >= MAX_VOLUME_PERCENT}
          onSelect={(event) => {
            event.preventDefault()
            onVolumeChange(Math.min(MAX_VOLUME_PERCENT, percent + VOLUME_KEYBOARD_STEP) / 100)
          }}
        >
          Aumentar volume
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={percent <= 0}
          onSelect={(event) => {
            event.preventDefault()
            onVolumeChange(Math.max(0, percent - VOLUME_KEYBOARD_STEP) / 100)
          }}
        >
          Diminuir volume
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* "PARA MIM" é obrigatório no rótulo, e não é preciosismo: sem essas
            duas palavras o usuário acredita que mutou a pessoa para a call
            inteira. Isso seria MODERAÇÃO — coisa de cargo, que não existe
            neste app e está explicitamente fora desta fase. O que este item faz
            é reprodução local, e só. */}
        <DropdownMenuItem onSelect={onToggleSilenced}>
          {silenced ? 'Ouvir de novo' : 'Silenciar para mim'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Grid de participantes de um canal de voz (Plano 07-04) — dado real de
// `voiceStates` via `api.voice.voiceParticipantsByChannel`, em versão
// grande (~80px), com o mesmo padrão de anel verde para "falando" e ícone
// de mute sobre o avatar que a Fase 3 desenhou sobre o mock. Esta tela pode
// mostrar um canal diferente do canal ao qual o `Room` local está
// conectado (usuário navegando para ver quem está lá sem entrar) — mute
// sempre vem de `voiceStates` (visível para qualquer um), mas anel de fala
// e qualidade de conexão só existem para o canal realmente conectado. Essa
// combinação mora em `useVoiceParticipants`.
//
// Plano 08.5-11: é também por aqui que se chega ao volume individual
// (VOICE-18) — cada ladrilho de OUTRA pessoa vira gatilho do menu de áudio.
// Ver `ParticipantTile` acima para os dois casos sem menu.
export function VoiceParticipantGrid({
  channelId
}: {
  channelId: Id<'channels'>
}): React.JSX.Element {
  const { joinedVoiceChannelId } = useSelection()
  const { room, participantVolumes, setParticipantVolume, toggleParticipantSilenced } = useVoice()
  const participants = useVoiceParticipants(channelId)

  // Canal de voz apenas VISUALIZADO (não conectado): não existe track para
  // exibir, mas o convite "Entre no canal para ver a tela compartilhada" volta
  // aqui — ele se perdeu no Plano 08.5-03 quando a região de vídeo saiu da
  // prévia, e este plano é o dono da região (pendência registrada no
  // 08.5-03-SUMMARY.md, desvio 3). Mora dentro da grade porque a grade é a
  // única coisa que a prévia renderiza, e `ConversationArea.tsx` não é arquivo
  // deste plano. Dentro do palco esta condição é sempre falsa: o palco só
  // existe para o canal CONECTADO (regra 1 de `resolveMainView`).
  const isConnectedHere = channelId === joinedVoiceChannelId

  if (!participants || participants.length === 0) {
    return (
      <>
        <div className="text-sm text-muted-foreground">Nenhum participante conectado</div>
        {isConnectedHere ? null : <ScreenSharePreviewNotice />}
      </>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-center gap-6">
        {participants.map((participant) => {
          // `room.localParticipant.identity` é o `users._id` do Convex — a
          // MESMA chave de `voiceParticipantsByChannel`, de `speakingUserIds` e
          // do mapa de volumes (07-RESEARCH.md §6). Comparar por ela evita uma
          // query nova só para descobrir quem sou eu.
          const isSelf = participant.userId === room.localParticipant.identity
          const canControl = isConnectedHere && !isSelf

          return (
            <ParticipantTile
              key={participant.userId}
              participant={participant}
              preference={participantVolumes[participant.userId]}
              onVolumeChange={
                canControl ? (volume) => setParticipantVolume(participant.userId, volume) : null
              }
              onToggleSilenced={
                canControl ? () => toggleParticipantSilenced(participant.userId) : null
              }
            />
          )
        })}
      </div>
      {isConnectedHere ? null : <ScreenSharePreviewNotice />}
    </>
  )
}

// Estados de visualização do palco. LOCAL do componente, de propósito: não vai
// para o `SelectionContext` nem para o `localStorage`. É estado de momento — e
// persistir "expandido" faria o app abrir numa call antiga em tela cheia.
type StageLayout = 'tiles' | 'share' | 'share-expanded'

// Botão de ícone da barra/overlay do palco. Ícone sem texto visível ganha
// tooltip (convenção da fase) e o `aria-label` descreve a AÇÃO do clique. O
// anel de foco vem do próprio `Button` e é obrigatório aqui: no layout
// expandido estes botões são a única saída além do Esc.
function StageIconButton({
  icon: Icon,
  label,
  onClick
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// Alternar a lista de membros a partir do palco (Plano 08.5-07, sobre o
// `layout-context` do Plano 08.5-05). É o MESMO botão do `ChannelHeader`, com o
// mesmo contexto e o mesmo estado: entrar numa call não pode tirar do usuário um
// controle que ele tinha na visão de texto — e é justamente na call que os
// 240px da coluna de membros fazem mais falta, porque a área grande é vídeo.
//
// `aria-label` descreve a AÇÃO (o que o clique faz) e `aria-pressed` expõe o
// ESTADO, igual ao original.
function StageMembersToggle(): React.JSX.Element {
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

// Controles do compartilhamento no palco. Só existem quando há tela no ar —
// botão que não tem o que fazer não aparece.
//
// "Ocultar tela" NÃO para o compartilhamento: quem para é o botão do rodapé
// (`VoiceControlBar`), e o rótulo tem que deixar isso claro, porque confundir
// os dois é derrubar a tela de todo mundo achando que está limpando a própria.
//
// O botão "Mostrar tela" (layout `tiles` com track no ar) não está escrito no
// plano e é obrigatório: sem ele, ocultar seria uma porta de mão única — o
// usuário só reveria a tela se o apresentador parasse e recomeçasse.
function ShareLayoutControls({
  layout,
  shareCount,
  onLayoutChange
}: {
  layout: StageLayout
  shareCount: number
  onLayoutChange: (layout: StageLayout) => void
}): React.JSX.Element | null {
  if (shareCount === 0) return null

  return (
    <>
      {layout === 'tiles' ? (
        <StageIconButton
          icon={Eye}
          label="Mostrar tela compartilhada"
          onClick={() => onLayoutChange('share')}
        />
      ) : null}
      {layout !== 'tiles' ? (
        <StageIconButton
          icon={EyeOff}
          label="Ocultar tela compartilhada"
          onClick={() => onLayoutChange('tiles')}
        />
      ) : null}
      {layout === 'share' ? (
        <StageIconButton
          icon={Maximize2}
          label="Expandir tela compartilhada"
          onClick={() => onLayoutChange('share-expanded')}
        />
      ) : null}
      {layout === 'share-expanded' ? (
        <StageIconButton
          icon={Minimize2}
          label="Restaurar tamanho da tela compartilhada"
          onClick={() => onLayoutChange('share')}
        />
      ) : null}
    </>
  )
}

// Barra do palco (Plano 08.5-03; botões no Plano 08.5-07): mesma altura do
// `ChannelHeader` (h-12) e a mesma borda, para que a linha do topo da janela não
// pule ao alternar entre texto e call. O `ChannelHeader` NÃO é renderizado no
// modo palco — ele descreve o canal SELECIONADO, que durante uma call pode ser
// um canal de texto qualquer, e um cabeçalho descrevendo outra coisa que não
// está na tela é pior que nenhum.
//
// Duas queries, nenhuma subscrição nova: `getChannel` é a mesma que o
// `ChannelHeader` e a `VoiceControlBar` já assinam, e
// `voiceParticipantsByChannel` é a mesma de `useVoiceParticipants` —
// o cliente do Convex compartilha subscrição por query+args.
//
// Janela estreita (o mínimo é 900×600, e o palco divide a largura com rail 72 +
// sidebar 240 + membros 240): só o NOME cede. `min-w-0 flex-1 truncate` no nome
// — os dois são necessários, porque item flex tem `min-width: auto` e o
// `truncate` sozinho não vence isso — e `shrink-0` na contagem e nos botões,
// que não podem ser espremidos até virarem retângulos ilegíveis.
function StageBar({
  channelId,
  layout,
  shareCount,
  onLayoutChange
}: {
  channelId: Id<'channels'>
  layout: StageLayout
  shareCount: number
  onLayoutChange: (layout: StageLayout) => void
}): React.JSX.Element {
  const channel = useQuery(api.channels.getChannel, { channelId })
  const participants = useQuery(api.voice.voiceParticipantsByChannel, { channelId })
  const count = participants?.length ?? 0

  return (
    <div className="flex-none h-12 flex items-center gap-3 px-4 border-b border-border">
      <Volume2 className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
        {channel?.name ?? '...'}
      </span>
      <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
        {count === 1 ? '1 participante' : `${count} participantes`}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <ShareLayoutControls
          layout={layout}
          shareCount={shareCount}
          onLayoutChange={onLayoutChange}
        />
        <StageMembersToggle />
      </div>
    </div>
  )
}

// O palco da call: barra própria, região de vídeo, ladrilhos de participantes e
// faixa de participantes — nesta ordem NA ÁRVORE, que não é a ordem na tela (ver
// os `order-*` abaixo).
//
// A REGRA QUE MANDA NESTE COMPONENTE (08-06-SUMMARY.md): enquanto a track
// existir, o `<video>` NÃO pode ser desmontado por causa de layout. `detach()`
// do SDK só zera `srcObject`; quem tira o elemento da tela é o React ao
// desmontar o `ScreenShareTile`, e é isso que garante que o frame não congela.
// Por isso:
//
// - `<ScreenShareStage />` aparece UMA vez no JSX, sem `&&` e sem ternário em
//   volta, sempre na mesma posição da árvore. Trocar de layout troca a CLASSE
//   do container; nunca a existência do componente.
// - a reordenação visual (vídeo em cima no modo compartilhamento, embaixo no
//   modo ladrilhos) é feita com `order-*` do flexbox, não movendo o nó de
//   lugar — mover na árvore é desmontar e remontar, e remontar é reanexar.
// - a barra e a faixa somem com `hidden`, também sem desmontar: elas assinam
//   queries do Convex e piscar subscrição a cada expandir/restaurar é ruído
//   gratuito.
//
// Por que NÃO virou `ScrollArea` (a convenção da fase pediria): o `Viewport` do
// Radix embrulha os filhos num elemento `display: table`, o pai deixa de ser
// flex e o `flex-1` da região de vídeo vira letra morta. Regressão de vídeo é
// pior que um `overflow-y-auto` sobrevivente.
//
// `bg-stage`: fundo próprio, mais escuro que o `--background` da área de texto
// (decisão do usuário em 2026-08-19, pendência aberta pelo Plano 08.5-03; o
// token nasceu no commit `affdd51`, em `main.css`). A escala do app é
// `--sidebar` > `--background` > `--stage` — o palco é o fundo do poço.
//
// Só a RAIZ é repintada. Barra, ladrilhos e faixa continuam sem fundo próprio:
// o ponto do fundo mais escuro é que o conteúdo se destaque CONTRA ele, e
// repintar tudo devolveria o palco à monocromia da qual ele acabou de sair.
export function CallStage({ channelId }: { channelId: Id<'channels'> }): React.JSX.Element {
  const { joinedVoiceChannelId } = useSelection()
  const { screenShareTracks } = useVoice()

  // Mesma regra do `ScreenShareStage`: vídeo é dado efêmero do `Room` e só
  // existe para o canal realmente conectado. Na prática o palco só é renderizado
  // para o canal conectado, mas a decisão de layout não depende disso ser
  // verdade em todo caminho futuro.
  const shareCount = channelId === joinedVoiceChannelId ? screenShareTracks.length : 0

  const [layout, setLayout] = useState<StageLayout>(shareCount > 0 ? 'share' : 'tiles')

  // Transições automáticas do layout, ajustadas DURANTE a renderização e não num
  // `useEffect` — é o padrão documentado do React para "estado que se ajusta
  // quando uma entrada muda", e evita o render em cascata (o palco apareceria
  // com o layout velho por um quadro antes de corrigir). O `setLayout` só roda
  // quando `shareCount` de fato mudou, então não há laço.
  const [previousShareCount, setPreviousShareCount] = useState(shareCount)
  if (previousShareCount !== shareCount) {
    setPreviousShareCount(shareCount)

    if (shareCount === 0) {
      // Sem tela no ar não há o que mostrar — inclusive quando a última some com
      // o palco expandido, e aí voltar sozinho é o que impede o usuário de ficar
      // preso numa tela cheia vazia.
      setLayout('tiles')
    } else if (previousShareCount === 0) {
      // Primeira tela aparecendo toma o palco. A segunda não muda nada: se o
      // usuário acabou de ocultar, reabrir na cara dele seria briga.
      setLayout('share')
    }
  }

  // Esc sai do expandido. O listener só existe enquanto expandido — fora disso
  // Esc pertence a quem estiver aberto por cima (diálogo, menu, tooltip).
  //
  // `defaultPrevented` é a única defesa possível daqui contra roubar o Esc de
  // uma camada do Radix que esteja aberta em cima do palco. Não é garantia: o
  // Radix nem sempre chama `preventDefault` ao fechar. Item do checkpoint
  // humano — não há como observar isto sem tela.
  useEffect(() => {
    if (layout !== 'share-expanded') return

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setLayout('share')
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [layout])

  const isExpanded = layout === 'share-expanded'

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-stage text-stage-foreground">
      {/* O `hidden` vai no INVÓLUCRO, não na barra: `hidden` e `flex` são o
          mesmo tipo de utilitário (display) e qual vence depende da ordem no CSS
          gerado, não da ordem no atributo. */}
      <div className={cn('flex-none', isExpanded && 'hidden')}>
        <StageBar
          channelId={channelId}
          layout={layout}
          shareCount={shareCount}
          onLayoutChange={setLayout}
        />
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {/* REGIÃO DE VÍDEO — posição fixa na árvore, tamanho pela classe. */}
        <div
          className={cn(
            'relative',
            layout === 'tiles' && 'order-2 flex-none px-8 pb-8',
            layout === 'tiles' && shareCount > 0 && 'hidden',
            layout === 'share' && 'order-1 flex-1 min-h-0 p-4',
            isExpanded && 'order-1 flex-1 min-h-0'
          )}
        >
          <ScreenShareStage channelId={channelId} />
          {isExpanded ? (
            <div className="absolute right-3 top-3 flex items-center gap-1 rounded-md border border-border bg-background/90 p-1">
              <ShareLayoutControls
                layout={layout}
                shareCount={shareCount}
                onLayoutChange={setLayout}
              />
            </div>
          ) : null}
        </div>

        <div
          className={cn(
            'order-1 flex-1 min-h-0 flex flex-col items-center gap-4 overflow-y-auto p-8',
            layout !== 'tiles' && 'hidden'
          )}
        >
          <VoiceParticipantGrid channelId={channelId} />
        </div>

        {/* A faixa: altura fixa, `flex-none`, e some com `hidden` nos outros dois
            layouts. */}
        <div
          className={cn(
            'order-3 flex-none h-20 border-t border-border px-4',
            layout !== 'share' && 'hidden'
          )}
        >
          <ParticipantStrip channelId={channelId} />
        </div>
      </div>
    </div>
  )
}
