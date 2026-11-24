import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { SegmentedRail, StudioSelect } from '../studio/Controls'
import { LabIcon } from '../studio/LabIcon'
import { RippleButton } from '../studio/Ripple'
import { SkeletonBlock, SkeletonTextStack } from '../studio/Skeleton'
import { backendRequest, backendErrorMessage, BackendRequestError } from '../services/backendClient'
import { useNotify } from '../studio/useNotify'
import type { BucketJurisdiction, BucketUsage, CloudflareUsageStatus, R2BucketInfo, StorageSettings } from '@nanobanana/shared/types/studio'
import {
  buildBucketRotatePayload,
  formatBytes,
  formatLocalDateTime,
  formatRetentionPolicyText,
  validateAccountId,
  validateBucketName,
  validateCredentialInput,
  validateRetentionDays,
} from '../utils/retentionFormat'
import pageStyles from '../studio/Pages.module.css'
import styles from '../studio/AdminModules.module.css'

const LOCAL_BUCKET_VALUE = '__local__'

type RetentionPreset = 'permanent' | '7' | '30' | '90' | 'custom'

const JURISDICTION_LABELS: Record<BucketJurisdiction, string> = {
  default: '默认',
  eu: '欧盟 (EU)',
  fedramp: 'FedRAMP',
}

const CF_STATUS_META: Record<
  Exclude<CloudflareUsageStatus, 'available'>,
  { label: string; title: string; desc: string }
> = {
  not_configured: {
    label: '未配令牌',
    title: '未配置统计令牌',
    desc: '不影响存图和读图；填了统计令牌才能看 Cloudflare 官方桶大小。',
  },
  forbidden: {
    label: '无权限',
    title: '令牌没有读取权限',
    desc: '需要 Account Analytics Read 权限；不影响正常存取图片。',
  },
  no_data: {
    label: '暂无数据',
    title: '近 31 天暂无统计数据',
    desc: '新桶或刚上传的文件会有统计延迟，不代表实际为 0。',
  },
  unavailable: {
    label: '暂不可用',
    title: '暂时查不到官方数据',
    desc: '连接 Cloudflare 超时或受限，稍后再试；不影响正常存图。',
  },
}

function resolveRetentionPreset(days: number | null): RetentionPreset {
  if (days === null) return 'permanent'
  if (days === 7) return '7'
  if (days === 30) return '30'
  if (days === 90) return '90'
  return 'custom'
}


const storagePath = '/admin/storage'
type BucketList = { buckets: R2BucketInfo[] }

export function AdminStoragePanel() {
  const [initial, setInitial] = useState<{ policy: StorageSettings; buckets: R2BucketInfo[] } | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const options = { signal: controller.signal }
    Promise.all([
      backendRequest<StorageSettings>(storagePath + '/settings', options),
      backendRequest<BucketList>(storagePath + '/buckets', options),
    ]).then(([policy, list]) => {
      if (!controller.signal.aborted) setInitial({ policy, buckets: list.buckets })
    }).catch(e => { if (!controller.signal.aborted) setError(backendErrorMessage(e)) })
    return () => controller.abort()
  }, [revision])
  function reload() {
    setError('')
    setInitial(null)
    setRevision(v => v + 1)
  }
  if (error) return <div role="alert" className={styles.inlineErrorBanner}><span>{error}</span><RippleButton type="button" className={styles.smallTonalBtn} onClick={reload}>重试</RippleButton></div>
  if (initial) return <StorageEditor initial={initial} reload={reload} />
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

