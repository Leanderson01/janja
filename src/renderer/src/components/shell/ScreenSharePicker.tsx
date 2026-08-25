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
    window.screenshare.chooseSource({ sourceId, systemAudio })
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

  // O usuário ligou o áudio agora, mas esta captura já foi aberta sem ele: a
  // constraint de `getDisplayMedia()` é fixada antes de o diálogo existir e
  // não dá para renegociar. Dizer isso é o mínimo — a alternativa é o som
  // simplesmente não sair e ninguém entender por quê.
  const audioOnlyNextTime = systemAudio && request?.audioAvailable === false

  return (
    <Dialog open={request !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compartilhar tela</DialogTitle>
          <DialogDescription>Escolha uma tela ou uma janela para transmitir.</DialogDescription>
        </DialogHeader>

        {/* Pitfall 1: o áudio do sistema é uma ESCOLHA, e uma escolha
            informada. O aviso embaixo não é disclaimer defensivo — é o defeito
            que 4 pessoas viveram numa call em 2026-08-20, escrito em português
            de gente. Enquanto o diagnóstico de `screenshare-diagnostics.ts`
            não provar que o Chromium aplica `restrictOwnAudio`, esta é a
            informação verdadeira, e ela precisa estar onde a decisão é
            tomada. */}
        <div className="border-border flex flex-col gap-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              {systemAudio ? (
                <Volume2Icon className="size-4" />
              ) : (
                <VolumeXIcon className="text-muted-foreground size-4" />
              )}
              Compartilhar áudio do sistema
            </span>
            <Button
              type="button"
              size="sm"
              variant={systemAudio ? 'default' : 'outline'}
              aria-pressed={systemAudio}
              onClick={toggleSystemAudio}
            >
              {systemAudio ? 'Ligado' : 'Desligado'}
            </Button>
          </div>

          {systemAudio ? (
            <p className="text-muted-foreground text-xs">
              O Windows captura tudo que sai pela saída de áudio — inclusive a voz das outras
              pessoas da call, que o app está tocando aí. Com isso ligado, elas vão se ouvir de
              volta. Fone de ouvido não resolve.
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              A tela vai sem som. É o padrão porque é o único jeito garantido de ninguém se ouvir de
              volta.
            </p>
          )}

          {audioOnlyNextTime ? (
            <p className="text-xs font-medium text-amber-500">
              Esta transmissão já começou sem áudio. A escolha ficou salva e vale a partir do
              próximo compartilhamento.
            </p>
          ) : null}
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
