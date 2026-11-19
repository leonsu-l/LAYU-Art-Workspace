import { useCallback, useEffect, useRef, useState } from 'react'

export type SnackbarTone = 'info' | 'success' | 'warning'

export interface SnackbarPayload {
  message: string
  tone?: SnackbarTone
  actionLabel?: string
  onAction?: () => void
  durationMs?: number
}

export interface SnackbarItem extends SnackbarPayload {
  id: number
  tone: SnackbarTone
  closing: boolean
}

const EXIT_DURATION_MS = 180

export function useSnackbar() {
  const [snackbar, setSnackbar] = useState<SnackbarItem | null>(null)
  const seqRef = useRef(0)
  const isVisibleRef = useRef(false)
  const autoTimerRef = useRef<number | null>(null)
  const exitTimerRef = useRef<number | null>(null)

  const clearTimers = useCallback(() => {
    if (autoTimerRef.current !== null) {
      window.clearTimeout(autoTimerRef.current)
      autoTimerRef.current = null
    }
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current)
      exitTimerRef.current = null
    }
  }, [])

  const dismissSnackbar = useCallback(() => {
    clearTimers()
    isVisibleRef.current = false
    setSnackbar((prev) => (prev ? { ...prev, closing: true } : null))
    exitTimerRef.current = window.setTimeout(() => {
      setSnackbar(null)
      exitTimerRef.current = null
    }, EXIT_DURATION_MS)
  }, [clearTimers])

  const scheduleAutoDismiss = useCallback(
    (delayMs: number) => {
      if (autoTimerRef.current !== null) {
        window.clearTimeout(autoTimerRef.current)
      }
      autoTimerRef.current = window.setTimeout(() => {
        dismissSnackbar()
      }, delayMs)
    },
    [dismissSnackbar],
  )

  const showSnackbar = useCallback(
    (payload: SnackbarPayload) => {
      clearTimers()
      seqRef.current += 1
      isVisibleRef.current = true
      const tone: SnackbarTone = payload.tone ?? 'info'
      const delayMs = payload.durationMs ?? (tone === 'warning' ? 5200 : 3800)

      setSnackbar({
        ...payload,
        id: seqRef.current,
        tone,
        closing: false,
      })

      scheduleAutoDismiss(delayMs)
    },
    [clearTimers, scheduleAutoDismiss],
  )

  const pauseSnackbar = useCallback(() => {
    if (autoTimerRef.current !== null) {
      window.clearTimeout(autoTimerRef.current)
      autoTimerRef.current = null
    }
  }, [])

  const resumeSnackbar = useCallback(() => {
    if (isVisibleRef.current) {
      scheduleAutoDismiss(2600)
    }
  }, [scheduleAutoDismiss])

  useEffect(() => clearTimers, [clearTimers])

  return {
    snackbar,
    showSnackbar,
    dismissSnackbar,
    pauseSnackbar,
    resumeSnackbar,
  }
}
