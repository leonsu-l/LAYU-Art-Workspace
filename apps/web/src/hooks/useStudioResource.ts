import { useCallback, useEffect, useRef, useState } from 'react'
import { backendErrorMessage, backendRequest } from '../services/backendClient'

/** Keep the last successful snapshot on refresh; ignore superseded or unmounted reads. */
export function useStudioResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const request = useRef<AbortController | null>(null), mounted = useRef(false)
  const reload = useCallback(async () => {
    if (!mounted.current) return null
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setLoading(true); setError('')
    try {
      const next = await backendRequest<T>(path, { signal: controller.signal })
      if (!controller.signal.aborted) { setData(next); return next }
    } catch (e) { if (!controller.signal.aborted) setError(backendErrorMessage(e)) }
    finally { if (!controller.signal.aborted) setLoading(false) }
    return null
  }, [path])
  useEffect(() => {
    mounted.current = true; void reload()
    return () => { mounted.current = false; request.current?.abort() }
  }, [reload])
  return { data, setData, loading, error, reload }
}
