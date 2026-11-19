import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProviderType } from '@nanobanana/shared/types/generation'
import { Icon } from '../../components/Icon'
import {
  CountStepper,
  M3PrimaryTabs,
  RatioTileSelector,
  SegmentedRail,
  StudioSelect,
} from '../components/LabControls'
import { RippleButton } from '../components/LabRipple'
import { LabIcon } from '../components/LabIcon'
import {
  ConnectedRatioSkeleton,
  ShimmerImage,
  SkeletonBlock,
  SkeletonTextStack,
} from '../components/LabSkeleton'
import {
  buildContainerMorphKeyframes,
  isRectMostlyInViewport,
  measureContainImageRect,
  type RectLike,
} from '../components/lightboxTransition'
import type { SnackbarPayload } from '../components/useSnackbar'
import {
  MOCK_ADMIN_ISSUES,
  MOCK_ADMIN_SETTINGS,
  MOCK_ADMIN_USAGE,
  MOCK_ADMIN_USERS,
  MOCK_CATALOG_BY_CHANNEL,
  MOCK_CHANNELS,
  MOCK_GALLERY_ITEMS,
  MOCK_GALLERY_RETENTION_DAYS,
  MOCK_INVITES,
  MOCK_R2_BUCKETS,
  MOCK_TEMPLATES,
  type AdminIssueRecord,
  type MockGalleryItem,
} from '../mockData'
import {
  formatBytes,
  formatRetentionPolicyText,
  getImageRetentionSummary,
} from '../utils/retentionFormat'
import { AdminIssuesModule } from './AdminIssuesModule'
import { AdminStorageModule } from './AdminStorageModule'
import styles from './MultiPagePrototypes.module.css'

export type LabPageRoute = 'workbench' | 'gallery' | 'channels' | 'account' | 'admin'
export type LabLoadMode = 'ready' | 'loading' | 'media-loading'
export type LabGalleryScenario = 'mixed' | 'empty' | 'permanent-policy' | 'expired-404'
export type LabAdminTab =
  | 'channels'
  | 'users'
  | 'invites'
  | 'settings'
  | 'templates'
  | 'usage'
  | 'storage'
  | 'issues'

/* ==========================================================================
   PAGE 2 · /gallery — 我的图库
   ========================================================================== */
function cancelAnimations(list: Animation[]) {
  for (const anim of list) {
    try {
      anim.cancel()
    } catch {
      // Ignore canceled or already released animations
    }
  }
}

