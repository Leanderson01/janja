import { useEffect, useState } from 'react'
import { MonitorIcon, AppWindowIcon, Volume2Icon, VolumeXIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  loadScreenSharePreferences,
  saveScreenSharePreferences
} from '@/lib/screenshare-preferences'

// SHARE-01 (Plano 08-04): o seletor de tela/janela. O Electron não tem picker
// nativo no Windows — a UI de escolha é responsabilidade do app
// (08-RESEARCH.md §2), e é esta.
//
// O fluxo inteiro é dirigido pelo processo main, não por este componente: o
// clique em "Compartilhar tela" chama `setScreenShareEnabled` → o Chromium
// dispara `getDisplayMedia` → `src/main/screenshare.ts` enumera as fontes e
// manda a lista para cá. Este componente só existe entre esses dois momentos.
//
// ------------------------------------------------------------------
// A regra que não pode ser quebrada aqui (Pitfall 2): enquanto este diálogo
// está aberto, o processo main está segurando o `callback` do
// `setDisplayMediaRequestHandler`, e a Promise de `getDisplayMedia()` no
// renderer está pendurada. Se o diálogo fechar sem chamar `chooseSource` NEM
// `cancelPicker`, essa Promise nunca resolve nem rejeita: a UI fica
// carregando e toda tentativa seguinte de compartilhar trava junto. Por isso
// existe exatamente UM lugar que fecha o diálogo por desistência
// (`cancel()`), e ele é ligado ao `onOpenChange` do Radix — que cobre Esc,
// clique fora e o X do canto de uma vez só, não só o botão "Cancelar".
//
// O processo main tem timeout de 60s como rede de segurança, mas ele é a
// última linha, não a primeira: 60s de UI travada já é um defeito.
// ------------------------------------------------------------------
//
// ------------------------------------------------------------------
// A correção do eco (Pitfall 1, relatado em uso real em 2026-08-20) trouxe o
// segundo controle deste diálogo: o áudio de sistema, que antes ia sempre
// junto e sem aviso. Ele vive AQUI, e não só nas configurações de voz, porque
// é aqui que a pergunta é feita — "vou compartilhar o quê" e "com som ou sem"
// são a mesma decisão, no mesmo clique. A preferência persiste em
// `screenshare-preferences.ts` (estado de máquina), então quem sempre
// compartilha com som marca uma vez e segue a vida.
//
// Fase 8.6 reescreveu o que esse controle PROMETE, porque o que ele faz
// mudou. O áudio deixou de ser loopback de dispositivo (tudo que sai pela
// saída de som, inclusive a voz dos outros participantes que este app está
// tocando) e passou a ser loopback POR PROCESSO em modo EXCLUIR: o Windows
// captura o computador inteiro MENOS a árvore de processos deste app. O
// ganho é a voz dos outros ficando de fora; o preço é que continua indo tudo
// o mais — Spotify, notificação, o vídeo da outra aba. Não é "o áudio da
// janela que você escolheu", e quem tem música tocando precisa saber disso
// ANTES de clicar, não depois de alguém comentar na call.
// ------------------------------------------------------------------
export function ScreenSharePicker(): React.JSX.Element {
  // `null` = nenhum pedido em andamento (diálogo fechado). Não é `[]`: lista
  // vazia nunca chega aqui, o main resolve esse caso sozinho.
  const [request, setRequest] = useState<ScreenSharePickRequest | null>(null)
  // Lido do disco a cada abertura, nunca só no mount: as configurações de voz
  // podem ter mexido na preferência desde a última vez, e um estado inicial
  // preso no mount mostraria o toggle mentindo sobre o que vai acontecer.
  const [systemAudio, setSystemAudio] = useState(false)

  useEffect(() => {
    // Mesmo padrão de `onAuthChange` em `useAuth`: o preload devolve a função
    // de remoção do listener, e ela é o cleanup do efeito.
    if (!window.screenshare) return undefined
    return window.screenshare.onPickRequested((incoming) => {
      setSystemAudio(loadScreenSharePreferences().systemAudio)
      setRequest(incoming)
    })
  }, [])

  function toggleSystemAudio(): void {
    // Guarda redundante com o `disabled` do botão, de propósito: a
    // preferência é de MÁQUINA e sobrevive à sincronização de conta em outro
    // computador. Numa máquina que não suporta áudio por processo, o toggle
    // não pode APAGAR a escolha que a pessoa fez no computador que suporta —
    // ela continua lá, intacta, esperando voltar.
    if (audioUnavailable) return
    const next = saveScreenSharePreferences({ systemAudio: !systemAudio })
    setSystemAudio(next.systemAudio)
  }

  function choose(sourceId: string): void {
    // IPC primeiro, estado depois: destravar o processo main é o que não pode
    // falhar. Fechar o diálogo é cosmético em comparação.
    //
    // `systemAudio` viaja junto porque o processo main é quem CONCEDE o
    // loopback, e sem esse valor ele concederia sempre — que era exatamente o
    // defeito. Ver `ScreenShareChoice` em `src/main/screenshare-types.ts`.
    //
    // O E lógico com a capacidade da máquina é defesa em profundidade e o
    // lado restritivo vence: numa máquina sem áudio por processo, pedir áudio
    // só poderia ser atendido pelo caminho VELHO (loopback de dispositivo), e
    // esse caminho é justamente o que devolve o eco de 2026-08-20. A
    // preferência salva não é tocada — só o que sai neste pedido.
    window.screenshare.chooseSource({ sourceId, systemAudio: systemAudio && !audioUnavailable })
    setRequest(null)
  }

  function cancel(): void {
    window.screenshare.cancelPicker()
    setRequest(null)
  }

  function handleOpenChange(nextOpen: boolean): void {
    // Só chega aqui por interação do usuário (Esc, clique fora, X). Fechar
    // por `choose()` muda a prop `open` diretamente e NÃO passa por aqui —
    // então escolher nunca dispara um `cancelPicker` em seguida.
    if (!nextOpen) cancel()
  }

  const sources = request?.sources ?? null
  const screens = sources?.filter((source) => source.isScreen) ?? []
  const windows = sources?.filter((source) => !source.isScreen) ?? []

  // ------------------------------------------------------------------
  // `audioAvailable` MUDOU DE SIGNIFICADO na Fase 8.6 (mesmo nome, mesmo
  // tipo). Era "o renderer chegou a PEDIR áudio nesta chamada de
  // `getDisplayMedia()`" — e era por isso que existia aqui um aviso, agora
  // removido, dizendo que ligar o toggle só valeria no próximo
  // compartilhamento: a constraint da chamada em curso já estava fechada.
  //
  // Agora quer dizer "esta MÁQUINA suporta áudio por processo"
  // (`isProcessAudioSupported()`, `src/main/screenshare-audio.ts`), e a
  // captura de áudio começa DEPOIS que este diálogo fecha, relendo a
  // preferência persistida. Ligar vale para ESTA transmissão — o aviso virou
  // mentira e foi apagado, não reescrito.
  //
  // `audioUnavailableReason` é o irmão opcional do campo, e é lido de forma
  // tolerante porque ele pode simplesmente não vir (versão anterior do main,
  // falha que não soube se classificar): sem motivo, o texto genérico.
  // ------------------------------------------------------------------
  const audioUnavailable = request?.audioAvailable === false
  const audioUnavailableText = audioUnavailable
    ? describeAudioUnavailable(readAudioUnavailableReason(request))
    : null

  return (
    <Dialog open={request !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compartilhar tela</DialogTitle>
          <DialogDescription>Escolha uma tela ou uma janela para transmitir.</DialogDescription>
        </DialogHeader>

        {/* O áudio é uma ESCOLHA, e uma escolha informada. O texto embaixo
            não é disclaimer defensivo: é o que a pessoa vai VIVER na call,
            escrito antes de ela descobrir sozinha com o Spotify tocando. As
            duas frases são verdadeiras ao mesmo tempo, e nenhuma delas pode
            sumir — a primeira é o preço do modo EXCLUIR (vai o computador
            inteiro), a segunda é o ganho (a voz dos outros não vai). */}
        <div className="border-border flex flex-col gap-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              {systemAudio && !audioUnavailable ? (
                <Volume2Icon className="size-4" />
              ) : (
                <VolumeXIcon className="text-muted-foreground size-4" />
              )}
              Compartilhar áudio do sistema
            </span>
            <Button
              type="button"
              size="sm"
              variant={systemAudio && !audioUnavailable ? 'default' : 'outline'}
              // Sem `aria-pressed` quando indisponível: o botão deixa de ser
              // um interruptor com dois estados e vira um aviso. Dizer
              // "não pressionado" seria descrever a preferência salva, que
              // não é o que está acontecendo na tela.
              aria-pressed={audioUnavailable ? undefined : systemAudio}
              disabled={audioUnavailable}
              aria-disabled={audioUnavailable}
              aria-describedby={audioUnavailable ? AUDIO_UNAVAILABLE_TEXT_ID : undefined}
              onClick={toggleSystemAudio}
            >
              {audioUnavailable ? 'Indisponível' : systemAudio ? 'Ligado' : 'Desligado'}
            </Button>
          </div>

          {audioUnavailable ? (
            /* O motivo fica na tela porque a limitação é da MÁQUINA, e a
               pessoa merece saber disso em vez de achar que o app quebrou ou
               que ela clicou errado. */
            <p id={AUDIO_UNAVAILABLE_TEXT_ID} className="text-xs font-medium text-amber-500">
              {audioUnavailableText}
            </p>
          ) : systemAudio ? (
            <p className="text-muted-foreground text-xs">
              Vai junto tudo que o computador estiver tocando — o que você compartilha, mas também
              música, vídeos de outras abas e sons de notificação. A voz das outras pessoas da call
              fica de fora.
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              A tela vai sem som. Ligar vale já para esta transmissão.
            </p>
          )}
        </div>

        {/* Área rolável pelo ScrollArea do shadcn, como o resto do app (Fase
            8.5). O wrapper flex NÃO é enfeite: o viewport do Radix é `size-full`
            (height: 100%), e 100% de um pai de altura automática resolve para
            `auto` — com `max-h-[60vh]` direto no ScrollArea o viewport cresceria
            com o conteúdo, nunca rolaria, e a lista vazaria para fora do
            DialogContent. `max-h` no container flex + `min-h-0 flex-1` no filho
            dá ao viewport uma altura definida (o mesmo idioma de MessageList e
            do RESEARCH da F3), mantendo o diálogo curto quando há poucas fontes.
            `pr-1` fica no ScrollArea: a barra do Radix é absoluta na borda do
            root, então o padding vira o respiro entre ela e os cards. */}
        <div className="flex max-h-[60vh] flex-col">
          <ScrollArea className="min-h-0 flex-1 pr-1">
            <SourceSection icon="screen" title="Telas" sources={screens} onChoose={choose} />
            <SourceSection icon="window" title="Janelas" sources={windows} onChoose={choose} />
          </ScrollArea>
        </div>

        <DialogFooter>
          {/* Redundante com Esc/clique fora/X de propósito: é o caminho
              descoberto sem tentativa e erro, e todos terminam em cancel(). */}
          <Button variant="secondary" onClick={cancel}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// O id existe para o `aria-describedby` do botão desabilitado: um botão
// `disabled` sai da ordem de foco, então o motivo precisa estar amarrado a
// ele por relação explícita, não por proximidade visual.
const AUDIO_UNAVAILABLE_TEXT_ID = 'screenshare-audio-unavailable-reason'

const AUDIO_UNAVAILABLE_GENERIC =
  'Não foi possível iniciar o áudio de compartilhamento nesta instalação.'

// Os quatro motivos que `src/main/screenshare-audio.ts` sabe produzir, em
// português de gente. `start-failed` cai no texto genérico de propósito: o
// que o distingue é um HRESULT, que vai para o log e não para a tela — para
// quem está com o diálogo aberto, "não deu para iniciar" é a informação
// acionável, e o resto é ruído.
const AUDIO_UNAVAILABLE_TEXTS: Record<ScreenShareAudioUnavailableReason, string> = {
  'not-windows': 'Áudio de compartilhamento só funciona no Windows.',
  'windows-too-old':
    'Seu Windows não tem suporte a áudio por aplicativo. Ele existe a partir do Windows 11.',
  'addon-unavailable': AUDIO_UNAVAILABLE_GENERIC,
  'start-failed': AUDIO_UNAVAILABLE_GENERIC
}

/**
 * Lê `audioUnavailableReason` sem depender de ele existir no tipo nem no
 * payload. O campo é opcional no contrato e chega pelo IPC, ou seja, de fora:
 * um valor desconhecido (main mais novo, main mais velho, payload adulterado)
 * degrada para o texto genérico em vez de renderizar `undefined` na tela.
 */
function readAudioUnavailableReason(
  request: ScreenSharePickRequest | null
): ScreenShareAudioUnavailableReason | undefined {
  const raw = (request as { audioUnavailableReason?: unknown } | null)?.audioUnavailableReason
  return typeof raw === 'string' ? (raw as ScreenShareAudioUnavailableReason) : undefined
}

function describeAudioUnavailable(reason: ScreenShareAudioUnavailableReason | undefined): string {
  if (reason === undefined) return AUDIO_UNAVAILABLE_GENERIC
  return AUDIO_UNAVAILABLE_TEXTS[reason] ?? AUDIO_UNAVAILABLE_GENERIC
}

function SourceSection({
  icon,
  title,
  sources,
  onChoose
}: {
  icon: 'screen' | 'window'
  title: string
  sources: ScreenShareSource[]
  onChoose: (sourceId: string) => void
}): React.JSX.Element | null {
  if (sources.length === 0) return null
  const Icon = icon === 'screen' ? MonitorIcon : AppWindowIcon

  return (
    <section className="mb-4 last:mb-0">
      <h3 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
        <Icon className="size-3.5" />
        {title}
      </h3>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sources.map((source) => (
          <button
            key={source.id}
            type="button"
            onClick={() => onChoose(source.id)}
            className="border-border hover:border-primary hover:bg-accent focus-visible:ring-ring group flex flex-col gap-1.5 rounded-md border p-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <img
              src={source.thumbnailDataUrl}
              alt=""
              className="bg-muted aspect-video w-full rounded-sm object-contain"
            />
            <span className="flex min-w-0 items-center gap-1.5">
              {source.appIconDataUrl ? (
                <img src={source.appIconDataUrl} alt="" className="size-4 flex-none" />
              ) : null}
              {/* `truncate` porque título de janela é texto arbitrário e longo
                  (caminho de arquivo, título de aba) — sem isto o card estica. */}
              <span className="truncate text-xs" title={source.name}>
                {source.name}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
