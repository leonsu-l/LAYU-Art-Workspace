import { createContext, useContext } from 'react'
import type { SnackbarPayload } from './useSnackbar'

export const NotificationContext = createContext<((message: SnackbarPayload) => void) | null>(null)

export function useNotify() {
  const notify = useContext(NotificationContext)
  if (!notify) throw new Error('NotificationContext missing')
  return notify
}
