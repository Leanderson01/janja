import { VolumeX } from 'lucide-react'
import { useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Slider } from '@/components/ui/slider'
import {
  DEFAULT_PARTICIPANT_VOLUME,
  MAX_PLAYBACK_VOLUME,
  type ParticipantAudioPreference
} from '@/lib/participant-volumes'
import { cn } from '@/lib/utils'

// Menu de áudio por participante (VOICE-18, Plano 08.5-11) — o conteúdo do
// menu e o gatilho que o abre, num arquivo próprio para existir nos DOIS
// lugares onde um participante do palco aparece.
//
// POR QUE ESTE ARQUIVO EXISTE (correção do desvio 2 do 08.5-11-SUMMARY):
// o menu nasceu dentro de `CallStage.tsx`, colado na grade de ladrilhos. Só
// que a grade fica `hidden` justamente no layout `share` — quando alguém está
// compartilhando a tela e os participantes descem para a `ParticipantStrip`.
// Resultado: o volume ficava inalcançável exatamente no caso que mais o pede
// (alguém compartilhando um vídeo alto). O contorno era "Ocultar tela →
// ajustar → Mostrar tela", que ninguém descobre sozinho.
//
// O QUE FOI COMPARTILHADO, E O QUE NÃO FOI: só o MENU. A grade e a faixa
// continuam desenhando os próprios ladrilhos, porque elas divergem em mais do
// que tamanho — a grade usa o canto superior esquerdo do avatar para
// "silenciado" e a faixa usa o MESMO canto para "compartilhando a tela".
// Fundir os dois desenhos exigiria decidir uma convenção nova de badges sem
// poder olhar para a tela (WSL2, sem janela). Menu compartilhado + desenhos
// próprios resolve o problema real sem inventar visual não verificável.
//
// A importação continua indo numa direção só: `CallStage` e `ParticipantStrip`
// importam DAQUI, e este arquivo não importa nenhum dos dois. Sem ciclo.

// O passo dos itens de teclado, em porcentagem. O slider anda de 5 em 5
// (arrastar é fino); os itens do menu andam de 10 em 10, porque cada passo
// custa um Enter.
const VOLUME_KEYBOARD_STEP = 10
const MAX_VOLUME_PERCENT = Math.round(MAX_PLAYBACK_VOLUME * 100)

function toPercent(volume: number): number {
  return Math.min(MAX_VOLUME_PERCENT, Math.max(0, Math.round(volume * 100)))
}

// O sinal de "eu mexi no áudio desta pessoa", em texto, ao lado do nome.
//
// Um volume baixado e esquecido é indistinguível de "essa pessoa fala baixo",
// e um silenciado sem sinal vira "sumiu da call" — as duas leituras erradas
// levam o usuário a procurar defeito onde não tem. Componente compartilhado
// porque a informação é a mesma nos dois tamanhos; o que muda é só onde o
// desenho de cada um coloca o badge de silenciado.
export function ParticipantVolumeHint({
  preference,
  className,
  showSilenced = false
}: {
  preference: ParticipantAudioPreference | undefined
  className?: string
  /**
   * `true` quando o ladrilho do chamador NÃO tem um badge de silenciado
   * próprio (é o caso da faixa, cujo canto livre já é do "compartilhando"):
   * aí o ícone aparece aqui, inline. A grade tem o badge no avatar e passa
   * `false` para não dizer a mesma coisa duas vezes.
   */
  showSilenced?: boolean
}): React.JSX.Element | null {
  const silenced = preference?.silenced ?? false
  const percent = toPercent(preference?.volume ?? DEFAULT_PARTICIPANT_VOLUME)

  if (silenced) {
    if (!showSilenced) return null
    return (
      <VolumeX
        className={cn('size-3.5 shrink-0 text-muted-foreground', className)}
        aria-label="Silenciado para mim"
      />
    )
  }

  if (percent === MAX_VOLUME_PERCENT) return null

  return <span className={cn('text-xs text-muted-foreground', className)}>{percent}%</span>
}

// O gatilho + o conteúdo do menu. Mesmo padrão único de menu da fase (Plano
// 08.5-02/08.5-04): um `DropdownMenu` controlado, aberto por clique/Enter no
// `<button>` e pelo botão direito no mesmo elemento. Sem `context-menu` do
// Radix, que não foi instalado de propósito.
//
// Quem NÃO deve ter menu não renderiza este componente — a decisão é do
// chamador, e ela é a mesma nos dois lugares: sem menu para MIM MESMO (não me
// ouço) e sem menu em canal apenas VISUALIZADO (não há track tocando para
// ajustar, e o menu prometeria um efeito que não aconteceria).
export function ParticipantAudioMenu({
  username,
  preference,
  onVolumeChange,
  onToggleSilenced,
  triggerClassName,
  children
}: {
  username: string
  preference: ParticipantAudioPreference | undefined
  onVolumeChange: (volume: number) => void
  onToggleSilenced: () => void
  triggerClassName: string
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const silenced = preference?.silenced ?? false
  const percent = toPercent(preference?.volume ?? DEFAULT_PARTICIPANT_VOLUME)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Opções de áudio de ${username}`}
          className={triggerClassName}
          onContextMenu={(event) => {
            event.preventDefault()
            setOpen(true)
          }}
        >
          {children}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-60">
        <DropdownMenuLabel className="truncate">{username}</DropdownMenuLabel>
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
            aria-label={`Volume de ${username}`}
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
