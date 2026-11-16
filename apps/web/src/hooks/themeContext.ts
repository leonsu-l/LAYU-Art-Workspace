import { createContext } from 'react'
import type { ResolvedTheme, ThemeMode } from '../utils/theme'

export interface ThemeContextValue {
  mode: ThemeMode
  resolvedTheme: ResolvedTheme
  setMode: (nextMode: ThemeMode) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)