export function GalleryPrototype({
  onGoWorkbench,
  onNotify,
  loadMode = 'ready',
  galleryScenario = 'mixed',
  onGalleryScenarioChange,
}: {
  onGoWorkbench: () => void
  onNotify: (payload: SnackbarPayload) => void
  loadMode?: LabLoadMode
  galleryScenario?: LabGalleryScenario
  onGalleryScenarioChange?: (next: LabGalleryScenario) => void
}) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>(['srv-2'])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [previewItem, setPreviewItem] = useState<MockGalleryItem | null>(null)
  const [openSeq, setOpenSeq] = useState(0)
  const [isClosing, setIsClosing] = useState(false)
  const [hudVisible, setHudVisible] = useState(true)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [invalidated404Keys, setInvalidated404Keys] = useState<string[]>([])
  const [nowMs] = useState(() => Date.now())

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
  const refreshTimerRef = useRef<number | null>(null)

  const siteRetentionDays =
    galleryScenario === 'permanent-policy' ? null : MOCK_GALLERY_RETENTION_DAYS
  const items = useMemo(() => {
    if (galleryScenario === 'empty') return []
    const hidden = galleryScenario === 'expired-404' ? invalidated404Keys : []
    return MOCK_GALLERY_ITEMS.filter((item) => !hidden.includes(item.key))
  }, [galleryScenario, invalidated404Keys])
  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0)
  const showListSkeleton = loadMode === 'loading' || isRefreshing
  const showMediaSkeleton = loadMode === 'media-loading'
  const allSelected = items.length > 0 && items.every((item) => selectedKeys.includes(item.key))
  const previewIndex = previewItem ? items.findIndex((i) => i.key === previewItem.key) : -1
  const previewRetention = previewItem
    ? getImageRetentionSummary(previewItem.retentionDays, previewItem.expiresAt, nowMs)
    : null

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
    setPreviewItem(null)
  }, [])

  function triggerSimulated404(item: MockGalleryItem) {
    // Never retain an invalid preview once 404 is encountered; prompt list re-sync.
    setInvalidated404Keys((prev) =>
      prev.includes(item.key) ? prev : [...prev, item.key],
    )
    setSelectedKeys((prev) => prev.filter((k) => k !== item.key))
    if (previewItem?.key === item.key) {
      finalizeClose()
    }
    onNotify({
      tone: 'warning',
      message: '图片已失效（404），已移除预览，建议刷新图库。',
      actionLabel: '刷新列表',
      onAction: () => {
        setInvalidated404Keys([])
        onGalleryScenarioChange?.('mixed')
        onNotify({
          tone: 'info',
          message: '图库已同步',
        })
      },
    })
  }

  function openPreview(item: MockGalleryItem) {
    if (galleryScenario === 'expired-404' && item.key === 'srv-1') {
      triggerSimulated404(item)
      return
    }
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
    setPreviewItem(item)
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
    const imgRect = measureContainImageRect(surfaceRect, imgEl, previewItem.dimensions)

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
      const nextIdx = (previewIndex + delta + items.length) % items.length
      stepDirectionRef.current = delta
      setPromptExpanded(false)
      setPreviewItem(items[nextIdx])
    },
    [items, previewIndex],
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
    const imgRect = measureContainImageRect(surfaceRect, imgEl, previewItem.dimensions)

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
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
      cancelAnimations(openAnimsRef.current)
      cancelAnimations(openHudAnimsRef.current)
      cancelAnimations(stepAnimsRef.current)
      cancelAnimations(closeAnimsRef.current)
    }
  }, [])

  useEffect(() => {
    if (!previewItem) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePreview()
      } else if (event.key === 'ArrowLeft') {
        stepPreview(-1)
      } else if (event.key === 'ArrowRight') {
        stepPreview(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePreview, previewItem, stepPreview])

  function toggleSelect(key: string) {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedKeys([])
    } else {
      setSelectedKeys(items.map((item) => item.key))
    }
  }

  return (
    <div className={styles.pageWrap}>
      <header className={styles.pageHeader}>
        <div className={styles.pageTitleGroup}>
          <span className={styles.pageEyebrow}>STUDIO GALLERY</span>
          <h1 className={styles.pageTitle}>我的图库</h1>
          <p className={styles.pageSub}>按最新生成倒序排列 · 点击卡片预览原图、提示词与任务分组</p>
        </div>

        <div className={styles.pageHeaderActions}>
          {showListSkeleton ? (
            <>
              <SkeletonBlock variant="pill" width={148} height={30} />
              <SkeletonBlock variant="pill" width={132} height={30} staggerIndex={1} />
            </>
          ) : (
            <>
              <span className={styles.policyPill}>
                <LabIcon name="clock" size={14} />
                <span>新图{formatRetentionPolicyText(siteRetentionDays)}</span>
              </span>
              <span className={styles.summaryPill}>
                {items.length} 张 · {formatBytes(totalBytes)}
              </span>
            </>
          )}
          <RippleButton
            type="button"
            className={styles.tonalBtn}
            disabled={showListSkeleton}
            onClick={() => {
              if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
              setIsRefreshing(true)
              refreshTimerRef.current = window.setTimeout(() => {
                setIsRefreshing(false)
                if (galleryScenario === 'expired-404') {
                  setInvalidated404Keys([])
                  onGalleryScenarioChange?.('mixed')
                }
                onNotify({
                  tone: 'info',
                  message: '图库已刷新',
                })
              }, 850)
            }}
          >
            <Icon name="loader" size={14} />
            <span>{showListSkeleton ? '正在刷新…' : '刷新图库'}</span>
          </RippleButton>
          <RippleButton type="button" className={styles.primaryBtn} onClick={onGoWorkbench}>
            <Icon name="plus" size={15} />
            <span>创建新作品</span>
          </RippleButton>
        </div>
      </header>

      {galleryScenario === 'expired-404' ? (
        <div className={styles.galleryNoticeBanner} role="status">
          <div className={styles.galleryNoticeText}>
            <Icon name="alert-circle" size={16} />
            <span>
              <strong>图片加载失败（404）：</strong>
              图片可能已过期或被删除，打开失效图片时会自动移除并提示刷新列表。
            </span>
          </div>
          <RippleButton
            type="button"
            className={styles.tonalBtn}
            onClick={() => {
              const first = items[0]
              if (first) {
                triggerSimulated404(first)
              } else {
                setInvalidated404Keys([])
                onGalleryScenarioChange?.('mixed')
              }
            }}
          >
            {items.some((i) => i.key === 'srv-1') ? '模拟图片 404' : '刷新恢复列表'}
          </RippleButton>
        </div>
      ) : null}

      {/* Batch Action Bar */}
      <div className={styles.toolbarCard}>
        {showListSkeleton ? (
          <>
            <div className={styles.toolbarLeft}>
              <SkeletonBlock variant="text" width={168} height={13} />
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
                共 {items.length} 张作品 · 每张按各自显示时间过期
              </span>
            </div>

            <div className={styles.toolbarRight}>
              <RippleButton
                type="button"
                aria-pressed={allSelected}
                disabled={items.length === 0}
                className={`${styles.selectToggleBtn} ${allSelected ? styles.selectToggleActive : ''}`}
                onClick={toggleAll}
              >
                <Icon name={allSelected ? 'check' : 'grid'} size={14} />
                <span>{allSelected ? '取消全选' : '全选当前'}</span>
              </RippleButton>

              <span className={styles.countChip}>已选 {selectedKeys.length} 张</span>

              <RippleButton
                type="button"
                className={styles.dangerTonalBtn}
                disabled={selectedKeys.length === 0}
                onClick={() =>
                  onNotify({
                    tone: 'warning',
                    message: `Mock 提示：删除所选 ${selectedKeys.length} 张作品将按所属任务整组删除（含同组未选中图片），无法撤销。`,
                  })
                }
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
                  <SkeletonBlock
                    variant="rect"
                    width={62}
                    height={22}
                    radius="var(--md-sys-shape-corner-small)"
                    staggerIndex={idx}
                  />
                  <SkeletonBlock
                    variant="rect"
                    width={78}
                    height={22}
                    radius="var(--md-sys-shape-corner-small)"
                    staggerIndex={idx + 1}
                  />
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
      ) : items.length === 0 ? (
        <div className={styles.galleryEmptyCard}>
          <h2>还没有作品</h2>
          <p>
            新生成的图片默认<strong>{formatRetentionPolicyText(siteRetentionDays)}</strong>
            ，到期后整组自动删除。
          </p>
          <RippleButton type="button" className={styles.primaryBtn} onClick={onGoWorkbench}>
            <Icon name="sparkles" size={15} />
            <span>去生成图片</span>
          </RippleButton>
        </div>
      ) : (
        <div className={styles.galleryGrid}>
          {items.map((item, idx) => {
            const selected = selectedKeys.includes(item.key)
            const retention = getImageRetentionSummary(item.retentionDays, item.expiresAt, nowMs)
            const retentionClass =
              retention.tone === 'urgent'
                ? styles.retentionChipUrgent
                : retention.tone === 'timed'
                  ? styles.retentionChipTimed
                  : styles.retentionChipPermanent
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
                    onClick={() => toggleSelect(item.key)}
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
                    alt={item.prompt}
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
                    <span className={styles.sourceServer}>
                      {item.groupCount > 1 ? `同组 ${item.groupCount} 张` : '单图作品'}
                    </span>
                    <span
                      className={`${styles.retentionChip} ${retentionClass}`}
                      title={retention.detailLabel}
                    >
                      <LabIcon name="clock" size={11} />
                      <span>{retention.shortLabel}</span>
                    </span>
                  </div>
                  <span className={styles.monoMeta}>
                    {item.dimensions} · {Math.round(item.bytes / 1024)} KiB
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
                    onClick={() =>
                      onNotify({ tone: 'info', message: `已模拟下载原图：${item.key}` })
                    }
                  >
                    <Icon name="download" size={14} />
                    <span>下载</span>
                  </RippleButton>
                  <RippleButton
                    type="button"
                    className={styles.cardDangerBtn}
                    aria-label={`删除 ${item.key}`}
                    onClick={() =>
                      onNotify({
                        tone: 'warning',
                        message: `删除此作品将连带删除所属任务（共 ${item.groupCount} 张同组图片），无法撤销。`,
                      })
                    }
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
          删除或到期时，同一任务的全部图片会一起删除，不退回已用额度。
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
                    alt={previewItem.prompt}
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
                      {previewItem.model} · {previewItem.dimensions}
                    </span>
                  </div>

                  <div className={styles.hudActionCluster}>
                    <div
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
                        onClick={() =>
                          onNotify({ tone: 'info', message: `已模拟下载原图：${previewItem.key}` })
                        }
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
                  className={`${styles.lightboxBottomDock} ${!hudVisible ? styles.hudBottomHidden : ''}`}
                >
                  <p
                    className={`${styles.lightboxPrompt} ${promptExpanded ? styles.lightboxPromptExpanded : ''}`}
                    onClick={() => setPromptExpanded((v) => !v)}
                    title="点击展开或收起完整描述"
                  >
                    {previewItem.prompt}
                  </p>
                  <div className={styles.lightboxSubMeta}>
                    <span>
                      {previewRetention?.detailLabel ?? '永久保存'} ·{' '}
                      {previewItem.groupCount > 1 ? `同组 ${previewItem.groupCount} 张` : '单图作品'} ·{' '}
                      {Math.round(previewItem.bytes / 1024)} KiB
                    </span>
                    <span>点击画面切换信息遮罩 · Esc 关闭</span>
                  </div>
                </div>
              </div>
            </div>,
            document.getElementById('lab-overlay-root') ?? document.body,
          )
        : null}
    </div>
  )
}

/* ==========================================================================
   PAGE 3 · /channels — 渠道与模型目录管理（私有 & 共享通用）
   ========================================================================== */
export function ChannelsPrototype({
  scope = 'private',
  onNotify,
  loadMode = 'ready',
}: {
  scope?: 'private' | 'shared'
  onNotify: (payload: SnackbarPayload) => void
  loadMode?: LabLoadMode
}) {
  const scopedChannels = MOCK_CHANNELS.filter((c) => c.scope === scope)
  const [selectedId, setSelectedId] = useState(scopedChannels[0]?.id ?? '')
  const activeChannel = scopedChannels.find((c) => c.id === selectedId) ?? scopedChannels[0] ?? null

  const [editName, setEditName] = useState(activeChannel?.name ?? '新私有中转渠道')
  const [editProvider, setEditProvider] = useState<ProviderType>(activeChannel?.provider ?? 'openai-compatible')
  const [editUrl, setEditUrl] = useState(activeChannel?.baseUrl ?? '')
  const [editEnabled, setEditEnabled] = useState(activeChannel?.enabled ?? true)
  const [enabledModelIds, setEnabledModelIds] = useState<string[]>(activeChannel?.enabledModels ?? [])
  const [isRefreshingList, setIsRefreshingList] = useState(false)
  const [isRefreshingCatalog, setIsRefreshingCatalog] = useState(false)
  const listTimerRef = useRef<number | null>(null)
  const catalogTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (listTimerRef.current !== null) window.clearTimeout(listTimerRef.current)
      if (catalogTimerRef.current !== null) window.clearTimeout(catalogTimerRef.current)
    }
  }, [])

  const showChannelSkeleton = loadMode === 'loading' || isRefreshingList
  const showCatalogSkeleton = isRefreshingCatalog
  const catalog = activeChannel ? MOCK_CATALOG_BY_CHANNEL[activeChannel.id] : null

  function selectChannel(chId: string) {
    const found = scopedChannels.find((c) => c.id === chId)
    setSelectedId(chId)
    if (found) {
      setEditName(found.name)
      setEditProvider(found.provider)
      setEditUrl(found.baseUrl)
      setEditEnabled(found.enabled)
      setEnabledModelIds(found.enabledModels)
    }
  }

  return (
    <div className={styles.pageWrap}>
      {scope === 'private' ? (
        <header className={styles.pageHeader}>
          <div className={styles.pageTitleGroup}>
            <span className={styles.pageEyebrow}>PRIVATE CHANNELS &amp; KEYS</span>
            <h1 className={styles.pageTitle}>我的自定义渠道</h1>
            <p className={styles.pageSub}>
              私有渠道使用你自己的上游地址与密钥，密钥 AES-GCM 加密存服务端且不回传，不占用站点共享日额度
            </p>
          </div>
          <div className={styles.pageHeaderActions}>
            <RippleButton
              type="button"
              className={styles.tonalBtn}
              disabled={showChannelSkeleton}
              onClick={() => {
                if (listTimerRef.current !== null) window.clearTimeout(listTimerRef.current)
                setIsRefreshingList(true)
                listTimerRef.current = window.setTimeout(() => {
                  setIsRefreshingList(false)
                  onNotify({ tone: 'info', message: '已模拟刷新私有渠道列表。' })
                }, 850)
              }}
            >
              <Icon name="loader" size={14} />
              <span>{showChannelSkeleton ? '正在刷新…' : '刷新列表'}</span>
            </RippleButton>
            <RippleButton
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                setSelectedId('')
                setEditName('新建自定义渠道')
                setEditUrl('https://api.example.com/v1')
                setEnabledModelIds([])
                onNotify({ tone: 'info', message: '已切换到新建渠道草稿（Mock 预览）。' })
              }}
            >
              <Icon name="plus" size={15} />
              <span>新增自定义渠道</span>
            </RippleButton>
          </div>
        </header>
      ) : null}

      {showChannelSkeleton ? (
        <div
          className={styles.splitWorkspace}
          role="status"
          aria-busy="true"
          aria-label="正在加载渠道配置"
        >
          <section className={styles.masterRail} aria-hidden="true">
            <div className={styles.masterHead}>
              <SkeletonBlock variant="text" width={88} height={14} />
              <SkeletonBlock variant="pill" width={36} height={16} />
            </div>

            <div className={styles.channelCardStack}>
              {Array.from({ length: 3 }, (_, idx) => (
                <div key={idx} className={styles.channelItemCard}>
                  <div className={styles.channelItemTop}>
                    <SkeletonBlock variant="text" width="58%" height={14} staggerIndex={idx} />
                    <SkeletonBlock variant="pill" width={52} height={22} staggerIndex={idx + 1} />
                  </div>
                  <div className={styles.channelItemMeta}>
                    <SkeletonBlock variant="rect" width={48} height={18} radius={6} staggerIndex={idx} />
                    <SkeletonBlock variant="text" width={92} height={12} staggerIndex={idx + 1} />
                  </div>
                  <SkeletonBlock variant="text" width="84%" height={11} staggerIndex={idx + 2} />
                </div>
              ))}
            </div>
          </section>

          <section className={styles.detailCard} aria-hidden="true">
            <div className={styles.detailHeader}>
              <div className={styles.skeletonListStack} style={{ gap: 6, flex: 1 }}>
                <SkeletonBlock variant="text" width={140} height={11} />
                <SkeletonBlock variant="text" width={200} height={22} staggerIndex={1} />
              </div>
              <SkeletonBlock variant="pill" width={82} height={34} />
            </div>

            <div className={styles.formGrid}>
              <div className={styles.filledField}>
                <SkeletonBlock variant="text" width={68} height={12} />
                <SkeletonBlock variant="field" staggerIndex={0} />
              </div>
              <div className={styles.filledField}>
                <SkeletonBlock variant="text" width={68} height={12} />
                <SkeletonBlock variant="pill" width="100%" height={38} radius={19} staggerIndex={1} />
              </div>
              <div className={`${styles.filledField} ${styles.fullSpan}`}>
                <SkeletonBlock variant="text" width={120} height={12} />
                <SkeletonBlock variant="field" staggerIndex={2} />
              </div>
              <div className={`${styles.filledField} ${styles.fullSpan}`}>
                <SkeletonBlock variant="text" width={220} height={12} />
                <SkeletonBlock variant="field" staggerIndex={3} />
              </div>
            </div>

            <div className={styles.catalogBox}>
              <div className={styles.catalogHead}>
                <div className={styles.skeletonListStack} style={{ gap: 6 }}>
                  <SkeletonBlock variant="text" width={140} height={14} />
                  <SkeletonBlock variant="text" width={240} height={11} staggerIndex={1} />
                </div>
                <SkeletonBlock variant="pill" width={118} height={38} radius={19} />
              </div>
              <div className={styles.catalogGrid}>
                {[126, 98, 114, 92, 134, 84].map((w, idx) => (
                  <SkeletonBlock key={idx} variant="rect" width={w} height={32} radius={8} staggerIndex={idx} />
                ))}
              </div>
              <div className={styles.filledField}>
                <SkeletonBlock variant="text" width={170} height={12} />
                <SkeletonBlock variant="field" height={82} staggerIndex={2} />
              </div>
            </div>

            <div className={styles.detailFooter}>
              <SkeletonBlock variant="pill" width={104} height={40} radius={20} />
              <SkeletonBlock variant="pill" width={126} height={40} radius={20} staggerIndex={1} />
            </div>
          </section>
        </div>
      ) : (
      <div className={styles.splitWorkspace}>
        {/* Left List */}
        <section className={styles.masterRail} aria-label="渠道列表">
          <div className={styles.masterHead}>
            <strong>{scope === 'shared' ? '共享渠道列表' : '私有渠道列表'}</strong>
            <span>{scopedChannels.length} 个</span>
          </div>

          <div className={styles.channelCardStack}>
            {scopedChannels.map((ch) => {
              const active = ch.id === selectedId
              return (
                <RippleButton
                  key={ch.id}
                  type="button"
                  aria-pressed={active}
                  className={`${styles.channelItemCard} ${active ? styles.channelItemActive : ''}`}
                  onClick={() => selectChannel(ch.id)}
                >
                  <div className={styles.channelItemTop}>
                    <strong>{ch.name}</strong>
                    <span className={ch.enabled ? styles.statusOn : styles.statusOff}>
                      {ch.enabled ? '启用中' : '已停用'}
                    </span>
                  </div>
                  <div className={styles.channelItemMeta}>
                    <span className={styles.protoTag}>
                      {ch.provider === 'openai-compatible' ? 'OpenAI' : 'Gemini'}
                    </span>
                    <span>{ch.hasApiKey ? '密钥已配置（只写）' : '未设密钥'}</span>
                  </div>
                  <code className={styles.urlSnippet}>{ch.baseUrl}</code>
                </RippleButton>
              )
            })}
          </div>
        </section>

        {/* Right Detail Editor */}
        <section className={styles.detailCard} aria-label="渠道与模型编辑">
          <div className={styles.detailHeader}>
            <div>
              <span className={styles.pageEyebrow}>CHANNEL CONFIGURATION</span>
              <h2>{selectedId ? `编辑：${editName}` : '新建渠道'}</h2>
            </div>
            <RippleButton
              type="button"
              aria-pressed={editEnabled}
              className={`${styles.switchPill} ${editEnabled ? styles.switchPillOn : ''}`}
              onClick={() => setEditEnabled((v) => !v)}
            >
              <span className={styles.switchThumb} />
              <span>{editEnabled ? '已启用' : '已停用'}</span>
            </RippleButton>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.filledField}>
              <span>渠道名称</span>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="例如：工作室主镜像"
              />
            </label>

            <div className={styles.filledField}>
              <span>接口协议</span>
              <SegmentedRail
                label="接口协议"
                value={editProvider}
                options={[
                  { value: 'openai-compatible', label: 'OpenAI 兼容' },
                  { value: 'gemini-compatible', label: 'Gemini 兼容' },
                ]}
                onChange={setEditProvider}
              />
            </div>

            <label className={`${styles.filledField} ${styles.fullSpan}`}>
              <span>接口地址 Base URL</span>
              <input
                type="url"
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </label>

            <label className={`${styles.filledField} ${styles.fullSpan}`}>
              <span>访问密钥（只写不回显 · 编辑时留空则保留原密钥）</span>
              <input
                type="password"
                placeholder={activeChannel?.hasApiKey ? '••••••••••••（已设置，留空不修改）' : '输入 API Key'}
              />
            </label>
          </div>

          {/* Model Catalog Discovery */}
          <div className={styles.catalogBox}>
            <div className={styles.catalogHead}>
              <div>
                <strong>模型目录与启用列表</strong>
                <span>目录来自渠道 `/models`，不保证全部支持生图；{scope === 'shared' ? '普通用户仅可选中已启用模型' : '私有渠道也可在工作台手填 ID'}</span>
              </div>
              <RippleButton
                type="button"
                className={styles.tonalBtn}
                disabled={showCatalogSkeleton}
                onClick={() => {
                  if (catalogTimerRef.current !== null) window.clearTimeout(catalogTimerRef.current)
                  setIsRefreshingCatalog(true)
                  catalogTimerRef.current = window.setTimeout(() => {
                    setIsRefreshingCatalog(false)
                    onNotify({
                      tone: 'info',
                      message: '已模拟拉取渠道 /models 目录（真实环境使用长超时独立预算）。',
                    })
                  }, 850)
                }}
              >
                <Icon name="loader" size={14} />
                <span>{showCatalogSkeleton ? '正在发现…' : '发现 / 刷新模型'}</span>
              </RippleButton>
            </div>

            {showCatalogSkeleton ? (
              <div className={styles.catalogGrid} role="status" aria-label="正在加载模型目录">
                {[128, 96, 116, 88, 134].map((w, idx) => (
                  <SkeletonBlock key={idx} variant="rect" width={w} height={32} radius={8} staggerIndex={idx} />
                ))}
              </div>
            ) : catalog ? (
              <div className={styles.catalogGrid}>
                {catalog.models.map((m) => {
                  const checked = enabledModelIds.includes(m.id)
                  return (
                    <RippleButton
                      key={m.id}
                      type="button"
                      aria-pressed={checked}
                      className={`${styles.catalogModelChip} ${checked ? styles.catalogModelChipOn : ''}`}
                      onClick={() =>
                        setEnabledModelIds((prev) =>
                          prev.includes(m.id) ? prev.filter((id) => id !== m.id) : [...prev, m.id],
                        )
                      }
                    >
                      <Icon name={checked ? 'check' : 'plus'} size={13} />
                      <span>{m.name || m.id}</span>
                    </RippleButton>
                  )
                })}
              </div>
            ) : null}

            <label className={styles.filledField}>
              <span>手动 / 批量编辑模型 ID（每行一个）</span>
              <textarea
                rows={3}
                value={enabledModelIds.join('\n')}
                onChange={(e) =>
                  setEnabledModelIds(
                    e.target.value
                      .split(/\r?\n/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
          </div>

          <div className={styles.detailFooter}>
            {selectedId ? (
              <RippleButton
                type="button"
                className={styles.dangerTonalBtn}
                onClick={() =>
                  onNotify({
                    tone: 'warning',
                    message: 'Mock 提示：删除渠道会停止其排队任务，历史作品仍保留。',
                  })
                }
              >
                <Icon name="trash" size={14} />
                <span>删除此渠道</span>
              </RippleButton>
            ) : <span />}
            <RippleButton
              type="button"
              className={styles.primaryBtn}
              onClick={() =>
                onNotify({
                  tone: 'success',
                  message: `已模拟保存渠道「${editName}」（密钥安全写入服务端）。`,
                })
              }
            >
              <Icon name="check" size={15} />
              <span>保存渠道配置</span>
            </RippleButton>
          </div>
        </section>
      </div>
      )}
    </div>
  )
}

