import { useEffect } from 'react'

export function useBeforeUnloadGuard(enabled: boolean, message: string): void {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    if (!enabled) {
      window.onbeforeunload = null
      return
    }

    window.onbeforeunload = (event) => {
      event.preventDefault()
      event.returnValue = message
      return message
    }

    return () => {
      window.onbeforeunload = null
    }
  }, [enabled, message])
}
