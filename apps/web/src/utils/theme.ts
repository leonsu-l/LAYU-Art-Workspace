export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'nanobanana.theme-mode'

export const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: '#141310',
  light: '#fef8e9',
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function readStoredThemeMode(storage: Pick<Storage, 'getItem'> | undefined = getSafeLocalStorage()): ThemeMode {
  if (!storage) return 'system'
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY)
    return isThemeMode(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

export function saveThemeMode(mode: ThemeMode, storage: Pick<Storage, 'setItem'> | undefined = getSafeLocalStorage()): void {
  if (!storage) return
  try {
    storage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // Ignore storage failures so theme toggling stays non-blocking.
  }
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') {
    return mode
  }
  return systemPrefersDark ? 'dark' : 'light'
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyThemeToDocument(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', THEME_COLORS[resolved])
  }
}

function getSafeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined
  } catch {
    return undefined
  }
}
