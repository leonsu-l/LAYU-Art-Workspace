export interface SelectOptionItem<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
}

export interface RectLike {
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
}

export interface ViewportSize {
  width: number
  height: number
}

export interface MenuPlacement {
  placement: 'bottom' | 'top'
  top: number
  left: number
  minWidth: number
  maxWidth: number
  maxHeight: number
}

export function findFirstEnabledIndex<T extends string>(options: readonly SelectOptionItem<T>[]): number {
  return options.findIndex((option) => !option.disabled)
}

export function findLastEnabledIndex<T extends string>(options: readonly SelectOptionItem<T>[]): number {
  for (let i = options.length - 1; i >= 0; i -= 1) {
    if (!options[i].disabled) return i
  }
  return -1
}

export function findSelectedEnabledIndex<T extends string>(
  options: readonly SelectOptionItem<T>[],
  value: T,
): number {
  const index = options.findIndex((option) => option.value === value && !option.disabled)
  return index >= 0 ? index : findFirstEnabledIndex(options)
}

export function findNextEnabledIndex<T extends string>(
  options: readonly SelectOptionItem<T>[],
  currentIndex: number,
  delta: 1 | -1,
): number {
  const count = options.length
  if (count === 0) return -1

  let cursor = currentIndex
  for (let step = 0; step < count; step += 1) {
    cursor = (cursor + delta + count) % count
    if (!options[cursor].disabled) {
      return cursor
    }
  }
  return -1
}

export function computeMenuPlacement(
  triggerRect: RectLike,
  viewport: ViewportSize,
  estimatedMenuHeight: number,
  preferredMaxHeight = 320,
): MenuPlacement {
  const margin = 12
  const gap = 6
  const spaceBelow = Math.max(0, viewport.height - triggerRect.bottom - margin - gap)
  const spaceAbove = Math.max(0, triggerRect.top - margin - gap)

  const shouldFlipTop = spaceBelow < Math.min(estimatedMenuHeight, 200) && spaceAbove > spaceBelow
  const placement: 'bottom' | 'top' = shouldFlipTop ? 'top' : 'bottom'

  const availableVertical = placement === 'bottom' ? spaceBelow : spaceAbove
  const maxHeight = Math.max(120, Math.min(preferredMaxHeight, availableVertical))
  const renderedHeight = Math.min(estimatedMenuHeight, maxHeight)

  const top =
    placement === 'bottom'
      ? Math.min(viewport.height - margin - renderedHeight, triggerRect.bottom + gap)
      : Math.max(margin, triggerRect.top - gap - renderedHeight)

  const maxWidth = Math.max(180, viewport.width - margin * 2)
  const minWidth = Math.min(Math.max(triggerRect.width, 180), maxWidth)
  const left = Math.max(margin, Math.min(triggerRect.left, viewport.width - margin - minWidth))

  return {
    placement,
    top,
    left,
    minWidth,
    maxWidth,
    maxHeight,
  }
}
