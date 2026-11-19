import type { ComponentPropsWithRef } from 'react'
import { useRipple, type RippleWave } from '../../components/ui/useRipple'
import styles from './LabRipple.module.css'

export type RippleTone = 'current' | 'light'

export function RippleOverlay({
  ripples,
  onDone,
  tone = 'current',
}: {
  ripples: readonly RippleWave[]
  onDone: (id: number) => void
  tone?: RippleTone
}) {
  return (
    <span className={styles.rippleLayer} aria-hidden="true" data-ripple-layer="true">
      {ripples.map((wave) => (
        <span
          key={wave.id}
          className={`${styles.ripple} ${tone === 'light' ? styles.rippleLight : ''}`}
          style={{
            width: `${wave.size}px`,
            height: `${wave.size}px`,
            left: `${wave.left}px`,
            top: `${wave.top}px`,
          }}
          onAnimationEnd={() => onDone(wave.id)}
        />
      ))}
    </span>
  )
}

export interface RippleButtonProps extends ComponentPropsWithRef<'button'> {
  rippleDisabled?: boolean
  rippleTone?: RippleTone
}

export function RippleButton({
  className = '',
  children,
  disabled,
  rippleDisabled = false,
  rippleTone = 'current',
  onPointerDown,
  ...props
}: RippleButtonProps) {
  const { ripples, triggerRipple, dismissRipple } = useRipple(Boolean(disabled || rippleDisabled))

  return (
    <button
      {...props}
      disabled={disabled}
      className={`${styles.rippleHost} ${className}`}
      onPointerDown={(event) => {
        triggerRipple(event)
        onPointerDown?.(event)
      }}
    >
      <RippleOverlay ripples={ripples} onDone={dismissRipple} tone={rippleTone} />
      {children}
    </button>
  )
}
