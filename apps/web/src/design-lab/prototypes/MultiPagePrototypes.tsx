import { useEffect, useRef, useState } from 'react'
import { GalleryView } from '../../studio/GalleryView'
import type { ProviderType } from '@nanobanana/shared/types/generation'
import { Icon } from '../../components/Icon'
import {
  CountStepper,
  M3PrimaryTabs,
  RatioTileSelector,
  SegmentedRail,
  StudioSelect,
} from '../../studio/Controls'
import { RippleButton } from '../../studio/Ripple'
import {
  ConnectedRatioSkeleton,
  SkeletonBlock,
  SkeletonTextStack,
} from '../../studio/Skeleton'
import type { SnackbarPayload } from '../../studio/useSnackbar'
import {
  MOCK_ADMIN_SETTINGS,
  MOCK_ADMIN_USAGE,
  MOCK_ADMIN_USERS,
  MOCK_CATALOG_BY_CHANNEL,
  MOCK_CHANNELS,
  MOCK_GALLERY_ITEMS,
  MOCK_INVITES,
  MOCK_TEMPLATES,
} from '../mockData'
import styles from '../../studio/Pages.module.css'

export type LabPageRoute = 'workbench' | 'gallery' | 'channels' | 'account' | 'admin'
export type LabLoadMode = 'ready' | 'loading' | 'media-loading'

/* ==========================================================================
   PAGE 2 · /gallery — 我的图库
   ========================================================================== */
export function GalleryPrototype({ onGoWorkbench, onNotify, loadMode = 'ready' }: {
  onGoWorkbench: () => void; onNotify: (payload: SnackbarPayload) => void; loadMode?: LabLoadMode
}) {
  const [selected, setSelected] = useState(['srv-2'])
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    if (!refreshing) return
    const timer = window.setTimeout(() => { setRefreshing(false); onNotify({ message: '已模拟刷新图库元数据。' }) }, 850)
    return () => window.clearTimeout(timer)
  }, [refreshing, onNotify])
  const loading = loadMode === 'loading' || refreshing
  return <GalleryView items={MOCK_GALLERY_ITEMS} selectedKeys={selected} onSelection={setSelected}
    onGoWorkbench={onGoWorkbench} onRefresh={() => setRefreshing(true)} isRefreshing={loading}
    showListSkeleton={loading} showMediaSkeleton={loadMode === 'media-loading'} overlayId="lab-overlay-root"
    onDownload={(item) => onNotify({ message: `已模拟下载原图：${item.key}` })}
    onDeleteOne={(item) => onNotify({ tone: 'warning', message: `删除此作品将连带删除所属任务（共 ${item.groupCount} 张同组图片），无法撤销。` })}
    onDeleteSelected={(items) => onNotify({ tone: 'warning', message: `删除所选 ${items.length} 张作品将按所属任务整组删除，无法撤销。` })} />
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
   PAGE 5 · /admin — 站点管理控制台（6 大模块）
   ========================================================================== */
export function AdminPrototype({
  onNotify,
  loadMode = 'ready',
}: {
  onNotify: (payload: SnackbarPayload) => void
  loadMode?: LabLoadMode
}) {
  const [adminTab, setAdminTab] = useState<
    'channels' | 'users' | 'invites' | 'settings' | 'templates' | 'usage'
  >('users')
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

  return (
    <div className={styles.pageWrap}>
      <header className={styles.pageHeader}>
        <div className={styles.pageTitleGroup}>
          <span className={styles.pageEyebrow}>SITE ADMINISTRATION</span>
          <h1 className={styles.pageTitle}>站点管理台</h1>
          <p className={styles.pageSub}>统一管理共享渠道、成员额度、邀请码、队列并发、参数模板与非私密统计</p>
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
          ]}
          onChange={setAdminTab}
        />
      </div>

      <div key={adminTab} className={styles.subPanelFade}>

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
