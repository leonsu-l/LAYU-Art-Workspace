import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { SegmentedRail, StudioSelect } from '../components/LabControls'
import { LabIcon } from '../components/LabIcon'
import { RippleButton } from '../components/LabRipple'
import { SkeletonBlock, SkeletonTextStack } from '../components/LabSkeleton'
import type { SnackbarPayload } from '../components/useSnackbar'
import {
  MOCK_BUCKET_DELETE_BLOCK_REASONS,
  MOCK_BUCKET_USAGE,
  MOCK_R2_BUCKETS,
  MOCK_STORAGE_SETTINGS,
  type BucketJurisdiction,
  type BucketUsageContract,
  type CloudflareUsageStatus,
  type R2BucketInfo,
  type StorageSettingsContract,
} from '../mockData'
import {
  formatBytes,
  formatLocalDateTime,
  formatRetentionPolicyText,
  validateAccountId,
  validateBucketName,
  validateCredentialInput,
  validateRetentionDays,
} from '../utils/retentionFormat'
import type { LabLoadMode } from './MultiPagePrototypes'
import pageStyles from './MultiPagePrototypes.module.css'
import styles from './AdminModules.module.css'

const LOCAL_BUCKET_VALUE = '__local__'

type RetentionPreset = 'permanent' | '7' | '30' | '90' | 'custom'

const JURISDICTION_LABELS: Record<BucketJurisdiction, string> = {
  default: '默认 (default)',
  eu: '欧盟 (eu)',
  fedramp: 'FedRAMP (fedramp)',
}

const CF_STATUS_META: Record<
  Exclude<CloudflareUsageStatus, 'available'>,
  { label: string; tone: 'muted' | 'warn'; title: string; desc: string }
> = {
  not_configured: {
    label: 'not_configured',
    tone: 'muted',
    title: '未配置独立的 Analytics Token',
    desc: '不配置统计令牌完全不影响图片的正常读写与删除。如需查看 Cloudflare 官方整桶用量，请在下方补充具有 Account → Account Analytics → Read 权限的令牌。',
  },
  forbidden: {
    label: 'forbidden',
    tone: 'warn',
    title: '官方查询身份或权限被拒绝',
    desc: '请核对令牌是否具备 Account → Account Analytics → Read 权限，以及 Account ID 是否匹配。本应用自有统计与图片存取不受影响。',
  },
  no_data: {
    label: 'no_data',
    tone: 'muted',
    title: '最近 31 天内暂无采样样本',
    desc: 'Cloudflare Analytics API 未返回最近 31 天样本（新建桶或刚写入对象可能存在指标延迟）。此状态不代表实际为 0。',
  },
  unavailable: {
    label: 'unavailable',
    tone: 'warn',
    title: '官方接口暂不可用',
    desc: '因网络超时、限流或返回格式异常暂时无法取得 Cloudflare 采样。请稍后重试；本应用图片数量与字节统计仍可正常查看。',
  },
}

function resolveRetentionPreset(days: number | null): RetentionPreset {
  if (days === null) return 'permanent'
  if (days === 7) return '7'
  if (days === 30) return '30'
  if (days === 90) return '90'
  return 'custom'
}

