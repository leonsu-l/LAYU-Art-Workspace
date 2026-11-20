import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../components/Icon'
import { formatBytes } from '../utils/galleryDb'
import { LabIcon } from './LabIcon'
import { RippleButton } from './Ripple'
import { ShimmerImage, SkeletonBlock, SkeletonTextStack } from './Skeleton'
import { buildContainerMorphKeyframes, isRectMostlyInViewport, measureContainImageRect, type RectLike } from './lightboxTransition'
import styles from './Pages.module.css'

const retentionToneClass = {
  permanent: styles.retentionChipPermanent,
  timed: styles.retentionChipTimed,
  urgent: styles.retentionChipUrgent,
}

interface Artwork {
  key: string; url: string; prompt: string; model: string; createdAt: string; bytes: number
  dimensions?: string; groupCount?: number
}
function groupLabel(item: Artwork) {
  return item.groupCount === undefined ? '按任务整组保存' : item.groupCount > 1 ? `同组 ${item.groupCount} 张` : '单图作品'
}

function cancelAnimations(list: Animation[]) {
  for (const anim of list) {
    try {
      anim.cancel()
    } catch {
      // Ignore canceled or already released animations
    }
  }
}

export function GalleryView<T extends Artwork>({
  items, selectedKeys, onSelection, onGoWorkbench, onRefresh, onDownload, onDeleteOne, onDeleteSelected,
  isRefreshing, showListSkeleton, showMediaSkeleton = false, deleting = false, error, overlayId,
  retention, notice, onBeforePreview,
}: {
  items: T[]; selectedKeys: string[]; onSelection: (keys: string[]) => void
  onGoWorkbench: () => void; onRefresh: () => void; onDownload: (item: T) => void
  onDeleteOne: (item: T) => void; onDeleteSelected: (items: T[]) => void
  isRefreshing: boolean; showListSkeleton: boolean; showMediaSkeleton?: boolean; deleting?: boolean
  error?: string | null; overlayId: string
  retention?: {
    policyLabel: string
    describe: (item: T) => { tone: 'permanent' | 'timed' | 'urgent'; shortLabel: string; detailLabel: string }
  }
  notice?: ReactNode
  onBeforePreview?: (item: T) => boolean
}) {
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const previewIndex = items.findIndex((i) => i.key === previewKey)
  const previewItem = items[previewIndex]
  const [openSeq, setOpenSeq] = useState(0)
  const [isClosing, setIsClosing] = useState(false)
  const [hudVisible, setHudVisible] = useState(true)
  const [promptExpanded, setPromptExpanded] = useState(false)

  const thumbRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const topHudRef = useRef<HTMLDivElement | null>(null)
  const bottomHudRef = useRef<HTMLDivElement | null>(null)

  const launchOriginRef = useRef<{ key: string; rect: RectLike } | null>(null)
  const lastLaunchSeqRef = useRef(0)
  const lastPreviewKeyRef = useRef<string | null>(null)
  const stepDirectionRef = useRef<-1 | 1>(1)
  const isClosingRef = useRef(false)
  const closeSessionRef = useRef(0)
  const openAnimsRef = useRef<Animation[]>([])
  const openHudAnimsRef = useRef<Animation[]>([])
  const stepAnimsRef = useRef<Animation[]>([])
  const closeAnimsRef = useRef<Animation[]>([])
  const closeTimerRef = useRef<number | null>(null)

  const selectedSet = new Set(selectedKeys)
  const allSelected = items.length > 0 && items.every((item) => selectedSet.has(item.key))

  const finalizeClose = useCallback((sessionId?: number) => {
    if (sessionId !== undefined && sessionId !== closeSessionRef.current) return
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    // Leave active close animations filling (`fill: 'forwards'` / `'both'`) until
    // React unmounts the portal, avoiding a 1-frame fullscreen snap-back flash.
    openAnimsRef.current = []
    openHudAnimsRef.current = []
    stepAnimsRef.current = []
    isClosingRef.current = false
    setIsClosing(false)
    setPreviewKey(null)
  }, [])

  function openPreview(item: T) {
    if (onBeforePreview?.(item) === false) return
    closeSessionRef.current += 1
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    const thumbEl = thumbRefs.current[item.key]
    launchOriginRef.current = thumbEl
      ? { key: item.key, rect: thumbEl.getBoundingClientRect() }
      : null
    isClosingRef.current = false
    setIsClosing(false)
    setHudVisible(true)
    setPromptExpanded(false)
    setOpenSeq((seq) => seq + 1)
    setPreviewKey(item.key)
  }

  const closePreview = useCallback(() => {
    if (!previewItem || isClosingRef.current) return

    const sessionId = ++closeSessionRef.current

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const backdropEl = backdropRef.current
    const surfaceEl = surfaceRef.current
    const imgEl = imgRef.current

    if (
      reducedMotion ||
      !backdropEl ||
      !surfaceEl ||
      !imgEl ||
      typeof surfaceEl.animate !== 'function'
    ) {
      finalizeClose(sessionId)
      return
    }

    isClosingRef.current = true
    setIsClosing(true)

    // Hide floating HUD overlays immediately from their current visual opacity
    const topHudOpacity = topHudRef.current
      ? Number(window.getComputedStyle(topHudRef.current).opacity)
      : 1
    const bottomHudOpacity = bottomHudRef.current
      ? Number(window.getComputedStyle(bottomHudRef.current).opacity)
      : 1
    cancelAnimations(openHudAnimsRef.current)
    cancelAnimations(stepAnimsRef.current)
    openHudAnimsRef.current = []
    stepAnimsRef.current = []
    const hudCloseAnims: Animation[] = []
    if (topHudRef.current) {
      hudCloseAnims.push(
        topHudRef.current.animate(
          [
            { opacity: Number.isFinite(topHudOpacity) ? topHudOpacity : 1, transform: 'translate3d(0, 0, 0)' },
            { opacity: 0, transform: 'translate3d(0, -6px, 0)' },
          ],
          { duration: 85, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
        ),
      )
    }
    if (bottomHudRef.current) {
      hudCloseAnims.push(
        bottomHudRef.current.animate(
          [
            { opacity: Number.isFinite(bottomHudOpacity) ? bottomHudOpacity : 1, transform: 'translate3d(-50%, 0, 0)' },
            { opacity: 0, transform: 'translate3d(-50%, 8px, 0)' },
          ],
          { duration: 85, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
        ),
      )
    }

    // Reversing in-flight launch seamlessly if interrupted mid-open on the same item
    const [surfaceOpenAnim, imgOpenAnim, scrimOpenAnim] = openAnimsRef.current
    if (
      surfaceOpenAnim?.playState === 'running' &&
      previewItem.key === launchOriginRef.current?.key
    ) {
      for (const anim of [surfaceOpenAnim, imgOpenAnim, scrimOpenAnim]) {
        if (!anim) continue
        anim.effect?.updateTiming({ fill: 'both' })
        anim.reverse()
      }
      closeAnimsRef.current = [
        surfaceOpenAnim,
        ...(imgOpenAnim ? [imgOpenAnim] : []),
        ...(scrimOpenAnim ? [scrimOpenAnim] : []),
        ...hudCloseAnims,
      ]
      const reverseMs = Number(surfaceOpenAnim.currentTime ?? 180)
      closeTimerRef.current = window.setTimeout(
        () => finalizeClose(sessionId),
        Math.max(120, reverseMs + 70),
      )
      surfaceOpenAnim.finished.then(
        () => finalizeClose(sessionId),
        () => {},
      )
      return
    }

    cancelAnimations(openAnimsRef.current)
    openAnimsRef.current = []

    const destThumbEl = thumbRefs.current[previewItem.key]
    let destRect: RectLike | null = destThumbEl ? destThumbEl.getBoundingClientRect() : null
    if (destThumbEl && destRect && !isRectMostlyInViewport(destRect)) {
      destThumbEl.scrollIntoView({ block: 'center', behavior: 'instant' })
      destRect = destThumbEl.getBoundingClientRect()
    }

    const surfaceRect = surfaceEl.getBoundingClientRect()
    const imgRect = measureContainImageRect(surfaceRect, imgEl, previewItem.dimensions ?? '')

    if (destRect && destRect.width > 0 && isRectMostlyInViewport(destRect)) {
      const closeKeyframes = buildContainerMorphKeyframes(destRect, surfaceRect, imgRect, 'close', 14)
      surfaceEl.style.transformOrigin = '0 0'
      const surfaceCloseAnim = surfaceEl.animate(closeKeyframes, {
        duration: 260,
        easing: 'linear',
        fill: 'forwards',
      })
      const imgCloseAnim = imgEl.animate(
        [
          { borderRadius: '16px' },
          { borderRadius: '0px', offset: 0.7 },
          { borderRadius: '0px' },
        ],
        {
          duration: 260,
          easing: 'cubic-bezier(0.24, 0.08, 0.18, 1)',
          fill: 'forwards',
        },
      )
      const backdropCloseAnim = backdropEl.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 220,
        delay: 20,
        easing: 'cubic-bezier(0.32, 0, 0.2, 1)',
        fill: 'forwards',
      })
      closeAnimsRef.current = [surfaceCloseAnim, imgCloseAnim, backdropCloseAnim, ...hudCloseAnims]
      closeTimerRef.current = window.setTimeout(() => finalizeClose(sessionId), 360)
      surfaceCloseAnim.finished.then(
        () => finalizeClose(sessionId),
        () => {},
      )
    } else {
      surfaceEl.style.transformOrigin = ''
      const surfaceCloseAnim = surfaceEl.animate(
        [
          { transform: 'scale(1)', opacity: 1 },
          { transform: 'scale(0.9)', opacity: 0 },
        ],
        { duration: 170, easing: 'cubic-bezier(0.3, 0, 1, 1)', fill: 'forwards' },
      )
      const backdropCloseAnim = backdropEl.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 170,
        easing: 'ease-out',
        fill: 'forwards',
      })
      closeAnimsRef.current = [surfaceCloseAnim, backdropCloseAnim, ...hudCloseAnims]
      closeTimerRef.current = window.setTimeout(() => finalizeClose(sessionId), 240)
      surfaceCloseAnim.finished.then(
        () => finalizeClose(sessionId),
        () => {},
      )
    }
  }, [finalizeClose, previewItem])

  const stepPreview = useCallback(
    (delta: -1 | 1) => {
      if (previewIndex < 0 || isClosingRef.current) return
      const next = items[(previewIndex + delta + items.length) % items.length]
      if (onBeforePreview?.(next) === false) {
        finalizeClose()
        return
      }
      stepDirectionRef.current = delta
      setPromptExpanded(false)
      setPreviewKey(next.key)
    },
    [items, previewIndex, onBeforePreview, finalizeClose],
  )

  useLayoutEffect(() => {
    if (!previewItem) {
      cancelAnimations(openAnimsRef.current)
      cancelAnimations(openHudAnimsRef.current)
      cancelAnimations(stepAnimsRef.current)
      cancelAnimations(closeAnimsRef.current)
      openAnimsRef.current = []
      openHudAnimsRef.current = []
      stepAnimsRef.current = []
      closeAnimsRef.current = []
      lastPreviewKeyRef.current = null
      return
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      lastLaunchSeqRef.current = openSeq
      lastPreviewKeyRef.current = previewItem.key
      return
    }

    const backdropEl = backdropRef.current
    const surfaceEl = surfaceRef.current
    const imgEl = imgRef.current
    if (!backdropEl || !surfaceEl || !imgEl || typeof surfaceEl.animate !== 'function') return

    const isFreshLaunch = openSeq !== lastLaunchSeqRef.current
    if (!isFreshLaunch) {
      if (lastPreviewKeyRef.current !== previewItem.key) {
        lastPreviewKeyRef.current = previewItem.key
        cancelAnimations(openAnimsRef.current)
        cancelAnimations(stepAnimsRef.current)
        openAnimsRef.current = []
        surfaceEl.style.transformOrigin = ''
        const dir = stepDirectionRef.current
        if (typeof imgEl.animate === 'function') {
          const stepAnim = imgEl.animate(
            [
              { opacity: 0.65, transform: `translate3d(${dir * 22}px, 0, 0) scale(0.985)` },
              { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
            ],
            { duration: 150, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'none' },
          )
          stepAnimsRef.current = [stepAnim]
        }
      }
      return
    }

    lastLaunchSeqRef.current = openSeq
    lastPreviewKeyRef.current = previewItem.key

    // Interrupt any in-flight close or launch animation synchronously before measuring
    cancelAnimations(closeAnimsRef.current)
    cancelAnimations(openAnimsRef.current)
    cancelAnimations(openHudAnimsRef.current)
    cancelAnimations(stepAnimsRef.current)
    closeAnimsRef.current = []
    openAnimsRef.current = []
    openHudAnimsRef.current = []
    stepAnimsRef.current = []

    const origin = launchOriginRef.current?.rect ?? null
    const surfaceRect = surfaceEl.getBoundingClientRect()
    const imgRect = measureContainImageRect(surfaceRect, imgEl, previewItem.dimensions ?? '')

    if (origin && origin.width > 0 && isRectMostlyInViewport(origin)) {
      const openKeyframes = buildContainerMorphKeyframes(origin, surfaceRect, imgRect, 'open', 14)
      surfaceEl.style.transformOrigin = '0 0'

      const surfaceAnim = surfaceEl.animate(openKeyframes, {
        duration: 340,
        easing: 'linear',
        fill: 'none',
      })

      const imgAnim = imgEl.animate(
        [
          { borderRadius: '0px' },
          { borderRadius: '0px', offset: 0.25 },
          { borderRadius: '16px' },
        ],
        {
          duration: 340,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'none',
        },
      )

      const backdropAnim = backdropEl.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 210,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        fill: 'none',
      })

      openAnimsRef.current = [surfaceAnim, imgAnim, backdropAnim]

      const hudAnims: Animation[] = []
      if (topHudRef.current) {
        hudAnims.push(
          topHudRef.current.animate(
            [
              { opacity: 0, transform: 'translate3d(0, -10px, 0)' },
              { opacity: 1, transform: 'translate3d(0, 0, 0)' },
            ],
            {
              duration: 180,
              delay: 90,
              easing: 'cubic-bezier(0.2, 0, 0, 1)',
              fill: 'backwards',
            },
          ),
        )
      }
      if (bottomHudRef.current) {
        hudAnims.push(
          bottomHudRef.current.animate(
            [
              { opacity: 0, transform: 'translate3d(-50%, 12px, 0)' },
              { opacity: 1, transform: 'translate3d(-50%, 0, 0)' },
            ],
            {
              duration: 180,
              delay: 110,
              easing: 'cubic-bezier(0.2, 0, 0, 1)',
              fill: 'backwards',
            },
          ),
        )
      }
      openHudAnimsRef.current = hudAnims
    } else {
      surfaceEl.style.transformOrigin = ''
      const surfaceAnim = surfaceEl.animate(
        [
          { transform: 'scale(0.92)', opacity: 0 },
          { transform: 'scale(1)', opacity: 1 },
        ],
        { duration: 210, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'none' },
      )
      const backdropAnim = backdropEl.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 190,
        easing: 'ease-out',
        fill: 'none',
      })
      openAnimsRef.current = [surfaceAnim, backdropAnim]
    }
  }, [openSeq, previewItem])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
      cancelAnimations(openAnimsRef.current)
      cancelAnimations(openHudAnimsRef.current)
      cancelAnimations(stepAnimsRef.current)
      cancelAnimations(closeAnimsRef.current)
    }
  }, [])

  useEffect(() => {
    if (!previewItem) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const controls = Array.from(surfaceRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []).filter((el) => !el.closest('[inert]'))
        const edge = event.shiftKey ? controls[0] : controls.at(-1)
        if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus() }
      } else if (event.key === 'Escape') {
        closePreview()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepPreview(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        stepPreview(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePreview, previewItem, stepPreview])

  const isPreviewOpen = Boolean(previewItem)
  useLayoutEffect(() => {
    if (!isPreviewOpen) return
    const overlay = document.getElementById(overlayId)
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const siblings = Array.from(overlay?.parentElement?.children ?? []).filter((el): el is HTMLElement =>
      el instanceof HTMLElement && el !== overlay && !el.inert && !el.hasAttribute('data-studio-notice'))
    siblings.forEach((el) => { el.inert = true })
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const close = overlay?.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')
    close?.focus({ preventScroll: true })
    return () => {
      siblings.forEach((el) => { el.inert = false })
      document.body.style.overflow = overflow
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [isPreviewOpen, overlayId])

  return (
    <div className={styles.pageWrap}>
      <header className={styles.pageHeader}>
        <div className={styles.pageTitleGroup}>
          <span className={styles.pageEyebrow}>STUDIO GALLERY</span>
          <h1 className={styles.pageTitle}>我的图库</h1>
          <p className={styles.pageSub}>按最新生成倒序排列 · 点击卡片预览原图、提示词与任务分组</p>
        </div>

        <div className={styles.pageHeaderActions}>
          {retention && (showListSkeleton ? <SkeletonBlock variant="pill" width={148} height={30} /> : (
            <span className={styles.policyPill}>
              <LabIcon name="clock" size={14} />
              <span>新图{retention.policyLabel}</span>
            </span>
          ))}
          {showListSkeleton ? (
            <SkeletonBlock variant="pill" width={132} height={30} staggerIndex={retention ? 1 : 0} />
          ) : (
            <span className={styles.summaryPill}>已存 {items.length} 张 · {formatBytes(items.reduce((sum, i) => sum + i.bytes, 0))}</span>
          )}
          <RippleButton
            type="button"
            className={styles.tonalBtn}
            disabled={isRefreshing || deleting}
            onClick={onRefresh}
          >
            <Icon name="loader" size={14} />
            <span>{isRefreshing ? '正在刷新…' : '刷新图库'}</span>
          </RippleButton>
          <RippleButton type="button" className={styles.primaryBtn} onClick={onGoWorkbench}>
            <Icon name="plus" size={15} />
            <span>创建新作品</span>
          </RippleButton>
        </div>
      </header>

      {error && <p className={styles.cautionBanner} role="alert">{error}</p>}
      {notice}
      <div className={styles.toolbarCard}>
        {showListSkeleton ? (
          <>
            <div className={styles.toolbarLeft}>
              <SkeletonBlock variant="text" width={retention ? 168 : 116} height={13} />
            </div>
            <div className={styles.toolbarRight}>
              <SkeletonBlock variant="rect" width={92} height={38} radius={12} />
              <SkeletonBlock variant="pill" width={76} height={28} staggerIndex={1} />
              <SkeletonBlock variant="pill" width={104} height={38} radius={19} staggerIndex={2} />
            </div>
          </>
        ) : (
          <>
            <div className={styles.toolbarLeft}>
              <span className={styles.monoMeta}>
                共 {items.length} {retention ? '张作品 · 每张按各自显示时间过期' : '张云端作品'}
              </span>
            </div>

            <div className={styles.toolbarRight}>
              <RippleButton
                type="button"
                aria-pressed={allSelected}
                className={`${styles.selectToggleBtn} ${allSelected ? styles.selectToggleActive : ''}`}
                disabled={deleting || !items.length}
                onClick={() => onSelection(allSelected ? [] : items.map((item) => item.key))}
              >
                <Icon name={allSelected ? 'check' : 'grid'} size={14} />
                <span>{allSelected ? '取消全选' : '全选当前'}</span>
              </RippleButton>

              <span className={styles.countChip}>已选 {selectedKeys.length} 张</span>

              <RippleButton
                type="button"
                className={styles.dangerTonalBtn}
                disabled={deleting || selectedKeys.length === 0}
                onClick={() => onDeleteSelected(items.filter((i) => selectedSet.has(i.key)))}
              >
                <Icon name="trash" size={14} />
                <span>删除所选</span>
              </RippleButton>
            </div>
          </>
        )}
      </div>

      {/* Contact-Sheet Grid */}
      {showListSkeleton ? (
        <div
          className={styles.galleryGrid}
          role="status"
          aria-busy="true"
          aria-label="正在加载图库作品"
        >
          {Array.from({ length: 5 }, (_, idx) => (
            <article key={idx} className={styles.galleryCard} aria-hidden="true">
              <div className={styles.galleryCardTop}>
                <SkeletonBlock variant="pill" width={22} height={12} staggerIndex={idx} />
                <SkeletonBlock
                  variant="text"
                  width="54%"
                  height={12}
                  staggerIndex={idx}
                  style={{ flex: 1 }}
                />
                <SkeletonBlock variant="rect" width={22} height={22} radius={7} staggerIndex={idx} />
              </div>

              <SkeletonBlock
                variant="media"
                aspectRatio="4 / 3"
                radius={14}
                icon="image"
                iconSize={22}
                staggerIndex={idx}
              />

              <SkeletonTextStack widths={['94%', '66%']} lineHeight={13} staggerIndex={idx} />

              <div className={styles.galleryMeta}>
                <div className={styles.galleryBadgeGroup}>
                  <SkeletonBlock variant="rect" width={retention ? 62 : 68} height={22} radius="var(--md-sys-shape-corner-small)" staggerIndex={idx} />
                  {retention && <SkeletonBlock variant="rect" width={78} height={22} radius="var(--md-sys-shape-corner-small)" staggerIndex={idx + 1} />}
                </div>
                <SkeletonBlock variant="text" width={96} height={11} staggerIndex={idx + 1} />
              </div>

              <div className={styles.galleryCardActions}>
                <SkeletonBlock
                  variant="pill"
                  height={32}
                  radius={16}
                  staggerIndex={idx}
                  style={{ flex: 1 }}
                />
                <SkeletonBlock
                  variant="pill"
                  height={32}
                  radius={16}
                  staggerIndex={idx + 1}
                  style={{ flex: 1 }}
                />
                <SkeletonBlock variant="pill" width={34} height={32} radius={16} staggerIndex={idx + 2} />
              </div>
            </article>
          ))}
        </div>
      ) : !items.length ? (
        !error && (retention ? (
          <section className={styles.galleryEmptyCard}>
            <h2>还没有作品</h2>
            <p>新生成的图片默认<strong>{retention.policyLabel}</strong>，到期后整组自动删除。</p>
            <RippleButton type="button" className={styles.primaryBtn} onClick={onGoWorkbench}>
              <Icon name="sparkles" size={15} /><span>去生成图片</span>
            </RippleButton>
          </section>
        ) : <section className={styles.detailCard}><h2>图库里还没有作品</h2><p>在工作台生成第一张图片后，会自动收录到这里。</p></section>)
      ) : (
        <div className={styles.galleryGrid}>
          {items.map((item, idx) => {
            const selected = selectedSet.has(item.key)
            const summary = retention?.describe(item)
            return (
              <article
                key={item.key}
                className={`${styles.galleryCard} ${selected ? styles.galleryCardSelected : ''}`}
              >
                <div className={styles.galleryCardTop}>
                  <span className={styles.frameCode}>{String(idx + 1).padStart(2, '0')}</span>
                  <span className={styles.modelChip}>{item.model}</span>
                  <RippleButton
                    type="button"
                    aria-pressed={selected}
                    aria-label={`选择作品 ${idx + 1}`}
                    className={`${styles.cardCheckBtn} ${selected ? styles.cardCheckBtnActive : ''}`}
                    disabled={deleting}
                    onClick={() => onSelection(selected ? selectedKeys.filter((k) => k !== item.key) : [...selectedKeys, item.key])}
                  >
                    <Icon name="check" size={14} className={styles.checkGlyph} />
                  </RippleButton>
                </div>

                <RippleButton
                  ref={(el) => {
                    thumbRefs.current[item.key] = el
                  }}
                  type="button"
                  rippleTone="light"
                  className={`${styles.galleryThumbBtn} ${previewItem?.key === item.key ? styles.galleryThumbHidden : ''}`}
                  onClick={() => openPreview(item)}
                >
                  <ShimmerImage
                    src={item.url}
                    alt={item.prompt || `作品 ${idx + 1}`}
                    aspectRatio="4 / 3"
                    radius={14}
                    forceSkeleton={showMediaSkeleton}
                    staggerIndex={idx}
                  />
                  <span className={styles.thumbOverlay}>
                    <Icon name="eye" size={15} />
                    <span>查看大图</span>
                  </span>
                </RippleButton>

                <p className={styles.galleryPrompt}>{item.prompt}</p>

                <div className={styles.galleryMeta}>
                  <div className={styles.galleryBadgeGroup}>
                    <span className={styles.sourceServer}>{groupLabel(item)}</span>
                    {summary && (
                      <span className={`${styles.retentionChip} ${retentionToneClass[summary.tone]}`} title={summary.detailLabel}>
                        <LabIcon name="clock" size={11} /><span>{summary.shortLabel}</span>
                      </span>
                    )}
                  </div>
                  <span className={styles.monoMeta}>
                    {item.dimensions ?? new Date(item.createdAt).toLocaleDateString()} · {formatBytes(item.bytes)}
                  </span>
                </div>

                <div className={styles.galleryCardActions}>
                  <RippleButton type="button" className={styles.cardGhostBtn} onClick={() => openPreview(item)}>
                    <Icon name="eye" size={14} />
                    <span>预览</span>
                  </RippleButton>
                  <RippleButton
                    type="button"
                    className={styles.cardGhostBtn}
                    onClick={() => onDownload(item)}
                  >
                    <Icon name="download" size={14} />
                    <span>下载</span>
                  </RippleButton>
                  <RippleButton
                    type="button"
                    className={styles.cardDangerBtn}
                    aria-label={`删除作品 ${idx + 1}`}
                    disabled={deleting}
                    onClick={() => onDeleteOne(item)}
                  >
                    <Icon name="trash" size={14} />
                  </RippleButton>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <footer className={styles.safetyFooter}>
        <Icon name="shield" size={15} />
        <span>
          {retention ? '删除或到期时，同一任务的全部图片会一起删除，不退回已用额度。'
            : '作品与任务历史双向同步：删除任一作品将连带删除所属任务及同组全部图片，此操作无法撤销。'}
        </span>
      </footer>

      {previewItem && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={`${styles.lightboxScrim} ${isClosing ? styles.lightboxClosing : ''}`}
              role="dialog"
              aria-modal="true"
              aria-label="作品大图预览"
            >
              <div ref={backdropRef} className={styles.lightboxBackdrop} aria-hidden="true" />
              <div
                ref={surfaceRef}
                className={styles.lightboxSurface}
                onClick={(e) => {
                  if (e.target === e.currentTarget) closePreview()
                }}
              >
                <div
                  className={styles.lightboxCanvas}
                  onClick={(e) => {
                    if (e.target === e.currentTarget) closePreview()
                  }}
                >
                  <img
                    ref={imgRef}
                    className={styles.lightboxImg}
                    src={previewItem.url}
                    alt={previewItem.prompt || "生成的图片"}
                    onClick={() => setHudVisible((v) => !v)}
                    title={hudVisible ? '点击图片隐藏悬浮信息栏' : '点击图片显示信息栏'}
                  />
                </div>

                {/* Top Floating Frosted Strip */}
                <div ref={topHudRef} className={styles.lightboxTopBar}>
                  <div className={`${styles.hudGlassPill} ${!hudVisible ? styles.hudItemHidden : ''}`}>
                    <span className={styles.hudIndexChip}>
                      {String(previewIndex + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}
                    </span>
                    <span className={styles.hudSpecText}>
                      {previewItem.model} · {previewItem.dimensions ?? formatBytes(previewItem.bytes)}
                    </span>
                  </div>

                  <div className={styles.hudActionCluster}>
                    <div
                      inert={!hudVisible}
                      className={`${styles.hudSecondaryGroup} ${!hudVisible ? styles.hudItemHidden : ''}`}
                    >
                      {items.length > 1 ? (
                        <div className={styles.hudNavGroup}>
                          <RippleButton
                            type="button"
                            className={styles.hudIconBtn}
                            onClick={() => stepPreview(-1)}
                            aria-label="上一张作品"
                            title="上一张 (←)"
                          >
                            <Icon name="arrow-left" size={15} />
                          </RippleButton>
                          <RippleButton
                            type="button"
                            className={styles.hudIconBtn}
                            onClick={() => stepPreview(1)}
                            aria-label="下一张作品"
                            title="下一张 (→)"
                          >
                            <Icon name="arrow-right" size={15} />
                          </RippleButton>
                        </div>
                      ) : null}

                      <RippleButton
                        type="button"
                        className={styles.hudDownloadBtn}
                        aria-label="下载原图"
                        onClick={() => onDownload(previewItem)}
                      >
                        <Icon name="download" size={15} />
                        <span>下载原图</span>
                      </RippleButton>
                    </div>

                    <RippleButton
                      type="button"
                      className={styles.hudIconBtn}
                      onClick={() => setHudVisible((v) => !v)}
                      aria-label={hudVisible ? '隐藏信息遮罩' : '显示信息遮罩'}
                      title={hudVisible ? '隐藏信息栏' : '显示信息栏'}
                    >
                      <Icon name={hudVisible ? 'eye-off' : 'eye'} size={15} />
                    </RippleButton>

                    <RippleButton
                      type="button"
                      className={styles.hudIconBtn}
                      onClick={closePreview}
                      aria-label="关闭预览"
                      title="关闭 (Esc)"
                    >
                      <Icon name="close" size={17} />
                    </RippleButton>
                  </div>
                </div>

                {/* Bottom Compact Frosted Caption Dock */}
                <div
                  ref={bottomHudRef}
                  inert={!hudVisible}
                  className={`${styles.lightboxBottomDock} ${!hudVisible ? styles.hudBottomHidden : ''}`}
                >
                  <button type="button" aria-expanded={promptExpanded}
                    className={`${styles.lightboxPrompt} ${promptExpanded ? styles.lightboxPromptExpanded : ''}`}
                    onClick={() => setPromptExpanded((v) => !v)}
                    title="点击展开或收起完整描述"
                  >
                    {previewItem.prompt || "未记录提示词"}
                  </button>
                  <div className={styles.lightboxSubMeta}>
                    <span>
                      {retention && `${retention.describe(previewItem).detailLabel} · `}
                      {groupLabel(previewItem)} ·{' '}
                      {formatBytes(previewItem.bytes)} · {new Date(previewItem.createdAt).toLocaleString()}
                    </span>
                    <span>点击画面切换信息遮罩 · Esc 关闭</span>
                  </div>
                </div>
              </div>
            </div>,
            document.getElementById(overlayId) ?? document.body,
          )
        : null}
    </div>
  )
}
