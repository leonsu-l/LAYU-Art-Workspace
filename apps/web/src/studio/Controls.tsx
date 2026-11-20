import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { ProviderType } from '@nanobanana/shared/types/generation'
import type { Channel, ModelCatalog, Quota, Template } from '@nanobanana/shared/types/studio'
import { Icon } from '../components/Icon'
import { useRipple } from '../components/ui/useRipple'
import {
  findFirstEnabledIndex,
  findLastEnabledIndex,
  findNextEnabledIndex,
  findSelectedEnabledIndex,
  type SelectOptionItem,
} from '../components/ui/selectNavigation'
import { RippleButton, RippleOverlay } from './Ripple'
import rippleStyles from './Ripple.module.css'
import { SkeletonBlock } from './Skeleton'
import styles from './Controls.module.css'

/* --------------------------------------------------------------------------
   1. Authentic M3 Expressive Select (faithful to m3_example.html language)
   -------------------------------------------------------------------------- */
export function StudioSelect<T extends string>({
  id,
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  id?: string
  label?: string
  value: T
  options: readonly SelectOptionItem<T>[]
  disabled?: boolean
  onChange: (value: T) => void
}) {
  const autoId = useId()
  const triggerId = id ?? `${autoId}-select`
  const listboxId = `${autoId}-listbox`
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() => findSelectedEnabledIndex(options, value))
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const current = options.find((opt) => opt.value === value)

  useEffect(() => {
    if (!open) return
    const handleOutside = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleOutside)
    return () => document.removeEventListener('pointerdown', handleOutside)
  }, [open])

  function selectIndex(idx: number) {
    const opt = options[idx]
    if (!opt || opt.disabled) return
    onChange(opt.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={rootRef} className={`${styles.selectRoot} ${open ? styles.selectOpen : ''}`}>
      <RippleButton
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        disabled={disabled}
        className={styles.selectTrigger}
        onClick={() => {
          if (disabled) return
          if (!open) setActiveIndex(findSelectedEnabledIndex(options, value))
          setOpen((prev) => !prev)
        }}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            if (!open) {
              setActiveIndex(findSelectedEnabledIndex(options, value))
              setOpen(true)
            } else {
              setActiveIndex((prev) => findNextEnabledIndex(options, prev, 1))
            }
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) {
              setActiveIndex(findSelectedEnabledIndex(options, value))
              setOpen(true)
            } else {
              setActiveIndex((prev) => findNextEnabledIndex(options, prev, -1))
            }
          } else if (event.key === 'Home' && open) {
            event.preventDefault()
            setActiveIndex(findFirstEnabledIndex(options))
          } else if (event.key === 'End' && open) {
            event.preventDefault()
            setActiveIndex(findLastEnabledIndex(options))
          } else if ((event.key === 'Enter' || event.key === ' ') && open) {
            event.preventDefault()
            selectIndex(activeIndex)
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            setOpen(false)
            triggerRef.current?.focus()
          } else if (event.key === 'Tab' && open) {
            setOpen(false)
          }
        }}
      >
        <span className={styles.selectValue}>{current?.label ?? '请选择'}</span>
        <span className={styles.selectChevron} aria-hidden="true">
          <Icon name="chevron-down" size={18} />
        </span>
      </RippleButton>

      {open ? (
        <div id={listboxId} role="listbox" className={styles.selectMenu}>
          {options.map((option, idx) => (
            <SelectOptionItemRow
              key={option.value}
              id={`${listboxId}-${idx}`}
              label={option.label}
              selected={option.value === value}
              active={idx === activeIndex}
              disabled={Boolean(option.disabled)}
              onHover={() => {
                if (!option.disabled) setActiveIndex(idx)
              }}
              onSelect={() => selectIndex(idx)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SelectOptionItemRow({
  id,
  label,
  selected,
  active,
  disabled,
  onHover,
  onSelect,
}: {
  label: string
  selected: boolean
  id: string
  active: boolean
  disabled: boolean
  onHover: () => void
  onSelect: () => void
}) {
  const { ripples, triggerRipple, dismissRipple } = useRipple(disabled)
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      className={`${rippleStyles.rippleHost} ${styles.selectOption} ${active ? styles.selectOptionActive : ''} ${disabled ? styles.selectOptionDisabled : ''}`}
      onPointerDown={(event) => {
        event.preventDefault()
        triggerRipple(event)
      }}
      onPointerEnter={onHover}
      onClick={() => {
        if (!disabled) onSelect()
      }}
    >
      <RippleOverlay ripples={ripples} onDone={dismissRipple} />
      <span className={styles.selectOptionText}>{label}</span>
      <span className={styles.selectCheck} aria-hidden="true">
        <Icon name="check" size={17} />
      </span>
    </div>
  )
}

/* --------------------------------------------------------------------------
   2. M3 Expressive Connected Button Group (with Shape Morphing!)
   Outer ends rounded (20px), inner joints snug (6px), selected morphs to pill!
   -------------------------------------------------------------------------- */
export function SegmentedRail<T extends string>({
  label,
  value,
  options,
  wrapOnMobile = false,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  wrapOnMobile?: boolean
  onChange: (next: T) => void
}) {
  return (
    <div
      className={`${styles.connectedGroup} ${wrapOnMobile ? styles.connectedGroupWrap : ''}`}
      role="group"
      aria-label={label}
    >
      {options.map((opt) => (
        <ConnectedSegmentButton
          key={opt.value}
          active={opt.value === value}
          label={opt.label}
          onClick={() => onChange(opt.value)}
        />
      ))}
    </div>
  )
}

function ConnectedSegmentButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <RippleButton
      type="button"
      aria-pressed={active}
      className={`${styles.connectedBtn} ${active ? styles.connectedBtnActive : ''}`}
      onClick={onClick}
    >
      <span className={styles.btnContent}>{label}</span>
    </RippleButton>
  )
}

/* --------------------------------------------------------------------------
   3. M3 Expressive Visual Ratio Selector (Connected tiles + shape morphing)
   -------------------------------------------------------------------------- */
export interface RatioPreset {
  id: string
  label: string
  w: number
  h: number
}

const DEFAULT_RATIO_PRESETS: RatioPreset[] = [
  { id: 'auto', label: '自动', w: 1, h: 1 },
  { id: '1:1', label: '1:1', w: 1, h: 1 },
  { id: '4:3', label: '4:3', w: 4, h: 3 },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
  { id: '16:9', label: '16:9', w: 16, h: 9 },
  { id: '9:16', label: '9:16', w: 9, h: 16 },
]

export function RatioTileSelector({
  value,
  onChange,
  presets = DEFAULT_RATIO_PRESETS,
}: {
  value: string
  onChange: (id: string) => void
  presets?: RatioPreset[]
}) {
  return (
    <div className={styles.ratioGrid} role="radiogroup" aria-label="画面比例">
      {presets.map((preset) => (
        <RatioTileItem
          key={preset.id}
          preset={preset}
          selected={value === preset.id}
          onSelect={() => onChange(preset.id)}
        />
      ))}
    </div>
  )
}

function RatioTileItem({
  preset,
  selected,
  onSelect,
}: {
  preset: RatioPreset
  selected: boolean
  onSelect: () => void
}) {
  const maxSide = 16
  const scale = maxSide / Math.max(preset.w, preset.h)
  const boxW = Math.max(8, Math.round(preset.w * scale))
  const boxH = Math.max(8, Math.round(preset.h * scale))

  return (
    <RippleButton
      type="button"
      role="radio"
      aria-checked={selected}
      className={`${styles.ratioTile} ${selected ? styles.ratioTileActive : ''}`}
      onClick={onSelect}
    >
      <span className={styles.ratioPreviewSlot} aria-hidden="true">
        {preset.id === 'auto' ? (
          <Icon name="sparkles" size={15} />
        ) : (
          <span
            className={styles.ratioFrame}
            style={{ width: `${boxW}px`, height: `${boxH}px` }}
          />
        )}
      </span>
      <span className={styles.ratioLabel}>{preset.label}</span>
    </RippleButton>
  )
}

/* --------------------------------------------------------------------------
   4. M3 Expressive Connected Count Stepper (- [ n ] +)
   -------------------------------------------------------------------------- */
export function CountStepper({
  value,
  min = 1,
  max = 10,
  onChange,
}: {
  value: number
  min?: number
  max?: number
  onChange: (next: number) => void
}) {
  return (
    <div className={styles.stepper} role="group" aria-label="生成数量">
      <RippleButton
        type="button"
        className={`${styles.stepperBtn} ${styles.stepperStart}`}
        disabled={value <= min}
        aria-label="减少数量"
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <span className={styles.btnContent}>−</span>
      </RippleButton>
      <span className={styles.stepperValue} aria-live="polite">
        {value} 张
      </span>
      <RippleButton
        type="button"
        className={`${styles.stepperBtn} ${styles.stepperEnd}`}
        disabled={value >= max}
        aria-label="增加数量"
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <span className={styles.btnContent}>+</span>
      </RippleButton>
    </div>
  )
}

/* --------------------------------------------------------------------------
   5. M3 Expressive Split Primary CTA (Leading Filled + Connected Menu Trigger)
   -------------------------------------------------------------------------- */
export function M3SplitGenerateButton({
  label,
  busy = false,
  disabled = false,
  templates,
  onGenerate,
  onApplyTemplate,
}: {
  label: string
  busy?: boolean
  disabled?: boolean
  templates: Template[]
  onGenerate: () => void
  onApplyTemplate: (template: Template) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onOutside = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onOutside)
    return () => document.removeEventListener('pointerdown', onOutside)
  }, [menuOpen])

  return (
    <div ref={wrapRef} className={styles.splitWrap}>
      <RippleButton
        type="button"
        className={styles.splitMain}
        disabled={disabled}
        onClick={onGenerate}
      >
        <Icon name={busy ? 'loader' : 'sparkles'} size={18} className={busy ? styles.spin : ''} />
        <span className={styles.btnContent}>{label}</span>
      </RippleButton>
      <RippleButton
        type="button"
        className={`${styles.splitSide} ${menuOpen ? styles.splitSideOpen : ''}`}
        aria-label="快捷套用参数模板"
        aria-expanded={menuOpen}
        disabled={templates.length === 0}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <Icon name="chevron-down" size={18} className={menuOpen ? styles.splitChevronUp : ''} />
      </RippleButton>

      {menuOpen ? (
        <div className={styles.splitMenu} role="menu" aria-label="快捷参数模板">
          <div className={styles.splitMenuLabel}>套用管理员预填模板</div>
          {templates.map((tpl) => (
            <RippleButton
              key={tpl.id}
              type="button"
              role="menuitem"
              className={styles.splitMenuItem}
              onClick={() => {
                onApplyTemplate(tpl)
                setMenuOpen(false)
              }}
            >
              <Icon name="sliders" size={14} />
              <span>{tpl.name}</span>
            </RippleButton>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* --------------------------------------------------------------------------
   6. Compact Channel & Model Card Trigger + Elevated M3 Popover
   -------------------------------------------------------------------------- */
export function ChannelModelBar({
  channels,
  channelId,
  provider,
  model,
  catalog,
  catalogLoading = false,
  templates,
  quota,
  onChannelChange,
  onProviderChange,
  onModelChange,
  onApplyTemplate,
  compact = false,
  explicitSelection = false,
}: {
  channels: Channel[]
  channelId: string
  provider: ProviderType
  model: string
  catalog: ModelCatalog | null
  catalogLoading?: boolean
  templates: Template[]
  quota: Quota | null
  onChannelChange: (id: string) => void
  onProviderChange: (p: ProviderType) => void
  onModelChange: (modelId: string) => void
  onApplyTemplate: (template: Template) => void
  explicitSelection?: boolean
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'shared' | 'private'>('shared')
  const containerRef = useRef<HTMLDivElement>(null)

  const currentChannel = channels.find((item) => item.id === channelId)
  const activeScope = currentChannel?.scope ?? scope
  const matchingChannels = channels.filter(
    (item) => item.scope === activeScope && item.provider === provider,
  )
  const catalogModels = currentChannel?.scope === 'shared'
    ? currentChannel.enabledModels.map((id) => catalog?.models.find((m) => m.id === id) ?? { id, name: id })
    : catalog?.models ?? []
  const matchingTemplates = templates.filter((item) => item.provider === provider)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className={styles.channelBarRoot}>
      <RippleButton
        type="button"
        className={`${styles.channelTrigger} ${compact ? styles.channelTriggerCompact : ''} ${!currentChannel || !model ? styles.channelTriggerWarn : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={styles.channelTriggerLeading}>
          <span className={styles.channelAvatar} aria-hidden="true">
            <Icon name="sliders" size={16} />
          </span>
          <span className={styles.channelTriggerMain}>
            <span className={styles.channelScopeBadge}>
              {currentChannel
                ? `${currentChannel.scope === 'shared' ? '站点默认' : '私有渠道'} · ${provider === 'openai-compatible' ? 'OpenAI' : 'Gemini'}`
                : '尚未选择渠道'}
            </span>
            <span className={styles.channelModelName}>
              {model || '点击选择渠道与模型'}
            </span>
          </span>
        </span>
        <span className={styles.channelTriggerSide}>
          {currentChannel?.scope === 'shared' && quota ? (
            <span className={styles.quotaBadge}>
              {!quota.configured ? '未配置额度' : quota.unlimited ? '无限次' : `余 ${quota.remaining ?? 0}/${quota.limit ?? 0}`}
            </span>
          ) : currentChannel?.scope === 'private' ? (
            <span className={styles.quotaBadge}>不占额度</span>
          ) : null}
          <span className={`${styles.channelChevronWrap} ${open ? styles.channelChevronOpen : ''}`}>
            <Icon name="chevron-down" size={16} />
          </span>
        </span>
      </RippleButton>

      {open ? (
        <div className={styles.channelPopover} role="dialog" aria-label="渠道、模型与参数模板设置">
          <div className={styles.popoverHeader}>
            <div>
              <strong>渠道与模型目录</strong>
              <span className={styles.popoverSub}>参数按「账号 + 渠道 + 模型」自动记忆</span>
            </div>
            <RippleButton type="button" className={styles.popoverClose} onClick={() => setOpen(false)} aria-label="关闭">
              <Icon name="close" size={15} />
            </RippleButton>
          </div>

          <div className={styles.popoverSplit}>
            <div className={styles.popoverField}>
              <span className={styles.popoverLabel}>渠道来源</span>
              <SegmentedRail
                label="渠道来源"
                value={activeScope}
                options={[
                  { value: 'shared', label: '站点默认' },
                  { value: 'private', label: '自定义' },
                ]}
                onChange={(nextScope) => {
                  if (nextScope === activeScope) return
                  setScope(nextScope)
                  if (explicitSelection) { onChannelChange(''); return }
                  const fallback = channels.find(
                    (c) => c.scope === nextScope && c.provider === provider && c.enabled,
                  )
                  onChannelChange(fallback?.id ?? '')
                }}
              />
            </div>
            <div className={styles.popoverField}>
              <span className={styles.popoverLabel}>接口协议</span>
              <SegmentedRail
                label="接口协议"
                value={provider}
                options={[
                  { value: 'openai-compatible', label: 'OpenAI' },
                  { value: 'gemini-compatible', label: 'Gemini' },
                ]}
                onChange={(nextProvider) => {
                  if (nextProvider === provider) return
                  setScope(activeScope)
                  onProviderChange(nextProvider)
                  if (explicitSelection) return
                  const fallback = channels.find(
                    (c) => c.scope === activeScope && c.provider === nextProvider && c.enabled,
                  )
                  if (fallback) onChannelChange(fallback.id)
                }}
              />
            </div>
          </div>

          <div className={styles.popoverField}>
            <span className={styles.popoverLabel}>具体渠道</span>
            <StudioSelect
              label="具体渠道"
              value={channelId}
              options={[
                { value: '', label: '请选择渠道' },
                ...matchingChannels.map((item) => ({
                  value: item.id,
                  label: `${item.name}${item.enabled ? '' : '（已停用）'}`,
                  disabled: !item.enabled,
                })),
              ]}
              onChange={onChannelChange}
            />
          </div>

          <div className={styles.popoverField}>
            <span className={styles.popoverLabel}>模型目录</span>
            <div className={styles.modelChipList}>
              {catalogLoading ? (
                <>
                  {[128, 96, 114, 88].map((chipWidth, idx) => (
                    <SkeletonBlock
                      key={idx}
                      variant="rect"
                      width={chipWidth}
                      height={34}
                      radius="var(--md-sys-shape-corner-small)"
                      staggerIndex={idx}
                    />
                  ))}
                </>
              ) : (
                <>
                  {catalogModels.map((item) => {
                    const active = item.id === model
                    return (
                      <RippleButton
                        key={item.id}
                        type="button"
                        aria-pressed={active}
                        className={`${styles.modelChoice} ${active ? styles.modelChoiceActive : ''}`}
                        onClick={() => onModelChange(item.id)}
                      >
                        {active ? <Icon name="check" size={14} /> : null}
                        <span>{item.name || item.id}</span>
                      </RippleButton>
                    )
                  })}
                  {catalogModels.length === 0 ? (
                    <span className={styles.popoverEmpty}>请先选择有效渠道以加载可用模型</span>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {currentChannel?.scope === 'private' ? (
            <div className={styles.popoverField}>
              <span className={styles.popoverLabel}>手填模型 ID（私有渠道可用）</span>
              <input
                aria-label="手填模型 ID"
                className={styles.popoverInput}
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                placeholder="输入兼容模型的 Model ID"
              />
            </div>
          ) : null}

          {matchingTemplates.length > 0 ? (
            <div className={styles.popoverField}>
              <span className={styles.popoverLabel}>快速套用参数模板（不覆盖模型）</span>
              <div className={styles.templateRow}>
                {matchingTemplates.map((tpl) => (
                  <RippleButton
                    key={tpl.id}
                    type="button"
                    className={styles.templateBtn}
                    onClick={() => {
                      onApplyTemplate(tpl)
                      setOpen(false)
                    }}
                  >
                    <Icon name="sliders" size={13} />
                    <span>{tpl.name}</span>
                  </RippleButton>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* --------------------------------------------------------------------------
   7. M3 Expressive Primary Tabs (Underline Indicator + Smooth Glide)
   Clean baseline hairline divider + animated primary pill bar, supporting
   continuous live swipe interpolation on mobile primary navigation.
   -------------------------------------------------------------------------- */
export interface PrimaryTabItem<T extends string> {
  id: T
  label: string
  badge?: string | number
}

export function M3PrimaryTabs<T extends string>({
  label,
  value,
  items,
  variant = 'fixed',
  swipeProgress = 0,
  inHeader = false,
  onChange,
}: {
  label: string
  value: T
  items: readonly PrimaryTabItem<T>[]
  variant?: 'fixed' | 'scrollable'
  swipeProgress?: number
  inHeader?: boolean
  onChange: (id: T) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([])
  const labelRefs = useRef<Array<HTMLSpanElement | null>>([])
  const hasPlacedRef = useRef(false)

  const syncIndicator = useCallback(() => {
    const innerEl = innerRef.current
    const indicatorEl = indicatorRef.current
    if (!innerEl || !indicatorEl || items.length === 0) return

    const activeIdx = Math.max(
      0,
      items.findIndex((item) => item.id === value),
    )
    const innerRect = innerEl.getBoundingClientRect()
    if (innerRect.width === 0) return

    const metrics = items.map((_, idx) => {
      const targetEl = labelRefs.current[idx] ?? btnRefs.current[idx]
      if (!targetEl) return null
      const rect = targetEl.getBoundingClientRect()
      const center = rect.left - innerRect.left + rect.width / 2
      const baseWidth = Math.max(22, Math.min(rect.width * 0.74, 38))
      return { center, baseWidth }
    })

    const current = metrics[activeIdx]
    if (!current) return

    let center = current.center
    let width = current.baseWidth
    const isDragging = Math.abs(swipeProgress) > 0.001

    if (isDragging) {
      if (swipeProgress > 0 && activeIdx < items.length - 1) {
        const next = metrics[activeIdx + 1]
        if (next) {
          const t = Math.min(1, swipeProgress)
          center = current.center + (next.center - current.center) * t
          const targetBase = current.baseWidth + (next.baseWidth - current.baseWidth) * t
          width = targetBase + Math.sin(t * Math.PI) * 16
        }
      } else if (swipeProgress < 0 && activeIdx > 0) {
        const prev = metrics[activeIdx - 1]
        if (prev) {
          const t = Math.min(1, -swipeProgress)
          center = current.center + (prev.center - current.center) * t
          const targetBase = current.baseWidth + (prev.baseWidth - current.baseWidth) * t
          width = targetBase + Math.sin(t * Math.PI) * 16
        }
      } else {
        // Gentle rubber-band nudge at outer boundary tabs
        center = current.center + swipeProgress * 10
      }
      indicatorEl.style.transition = 'none'
    } else if (!hasPlacedRef.current) {
      indicatorEl.style.transition = 'none'
    } else {
      indicatorEl.style.transition =
        'transform 280ms var(--md-sys-motion-easing-emphasized-decelerate), width 220ms var(--md-sys-motion-easing-standard), opacity 120ms ease'
    }

    indicatorEl.style.width = `${width}px`
    indicatorEl.style.transform = `translate3d(${center - width / 2}px, 0, 0)`
    indicatorEl.style.opacity = '1'

    if (!hasPlacedRef.current) {
      hasPlacedRef.current = true
      requestAnimationFrame(() => {
        if (indicatorRef.current) {
          indicatorRef.current.style.transition = ''
        }
      })
    }
  }, [items, swipeProgress, value])

  useLayoutEffect(() => {
    syncIndicator()
  }, [syncIndicator])

  useEffect(() => {
    const innerEl = innerRef.current
    if (!innerEl || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      syncIndicator()
    })
    observer.observe(innerEl)
    return () => observer.disconnect()
  }, [syncIndicator])

  // Keep selected scrollable tab comfortably inside horizontal view without scrolling page
  useEffect(() => {
    if (variant !== 'scrollable') return
    const trackEl = trackRef.current
    const activeIdx = items.findIndex((item) => item.id === value)
    const btnEl = btnRefs.current[activeIdx]
    if (!trackEl || !btnEl) return
    const desiredLeft = btnEl.offsetLeft - (trackEl.clientWidth - btnEl.offsetWidth) / 2
    trackEl.scrollTo({ left: Math.max(0, desiredLeft), behavior: 'smooth' })
  }, [items, value, variant])

  function handleTabKeyDown(idx: number, event: ReactKeyboardEvent<HTMLButtonElement>) {
    let nextIdx = -1
    if (event.key === 'ArrowRight') nextIdx = (idx + 1) % items.length
    else if (event.key === 'ArrowLeft') nextIdx = (idx - 1 + items.length) % items.length
    else if (event.key === 'Home') nextIdx = 0
    else if (event.key === 'End') nextIdx = items.length - 1
    if (nextIdx < 0) return
    event.preventDefault()
    btnRefs.current[nextIdx]?.focus()
    onChange(items[nextIdx].id)
  }

  return (
    <div
      ref={trackRef}
      data-no-swipe={variant === 'scrollable' ? 'true' : undefined}
      className={`${styles.primaryTabsTrack} ${
        variant === 'scrollable' ? styles.primaryTabsScrollable : styles.primaryTabsFixed
      } ${inHeader ? styles.primaryTabsInHeader : ''}`}
      role="tablist"
      aria-label={label}
    >
      <div ref={innerRef} className={styles.primaryTabsInner}>
        {items.map((item, idx) => (
          <PrimaryTabButton
            key={item.id}
            item={item}
            active={item.id === value}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => handleTabKeyDown(idx, e)}
            setBtnRef={(el) => {
              btnRefs.current[idx] = el
            }}
            setLabelRef={(el) => {
              labelRefs.current[idx] = el
            }}
          />
        ))}
        <span ref={indicatorRef} className={styles.primaryTabIndicator} aria-hidden="true" />
      </div>
    </div>
  )
}

function PrimaryTabButton<T extends string>({
  item,
  active,
  onClick,
  onKeyDown,
  setBtnRef,
  setLabelRef,
}: {
  item: PrimaryTabItem<T>
  active: boolean
  onClick: () => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
  setBtnRef: (el: HTMLButtonElement | null) => void
  setLabelRef: (el: HTMLSpanElement | null) => void
}) {
  return (
    <RippleButton
      ref={setBtnRef}
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={`${styles.primaryTabBtn} ${active ? styles.primaryTabBtnActive : ''}`}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      <span ref={setLabelRef} className={styles.primaryTabLabel}>
        <span>{item.label}</span>
        {item.badge !== undefined ? <span className={styles.primaryTabBadge}>{item.badge}</span> : null}
      </span>
    </RippleButton>
  )
}
