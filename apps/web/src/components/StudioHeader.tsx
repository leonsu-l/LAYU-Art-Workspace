import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/SessionContext'
import { useTheme } from '../hooks/useTheme'
import { M3PrimaryTabs } from '../studio/Controls'
import { RippleButton } from '../studio/Ripple'
import { SnackbarHost } from '../studio/Snackbar'
import { NotificationContext } from '../studio/useNotify'
import { useSnackbar } from '../studio/useSnackbar'
import bar from '../studio/Workbench.module.css'
import { Icon } from './Icon'
import styles from './StudioHeader.module.css'

const sections = [
  { id: '/', label: '创作工作台' }, { id: '/gallery', label: '我的图库' },
  { id: '/channels', label: '自定义渠道' }, { id: '/password', label: '账号安全' },
  { id: '/admin', label: '站点管理' },
]
const themes = [
  { id: 'system', label: '跟随系统主题', icon: 'monitor' },
  { id: 'light', label: '切换浅色主题', icon: 'sun' },
  { id: 'dark', label: '切换深色主题', icon: 'moon' },
] as const

export function StudioLayout() {
  const { user, logout } = useSession()
  const { mode, setMode } = useTheme()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const feedback = useSnackbar()
  const items = !user || user.mustChangePassword ? [] : sections.filter((s) => s.id !== '/admin' || user.role === 'ADMIN')
  const active = items.findIndex((s) => s.id === pathname)
  const [offset, setOffset] = useState(0)
  const gesture = useRef<{ id: number; x: number; y: number; time: number; horizontal: boolean } | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [pathname])
  function open(path: string) {
    if (path === pathname) return
    const direction = items.findIndex((s) => s.id === path) < active ? -1 : 1
    document.documentElement.style.setProperty('--studio-direction', String(direction))
    void navigate(path, { viewTransition: !matchMedia('(prefers-reduced-motion: reduce)').matches })
  }
  function start(e: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false
    if (active < 0 || !e.isPrimary || e.pointerType === 'mouse' || !matchMedia('(max-width: 760px)').matches) return
    if ((e.target as Element).closest('input,textarea,select,button,a,summary,dialog,[role="dialog"],[role="listbox"],[role="tablist"],[contenteditable],[data-no-swipe]')) return
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now(), horizontal: false }
  }
  function drag(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    const dx = e.clientX - g.x, dy = e.clientY - g.y
    if (!g.horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return
      if (Math.abs(dy) >= Math.abs(dx) * 0.92) { gesture.current = null; return }
      g.horizontal = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    setOffset((dx > 0 && active === 0) || (dx < 0 && active === items.length - 1) ? dx / 4 : dx)
  }
  function finish(e: PointerEvent<HTMLDivElement>, cancelled = false) {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    gesture.current = null
    setOffset(0)
    if (cancelled || !g.horizontal) return
    suppressClick.current = true
    const dx = e.clientX - g.x
    const next = items[active + (dx < 0 ? 1 : -1)]
    if (next && (Math.abs(dx) > e.currentTarget.clientWidth * 0.22 || (Math.abs(dx) > 40 && Math.abs(dx) / Math.max(16, performance.now() - g.time) > 0.32))) open(next.id)
  }
  function tabs(inHeader = false) {
    return active >= 0 && <M3PrimaryTabs label="主栏目导航" value={pathname} items={items} inHeader={inHeader}
      swipeProgress={offset ? -offset / (surface.current?.clientWidth || 1) : 0} onChange={open} />
  }
  return <NotificationContext.Provider value={feedback.showSnackbar}>
    <header className={styles.header}>
      <a className={styles.skip} href="#main">跳到主要内容</a>
      <div className={bar.appHeader}>
        <Link to={user?.mustChangePassword ? '/password' : user ? '/' : '/login'} className={bar.appBrand} aria-label="NanoBanana Studio 首页">
          <span className={bar.brandGlyph}><Icon name="banana" size={19} /></span>
          <span className={bar.brandWordmark}><strong>nanobanana</strong><span className={bar.brandTag}>STUDIO</span></span>
        </Link>
        <nav className={bar.desktopNavHost} aria-label="主导航">{tabs(true)}</nav>
        <div className={styles.actions}>
          {user && <><Link to="/password" className={bar.userPill} title="账号安全">{user.username}</Link>
            <RippleButton type="button" className={styles.utility} onClick={() => void logout().catch(() => undefined)}>注销</RippleButton></>}
          <div className={styles.themeSwitch} role="group" aria-label="界面主题">
            {themes.map((t) => <RippleButton type="button" key={t.id} className={styles.utility} aria-pressed={mode === t.id} aria-label={t.label} title={t.label} onClick={() => setMode(t.id)}><Icon name={t.icon} size={15} /></RippleButton>)}
          </div>
        </div>
      </div>
      {active >= 0 && <nav className={bar.mobileTabsHost} aria-label="移动端主导航">{tabs()}</nav>}
    </header>
    <div className={styles.viewport} onPointerDown={start} onPointerMove={drag} onPointerUp={finish} onPointerCancel={(e) => finish(e, true)}
      onClickCapture={(e) => { if (suppressClick.current) { suppressClick.current = false; e.preventDefault(); e.stopPropagation() } }}>
      <div ref={surface} className={styles.surface} style={offset ? { transform: `translateX(${offset}px)` } : undefined}><Outlet /></div>
    </div>
    <div id="studio-overlay-root" />
    <SnackbarHost snackbar={feedback.snackbar} onDismiss={feedback.dismissSnackbar} onPause={feedback.pauseSnackbar} onResume={feedback.resumeSnackbar} />
  </NotificationContext.Provider>
}