export function AdminStorageModule({
  loadMode = 'ready',
  onNotify,
  onPolicySaved,
}: {
  loadMode?: LabLoadMode
  onNotify: (payload: SnackbarPayload) => void
  onPolicySaved?: (policy: StorageSettingsContract) => void
}) {
  // Committed & draft policy (GET/PUT /api/admin/storage/settings)
  const [committedPolicy, setCommittedPolicy] = useState<StorageSettingsContract>(MOCK_STORAGE_SETTINGS)
  const [draftBucketId, setDraftBucketId] = useState<string | null>(MOCK_STORAGE_SETTINGS.activeBucketId)
  const [retentionPreset, setRetentionPreset] = useState<RetentionPreset>(() =>
    resolveRetentionPreset(MOCK_STORAGE_SETTINGS.retentionDays),
  )
  const [customDaysInput, setCustomDaysInput] = useState(
    MOCK_STORAGE_SETTINGS.retentionDays ? String(MOCK_STORAGE_SETTINGS.retentionDays) : '14',
  )

  // Buckets & dual usage state (/api/admin/storage/buckets*)
  const [buckets, setBuckets] = useState<R2BucketInfo[]>(MOCK_R2_BUCKETS)
  const [selectedBucketId, setSelectedBucketId] = useState<string | 'new'>(MOCK_R2_BUCKETS[0].id)
  const [justCreatedBucketId, setJustCreatedBucketId] = useState<string | null>(null)
  const [usageByBucket, setUsageByBucket] = useState<Record<string, BucketUsageContract>>(MOCK_BUCKET_USAGE)
  const [isRefreshingUsage, setIsRefreshingUsage] = useState(false)
  const [cfStatusOverride, setCfStatusOverride] = useState<CloudflareUsageStatus | null>(null)
  const [fallbackSampledAt, setFallbackSampledAt] = useState(() => new Date().toISOString())

  // Create bucket form state (POST /api/admin/storage/buckets)
  const [newAccountId, setNewAccountId] = useState('')
  const [newBucketName, setNewBucketName] = useState('')
  const [newJurisdiction, setNewJurisdiction] = useState<BucketJurisdiction>('default')
  const [newAccessKeyId, setNewAccessKeyId] = useState('')
  const [newSecretAccessKey, setNewSecretAccessKey] = useState('')
  const [newAnalyticsToken, setNewAnalyticsToken] = useState('')
  const [showCreateSecrets, setShowCreateSecrets] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Credential rotation form state (PATCH /api/admin/storage/buckets/{id})
  const [rotAccessKeyId, setRotAccessKeyId] = useState('')
  const [rotSecretAccessKey, setRotSecretAccessKey] = useState('')
  const [rotAnalyticsToken, setRotAnalyticsToken] = useState('')
  const [clearAnalyticsToken, setClearAnalyticsToken] = useState(false)
  const [showRotateSecrets, setShowRotateSecrets] = useState(false)
  const [rotateError, setRotateError] = useState<string | null>(null)

  // Safe deletion state (DELETE /api/admin/storage/buckets/{id})
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [simulateDeleteNetworkError, setSimulateDeleteNetworkError] = useState(false)
  const [deleteFeedback, setDeleteFeedback] = useState<{
    kind: '409' | 'network'
    message: string
  } | null>(null)

  const usageTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (usageTimerRef.current !== null) window.clearTimeout(usageTimerRef.current)
    }
  }, [])

  const isLoading = loadMode === 'loading'

  // Compute draft retention days + validation
  const retentionValidation =
    retentionPreset === 'permanent'
      ? { valid: true, value: null, error: null }
      : retentionPreset === 'custom'
        ? customDaysInput.trim() === ''
          ? { valid: false, value: null, error: '请输入 1–3650 之间的保留天数。' }
          : validateRetentionDays(customDaysInput)
        : { valid: true, value: Number(retentionPreset), error: null }

  const isPolicyDirty =
    draftBucketId !== committedPolicy.activeBucketId ||
    (retentionValidation.valid && retentionValidation.value !== committedPolicy.retentionDays)

  const activePolicyBucket = buckets.find((b) => b.id === committedPolicy.activeBucketId) ?? null
  const selectedBucket =
    selectedBucketId === 'new' ? null : buckets.find((b) => b.id === selectedBucketId) ?? buckets[0] ?? null

  const activeUsage: BucketUsageContract | null = selectedBucket
    ? usageByBucket[selectedBucket.id] ?? {
        application: { imageCount: 0, totalBytes: 0 },
        cloudflare: {
          status: selectedBucket.hasAnalyticsToken ? 'no_data' : 'not_configured',
          payloadBytes: null,
          metadataBytes: null,
          objectCount: null,
          sampledAt: null,
        },
      }
    : null

  const effectiveCloudflare = (() => {
    if (!activeUsage) return null
    const override = cfStatusOverride
    if (!override) return activeUsage.cloudflare
    if (override === 'available') {
      return {
        status: 'available' as const,
        payloadBytes: activeUsage.cloudflare.payloadBytes ?? 14_820_000,
        metadataBytes: activeUsage.cloudflare.metadataBytes ?? 92_400,
        objectCount: activeUsage.cloudflare.objectCount ?? 18,
        sampledAt: activeUsage.cloudflare.sampledAt ?? fallbackSampledAt,
      }
    }
    return {
      status: override,
      payloadBytes: null,
      metadataBytes: null,
      objectCount: null,
      sampledAt: null,
    }
  })()

  function resetBucketActionForms() {
    setRotAccessKeyId('')
    setRotSecretAccessKey('')
    setRotAnalyticsToken('')
    setClearAnalyticsToken(false)
    setRotateError(null)
    setConfirmDeleteId(null)
    setDeleteFeedback(null)
    setCfStatusOverride(null)
  }

  function handleSelectBucket(id: string | 'new') {
    setSelectedBucketId(id)
    setCreateError(null)
    resetBucketActionForms()
  }

  function handleSavePolicy() {
    if (!retentionValidation.valid) {
      onNotify({ tone: 'warning', message: retentionValidation.error ?? '保留天数配置无效。' })
      return
    }
    const next: StorageSettingsContract = {
      activeBucketId: draftBucketId,
      retentionDays: retentionValidation.value,
    }
    setCommittedPolicy(next)
    onPolicySaved?.(next)
    const targetLabel = draftBucketId
      ? `R2 私有桶「${buckets.find((b) => b.id === draftBucketId)?.bucketName ?? draftBucketId}」`
      : '服务器本地存储'
    onNotify({
      tone: 'success',
      message: `已保存新图写入策略：${targetLabel} · ${formatRetentionPolicyText(next.retentionDays)}（不影响旧图）。`,
    })
  }

  function handleCreateBucket() {
    const accountErr = validateAccountId(newAccountId)
    if (accountErr) {
      setCreateError(accountErr)
      return
    }
    const nameErr = validateBucketName(newBucketName)
    if (nameErr) {
      setCreateError(nameErr)
      return
    }
    const akErr = validateCredentialInput(newAccessKeyId, 'Access Key ID')
    if (akErr) {
      setCreateError(akErr)
      return
    }
    const skErr = validateCredentialInput(newSecretAccessKey, 'Secret Access Key')
    if (skErr) {
      setCreateError(skErr)
      return
    }
    if (newAnalyticsToken.length > 0) {
      const tokenErr = validateCredentialInput(newAnalyticsToken, 'Analytics Token')
      if (tokenErr) {
        setCreateError(tokenErr)
        return
      }
    }

    const normalizedAccount = newAccountId.trim().toLowerCase()
    const normalizedName = newBucketName.trim()
    const duplicate = buckets.some(
      (b) =>
        b.accountId.toLowerCase() === normalizedAccount &&
        b.bucketName === normalizedName &&
        b.jurisdiction === newJurisdiction,
    )
    if (duplicate) {
      setCreateError('HTTP 409：该账户、桶名与辖区组合的 R2 桶已存在，不可重复登记。')
      return
    }

    const createdId = `bkt-${Math.random().toString(16).slice(2, 10)}-4a2b-4c3d-8e1f-${Date.now().toString(16).slice(-12).padStart(12, '0')}`
    const created: R2BucketInfo = {
      id: createdId,
      accountId: normalizedAccount,
      bucketName: normalizedName,
      jurisdiction: newJurisdiction,
      hasAccessKeyId: true,
      hasSecretAccessKey: true,
      hasAnalyticsToken: newAnalyticsToken.length > 0,
    }

    setBuckets((prev) => [...prev, created])
    setUsageByBucket((prev) => ({
      ...prev,
      [createdId]: {
        application: { imageCount: 0, totalBytes: 0 },
        cloudflare: {
          status: created.hasAnalyticsToken ? 'no_data' : 'not_configured',
          payloadBytes: null,
          metadataBytes: null,
          objectCount: null,
          sampledAt: null,
        },
      },
    }))
    setCreateError(null)
    setNewAccountId('')
    setNewBucketName('')
    setNewJurisdiction('default')
    setNewAccessKeyId('')
    setNewSecretAccessKey('')
    setNewAnalyticsToken('')
    setJustCreatedBucketId(createdId)
    setSelectedBucketId(createdId)
    resetBucketActionForms()

    onNotify({
      tone: 'success',
      message: `已登记 R2 桶「${created.bucketName}」（不会自动启用为新图目标）。`,
    })
  }

  function handleRotateCredentials() {
    if (!selectedBucket) return
    const patchKeys: string[] = []
    if (rotAccessKeyId.length > 0) {
      const err = validateCredentialInput(rotAccessKeyId, '新 Access Key ID')
      if (err) {
        setRotateError(err)
        return
      }
      patchKeys.push('accessKeyId')
    }
    if (rotSecretAccessKey.length > 0) {
      const err = validateCredentialInput(rotSecretAccessKey, '新 Secret Access Key')
      if (err) {
        setRotateError(err)
        return
      }
      patchKeys.push('secretAccessKey')
    }
    if (clearAnalyticsToken) {
      patchKeys.push('analyticsToken: null')
    } else if (rotAnalyticsToken.length > 0) {
      const err = validateCredentialInput(rotAnalyticsToken, '新 Analytics Token')
      if (err) {
        setRotateError(err)
        return
      }
      patchKeys.push('analyticsToken')
    }

    if (patchKeys.length === 0) {
      setRotateError('请至少填写一项待轮换的凭据，或选择清除统计令牌；留空字段将被省略且保持原值不变。')
      return
    }

    setRotateError(null)
    setBuckets((prev) =>
      prev.map((b) =>
        b.id === selectedBucket.id
          ? {
              ...b,
              hasAccessKeyId: true,
              hasSecretAccessKey: true,
              hasAnalyticsToken: clearAnalyticsToken
                ? false
                : rotAnalyticsToken.length > 0
                  ? true
                  : b.hasAnalyticsToken,
            }
          : b,
      ),
    )

    if (clearAnalyticsToken) {
      setUsageByBucket((prev) => {
        const current = prev[selectedBucket.id]
        if (!current) return prev
        return {
          ...prev,
          [selectedBucket.id]: {
            ...current,
            cloudflare: {
              status: 'not_configured',
              payloadBytes: null,
              metadataBytes: null,
              objectCount: null,
              sampledAt: null,
            },
          },
        }
      })
    }

    setRotAccessKeyId('')
    setRotSecretAccessKey('')
    setRotAnalyticsToken('')
    setClearAnalyticsToken(false)

    onNotify({
      tone: 'success',
      message: `已模拟 PATCH 轮换桶「${selectedBucket.bucketName}」凭据（仅发送：${patchKeys.join(', ')}）。`,
    })
  }

  function handleDeleteBucket(bucket: R2BucketInfo) {
    if (simulateDeleteNetworkError) {
      setDeleteFeedback({
        kind: 'network',
        message: 'NETWORK (502)：连接存储管理接口超时或暂不可用，请检查网络后重试（并非引用冲突）。',
      })
      return
    }

    if (bucket.id === committedPolicy.activeBucketId) {
      setDeleteFeedback({
        kind: '409',
        message: 'HTTP 409 引用冲突：该桶当前被设为新图默认写入目标，请先在上方策略切换为本地或其他桶再删除。',
      })
      return
    }

    const blockReason = MOCK_BUCKET_DELETE_BLOCK_REASONS[bucket.id]
    if (blockReason) {
      setDeleteFeedback({
        kind: '409',
        message: `HTTP 409 引用冲突：${blockReason}`,
      })
      return
    }

    const remaining = buckets.filter((b) => b.id !== bucket.id)
    setBuckets(remaining)
    setConfirmDeleteId(null)
    setDeleteFeedback(null)
    if (draftBucketId === bucket.id) setDraftBucketId(null)
    if (justCreatedBucketId === bucket.id) setJustCreatedBucketId(null)
    setSelectedBucketId(remaining[0]?.id ?? 'new')
    onNotify({
      tone: 'success',
      message: `已移除空闲桶配置「${bucket.bucketName}」（Cloudflare 桶本身未被删除）。`,
    })
  }

  if (isLoading) {
    return (
      <div className={styles.moduleStack} role="status" aria-busy="true" aria-label="正在加载存储管理">
        <section className={styles.policyCard} aria-hidden="true">
          <div className={styles.policyHeader}>
            <div className={pageStyles.skeletonListStack} style={{ gap: 6 }}>
              <SkeletonBlock variant="text" width={140} height={11} />
              <SkeletonBlock variant="text" width={220} height={22} staggerIndex={1} />
            </div>
            <SkeletonBlock variant="pill" width={180} height={30} staggerIndex={2} />
          </div>
          <div className={styles.policyGrid}>
            <SkeletonBlock variant="rect" height={116} radius={18} />
            <SkeletonBlock variant="rect" height={116} radius={18} staggerIndex={1} />
          </div>
          <SkeletonBlock variant="rect" height={42} radius={14} staggerIndex={2} />
        </section>

        <div className={pageStyles.splitWorkspace} aria-hidden="true">
          <section className={pageStyles.masterRail}>
            <div className={pageStyles.masterHead}>
              <SkeletonBlock variant="text" width={96} height={14} />
              <SkeletonBlock variant="pill" width={40} height={16} />
            </div>
            <div className={pageStyles.channelCardStack}>
              {Array.from({ length: 3 }, (_, idx) => (
                <div key={idx} className={pageStyles.channelItemCard}>
                  <SkeletonBlock variant="text" width="66%" height={14} staggerIndex={idx} />
                  <SkeletonBlock variant="text" width="44%" height={12} staggerIndex={idx + 1} />
                  <SkeletonBlock variant="text" width="84%" height={11} staggerIndex={idx + 2} />
                </div>
              ))}
            </div>
          </section>
          <section className={pageStyles.detailCard}>
            <SkeletonTextStack widths={['32%', '54%']} lineHeight={16} />
            <SkeletonBlock variant="rect" height={156} radius={18} staggerIndex={1} />
            <SkeletonBlock variant="rect" height={168} radius={18} staggerIndex={2} />
          </section>
        </div>
      </div>
    )
  }

  const patchKeysPreview: string[] = []
  if (rotAccessKeyId.length > 0) patchKeysPreview.push('accessKeyId')
  if (rotSecretAccessKey.length > 0) patchKeysPreview.push('secretAccessKey')
  if (clearAnalyticsToken) patchKeysPreview.push('analyticsToken: null')
  else if (rotAnalyticsToken.length > 0) patchKeysPreview.push('analyticsToken')

  const bucketSelectOptions = [
    { value: LOCAL_BUCKET_VALUE, label: '服务器本地存储（出厂默认 · activeBucketId: null）' },
    ...buckets.map((b) => ({
      value: b.id,
      label: `Cloudflare R2 · ${b.bucketName} (${b.jurisdiction})`,
    })),
  ]

  return (
    <div className={styles.moduleStack}>
      {/* 1. Independent New-Image Write Policy (/api/admin/storage/settings) */}
      <section className={styles.policyCard} aria-label="新图默认写入策略">
        <div className={styles.policyHeader}>
          <div>
            <span className={pageStyles.pageEyebrow}>STORAGE POLICY · /api/admin/storage/settings</span>
            <h2>新生成图片默认写入策略</h2>
            <p className={styles.policySub}>
              独立于「额度与队列」设置，仅控制保存<strong>新生成</strong>图片的写入目标与保留天数。
            </p>
          </div>
          <div className={styles.policyBadgeCluster}>
            <span className={styles.activeTargetPill}>
              <LabIcon name={activePolicyBucket ? 'cloud' : 'hard-drive'} size={14} />
              <span>
                当前生效：
                {activePolicyBucket ? activePolicyBucket.bucketName : '本地存储'} ·{' '}
                {formatRetentionPolicyText(committedPolicy.retentionDays)}
              </span>
            </span>
            {isPolicyDirty ? <span className={styles.dirtyPill}>有未保存更改</span> : null}
          </div>
        </div>

        <div className={styles.policyGrid}>
          <div className={styles.policyField}>
            <div className={styles.policyFieldLabel}>
              <span>默认写入位置 (`activeBucketId`)</span>
              <span className={pageStyles.monoMeta}>
                {draftBucketId ? '私有 R2 桶' : 'Local Disk'}
              </span>
            </div>
            <StudioSelect
              label="默认写入位置"
              value={draftBucketId ?? LOCAL_BUCKET_VALUE}
              options={bucketSelectOptions}
              onChange={(val) => setDraftBucketId(val === LOCAL_BUCKET_VALUE ? null : val)}
            />
            <span className={styles.policyFieldHint}>
              切回本地不会停用旧桶的读取、删除与密钥轮换；若 R2 写入失败，后端会尝试回退本地并上报问题日志。
            </span>
          </div>

          <div className={styles.policyField}>
            <div className={styles.policyFieldLabel}>
              <span>新图默认保留期 (`retentionDays`)</span>
              <span className={pageStyles.monoMeta}>
                {retentionValidation.valid
                  ? formatRetentionPolicyText(retentionValidation.value)
                  : '待修正'}
              </span>
            </div>
            <SegmentedRail<RetentionPreset>
              label="默认保留期限"
              wrapOnMobile
              value={retentionPreset}
              options={[
                { value: 'permanent', label: '永久' },
                { value: '7', label: '7 天' },
                { value: '30', label: '30 天' },
                { value: '90', label: '90 天' },
                { value: 'custom', label: '自定义' },
              ]}
              onChange={(next) => {
                setRetentionPreset(next)
                if (next !== 'permanent' && next !== 'custom') {
                  setCustomDaysInput(next)
                }
              }}
            />
            {retentionPreset === 'custom' ? (
              <div className={styles.customDaysRow}>
                <label className={pageStyles.filledField}>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    value={customDaysInput}
                    onChange={(e) => setCustomDaysInput(e.target.value)}
                    placeholder="输入 1–3650 的整数"
                    aria-label="自定义保留天数"
                  />
                </label>
                <span className={styles.unitTag}>天 (1–3650)</span>
              </div>
            ) : null}
            {!retentionValidation.valid ? (
              <span className={styles.fieldErrorText}>{retentionValidation.error}</span>
            ) : (
              <span className={styles.policyFieldHint}>
                按整组图片保存成功起算（每天 24 小时）。`null` 为出厂默认永久保存。
              </span>
            )}
          </div>
        </div>

        <div className={styles.scopeNotice}>
          <Icon name="shield" size={15} />
          <span>
            <strong>安全边界：</strong>
            策略切换不迁移已有文件、不追溯变更已保存图片的过期日期；普通用户图库与任务界面只展示有效期，绝不暴露桶或本地/回退状态。
          </span>
        </div>

        <div className={styles.policyFooter}>
          <span className={pageStyles.monoMeta}>
            PUT 请求体必含 activeBucketId 与 retentionDays（当前草稿：
            {draftBucketId ? `UUID` : 'null'}, {retentionValidation.valid ? String(retentionValidation.value) : 'invalid'}）
          </span>
          <div className={pageStyles.toolbarRight}>
            <RippleButton
              type="button"
              className={pageStyles.tonalBtn}
              disabled={!isPolicyDirty}
              onClick={() => {
                setDraftBucketId(committedPolicy.activeBucketId)
                setRetentionPreset(resolveRetentionPreset(committedPolicy.retentionDays))
                setCustomDaysInput(committedPolicy.retentionDays ? String(committedPolicy.retentionDays) : '14')
              }}
            >
              还原更改
            </RippleButton>
            <RippleButton
              type="button"
              className={pageStyles.primaryBtn}
              disabled={!retentionValidation.valid || !isPolicyDirty}
              onClick={handleSavePolicy}
            >
              <Icon name="check" size={15} />
              <span>保存写入策略</span>
            </RippleButton>
          </div>
        </div>
      </section>

      {/* 2. R2 Buckets Master-Detail (/api/admin/storage/buckets*) */}
      <div className={pageStyles.splitWorkspace}>
        {/* Left Bucket List */}
        <section className={pageStyles.masterRail} aria-label="已登记 R2 私有桶列表">
          <div className={pageStyles.masterHead}>
            <strong>Cloudflare R2 私有桶</strong>
            <span>{buckets.length} 个已登记</span>
          </div>

          <RippleButton
            type="button"
            className={pageStyles.primaryBtnFull}
            onClick={() => handleSelectBucket('new')}
          >
            <Icon name="plus" size={15} />
            <span>登记新 R2 私有桶</span>
          </RippleButton>

          <div className={pageStyles.channelCardStack}>
            {buckets.map((bucket) => {
              const selected = selectedBucketId !== 'new' && selectedBucket?.id === bucket.id
              const isActiveTarget = bucket.id === committedPolicy.activeBucketId
              const usage = usageByBucket[bucket.id]
              return (
                <RippleButton
                  key={bucket.id}
                  type="button"
                  aria-pressed={selected}
                  className={`${pageStyles.channelItemCard} ${selected ? pageStyles.channelItemActive : ''}`}
                  onClick={() => handleSelectBucket(bucket.id)}
                >
                  <div className={pageStyles.channelItemTop}>
                    <strong>{bucket.bucketName}</strong>
                    <span className={isActiveTarget ? styles.activeWriteChip : styles.standbyChip}>
                      {isActiveTarget ? '当前写入目标' : '存量 / 备用'}
                    </span>
                  </div>
                  <div className={styles.bucketTagRow}>
                    <span className={styles.jurisdictionChip}>{bucket.jurisdiction}</span>
                    <span className={pageStyles.monoMeta}>
                      {bucket.accountId.slice(0, 6)}…{bucket.accountId.slice(-4)}
                    </span>
                    {usage ? (
                      <span className={pageStyles.monoMeta}>
                        · {usage.application.imageCount} 张
                      </span>
                    ) : null}
                  </div>
                  <div className={pageStyles.channelItemMeta}>
                    <span>{bucket.hasAnalyticsToken ? '已配统计令牌' : '未配统计令牌'}</span>
                    <span>· 凭据只写</span>
                  </div>
                </RippleButton>
              )
            })}
          </div>
        </section>

        {/* Right Detail / Create / Dual Usage / Key Rotation */}
        <section className={pageStyles.detailCard} aria-label="私有桶详情与操作">
          {selectedBucketId === 'new' || !selectedBucket ? (
            <>
              <div className={pageStyles.detailHeader}>
                <div>
                  <span className={pageStyles.pageEyebrow}>POST /api/admin/storage/buckets</span>
                  <h2>登记已有 Cloudflare R2 私有桶</h2>
                </div>
                {buckets.length > 0 ? (
                  <RippleButton
                    type="button"
                    className={pageStyles.tonalBtn}
                    onClick={() => handleSelectBucket(buckets[0].id)}
                  >
                    返回桶列表
                  </RippleButton>
                ) : null}
              </div>

              <div className={`${styles.scopeNotice} ${styles.scopeNoticeHighlight}`}>
                <Icon name="alert-circle" size={16} />
                <span>
                  此处登记你在 Cloudflare 已创建的私有桶，系统<strong>不会代建或删除 Cloudflare 桶本身</strong>。新登记的配置<strong>不会自动启用</strong>，需在上方策略中显式切换。
                </span>
              </div>

              {createError ? (
                <div className={styles.inlineErrorBanner} role="alert">
                  <span>{createError}</span>
                </div>
              ) : null}

              <div className={pageStyles.formGrid}>
                <label className={pageStyles.filledField}>
                  <span>Account ID（必填 · 32 位十六进制）</span>
                  <input
                    value={newAccountId}
                    onChange={(e) => setNewAccountId(e.target.value)}
                    placeholder="例如：9f8e7d6c5b4a3210fedcba9876543210"
                    maxLength={32}
                  />
                </label>

                <label className={pageStyles.filledField}>
                  <span>Bucket Name（必填 · 3–63 位小写字母/数字/连字符）</span>
                  <input
                    value={newBucketName}
                    onChange={(e) => setNewBucketName(e.target.value)}
                    placeholder="例如：nanobanana-prod-media"
                    maxLength={63}
                  />
                </label>

                <div className={`${pageStyles.filledField} ${pageStyles.fullSpan}`}>
                  <span>辖区 Jurisdiction（可选 · 默认 default）</span>
                  <SegmentedRail<BucketJurisdiction>
                    label="R2 辖区"
                    value={newJurisdiction}
                    options={[
                      { value: 'default', label: 'default (默认)' },
                      { value: 'eu', label: 'eu (欧盟)' },
                      { value: 'fedramp', label: 'fedramp' },
                    ]}
                    onChange={setNewJurisdiction}
                  />
                </div>

                <label className={pageStyles.filledField}>
                  <span>R2 Access Key ID（必填 · 只写加密）</span>
                  <input
                    type={showCreateSecrets ? 'text' : 'password'}
                    autoComplete="off"
                    value={newAccessKeyId}
                    onChange={(e) => setNewAccessKeyId(e.target.value)}
                    placeholder="输入 S3 Access Key ID"
                  />
                </label>

                <label className={pageStyles.filledField}>
                  <span>R2 Secret Access Key（必填 · 只写加密）</span>
                  <input
                    type={showCreateSecrets ? 'text' : 'password'}
                    autoComplete="off"
                    value={newSecretAccessKey}
                    onChange={(e) => setNewSecretAccessKey(e.target.value)}
                    placeholder="输入 S3 Secret Access Key"
                  />
                </label>

                <label className={`${pageStyles.filledField} ${pageStyles.fullSpan}`}>
                  <span>Analytics Token（可选 · 需 Account → Account Analytics → Read 权限）</span>
                  <input
                    type={showCreateSecrets ? 'text' : 'password'}
                    autoComplete="off"
                    value={newAnalyticsToken}
                    onChange={(e) => setNewAnalyticsToken(e.target.value)}
                    placeholder="留空仍可正常读写图片，仅暂不查询 Cloudflare 官方整桶用量"
                  />
                </label>
              </div>

              <div className={pageStyles.detailFooter}>
                <RippleButton
                  type="button"
                  className={pageStyles.tonalBtn}
                  onClick={() => setShowCreateSecrets((v) => !v)}
                >
                  <Icon name={showCreateSecrets ? 'eye-off' : 'eye'} size={14} />
                  <span>{showCreateSecrets ? '隐藏凭据输入' : '明文核对输入'}</span>
                </RippleButton>
                <RippleButton
                  type="button"
                  className={pageStyles.primaryBtn}
                  onClick={handleCreateBucket}
                >
                  <Icon name="check" size={15} />
                  <span>登记 R2 私有桶</span>
                </RippleButton>
              </div>
            </>
          ) : (
            <>
              <div className={pageStyles.detailHeader}>
                <div>
                  <span className={pageStyles.pageEyebrow}>BUCKET CONFIGURATION &amp; TELEMETRY</span>
                  <h2>{selectedBucket.bucketName}</h2>
                </div>
                <div className={pageStyles.toolbarRight}>
                  {selectedBucket.id !== committedPolicy.activeBucketId ? (
                    <RippleButton
                      type="button"
                      className={pageStyles.tonalBtn}
                      onClick={() => {
                        setDraftBucketId(selectedBucket.id)
                        onNotify({
                          tone: 'info',
                          message: `已将「${selectedBucket.bucketName}」填入上方写入策略草稿，请确认并点击「保存写入策略」使其生效。`,
                        })
                      }}
                    >
                      <LabIcon name="cloud" size={14} />
                      <span>设为写入目标草稿</span>
                    </RippleButton>
                  ) : (
                    <span className={styles.activeWriteChip}>当前正在接收新图写入</span>
                  )}
                </div>
              </div>

              {justCreatedBucketId === selectedBucket.id ? (
                <div className={`${styles.scopeNotice} ${styles.scopeNoticeHighlight}`} role="status">
                  <Icon name="sparkles" size={15} />
                  <span>
                    新桶已登记完成但<strong>尚未启用</strong>。如需新生成的图片写入此桶，请点击右侧「设为写入目标草稿」并在上方策略卡片保存。
                  </span>
                </div>
              ) : null}

              {/* Immutable Bucket Identity */}
              <div className={styles.identityBar}>
                <div className={styles.identityItem}>
                  <span>Account ID（不可修改）</span>
                  <code title={selectedBucket.accountId}>{selectedBucket.accountId}</code>
                </div>
                <div className={styles.identityItem}>
                  <span>Bucket Name（不可修改）</span>
                  <code>{selectedBucket.bucketName}</code>
                </div>
                <div className={styles.identityItem}>
                  <span>Jurisdiction（不可修改）</span>
                  <code>{JURISDICTION_LABELS[selectedBucket.jurisdiction]}</code>
                </div>
              </div>

              {/* Credential Existence Booleans */}
              <div className={styles.credBoolRow}>
                <span className={selectedBucket.hasAccessKeyId ? styles.credTrueChip : styles.credFalseChip}>
                  <Icon name={selectedBucket.hasAccessKeyId ? 'check' : 'close'} size={12} />
                  <span>hasAccessKeyId: {String(selectedBucket.hasAccessKeyId)}</span>
                </span>
                <span className={selectedBucket.hasSecretAccessKey ? styles.credTrueChip : styles.credFalseChip}>
                  <Icon name={selectedBucket.hasSecretAccessKey ? 'check' : 'close'} size={12} />
                  <span>hasSecretAccessKey: {String(selectedBucket.hasSecretAccessKey)}</span>
                </span>
                <span className={selectedBucket.hasAnalyticsToken ? styles.credTrueChip : styles.credFalseChip}>
                  <Icon name={selectedBucket.hasAnalyticsToken ? 'check' : 'close'} size={12} />
                  <span>hasAnalyticsToken: {String(selectedBucket.hasAnalyticsToken)}</span>
                </span>
              </div>

              {/* Dual-Perspective Bucket Usage (/api/admin/storage/buckets/{id}/usage) */}
              <div className={styles.usageSection}>
                <div className={styles.usageHead}>
                  <div>
                    <h3>同桶双口径用量对照</h3>
                    <p>区分「本应用有效图库统计」与「Cloudflare 官方整桶最近 31 天样本」，互不替代。</p>
                  </div>
                  <RippleButton
                    type="button"
                    className={pageStyles.tonalBtn}
                    disabled={isRefreshingUsage}
                    onClick={() => {
                      if (usageTimerRef.current !== null) window.clearTimeout(usageTimerRef.current)
                      setIsRefreshingUsage(true)
                      usageTimerRef.current = window.setTimeout(() => {
                        setFallbackSampledAt(new Date().toISOString())
                        setIsRefreshingUsage(false)
                        onNotify({ tone: 'info', message: `已刷新「${selectedBucket.bucketName}」双口径用量。` })
                      }, 750)
                    }}
                  >
                    <LabIcon name="refresh" size={14} />
                    <span>{isRefreshingUsage ? '正在查询…' : '刷新用量'}</span>
                  </RippleButton>
                </div>

                {/* Design Lab Demo Switcher for all 5 Cloudflare Usage Statuses */}
                <div className={styles.simBar} role="group" aria-label="模拟 Cloudflare 官方状态">
                  <span className={styles.simBarLabel}>Lab 状态模拟：</span>
                  {(
                    [
                      { id: null, label: '桶默认状态' },
                      { id: 'available', label: 'available' },
                      { id: 'not_configured', label: 'not_configured' },
                      { id: 'forbidden', label: 'forbidden' },
                      { id: 'no_data', label: 'no_data' },
                      { id: 'unavailable', label: 'unavailable' },
                    ] as const
                  ).map((opt) => (
                    <RippleButton
                      key={String(opt.id)}
                      type="button"
                      aria-pressed={cfStatusOverride === opt.id}
                      className={`${styles.simChipBtn} ${cfStatusOverride === opt.id ? styles.simChipBtnActive : ''}`}
                      onClick={() => setCfStatusOverride(opt.id)}
                    >
                      {opt.label}
                    </RippleButton>
                  ))}
                </div>

                {isRefreshingUsage ? (
                  <div className={styles.usageDualGrid} role="status" aria-busy="true">
                    <div className={styles.usageCard}>
                      <SkeletonBlock variant="text" width={140} height={14} />
                      <div className={styles.usageMetricRow}>
                        <SkeletonBlock variant="pill" width={88} height={28} />
                        <SkeletonBlock variant="pill" width={106} height={28} staggerIndex={1} />
                      </div>
                      <SkeletonTextStack widths={['92%', '70%']} lineHeight={11} />
                    </div>
                    <div className={styles.usageCard}>
                      <SkeletonBlock variant="text" width={168} height={14} />
                      <div className={styles.usageMetricThree}>
                        <SkeletonBlock variant="pill" width="90%" height={26} />
                        <SkeletonBlock variant="pill" width="90%" height={26} staggerIndex={1} />
                        <SkeletonBlock variant="pill" width="90%" height={26} staggerIndex={2} />
                      </div>
                      <SkeletonTextStack widths={['88%', '64%']} lineHeight={11} />
                    </div>
                  </div>
                ) : activeUsage && effectiveCloudflare ? (
                  <div className={styles.usageDualGrid}>
                    {/* Card A: Application Effective Usage */}
                    <div className={styles.usageCard}>
                      <div className={styles.usageCardTop}>
                        <span className={styles.usageCardTitle}>
                          <LabIcon name="database" size={15} />
                          <span>本应用有效图库用量 (`application`)</span>
                        </span>
                        <span className={pageStyles.statusOn}>始终可算</span>
                      </div>
                      <div className={styles.usageMetricRow}>
                        <div className={styles.usageMetric}>
                          <span>有效图片数 (`imageCount`)</span>
                          <strong>{activeUsage.application.imageCount} 张</strong>
                        </div>
                        <div className={styles.usageMetric}>
                          <span>占用总字节 (`totalBytes`)</span>
                          <strong>{formatBytes(activeUsage.application.totalBytes)}</strong>
                        </div>
                      </div>
                      <p className={styles.usageFootNote}>
                        仅计算本应用在该桶仍有效的图库图；不含回退本地、已过期或待清理对象。
                      </p>
                    </div>

                    {/* Card B: Cloudflare Official Bucket Sample */}
                    <div className={styles.usageCard}>
                      <div className={styles.usageCardTop}>
                        <span className={styles.usageCardTitle}>
                          <LabIcon name="cloud" size={15} />
                          <span>Cloudflare 官方样本 (`cloudflare`)</span>
                        </span>
                        <span
                          className={
                            effectiveCloudflare.status === 'available'
                              ? pageStyles.statusOn
                              : effectiveCloudflare.status === 'forbidden' ||
                                  effectiveCloudflare.status === 'unavailable'
                                ? pageStyles.statusOff
                                : styles.standbyChip
                          }
                        >
                          {effectiveCloudflare.status}
                        </span>
                      </div>

                      {effectiveCloudflare.status === 'available' ? (
                        <>
                          <div className={styles.usageMetricThree}>
                            <div className={styles.usageMetric}>
                              <span>对象内容 `payloadBytes`</span>
                              <strong>{formatBytes(effectiveCloudflare.payloadBytes)}</strong>
                            </div>
                            <div className={`${styles.usageMetric} ${styles.usageMetricMuted}`}>
                              <span>元数据 `metadataBytes`</span>
                              <strong>{formatBytes(effectiveCloudflare.metadataBytes)}</strong>
                            </div>
                            <div className={`${styles.usageMetric} ${styles.usageMetricMuted}`}>
                              <span>整桶对象 `objectCount`</span>
                              <strong>{effectiveCloudflare.objectCount} 个</strong>
                            </div>
                          </div>
                          <p className={styles.usageFootNote}>
                            官方采样时间 (`sampledAt`)：
                            <strong>{formatLocalDateTime(effectiveCloudflare.sampledAt, true)}</strong>
                            （最近 31 天内最新，非页面请求时间）。对比图片字节请使用 `payloadBytes`；其他应用对象、清理时差与指标延迟均可造成差异，勿把差值当作泄漏。
                          </p>
                        </>
                      ) : (
                        <div className={styles.cfStateBox}>
                          <strong>
                            {CF_STATUS_META[effectiveCloudflare.status].title}（数值为 —，不显示为 0）
                          </strong>
                          <p>{CF_STATUS_META[effectiveCloudflare.status].desc}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Credential Rotation & Analytics Token (PATCH /api/admin/storage/buckets/{id}) */}
              <div className={styles.rotateSection}>
                <div className={pageStyles.detailHeader}>
                  <div>
                    <span className={pageStyles.pageEyebrow}>PATCH /api/admin/storage/buckets/{'{id}'}</span>
                    <h3 style={{ margin: '2px 0 0', fontSize: 15 }}>凭据轮换与统计令牌管理（只写不回显）</h3>
                  </div>
                  <RippleButton
                    type="button"
                    className={styles.smallTonalBtn}
                    onClick={() => setShowRotateSecrets((v) => !v)}
                  >
                    <Icon name={showRotateSecrets ? 'eye-off' : 'eye'} size={13} />
                    <span>{showRotateSecrets ? '隐藏输入' : '显示输入'}</span>
                  </RippleButton>
                </div>

                {rotateError ? (
                  <div className={styles.inlineErrorBanner} role="alert">
                    <span>{rotateError}</span>
                  </div>
                ) : null}

                <div className={pageStyles.formGrid}>
                  <label className={pageStyles.filledField}>
                    <span>新 Access Key ID（留空保持不变，不回显旧值）</span>
                    <input
                      type={showRotateSecrets ? 'text' : 'password'}
                      autoComplete="off"
                      value={rotAccessKeyId}
                      onChange={(e) => setRotAccessKeyId(e.target.value)}
                      placeholder="留空 = 请求体省略 accessKeyId"
                    />
                  </label>
                  <label className={pageStyles.filledField}>
                    <span>新 Secret Access Key（留空保持不变）</span>
                    <input
                      type={showRotateSecrets ? 'text' : 'password'}
                      autoComplete="off"
                      value={rotSecretAccessKey}
                      onChange={(e) => setRotSecretAccessKey(e.target.value)}
                      placeholder="留空 = 请求体省略 secretAccessKey"
                    />
                  </label>
                  <label className={`${pageStyles.filledField} ${pageStyles.fullSpan}`}>
                    <span>新 Analytics Token（可选 · 需 Account Analytics Read 权限）</span>
                    <input
                      type={showRotateSecrets ? 'text' : 'password'}
                      autoComplete="off"
                      disabled={clearAnalyticsToken}
                      value={clearAnalyticsToken ? '' : rotAnalyticsToken}
                      onChange={(e) => setRotAnalyticsToken(e.target.value)}
                      placeholder={
                        clearAnalyticsToken
                          ? '已勾选显式清除，将发送 analyticsToken: null'
                          : '留空 = 保持现有统计令牌不变'
                      }
                    />
                  </label>
                </div>

                <div className={styles.clearTokenRow}>
                  <div className={styles.clearTokenInfo}>
                    <strong>显式清除可选统计令牌（`analyticsToken: null`）</strong>
                    <span>仅用于主动撤除 Cloudflare Analytics 查询；普通留空不会清除已有令牌。</span>
                  </div>
                  <RippleButton
                    type="button"
                    aria-pressed={clearAnalyticsToken}
                    className={`${pageStyles.switchPill} ${clearAnalyticsToken ? pageStyles.switchPillOn : ''}`}
                    onClick={() => setClearAnalyticsToken((v) => !v)}
                  >
                    <span className={pageStyles.switchThumb} />
                    <span>{clearAnalyticsToken ? '将清除令牌' : '保持 / 轮换'}</span>
                  </RippleButton>
                </div>

                <div className={styles.patchPreviewStrip}>
                  <LabIcon name="key" size={13} />
                  <span>
                    {patchKeysPreview.length > 0
                      ? `本次 PATCH 将提交字段：${patchKeysPreview.join(' · ')}（绝不传入空串或掩码）`
                      : '尚未填写待轮换字段（未填项将从 PATCH 中省略）'}
                  </span>
                </div>

                <div className={pageStyles.detailFooter}>
                  <span className={pageStyles.monoMeta}>
                    凭据不写入 URL、本地缓存或日志；切回本地后仍支持对旧桶轮换密钥。
                  </span>
                  <RippleButton
                    type="button"
                    className={pageStyles.primaryBtn}
                    onClick={handleRotateCredentials}
                  >
                    <Icon name="check" size={15} />
                    <span>保存凭据变更</span>
                  </RippleButton>
                </div>
              </div>

              {/* Safe Deletion Zone (DELETE /api/admin/storage/buckets/{id}) */}
              <div className={styles.dangerZone}>
                <div className={styles.dangerZoneTop}>
                  <div>
                    <strong style={{ fontSize: 13.5 }}>移除此 R2 桶配置</strong>
                    <p>
                      即使本应用有效图片数为 0，仍可能有待删对象或等待二次核查的写入（约 1 天复查）；是否可删以服务端 409 校验为准，勿仅凭用量预判。
                    </p>
                  </div>
                  <div className={pageStyles.toolbarRight}>
                    <RippleButton
                      type="button"
                      aria-pressed={simulateDeleteNetworkError}
                      className={`${styles.simChipBtn} ${simulateDeleteNetworkError ? styles.simChipBtnActive : ''}`}
                      onClick={() => {
                        setSimulateDeleteNetworkError((v) => !v)
                        setDeleteFeedback(null)
                      }}
                    >
                      {simulateDeleteNetworkError ? '已开启：模拟网络 502' : '模拟网络失败'}
                    </RippleButton>
                    {confirmDeleteId === selectedBucket.id ? (
                      <>
                        <RippleButton
                          type="button"
                          className={styles.smallTonalBtn}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          取消
                        </RippleButton>
                        <RippleButton
                          type="button"
                          className={pageStyles.dangerTonalBtn}
                          onClick={() => handleDeleteBucket(selectedBucket)}
                        >
                          <Icon name="trash" size={14} />
                          <span>确认删除配置</span>
                        </RippleButton>
                      </>
                    ) : (
                      <RippleButton
                        type="button"
                        className={pageStyles.dangerTonalBtn}
                        onClick={() => {
                          setDeleteFeedback(null)
                          setConfirmDeleteId(selectedBucket.id)
                        }}
                      >
                        <Icon name="trash" size={14} />
                        <span>删除桶配置</span>
                      </RippleButton>
                    )}
                  </div>
                </div>

                {deleteFeedback ? (
                  <div
                    className={
                      deleteFeedback.kind === '409'
                        ? styles.inlineWarnBanner
                        : styles.inlineErrorBanner
                    }
                    role="alert"
                  >
                    <span>{deleteFeedback.message}</span>
                    {deleteFeedback.kind === 'network' ? (
                      <RippleButton
                        type="button"
                        className={styles.smallTonalBtn}
                        onClick={() => handleDeleteBucket(selectedBucket)}
                      >
                        重试删除
                      </RippleButton>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
