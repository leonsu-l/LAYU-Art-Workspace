import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { OpenAIImageParams, ProviderType } from '@nanobanana/shared/types/generation'
import type { Template } from '@nanobanana/shared/types/studio'
import { Icon } from '../../components/Icon'
import {
  ChannelModelBar,
  CountStepper,
  M3PrimaryTabs,
  M3SplitGenerateButton,
  RatioTileSelector,
  SegmentedRail,
  StudioSelect,
} from '../components/LabControls'
import {
  ConnectedRatioSkeleton,
  ShimmerImage,
  SkeletonBlock,
  SplitCtaSkeleton,
} from '../components/LabSkeleton'
import type { SnackbarPayload } from '../components/useSnackbar'
import {
  MOCK_ARTWORKS,
  MOCK_CATALOG_BY_CHANNEL,
  MOCK_CHANNELS,
  MOCK_PROMPT_PRESETS,
  MOCK_QUOTA,
  MOCK_TASKS,
  MOCK_TEMPLATES,
} from '../mockData'
import {
  AccountPrototype,
  AdminPrototype,
  ChannelsPrototype,
  GalleryPrototype,
  type LabLoadMode,
  type LabPageRoute,
} from './MultiPagePrototypes'
import styles from './WorkbenchPrototypes.module.css'

export type { LabLoadMode, LabPageRoute }
export type LabScenario =
  | 'succeeded'
  | 'multi'
  | 'generating'
  | 'loading'
  | 'blocker'
  | 'recovery'
  | 'empty'

export interface LabPageTransition {
  fromPage: LabPageRoute
  dir: 1 | -1
  enterOffsetX: number
  key: number
}

interface WorkbenchPrototypeProps {
  activePage: LabPageRoute
  pageTransition?: LabPageTransition | null
  scenario: LabScenario
  loadMode?: LabLoadMode
  viewportMode: 'desktop' | 'mobile'
  onPageChange: (page: LabPageRoute, enterOffsetX?: number) => void
  onScenarioChange: (scenario: LabScenario) => void
  onNotify: (payload: SnackbarPayload) => void
}

const SIZE_TO_RATIO: Record<string, string> = {
  auto: 'auto',
  '1024x1024': '1:1',
  '1536x1024': '4:3',
  '1024x1536': '3:4',
  '1792x1024': '16:9',
  '1024x1792': '9:16',
}

const RATIO_TO_SIZE: Record<string, string> = {
  auto: 'auto',
  '1:1': '1024x1024',
  '4:3': '1536x1024',
  '3:4': '1024x1536',
  '16:9': '1792x1024',
  '9:16': '1024x1792',
}

const NAV_ROUTES: ReadonlyArray<{ id: LabPageRoute; label: string }> = [
  { id: 'workbench', label: '创作工作台' },
  { id: 'gallery', label: '我的图库' },
  { id: 'channels', label: '自定义渠道' },
  { id: 'account', label: '账号安全' },
  { id: 'admin', label: '站点管理' },
]

