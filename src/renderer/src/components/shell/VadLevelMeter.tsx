import { cn } from '@/lib/utils'
import { dbToPercent, formatDb } from '@/lib/vad-scale'

// Medidor de nível do microfone na MESMA escala do slider de sensibilidade
// (dBFS, −100…0, `lib/vad-scale.ts`), como o do Discord: o trecho do nível
// ABAIXO do limiar fica âmbar, o trecho ACIMA fica verde, e uma marca vertical
// mostra o limiar em vigor — no automático, o calculado a partir do ruído de
// fundo. O nível é o PICO do intervalo (`VadLevelReading`), então o verde
// aparecer é exatamente o que ABRE o microfone. Âmbar não quer dizer fechado:
// a histerese e a soltura de 600 ms o mantêm aberto no fim das palavras.
export function VadLevelMeter({
  levelDb,
  thresholdDb,
  className
}: {
  levelDb: number
  /** `null` enquanto não há limiar conhecido (automático ainda sem leitura). */
  thresholdDb: number | null
  className?: string
}): React.JSX.Element {
  // 1% por dB a partir de −100: `level - 100` é o nível já preso na faixa.
  const level = dbToPercent(levelDb)
  const threshold = thresholdDb === null ? null : dbToPercent(thresholdDb)
  const below = threshold === null ? level : Math.min(level, threshold)
  const above = threshold === null ? 0 : Math.max(0, level - threshold)

  return (
    <div
      data-slot="vad-level-meter"
      role="meter"
      aria-label="Nível do microfone"
      aria-valuemin={-100}
      aria-valuemax={0}
      aria-valuenow={Math.round(level - 100)}
      aria-valuetext={formatDb(levelDb)}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        data-slot="vad-level-below"
        className="absolute inset-y-0 left-0 bg-warning"
        style={{ width: `${below}%` }}
      />
      {threshold !== null && (
        <>
          <div
            data-slot="vad-level-above"
            className="absolute inset-y-0 bg-success"
            style={{ left: `${threshold}%`, width: `${above}%` }}
          />
          <div
            data-slot="vad-level-threshold"
            aria-hidden="true"
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-strong"
            style={{ left: `${threshold}%` }}
          />
        </>
      )}
    </div>
  )
}
