import { useEffect, useRef, useState } from 'react'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useVoice } from '@/state/voice-context'
import { createVadMonitor, type VadLevelReading, type VadMonitor } from '@/lib/vad'
import {
  loadScreenSharePreferences,
  saveScreenSharePreferences,
  type ScreenShareQuality
} from '@/lib/screenshare-preferences'
import {
  loadVoicePreferences,
  saveVoicePreferences,
  type VoiceMode,
  type VoicePreferences
} from '@/lib/voice-preferences'

import { InputSensitivity } from './InputSensitivity'
import { MicTestPanel } from './MicTestPanel'

// Painel de configurações de voz (Plano 07-05): modo de transmissão
// (detecção de voz vs push-to-talk), sensibilidade de entrada (automática ou
// limiar em dB, com medidor de nível ao vivo na mesma escala — modelo do
// Discord, nov/2026), e seleção de microfone/saída de áudio. Toda escolha persiste via
// `voice-preferences.ts` (localStorage, estado de MÁQUINA — nunca Convex,
// 07-RESEARCH.md §7) e aplica em runtime chamando `applyVoicePreferences()`
// / `room.switchActiveDevice(...)`, nunca reconectando a sala (VOICE-13).
//
// Plano 08-05 acrescenta a qualidade do compartilhamento de tela
// (`screenshare-preferences.ts`, chave própria de localStorage). Mora aqui, e
// não no rodapé ao lado do botão de compartilhar, por falta física de espaço:
// a coluna do `ChannelSidebar` é fixa em 240px e o rodapé já carrega cinco
// botões de ícone — dois botões de texto ("Fluida"/"Nítida") não cabem sem
// comer o nome do canal conectado. O gatilho deste popover é o botão
// imediatamente vizinho ao de compartilhar.
export function VoiceSettingsPopover({
  disabled,
  hasVoiceIntention = true
}: {
  disabled?: boolean
  /**
   * Plano 07-09: o testador de microfone precisa funcionar sem nenhum canal
   * conectado (VOICE-21) — `VoiceControlBar` agora renderiza este popover sempre,
   * não só quando há intenção de canal. As seções que dependem de um `Room` real
   * conectado (modo e limiar com nível ao vivo do próprio VAD) continuam
   * condicionadas a `hasVoiceIntention`; o teste de microfone e, desde a rodada 1
   * do visual Discord, a escolha de dispositivo não (a escolha feita fora da call
   * é salva e vale ao entrar).
   */
  hasVoiceIntention?: boolean
}): React.JSX.Element {
  const {
    room,
    applyVoicePreferences,
    getVadAnalysisTrack,
    inputDeviceId,
    outputDeviceId,
    selectDevice
  } = useVoice()

  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState(() => loadVoicePreferences())
  // SHARE-08 (Plano 08-05): preferência SEPARADA de `voice-preferences`, em
  // outra chave de `localStorage` — qualidade de vídeo do compartilhamento
  // não é preferência de voz, e misturar as duas faria uma migração futura
  // de uma resetar a outra. Estado local só para redesenhar o toggle: quem
  // lê o valor de verdade é `startScreenShare()`, a cada início.
  const [screenSharePrefs, setScreenSharePrefs] = useState(() => loadScreenSharePreferences())

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])

  // Dispositivo em uso: o escolhido (salvo pelo provider, dentro ou fora da
  // call) ou, sem escolha, o que a sala reporta. `undefined` mostra o
  // placeholder do Select.
  const activeInputId = inputDeviceId ?? room.getActiveDevice('audioinput')
  const activeOutputId = outputDeviceId ?? room.getActiveDevice('audiooutput')

  // Última leitura do medidor (nível em dB + limiar em vigor). `null` antes da
  // primeira — e sempre que o medidor é desmontado.
  const [reading, setReading] = useState<VadLevelReading | null>(null)
  // O monitor do medidor, para ajustar a sensibilidade AO VIVO (o slider não
  // pode recriar um AudioContext a cada passo).
  const meterMonitorRef = useRef<VadMonitor | null>(null)

  // Snapshot das preferências ao ABRIR ("ajustar estado durante o render" —
  // evita o commit extra de um `useEffect` só para sincronizar estado local
  // com uma mudança de prop).
  const [syncedOpen, setSyncedOpen] = useState(open)
  if (open !== syncedOpen) {
    setSyncedOpen(open)
    if (open) {
      setPrefs(loadVoicePreferences())
    }
  }

  // `enumerateDevices()` é assíncrono (pode pedir permissão) — fica num
  // efeito de verdade, só ativo enquanto o popover está aberto. Desde a
  // rodada 1 do visual Discord, com ou sem canal conectado.
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
        // Sem permissão de microfone o navegador lista dispositivos com
        // `deviceId` vazio — agora alcançável fora da call — e o `SelectItem`
        // do Radix não aceita valor vazio.
        setInputDevices(inputs.filter((device) => device.deviceId !== ''))
        setOutputDevices(outputs.filter((device) => device.deviceId !== ''))
      } catch (err) {
        console.error('[voice] falha ao listar dispositivos de áudio', err)
      }
    }

    void loadDevices()

    return () => {
      cancelled = true
    }
  }, [open])

  // Medidor de nível ao vivo para o usuário calibrar a sensibilidade vendo a
  // própria voz. Cria SEU PRÓPRIO monitor (o `onSpeakingChange` dele não faz
  // nada — só lemos `onLevel`), com a MESMA sensibilidade do VAD: no
  // automático, a marca do medidor é o limiar que a mesma decisão calcula
  // sobre o mesmo áudio. Sempre sobre uma fonte VIVA, nunca sobre a track
  // publicada crua.
  //
  // Ler a track publicada era o mesmo defeito do deadlock do VAD, na UI de
  // configuração: em modo VAD (ou com mute manual) ela fica com
  // `enabled = false`, o que entrega silêncio digital ao Web Audio, e a
  // barra marcava zero permanente — justamente quando o usuário está
  // tentando calibrar o slider de limiar. Fonte preferida: a track de
  // análise do provider (o clone que o VAD já escuta). Sem ela (modo PTT),
  // clona a publicada aqui mesmo, pela mesma razão.
  useEffect(() => {
    if (!open || !hasVoiceIntention) return

    // `ownsTrack` decide quem tem o direito de parar `meterTrack` no
    // cleanup: parar a track do PROVIDER ao fechar o painel mataria o VAD
    // da sessão inteira — é o erro exato a evitar.
    let meterTrack: MediaStreamTrack
    let ownsTrack: boolean

    const shared = getVadAnalysisTrack()
    if (shared && shared.readyState === 'live') {
      meterTrack = shared
      ownsTrack = false
    } else {
      const micPublication = room.localParticipant.getTrackPublication(Track.Source.Microphone)
      const publishedTrack = micPublication?.track?.mediaStreamTrack
      if (!publishedTrack) return
      try {
        meterTrack = publishedTrack.clone()
      } catch (err) {
        console.error('[voice] falha ao clonar a track para o medidor de nível', err)
        return
      }
      // Mesmo motivo do clone do VAD no provider: o clone herda `enabled`
      // da publicada, que em PTT fica mutada fora da tecla. Não é publicado.
      meterTrack.enabled = true
      ownsTrack = true
    }

    let monitor: VadMonitor | null = null
    try {
      // Lida do storage NA HORA (não de `prefs`): mexer no slider não pode
      // recriar o medidor — quem acompanha a mudança é `meterMonitorRef`.
      const sensitivity = loadVoicePreferences()
      monitor = createVadMonitor(meterTrack, {
        autoSensitivity: sensitivity.vadAutoSensitivity,
        thresholdDb: sensitivity.vadThresholdDb,
        label: 'medidor',
        onSpeakingChange: () => {},
        onLevel: setReading
      })
    } catch (err) {
      console.error('[voice] falha ao iniciar medidor de nível do microfone', err)
    }
    meterMonitorRef.current = monitor

    return () => {
      meterMonitorRef.current = null
      monitor?.stop()
      setReading(null)
      // Só o clone criado AQUI é parado. A track de análise do provider
      // nunca — ela pertence ao VoiceProvider e sobrevive ao painel.
      if (ownsTrack) meterTrack.stop()
    }
    // `prefs.mode` e `activeInputId` entram nas deps para o medidor ser
    // recriado quando o usuário troca de modo ou de microfone com o painel
    // aberto — sem isso ele continuaria lendo uma fonte morta.
  }, [open, room, hasVoiceIntention, getVadAnalysisTrack, prefs.mode, activeInputId])

  // Plano 07-07 (VOICE-17): toggle de sons de entrada/saída. Não depende de
  // canal conectado nem de `Room` — é lido direto de `voice-sounds.ts` a
  // cada evento, então basta persistir a preferência (mesmo padrão de
  // `handleModeChange`/`handleSensitivityChange` abaixo, sem `applyVoicePreferences()`
  // porque nada no `Room`/VAD depende desta preferência).
  function handleSoundsEnabledChange(soundsEnabled: boolean): void {
    const next = saveVoicePreferences({ soundsEnabled })
    setPrefs(next)
  }

  // Não chama nada em `useVoice()` de propósito: a escolha vale para a
  // PRÓXIMA vez que compartilhar. Aplicar agora exigiria republicar a track
  // (`setScreenShareEnabled(false)` seguido de `true`), o que derrubaria a
  // imagem de quem já está assistindo — preço alto demais para um toggle.
  function handleScreenShareQualityChange(quality: ScreenShareQuality): void {
    const next = saveScreenSharePreferences({ quality })
    setScreenSharePrefs(next)
  }

  function handleModeChange(mode: VoiceMode): void {
    const next = saveVoicePreferences({ mode })
    setPrefs(next)
    applyVoicePreferences()
  }

  // Sensibilidade: persiste, ajusta o medidor desta tela e o VAD da call AO
  // VIVO (`onlySensitivity`) — sem derrubar o monitor nem fechar o microfone.
  function handleSensitivityChange(
    partial: Partial<Pick<VoicePreferences, 'vadAutoSensitivity' | 'vadThresholdDb'>>
  ): void {
    const next = saveVoicePreferences(partial)
    setPrefs(next)
    meterMonitorRef.current?.setAutoSensitivity(next.vadAutoSensitivity)
    meterMonitorRef.current?.setThreshold(next.vadThresholdDb)
    applyVoicePreferences({ onlySensitivity: true })
  }

  // VOICE-13: nunca desconectar/reconectar a sala para trocar de
  // dispositivo — `selectDevice` usa `switchActiveDevice`, que troca a track
  // ativa por baixo (ou, fora da call, o padrão da próxima entrada) e salva a
  // escolha.
  async function handleInputChange(deviceId: string): Promise<void> {
    try {
      await selectDevice('audioinput', deviceId)
    } catch (err) {
      console.error('[voice] falha ao trocar microfone', err)
    }
  }

  async function handleOutputChange(deviceId: string): Promise<void> {
    try {
      await selectDevice('audiooutput', deviceId)
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

      {/* Plano 08.5-09: espaçamento vertical por `flex flex-col gap-*`
          (convenção da fase) no lugar do seletor `> * + *` da utilidade antiga
          do Tailwind. Todos os blocos abaixo já ocupavam a largura inteira do
          popover, então o `stretch` padrão do flex reproduz o layout de antes
          sem nenhum ajuste extra. */}
      <PopoverContent align="end" className="w-80 flex flex-col gap-4">
        <PopoverHeader>
          <PopoverTitle>Configurações de voz</PopoverTitle>
        </PopoverHeader>

        {/* Plano 07-09: único item que funciona sem canal nenhum conectado
            (VOICE-21) — sempre visível, mesmo fora de uma chamada. */}
        <MicTestPanel
          autoSensitivity={prefs.vadAutoSensitivity}
          thresholdDb={prefs.vadThresholdDb}
        />

        {/* Plano 07-07 (VOICE-17): sempre visível, mesmo padrão do
            `MicTestPanel` acima — é preferência de máquina, não algo que só
            faz sentido dentro de uma call. */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Sons de entrada/saída de canal
          </span>
          <Button
            type="button"
            size="sm"
            variant={prefs.soundsEnabled ? 'default' : 'outline'}
            aria-pressed={prefs.soundsEnabled}
            onClick={() => handleSoundsEnabledChange(!prefs.soundsEnabled)}
          >
            {prefs.soundsEnabled ? 'Ligado' : 'Desligado'}
          </Button>
        </div>

        {/* SHARE-08 (Plano 08-05): sempre visível e sempre habilitado, mesmo
            padrão dos dois blocos acima. Habilitado inclusive DURANTE um
            compartilhamento — trocar aqui não reinicia a track no ar, só
            muda a qualidade do próximo compartilhamento (ver
            `handleScreenShareQualityChange`). */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Qualidade do compartilhamento de tela
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={screenSharePrefs.quality === 'fluida' ? 'default' : 'outline'}
              className="flex-1"
              aria-pressed={screenSharePrefs.quality === 'fluida'}
              onClick={() => handleScreenShareQualityChange('fluida')}
            >
              Fluida
            </Button>
            <Button
              type="button"
              size="sm"
              variant={screenSharePrefs.quality === 'nitida' ? 'default' : 'outline'}
              className="flex-1"
              aria-pressed={screenSharePrefs.quality === 'nitida'}
              onClick={() => handleScreenShareQualityChange('nitida')}
            >
              Nítida
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {screenSharePrefs.quality === 'fluida'
              ? '720p a 30 fps — prioriza movimento, exige menos upload.'
              : '1080p a 15 fps — prioriza nitidez, para texto e código.'}
          </p>
          <p className="text-xs text-muted-foreground">
            Vale a partir do próximo compartilhamento.
          </p>
        </div>

        {/* Rodada 1 do visual Discord: dispositivos fora da trava de canal —
            a escolha feita fora da call é salva e vale ao entrar. */}
        <div className="flex flex-col gap-2">
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

        <div className="flex flex-col gap-2">
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

        {!hasVoiceIntention && (
          <p className="text-xs text-muted-foreground">
            Entre em um canal de voz para ajustar modo e sensibilidade ao vivo.
          </p>
        )}

        {hasVoiceIntention && (
          <>
            <div className="flex flex-col gap-2">
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

            <InputSensitivity
              autoSensitivity={prefs.vadAutoSensitivity}
              thresholdDb={prefs.vadThresholdDb}
              reading={reading}
              disabled={prefs.mode !== 'vad'}
              onAutoSensitivityChange={(vadAutoSensitivity) =>
                handleSensitivityChange({ vadAutoSensitivity })
              }
              onThresholdChange={(vadThresholdDb) => handleSensitivityChange({ vadThresholdDb })}
            />
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