function StorageEditor({ initial, reload }: { initial: { policy: StorageSettings; buckets: R2BucketInfo[] }; reload: () => void }) {
  const onNotify = useNotify()
  const [busy, setBusy] = useState(false)
  const [committedPolicy, setCommittedPolicy] = useState<StorageSettings>(initial.policy)
  const [draftBucketId, setDraftBucketId] = useState<string | null>(initial.policy.activeBucketId)
  const [retentionPreset, setRetentionPreset] = useState<RetentionPreset>(() =>
    resolveRetentionPreset(initial.policy.retentionDays),
  )
  const [customDaysInput, setCustomDaysInput] = useState(
    initial.policy.retentionDays ? String(initial.policy.retentionDays) : '14',
  )

  const [buckets, setBuckets] = useState<R2BucketInfo[]>(initial.buckets)
  const [selectedBucketId, setSelectedBucketId] = useState<string | 'new'>(initial.buckets[0]?.id ?? 'new')
  const [justCreatedBucketId, setJustCreatedBucketId] = useState<string | null>(null)
  const [usageByBucket, setUsageByBucket] = useState<Record<string, BucketUsage>>({})

  const [usageRevision, setUsageRevision] = useState(0)
  const [usageResult, setUsageResult] = useState<{ id: string; revision: number; error?: string }>()
  useEffect(() => {
    if (selectedBucketId === 'new') return
    const controller = new AbortController()
    backendRequest<BucketUsage>(`${storagePath}/buckets/${encodeURIComponent(selectedBucketId)}/usage`, { signal: controller.signal })
      .then(usage => {
        if (controller.signal.aborted) return
        setUsageByBucket(old => ({ ...old, [selectedBucketId]: usage }))
        setUsageResult({ id: selectedBucketId, revision: usageRevision })
      }).catch(e => {
        if (!controller.signal.aborted) setUsageResult({ id: selectedBucketId, revision: usageRevision, error: backendErrorMessage(e) })
      })
    return () => controller.abort()
  }, [selectedBucketId, usageRevision])
  const isRefreshingUsage = usageResult?.id !== selectedBucketId || usageResult.revision !== usageRevision
  // Create bucket form state
  const [newAccountId, setNewAccountId] = useState('')
  const [newBucketName, setNewBucketName] = useState('')
  const [newJurisdiction, setNewJurisdiction] = useState<BucketJurisdiction>('default')
  const [newAccessKeyId, setNewAccessKeyId] = useState('')
  const [newSecretAccessKey, setNewSecretAccessKey] = useState('')
  const [newAnalyticsToken, setNewAnalyticsToken] = useState('')
  const [showCreateSecrets, setShowCreateSecrets] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Credential rotation form state
  const [rotAccessKeyId, setRotAccessKeyId] = useState('')
  const [rotSecretAccessKey, setRotSecretAccessKey] = useState('')
  const [rotAnalyticsToken, setRotAnalyticsToken] = useState('')
  const [clearAnalyticsToken, setClearAnalyticsToken] = useState(false)
  const [showRotateSecrets, setShowRotateSecrets] = useState(false)
  const [rotateError, setRotateError] = useState<string | null>(null)

  // Safe deletion state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleteFeedback, setDeleteFeedback] = useState<{
    kind: '409' | 'network'
    message: string
  } | null>(null)

  const retentionValidation =
    retentionPreset === 'permanent'
      ? { valid: true, value: null, error: null }
      : retentionPreset === 'custom'
        ? customDaysInput.trim() === ''
          ? { valid: false, value: null, error: '请输入 1–3650 之间的天数' }
          : validateRetentionDays(customDaysInput)
        : { valid: true, value: Number(retentionPreset), error: null }

  const isPolicyDirty =
    draftBucketId !== committedPolicy.activeBucketId ||
    (retentionValidation.valid && retentionValidation.value !== committedPolicy.retentionDays)

  const activePolicyBucket = buckets.find((b) => b.id === committedPolicy.activeBucketId) ?? null
  const selectedBucket =
    selectedBucketId === 'new' ? null : buckets.find((b) => b.id === selectedBucketId) ?? buckets[0] ?? null


  const activeUsage = selectedBucket && usageByBucket[selectedBucket.id]
  const effectiveCloudflare = activeUsage?.cloudflare
  function resetBucketActionForms() {
    setRotAccessKeyId('')
    setShowRotateSecrets(false)
    setRotSecretAccessKey('')
    setRotAnalyticsToken('')
    setClearAnalyticsToken(false)
    setRotateError(null)
    setConfirmDeleteId(null)
    setDeleteFeedback(null)
  }

  function handleSelectBucket(id: string | 'new') {
    setUsageRevision(v => v + 1)
    setSelectedBucketId(id)
    setCreateError(null)
    resetBucketActionForms()
  }

  async function handleSavePolicy() {
    if (!retentionValidation.valid) {
      onNotify({ tone: 'warning', message: retentionValidation.error ?? '保留天数无效' })
      return
    }
    const next: StorageSettings = {
      activeBucketId: draftBucketId,
      retentionDays: retentionValidation.value,
    }

    setBusy(true)
    let saved: StorageSettings
    try {
      saved = await backendRequest<StorageSettings>(storagePath + '/settings', { method: 'PUT', body: JSON.stringify(next) })
      setCommittedPolicy(saved)
      setDraftBucketId(saved.activeBucketId)
      setRetentionPreset(resolveRetentionPreset(saved.retentionDays))
      if (saved.retentionDays !== null) setCustomDaysInput(String(saved.retentionDays))
      if (saved.activeBucketId === justCreatedBucketId) setJustCreatedBucketId(null)
    } catch (e) {
      onNotify({ tone: 'warning', message: backendErrorMessage(e) })
      return
    } finally { setBusy(false) }
    const targetLabel = saved.activeBucketId
      ? buckets.find((b) => b.id === saved.activeBucketId)?.bucketName ?? saved.activeBucketId
      : '服务器本地'
    onNotify({
      tone: 'success',
      message: `已保存：新图存到 ${targetLabel}，${formatRetentionPolicyText(saved.retentionDays)}`,
    })
  }

  async function handleCreateBucket() {
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
      const tokenErr = validateCredentialInput(newAnalyticsToken, '统计令牌')
      if (tokenErr) {
        setCreateError(tokenErr)
        return
      }
    }

    const normalizedAccount = newAccountId.trim().toLowerCase()

    const normalizedName = newBucketName.trim()
    let created: R2BucketInfo
    setBusy(true)
    try {
      const response = await backendRequest<{bucket: R2BucketInfo}>(storagePath + '/buckets', {
        method: 'POST',
        body: JSON.stringify({ accountId: normalizedAccount, bucketName: normalizedName, jurisdiction: newJurisdiction,
          accessKeyId: newAccessKeyId, secretAccessKey: newSecretAccessKey, ...(newAnalyticsToken && { analyticsToken: newAnalyticsToken }) }),
      })
      created = response.bucket
    } catch (e) {
      setCreateError(backendErrorMessage(e))
      return
    } finally { setBusy(false) }
    const createdId = created.id
    setBuckets((prev) => [...prev, created])
    setCreateError(null)
    setNewAccountId('')
    setNewBucketName('')
    setNewJurisdiction('default')
    setNewAccessKeyId('')
    setShowCreateSecrets(false)
    setNewSecretAccessKey('')
    setNewAnalyticsToken('')
    setJustCreatedBucketId(createdId)
    setSelectedBucketId(createdId)
    resetBucketActionForms()

    onNotify({
      tone: 'success',
      message: `已添加「${created.bucketName}」（暂未启用，如需使用请在上方设为写入位置）`,
    })
  }

  async function handleRotateCredentials() {
    if (!selectedBucket) return
    const updatedLabels: string[] = []
    if (rotAccessKeyId.length > 0) {
      const err = validateCredentialInput(rotAccessKeyId, 'Access Key ID')
      if (err) {
        setRotateError(err)
        return
      }
      updatedLabels.push('Access Key ID')
    }
    if (rotSecretAccessKey.length > 0) {
      const err = validateCredentialInput(rotSecretAccessKey, 'Secret Access Key')
      if (err) {
        setRotateError(err)
        return
      }
      updatedLabels.push('Secret Access Key')
    }
    if (clearAnalyticsToken) {
      updatedLabels.push('清除统计令牌')
    } else if (rotAnalyticsToken.length > 0) {
      const err = validateCredentialInput(rotAnalyticsToken, '统计令牌')
      if (err) {
        setRotateError(err)
        return
      }
      updatedLabels.push('统计令牌')
    }

    if (updatedLabels.length === 0) {
      setRotateError('至少填一项要更新的密钥，或者选择清除统计令牌。')
      return
    }

    setRotateError(null)

    setBusy(true)
    try {
      const { bucket } = await backendRequest<{ bucket: R2BucketInfo }>(`${storagePath}/buckets/${encodeURIComponent(selectedBucket.id)}`, {
        method: 'PATCH', body: JSON.stringify(buildBucketRotatePayload(rotAccessKeyId, rotSecretAccessKey, rotAnalyticsToken, clearAnalyticsToken)),
      })
      setBuckets(old => old.map(b => b.id === bucket.id ? bucket : b))
      setUsageRevision(v => v + 1)
    } catch (e) {
      setRotateError(backendErrorMessage(e))
      return
    } finally { setBusy(false) }
    setRotAccessKeyId('')
    setShowRotateSecrets(false)
    setRotSecretAccessKey('')
    setRotAnalyticsToken('')
    setClearAnalyticsToken(false)

    onNotify({
      tone: 'success',
      message: `已保存「${selectedBucket.bucketName}」密钥更改（${updatedLabels.join('、')}）`,
    })
  }

  async function handleDeleteBucket(bucket: R2BucketInfo) {

    setBusy(true)
    try {
      await backendRequest(`${storagePath}/buckets/${encodeURIComponent(bucket.id)}`, { method: 'DELETE' })
    } catch (e) {
      const status = e instanceof BackendRequestError && e.isApiError ? e.appError.status : undefined
      if (status === 404) {
        onNotify({ tone: 'warning', message: '该桶配置已不存在，正在刷新列表。' })
        reload()
      } else {
        setDeleteFeedback({ kind: status === 409 ? '409' : 'network', message: backendErrorMessage(e) })
      }
      return
    } finally { setBusy(false) }
    resetBucketActionForms()
    const remaining = buckets.filter((b) => b.id !== bucket.id)
    setBuckets(remaining)
    setConfirmDeleteId(null)
    setDeleteFeedback(null)
    if (draftBucketId === bucket.id) setDraftBucketId(null)
    if (justCreatedBucketId === bucket.id) setJustCreatedBucketId(null)
    setSelectedBucketId(remaining[0]?.id ?? 'new')
    onNotify({
      tone: 'success',
      message: `已移除「${bucket.bucketName}」配置`,
    })
  }

  const pendingChangeSummary: string[] = []
  if (rotAccessKeyId.length > 0) pendingChangeSummary.push('Access Key ID')
  if (rotSecretAccessKey.length > 0) pendingChangeSummary.push('Secret Access Key')
  if (clearAnalyticsToken) pendingChangeSummary.push('清除统计令牌')
  else if (rotAnalyticsToken.length > 0) pendingChangeSummary.push('统计令牌')

  const bucketSelectOptions = [
    { value: LOCAL_BUCKET_VALUE, label: '服务器本地存储' },
    ...buckets.map((b) => ({
      value: b.id,
      label: `R2 · ${b.bucketName} (${b.jurisdiction})`,
    })),
  ]

  return (
    <fieldset disabled={busy} className={styles.moduleStack} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {/* 1. New-Image Storage Policy */}
      <section className={styles.policyCard} aria-label="新图默认存储">
        <div className={styles.policyHeader}>
          <div>
            <span className={pageStyles.pageEyebrow}>STORAGE POLICY</span>
            <h2>新图默认存储</h2>
            <p className={styles.policySub}>
              只影响之后新生成的图片，不会迁移或改期已有图片。切回本地后，旧桶仍可读图、删图和轮换密钥。
            </p>
          </div>
          <div className={styles.policyBadgeCluster}>
            <span className={styles.activeTargetPill}>
              <LabIcon name={activePolicyBucket ? 'cloud' : 'hard-drive'} size={14} />
              <span>
                当前：
                {activePolicyBucket ? activePolicyBucket.bucketName : '本地存储'} ·{' '}
                {formatRetentionPolicyText(committedPolicy.retentionDays)}
              </span>
            </span>
            {isPolicyDirty ? <span className={styles.dirtyPill}>未保存</span> : null}
          </div>
        </div>

        <div className={styles.policyGrid}>
          <div className={styles.policyField}>
            <div className={styles.policyFieldLabel}>
              <span>写入位置</span>
              <span className={pageStyles.monoMeta}>
                {draftBucketId ? 'R2 私有桶' : '本地磁盘'}
              </span>
            </div>
            <StudioSelect
              label="写入位置"
              value={draftBucketId ?? LOCAL_BUCKET_VALUE}
              options={bucketSelectOptions}
              onChange={(val) => setDraftBucketId(val === LOCAL_BUCKET_VALUE ? null : val)}
            />
          </div>

          <div className={styles.policyField}>
            <div className={styles.policyFieldLabel}>
              <span>保留时间</span>
              <span className={pageStyles.monoMeta}>
                {retentionValidation.valid
                  ? formatRetentionPolicyText(retentionValidation.value)
                  : '格式有误'}
              </span>
            </div>
            <SegmentedRail<RetentionPreset>
              label="默认保留时间"
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
                    placeholder="输入 1–3650"
                    aria-label="自定义保留天数"
                  />
                </label>
                <span className={styles.unitTag}>天</span>
              </div>
            ) : null}
            {!retentionValidation.valid ? (
              <span className={styles.fieldErrorText}>{retentionValidation.error}</span>
            ) : null}
          </div>
        </div>

        <div className={styles.policyFooter}>
          <span className={pageStyles.monoMeta}>切回本地不影响旧桶图片读取和删图</span>
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
              还原
            </RippleButton>
            <RippleButton
              type="button"
              className={pageStyles.primaryBtn}
              disabled={!retentionValidation.valid || !isPolicyDirty}
              onClick={handleSavePolicy}
            >
              <Icon name="check" size={15} />
              <span>保存设置</span>
            </RippleButton>
          </div>
        </div>
      </section>

      {/* 2. R2 Buckets Master-Detail */}
      <div className={pageStyles.splitWorkspace}>
        <section className={pageStyles.masterRail} aria-label="R2 私有桶列表">
          <div className={pageStyles.masterHead}>
            <strong>R2 私有桶</strong>
            <span>{buckets.length} 个</span>
          </div>

          <RippleButton
            type="button"
            className={pageStyles.primaryBtnFull}
            onClick={() => handleSelectBucket('new')}
          >
            <Icon name="plus" size={15} />
            <span>添加私有桶</span>
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
                      {isActiveTarget ? '当前使用' : '备用'}
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
                </RippleButton>
              )
            })}
          </div>
        </section>

        <section className={pageStyles.detailCard} aria-label="私有桶详情">
          {selectedBucketId === 'new' || !selectedBucket ? (
            <>
              <div className={pageStyles.detailHeader}>
                <div>
                  <span className={pageStyles.pageEyebrow}>ADD R2 BUCKET</span>
                  <h2>添加 R2 私有桶</h2>
                </div>
                {buckets.length > 0 ? (
                  <RippleButton
                    type="button"
                    className={pageStyles.tonalBtn}
                    onClick={() => handleSelectBucket(buckets[0].id)}
                  >
                    返回列表
                  </RippleButton>
                ) : null}
              </div>

              <div className={`${styles.scopeNotice} ${styles.scopeNoticeHighlight}`}>
                <Icon name="alert-circle" size={16} />
                <span>
                  请先在 Cloudflare 建好私有桶。添加后不会自动启用，需要在上方切换并保存才会写入新图。
                </span>
              </div>

              {createError ? (
                <div className={styles.inlineErrorBanner} role="alert">
                  <span>{createError}</span>
                </div>
              ) : null}

              <div className={pageStyles.formGrid}>
                <label className={pageStyles.filledField}>
                  <span>Account ID</span>
                  <input
                    value={newAccountId}
                    onChange={(e) => setNewAccountId(e.target.value)}
                    placeholder="32 位十六进制字符"
                    maxLength={32}
                  />
                </label>

                <label className={pageStyles.filledField}>
                  <span>桶名称</span>
                  <input
                    value={newBucketName}
                    onChange={(e) => setNewBucketName(e.target.value)}
                    placeholder="例如：nanobanana-media"
                    maxLength={63}
                  />
                </label>

                <div className={`${pageStyles.filledField} ${pageStyles.fullSpan}`}>
                  <span>区域 (Jurisdiction)</span>
                  <SegmentedRail<BucketJurisdiction>
                    label="R2 区域"
                    value={newJurisdiction}
                    options={[
                      { value: 'default', label: '默认' },
                      { value: 'eu', label: '欧盟 (EU)' },
                      { value: 'fedramp', label: 'FedRAMP' },
                    ]}
                    onChange={setNewJurisdiction}
                  />
                </div>

                <label className={pageStyles.filledField}>
                  <span>Access Key ID</span>
                  <input
                    type={showCreateSecrets ? 'text' : 'password'}
                    autoComplete="off"
                    value={newAccessKeyId}
                    onChange={(e) => setNewAccessKeyId(e.target.value)}
                    placeholder="S3 访问密钥 ID"
                  />
                </label>

                <label className={pageStyles.filledField}>
                  <span>Secret Access Key</span>
                  <input
                    type={showCreateSecrets ? 'text' : 'password'}
                    autoComplete="off"
                    value={newSecretAccessKey}
                    onChange={(e) => setNewSecretAccessKey(e.target.value)}
                    placeholder="S3 访问密钥"
                  />
                </label>

                <label className={`${pageStyles.filledField} ${pageStyles.fullSpan}`}>
                  <span>Analytics Token（选填 · 用于查看官方桶统计）</span>
                  <input
                    type={showCreateSecrets ? 'text' : 'password'}
                    autoComplete="off"
                    value={newAnalyticsToken}
                    onChange={(e) => setNewAnalyticsToken(e.target.value)}
                    placeholder="不填也能正常存取图片"
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
                  <span>{showCreateSecrets ? '隐藏密钥' : '显示密钥'}</span>
                </RippleButton>
                <RippleButton
                  type="button"
                  className={pageStyles.primaryBtn}
                  onClick={handleCreateBucket}
                >
                  <Icon name="check" size={15} />
                  <span>确认添加</span>
                </RippleButton>
              </div>
            </>
          ) : (
            <>
              <div className={pageStyles.detailHeader}>
                <div>
                  <span className={pageStyles.pageEyebrow}>R2 BUCKET</span>
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
                          message: `已选为新图写入位置草稿，请在上方点「保存设置」生效`,
                        })
                      }}
                    >
                      <LabIcon name="cloud" size={14} />
                      <span>设为写入目标</span>
                    </RippleButton>
                  ) : (
                    <span className={styles.activeWriteChip}>当前写入中</span>
                  )}
                </div>
              </div>

              {justCreatedBucketId === selectedBucket.id ? (
                <div className={`${styles.scopeNotice} ${styles.scopeNoticeHighlight}`} role="status">
                  <Icon name="sparkles" size={15} />
                  <span>
                    已添加但暂未启用。如需用它保存新图，点右侧「设为写入目标」并在上方保存。
                  </span>
                </div>
              ) : null}

              <div className={styles.identityBar}>
                <div className={styles.identityItem}>
                  <span>Account ID（不可改）</span>
                  <code title={selectedBucket.accountId}>{selectedBucket.accountId}</code>
                </div>
                <div className={styles.identityItem}>
                  <span>桶名称（不可改）</span>
                  <code>{selectedBucket.bucketName}</code>
                </div>
                <div className={styles.identityItem}>
                  <span>区域（不可改）</span>
                  <code>{JURISDICTION_LABELS[selectedBucket.jurisdiction]}</code>
                </div>
              </div>

              <div className={styles.credBoolRow}>
                {(['hasAccessKeyId', 'hasSecretAccessKey'] as const).map(field => (
                  <span key={field} className={selectedBucket[field] ? styles.credTrueChip : styles.credFalseChip}>
                    <Icon name={selectedBucket[field] ? 'check' : 'close'} size={12} />
                    {field === 'hasAccessKeyId' ? 'Access Key ID' : 'Secret Access Key'}：{selectedBucket[field] ? '已配置' : '未配置'}
                  </span>
                ))}
                <span className={selectedBucket.hasAnalyticsToken ? styles.credTrueChip : styles.credFalseChip}>
                  <Icon name={selectedBucket.hasAnalyticsToken ? 'check' : 'close'} size={12} />
                  <span>统计令牌：{selectedBucket.hasAnalyticsToken ? '已配置' : '未配置'}</span>
                </span>
              </div>

              {/* Dual Usage */}
              <div className={styles.usageSection}>
                <div className={styles.usageHead}>
                  <div>
                    <h3>存储用量</h3>
                  </div>
                  <RippleButton
                    type="button"
                    className={pageStyles.tonalBtn}
                    disabled={isRefreshingUsage}
                    onClick={() => setUsageRevision(v => v + 1)}
                  >
                    <LabIcon name="refresh" size={14} />
                    <span>{isRefreshingUsage ? '刷新中…' : '刷新用量'}</span>
                  </RippleButton>
                </div>

                {isRefreshingUsage ? (
                  <div className={styles.usageDualGrid} role="status" aria-busy="true">
                    <div className={styles.usageCard}>
                      <SkeletonBlock variant="text" width={120} height={14} />
                      <div className={styles.usageMetricRow}>
                        <SkeletonBlock variant="pill" width={88} height={28} />
                        <SkeletonBlock variant="pill" width={106} height={28} staggerIndex={1} />
                      </div>
                      <SkeletonTextStack widths={['80%']} lineHeight={11} />
                    </div>
                    <div className={styles.usageCard}>
                      <SkeletonBlock variant="text" width={140} height={14} />
                      <div className={styles.usageMetricThree}>
                        <SkeletonBlock variant="pill" width="90%" height={26} />
                        <SkeletonBlock variant="pill" width="90%" height={26} staggerIndex={1} />
                        <SkeletonBlock variant="pill" width="90%" height={26} staggerIndex={2} />
                      </div>
                      <SkeletonTextStack widths={['84%']} lineHeight={11} />
                    </div>
                  </div>
                ) : usageResult?.error ? <div className={styles.inlineErrorBanner} role="alert"><span>{usageResult.error}</span><RippleButton type="button" className={styles.smallTonalBtn} onClick={() => setUsageRevision(v => v + 1)}>重试</RippleButton></div>
                 : activeUsage && effectiveCloudflare ? (
                  <div className={styles.usageDualGrid}>
                    <div className={styles.usageCard}>
                      <div className={styles.usageCardTop}>
                        <span className={styles.usageCardTitle}>
                          <LabIcon name="database" size={15} />
                          <span>本应用图片</span>
                        </span>
                        <span className={pageStyles.statusOn}>实时</span>
                      </div>
                      <div className={styles.usageMetricRow}>
                        <div className={styles.usageMetric}>
                          <span>图片数</span>
                          <strong>{activeUsage.application.imageCount} 张</strong>
                        </div>
                        <div className={styles.usageMetric}>
                          <span>占用空间</span>
                          <strong>{formatBytes(activeUsage.application.totalBytes)}</strong>
                        </div>
                      </div>
                      <p className={styles.usageFootNote}>
                        只算本应用在这个桶里还没过期的图片。
                      </p>
                    </div>

                    <div className={styles.usageCard}>
                      <div className={styles.usageCardTop}>
                        <span className={styles.usageCardTitle}>
                          <LabIcon name="cloud" size={15} />
                          <span>Cloudflare 官方统计</span>
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
                          title={effectiveCloudflare.status}
                        >
                          {effectiveCloudflare.status === 'available'
                            ? '正常'
                            : CF_STATUS_META[effectiveCloudflare.status].label}
                        </span>
                      </div>

                      {effectiveCloudflare.status === 'available' ? (
                        <>
                          <div className={styles.usageMetricThree}>
                            <div className={styles.usageMetric}>
                              <span>文件大小</span>
                              <strong>{formatBytes(effectiveCloudflare.payloadBytes)}</strong>
                            </div>
                            <div className={`${styles.usageMetric} ${styles.usageMetricMuted}`}>
                              <span>元数据</span>
                              <strong>{formatBytes(effectiveCloudflare.metadataBytes)}</strong>
                            </div>
                            <div className={`${styles.usageMetric} ${styles.usageMetricMuted}`}>
                              <span>对象数</span>
                              <strong>{effectiveCloudflare.objectCount} 个</strong>
                            </div>
                          </div>
                          <p className={styles.usageFootNote}>
                            采样时间：{formatLocalDateTime(effectiveCloudflare.sampledAt, true)}（对比图片大小看“文件大小”，受统计延迟或其他文件影响可能有差异）。
                          </p>
                        </>
                      ) : (
                        <div className={styles.cfStateBox}>
                          <strong>{CF_STATUS_META[effectiveCloudflare.status].title}（—）</strong>
                          <p>{CF_STATUS_META[effectiveCloudflare.status].desc}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Credential Rotation */}
              <div className={styles.rotateSection}>
                <div className={pageStyles.detailHeader}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15 }}>更新密钥</h3>
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
                    <span>新 Access Key ID</span>
                    <input
                      type={showRotateSecrets ? 'text' : 'password'}
                      autoComplete="off"
                      value={rotAccessKeyId}
                      onChange={(e) => setRotAccessKeyId(e.target.value)}
                      placeholder="留空不改"
                    />
                  </label>
                  <label className={pageStyles.filledField}>
                    <span>新 Secret Access Key</span>
                    <input
                      type={showRotateSecrets ? 'text' : 'password'}
                      autoComplete="off"
                      value={rotSecretAccessKey}
                      onChange={(e) => setRotSecretAccessKey(e.target.value)}
                      placeholder="留空不改"
                    />
                  </label>
                  <label className={`${pageStyles.filledField} ${pageStyles.fullSpan}`}>
                    <span>新 Analytics Token（选填）</span>
                    <input
                      type={showRotateSecrets ? 'text' : 'password'}
                      autoComplete="off"
                      disabled={clearAnalyticsToken}
                      value={clearAnalyticsToken ? '' : rotAnalyticsToken}
                      onChange={(e) => setRotAnalyticsToken(e.target.value)}
                      placeholder={
                        clearAnalyticsToken ? '保存后将清除统计令牌' : '留空不改'
                      }
                    />
                  </label>
                </div>

                <div className={styles.clearTokenRow}>
                  <div className={styles.clearTokenInfo}>
                    <strong>清除统计令牌</strong>
                    <span>仅停用官方桶统计，不影响图片读写。</span>
                  </div>
                  <RippleButton
                    type="button"
                    aria-pressed={clearAnalyticsToken}
                    className={`${pageStyles.switchPill} ${clearAnalyticsToken ? pageStyles.switchPillOn : ''}`}
                    onClick={() => setClearAnalyticsToken((v) => !v)}
                  >
                    <span className={pageStyles.switchThumb} />
                    <span>{clearAnalyticsToken ? '将清除' : '保持不变'}</span>
                  </RippleButton>
                </div>

                {pendingChangeSummary.length > 0 ? (
                  <div className={styles.patchPreviewStrip}>
                    <LabIcon name="key" size={13} />
                    <span>本次将更新：{pendingChangeSummary.join('、')}</span>
                  </div>
                ) : null}

                <div className={pageStyles.detailFooter}>
                  <span className={pageStyles.monoMeta}>留空项保持原样不变</span>
                  <RippleButton
                    type="button"
                    className={pageStyles.primaryBtn}
                    onClick={handleRotateCredentials}
                  >
                    <Icon name="check" size={15} />
                    <span>保存密钥</span>
                  </RippleButton>
                </div>
              </div>

              {/* Safe Deletion Zone */}
              <div className={styles.dangerZone}>
                <div className={styles.dangerZoneTop}>
                  <div>
                    <strong style={{ fontSize: 13.5 }}>移除这个桶配置</strong>
                    <p>仅从系统移除配置，不会删掉 Cloudflare 里的桶和文件；若仍有使用或待删文件将无法移除。</p>
                  </div>
                  <div className={pageStyles.toolbarRight}>
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
                          <span>确认移除</span>
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
                        <span>移除配置</span>
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
                        重试
                      </RippleButton>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </fieldset>
  )
}
