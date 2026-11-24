import { Component, createRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../hooks/useSession'
import { useTheme } from '../hooks/useTheme'
import { M3PrimaryTabs, type PrimaryTabsSwipeController } from '../studio/Controls'
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

function cloneSurfaceNode(el: HTMLElement): HTMLElement {
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
  return node
}

interface Snapshot {
  node: HTMLElement
  scroll: number
  x: number
  direction: number
  durationMs?: number
  fromSwipe?: boolean
}

interface PendingSwipe extends Snapshot {
  fromPath: string
  toPath: string
}

interface PageFrameProps {
  path: string
  index: number
  scope: string
  slideClass: string
  children: ReactNode
  slideRef: React.RefObject<HTMLDivElement | null>
  surfaceRef: React.RefObject<HTMLDivElement | null>
  pendingSwipeRef: React.RefObject<PendingSwipe | null>
  onRoute: (oldPath: string, snapshot: Snapshot | null) => void
}

// This lifecycle reads the outgoing outlet before React mutates its DOM.
class PageFrame extends Component<PageFrameProps> {
  private localSurface = createRef<HTMLDivElement>()
  private getSurfaceEl() {
    return this.props.surfaceRef.current ?? this.localSurface.current
  }
  getSnapshotBeforeUpdate(prev: PageFrameProps): Snapshot | null {
    if (prev.scope !== this.props.scope || prev.path === this.props.path ||
        prev.index < 0 || this.props.index < 0 || prev.index === this.props.index) return null
    const pending = this.props.pendingSwipeRef.current
    if (pending && pending.fromPath === prev.path && pending.toPath === this.props.path) {
      return pending
    }
    const el = this.getSurfaceEl()
    if (!el) return null
    return {
      node: cloneSurfaceNode(el),
      x: 0,
      scroll: window.scrollY,
      direction: Math.sign(this.props.index - prev.index),
    }
  }
  componentDidUpdate(prev: PageFrameProps, _: unknown, snapshot: Snapshot | null) {
    if (this.props.path !== prev.path) this.props.onRoute(prev.path, snapshot)
  }
  render() {
    return <div
      key={this.props.path}
      ref={this.props.slideRef}
      className={this.props.slideClass}
    >
      <div
        ref={(el) => {
          this.localSurface.current = el
          this.props.surfaceRef.current = el
        }}
        className={styles.surface}
      >
        {this.props.children}
      </div>
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
  return <div ref={host} style={scroll ? { transform: `translate3d(0, ${-scroll}px, 0)` } : undefined} />
}

interface DragGesture {
  id: number
  startX: number
  startY: number
  anchorX: number
  width: number
  startTime: number
  lastX: number
  lastTime: number
  velocityX: number
  dx: number
  horizontal: boolean
  scrollY: number
}

export function StudioLayout() {
  const { user, logout } = useSession()
  const { mode, resolvedTheme, setMode } = useTheme()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const feedback = useSnackbar()
  const items = useMemo(() => !user || user.mustChangePassword ? [] : sections.filter((s) => s.id !== '/admin' || user.role === 'ADMIN'), [user])
  const active = items.findIndex((s) => s.id === pathname)

  const slideRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const peekRef = useRef<HTMLDivElement | null>(null)
  const gesture = useRef<DragGesture | null>(null)
  const dragRaf = useRef(0)
  const suppressClick = useRef(false)
  const pendingSwipeRef = useRef<PendingSwipe | null>(null)

  const swipeListeners = useRef(new Set<(progress: number | null, targetId?: string) => void>())
  const swipeController = useMemo<PrimaryTabsSwipeController>(() => ({
    subscribe(listener) {
      swipeListeners.current.add(listener)
      return () => { swipeListeners.current.delete(listener) }
    },
  }), [])
  function emitSwipe(progress: number | null, targetId?: string) {
    swipeListeners.current.forEach((listener) => listener(progress, targetId))
  }

  const scope = `${getSessionEpoch()}:${user?.id}:${resolvedTheme}:${items.map((s) => s.id).join(',')}`
  const [snapshotCache, setSnapshotCache] = useState(() => ({ scope, pages: new Map<string, HTMLElement>() }))
  if (snapshotCache.scope !== scope) setSnapshotCache({ scope, pages: new Map() })

  const [motion, setMotion] = useState<(Snapshot & { scope: string; path: string }) | null>(null)
  const [dragPeek, setDragPeek] = useState<{ dir: -1 | 1; scrollY: number } | null>(null)
  const dragPeekDirRef = useRef<-1 | 0 | 1>(0)

  const motionTimer = useRef(0)
  const settleTimer = useRef(0)
  const clickTimer = useRef(0)

  useEffect(() => () => {
    window.cancelAnimationFrame(dragRaf.current)
    window.clearTimeout(motionTimer.current)
    window.clearTimeout(settleTimer.current)
    window.clearTimeout(clickTimer.current)
  }, [])

  function resetSlideStyles() {
    const slideEl = slideRef.current
    if (!slideEl) return
    slideEl.style.transition = ''
    slideEl.style.transform = ''
    slideEl.style.willChange = ''
  }

  function clearMotion() {
    window.clearTimeout(motionTimer.current)
    setMotion(null)
  }

  function clearSettle() {
    window.clearTimeout(settleTimer.current)
    settleTimer.current = 0
  }

  function applyDragTransforms() {
    const g = gesture.current
    if (!g || !g.horizontal) return
    const slideEl = slideRef.current
    if (slideEl) {
      slideEl.style.transition = 'none'
      slideEl.style.willChange = 'transform'
      slideEl.style.transform = `translate3d(${g.dx}px, 0, 0)`
    }
    const peekEl = peekRef.current
    const peekDir = dragPeekDirRef.current
    if (peekEl && peekDir) {
      peekEl.style.transition = 'none'
      peekEl.style.transform = `translate3d(calc(${peekDir * 100}% + ${g.dx}px), 0, 0)`
    }
    emitSwipe(-g.dx / g.width)
  }

  useLayoutEffect(() => {
    if (!dragPeek || !peekRef.current) return
    const g = gesture.current
    const dx = g?.horizontal ? g.dx : 0
    peekRef.current.style.transition = 'none'
    peekRef.current.style.transform = `translate3d(calc(${dragPeek.dir * 100}% + ${dx}px), 0, 0)`
  }, [dragPeek])

  function onRoute(oldPath: string, snapshot: Snapshot | null) {
    window.cancelAnimationFrame(dragRaf.current)
    clearSettle()
    const reusedSwipe = Boolean(pendingSwipeRef.current && pendingSwipeRef.current.toPath === pathname)
    pendingSwipeRef.current = null
    gesture.current = null
    dragPeekDirRef.current = 0
    setDragPeek(null)
    if (snapshot) {
      setSnapshotCache((previous) => ({ scope, pages: new Map(previous.pages).set(oldPath, snapshot.node) }))
    }
    if (!reusedSwipe) {
      window.clearTimeout(motionTimer.current)
      const shouldAnimate = Boolean(snapshot && !matchMedia('(prefers-reduced-motion: reduce)').matches)
      setMotion(shouldAnimate && snapshot ? { ...snapshot, scope, path: pathname } : null)
      if (shouldAnimate) {
        motionTimer.current = window.setTimeout(() => setMotion(null), (snapshot?.durationMs ?? 320) + 100)
      }
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  const transition = motion?.scope === scope && motion.path === pathname ? motion : null

  function open(path: string) {
    if (path !== pathname) void navigate(path)
  }

  function start(e: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false
    if (active < 0 || !e.isPrimary || (e.pointerType !== 'touch' && !matchMedia('(max-width: 760px)').matches)) return
    if ((e.target as Element).closest('input,textarea,select,option,summary,[role="dialog"],[role="listbox"],[role="tablist"],[contenteditable="true"],[data-no-swipe="true"]')) return
    const now = performance.now()
    gesture.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      anchorX: e.clientX,
      width: e.currentTarget.clientWidth || 1,
      startTime: now,
      lastX: e.clientX,
      lastTime: now,
      velocityX: 0,
      dx: 0,
      horizontal: false,
      scrollY: window.scrollY,
    }
  }

  function drag(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    const rawDx = e.clientX - g.startX
    const rawDy = e.clientY - g.startY
    if (!g.horizontal) {
      if (Math.hypot(rawDx, rawDy) < 10) return
      if (Math.abs(rawDy) >= Math.abs(rawDx) * 0.92) {
        gesture.current = null
        return
      }
      g.horizontal = true
      g.anchorX = e.clientX
      g.lastX = e.clientX
      g.lastTime = performance.now()
      g.scrollY = window.scrollY
      clearMotion()
      clearSettle()
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* Pointer already ended. */ }
    }

    const now = performance.now()
    const dt = now - g.lastTime
    if (dt > 0) {
      const instV = (e.clientX - g.lastX) / dt
      g.velocityX = g.velocityX * 0.4 + instV * 0.6
      g.lastX = e.clientX
      g.lastTime = now
    }

    let moveX = e.clientX - g.anchorX
    if ((moveX > 0 && active === 0) || (moveX < 0 && active === items.length - 1)) {
      moveX *= 0.25
    }
    moveX = Math.max(-g.width, Math.min(g.width, moveX))
    g.dx = moveX

    const nextPeekDir: -1 | 0 | 1 = moveX < 0 ? 1 : moveX > 0 ? -1 : 0
    if (nextPeekDir !== 0 && nextPeekDir !== dragPeekDirRef.current) {
      const targetNeighbor = items[active + nextPeekDir]
      if (targetNeighbor) {
        dragPeekDirRef.current = nextPeekDir
        setDragPeek({ dir: nextPeekDir, scrollY: g.scrollY })
      } else if (dragPeekDirRef.current !== 0) {
        dragPeekDirRef.current = 0
        setDragPeek(null)
      }
    }

    window.cancelAnimationFrame(dragRaf.current)
    dragRaf.current = window.requestAnimationFrame(applyDragTransforms)
  }

  function finish(e: PointerEvent<HTMLDivElement>, cancelled = false) {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    gesture.current = null
    window.cancelAnimationFrame(dragRaf.current)
    if (!g.horizontal) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* Capture already released. */ }

    suppressClick.current = true
    window.clearTimeout(clickTimer.current)
    clickTimer.current = window.setTimeout(() => { suppressClick.current = false }, 80)

    const absDx = Math.abs(g.dx)
    const dir = g.dx < 0 ? 1 : -1
    const next = g.dx !== 0 ? items[active + dir] : undefined
    const avgV = absDx / Math.max(16, performance.now() - g.startTime)
    const fastV = Math.max(avgV, Math.abs(g.velocityX))
    const shouldCommit = !cancelled && Boolean(next) && (
      absDx > g.width * 0.22 || (absDx > 36 && fastV > 0.32 && Math.sign(g.velocityX || g.dx) === Math.sign(g.dx))
    )

    if (shouldCommit && next) {
      const surfaceEl = surfaceRef.current
      const remainingRatio = Math.max(0.18, Math.min(1, 1 - absDx / g.width))
      const durationMs = Math.round(150 + 160 * remainingRatio)
      const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
      if (surfaceEl) {
        const snapshot: PendingSwipe = {
          fromPath: pathname,
          toPath: next.id,
          node: cloneSurfaceNode(surfaceEl),
          x: g.dx,
          scroll: g.scrollY,
          direction: dir,
          durationMs,
          fromSwipe: true,
        }
        pendingSwipeRef.current = snapshot
        window.clearTimeout(motionTimer.current)
        if (!reducedMotion) {
          setMotion({ ...snapshot, scope, path: next.id })
          motionTimer.current = window.setTimeout(() => setMotion(null), durationMs + 100)
        } else {
          setMotion(null)
        }
      }
      emitSwipe(null, next.id)
      void navigate(next.id, { flushSync: true })
      return
    }

    // Smooth GPU spring-back with zero React re-render until animation completes
    emitSwipe(null)
    const slideEl = slideRef.current
    if (slideEl) {
      slideEl.style.transition = 'transform 240ms var(--md-sys-motion-easing-emphasized-decelerate)'
      slideEl.style.transform = 'translate3d(0, 0, 0)'
    }
    const peekEl = peekRef.current
    const peekDir = dragPeekDirRef.current
    if (peekEl && peekDir) {
      peekEl.style.transition = 'transform 240ms var(--md-sys-motion-easing-emphasized-decelerate)'
      peekEl.style.transform = `translate3d(${peekDir * 100}%, 0, 0)`
    }
    clearSettle()
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = 0
      dragPeekDirRef.current = 0
      setDragPeek(null)
      resetSlideStyles()
    }, 250)
  }

  function tabs(inHeader = false) {
    return active >= 0 && <M3PrimaryTabs
      label="主栏目导航"
      value={pathname}
      items={items}
      inHeader={inHeader}
      swipeController={swipeController}
      onChange={open}
    />
  }

  const showPeek = !transition && dragPeek
  const neighbor = showPeek ? items[active + showPeek.dir] : undefined
  const peek = neighbor && snapshotCache.pages.get(neighbor.id)
  const stageStyle = transition
    ? ({
        '--slide-dir': transition.direction,
        '--start-x': `${transition.x}px`,
        '--slide-duration': `${transition.durationMs ?? 320}ms`,
        '--slide-enter-opacity': transition.fromSwipe ? 1 : 0.78,
        '--slide-exit-opacity': transition.fromSwipe ? 1 : 0.72,
      } as CSSProperties)
    : undefined

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
      <div className={bar.pagerStage} style={stageStyle}>
        {transition && <div key={pathname} inert aria-hidden="true" className={bar.pagerExitSlide} onAnimationEnd={(e) => { if (e.target === e.currentTarget) clearMotion() }}>
          <SnapshotView node={transition.node} scroll={transition.scroll} />
        </div>}
        {showPeek && neighbor && <div ref={peekRef} inert aria-hidden="true" className={bar.pagerPeekDragging}
          style={{ paddingTop: showPeek.scrollY }}>
          {peek ? <SnapshotView node={peek} /> : <PagePreview path={neighbor.id} />}
        </div>}
        <PageFrame
          path={pathname}
          scope={scope}
          index={active}
          slideRef={slideRef}
          surfaceRef={surfaceRef}
          pendingSwipeRef={pendingSwipeRef}
          onRoute={onRoute}
          slideClass={transition ? bar.pagerEnterSlide : bar.pagerIdleSlide}
        >
          <Outlet />
        </PageFrame>
      </div>
    </div>
    <div id="studio-overlay-root" />
    <SnackbarHost snackbar={feedback.snackbar} onDismiss={feedback.dismissSnackbar} onPause={feedback.pauseSnackbar} onResume={feedback.resumeSnackbar} />
  </NotificationContext.Provider>
}
