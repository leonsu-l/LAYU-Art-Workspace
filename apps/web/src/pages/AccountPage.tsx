import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/SessionContext'
import { backendRequest, backendErrorMessage } from '../services/backendClient'
import { Icon } from '../components/Icon'
import { AccountShowcase, AccountSkeleton } from '../studio/AccountView'
import { M3PrimaryTabs } from '../studio/Controls'
import { RippleButton } from '../studio/Ripple'
import styles from '../studio/Pages.module.css'

type Mode = 'login' | 'register' | 'password'
function PasswordField({ name, title, current = false }: { name: string; title: string; current?: boolean }) {
  const [visible, setVisible] = useState(false)
  const id = useId()
  return <div className={styles.filledField}><span><label htmlFor={id}>{title}</label></span><div className={styles.passwordWrap}>
    <input id={id} name={name} type={visible ? 'text' : 'password'} required autoComplete={current ? 'current-password' : 'new-password'} />
    <RippleButton type="button" aria-label={`${visible ? '隐藏' : '显示'}${title}`} aria-pressed={visible} onClick={() => setVisible(!visible)}><Icon name={visible ? 'eye-off' : 'eye'} size={16} /></RippleButton>
  </div></div>
}
function AccountCard({ mode, title, children }: { mode: Mode; title: string; children: ReactNode }) {
  return <div className={`${styles.authSplitCard} ${styles.subPanelFade}`}><AccountShowcase authMode={mode} />
    <section className={styles.authFormPane}><div className={styles.authFormHeader}><span className={styles.pageEyebrow}>{mode === 'password' ? 'SECURITY · PASSWORD' : mode === 'register' ? 'INVITE REGISTRATION' : 'SIGN IN'}</span><h2>{title}</h2></div>{children}</section></div>
}
export function LoginPage() {
  const { user, loading, authenticate, logout, refresh, error: sessionError } = useSession()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const register = mode === 'register'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (user) return <Navigate to={user.mustChangePassword ? '/password' : '/'} replace />
  function switchMode(next: 'login' | 'register') { if (!busy) { setMode(next); setError('') } }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    const data = new FormData(event.currentTarget); setError('')
    const username = String(data.get('username') ?? ''), password = String(data.get('password') ?? '')
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) { setError('用户名须为 3–64 个 ASCII 字母、数字、点、下划线或连字符。'); return }
    if (password.length < 12 || password.length > 1024) { setError('密码须为 12–1024 个字符，不会自动截断。'); return }
    setBusy(true)
    try { await authenticate(register, { username, password, ...(register ? { inviteCode: data.get('inviteCode') } : {}) }) }
    catch (e) { setError(backendErrorMessage(e)) } finally { setBusy(false) }
  }
  return <main id="main" className={styles.pageWrap}>{loading ? <AccountSkeleton authMode={mode} /> : <>
    <div className={styles.authModeBar}><M3PrimaryTabs label="账号页面" variant="scrollable" value={mode} items={[{id: 'login', label: '登录工作台'}, {id: 'register', label: '邀请码注册'}]} onChange={switchMode} /></div>
    <AccountCard key={mode} mode={mode} title={register ? '使用邀请码创建账号' : '登录账号'}>
      <form className={styles.authForm} onSubmit={(e) => void submit(e)}>
        <label className={styles.filledField}><span>用户名（3–64 位 ASCII 字母、数字、._-）</span><input name="username" required autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
        <PasswordField name="password" title="密码（12–1024 个字符）" current={!register} />
        {register && <label className={styles.filledField}><span>邀请码</span><input name="inviteCode" required autoComplete="off" /></label>}
        {(error || sessionError) && <p className={styles.cautionBanner} role="alert">{error || sessionError}</p>}
        {sessionError && <div className={styles.pageHeaderActions}><RippleButton type="button" className={styles.tonalBtn} onClick={() => void refresh()}>重新连接</RippleButton><RippleButton type="button" className={styles.tonalBtn} onClick={() => void logout().catch(() => undefined)}>重试服务端注销</RippleButton></div>}
        <div className={styles.authActions}><RippleButton className={styles.primaryBtnFull} disabled={busy}>{busy ? '正在验证…' : register ? '注册并进入工作台' : '登录工作台'}</RippleButton>
          <RippleButton type="button" className={styles.tonalBtnFull} disabled={busy} onClick={() => switchMode(register ? 'login' : 'register')}>{register ? '已有账号？返回登录' : '还没有账号？使用邀请码注册'}</RippleButton></div>
      </form>
    </AccountCard></>}</main>
}
export function PasswordPage() {
  const { user, forgetSession } = useSession()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    const form = event.currentTarget, data = new FormData(form); setError('')
    const newPassword = String(data.get('newPassword') ?? '')
    if (newPassword.length < 12 || newPassword.length > 1024) { setError('新密码须为 12–1024 个字符，不会自动截断。'); return }
    if (newPassword !== data.get('confirm')) { setError('两次新密码不一致。'); return }
    setBusy(true)
    try {
      await backendRequest('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: data.get('currentPassword'), newPassword }) })
      form.reset(); forgetSession(); await backendRequest('/auth/session'); void navigate('/login', { replace: true })
    } catch (e) { setError(backendErrorMessage(e)) } finally { setBusy(false) }
  }
  return <main id="main" className={styles.pageWrap}><AccountCard mode="password" title={user?.mustChangePassword ? '请先修改密码' : '修改密码'}>
    <p className={styles.cautionBanner}><Icon name="alert-circle" size={16} />{user?.mustChangePassword ? '当前密码需要更新才能使用工作台。' : ''}新密码须为 12–1024 个字符；更新后所有旧会话失效，请重新登录。</p>
    <form className={styles.authForm} onSubmit={(e) => void submit(e)}><PasswordField name="currentPassword" title="当前密码" current /><PasswordField name="newPassword" title="新密码" /><PasswordField name="confirm" title="确认新密码" />
      {error && <p role="alert" className={styles.cautionBanner}>{error}</p>}<RippleButton className={styles.primaryBtnFull} disabled={busy}>{busy ? '正在更新…' : '更新密码并重新登录'}</RippleButton>
    </form></AccountCard></main>
}
