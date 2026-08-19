import { useEffect, useRef, useState } from 'react'
import { useAction } from 'convex/react'
import { Mic } from 'lucide-react'
import { Room } from 'livekit-client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  openMicCapture,
  runServerLoopbackTest,
  startLevelMeter,
  type IceCandidateType,
  type LoopbackTestHandle,
  type MicCapture
} from '@/lib/mic-test'

import { api } from '../../../../../convex/_generated/api'

// Painel de teste de microfone (Plano 07-09, VOICE-21/VOICE-22): permite verificar o
// microfone, o dispositivo selecionado, o limiar do VAD e a corrente completa até o
// servidor sem depender de uma segunda pessoa online. Vive dentro de um `Dialog`
// próprio (não do `Popover` de configurações — conteúdo grande demais para caber lá)
// disparado por um botão em `VoiceSettingsPopover`.
//
// Regra de vida: NADA que abra microfone ou conexão roda fora de `open === true`.
// Fechar o painel — de qualquer jeito, inclusive Esc/clique fora — encerra toda
// track e toda conexão ativa. Um microfone que continua aberto depois de fechar a
// tela é o tipo de vazamento que ninguém percebe e todo mundo sente na bateria.

const ICE_PATH_LABEL: Record<IceCandidateType, string> = {
  host: 'Direto (host)',
  srflx: 'Direto (srflx, via STUN)',
  prflx: 'Direto (prflx)',
  relay: 'Via TURN (relay) — rede restritiva',
  desconhecido: 'Não foi possível determinar'
}

type ServerTestState =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'running'; icePath: IceCandidateType }
  | { status: 'error'; message: string }

