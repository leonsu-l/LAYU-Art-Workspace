import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import {
  computeMenuPlacement,
  findFirstEnabledIndex,
  findLastEnabledIndex,
  findNextEnabledIndex,
  findSelectedEnabledIndex,
  type MenuPlacement,
  type SelectOptionItem,
} from './selectNavigation'
import { useRipple } from './useRipple'
import styles from './M3Select.module.css'

export type { SelectOptionItem } from './selectNavigation'

interface M3SelectProps<T extends string> {
  id?: string
  value: T
  options: readonly SelectOptionItem<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  placeholder?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  className?: string
}

const OPTION_ROW_ESTIMATE = 46
const MENU_PADDING_ESTIMATE = 16
const CLOSE_ANIMATION_MS = 140

export function M3Select<T extends string>(props: M3SelectProps<T>) {
  const {
    id,
    value,
    options,
    onChange,
    disabled = false,
    placeholder = '请选择',
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    'aria-describedby': ariaDescribedBy,
    className,
  } = props

  const baseId = useId()
  const triggerId = id ?? `${baseId}-trigger`
  const listboxId = `${baseId}-listbox`

  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])
  const closeTimerRef = useRef<number | null>(null)

  const [isOpenState, setIsOpenState] = useState(false)
  const [isRenderedState, setIsRenderedState] = useState(false)
  const isOpen = isOpenState && !disabled
  const isRendered = isRenderedState && !disabled
  const [activeIndex, setActiveIndex] = useState<number>(() => findSelectedEnabledIndex(options, value))
  const [placement, setPlacement] = useState<MenuPlacement | null>(null)

  const { ripples, triggerRipple, dismissRipple } = useRipple(disabled)

  const selectedOption = options.find((option) => option.value === value)
  const displayLabel = selectedOption?.label ?? placeholder

  const updateMenuPosition = useCallback(() => {
    const triggerEl = triggerRef.current
    if (!triggerEl) return
    const rect = triggerEl.getBoundingClientRect()
    const estimatedHeight = options.length * OPTION_ROW_ESTIMATE + MENU_PADDING_ESTIMATE
    const nextPlacement = computeMenuPlacement(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      estimatedHeight,
    )
    setPlacement(nextPlacement)
  }, [options.length])

  const openMenu = useCallback(
    (initialActive?: number) => {
      if (disabled || options.length === 0) return
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      const nextActive =
        initialActive !== undefined && initialActive >= 0
          ? initialActive
          : findSelectedEnabledIndex(options, value)
      setActiveIndex(nextActive)
      setIsRenderedState(true)
      setIsOpenState(true)
    },
    [disabled, options, value],
  )

  const closeMenu = useCallback((returnFocus = false) => {
    setIsOpenState(false)
    if (returnFocus) {
      triggerRef.current?.focus()
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
    }
    closeTimerRef.current = window.setTimeout(() => {
      setIsRenderedState(false)
      closeTimerRef.current = null
    }, CLOSE_ANIMATION_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (!isOpen) return
    updateMenuPosition()
  }, [isOpen, updateMenuPosition, options.length])

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      closeMenu(false)
    }

    const handleViewportChange = () => {
      updateMenuPosition()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [isOpen, closeMenu, updateMenuPosition])

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return
    const activeEl = optionRefs.current[activeIndex]
    activeEl?.scrollIntoView({ block: 'nearest' })
  }, [isOpen, activeIndex])

  const commitSelection = useCallback(
    (index: number) => {
      const option = options[index]
      if (!option || option.disabled) return
      if (option.value !== value) {
        onChange(option.value)
      }
      closeMenu(true)
    },
    [options, value, onChange, closeMenu],
  )

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        if (!isOpen) {
          openMenu(findSelectedEnabledIndex(options, value))
        } else {
          setActiveIndex((prev) => findNextEnabledIndex(options, prev < 0 ? -1 : prev, 1))
        }
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        if (!isOpen) {
          openMenu(findSelectedEnabledIndex(options, value))
        } else {
          setActiveIndex((prev) => findNextEnabledIndex(options, prev < 0 ? 0 : prev, -1))
        }
        break
      }
      case 'Home': {
        if (!isOpen) return
        event.preventDefault()
        setActiveIndex(findFirstEnabledIndex(options))
        break
      }
      case 'End': {
        if (!isOpen) return
        event.preventDefault()
        setActiveIndex(findLastEnabledIndex(options))
        break
      }
      case 'Enter':
      case ' ': {
        event.preventDefault()
        if (!isOpen) {
          openMenu()
        } else if (activeIndex >= 0) {
          commitSelection(activeIndex)
        } else {
          closeMenu(true)
        }
        break
      }
      case 'Escape': {
        if (!isOpen) return
        event.preventDefault()
        event.stopPropagation()
        closeMenu(true)
        break
      }
      case 'Tab': {
        if (isOpen) {
          closeMenu(false)
        }
        break
      }
      default:
        break
    }
  }

  const activeOptionId = isOpen && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined

  return (
    <div className={`${styles.root} ${isOpen ? styles.open : ''} ${className ?? ''}`}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        className={styles.trigger}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        title={displayLabel}
        onPointerDown={triggerRipple}
        onClick={() => (isOpen ? closeMenu(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={styles.rippleLayer} aria-hidden="true">
          {ripples.map((wave) => (
            <span
              key={wave.id}
              className={styles.ripple}
              style={{
                width: `${wave.size}px`,
                height: `${wave.size}px`,
                left: `${wave.left}px`,
                top: `${wave.top}px`,
              }}
              onAnimationEnd={() => dismissRipple(wave.id)}
            />
          ))}
        </span>
        <span className={styles.value}>{displayLabel}</span>
        <span className={styles.arrow} aria-hidden="true">
          <Icon name="chevron-down" size={18} />
        </span>
      </button>

      {isRendered && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
              aria-labelledby={ariaLabelledBy ?? triggerId}
              aria-hidden={!isOpen}
              data-placement={placement?.placement ?? 'bottom'}
              className={`${styles.menu} ${isOpen ? styles.menuOpen : styles.menuClosing}`}
              style={
                placement
                  ? {
                      top: `${placement.top}px`,
                      left: `${placement.left}px`,
                      minWidth: `${placement.minWidth}px`,
                      maxWidth: `${placement.maxWidth}px`,
                      maxHeight: `${placement.maxHeight}px`,
                    }
                  : undefined
              }
            >
              {options.map((option, index) => {
                const isSelected = option.value === value
                const isActive = isOpen && index === activeIndex && !option.disabled
                return (
                  <OptionRow
                    key={option.value}
                    id={`${listboxId}-opt-${index}`}
                    refCallback={(el) => {
                      optionRefs.current[index] = el
                    }}
                    label={option.label}
                    selected={isSelected}
                    active={isActive}
                    disabled={Boolean(option.disabled)}
                    onHover={() => {
                      if (!option.disabled) setActiveIndex(index)
                    }}
                    onSelect={() => commitSelection(index)}
                  />
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

interface OptionRowProps {
  id: string
  label: string
  selected: boolean
  active: boolean
  disabled: boolean
  refCallback: (el: HTMLDivElement | null) => void
  onHover: () => void
  onSelect: () => void
}

function OptionRow({
  id,
  label,
  selected,
  active,
  disabled,
  refCallback,
  onHover,
  onSelect,
}: OptionRowProps) {
  const { ripples, triggerRipple, dismissRipple } = useRipple(disabled)

  return (
    <div
      ref={refCallback}
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      className={`${styles.option} ${active ? styles.optionActive : ''} ${disabled ? styles.optionDisabled : ''}`}
      onPointerDown={(event) => {
        // Keep focus on the combobox trigger while allowing click selection.
        event.preventDefault()
        triggerRipple(event)
      }}
      onPointerEnter={onHover}
      onClick={() => {
        if (!disabled) onSelect()
      }}
    >
      <span className={styles.rippleLayer} aria-hidden="true">
        {ripples.map((wave) => (
          <span
            key={wave.id}
            className={styles.ripple}
            style={{
              width: `${wave.size}px`,
              height: `${wave.size}px`,
              left: `${wave.left}px`,
              top: `${wave.top}px`,
            }}
            onAnimationEnd={() => dismissRipple(wave.id)}
          />
        ))}
      </span>
      <span className={styles.optionLabel}>{label}</span>
      <span className={styles.check} aria-hidden="true">
        <Icon name="check" size={17} />
      </span>
    </div>
  )
}
