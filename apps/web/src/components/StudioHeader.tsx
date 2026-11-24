import { Component, createRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import { useTheme } from '../hooks/useTheme'
import { M3PrimaryTabs } from '../studio/Controls'
import { useRipple } from './ui/useRipple'
import { getSessionEpoch } from '../services/sessionScope'
import { SkeletonBlock } from '../studio/Skeleton'
import { RippleButton, RippleOverlay } from '../studio/Ripple'
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

function HeaderLink({ children, className, ...props }: ComponentProps<typeof Link>) {
  const { triggerRipple, ripples, dismissRipple } = useRipple()
  return <Link {...props} className={`${className} ${styles.headerLink}`} onPointerDown={triggerRipple}>
    <RippleOverlay ripples={ripples} onDone={dismissRipple} />{children}
  </Link>
}

interface PageFrameProps {
  path: string
  index: number
  scope: string
  slideClass: string
  style?: CSSProperties
  children: ReactNode
  onRoute: (oldPath: string, snapshot: Snapshot | null) => void
}
interface Snapshot { node: HTMLElement; scroll: number; x: number; direction: number }

// This lifecycle reads the outgoing outlet before React mutates its DOM.
class PageFrame extends Component<PageFrameProps> {
  private surface = createRef<HTMLDivElement>()
  getSnapshotBeforeUpdate(prev: PageFrameProps): Snapshot | null {
    const el = this.surface.current
    if (!el || prev.scope !== this.props.scope || prev.path === this.props.path ||
        prev.index < 0 || this.props.index < 0 || prev.index === this.props.index) return null
    const node = el.cloneNode(true) as HTMLElement
    node.querySelectorAll('[id], [autofocus]').forEach((child) => {
      child.removeAttribute('id')
      child.removeAttribute('autofocus')
    })
    node.querySelectorAll('[name]').forEach((child) => child.removeAttribute('name'))
    node.querySelectorAll('[data-ripple-layer]').forEach((child) => child.remove())
    node.querySelectorAll<HTMLInputElement>('input[type=password],input[autocomplete*=password],input[type=file]').forEach((input) => {
      input.removeAttribute('value')
      input.value = ''
    })
    const slide = el.parentElement!
    const x = slide.getBoundingClientRect().left - slide.parentElement!.getBoundingClientRect().left
    return { node, x, scroll: window.scrollY, direction: Math.sign(this.props.index - prev.index) }
  }
  componentDidUpdate(prev: PageFrameProps, _: unknown, snapshot: Snapshot | null) {
    if (this.props.path !== prev.path) this.props.onRoute(prev.path, snapshot)
  }
  render() {
    return <div key={this.props.path} className={this.props.slideClass} style={this.props.style}>
      <div ref={this.surface} className={styles.surface}>{this.props.children}</div>
    </div>
  }
}

function PagePreview({ path }: { path: string }) {
  const gallery = path === '/gallery'
  return <div className={styles.peekSkeleton}>
    <SkeletonBlock variant="text" width="36%" height={24} />
    {path === '/admin' && <SkeletonBlock variant="pill" width="78%" />}
    {path === '/password' && <SkeletonBlock variant="media" icon="banana" height={96} />}
    <div className={gallery ? styles.peekGrid : styles.peekFields}>
      {(gallery ? [140, 140, 140, 140] : path === '/' ? [58, 128, 64, 44] : [64, 64, 52]).map((height, i) =>
        <SkeletonBlock key={i} variant={gallery ? 'media' : 'field'} height={height} staggerIndex={i} />)}
    </div>
  </div>
}

function SnapshotView({ node, scroll = 0 }: { node: HTMLElement; scroll?: number }) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { host.current?.replaceChildren(node) }, [node])
  return <div ref={host} style={{ transform: `translate3d(0, ${-scroll}px, 0)` }} />
}