export function WorkbenchPrototype({
  activePage,
  pageTransition = null,
  scenario,
  loadMode = 'ready',
  viewportMode,
  onPageChange,
  onScenarioChange,
  onNotify,
}: WorkbenchPrototypeProps) {
  const [channelId, setChannelId] = useState(MOCK_CHANNELS[0].id)
  const [provider, setProvider] = useState<ProviderType>('openai-compatible')
  const [model, setModel] = useState('gpt-image-2.5-flare')
  const [prompt, setPrompt] = useState(MOCK_PROMPT_PRESETS[0].prompt)
  const [hasRefImage, setHasRefImage] = useState(scenario === 'multi')
  const [ratio, setRatio] = useState('4:3')
  const [quality, setQuality] = useState<OpenAIImageParams['quality']>('high')
  const [count, setCount] = useState(scenario === 'multi' ? 4 : 1)
  const [format, setFormat] = useState<OpenAIImageParams['outputFormat']>('png')
  const [background, setBackground] = useState<OpenAIImageParams['background']>('auto')
  const [geminiSize, setGeminiSize] = useState<'1K' | '2K' | '4K'>('2K')
  const [imageOnly, setImageOnly] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState(MOCK_TASKS[0].id)

  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches,
  )
  const [dragState, setDragState] = useState<{
    active: boolean
    dragX: number
    containerWidth: number
    settlingPeekDir: -1 | 0 | 1
  }>({ active: false, dragX: 0, containerWidth: 390, settlingPeekDir: 0 })

  const viewportRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<{
    pointerId: number | null
    startX: number
    startY: number
    startTime: number
    locked: 'none' | 'horizontal' | 'vertical'
    lastDx: number
  }>({ pointerId: null, startX: 0, startY: 0, startTime: 0, locked: 'none', lastDx: 0 })
  const suppressClickRef = useRef(false)
  const settleTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 760px)')
    const onChange = (event: MediaQueryListEvent) => setIsNarrowViewport(event.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    return () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    }
  }, [])

  const effectiveChannelId = scenario === 'blocker' ? '' : channelId
  const effectiveModel = scenario === 'blocker' ? '' : model
  const catalog = effectiveChannelId ? MOCK_CATALOG_BY_CHANNEL[effectiveChannelId] ?? null : null
  const activeChannel = MOCK_CHANNELS.find((c) => c.id === effectiveChannelId)
  const matchingTemplates = MOCK_TEMPLATES.filter((t) => t.provider === provider)

  const canSubmit =
    scenario !== 'blocker' &&
    scenario !== 'recovery' &&
    scenario !== 'generating' &&
    Boolean(effectiveChannelId) &&
    Boolean(effectiveModel) &&
    prompt.trim().length > 0

  function applyTemplate(tpl: Template) {
    if (tpl.params.size) setRatio(SIZE_TO_RATIO[tpl.params.size] ?? '1:1')
    if (tpl.params.aspectRatio) setRatio(tpl.params.aspectRatio)
    if (tpl.params.quality) setQuality(tpl.params.quality)
    if (tpl.params.n) setCount(tpl.params.n)
    if (tpl.params.outputFormat) setFormat(tpl.params.outputFormat)
    if (tpl.params.imageSize && (tpl.params.imageSize === '1K' || tpl.params.imageSize === '2K' || tpl.params.imageSize === '4K')) {
      setGeminiSize(tpl.params.imageSize)
    }
    onNotify({
      tone: 'success',
      message: `已套用预设模板「${tpl.name}」（仅预填参数，不覆盖当前模型）`,
    })
  }

  function renderAlertStrip() {
    if (scenario === 'recovery') {
      return (
        <div className={styles.recoveryAlert} role="alert">
          <div className={styles.recoveryAlertHead}>
            <Icon name="alert-circle" size={16} />
            <strong>存在未确认提交（防重复扣费保护）</strong>
          </div>
          <p>
            断线前提交的任务 <code>9f4a81d2-7b30-4e92</code> 尚未确认接收，重试仅使用同一 ID。
          </p>
          <div className={styles.recoveryActions}>
            <button
              type="button"
              className={styles.recoveryBtnPrimary}
              onClick={() => {
                onScenarioChange('generating')
                onNotify({
                  tone: 'info',
                  message: '已沿用原幂等提交 ID 发起恢复重试（不重复扣费）。',
                })
              }}
            >
              恢复 / 重试同一请求
            </button>
            <button
              type="button"
              className={styles.recoveryBtnTonal}
              onClick={() => {
                onScenarioChange('succeeded')
                onNotify({
                  tone: 'success',
                  message: '已同步后端最新任务状态，画布恢复就绪。',
                })
              }}
            >
              刷新状态
            </button>
          </div>
        </div>
      )
    }
    if (scenario === 'blocker') {
      return (
        <div className={styles.blockerAlert} role="status">
          <Icon name="settings" size={16} />
          <span>尚未选择可用渠道与模型，请点击上方渠道卡片完成选择。</span>
        </div>
      )
    }
    return null
  }

  function renderStageCanvas() {
    const activeImages =
      scenario === 'multi'
        ? [
            { src: MOCK_ARTWORKS.frame1, label: 'FRAME 01', size: '1024 × 1024' },
            { src: MOCK_ARTWORKS.frame2, label: 'FRAME 02', size: '1024 × 1024' },
            { src: MOCK_ARTWORKS.frame3, label: 'FRAME 03', size: '1024 × 1024' },
            { src: MOCK_ARTWORKS.frame4, label: 'FRAME 04', size: '1024 × 1024' },
          ]
        : scenario === 'succeeded' || scenario === 'recovery'
          ? [{ src: MOCK_ARTWORKS.single, label: 'FRAME 01', size: '1536 × 1024' }]
          : []

    return (
      <div className={styles.stageCard}>
        <div className={styles.stageBar}>
          <div className={styles.stageBarLeft}>
            <span
              className={`${styles.statusBadge} ${
                scenario === 'generating'
                  ? styles.statusRunning
                  : scenario === 'recovery'
                    ? styles.statusWarn
                    : scenario === 'empty' || scenario === 'blocker'
                      ? styles.statusIdle
                      : styles.statusDone
              }`}
            >
              <span className={styles.statusDot} />
              {scenario === 'generating'
                ? '正在显影 · 2 张'
                : scenario === 'recovery'
                  ? '待确认恢复'
                  : scenario === 'empty'
                    ? '画布就绪'
                    : scenario === 'blocker'
                      ? '等待配置渠道'
                      : `已完成 · ${activeImages.length} 张`}
            </span>
            <span className={styles.stageMetaMono}>
              {effectiveModel || '未选模型'} · {ratio === 'auto' ? '自动比例' : ratio}
            </span>
          </div>

          {activeImages.length > 0 ? (
            <div className={styles.stageBarActions}>
              <button
                type="button"
                className={styles.stageTonalBtn}
                onClick={() =>
                  onNotify({ tone: 'info', message: `已模拟下载当前画布原图（${activeImages.length} 张）。` })
                }
              >
                <Icon name="download" size={14} />
                <span>下载原图</span>
              </button>
              <button
                type="button"
                className={styles.stageTextBtn}
                onClick={() => {
                  onScenarioChange('empty')
                  onNotify({ tone: 'info', message: '已清空当前预览画布。' })
                }}
              >
                <Icon name="close" size={14} />
                <span>清空</span>
              </button>
            </div>
          ) : null}
        </div>

        <div className={styles.stageBody}>
          {scenario === 'generating' ? (
            <div className={styles.generatingGrid}>
              {[1, 2].map((idx) => (
                <div key={idx} className={styles.developingCard}>
                  <div className={styles.developingShimmer} />
                  <div className={styles.developingLabel}>
                    <Icon name="loader" size={20} className={styles.spin} />
                    <strong>画面正在显影 {idx}/2</strong>
                    <span>后端持久队列执行中，刷新不丢失</span>
                  </div>
                </div>
              ))}
            </div>
          ) : scenario === 'empty' || scenario === 'blocker' ? (
            <div className={styles.emptyStage}>
              <span className={styles.emptyTag}>FRAME 00 · CONTACT SHEET</span>
              <h3>把脑海里的画面，变成作品</h3>
              <p>从下方挑一个创作灵感快速填入，或在左侧输入描述；多张结果将直接在这里对照显影。</p>
              <div className={styles.emptyStarterGrid}>
                {MOCK_PROMPT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={styles.starterCard}
                    onClick={() => {
                      setPrompt(preset.prompt)
                      if (scenario === 'empty') onScenarioChange('succeeded')
                    }}
                  >
                    <strong>{preset.label}</strong>
                    <span>{preset.prompt.slice(0, 32)}…</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className={activeImages.length > 1 ? styles.multiGrid : styles.singleLightbox}>
              {activeImages.map((img, idx) => (
                <figure key={img.label} className={styles.artworkFigure}>
                  <ShimmerImage
                    src={img.src}
                    alt={img.label}
                    aspectRatio="4 / 3"
                    iconSize={26}
                    staggerIndex={idx}
                  />
                  <figcaption className={styles.artworkCaption}>
                    <span>{img.label}</span>
                    <span>{img.size}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>

        {/* Integrated Tonal Filmstrip */}
        <div className={styles.filmstripDock} aria-label="最近任务记录">
          <div className={styles.filmstripHead}>
            <span>任务胶卷</span>
            <span className={styles.filmstripCount}>{MOCK_TASKS.length} 条记录 · 点击切换画布</span>
          </div>
          <div className={styles.filmstripRow}>
            {MOCK_TASKS.map((task) => {
              const selected = task.id === selectedTaskId
              const thumb = task.result?.images[0]?.url
              return (
                <button
                  key={task.id}
                  type="button"
                  aria-pressed={selected}
                  className={`${styles.filmCard} ${selected ? styles.filmCardSelected : ''}`}
                  onClick={() => {
                    setSelectedTaskId(task.id)
                    if (task.status === 'running') {
                      onScenarioChange('generating')
                    } else if ((task.result?.images.length ?? 0) > 1) {
                      onScenarioChange('multi')
                    } else if (task.status === 'succeeded') {
                      onScenarioChange('succeeded')
                    } else if (task.status === 'failed') {
                      onNotify({
                        tone: 'warning',
                        message: task.error
                          ? `任务失败（${task.error.code}）：${task.error.message}，原提交日额度已自动退回。`
                          : '该任务生成失败，已自动退回原提交日额度。',
                      })
                    }
                  }}
                >
                  <span className={styles.filmThumb}>
                    {thumb ? (
                      <ShimmerImage src={thumb} alt="" aspectRatio="1 / 1" iconSize={14} />
                    ) : (
                      <Icon
                        name={task.status === 'running' ? 'loader' : 'alert-circle'}
                        size={16}
                        className={task.status === 'running' ? styles.spin : ''}
                      />
                    )}
                  </span>
                  <span className={styles.filmMeta}>
                    <strong data-status={task.status}>
                      {task.status === 'succeeded'
                        ? '已完成'
                        : task.status === 'running'
                          ? '生成中'
                          : '失败'}
                    </strong>
                    <span>{task.prompt}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  function renderParamControls() {
    return (
      <div className={styles.paramStack}>
        <div className={styles.fieldGroup}>
          <div className={styles.fieldHead}>
            <span className={styles.fieldTitle}>画面比例</span>
            <span className={styles.fieldMeta}>{ratio === 'auto' ? '模型自动' : RATIO_TO_SIZE[ratio] ?? ratio}</span>
          </div>
          <RatioTileSelector value={ratio} onChange={setRatio} />
        </div>

        <div className={styles.twoCol}>
          {provider === 'openai-compatible' ? (
            <div className={styles.fieldGroup}>
              <span className={styles.fieldTitle}>画质档位</span>
              <SegmentedRail
                label="画质档位"
                value={quality}
                options={[
                  { value: 'auto', label: '自动' },
                  { value: 'medium', label: '标准' },
                  { value: 'high', label: '高' },
                  { value: 'max', label: '极致' },
                ]}
                onChange={setQuality}
              />
            </div>
          ) : (
            <div className={styles.fieldGroup}>
              <span className={styles.fieldTitle}>输出分辨率</span>
              <SegmentedRail
                label="输出分辨率"
                value={geminiSize}
                options={[
                  { value: '1K', label: '1K' },
                  { value: '2K', label: '2K' },
                  { value: '4K', label: '4K' },
                ]}
                onChange={setGeminiSize}
              />
            </div>
          )}

          {provider === 'openai-compatible' ? (
            <div className={styles.fieldGroup}>
              <span className={styles.fieldTitle}>生成数量</span>
              <CountStepper value={count} onChange={setCount} />
            </div>
          ) : (
            <div className={styles.fieldGroup}>
              <span className={styles.fieldTitle}>输出模式</span>
              <button
                type="button"
                aria-pressed={imageOnly}
                className={`${styles.toggleChip} ${imageOnly ? styles.toggleChipActive : ''}`}
                onClick={() => setImageOnly((v) => !v)}
              >
                <Icon name={imageOnly ? 'check' : 'image'} size={15} />
                <span>{imageOnly ? '仅输出图片' : '图文混合'}</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className={styles.advancedToggle}
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <span>高级参数（输出格式 · 背景 · 审核）</span>
          <Icon name="chevron-down" size={16} className={showAdvanced ? styles.rotated : ''} />
        </button>

        {showAdvanced ? (
          <div className={styles.advancedPanel}>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldTitle}>输出格式</span>
              <StudioSelect
                label="输出格式"
                value={format}
                options={[
                  { value: 'png', label: 'PNG（无损）' },
                  { value: 'jpeg', label: 'JPEG' },
                  { value: 'webp', label: 'WebP' },
                ]}
                onChange={setFormat}
              />
            </div>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldTitle}>背景</span>
              <StudioSelect
                label="背景"
                value={background}
                options={[
                  { value: 'auto', label: '自动' },
                  { value: 'opaque', label: '不透明' },
                  ...(format !== 'jpeg' ? [{ value: 'transparent' as const, label: '透明' }] : []),
                ]}
                onChange={setBackground}
              />
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  const activeIdx = Math.max(
    0,
    NAV_ROUTES.findIndex((r) => r.id === activePage),
  )
  const isSwipeEnabled = viewportMode === 'mobile' || isNarrowViewport
  const swipeProgress =
    dragState.active && dragState.containerWidth > 0
      ? -dragState.dragX / dragState.containerWidth
      : 0

  const peekDirection: -1 | 0 | 1 = dragState.active
    ? dragState.dragX < 0
      ? 1
      : dragState.dragX > 0
        ? -1
        : 0
    : dragState.settlingPeekDir
  const peekIdx = peekDirection !== 0 ? activeIdx + peekDirection : -1
  const peekPage =
    peekIdx >= 0 && peekIdx < NAV_ROUTES.length ? NAV_ROUTES[peekIdx].id : null

  function clearDrag(withSettleDir: -1 | 0 | 1 = 0) {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
    setDragState({
      active: false,
      dragX: 0,
      containerWidth: viewportRef.current?.clientWidth || 390,
      settlingPeekDir: withSettleDir,
    })
    if (withSettleDir !== 0) {
      settleTimerRef.current = window.setTimeout(() => {
        setDragState((prev) => ({ ...prev, settlingPeekDir: 0 }))
      }, 250)
    }
  }

  function handleTabSwitch(nextPage: LabPageRoute) {
    clearDrag(0)
    onPageChange(nextPage, 0)
  }

  function handlePagerPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isSwipeEnabled && event.pointerType !== 'touch') return
    if (event.pointerType === 'mouse' && event.button !== 0) return

    const target = event.target
    if (
      target instanceof Element &&
      target.closest(
        'input, textarea, select, option, [contenteditable="true"], [role="dialog"], [role="listbox"], [data-no-swipe="true"]',
      )
    ) {
      return
    }

    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: performance.now(),
      locked: 'none',
      lastDx: 0,
    }
  }

  function handlePagerPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gestureRef.current
    if (g.pointerId !== event.pointerId) return

    const dx = event.clientX - g.startX
    const dy = event.clientY - g.startY

    if (g.locked === 'none') {
      if (Math.hypot(dx, dy) < 10) return
      if (Math.abs(dy) >= Math.abs(dx) * 0.92) {
        g.locked = 'vertical'
        return
      }
      g.locked = 'horizontal'
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Ignore if pointer capture is unavailable in synthetic test environments
      }
    }

    if (g.locked !== 'horizontal') return

    const width = viewportRef.current?.clientWidth || 390
    let effectiveDx = dx
    if ((activeIdx === 0 && dx > 0) || (activeIdx === NAV_ROUTES.length - 1 && dx < 0)) {
      effectiveDx = dx * 0.25
    }
    effectiveDx = Math.max(-width, Math.min(width, effectiveDx))
    g.lastDx = effectiveDx

    setDragState({
      active: true,
      dragX: effectiveDx,
      containerWidth: width,
      settlingPeekDir: 0,
    })
  }

  function handlePagerPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const g = gestureRef.current
    if (g.pointerId !== event.pointerId) return

    const wasHorizontal = g.locked === 'horizontal'
    const dx = g.lastDx
    const dt = Math.max(performance.now() - g.startTime, 16)
    const vx = dx / dt
    g.pointerId = null
    g.locked = 'none'

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Safe cleanup guard
      }
    }

    if (!wasHorizontal) return

    suppressClickRef.current = true
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 80)

    const width = viewportRef.current?.clientWidth || 390
    const committed =
      Math.abs(dx) > width * 0.22 || (Math.abs(dx) > 40 && Math.abs(vx) > 0.32)

    if (committed && dx < 0 && activeIdx < NAV_ROUTES.length - 1) {
      clearDrag(0)
      onPageChange(NAV_ROUTES[activeIdx + 1].id, dx)
      return
    }
    if (committed && dx > 0 && activeIdx > 0) {
      clearDrag(0)
      onPageChange(NAV_ROUTES[activeIdx - 1].id, dx)
      return
    }

    clearDrag(dx < 0 ? 1 : dx > 0 ? -1 : 0)
  }

  function renderPageBody(pageId: LabPageRoute) {
    if (pageId === 'workbench') {
      if (scenario === 'loading') {
        return (
          <div className={styles.proLayout} role="status" aria-busy="true" aria-label="正在加载工作台">
            <aside className={styles.proRail} aria-hidden="true">
              <div className={styles.proRailScroll}>
                <div className={styles.skeletonRailCard}>
                  <SkeletonBlock
                    variant="rect"
                    width={34}
                    height={34}
                    radius="var(--md-sys-shape-corner-medium)"
                  />
                  <div className={styles.skeletonCol}>
                    <SkeletonBlock variant="text" width="46%" height={11} />
                    <SkeletonBlock variant="text" width="76%" height={14} staggerIndex={1} />
                  </div>
                  <SkeletonBlock variant="pill" width={62} height={24} staggerIndex={2} />
                </div>

                <div className={styles.promptCard}>
                  <div className={styles.fieldHead}>
                    <SkeletonBlock variant="text" width={64} height={13} />
                    <SkeletonBlock variant="text" width={48} height={11} staggerIndex={1} />
                  </div>
                  <SkeletonBlock
                    variant="field"
                    height={104}
                    radius="var(--md-sys-shape-corner-large) var(--md-sys-shape-corner-large) var(--md-sys-shape-corner-extra-small) var(--md-sys-shape-corner-extra-small)"
                    staggerIndex={1}
                  />
                  <div className={styles.skeletonBetween}>
                    <SkeletonBlock variant="rect" width={82} height={30} radius="var(--md-sys-shape-corner-small)" />
                    <div className={styles.skeletonRow}>
                      <SkeletonBlock variant="rect" width={88} height={28} radius="var(--md-sys-shape-corner-small)" staggerIndex={1} />
                      <SkeletonBlock variant="rect" width={88} height={28} radius="var(--md-sys-shape-corner-small)" staggerIndex={2} />
                    </div>
                  </div>
                </div>

                <div className={styles.paramStack}>
                  <div className={styles.fieldGroup}>
                    <div className={styles.fieldHead}>
                      <SkeletonBlock variant="text" width={64} height={13} />
                      <SkeletonBlock variant="text" width={58} height={11} staggerIndex={1} />
                    </div>
                    <ConnectedRatioSkeleton />
                  </div>

                  <div className={styles.twoCol}>
                    <div className={styles.fieldGroup}>
                      <SkeletonBlock variant="text" width={58} height={13} />
                      <SkeletonBlock variant="pill" width="100%" height={38} radius={19} staggerIndex={1} />
                    </div>
                    <div className={styles.fieldGroup}>
                      <SkeletonBlock variant="text" width={58} height={13} />
                      <SkeletonBlock variant="pill" width="100%" height={38} radius={19} staggerIndex={2} />
                    </div>
                  </div>

                  <SkeletonBlock
                    variant="rect"
                    width="100%"
                    height={36}
                    radius="var(--md-sys-shape-corner-medium)"
                    staggerIndex={2}
                  />
                </div>
              </div>

              <footer className={styles.proRailFooter}>
                <div className={styles.skeletonBetween}>
                  <SkeletonBlock variant="text" width={148} height={12} />
                  <SkeletonBlock variant="rect" width={34} height={20} radius={4} staggerIndex={1} />
                </div>
                <SplitCtaSkeleton />
              </footer>
            </aside>

            <section className={styles.proStage} aria-hidden="true">
              <div className={styles.stageCard}>
                <div className={styles.stageBar}>
                  <div className={styles.stageBarLeft}>
                    <SkeletonBlock variant="pill" width={104} height={28} />
                    <SkeletonBlock variant="text" width={142} height={12} staggerIndex={1} />
                  </div>
                  <div className={styles.stageBarActions}>
                    <SkeletonBlock variant="pill" width={92} height={32} staggerIndex={1} />
                    <SkeletonBlock variant="pill" width={62} height={32} staggerIndex={2} />
                  </div>
                </div>

                <div className={styles.stageBody}>
                  <div className={styles.singleLightbox}>
                    <div className={styles.artworkFigure}>
                      <SkeletonBlock
                        variant="media"
                        aspectRatio="4 / 3"
                        radius={0}
                        icon="sparkles"
                        iconSize={26}
                      />
                      <div className={styles.artworkCaption}>
                        <SkeletonBlock variant="text" width={68} height={11} />
                        <SkeletonBlock variant="text" width={76} height={11} staggerIndex={1} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.filmstripDock}>
                  <div className={styles.filmstripHead}>
                    <SkeletonBlock variant="text" width={56} height={12} />
                    <SkeletonBlock variant="text" width={132} height={12} staggerIndex={1} />
                  </div>
                  <div className={styles.filmstripRow}>
                    {Array.from({ length: 4 }, (_, idx) => (
                      <div key={idx} className={styles.filmCard}>
                        <span className={styles.filmThumb}>
                          <SkeletonBlock
                            variant="rect"
                            width={38}
                            height={38}
                            radius="var(--md-sys-shape-corner-small)"
                            staggerIndex={idx}
                          />
                        </span>
                        <span className={styles.filmMeta}>
                          <SkeletonBlock variant="text" width={42} height={11} staggerIndex={idx} />
                          <SkeletonBlock variant="text" width="88%" height={11} staggerIndex={idx + 1} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )
      }

      return (
        <div className={styles.proLayout}>
          <aside className={styles.proRail}>
            <div className={styles.proRailScroll}>
              <ChannelModelBar
                channels={MOCK_CHANNELS}
                channelId={effectiveChannelId}
                provider={provider}
                model={effectiveModel}
                catalog={catalog}
                templates={MOCK_TEMPLATES}
                quota={MOCK_QUOTA}
                onChannelChange={setChannelId}
                onProviderChange={setProvider}
                onModelChange={setModel}
                onApplyTemplate={applyTemplate}
              />

              {renderAlertStrip()}

              <div className={styles.promptCard}>
                <div className={styles.fieldHead}>
                  <span className={styles.fieldTitle}>画面描述</span>
                  <span className={styles.fieldMeta}>{prompt.trim().length} / 4000</span>
                </div>
                <textarea
                  className={styles.promptTextarea}
                  rows={4}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述主体、光线、材质与构图…"
                />
                <div className={styles.promptToolbar}>
                  <button
                    type="button"
                    aria-pressed={hasRefImage}
                    className={`${styles.refAttachBtn} ${hasRefImage ? styles.refAttachActive : ''}`}
                    onClick={() => setHasRefImage((v) => !v)}
                  >
                    <Icon name="image" size={14} />
                    <span>{hasRefImage ? '已附 1 张参考图' : '+ 参考图'}</span>
                  </button>
                  <div className={styles.presetMiniRow}>
                    {MOCK_PROMPT_PRESETS.slice(0, 2).map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className={styles.presetChip}
                        onClick={() => setPrompt(p.prompt)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                {hasRefImage ? (
                  <div className={styles.refMiniStrip}>
                    <ShimmerImage
                      src={MOCK_ARTWORKS.single}
                      alt="参考图预览"
                      aspectRatio="1 / 1"
                      radius="var(--md-sys-shape-corner-small)"
                      iconSize={14}
                      wrapperClassName={styles.refMiniThumb}
                    />
                    <div>
                      <strong>reference-still-life.webp</strong>
                      <span>图生图模式 · 1 / 16 张</span>
                    </div>
                    <button type="button" onClick={() => setHasRefImage(false)} aria-label="移除参考图">
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ) : null}
              </div>

              {renderParamControls()}
            </div>

            <footer className={styles.proRailFooter}>
              <div className={styles.readinessLine}>
                {scenario === 'blocker' ? (
                  <span className={styles.readinessErr}>请先在上方选择渠道和模型</span>
                ) : scenario === 'recovery' ? (
                  <span className={styles.readinessErr}>存在待确认提交，恢复前暂停新建</span>
                ) : (
                  <span className={styles.readinessOk}>
                    {activeChannel?.scope === 'shared' ? '就绪 · 将消耗 1 次共享额度' : '就绪 · 私有渠道直连'}
                  </span>
                )}
                <span className={styles.shortcutHint}>⌘ ↵</span>
              </div>
              <M3SplitGenerateButton
                label={scenario === 'generating' ? '正在显影…' : `生成图像 (${count})`}
                busy={scenario === 'generating'}
                disabled={!canSubmit}
                templates={matchingTemplates}
                onGenerate={() => {
                  onScenarioChange('generating')
                  onNotify({
                    tone: 'info',
                    message: `已提交生成队列（${count} 张），关闭页面仍会在后台继续完成。`,
                  })
                }}
                onApplyTemplate={applyTemplate}
              />
            </footer>
          </aside>

          <section className={styles.proStage}>
            {renderStageCanvas()}
          </section>
        </div>
      )
    }

    if (pageId === 'gallery') {
      return (
        <GalleryPrototype
          loadMode={loadMode}
          onGoWorkbench={() => handleTabSwitch('workbench')}
          onNotify={onNotify}
        />
      )
    }
    if (pageId === 'channels') {
      return <ChannelsPrototype scope="private" loadMode={loadMode} onNotify={onNotify} />
    }
    if (pageId === 'account') {
      return <AccountPrototype loadMode={loadMode} onNotify={onNotify} />
    }
    return <AdminPrototype loadMode={loadMode} onNotify={onNotify} />
  }

  return (
    <div className={`${styles.frame} ${viewportMode === 'mobile' ? styles.frameMobile : ''}`}>
      {/* M3 Top App Bar + Desktop Primary Tabs */}
      <header className={styles.appHeader}>
        <button
          type="button"
          className={styles.appBrand}
          onClick={() => handleTabSwitch('workbench')}
        >
          <span className={styles.brandGlyph}>
            <Icon name="banana" size={19} />
          </span>
          <div className={styles.brandWordmark}>
            <strong>nanobanana</strong>
            <span className={styles.brandTag}>STUDIO</span>
          </div>
        </button>

        <div className={styles.desktopNavHost}>
          <M3PrimaryTabs
            inHeader
            variant="fixed"
            label="主栏目导航"
            value={activePage}
            items={NAV_ROUTES}
            swipeProgress={swipeProgress}
            onChange={handleTabSwitch}
          />
        </div>

        <div className={styles.appHeaderRight}>
          <button
            type="button"
            className={styles.userPill}
            onClick={() => handleTabSwitch('account')}
            title="查看账号安全与日额度"
          >
            leon · 今日 12/50
          </button>
        </div>
      </header>

      {/* Mobile Primary Tabs Row (Matches Play Points Baseline Tabs) */}
      <div className={styles.mobileTabsHost}>
        <M3PrimaryTabs
          variant="fixed"
          label="移动端主栏目导航"
          value={activePage}
          items={NAV_ROUTES}
          swipeProgress={swipeProgress}
          onChange={handleTabSwitch}
        />
      </div>

      {/* Swipeable Primary Stage (Phone horizontal drag + Desktop/Mobile click slide) */}
      <div
        ref={viewportRef}
        className={`${styles.pagerViewport} ${isSwipeEnabled ? styles.pagerViewportSwipeable : ''}`}
        onPointerDown={handlePagerPointerDown}
        onPointerMove={handlePagerPointerMove}
        onPointerUp={handlePagerPointerUp}
        onPointerCancel={handlePagerPointerUp}
        onClickCapture={(e) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            e.preventDefault()
            e.stopPropagation()
          }
        }}
      >
        <div className={styles.pagerStage}>
          {!dragState.active && pageTransition ? (
            <div
              key={`exit-${pageTransition.key}`}
              className={styles.pagerExitSlide}
              style={
                {
                  '--slide-dir': pageTransition.dir,
                  '--start-x': `${pageTransition.enterOffsetX}px`,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              {renderPageBody(pageTransition.fromPage)}
            </div>
          ) : null}

          <div
            key={`active-${activePage}`}
            className={
              dragState.active
                ? styles.pagerDraggingSlide
                : !dragState.active && pageTransition
                  ? styles.pagerEnterSlide
                  : styles.pagerIdleSlide
            }
            style={
              dragState.active
                ? { transform: `translate3d(${dragState.dragX}px, 0, 0)` }
                : !dragState.active && pageTransition
                  ? ({
                      '--slide-dir': pageTransition.dir,
                      '--start-x': `${pageTransition.enterOffsetX}px`,
                    } as CSSProperties)
                  : undefined
            }
          >
            {renderPageBody(activePage)}
          </div>

          {peekPage && !pageTransition ? (
            <div
              className={dragState.active ? styles.pagerPeekDragging : styles.pagerPeekSettling}
              style={{
                transform: `translate3d(calc(${peekDirection * 100}% + ${dragState.dragX}px), 0, 0)`,
              }}
              aria-hidden="true"
            >
              {renderPageBody(peekPage)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
