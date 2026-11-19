import { Icon } from '../../components/Icon'
import type { SnackbarItem } from './useSnackbar'
import styles from './LabSnackbar.module.css'

export function LabSnackbarHost({
  snackbar,
  onDismiss,
  onPause,
  onResume,
}: {
  snackbar: SnackbarItem | null
  onDismiss: () => void
  onPause: () => void
  onResume: () => void
}) {
  if (!snackbar) return null

  const isWarning = snackbar.tone === 'warning'
  const iconName = isWarning ? 'alert-circle' : snackbar.tone === 'success' ? 'check' : 'sparkles'

  return (
    <div className={styles.viewportHost} aria-live={isWarning ? 'assertive' : 'polite'}>
      <div
        key={snackbar.id}
        role={isWarning ? 'alert' : 'status'}
        className={`${styles.snackbar} ${snackbar.closing ? styles.snackbarClosing : ''}`}
        data-tone={snackbar.tone}
        onMouseEnter={onPause}
        onMouseLeave={onResume}
        onFocus={onPause}
        onBlur={onResume}
      >
        <span className={styles.iconSlot} aria-hidden="true">
          <Icon name={iconName} size={16} />
        </span>

        <span className={styles.message}>{snackbar.message}</span>

        <div className={styles.actions}>
          {snackbar.actionLabel && snackbar.onAction ? (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => {
                snackbar.onAction?.()
                onDismiss()
              }}
            >
              {snackbar.actionLabel}
            </button>
          ) : null}

          <button
            type="button"
            className={styles.closeBtn}
            onClick={onDismiss}
            aria-label="关闭通知"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}