export function MicTestPanel({
  vadThreshold,
  disabled
}: {
  vadThreshold: number
  disabled?: boolean
}): React.JSX.Element {
  const mintMicTestTokens = useAction(api.voiceToken.mintMicTestTokens)

  const [open, setOpen] = useState(false)

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined)

  const [level, setLevel] = useState(0)

  const [serverTest, setServerTest] = useState<ServerTestState>({ status: 'idle' })

  const captureRef = useRef<MicCapture | null>(null)
  const loopbackRef = useRef<LoopbackTestHandle | null>(null)

  // Lista os microfones disponíveis assim que o painel abre — `enumerateDevices` é
  // assíncrono (pode pedir permissão), mesmo padrão de `VoiceSettingsPopover`.
  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function loadDevices(): Promise<void> {
      try {
        const devices = await Room.getLocalDevices('audioinput')
        if (cancelled) return
        setInputDevices(devices)
      } catch (err) {
        console.error('[mic-test] falha ao listar microfones', err)
      }
    }

    void loadDevices()

    return () => {
      cancelled = true
    }
  }, [open])

  // Captura o microfone selecionado e liga o medidor de nível assim que o painel
  // abre — nunca exige estar num canal de voz. Reabre a captura sempre que o
  // dispositivo selecionado muda.
  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function start(): Promise<void> {
      try {
        const capture = await openMicCapture(selectedDeviceId)
        if (cancelled) {
          capture.stop()
          return
        }
        captureRef.current = capture
      } catch (err) {
        console.error('[mic-test] falha ao abrir o microfone', err)
      }
    }

    void start()

    return () => {
      cancelled = true
      captureRef.current?.stop()
      captureRef.current = null
    }
  }, [open, selectedDeviceId])

  // Liga o medidor de nível sobre a captura ativa — efeito separado do de cima para
  // não recriar a captura toda vez que só o handler de nível mudaria de identidade.
  useEffect(() => {
    if (!open) return
    const capture = captureRef.current
    if (!capture) return

    const monitor = startLevelMeter(capture.track, setLevel)
    return () => {
      monitor.stop()
      setLevel(0)
    }
  }, [open, selectedDeviceId])

  // Encerra TUDO ao fechar o painel — o teste de servidor se ainda estiver rodando (a
  // captura local já se encerra sozinha via cleanup do efeito acima). Nenhum destes
  // recursos deve sobreviver ao Dialog fechado, por qualquer caminho (botão, Esc,
  // clique fora). O reset mora na função de cleanup (não no corpo do efeito) de
  // propósito — chamar `setState` diretamente no corpo de um efeito encadeia renders
  // extras; na função de cleanup, dispara junto do desmonte lógico do que ela está
  // desfazendo, mesmo padrão do medidor de nível acima.
  useEffect(() => {
    if (!open) return
    return () => {
      setServerTest({ status: 'idle' })
      void loopbackRef.current?.stop()
      loopbackRef.current = null
    }
  }, [open])

  async function handleRunServerTest(): Promise<void> {
    setServerTest({ status: 'connecting' })
    try {
      const { url, publisherToken, subscriberToken } = await mintMicTestTokens({})
      const handle = await runServerLoopbackTest({
        url,
        publisherToken,
        subscriberToken,
        inputDeviceId: selectedDeviceId
      })
      loopbackRef.current = handle
      setServerTest({ status: 'running', icePath: handle.icePath })
    } catch (err) {
      console.error('[mic-test] teste de servidor falhou', err)
      setServerTest({
        status: 'error',
        message: err instanceof Error ? err.message : 'Falha desconhecida'
      })
    }
  }

  async function handleStopServerTest(): Promise<void> {
    await loopbackRef.current?.stop()
    loopbackRef.current = null
    setServerTest({ status: 'idle' })
  }

  const thresholdPercent = Math.min(vadThreshold, 1) * 100
  const levelPercent = Math.min(level, 1) * 100

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className="w-full">
          <Mic /> Testar microfone
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Testar microfone</DialogTitle>
          <DialogDescription>
            Verifique o microfone, o limiar de detecção de voz e a conexão com o servidor — sem
            precisar de mais ninguém online.
          </DialogDescription>
        </DialogHeader>

        {/* Plano 08.5-09: o espaçamento vertical deste painel passou a ser
            `flex flex-col gap-*` (convenção da fase), no lugar do seletor
            `> * + *` que a utilidade antiga do Tailwind aplicava.
            Onde o bloco contém um botão de largura intrínseca, o container
            leva `items-start`: sem ele o botão passaria a esticar para a
            largura toda do diálogo, que seria mudança de layout — e esta fase
            não muda nada do testador de microfone. Parágrafo em `items-start`
            continua quebrando na largura disponível (`fit-content` é limitado
            pelo espaço livre), então o texto fica idêntico. */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Microfone</span>
            <Select value={selectedDeviceId} onValueChange={(value) => setSelectedDeviceId(value)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Dispositivo padrão do sistema" />
              </SelectTrigger>
              <SelectContent>
                {inputDevices.map((device) => (
                  <SelectItem key={device.deviceId} value={device.deviceId}>
                    {device.label || 'Microfone'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Nível ao vivo — a marca é o limiar do detector de voz
            </span>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${levelPercent}%` }}
              />
              <div
                className="absolute top-0 h-full w-0.5 bg-destructive"
                style={{ left: `${thresholdPercent}%` }}
                aria-label="Limiar do detector de voz"
              />
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 border-t border-border pt-4">
            <span className="text-xs font-medium text-muted-foreground">
              Teste completo pelo servidor — use fone de ouvido
            </span>
            <p className="text-xs text-muted-foreground">
              Abre duas conexões numa sala de teste dedicada (nunca um canal real): uma publica seu
              microfone, a outra assina e reproduz. Sem fone, o áudio de volta realimenta o próprio
              microfone.
            </p>

            {serverTest.status === 'idle' && (
              <Button type="button" size="sm" onClick={() => void handleRunServerTest()}>
                Testar pelo servidor
              </Button>
            )}
            {serverTest.status === 'connecting' && (
              <p className="text-xs text-muted-foreground">Conectando...</p>
            )}
            {serverTest.status === 'running' && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm">Fale agora — você deve se ouvir com um pequeno atraso.</p>
                <p className="text-xs text-muted-foreground">
                  Caminho ICE: {ICE_PATH_LABEL[serverTest.icePath]}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => void handleStopServerTest()}
                >
                  Encerrar teste
                </Button>
              </div>
            )}
            {serverTest.status === 'error' && (
              <div className="flex flex-col items-start gap-2">
                <p className="text-xs text-destructive">{serverTest.message}</p>
                <Button type="button" size="sm" onClick={() => void handleRunServerTest()}>
                  Tentar de novo
                </Button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
