export type RetentionTone = 'permanent' | 'timed' | 'urgent'

export interface ImageRetentionSummary {
  tone: RetentionTone
  shortLabel: string
  detailLabel: string
  localExpiryText: string | null
  isPermanent: boolean
}

const LOCAL_DATE_TIME_FMT = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const FULL_LOCAL_DATE_TIME_FMT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export function formatRetentionPolicyText(retentionDays: number | null | undefined): string {
  if (retentionDays === null || retentionDays === undefined) {
    return '永久保存'
  }
  return `保留 ${retentionDays} 天`
}

export function formatLocalDateTime(
  value: string | number | null | undefined,
  withSeconds = false,
): string {
  if (value === null || value === undefined || value === '') return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return withSeconds ? FULL_LOCAL_DATE_TIME_FMT.format(date) : LOCAL_DATE_TIME_FMT.format(date)
}

export function formatRelativeAge(timestampMs: number, referenceMs = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((referenceMs - timestampMs) / 1000))
  if (diffSec < 60) return '刚刚'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} 天前`
}

/**
 * Derive user-facing retention display directly from the image/task's own
 * `retentionDays` and `expiresAt` fields. Never recompute from `createdAt`
 * or the current site policy; omitted fields (legacy tasks/images) are permanent.
 */
export function getImageRetentionSummary(
  retentionDays?: number | null,
  expiresAt?: string | null,
  referenceNowMs = Date.now(),
): ImageRetentionSummary {
  if ((retentionDays === null || retentionDays === undefined) && !expiresAt) {
    return {
      tone: 'permanent',
      shortLabel: '永久保存',
      detailLabel: '永久保存',
      localExpiryText: null,
      isPermanent: true,
    }
  }

  const parsedMs = expiresAt ? Date.parse(expiresAt) : Number.NaN
  const localExpiryText = Number.isFinite(parsedMs) ? formatLocalDateTime(parsedMs, false) : null

  if (!Number.isFinite(parsedMs)) {
    const daysText = retentionDays ? `保留 ${retentionDays} 天` : '限时保存'
    return {
      tone: 'timed',
      shortLabel: daysText,
      detailLabel: daysText,
      localExpiryText: null,
      isPermanent: false,
    }
  }

  const remainingMs = parsedMs - referenceNowMs
  const remainingHours = Math.max(0, Math.ceil(remainingMs / 3_600_000))
  const remainingDays = Math.max(1, Math.ceil(remainingMs / 86_400_000))

  if (remainingMs <= 0) {
    return {
      tone: 'urgent',
      shortLabel: '即将过期',
      detailLabel: `${localExpiryText} 过期`,
      localExpiryText,
      isPermanent: false,
    }
  }

  if (remainingHours <= 24) {
    return {
      tone: 'urgent',
      shortLabel: `${remainingHours} 小时后过期`,
      detailLabel: `${localExpiryText} 过期`,
      localExpiryText,
      isPermanent: false,
    }
  }

  return {
    tone: 'timed',
    shortLabel: `剩 ${remainingDays} 天`,
    detailLabel: `${localExpiryText} 过期`,
    localExpiryText,
    isPermanent: false,
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

export function validateAccountId(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return '请输入 Account ID'
  if (!/^[0-9a-fA-F]{32}$/.test(trimmed)) {
    return 'Account ID 必须是 32 位十六进制字符'
  }
  return null
}

export function validateBucketName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return '请输入桶名称'
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(trimmed)) {
    return '桶名需 3–63 位，仅限小写字母、数字和连字符，首尾不能是连字符'
  }
  return null
}

export function validateRetentionDays(raw: string): { valid: boolean; value: number | null; error: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { valid: true, value: null, error: null }
  }
  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, value: null, error: '请输入 1–3650 之间的整数' }
  }
  const num = Number(trimmed)
  if (!Number.isInteger(num) || num < 1 || num > 3650) {
    return { valid: false, value: null, error: '保留天数必须在 1 到 3650 天之间' }
  }
  return { valid: true, value: num, error: null }
}

export function validateCredentialInput(value: string, label: string): string | null {
  if (!value) return `请输入 ${label}`
  if (value.length > 4096) return `${label} 长度不能超过 4096 个字符`
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 33 || code > 126) {
      return `${label} 不能包含空格或特殊字符`
    }
  }
  return null
}
