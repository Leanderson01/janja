import { useEffect, useState } from 'react'
import { Room, Track } from 'livekit-client'
import { Settings } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useVoice } from '@/state/voice-context'
import { createVadMonitor, type VadMonitor } from '@/lib/vad'
import { loadVoicePreferences, saveVoicePreferences, type VoiceMode } from '@/lib/voice-preferences'

// Painel de configurações de voz (Plano 07-05): modo de transmissão
// (detecção de voz vs push-to-talk), limiar do VAD com medidor de nível ao
// vivo, e seleção de microfone/saída de áudio. Toda escolha persiste via
// `voice-preferences.ts` (localStorage, estado de MÁQUINA — nunca Convex,
// 07-RESEARCH.md §7) e aplica em runtime chamando `applyVoicePreferences()`
// / `room.switchActiveDevice(...)`, nunca reconectando a sala (VOICE-13).
export function VoiceSettingsPopover({ disabled }: { disabled?: boolean }): React.JSX.Element {
  const { room, applyVoicePreferences } = useVoice()

  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState(() => loadVoicePreferences())

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [activeInputId, setActiveInputId] = useState<string | undefined>(undefined)
  const [activeOutputId, setActiveOutputId] = useState<string | undefined>(undefined)

  const [level, setLevel] = useState(0)

  // Snapshot do valor ativo/preferências ao ABRIR (mesmo padrão de "ajustar
  // estado durante o render" já usado em VoiceControlBar.tsx para resetar
  // mute/deafen numa nova intenção de join — evita o commit extra de um
  // `useEffect` só para sincronizar estado local com uma mudança de prop).
  const [syncedOpen, setSyncedOpen] = useState(open)
  if (open !== syncedOpen) {
    setSyncedOpen(open)
    if (open) {
      setActiveInputId(room.getActiveDevice('audioinput'))
      setActiveOutputId(room.getActiveDevice('audiooutput'))
      setPrefs(loadVoicePreferences())
    }
  }

  // `enumerateDevices()` é assíncrono (pode pedir permissão) — fica num
  // efeito de verdade, só ativo enquanto o popover está aberto, para não
  // rodar o tempo todo por uma UI que nem está visível.
  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function loadDevices(): Promise<void> {
      try {
        const [inputs, outputs] = await Promise.all([
          Room.getLocalDevices('audioinput'),
          Room.getLocalDevices('audiooutput')
        ])
        if (cancelled) return
        setInputDevices(inputs)
        setOutputDevices(outputs)
      } catch (err) {
        console.error('[voice] falha ao listar dispositivos de áudio', err)
      }
    }

    void loadDevices()

    return () => {
      cancelled = true
    }
  }, [open])

  // Medidor de nível ao vivo para o usuário calibrar o limiar vendo a
  // própria voz. Cria SEU PRÓPRIO monitor (threshold acima de qualquer
  // nível real — nunca dispara `onSpeakingChange`, só lemos `onLevel`)
  // sobre a track de microfone local, em vez de tentar reaproveitar o
  // monitor de VAD do VoiceProvider — mantém este componente desacoplado
  // dos internals do provider. Vive só enquanto o popover está aberto, e
  // NUNCA compete com o monitor real do VoiceProvider: são dois
  // `AudioContext`s de curta duração possivelmente simultâneos apenas
  // enquanto o painel está aberto, sempre fechados ao fechar o painel.
  useEffect(() => {
    if (!open) return

    const micPublication = room.localParticipant.getTrackPublication(Track.Source.Microphone)
    const mediaStreamTrack = micPublication?.track?.mediaStreamTrack
    if (!mediaStreamTrack) return

    let monitor: VadMonitor | null = null
    try {
      monitor = createVadMonitor(mediaStreamTrack, {
        // Acima de qualquer nível RMS real (0-1) — este monitor nunca deve
        // considerar "falando", ele só existe para ler `onLevel`.
        threshold: 2,
        onSpeakingChange: () => {},
        onLevel: setLevel
      })
    } catch (err) {
      console.error('[voice] falha ao iniciar medidor de nível do microfone', err)
    }

    return () => {
      monitor?.stop()
      setLevel(0)
    }
  }, [open, room])

  function handleModeChange(mode: VoiceMode): void {
    const next = saveVoicePreferences({ mode })
    setPrefs(next)
    applyVoicePreferences()
  }

  function handleThresholdChange(value: number[]): void {
    const vadThreshold = value[0]
    if (vadThreshold === undefined) return
    const next = saveVoicePreferences({ vadThreshold })
    setPrefs(next)
    applyVoicePreferences()
  }

  async function handleInputChange(deviceId: string): Promise<void> {
    try {
      // VOICE-13: nunca desconectar/reconectar a sala para trocar de
      // dispositivo — `switchActiveDevice` troca a track ativa por baixo.
      await room.switchActiveDevice('audioinput', deviceId)
      setActiveInputId(deviceId)
    } catch (err) {
      console.error('[voice] falha ao trocar microfone', err)
    }
  }

  async function handleOutputChange(deviceId: string): Promise<void> {
    try {
      await room.switchActiveDevice('audiooutput', deviceId)
      setActiveOutputId(deviceId)
    } catch (err) {
      console.error('[voice] falha ao trocar saída de áudio', err)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label="Configurações de voz"
            >
              <Settings />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Configurações de voz</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" className="w-80 space-y-4">
        <PopoverHeader>
          <PopoverTitle>Configurações de voz</PopoverTitle>
        </PopoverHeader>

        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">Modo de transmissão</span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={prefs.mode === 'vad' ? 'default' : 'outline'}
              className="flex-1"
              aria-pressed={prefs.mode === 'vad'}
              onClick={() => handleModeChange('vad')}
            >
              Detecção de voz
            </Button>
            <Button
              type="button"
              size="sm"
              variant={prefs.mode === 'ptt' ? 'default' : 'outline'}
              className="flex-1"
              aria-pressed={prefs.mode === 'ptt'}
              onClick={() => handleModeChange('ptt')}
            >
              Push-to-talk
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">
            Limiar do detector de voz
          </span>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={[prefs.vadThreshold]}
            disabled={prefs.mode !== 'vad'}
            onValueChange={handleThresholdChange}
            aria-label="Limiar do detector de voz"
          />
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.min(level, 1) * 100}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">Microfone</span>
          <Select value={activeInputId} onValueChange={(value) => void handleInputChange(value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecionar microfone" />
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

        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">Saída de áudio</span>
          <Select value={activeOutputId} onValueChange={(value) => void handleOutputChange(value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecionar saída" />
            </SelectTrigger>
            <SelectContent>
              {outputDevices.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label || 'Saída de áudio'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  )
}
