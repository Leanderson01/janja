import { useEffect, useState } from 'react'
import { MonitorIcon, AppWindowIcon } from 'lucide-react'

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
export function ScreenSharePicker(): React.JSX.Element {
  // `null` = nenhum pedido em andamento (diálogo fechado). Não é `[]`: lista
  // vazia nunca chega aqui, o main resolve esse caso sozinho.
  const [sources, setSources] = useState<ScreenShareSource[] | null>(null)

  useEffect(() => {
    // Mesmo padrão de `onAuthChange` em `useAuth`: o preload devolve a função
    // de remoção do listener, e ela é o cleanup do efeito.
    if (!window.screenshare) return undefined
    return window.screenshare.onPickRequested(({ sources: incoming }) => {
      setSources(incoming)
    })
  }, [])

  function choose(sourceId: string): void {
    // IPC primeiro, estado depois: destravar o processo main é o que não pode
    // falhar. Fechar o diálogo é cosmético em comparação.
    window.screenshare.chooseSource(sourceId)
    setSources(null)
  }

  function cancel(): void {
    window.screenshare.cancelPicker()
    setSources(null)
  }

  function handleOpenChange(nextOpen: boolean): void {
    // Só chega aqui por interação do usuário (Esc, clique fora, X). Fechar
    // por `choose()` muda a prop `open` diretamente e NÃO passa por aqui —
    // então escolher nunca dispara um `cancelPicker` em seguida.
    if (!nextOpen) cancel()
  }

  const screens = sources?.filter((source) => source.isScreen) ?? []
  const windows = sources?.filter((source) => !source.isScreen) ?? []

  return (
    <Dialog open={sources !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compartilhar tela</DialogTitle>
          <DialogDescription>
            Escolha uma tela ou uma janela para transmitir. O áudio do sistema vai junto.
          </DialogDescription>
        </DialogHeader>

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
