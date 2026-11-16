import { useCallback, useState, type PointerEvent as ReactPointerEvent } from 'react'

export interface RippleWave {
  id: number
  size: number
  left: number
  top: number
}

let nextRippleId = 1

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function useRipple(disabled = false) {
  const [ripples, setRipples] = useState<RippleWave[]>([])

  const triggerRipple = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled || prefersReducedMotion()) return
      if (event.button !== 0 && event.pointerType === 'mouse') return

      const el = event.currentTarget
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return

      const x = event.clientX ? event.clientX - rect.left : rect.width / 2
      const y = event.clientY ? event.clientY - rect.top : rect.height / 2
      const radius = Math.max(
        Math.hypot(x, y),
        Math.hypot(rect.width - x, y),
        Math.hypot(x, rect.height - y),
        Math.hypot(rect.width - x, rect.height - y),
      )

      const wave: RippleWave = {
        id: nextRippleId++,
        size: radius * 2,
        left: x - radius,
        top: y - radius,
      }

      setRipples((prev) => [...prev.slice(-2), wave])
    },
    [disabled],
  )

  const dismissRipple = useCallback((id: number) => {
    setRipples((prev) => prev.filter((item) => item.id !== id))
  }, [])

  return { ripples, triggerRipple, dismissRipple }
}
