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
import { LabSnackbarHost } from './components/LabSnackbar'
import { useSnackbar } from './components/useSnackbar'
import {
  MOCK_CATALOG_BY_CHANNEL,
  MOCK_CHANNELS,
  MOCK_QUOTA,
  MOCK_TEMPLATES,
} from './mockData'
import {
  WorkbenchPrototype,
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

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current)
    }
  }, [])

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
            <button
              key={item.id}
              type="button"
              aria-pressed={tab === item.id}
              className={`${styles.labTab} ${tab === item.id ? styles.labTabActive : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className={styles.labToggles}>
          <span className={styles.selectedDirTag}>已选方向 A · 钴蓝暗房</span>

          <div className={styles.switchGroup} role="group" aria-label="主题模式">
            <button
              type="button"
              aria-pressed={theme === 'light'}
              onClick={() => setTheme('light')}
            >
              <Icon name="sun" size={14} />
              <span>浅色</span>
            </button>
            <button
              type="button"
              aria-pressed={theme === 'dark'}
              onClick={() => setTheme('dark')}
            >
              <Icon name="moon" size={14} />
              <span>深色</span>
            </button>
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
                <h2 className={styles.panelTitle}>1. Tonal 渠道卡片 + 弹层选择器</h2>
                <p className={styles.panelDesc}>
                  表面填充式触发卡配 Tertiary 额度胶囊；点击展开 Elevated Popover，内含 Connected 协议切换与目录芯片。
                </p>
                <ChannelModelBar
                  channels={MOCK_CHANNELS}
                  channelId={demoChannelId}
                  provider={demoProvider}
                  model={demoModel}
                  catalog={MOCK_CATALOG_BY_CHANNEL[demoChannelId] ?? null}
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
                  <button
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
                  </button>
                  <button
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
                  </button>
                  <button
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
                  </button>
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
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={activePage === item.id}
                    className={`${styles.scenarioBtn} ${activePage === item.id ? styles.scenarioBtnActive : ''}`}
                    onClick={() => handleNavigatePage(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {activePage === 'workbench' ? (
                <div className={styles.protoGroup}>
                  <span className={styles.protoLabel}>场景状态：</span>
                  {(
                    [
                      { id: 'succeeded', label: '单图完成' },
                      { id: 'multi', label: '2×2 多图' },
                      { id: 'generating', label: '显影队列中' },
                      { id: 'empty', label: '空态引导' },
                      { id: 'blocker', label: '未选渠道阻塞' },
                      { id: 'recovery', label: '待确认恢复' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={scenario === item.id}
                      className={`${styles.scenarioBtn} ${scenario === item.id ? styles.scenarioBtnActive : ''}`}
                      onClick={() => setScenario(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className={styles.protoGroup}>
                <span className={styles.protoLabel}>视口：</span>
                <button
                  type="button"
                  aria-pressed={viewportMode === 'desktop'}
                  className={`${styles.scenarioBtn} ${viewportMode === 'desktop' ? styles.scenarioBtnActive : ''}`}
                  onClick={() => setViewportMode('desktop')}
                >
                  桌面端
                </button>
                <button
                  type="button"
                  aria-pressed={viewportMode === 'mobile'}
                  className={`${styles.scenarioBtn} ${viewportMode === 'mobile' ? styles.scenarioBtnActive : ''}`}
                  onClick={() => setViewportMode('mobile')}
                >
                  手机 390px
                </button>
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
              <h1>已选定方向 A · 钴蓝暗房，全站 5 页原型就绪</h1>
              <p>
                本 Design Lab 仍处于 Mock 隔离实验态，生产代码尚未改写。方向 A 已按确认锁定（方向 B 已舍弃），并在「03 · 全站多页原型」覆盖全部 5 个真实业务页面。确认细节后即可进入 Stage 6 生产集成。
              </p>
            </div>

            <div className={styles.auditGrid}>
              <article className={styles.auditCard}>
                <span className={styles.auditNum}>D1</span>
                <h2>选定方向与色彩语言</h2>
                <p className={styles.decisionCopy}>
                  已选定 <strong>方向 A（钴蓝暗房 · 浅/深双主题）</strong>：冷石中性 5 级色调表面 + Cobalt Primary + Warm Amber Tertiary，已完全舍弃方向 B（青墨浮坞）。
                </p>
              </article>
              <article className={styles.auditCard}>
                <span className={styles.auditNum}>D2</span>
                <h2>全站 5 页匹配与集成节奏</h2>
                <p className={styles.decisionCopy}>
                  原型已覆盖 <code>/</code>、<code>/gallery</code>、<code>/channels</code>、<code>/login /password</code> 与 <code>/admin</code>。获批后先集成共用顶栏、令牌系统与工作台 <code>/</code>，随后依次落入其余 4 个页面。
                </p>
              </article>
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