export function StudioLayout() {
  const { user, logout } = useSession()
  const { mode, resolvedTheme, setMode } = useTheme()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const feedback = useSnackbar()
  const items = useMemo(() => !user || user.mustChangePassword ? [] : sections.filter((s) => s.id !== '/admin' || user.role === 'ADMIN'), [user])
  const active = items.findIndex((s) => s.id === pathname)
  const [offset, setOffset] = useState(0)
  const gesture = useRef<{ id: number; x: number; y: number; time: number; horizontal: boolean } | null>(null)
  const [gestureWidth, setGestureWidth] = useState(1)
  const suppressClick = useRef(false)

  const scope = `${getSessionEpoch()}:${user?.id}:${resolvedTheme}:${items.map((s) => s.id).join(',')}`
  const [snapshotCache, setSnapshotCache] = useState(() => ({ scope, pages: new Map<string, HTMLElement>() }))
  if (snapshotCache.scope !== scope) setSnapshotCache({ scope, pages: new Map() })
  const [motion, setMotion] = useState<(Snapshot & { scope: string; path: string }) | null>(null)
  const [settling, setSettling] = useState(0)
  const motionTimer = useRef(0)
  const settleTimer = useRef(0)
  const clickTimer = useRef(0)
  useEffect(() => () => {
    window.clearTimeout(motionTimer.current)
    window.clearTimeout(settleTimer.current)
    window.clearTimeout(clickTimer.current)
  }, [])
  function clearMotion() {
    window.clearTimeout(motionTimer.current)
    setMotion(null)
  }
  function onRoute(oldPath: string, snapshot: Snapshot | null) {
    window.clearTimeout(motionTimer.current)
    if (snapshot) setSnapshotCache((previous) => ({ scope, pages: new Map(previous.pages).set(oldPath, snapshot.node) }))
    const shouldAnimate = Boolean(snapshot && !matchMedia('(prefers-reduced-motion: reduce)').matches)
    setMotion(shouldAnimate && snapshot ? { ...snapshot, scope, path: pathname } : null)
    if (shouldAnimate) motionTimer.current = window.setTimeout(() => setMotion(null), 420)
    gesture.current = null
    setOffset(0)
    setSettling(0)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  const transition = motion?.scope === scope && motion.path === pathname ? motion : null
  function open(path: string) { if (path !== pathname) void navigate(path) }
  function start(e: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false
    if (active < 0 || !e.isPrimary || (e.pointerType !== 'touch' && !matchMedia('(max-width: 760px)').matches)) return
    if ((e.target as Element).closest('input,textarea,select,option,summary,[role="dialog"],[role="listbox"],[role="tablist"],[contenteditable="true"],[data-no-swipe="true"]')) return
    setGestureWidth(e.currentTarget.clientWidth || 1)
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
      clearMotion()
      setSettling(0)
      window.clearTimeout(settleTimer.current)
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* Pointer already ended. */ }
    }
    setOffset((dx > 0 && active === 0) || (dx < 0 && active === items.length - 1) ? dx / 4 : dx)
  }
  function finish(e: PointerEvent<HTMLDivElement>, cancelled = false) {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    gesture.current = null
    if (!g.horizontal) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* Capture already released. */ }
    suppressClick.current = true
    const dx = e.clientX - g.x
    window.clearTimeout(clickTimer.current)
    clickTimer.current = window.setTimeout(() => { suppressClick.current = false }, 80)
    const next = items[active + (dx < 0 ? 1 : -1)]
    if (!cancelled && next && (Math.abs(dx) > e.currentTarget.clientWidth * 0.22 || (Math.abs(dx) > 40 && Math.abs(dx) / Math.max(16, performance.now() - g.time) > 0.32))) { open(next.id); return }
    setSettling(-Math.sign(offset))
    setOffset(0)
    settleTimer.current = window.setTimeout(() => setSettling(0), 250)
  }
  function tabs(inHeader = false) {
    return active >= 0 && <M3PrimaryTabs label="主栏目导航" value={pathname} items={items} inHeader={inHeader}
      swipeProgress={offset ? -offset / gestureWidth : 0} onChange={open} />
  }
  const peekDir = offset ? -Math.sign(offset) : settling
  const neighbor = peekDir ? items[active + peekDir] : undefined
  const peek = neighbor && snapshotCache.pages.get(neighbor.id)
  return <NotificationContext.Provider value={feedback.showSnackbar}>
    <header className={styles.header}>
      <a className={styles.skip} href="#main">跳到主要内容</a>
      <div className={bar.appHeader}>
        <HeaderLink to={user?.mustChangePassword ? '/password' : user ? '/' : '/login'} className={bar.appBrand} aria-label="NanoBanana Studio 首页">
          <span className={bar.brandGlyph}><Icon name="banana" size={19} /></span>
          <span className={bar.brandWordmark}><strong>nanobanana</strong><span className={bar.brandTag}>STUDIO</span></span>
        </HeaderLink>
        <nav className={bar.desktopNavHost} aria-label="主导航">{tabs(true)}</nav>
        <div className={styles.actions}>
          {user && <><HeaderLink to="/password" className={bar.userPill} title="账号安全">{user.username}</HeaderLink>
            <RippleButton type="button" className={styles.utility} onClick={() => void logout().catch(() => undefined)}>注销</RippleButton></>}
          <div className={styles.themeSwitch} role="group" aria-label="界面主题">
            {themes.map((t) => <RippleButton type="button" key={t.id} className={styles.utility} aria-pressed={mode === t.id} aria-label={t.label} title={t.label} onClick={() => setMode(t.id)}><Icon name={t.icon} size={15} /></RippleButton>)}
          </div>
        </div>
      </div>
      {active >= 0 && <nav className={bar.mobileTabsHost} aria-label="移动端主导航">{tabs()}</nav>}
    </header>
    <div className={`${styles.viewport} ${bar.pagerViewport}`} onPointerDown={start} onPointerMove={drag} onPointerUp={finish} onPointerCancel={(e) => finish(e, true)}
      onClickCapture={(e) => { if (suppressClick.current) { suppressClick.current = false; e.preventDefault(); e.stopPropagation() } }}>
      <div className={bar.pagerStage} style={transition ? { '--slide-dir': transition.direction, '--start-x': `${transition.x}px` } as CSSProperties : undefined}>
        {transition && <div key={pathname} inert aria-hidden="true" className={bar.pagerExitSlide} onAnimationEnd={(e) => { if (e.target === e.currentTarget) clearMotion() }}>
          <SnapshotView node={transition.node} scroll={transition.scroll} />
        </div>}
        {neighbor && <div inert aria-hidden="true" className={offset ? bar.pagerPeekDragging : bar.pagerPeekSettling}
          style={{ transform: `translate3d(calc(${peekDir * 100}% + ${offset}px), 0, 0)`, paddingTop: window.scrollY }}>
          {peek ? <SnapshotView node={peek} /> : <PagePreview path={neighbor.id} />}
        </div>}
        <PageFrame path={pathname} scope={scope} index={active} onRoute={onRoute}
          slideClass={transition ? bar.pagerEnterSlide : offset ? bar.pagerDraggingSlide : bar.pagerIdleSlide}
          style={offset ? { transform: `translate3d(${offset}px, 0, 0)` } : undefined}><Outlet /></PageFrame>
      </div>
    </div>
    <div id="studio-overlay-root" />
    <SnackbarHost snackbar={feedback.snackbar} onDismiss={feedback.dismissSnackbar} onPause={feedback.pauseSnackbar} onResume={feedback.resumeSnackbar} />
  </NotificationContext.Provider>
}
