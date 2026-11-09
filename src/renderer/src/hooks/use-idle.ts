import { useCallback, useEffect, useRef, useState } from 'react'

/** Fica `idle` depois de `ms` sem o mouse mexer; `bind.onMouseMove` zera a contagem. */
export function useIdle(ms: number): { idle: boolean; bind: { onMouseMove(): void } } {
  const [idle, setIdle] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setIdle(true), ms)
  }, [ms])

  useEffect(() => {
    arm()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [arm])

  const onMouseMove = useCallback(() => {
    setIdle(false)
    arm()
  }, [arm])

  return { idle, bind: { onMouseMove } }
}
