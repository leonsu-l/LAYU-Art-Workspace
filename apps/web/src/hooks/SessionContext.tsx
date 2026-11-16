import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { User } from '@nanobanana/shared/types/studio'
import { backendRequest, backendErrorMessage } from '../services/backendClient'
import { changeSessionScope } from '../services/sessionScope'
import { clearSubmissionMemory } from '../services/imageGenerationService'
interface Session { user: User | null; loading: boolean; error: string | null; refresh: () => Promise<void>; authenticate: (register: boolean, body: object) => Promise<void>; logout: () => Promise<void>; forgetSession: () => void }
const Context = createContext<Session | null>(null)
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refreshSequence = useRef(0)
  function apply(next: User | null) { changeSessionScope(next?.id ?? ''); clearSubmissionMemory(); setUser(next) }
  async function refresh() {
    const sequence = ++refreshSequence.current
    setLoading(true); setError(null)
    try { const response = await backendRequest<{ user: User | null }>('/auth/session'); if (sequence === refreshSequence.current) apply(response.user) }
    catch (e) { if (sequence === refreshSequence.current) setError(backendErrorMessage(e)) }
    finally { if (sequence === refreshSequence.current) setLoading(false) }
  }
  useEffect(() => {
    // Remove only the application's unscoped legacy credentials and prompt. Never claim old gallery ownership.
    try {
      for (const key of ['nanobanana.provider-config', 'nanobanana.provider-config.v1', 'nanobanana.provider-config.draft.v2', 'nanobanana.prompt.last']) localStorage.removeItem(key)
      sessionStorage.removeItem('nanobanana.provider-config.draft.v2')
    } catch { /* Storage restrictions must not prevent session discovery. */ }
    void refresh()
    const invalid = () => apply(null)
    const otherTab = (event: StorageEvent) => { if (event.key === 'nanobanana.session-changed') { apply(null); void refresh() } }
    window.addEventListener('studio:unauthorized', invalid)
    window.addEventListener('storage', otherTab)
    return () => { window.removeEventListener('studio:unauthorized', invalid); window.removeEventListener('storage', otherTab) }
  }, [])
  async function authenticate(register: boolean, body: object) {
    const sequence = ++refreshSequence.current
    await backendRequest<{ user: User }>(register ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(body) })
    // Authentication rotates the CSRF cookie; request a fresh token before enabling business mutations.
    const confirmed = await backendRequest<{ user: User | null }>('/auth/session')
    if (sequence !== refreshSequence.current) throw new Error('登录期间会话已改变，请重新确认当前登录状态。')
    apply(confirmed.user)
    if (!confirmed.user) throw new Error('登录会话未生效或已失效，请重新登录。')
    setError(null)
    try { localStorage.setItem('nanobanana.session-changed', crypto.randomUUID()) } catch { /* Optional cross-tab notification. */ }
  }
  async function logout() {
    refreshSequence.current += 1; setLoading(true)
    apply(null)
    try {
      await backendRequest('/auth/logout', { method: 'POST' }); setError(null)
      try { localStorage.setItem('nanobanana.session-changed', crypto.randomUUID()) } catch { /* Optional cross-tab notification. */ }
    }
    catch (e) { setError(`本地状态已清除，但服务端注销未确认：${backendErrorMessage(e)}。请重试注销。`); throw e }
    finally { await backendRequest('/auth/session').catch(() => undefined); setLoading(false) }
  }
  function forgetSession() {
    refreshSequence.current += 1; setError(null); apply(null)
    try { localStorage.setItem('nanobanana.session-changed', crypto.randomUUID()) } catch { /* Optional cross-tab notification. */ }
  }
  return <Context.Provider value={{ user, loading, error, refresh, authenticate, logout, forgetSession }}><div key={user?.id ?? 'anonymous'}>{children}</div></Context.Provider>
}
export function useSession(): Session { const context = useContext(Context); if (!context) throw new Error('SessionProvider missing'); return context }
export function SessionGate({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, loading, error, refresh } = useSession()
  const location = useLocation()
  if (loading) return <p role="status">正在验证登录状态…</p>
  if (error && !user) return <main><p role="alert">{error}</p><button onClick={() => void refresh()}>重新连接</button><button onClick={() => void backendRequest('/auth/logout', { method: 'POST' }).then(refresh)}>重试注销</button></main>
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword && location.pathname !== '/password') return <Navigate to="/password" replace />
  if (admin && user.role !== 'ADMIN') return <Navigate to="/" replace />
  return children
}
