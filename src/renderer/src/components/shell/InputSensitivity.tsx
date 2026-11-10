import { useId } from 'react'

import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import type { VadLevelReading } from '@/lib/vad'
import { formatDb } from '@/lib/vad-scale'
import { VAD_THRESHOLD_MAX_DB, VAD_THRESHOLD_MIN_DB } from '@/lib/voice-preferences'

import { VadLevelMeter } from './VadLevelMeter'

// "Sensibilidade de entrada", no modelo do Discord: um interruptor
// "Determinar automaticamente a sensibilidade" (padrão ligado) e, desligado,
// um slider em dB de −100 a 0 com o valor ao lado. Embaixo, o medidor na
// mesma escala do slider, com a marca no limiar em vigor — no automático, o
// que o detector calculou. Puramente apresentacional: quem persiste e aplica
// é `VoiceSettingsPopover`.
export function InputSensitivity({
  autoSensitivity,
  thresholdDb,
  reading,
  disabled,
  onAutoSensitivityChange,
  onThresholdChange
}: {
  autoSensitivity: boolean
  /** Limiar MANUAL salvo (dBFS). */
  thresholdDb: number
  /** Última leitura do medidor; `null` antes da primeira. */
  reading: VadLevelReading | null
  disabled?: boolean
  onAutoSensitivityChange: (on: boolean) => void
  onThresholdChange: (thresholdDb: number) => void
}): React.JSX.Element {
  const switchId = useId()
  // No manual, a marca segue o slider na hora (sem esperar a próxima leitura);
  // no automático, só o detector sabe onde ela está.
  const markDb = autoSensitivity ? (reading?.thresholdDb ?? null) : thresholdDb

  return (
    <div data-slot="input-sensitivity" className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Sensibilidade de entrada</span>

      <div className="flex items-center justify-between gap-3">
        <label htmlFor={switchId} className="text-sm">
          Determinar automaticamente a sensibilidade
        </label>
        <Switch
          id={switchId}
          checked={autoSensitivity}
          disabled={disabled}
          onCheckedChange={onAutoSensitivityChange}
        />
      </div>

      {/* Slider e medidor na MESMA largura (a coluna do valor à direita existe
          nas duas linhas): é o que põe a marca do limiar embaixo do polegar. */}
      {!autoSensitivity && (
        <div className="flex items-center gap-3">
          <Slider
            min={VAD_THRESHOLD_MIN_DB}
            max={VAD_THRESHOLD_MAX_DB}
            step={1}
            value={[thresholdDb]}
            disabled={disabled}
            onValueChange={(value) => {
              const next = value[0]
              if (next !== undefined) onThresholdChange(next)
            }}
            aria-label="Limiar de sensibilidade de entrada"
          />
          <span
            data-slot="input-sensitivity-value"
            className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
          >
            {formatDb(thresholdDb)}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <VadLevelMeter levelDb={reading?.levelDb ?? VAD_THRESHOLD_MIN_DB} thresholdDb={markDb} />
        <span
          data-slot="input-sensitivity-auto-value"
          className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
        >
          {autoSensitivity && markDb !== null ? formatDb(markDb) : null}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {autoSensitivity
          ? 'O limiar acompanha o ruído de fundo. Verde no medidor: sua voz está sendo transmitida.'
          : 'Verde no medidor: sua voz está sendo transmitida.'}
      </p>
    </div>
  )
}
