import { useEffect, useRef } from 'react'

/**
 * Calls `fn` every `ms` while the window is visible. Never overlaps: the next round only
 * starts after the previous one settled. Pauses when the window is hidden or minimized.
 */
export function usePolling(fn, ms, { enabled = true, immediate = false } = {}) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!enabled) return
    let timer = null
    let stopped = false
    let running = false

    const tick = async () => {
      if (stopped || running || document.hidden) return
      running = true
      try {
        await fnRef.current()
      } catch {
        // callers handle their own errors; a failed silent refresh keeps old data on screen
      } finally {
        running = false
        if (!stopped) timer = setTimeout(tick, ms)
      }
    }
    const onVisibility = () => {
      if (!document.hidden && !running) {
        clearTimeout(timer)
        tick()
      }
    }
    timer = setTimeout(tick, immediate ? 0 : ms)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms, enabled, immediate])
}