/* ==========================================================================
   PAGE 4 · /login & /password — 账号登录、邀请码注册与安全改密
   ========================================================================== */
export function AccountPrototype({
  onNotify,
  loadMode = 'ready',
}: {
  onNotify: (payload: SnackbarPayload) => void
  loadMode?: LabLoadMode
}) {
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'password'>('login')
  const [showPwd, setShowPwd] = useState(false)
  const isAccountLoading = loadMode === 'loading'

  return (
    <div className={styles.pageWrap}>
      {/* 小栏目：账号视图切换（仅支持手动点击切换） */}
      <div className={styles.authModeBar}>
        <M3PrimaryTabs
          label="账号页面子视图"
          variant="scrollable"
          value={authMode}
          items={[
            { id: 'login', label: '登录工作台 (/login)' },
            { id: 'register', label: '邀请码注册' },
            { id: 'password', label: '修改 / 强制改密 (/password)' },
          ]}
          onChange={setAuthMode}
        />
      </div>

      {isAccountLoading ? (
        <div
          className={styles.authSplitCard}
          role="status"
          aria-busy="true"
          aria-label="正在连接会话"
        >
          <section className={styles.authShowcase} aria-hidden="true">
            <div className={styles.authBrandBadge}>
              <SkeletonBlock variant="rect" width={44} height={44} radius={14} />
              <div className={styles.skeletonListStack} style={{ gap: 6 }}>
                <SkeletonBlock variant="text" width={140} height={15} />
                <SkeletonBlock variant="text" width={116} height={11} staggerIndex={1} />
              </div>
            </div>

            <div className={styles.skeletonListStack} style={{ gap: 8 }}>
              <SkeletonBlock variant="text" width="84%" height={26} staggerIndex={1} />
              <SkeletonBlock variant="text" width="56%" height={26} staggerIndex={2} />
            </div>

            <SkeletonTextStack widths={['94%', '72%']} lineHeight={14} staggerIndex={2} />

            <div className={styles.securityHighlights} style={{ gap: 12 }}>
              {[76, 84, 70].map((pct, idx) => (
                <div key={idx} className={styles.skeletonRow}>
                  <SkeletonBlock variant="circle" width={16} height={16} staggerIndex={idx} />
                  <SkeletonBlock variant="text" width={`${pct}%`} height={13} staggerIndex={idx + 1} />
                </div>
              ))}
            </div>
          </section>

          <section className={styles.authFormPane} aria-hidden="true">
            <div className={styles.skeletonListStack} style={{ gap: 6 }}>
              <SkeletonBlock variant="text" width={110} height={11} />
              <SkeletonBlock variant="text" width={160} height={22} staggerIndex={1} />
            </div>

            <div className={styles.authForm}>
              <div className={styles.filledField}>
                <SkeletonBlock variant="text" width={146} height={12} />
                <SkeletonBlock variant="field" staggerIndex={0} />
              </div>
              <div className={styles.filledField}>
                <SkeletonBlock variant="text" width={128} height={12} />
                <SkeletonBlock variant="field" staggerIndex={1} />
              </div>
              {authMode !== 'login' ? (
                <div className={styles.filledField}>
                  <SkeletonBlock variant="text" width={92} height={12} />
                  <SkeletonBlock variant="field" staggerIndex={2} />
                </div>
              ) : null}

              <div className={styles.authActions}>
                <SkeletonBlock variant="pill" width="100%" height={44} radius={22} staggerIndex={2} />
                {authMode !== 'password' ? (
                  <SkeletonBlock variant="pill" width="100%" height={44} radius={22} staggerIndex={3} />
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : (
      <div key={authMode} className={`${styles.authSplitCard} ${styles.subPanelFade}`}>
        {/* Left Identity Showcase */}
        <section className={styles.authShowcase}>
          <div className={styles.authBrandBadge}>
            <span className={styles.authGlyph}>
              <Icon name="banana" size={24} />
            </span>
            <div>
              <strong>NanoBanana Studio</strong>
              <span>Multi-User AI Darkroom</span>
            </div>
          </div>

          <h1 className={styles.authHeroTitle}>
            {authMode === 'password'
              ? '更新账号密码，保障工作区隔离安全'
              : authMode === 'register'
                ? '凭邀请码加入创作暗房'
                : '回到你的创作工作台'}
          </h1>

          <p className={styles.authHeroCopy}>
            作品、提示词历史与私有渠道密钥按账号严格隔离；共享渠道按北京时间每日统计额度。
          </p>

          <ul className={styles.securityHighlights}>
            <li>
              <Icon name="shield" size={16} />
              <span>HttpOnly 会话 Cookie + CSRF 保护，防跨站伪造</span>
            </li>
            <li>
              <Icon name="check" size={16} />
              <span>私有渠道 API Key 由服务端 AES-GCM 加密保管</span>
            </li>
            <li>
              <Icon name="sparkles" size={16} />
              <span>提交确认后即使关闭页面，后台队列仍继续完成生图</span>
            </li>
          </ul>
        </section>

        {/* Right Form Card */}
        <section className={styles.authFormPane}>
          <div className={styles.authFormHeader}>
            <span className={styles.pageEyebrow}>
              {authMode === 'password' ? 'SECURITY · PASSWORD' : authMode === 'register' ? 'INVITE REGISTRATION' : 'SIGN IN'}
            </span>
            <h2>
              {authMode === 'password'
                ? '修改密码（强制改密示例）'
                : authMode === 'register'
                  ? '使用邀请码创建账号'
                  : '登录账号'}
            </h2>
          </div>

          {authMode === 'password' ? (
            <div className={styles.cautionBanner}>
              <Icon name="alert-circle" size={16} />
              <span>新密码须为 12–1024 个字符，不会自动截断；更新后所有旧会话将立即失效，需重新登录。</span>
            </div>
          ) : null}

          <form
            className={styles.authForm}
            onSubmit={(e) => {
              e.preventDefault()
              onNotify({
                tone: 'success',
                message:
                  authMode === 'login'
                    ? 'Mock 校验通过：登录成功后将自动刷新 CSRF Token 并进入工作台。'
                    : authMode === 'register'
                      ? 'Mock 校验通过：已用邀请码注册普通用户并建立会话。'
                      : 'Mock 校验通过：密码已更新，旧会话已注销。',
              })
            }}
          >
            {authMode !== 'password' ? (
              <label className={styles.filledField}>
                <span>用户名（3–64 位 ASCII 字母、数字、._-）</span>
                <input defaultValue="designer.mei" required />
              </label>
            ) : (
              <label className={styles.filledField}>
                <span>当前密码</span>
                <input type="password" defaultValue="••••••••••••" required />
              </label>
            )}

            <div className={styles.filledField}>
              <span>{authMode === 'password' ? '新密码（12–1024 个字符）' : '密码（12–1024 个字符）'}</span>
              <div className={styles.passwordWrap}>
                <input
                  type={showPwd ? 'text' : 'password'}
                  defaultValue="example-secure-passphrase"
                  required
                />
                <RippleButton
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? '隐藏密码' : '显示密码'}
                >
                  <Icon name={showPwd ? 'eye-off' : 'eye'} size={16} />
                </RippleButton>
              </div>
            </div>

            {authMode === 'register' ? (
              <label className={styles.filledField}>
                <span>邀请码</span>
                <input defaultValue="STUDIO-2026-OPEN" required />
              </label>
            ) : null}

            {authMode === 'password' ? (
              <label className={styles.filledField}>
                <span>确认新密码</span>
                <input type="password" defaultValue="example-secure-passphrase" required />
              </label>
            ) : null}

            <div className={styles.authActions}>
              <RippleButton type="submit" className={styles.primaryBtnFull}>
                {authMode === 'password' ? '更新密码并重新登录' : authMode === 'register' ? '注册并进入工作台' : '登录工作台'}
              </RippleButton>
              {authMode !== 'password' ? (
                <RippleButton
                  type="button"
                  className={styles.tonalBtnFull}
                  onClick={() => {
                    setAuthMode(authMode === 'login' ? 'register' : 'login')
                  }}
                >
                  {authMode === 'login' ? '还没有账号？使用邀请码注册' : '已有账号？返回登录'}
                </RippleButton>
              ) : null}
            </div>
          </form>
        </section>
      </div>
      )}
    </div>
  )
}

/* ==========================================================================
   PAGE 5 · /admin — 站点管理控制台（8 大模块：含存储与 R2 桶、问题日志）
   ========================================================================== */
export function AdminPrototype({
  onNotify,
  loadMode = 'ready',
  activeTab,
  onTabChange,
}: {
  onNotify: (payload: SnackbarPayload) => void
  loadMode?: LabLoadMode
  activeTab?: LabAdminTab
  onTabChange?: (tab: LabAdminTab) => void
}) {
  const [internalTab, setInternalTab] = useState<LabAdminTab>('storage')
  const adminTab = activeTab ?? internalTab
  const setAdminTab = (next: LabAdminTab) => {
    setInternalTab(next)
    onTabChange?.(next)
  }

  const [issues, setIssues] = useState<AdminIssueRecord[]>(MOCK_ADMIN_ISSUES)
  const [tplRatio, setTplRatio] = useState('16:9')
  const [tplQuality, setTplQuality] = useState('high')
  const [tplCount, setTplCount] = useState(1)
  const [tplFormat, setTplFormat] = useState('png')
  const [isRefreshingUsage, setIsRefreshingUsage] = useState(false)
  const usageTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (usageTimerRef.current !== null) window.clearTimeout(usageTimerRef.current)
    }
  }, [])

  const isAdminLoading = loadMode === 'loading'
  const showUsageSkeleton = isAdminLoading || isRefreshingUsage
  const openIssueCount = issues.filter((issue) => issue.status === 'open').length

  function handleResolveIssue(id: string) {
    setIssues((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: 'resolved' } : item)),
    )
    onNotify({
      tone: 'success',
      message: '已标记为已处理',
    })
  }

  function handleSimulateRecur(id: string) {
    const now = Date.now()
    setIssues((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'open',
              occurrences: item.occurrences + 1,
              lastSeen: now,
            }
          : item,
      ),
    )
    onNotify({
      tone: 'warning',
      message: '模拟问题再发：次数 +1，已重新打开',
    })
  }

  function handleSimulate404Resolve(id: string) {
    setIssues((prev) => prev.filter((item) => item.id !== id))
    onNotify({
      tone: 'warning',
      message: '该记录已过期或不存在（404），已从列表移除',
    })
  }

  return (
    <div className={styles.pageWrap}>
      <header className={styles.pageHeader}>
        <div className={styles.pageTitleGroup}>
          <span className={styles.pageEyebrow}>SITE ADMINISTRATION</span>
          <h1 className={styles.pageTitle}>站点管理台</h1>
          <p className={styles.pageSub}>
            管理共享渠道、用户额度、邀请码、队列并发、参数模板、存储与问题日志
          </p>
        </div>

        <div className={styles.pageHeaderActions}>
          {openIssueCount > 0 ? (
            <RippleButton
              type="button"
              className={styles.dangerTonalBtn}
              onClick={() => setAdminTab('issues')}
            >
              <LabIcon name="bell" size={14} />
              <span>待处理问题 {openIssueCount} 条</span>
            </RippleButton>
          ) : (
            <span className={styles.summaryPill}>问题已全部处理</span>
          )}
        </div>
      </header>

      {/* 小栏目：站点管理子模块切换（仅支持手动点击切换） */}
      <div className={styles.adminNavWrap}>
        <M3PrimaryTabs
          label="站点管理模块"
          variant="scrollable"
          value={adminTab}
          items={[
            { id: 'channels', label: '共享渠道' },
            { id: 'users', label: '用户管理' },
            { id: 'invites', label: '邀请码' },
            { id: 'settings', label: '额度与队列' },
            { id: 'templates', label: '参数模板' },
            { id: 'usage', label: '使用统计' },
            { id: 'storage', label: '存储管理' },
            {
              id: 'issues',
              label: '问题日志',
              badge: openIssueCount > 0 ? openIssueCount : undefined,
            },
          ]}
          onChange={setAdminTab}
        />
      </div>

      <div key={adminTab} className={styles.subPanelFade}>

      {adminTab === 'storage' ? (
        <AdminStorageModule loadMode={loadMode} onNotify={onNotify} />
      ) : null}

      {adminTab === 'issues' ? (
        <AdminIssuesModule
          issues={issues}
          openCount={openIssueCount}
          buckets={MOCK_R2_BUCKETS}
          loadMode={loadMode}
          onResolveIssue={handleResolveIssue}
          onSimulateRecur={handleSimulateRecur}
          onSimulate404Resolve={handleSimulate404Resolve}
          onNotify={onNotify}
        />
      ) : null}

      {adminTab === 'channels' ? (
        <ChannelsPrototype scope="shared" loadMode={loadMode} onNotify={onNotify} />
      ) : null}

      {adminTab === 'users' ? (
        isAdminLoading ? (
          <div className={styles.adminSection} role="status" aria-busy="true" aria-label="正在加载用户列表">
            <SkeletonBlock variant="rect" width="100%" height={42} radius={14} />
            <div className={styles.adminGrid} aria-hidden="true">
              {Array.from({ length: 4 }, (_, idx) => (
                <article key={idx} className={styles.adminCard}>
                  <div className={styles.adminCardHead}>
                    <div className={styles.skeletonRow}>
                      <SkeletonBlock variant="text" width={92} height={15} staggerIndex={idx} />
                      <SkeletonBlock variant="rect" width={46} height={20} radius={6} staggerIndex={idx} />
                    </div>
                    <SkeletonBlock variant="pill" width={62} height={22} staggerIndex={idx + 1} />
                  </div>
                  <div className={styles.adminUserFields}>
                    <div className={styles.filledField}>
                      <SkeletonBlock variant="text" width={110} height={11} />
                      <SkeletonBlock variant="field" staggerIndex={idx} />
                    </div>
                    <div className={styles.filledField}>
                      <SkeletonBlock variant="text" width={120} height={11} />
                      <SkeletonBlock variant="field" staggerIndex={idx + 1} />
                    </div>
                  </div>
                  <div className={styles.adminCardFooter}>
                    <SkeletonBlock variant="text" width={88} height={12} staggerIndex={idx} />
                    <SkeletonBlock variant="pill" width={88} height={40} radius={20} staggerIndex={idx + 1} />
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
        <div className={styles.adminSection}>
          <div className={styles.sectionNote}>
            日额度留空继承全站默认（{MOCK_ADMIN_SETTINGS.defaultDailyLimit} 次），-1 为无限，0 为禁止共享调用；管理员不可查看用户提示词或图片。
          </div>
          <div className={styles.adminGrid}>
            {MOCK_ADMIN_USERS.map((u) => (
              <article key={u.id} className={styles.adminCard}>
                <div className={styles.adminCardHead}>
                  <div>
                    <strong>{u.username}</strong>
                    <span className={u.role === 'ADMIN' ? styles.roleAdmin : styles.roleUser}>{u.role}</span>
                  </div>
                  <span className={u.enabled ? styles.statusOn : styles.statusOff}>
                    {u.enabled ? '账号正常' : '已禁用'}
                  </span>
                </div>
                <div className={styles.adminUserFields}>
                  <label className={styles.filledField}>
                    <span>日额度覆盖（空值继承）</span>
                    <input type="number" defaultValue={u.dailyLimit ?? ''} placeholder="继承站点默认" />
                  </label>
                  {u.role === 'USER' ? (
                    <label className={styles.filledField}>
                      <span>重置密码（12–1024 字符，留空不改）</span>
                      <input type="password" placeholder="输入新初始密码" />
                    </label>
                  ) : null}
                </div>
                <div className={styles.adminCardFooter}>
                  <span className={styles.monoMeta}>
                    {u.mustChangePassword ? '下次登录须改密' : '密码状态正常'}
                  </span>
                  <RippleButton
                    type="button"
                    className={styles.tonalBtn}
                    onClick={() =>
                      onNotify({
                        tone: 'success',
                        message: `已模拟更新用户 ${u.username} 的额度与账号状态。`,
                      })
                    }
                  >
                    保存设置
                  </RippleButton>
                </div>
              </article>
            ))}
          </div>
        </div>
        )
      ) : null}

      {adminTab === 'invites' ? (
        isAdminLoading ? (
          <div className={styles.adminSection} role="status" aria-busy="true" aria-label="正在加载邀请码">
            <div className={styles.toolbarCard} aria-hidden="true">
              <SkeletonBlock variant="text" width="52%" height={14} />
              <SkeletonBlock variant="pill" width={118} height={40} radius={20} staggerIndex={1} />
            </div>
            <div className={styles.inviteList} aria-hidden="true">
              {Array.from({ length: 3 }, (_, idx) => (
                <div key={idx} className={styles.inviteRow}>
                  <SkeletonBlock variant="rect" width={148} height={28} radius={8} staggerIndex={idx} />
                  <SkeletonBlock variant="pill" width={54} height={22} staggerIndex={idx + 1} />
                  <SkeletonBlock variant="text" width={78} height={12} staggerIndex={idx + 2} />
                  <div className={styles.inviteActions}>
                    <SkeletonBlock variant="pill" width={76} height={40} radius={20} staggerIndex={idx} />
                    <SkeletonBlock variant="pill" width={68} height={40} radius={20} staggerIndex={idx + 1} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
        <div className={styles.adminSection}>
          <div className={styles.toolbarCard}>
            <div className={styles.toolbarLeft}>
              <span className={styles.sectionNoteInline}>
                无限次邀请码不过期，可反复注册普通用户；撤销后立即停止新注册。
              </span>
            </div>
            <RippleButton
              type="button"
              className={styles.primaryBtn}
              onClick={() =>
                onNotify({
                  tone: 'success',
                  message: '已模拟创建新邀请码：STUDIO-2026-NEW（Mock）。',
                })
              }
            >
              <Icon name="plus" size={15} />
              <span>创建邀请码</span>
            </RippleButton>
          </div>
          <div className={styles.inviteList}>
            {MOCK_INVITES.map((inv) => (
              <div key={inv.id} className={styles.inviteRow}>
                <code className={styles.inviteCode}>{inv.code}</code>
                <span className={inv.enabled ? styles.statusOn : styles.statusOff}>
                  {inv.enabled ? '有效' : '已撤销'}
                </span>
                <span className={styles.monoMeta}>已注册 {inv.registrationCount} 人</span>
                <div className={styles.inviteActions}>
                  <RippleButton
                    type="button"
                    className={styles.tonalBtn}
                    onClick={() =>
                      onNotify({ tone: 'info', message: `已复制邀请码 ${inv.code}` })
                    }
                  >
                    <Icon name="copy" size={14} />
                    <span>复制</span>
                  </RippleButton>
                  <RippleButton
                    type="button"
                    className={styles.dangerTonalBtn}
                    disabled={!inv.enabled}
                    onClick={() =>
                      onNotify({
                        tone: 'warning',
                        message: `已模拟撤销邀请码 ${inv.code}（即刻生效）。`,
                      })
                    }
                  >
                    撤销
                  </RippleButton>
                </div>
              </div>
            ))}
          </div>
        </div>
        )
      ) : null}

      {adminTab === 'settings' ? (
        isAdminLoading ? (
          <div className={styles.detailCard} role="status" aria-busy="true" aria-label="正在加载额度与队列设置">
            <div className={styles.detailHeader} aria-hidden="true">
              <div className={styles.skeletonListStack} style={{ gap: 6 }}>
                <SkeletonBlock variant="text" width={148} height={11} />
                <SkeletonBlock variant="text" width={210} height={22} staggerIndex={1} />
              </div>
              <SkeletonBlock variant="pill" width={168} height={30} />
            </div>
            <div className={styles.formGrid} aria-hidden="true">
              {Array.from({ length: 4 }, (_, idx) => (
                <div key={idx} className={styles.filledField}>
                  <SkeletonBlock variant="text" width="68%" height={12} staggerIndex={idx} />
                  <SkeletonBlock variant="field" staggerIndex={idx + 1} />
                </div>
              ))}
            </div>
            <div className={styles.detailFooter} aria-hidden="true">
              <SkeletonBlock variant="text" width={240} height={12} />
              <SkeletonBlock variant="pill" width={126} height={40} radius={20} staggerIndex={1} />
            </div>
          </div>
        ) : (
        <div className={styles.detailCard}>
          <div className={styles.detailHeader}>
            <div>
              <span className={styles.pageEyebrow}>QUOTA &amp; QUEUE POLICY</span>
              <h2>共享额度与并发队列设置</h2>
            </div>
            <span className={styles.summaryPill}>按北京时间（Asia/Shanghai）日切</span>
          </div>
          <div className={styles.formGrid}>
            <label className={styles.filledField}>
              <span>默认日任务额度（留空关闭共享；-1 无限；0 禁止）</span>
              <input type="number" defaultValue={MOCK_ADMIN_SETTINGS.defaultDailyLimit ?? ''} />
            </label>
            <label className={styles.filledField}>
              <span>全站总并发（1–32）</span>
              <input type="number" defaultValue={MOCK_ADMIN_SETTINGS.globalConcurrency} />
            </label>
            <label className={styles.filledField}>
              <span>单人并发上限（1–32）</span>
              <input type="number" defaultValue={MOCK_ADMIN_SETTINGS.perUserConcurrency} />
            </label>
            <label className={styles.filledField}>
              <span>排队队列上限（1–10000）</span>
              <input type="number" defaultValue={MOCK_ADMIN_SETTINGS.queueLimit} />
            </label>
          </div>
          <div className={styles.detailFooter}>
            <span className={styles.monoMeta}>任务失败会自动退回原提交日额度；删除终态任务不退额。</span>
            <RippleButton
              type="button"
              className={styles.primaryBtn}
              onClick={() =>
                onNotify({ tone: 'success', message: '已模拟保存全站并发与额度策略。' })
              }
            >
              <Icon name="check" size={15} />
              <span>保存全站配置</span>
            </RippleButton>
          </div>
        </div>
        )
      ) : null}

      {adminTab === 'templates' ? (
        isAdminLoading ? (
          <div className={styles.splitWorkspace} role="status" aria-busy="true" aria-label="正在加载参数模板">
            <section className={styles.masterRail} aria-hidden="true">
              <div className={styles.masterHead}>
                <SkeletonBlock variant="text" width={88} height={14} />
                <SkeletonBlock variant="pill" width={36} height={16} />
              </div>
              <div className={styles.channelCardStack}>
                {Array.from({ length: 3 }, (_, idx) => (
                  <div key={idx} className={styles.channelItemCard}>
                    <div className={styles.channelItemTop}>
                      <SkeletonBlock variant="text" width="62%" height={14} staggerIndex={idx} />
                      <SkeletonBlock variant="rect" width={48} height={18} radius={6} staggerIndex={idx + 1} />
                    </div>
                    <SkeletonBlock variant="text" width="88%" height={11} staggerIndex={idx + 2} />
                  </div>
                ))}
              </div>
            </section>
            <section className={styles.detailCard} aria-hidden="true">
              <div className={styles.skeletonListStack} style={{ gap: 6 }}>
                <SkeletonBlock variant="text" width={124} height={11} />
                <SkeletonBlock variant="text" width={230} height={22} staggerIndex={1} />
              </div>
              <div className={styles.filledField}>
                <SkeletonBlock variant="text" width={64} height={12} />
                <SkeletonBlock variant="field" />
              </div>
              <div className={styles.filledField}>
                <SkeletonBlock variant="text" width={82} height={12} />
                <ConnectedRatioSkeleton />
              </div>
              <div className={styles.formGrid}>
                <div className={styles.filledField}>
                  <SkeletonBlock variant="text" width={64} height={12} />
                  <SkeletonBlock variant="pill" width="100%" height={38} radius={19} staggerIndex={1} />
                </div>
                <div className={styles.filledField}>
                  <SkeletonBlock variant="text" width={64} height={12} />
                  <SkeletonBlock variant="pill" width="100%" height={38} radius={19} staggerIndex={2} />
                </div>
              </div>
              <div className={styles.filledField}>
                <SkeletonBlock variant="text" width={64} height={12} />
                <SkeletonBlock variant="pill" width="100%" height={44} radius={22} staggerIndex={3} />
              </div>
              <div className={styles.detailFooter}>
                <span />
                <SkeletonBlock variant="pill" width={110} height={40} radius={20} staggerIndex={2} />
              </div>
            </section>
          </div>
        ) : (
        <div className={styles.splitWorkspace}>
          <section className={styles.masterRail}>
            <div className={styles.masterHead}>
              <strong>参数模板列表</strong>
              <span>{MOCK_TEMPLATES.length} 个</span>
            </div>
            <div className={styles.channelCardStack}>
              {MOCK_TEMPLATES.map((t) => (
                <div key={t.id} className={styles.channelItemCard}>
                  <div className={styles.channelItemTop}>
                    <strong>{t.name}</strong>
                    <span className={styles.protoTag}>
                      {t.provider === 'openai-compatible' ? 'OpenAI' : 'Gemini'}
                    </span>
                  </div>
                  <span className={styles.monoMeta}>{JSON.stringify(t.params)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.detailCard}>
            <div className={styles.detailHeader}>
              <div>
                <span className={styles.pageEyebrow}>TEMPLATE BUILDER</span>
                <h2>编辑预设模板（仅预填，不覆盖模型）</h2>
              </div>
            </div>
            <div className={styles.formGrid}>
              <label className={`${styles.filledField} ${styles.fullSpan}`}>
                <span>模板名称</span>
                <input defaultValue="建筑摄影 · 16:9 高清" />
              </label>
            </div>
            <div className={styles.filledField}>
              <span>画面比例预设</span>
              <RatioTileSelector value={tplRatio} onChange={setTplRatio} />
            </div>
            <div className={styles.formGrid}>
              <div className={styles.filledField}>
                <span>画质档位</span>
                <SegmentedRail
                  label="画质"
                  value={tplQuality}
                  options={[
                    { value: 'auto', label: '自动' },
                    { value: 'medium', label: '标准' },
                    { value: 'high', label: '高' },
                    { value: 'max', label: '极致' },
                  ]}
                  onChange={setTplQuality}
                />
              </div>
              <div className={styles.filledField}>
                <span>默认数量</span>
                <CountStepper value={tplCount} onChange={setTplCount} />
              </div>
            </div>
            <div className={styles.filledField}>
              <span>输出格式</span>
              <StudioSelect
                label="输出格式"
                value={tplFormat}
                options={[
                  { value: 'png', label: 'PNG' },
                  { value: 'jpeg', label: 'JPEG' },
                  { value: 'webp', label: 'WebP' },
                ]}
                onChange={setTplFormat}
              />
            </div>
            <div className={styles.detailFooter}>
              <span />
              <RippleButton
                type="button"
                className={styles.primaryBtn}
                onClick={() =>
                  onNotify({ tone: 'success', message: '已模拟保存参数模板。' })
                }
              >
                <Icon name="check" size={15} />
                <span>保存模板</span>
              </RippleButton>
            </div>
          </section>
        </div>
        )
      ) : null}

      {adminTab === 'usage' ? (
        <div className={styles.adminSection} aria-busy={showUsageSkeleton}>
          {showUsageSkeleton ? (
            <>
              <div className={styles.kpiRow} role="status" aria-label="正在加载统计指标">
                {Array.from({ length: 3 }, (_, idx) => (
                  <div key={idx} className={styles.kpiCard} aria-hidden="true">
                    <SkeletonBlock variant="text" width={72} height={12} staggerIndex={idx} />
                    <SkeletonBlock variant="pill" width={68} height={30} radius={12} staggerIndex={idx + 1} />
                    <SkeletonBlock variant="text" width={104} height={11} staggerIndex={idx + 2} />
                  </div>
                ))}
              </div>

              <div className={styles.detailCard} aria-hidden="true">
                <div className={styles.detailHeader}>
                  <div className={styles.skeletonListStack} style={{ gap: 6 }}>
                    <SkeletonBlock variant="text" width={136} height={11} />
                    <SkeletonBlock variant="text" width={240} height={22} staggerIndex={1} />
                  </div>
                  <SkeletonBlock variant="pill" width={104} height={40} radius={20} />
                </div>
                <div className={styles.skeletonListStack} style={{ gap: 10 }}>
                  <SkeletonBlock variant="rect" width="100%" height={36} radius={10} />
                  {Array.from({ length: 4 }, (_, idx) => (
                    <div key={idx} className={styles.skeletonBetween} style={{ padding: '6px 4px' }}>
                      <SkeletonBlock variant="text" width="22%" height={13} staggerIndex={idx} />
                      <SkeletonBlock variant="text" width="16%" height={13} staggerIndex={idx + 1} />
                      <SkeletonBlock variant="text" width="24%" height={13} staggerIndex={idx + 2} />
                      <SkeletonBlock variant="pill" width={68} height={22} staggerIndex={idx + 1} />
                      <SkeletonBlock variant="text" width="18%" height={12} staggerIndex={idx + 3} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className={styles.kpiRow}>
                <div className={styles.kpiCard}>
                  <span>总任务计数</span>
                  <strong>115</strong>
                  <small>含历史所有终态任务</small>
                </div>
                <div className={styles.kpiCard}>
                  <span>成功任务</span>
                  <strong>107</strong>
                  <small>整体成功率 93.0%</small>
                </div>
                <div className={styles.kpiCard}>
                  <span>当前活跃队列</span>
                  <strong>1</strong>
                  <small>上限 {MOCK_ADMIN_SETTINGS.queueLimit} 条</small>
                </div>
              </div>

              <div className={styles.detailCard}>
                <div className={styles.detailHeader}>
                  <div>
                    <span className={styles.pageEyebrow}>NON-PRIVATE TELEMETRY</span>
                    <h2>渠道与最近任务状态（不含提示词或图片）</h2>
                  </div>
                  <RippleButton
                    type="button"
                    className={styles.tonalBtn}
                    onClick={() => {
                      if (usageTimerRef.current !== null) window.clearTimeout(usageTimerRef.current)
                      setIsRefreshingUsage(true)
                      usageTimerRef.current = window.setTimeout(() => {
                        setIsRefreshingUsage(false)
                        onNotify({ tone: 'info', message: '已模拟刷新站点使用统计。' })
                      }, 850)
                    }}
                  >
                    <Icon name="loader" size={14} />
                    <span>刷新统计</span>
                  </RippleButton>
                </div>
                <div className={styles.tableWrap} data-no-swipe="true">
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>任务 ID</th>
                        <th>用户</th>
                        <th>渠道</th>
                        <th>状态</th>
                        <th>创建时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MOCK_ADMIN_USAGE.tasks.map((task) => (
                        <tr key={task.id}>
                          <td><code>{task.id}</code></td>
                          <td>{task.username}</td>
                          <td>{task.channelId}</td>
                          <td>
                            <span
                              className={
                                task.status === 'succeeded'
                                  ? styles.statusOn
                                  : task.status === 'running'
                                    ? styles.statusRunningChip
                                    : styles.statusOff
                              }
                            >
                              {task.status}
                            </span>
                          </td>
                          <td>{task.createdAt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
      </div>
    </div>
  )
}
