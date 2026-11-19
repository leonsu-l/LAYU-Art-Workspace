import { useEffect, useRef, useState } from 'react'
import type { ProviderType } from '@nanobanana/shared/types/generation'
import { Icon } from '../components/Icon'
import {
  ChannelModelBar,
  CountStepper,
  M3PrimaryTabs,
  M3SplitGenerateButton,
  RatioTileSelector,
  SegmentedRail,
  StudioSelect,
} from './components/LabControls'
import { RippleButton } from './components/LabRipple'
import {
  ConnectedRatioSkeleton,
  ShimmerImage,
  SkeletonBlock,
  SkeletonTextStack,
  SplitCtaSkeleton,
} from './components/LabSkeleton'
import { LabSnackbarHost } from './components/LabSnackbar'
import { useSnackbar } from './components/useSnackbar'
import {
  MOCK_ARTWORKS,
  MOCK_CATALOG_BY_CHANNEL,
  MOCK_CHANNELS,
  MOCK_QUOTA,
  MOCK_TEMPLATES,
} from './mockData'
import {
  WorkbenchPrototype,
  type LabLoadMode,
  type LabPageRoute,
  type LabPageTransition,
  type LabScenario,
} from './prototypes/WorkbenchPrototypes'
import tokenStyles from './tokens.module.css'
import styles from './DesignLabApp.module.css'

type LabTab = 'audit' | 'components' | 'prototypes' | 'decisions'

const ROUTE_ORDER: readonly LabPageRoute[] = ['workbench', 'gallery', 'channels', 'account', 'admin']

