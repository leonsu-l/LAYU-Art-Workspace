import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ThemeContext } from '../hooks/themeContext'
import {
  applyThemeToDocument,
  getSystemPrefersDark,
  readStoredThemeMode,
  resolveTheme,
  saveThemeMode,
  type ThemeMode,
} from '../utils/theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredThemeMode())
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => getSystemPrefersDark())

  const resolvedTheme = resolveTheme(mode, systemPrefersDark)

  useEffect(() => {
    applyThemeToDocument(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches)
    }
    mediaQuery.addEventListener('change', handleChange)
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode)
    saveThemeMode(nextMode)
  }, [])

  const value = useMemo(
    () => ({ mode, resolvedTheme, setMode }),
    [mode, resolvedTheme, setMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
