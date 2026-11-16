import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/SessionContext'
import { backendRequest, backendErrorMessage } from '../services/backendClient'
import { StudioHeader } from '../components/StudioHeader'
import styles from './AccountPage.module.css'
export function LoginPage() {
  const { user, loading, authenticate, logout, error: sessionError } = useSession()
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (loading) return <p role="status">正在连接…</p>
  if (user) return <Navigate to={user.mustChangePassword ? '/password' : '/'} replace />
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError('')
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(String(data.get('username') ?? ''))) { setError('用户名须为 3–64 个 ASCII 字母、数字、点、下划线或连字符。'); return }
    const password = String(data.get('password') ?? '')
    if (password.length < 12 || password.length > 1024) { setError('密码须为 12–1024 个字符，不会自动截断。'); return }
    setBusy(true)
    try { await authenticate(register, { username: data.get('username'), password: data.get('password'), ...(register ? { inviteCode: data.get('inviteCode') } : {}) }) }
    catch (e) { setError(backendErrorMessage(e)) } finally { setBusy(false) }
  }
  return <><StudioHeader /><main id="main" className={styles.page}><section className={styles.card}><h1>{register ? '创建账号' : '登录工作台'}</h1><p>用户名：3–64 个 ASCII 字母、数字、点、下划线或连字符。密码：12–1024 个字符。</p><form className={styles.form} onSubmit={(e) => void submit(e)}>
    <label className={styles.field}>用户名<input className={styles.input} name="username" required autoComplete="username" /></label>
    <label className={styles.field}>密码<input className={styles.input} name="password" type="password" required autoComplete={register ? 'new-password' : 'current-password'} /></label>
    {register && <label className={styles.field}>邀请码<input className={styles.input} name="inviteCode" required autoComplete="off" /></label>}
    {(error || sessionError) && <p role="alert">{error || sessionError}</p>}
    {sessionError && <button type="button" onClick={() => void logout().catch(() => undefined)}>重试服务端注销</button>}
    <div className={styles.actions}><button disabled={busy}>{busy ? '正在处理…' : register ? '注册并登录' : '登录'}</button><button type="button" disabled={busy} onClick={() => { setRegister(!register); setError('') }}>{register ? '已有账号，去登录' : '使用邀请码注册'}</button></div>
  </form></section></main></>
}
export function PasswordPage() {
  const { user, forgetSession } = useSession(); const navigate = useNavigate()
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setError('')
    const newPassword = String(data.get('newPassword') ?? '')
    if (newPassword.length < 12 || newPassword.length > 1024) { setError('新密码须为 12–1024 个字符，不会自动截断。'); setBusy(false); return }
    if (data.get('newPassword') !== data.get('confirm')) { setError('两次新密码不一致。'); setBusy(false); return }
    try { await backendRequest('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') }) }); form.reset(); forgetSession(); await backendRequest('/auth/session'); navigate('/login', { replace: true }) }
    catch (e) { setError(backendErrorMessage(e)) } finally { setBusy(false) }
  }
  return <><StudioHeader /><main id="main" className={styles.page}><section className={styles.card}><h1>{user?.mustChangePassword ? '请先修改密码' : '修改密码'}</h1><p>新密码须为 12–1024 个字符。改密后所有旧会话失效，请重新登录。</p><form className={styles.form} onSubmit={(e) => void submit(e)}>
    <label className={styles.field}>当前密码<input className={styles.input} type="password" name="currentPassword" autoComplete="current-password" required /></label>
    <label className={styles.field}>新密码<input className={styles.input} type="password" name="newPassword" autoComplete="new-password" required /></label>
    <label className={styles.field}>确认新密码<input className={styles.input} type="password" name="confirm" autoComplete="new-password" required /></label>
    {error && <p role="alert">{error}</p>}<button disabled={busy}>{busy ? '正在更新…' : '更新密码并重新登录'}</button>
  </form></section></main></>
}