export function DesignLabApp() {
  const [tab, setTab] = useState<LabTab>('prototypes')
  const [activePage, setActivePage] = useState<LabPageRoute>('workbench')
  const [pageTransition, setPageTransition] = useState<LabPageTransition | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const [scenario, setScenario] = useState<LabScenario>('succeeded')
  const [loadMode, setLoadMode] = useState<LabLoadMode>('ready')
  const [sandboxSkeleton, setSandboxSkeleton] = useState(true)
  const [demoCatalogLoading, setDemoCatalogLoading] = useState(false)
  const [viewportMode, setViewportMode] = useState<'desktop' | 'mobile'>('desktop')

  // Interactive atom sandbox states
  const [demoChannelId, setDemoChannelId] = useState(MOCK_CHANNELS[0].id)
  const [demoProvider, setDemoProvider] = useState<ProviderType>('openai-compatible')
  const [demoModel, setDemoModel] = useState('gpt-image-2.5-flare')
  const [demoRatio, setDemoRatio] = useState('16:9')
  const [demoCount, setDemoCount] = useState(2)
  const [demoQuality, setDemoQuality] = useState('high')
  const [demoFormat, setDemoFormat] = useState('png')
  const [demoPrimaryTab, setDemoPrimaryTab] = useState<'earn' | 'use' | 'perks'>('perks')
  const {
    snackbar,
    showSnackbar,
    dismissSnackbar,
    pauseSnackbar,
    resumeSnackbar,
  } = useSnackbar()

  const transitionTimerRef = useRef<number | null>(null)
  const transitionSeqRef = useRef(0)
  const loadDemoTimerRef = useRef<number | null>(null)
  const sandboxDemoTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current)
      if (loadDemoTimerRef.current !== null) window.clearTimeout(loadDemoTimerRef.current)
      if (sandboxDemoTimerRef.current !== null) window.clearTimeout(sandboxDemoTimerRef.current)
    }
  }, [])

  function triggerPageLoadDemo() {
    if (loadDemoTimerRef.current !== null) window.clearTimeout(loadDemoTimerRef.current)
    if (activePage === 'workbench') {
      setScenario('loading')
      loadDemoTimerRef.current = window.setTimeout(() => {
        setScenario('succeeded')
      }, 1200)
    } else {
      setLoadMode('loading')
      loadDemoTimerRef.current = window.setTimeout(() => {
        setLoadMode('ready')
      }, 1200)
    }
  }

  function triggerSandboxLoadDemo() {
    if (sandboxDemoTimerRef.current !== null) window.clearTimeout(sandboxDemoTimerRef.current)
    setSandboxSkeleton(true)
    sandboxDemoTimerRef.current = window.setTimeout(() => {
      setSandboxSkeleton(false)
    }, 1200)
  }

  function handleNavigatePage(nextPage: LabPageRoute, enterOffsetX = 0) {
    if (nextPage === activePage) return
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current)
    }
    const prevIdx = ROUTE_ORDER.indexOf(activePage)
    const nextIdx = ROUTE_ORDER.indexOf(nextPage)
    transitionSeqRef.current += 1
    setPageTransition({
      fromPage: activePage,
      dir: nextIdx > prevIdx ? 1 : -1,
      enterOffsetX,
      key: transitionSeqRef.current,
    })
    if (nextPage !== 'gallery' && loadMode === 'media-loading') {
      setLoadMode('ready')
    }
    setActivePage(nextPage)
    transitionTimerRef.current = window.setTimeout(() => {
      setPageTransition(null)
    }, 340)
  }

  return (
    <div
      className={`${tokenStyles.scope} ${styles.labShell}`}
      data-lab-theme={theme}
    >
      {/* Top Design Lab M3 App Bar */}
      <header className={styles.labBar}>
        <div className={styles.labBrand}>
          <span className={styles.labBadge}>M3 EXPRESSIVE LAB</span>
          <div>
            <strong>NanoBanana Studio · 创意设计工作坊</strong>
            <span>已选定方向 A（钴蓝暗房） · 全站 5 页面 M3 Expressive 设计体系</span>
          </div>
        </div>

        <nav className={styles.labTabs} aria-label="设计工作流阶段">
          {(
            [
              { id: 'audit', label: '01 · M3 诊断与重构' },
              { id: 'components', label: '02 · 色调与变形组件' },
              { id: 'prototypes', label: '03 · 全站多页原型' },
              { id: 'decisions', label: '04 · 决策与集成路线' },
            ] as const
          ).map((item) => (
            <RippleButton
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              className={`${styles.labTab} ${tab === item.id ? styles.labTabActive : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </RippleButton>
          ))}
        </nav>

        <div className={styles.labToggles}>
          <span className={styles.selectedDirTag}>已选方向 A · 钴蓝暗房</span>

          <div className={styles.switchGroup} role="group" aria-label="主题模式">
            <RippleButton
              type="button"
              aria-pressed={theme === 'light'}
              onClick={() => setTheme('light')}
            >
              <Icon name="sun" size={14} />
              <span>浅色</span>
            </RippleButton>
            <RippleButton
              type="button"
              aria-pressed={theme === 'dark'}
              onClick={() => setTheme('dark')}
            >
              <Icon name="moon" size={14} />
              <span>深色</span>
            </RippleButton>
          </div>
        </div>
      </header>

      <main className={styles.labContent}>
        {tab === 'audit' ? (
          <section className={styles.sectionGrid}>
            <div className={styles.introCard}>
              <span className={styles.eyebrow}>MATERIAL 3 EXPRESSIVE REBUILD</span>
              <h1>不是“加圆角套胶囊”，也不是“细边框灰格子”</h1>
              <p>
                针对刚才指出的偏移与前版痛点，本轮按真正的 Material 3 Expressive 设计规范重构：用 5 级色调表面（Tonal Surface Elevation）替代 `1px` 线框堆砌，用连接式按钮组（Connected Button Groups）与选中变形（Shape Morphing）取代单调的同款圆角，并用 Primary / Secondary / Tertiary 三角角色色彩拉开明确主次。
              </p>
            </div>

            <div className={styles.auditGrid}>
              {[
                {
                  id: '01',
                  title: '色调表面阶梯（Tonal Surface Elevation）',
                  problem: '旧版和第一版 Lab 都用 1px 描边把卡片框起来，造成视觉碎片与模板感。',
                  solution: '依靠 surface → surface-container-low → surface-container → surface-container-high → surface-container-lowest 自然分层，去掉多余边框。',
                },
                {
                  id: '02',
                  title: '连接式按钮组 + 选中变形（Shape Morphing）',
                  problem: '全员同款胶囊（旧生产页）或全员 6px 小方块（第一版 Lab）都缺乏形态节奏。',
                  solution: '外端 19px 大圆角 + 相邻内角 6px，选中项内角平滑过渡为胶囊与 Secondary / Primary Container 填充，按压自带涟漪与弹性微缩。',
                },
                {
                  id: '03',
                  title: '三角色色彩协同（告别米黄糊）',
                  problem: '全屏暖米黄与棕金混在一起，没有重点色张力。',
                  solution: '中性冷石/暗石基底让作品本身色彩突出；Primary 聚焦生成主操作，Secondary Container 承载选态，Tertiary Container 点缀额度与模板。',
                },
                {
                  id: '04',
                  title: '产品流重塑（渠道折叠 + 视觉选参 + Split CTA）',
                  problem: '400px 渠道表 + 8 个堆叠下拉框挤爆首屏。',
                  solution: '单行渠道触发卡 + 弹层、可视比例切片矩阵、连接式数量步进器、Split 生成按钮（右侧直接呼出参数模板）。',
                },
                {
                  id: '05',
                  title: 'M3 Expressive Shimmer Skeleton 渐进占位',
                  problem: '页面、模型目录或图片未加载时缺乏统一占位，易出现空白等待或内容突变闪烁。',
                  solution: '引入 GPU 合成钴蓝微光骨架（SkeletonBlock + ShimmerImage），按元素圆角形态一比一占位并在就绪后平滑淡入显影。',
                },
                {
                  id: '06',
                  title: '全局复用点击涟漪 + 状态层优先级修正',
                  problem: '仅有少数控件实现点击晕开且存在代码重复；图库选中卡片 hover 时蓝色会被原色 hover 覆盖。',
                  solution: '抽离共用 RippleButton / RippleOverlay 复用 useRipple 覆盖全部可点击控件，并用 :not() 与 secondary-container-hover 修复叠加态。',
                },
              ].map((item) => (
                <article key={item.id} className={styles.auditCard}>
                  <span className={styles.auditNum}>{item.id}</span>
                  <h2>{item.title}</h2>
                  <div className={styles.auditPair}>
                    <strong>诊断：</strong>
                    <span>{item.problem}</span>
                  </div>
                  <div className={styles.auditPair}>
                    <strong>M3 Expressive 解法：</strong>
                    <span>{item.solution}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {tab === 'components' ? (
          <section className={styles.sectionGrid}>
            <div className={styles.introCard}>
              <span className={styles.eyebrow}>STAGE 2–4 · M3 EXPRESSIVE TOKENS &amp; COMPONENTS</span>
              <h1>方向 A · 钴蓝 Primary + 暖琥珀 Tertiary + 冷石色调阶梯</h1>
              <p>
                所有控件内置真实 M3 径向指针涟漪（Ripple）、Tonal 表面层次、Connected Group 形状变形及完整键盘支持（方向键、Escape 回焦）。
              </p>
            </div>

            {/* M3 Color Role Matrix */}
            <div className={styles.labPanel}>
              <h2 className={styles.panelTitle}>M3 核心色彩角色与表面阶梯</h2>
              <div className={styles.swatchRow}>
                {[
                  { name: 'Primary', bg: '--md-sys-color-primary', fg: '--md-sys-color-on-primary', role: '唯一主 CTA · 焦点框' },
                  { name: 'Primary Container', bg: '--md-sys-color-primary-container', fg: '--md-sys-color-on-primary-container', role: '高强调激活态' },
                  { name: 'Secondary Container', bg: '--md-sys-color-secondary-container', fg: '--md-sys-color-on-secondary-container', role: '导航 · 分段 · 下拉选中' },
                  { name: 'Tertiary Container', bg: '--md-sys-color-tertiary-container', fg: '--md-sys-color-on-tertiary-container', role: '额度 · 模板 · 进行中' },
                  { name: 'Container Low', bg: '--md-sys-color-surface-container-low', fg: '--md-sys-color-on-surface', role: '工作栏 · 胶卷底板' },
                  { name: 'Container High', bg: '--md-sys-color-surface-container-high', fg: '--md-sys-color-on-surface', role: '填充式触发器槽位' },
                ].map((s) => (
                  <div key={s.name} className={styles.swatchCard}>
                    <div
                      className={styles.swatchChip}
                      style={{
                        backgroundColor: `var(${s.bg})`,
                        color: `var(${s.fg})`,
                      }}
                    >
                      Aa
                    </div>
                    <strong>{s.name}</strong>
                    <code>{s.bg.replace('--md-sys-color-', '')}</code>
                    <span>{s.role}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Component Sandbox */}
            <div className={styles.componentGrid}>
              <div className={styles.labPanel}>
                <div className={styles.skeletonSubHead}>
                  <h2 className={styles.panelTitle}>1. Tonal 渠道卡片 + 弹层选择器</h2>
                  <RippleButton
                    type="button"
                    className={styles.scenarioBtn}
                    aria-pressed={demoCatalogLoading}
                    onClick={() => setDemoCatalogLoading((v) => !v)}
                  >
                    {demoCatalogLoading ? '目录骨架中' : '模拟目录加载'}
                  </RippleButton>
                </div>
                <p className={styles.panelDesc}>
                  表面填充式触发卡配 Tertiary 额度胶囊；点击展开 Elevated Popover，内含 Connected 协议切换与目录芯片（支持目录加载骨架态）。
                </p>
                <ChannelModelBar
                  channels={MOCK_CHANNELS}
                  channelId={demoChannelId}
                  provider={demoProvider}
                  model={demoModel}
                  catalog={MOCK_CATALOG_BY_CHANNEL[demoChannelId] ?? null}
                  catalogLoading={demoCatalogLoading}
                  templates={MOCK_TEMPLATES}
                  quota={MOCK_QUOTA}
                  onChannelChange={setDemoChannelId}
                  onProviderChange={setDemoProvider}
                  onModelChange={setDemoModel}
                  onApplyTemplate={(tpl) => {
                    if (tpl.params.quality) setDemoQuality(tpl.params.quality)
                    if (tpl.params.n) setDemoCount(tpl.params.n)
                  }}
                />
              </div>

              <div className={styles.labPanel}>
                <h2 className={styles.panelTitle}>2. 连接式变形组（比例矩阵 + 画质 + 步进器）</h2>
                <p className={styles.panelDesc}>
                  点击任意选项感受 M3 Expressive：外圆内方连接结构，选中项平滑 morph 成胶囊/大圆角并伴随指针涟漪。
                </p>
                <div className={styles.sandboxStack}>
                  <RatioTileSelector value={demoRatio} onChange={setDemoRatio} />
                  <div className={styles.sandboxRow}>
                    <SegmentedRail
                      label="画质"
                      value={demoQuality}
                      options={[
                        { value: 'auto', label: '自动' },
                        { value: 'medium', label: '标准' },
                        { value: 'high', label: '高' },
                        { value: 'max', label: '极致' },
                      ]}
                      onChange={setDemoQuality}
                    />
                    <CountStepper value={demoCount} onChange={setDemoCount} />
                  </div>
                </div>
              </div>

              <div className={styles.labPanel}>
                <h2 className={styles.panelTitle}>3. 忠于样例的 M3 Expressive 下拉控件</h2>
                <p className={styles.panelDesc}>
                  高容器填充触发器、无冗余边框、点击涟漪、180° 旋转箭头、16px 阴影菜单与 Secondary Container 勾选态。
                </p>
                <StudioSelect
                  label="输出格式示例"
                  value={demoFormat}
                  options={[
                    { value: 'png', label: 'PNG（无损透明支持）' },
                    { value: 'jpeg', label: 'JPEG（支持压缩率）' },
                    { value: 'webp', label: 'WebP（高压缩与透明）' },
                    { value: 'tiff', label: 'TIFF（当前渠道暂不支持）', disabled: true },
                  ]}
                  onChange={setDemoFormat}
                />
              </div>

              <div className={styles.labPanel}>
                <h2 className={styles.panelTitle}>4. M3 Expressive Split Button（主操作 + 模板菜单）</h2>
                <p className={styles.panelDesc}>
                  左半主生成按压时圆角收紧回弹，右半连接按钮可一键呼出管理员参数模板，并以 Snackbar 返回即时操作反馈。
                </p>
                <M3SplitGenerateButton
                  label={`生成图像 (${demoCount})`}
                  templates={MOCK_TEMPLATES}
                  onGenerate={() =>
                    showSnackbar({
                      tone: 'info',
                      message: `已模拟提交：${demoCount} 张 · ${demoRatio} · ${demoQuality}`,
                      actionLabel: '查看原型',
                      onAction: () => setTab('prototypes'),
                    })
                  }
                  onApplyTemplate={(tpl) => {
                    if (tpl.params.quality) setDemoQuality(tpl.params.quality)
                    if (tpl.params.n) setDemoCount(tpl.params.n)
                    showSnackbar({
                      tone: 'success',
                      message: `已套用模板：${tpl.name}`,
                    })
                  }}
                />
              </div>

              <div className={styles.labPanel}>
                <h2 className={styles.panelTitle}>5. M3 Primary Tabs（基线滑块栏目切换条）</h2>
                <p className={styles.panelDesc}>
                  去除了外框灰胶囊堆砌，采用贴合底部分割线的 3px 主题色圆角短条；大栏目绑定手机端左右滑动联动指示器实时平移，小栏目仅支持手动点击切换。
                </p>
                <div className={styles.primaryTabDemoSurface}>
                  <M3PrimaryTabs
                    label="Primary Tabs 示例"
                    variant="fixed"
                    value={demoPrimaryTab}
                    items={[
                      { id: 'earn', label: '创作工作台' },
                      { id: 'use', label: '我的图库' },
                      { id: 'perks', label: '站点管理' },
                    ]}
                    onChange={setDemoPrimaryTab}
                  />
                </div>
              </div>

              <div className={styles.labPanel}>
                <h2 className={styles.panelTitle}>6. M3 Expressive Snackbar（浮动通知与告警）</h2>
                <p className={styles.panelDesc}>
                  采用反转高对比表面浮于视口底部，不挤压破坏页面流式布局；保留强制改密、防重复提交恢复与安全守则等阻断型信息内联展示。
                </p>
                <div className={styles.snackbarDemoRow}>
                  <RippleButton
                    type="button"
                    className={styles.snackbarTriggerBtn}
                    onClick={() =>
                      showSnackbar({
                        tone: 'info',
                        message: '已同步后端图库与任务列表（不改变页面排版）。',
                      })
                    }
                  >
                    普通通知
                  </RippleButton>
                  <RippleButton
                    type="button"
                    className={styles.snackbarTriggerBtn}
                    onClick={() =>
                      showSnackbar({
                        tone: 'success',
                        message: '渠道配置已安全加密保存。',
                      })
                    }
                  >
                    操作成功
                  </RippleButton>
                  <RippleButton
                    type="button"
                    className={styles.snackbarTriggerBtn}
                    onClick={() =>
                      showSnackbar({
                        tone: 'warning',
                        message: '删除后端作品将连带清除所属任务同组全部图片，无法撤销。',
                        actionLabel: '知道了',
                        onAction: () => {},
                      })
                    }
                  >
                    风险告警
                  </RippleButton>
                </div>
              </div>

              <div className={`${styles.labPanel} ${styles.labPanelWide}`}>
                <div className={styles.skeletonSubHead}>
                  <h2 className={styles.panelTitle}>
                    7. M3 Expressive Shimmer Skeleton Loading（骨架占位与渐进显影）
                  </h2>
                  <div className={styles.protoGroup} style={{ gap: 8 }}>
                    <div className={styles.protoGroup}>
                      <RippleButton
                        type="button"
                        aria-pressed={sandboxSkeleton}
                        className={`${styles.scenarioBtn} ${sandboxSkeleton ? styles.scenarioBtnActive : ''}`}
                        onClick={() => setSandboxSkeleton(true)}
                      >
                        骨架加载中
                      </RippleButton>
                      <RippleButton
                        type="button"
                        aria-pressed={!sandboxSkeleton}
                        className={`${styles.scenarioBtn} ${!sandboxSkeleton ? styles.scenarioBtnActive : ''}`}
                        onClick={() => setSandboxSkeleton(false)}
                      >
                        已加载完成
                      </RippleButton>
                    </div>
                    <RippleButton
                      type="button"
                      className={styles.protoDemoBtn}
                      onClick={triggerSandboxLoadDemo}
                    >
                      演示 1.2s 加载过渡
                    </RippleButton>
                  </div>
                </div>
                <p className={styles.panelDesc}>
                  基于 M3 Tonal Surface 阶梯与主色钴蓝微光扫掠（GPU 合成 60fps），严格贴合各元素圆角形态（圆形、胶囊文本、填充输入框、连接式矩阵与 Split CTA），在图片解码或列表数据未就绪时平滑占位并在加载完成后渐显过渡。
                </p>

                <div className={styles.skeletonSandboxGrid}>
                  <div className={styles.skeletonSubCard}>
                    <div className={styles.skeletonSubHead}>
                      <span>原子与连接形态骨架（Shapes &amp; Controls）</span>
                    </div>
                    <div className={styles.skeletonDemoRow}>
                      <SkeletonBlock variant="circle" width={40} height={40} />
                      <div className={styles.skeletonDemoCol}>
                        <SkeletonBlock variant="text" width="62%" height={14} />
                        <SkeletonBlock variant="text" width="42%" height={11} staggerIndex={1} />
                      </div>
                      <SkeletonBlock variant="pill" width={72} height={26} staggerIndex={2} />
                    </div>
                    <SkeletonTextStack widths={['96%', '84%', '58%']} lineHeight={12} staggerIndex={1} />
                    <SkeletonBlock variant="field" staggerIndex={2} />
                    <ConnectedRatioSkeleton />
                    <SplitCtaSkeleton />
                  </div>

                  <div className={styles.skeletonSubCard}>
                    <div className={styles.skeletonSubHead}>
                      <span>媒体渐进显影（ShimmerImage · 切换状态体验淡入）</span>
                    </div>
                    <div className={styles.skeletonMediaFrame}>
                      <ShimmerImage
                        src={MOCK_ARTWORKS.single}
                        alt="M3 Expressive Shimmer 渐进加载预览"
                        aspectRatio="4 / 3"
                        radius="14px 14px 0 0"
                        forceSkeleton={sandboxSkeleton}
                        iconSize={26}
                      />
                      <div className={styles.skeletonMediaCaption}>
                        {sandboxSkeleton ? (
                          <>
                            <SkeletonBlock variant="text" width={82} height={11} />
                            <SkeletonBlock variant="text" width={94} height={11} staggerIndex={1} />
                          </>
                        ) : (
                          <>
                            <span>FRAME 01 · READY</span>
                            <span>1536 × 1024</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {tab === 'prototypes' ? (
          <section className={styles.prototypeSection}>
            <div className={styles.protoToolbar}>
              <div className={styles.protoGroup}>
                <span className={styles.protoLabel}>页面：</span>
                {(
                  [
                    { id: 'workbench', label: '/ 工作台' },
                    { id: 'gallery', label: '/gallery 图库' },
                    { id: 'channels', label: '/channels 渠道' },
                    { id: 'account', label: '/login · /password' },
                    { id: 'admin', label: '/admin 管理' },
                  ] as const
                ).map((item) => (
                  <RippleButton
                    key={item.id}
                    type="button"
                    aria-pressed={activePage === item.id}
                    className={`${styles.scenarioBtn} ${activePage === item.id ? styles.scenarioBtnActive : ''}`}
                    onClick={() => handleNavigatePage(item.id)}
                  >
                    {item.label}
                  </RippleButton>
                ))}
              </div>

              {activePage === 'workbench' ? (
                <div className={styles.protoGroup}>
                  <span className={styles.protoLabel}>场景状态：</span>
                  <div className={styles.protoGroup}>
                    {(
                      [
                        { id: 'succeeded', label: '单图完成' },
                        { id: 'multi', label: '2×2 多图' },
                        { id: 'generating', label: '显影队列中' },
                        { id: 'loading', label: '骨架加载中' },
                        { id: 'empty', label: '空态引导' },
                        { id: 'blocker', label: '未选渠道阻塞' },
                        { id: 'recovery', label: '待确认恢复' },
                      ] as const
                    ).map((item) => (
                      <RippleButton
                        key={item.id}
                        type="button"
                        aria-pressed={scenario === item.id}
                        className={`${styles.scenarioBtn} ${scenario === item.id ? styles.scenarioBtnActive : ''}`}
                        onClick={() => setScenario(item.id)}
                      >
                        {item.label}
                      </RippleButton>
                    ))}
                  </div>
                  <RippleButton
                    type="button"
                    className={styles.protoDemoBtn}
                    onClick={triggerPageLoadDemo}
                  >
                    演示加载 1.2s
                  </RippleButton>
                </div>
              ) : (
                <div className={styles.protoGroup}>
                  <span className={styles.protoLabel}>数据状态：</span>
                  <div className={styles.protoGroup}>
                    <RippleButton
                      type="button"
                      aria-pressed={loadMode === 'ready'}
                      className={`${styles.scenarioBtn} ${loadMode === 'ready' ? styles.scenarioBtnActive : ''}`}
                      onClick={() => setLoadMode('ready')}
                    >
                      已加载
                    </RippleButton>
                    <RippleButton
                      type="button"
                      aria-pressed={loadMode === 'loading'}
                      className={`${styles.scenarioBtn} ${loadMode === 'loading' ? styles.scenarioBtnActive : ''}`}
                      onClick={() => setLoadMode('loading')}
                    >
                      骨架加载中
                    </RippleButton>
                    {activePage === 'gallery' ? (
                      <RippleButton
                        type="button"
                        aria-pressed={loadMode === 'media-loading'}
                        className={`${styles.scenarioBtn} ${loadMode === 'media-loading' ? styles.scenarioBtnActive : ''}`}
                        onClick={() => setLoadMode('media-loading')}
                      >
                        仅图片占位
                      </RippleButton>
                    ) : null}
                  </div>
                  <RippleButton
                    type="button"
                    className={styles.protoDemoBtn}
                    onClick={triggerPageLoadDemo}
                  >
                    演示加载 1.2s
                  </RippleButton>
                </div>
              )}

              <div className={styles.protoGroup}>
                <span className={styles.protoLabel}>视口：</span>
                <RippleButton
                  type="button"
                  aria-pressed={viewportMode === 'desktop'}
                  className={`${styles.scenarioBtn} ${viewportMode === 'desktop' ? styles.scenarioBtnActive : ''}`}
                  onClick={() => setViewportMode('desktop')}
                >
                  桌面端
                </RippleButton>
                <RippleButton
                  type="button"
                  aria-pressed={viewportMode === 'mobile'}
                  className={`${styles.scenarioBtn} ${viewportMode === 'mobile' ? styles.scenarioBtnActive : ''}`}
                  onClick={() => setViewportMode('mobile')}
                >
                  手机 390px
                </RippleButton>
                <span className={styles.swipeHintChip}>
                  {viewportMode === 'mobile'
                    ? '已启用左右滑动切换大栏目（子栏目仅点击）'
                    : '点击大栏目平滑左右切页 · 切至手机模式可拖拽滑动'}
                </span>
              </div>
            </div>

            <WorkbenchPrototype
              activePage={activePage}
              pageTransition={pageTransition}
              scenario={scenario}
              loadMode={loadMode}
              viewportMode={viewportMode}
              onPageChange={handleNavigatePage}
              onScenarioChange={setScenario}
              onNotify={showSnackbar}
            />
          </section>
        ) : null}

        {tab === 'decisions' ? (
          <section className={styles.sectionGrid}>
            <div className={styles.introCard}>
              <span className={styles.eyebrow}>STAGE 5–6 · REVIEW &amp; PRODUCTION INTEGRATION</span>
              <h1>已选定方向 A · 钴蓝暗房，全站 5 页原型与交互细节已就绪</h1>
              <p>
                本 Design Lab 仍处于 Mock 隔离实验态，生产代码尚未改写。截至目前已完成方向锁定、连接式控件变形修正、M3 Primary Tabs 与手机横滑切页、纯云端图库改造、Snackbar 统一反馈、应用级抛物线缩放预览、图库 Hover+选中色阶修正、M3 Shimmer Skeleton 全站加载占位以及全局复用点击涟漪；确认后即可进入 Stage 6 生产集成。
              </p>
            </div>

            <div className={styles.auditGrid}>
              {[
                {
                  code: 'D1',
                  title: '选定方向 A · 钴蓝暗房（浅/深双主题）',
                  body: (
                    <>
                      已确定采用 <strong>Cobalt Primary + Secondary / Tertiary Container</strong> 配 5 级冷石/暗石色调表面阶梯（舍弃方向 B 青墨浮坞），确保作品色彩在界面中保持最高视觉优先级。
                    </>
                  ),
                },
                {
                  code: 'D2',
                  title: '全站 5 页 M3 Expressive 原型与连接式控件',
                  body: (
                    <>
                      完整覆盖 <code>/</code>、<code>/gallery</code>、<code>/channels</code>、<code>/login · /password</code> 与 <code>/admin</code>（6 大管理子模块）。连接式选项组固定外端半高圆角（<code>19px</code>/<code>18px</code>/<code>16px</code>），消除切换时的外角过冲回跳，并配套 Tonal 下拉与 Split CTA。
                    </>
                  ),
                },
                {
                  code: 'D3',
                  title: 'M3 Primary Tabs + 手机端左滑右划切页',
                  body: (
                    <>
                      主栏目与页内子栏目统一采用紧贴底线的 <code>3px</code> 主题色圆角短条（<code>M3PrimaryTabs</code>）。顶级大栏目支持手机端 <code>390px</code> 跟手横滑及双端水平切页动画；页内小栏目保持仅手动点击切换。
                    </>
                  ),
                },
                {
                  code: 'D4',
                  title: '纯云端图库与卡片选框视觉修正',
                  body: (
                    <>
                      移除前端旧版浏览器图库兼容提示与来源筛选，聚焦后端云端作品列表及同组联删安全规则；图库选中边框改为静态 <code>20px</code> 圆角配 <code>1px</code> 渐入淡出高亮框，并修正 <code>22×22</code> 勾选框内对勾居中定位。
                    </>
                  ),
                },
                {
                  code: 'D5',
                  title: 'Snackbar 浮动通知体系与安全阻断边界',
                  body: (
                    <>
                      新增 <code>LabSnackbarHost</code>（自动上避预览底栏），承接操作结果、模板套用、任务详情与删图警告等瞬时反馈，不破坏流式排版；强制改密说明、待恢复提交与无可用渠道阻断等核心提示保留内联常驻。
                    </>
                  ),
                },
                {
                  code: 'D6',
                  title: '沉浸式磨砂图库预览与抛物线应用级动效',
                  body: (
                    <>
                      全屏预览将作品铺展至视口主体并配顶/底磨砂浮层；基于 <code>buildContainerMorphKeyframes</code> 实现非线性解耦与抛物线弧度展开（<code>340ms</code>）及动态追踪目标卡片收回（<code>260ms</code>），全程本体不透明、无收尾闪屏，支持关闭或展开途中即时打断切换。
                    </>
                  ),
                },
                {
                  code: 'D7',
                  title: '图库 Hover+选中色阶修正 & M3 Shimmer Skeleton 占位',
                  body: (
                    <>
                      修正图库卡片与任务胶卷 <code>:hover</code> 覆盖选中蓝底的问题，引入 <code>--md-sys-color-secondary-container-hover</code> 实现浅/深主题下悬停蓝色略微加深；同时构建 <code>LabSkeleton</code> 与 <code>ShimmerImage</code> 渐进显影占位体系，覆盖全部 5 页数据加载、模型目录刷新与未加载图片。
                    </>
                  ),
                },
                {
                  code: 'D8',
                  title: '全局统一可复用点击晕开效果（RippleButton）',
                  body: (
                    <>
                      抽离 <code>LabRipple</code>（<code>RippleButton</code> / <code>RippleOverlay</code>），直接复用共享 <code>useRipple</code> Hook 消除局部重复实现，以零优先级 <code>:where(.rippleHost)</code> 兼容绝对定位按钮，实现顶栏、标签页、卡片、缩略图（白色微光）、弹层、Snackbar 与表单控件全覆盖。
                    </>
                  ),
                },
              ].map((card) => (
                <article key={card.code} className={styles.auditCard}>
                  <span className={styles.auditNum}>{card.code}</span>
                  <h2>{card.title}</h2>
                  <p className={styles.decisionCopy}>{card.body}</p>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <div id="lab-overlay-root" />

      <LabSnackbarHost
        snackbar={snackbar}
        onDismiss={dismissSnackbar}
        onPause={pauseSnackbar}
        onResume={resumeSnackbar}
      />
    </div>
  )
}
