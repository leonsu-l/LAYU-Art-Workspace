import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  computeMenuPlacement,
  findFirstEnabledIndex,
  findLastEnabledIndex,
  findNextEnabledIndex,
  findSelectedEnabledIndex,
  type SelectOptionItem,
} from '../src/components/ui/selectNavigation.ts'
import {
  readStoredThemeMode,
  resolveTheme,
  saveThemeMode,
  THEME_STORAGE_KEY,
} from '../src/utils/theme.ts'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

test('theme preference defaults to system, persists valid choices, and respects manual overrides', () => {
  const storage = new MemoryStorage()

  assert.equal(readStoredThemeMode(storage), 'system')
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('system', false), 'light')

  saveThemeMode('light', storage)
  assert.equal(readStoredThemeMode(storage), 'light')
  assert.equal(resolveTheme('light', true), 'light')

  saveThemeMode('dark', storage)
  assert.equal(readStoredThemeMode(storage), 'dark')
  assert.equal(resolveTheme('dark', false), 'dark')

  storage.setItem(THEME_STORAGE_KEY, 'invalid-mode')
  assert.equal(readStoredThemeMode(storage), 'system')
})

test('select keyboard navigation skips disabled options and wraps cleanly', () => {
  const options: SelectOptionItem[] = [
    { value: 'a', label: 'A', disabled: true },
    { value: 'b', label: 'B' },
    { value: 'c', label: 'C', disabled: true },
    { value: 'd', label: 'D' },
  ]

  assert.equal(findFirstEnabledIndex(options), 1)
  assert.equal(findLastEnabledIndex(options), 3)
  assert.equal(findSelectedEnabledIndex(options, 'a'), 1)
  assert.equal(findSelectedEnabledIndex(options, 'd'), 3)
  assert.equal(findNextEnabledIndex(options, 1, 1), 3)
  assert.equal(findNextEnabledIndex(options, 3, 1), 1)
  assert.equal(findNextEnabledIndex(options, 1, -1), 3)

  const allDisabled: SelectOptionItem[] = [
    { value: 'x', label: 'X', disabled: true },
    { value: 'y', label: 'Y', disabled: true },
  ]
  assert.equal(findFirstEnabledIndex(allDisabled), -1)
  assert.equal(findNextEnabledIndex(allDisabled, 0, 1), -1)
})

test('select menu placement flips upward near bottom edge and clamps within narrow viewports', () => {
  const flipped = computeMenuPlacement(
    { top: 760, bottom: 806, left: 20, right: 240, width: 220, height: 46 },
    { width: 390, height: 844 },
    260,
  )
  assert.equal(flipped.placement, 'top')
  assert.ok(flipped.top >= 12 && flipped.top < 760)

  const clampedNarrow = computeMenuPlacement(
    { top: 100, bottom: 146, left: 240, right: 440, width: 200, height: 46 },
    { width: 320, height: 640 },
    220,
  )
  assert.equal(clampedNarrow.placement, 'bottom')
  assert.ok(clampedNarrow.left >= 12)
  assert.ok(clampedNarrow.left + clampedNarrow.minWidth <= 320 - 12)
})
