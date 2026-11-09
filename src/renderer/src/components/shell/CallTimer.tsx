import { useEffect, useState } from 'react'

import { formatCallDuration } from '@/lib/call-timer'

/** Cronômetro da call: tique de 1s a partir de `since` (ms desde a época). */
export function CallTimer({ since }: { since: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <span className="shrink-0 font-mono text-xs tabular-nums text-voice">
      {formatCallDuration(now - since)}
    </span>
  )
}
