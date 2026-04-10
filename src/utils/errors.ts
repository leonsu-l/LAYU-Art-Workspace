import type { AppError, AppErrorCode } from '../types/generation'

const MAX_ERROR_TEXT_LENGTH = 1000
const MAX_PAYLOAD_PREVIEW_LENGTH = 1500

export interface HttpStatusErrorContext {
  statusText?: string
  method?: string
  backendMessage?: string
  backendDetails?: string
}

export interface BackendErrorInfo {
  message?: string
  details?: string
  code?: string
  type?: string
}

export function createAppError(
  code: AppErrorCode,
  message: string,
  retryable: boolean,
  status?: number,
  details?: string,
): AppError {
  return {
    code,
    message,
    retryable,
    status,
    details,
  }
}

export function isAppError(value: unknown): value is AppError {
  if (!value || typeof value !== 'object') {
    return false
  }

  const error = value as Partial<AppError>
  return (
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    typeof error.retryable === 'boolean'
  )
}

export function mapHttpStatusToError(
  status: number,
  fallbackMessage: string,
  context: HttpStatusErrorContext = {},
): AppError {
  const normalizedBackendMessage = normalizeErrorText(context.backendMessage)
  const normalizedBackendDetails = normalizeErrorText(context.backendDetails)
  const mapped = classifyHttpStatus(status, fallbackMessage)
  const message = normalizedBackendMessage ?? mapped.message

  const detailParts: string[] = []
  if (normalizedBackendDetails && normalizedBackendDetails !== message) {
    detailParts.push(normalizedBackendDetails)
  }

  const normalizedStatusText = normalizeErrorText(context.statusText)
  const httpSummary = normalizedStatusText
    ? `HTTP ${status} ${normalizedStatusText}`
    : `HTTP ${status}`
  detailParts.push(httpSummary)

  if (context.method) {
    detailParts.push(`Method: ${context.method.toUpperCase()}`)
  }

  const details = detailParts.join(' | ')

  return createAppError(
    mapped.code,
    message,
    mapped.retryable,
    status,
    details || undefined,
  )
}

export function mapFetchFailureToError(cause: unknown): AppError {
  if (cause instanceof Error) {
    const normalizedMessage = cause.message.toLowerCase()
    const details = buildJoinedDetails([
      cause.name ? `name=${cause.name}` : undefined,
      normalizeErrorText(cause.message),
    ])

    if (cause.name === 'AbortError') {
      return createAppError('NETWORK', '请求超时，请重试。', true, undefined, details)
    }

    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
    if (!isOnline) {
      return createAppError('NETWORK', '网络不可用，请检查连接后重试。', true, undefined, details)
    }

    if (normalizedMessage.includes('cors') || normalizedMessage.includes('cross-origin')) {
      return createAppError(
        'CORS',
        '请求被浏览器跨域策略拦截，请检查中转站 CORS 配置。',
        false,
        undefined,
        details,
      )
    }

    if (
      normalizedMessage.includes('failed to fetch') ||
      normalizedMessage.includes('networkerror') ||
      normalizedMessage.includes('load failed') ||
      normalizedMessage.includes('fetch failed')
    ) {
      return createAppError(
        'NETWORK',
        '网络请求失败（可能是网关波动、DNS/TLS 异常或跨域拦截）。',
        true,
        undefined,
        details,
      )
    }

    return createAppError('UNKNOWN', '请求失败，请稍后重试。', true, undefined, details)
  }

  return createAppError('UNKNOWN', '发生未知错误。', false)
}

export async function parseResponsePayload(response: Response): Promise<unknown> {
  const rawText = await response.text()
  const normalizedText = rawText.trim()

  if (!normalizedText) {
    return null
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  const shouldParseJson =
    contentType.includes('application/json') ||
    contentType.includes('+json') ||
    looksLikeJson(normalizedText)

  if (shouldParseJson) {
    try {
      return JSON.parse(normalizedText)
    } catch {
      // Fall back to text so callers still get backend details.
    }
  }

  return normalizedText
}

export function extractBackendErrorInfo(payload: unknown): BackendErrorInfo {
  if (typeof payload === 'string') {
    const text = normalizeBackendText(payload)
    return text ? { message: text } : {}
  }

  const root = asRecord(payload)
  if (!root) {
    return {}
  }

  const errorNode = root.error
  const errorObject = asRecord(errorNode)
  const code = firstNonEmptyString([
    errorObject?.code,
    errorObject?.status,
    root.code,
    root.status,
  ])
  const type = firstNonEmptyString([
    errorObject?.type,
    errorObject?.reason,
    root.type,
    root.reason,
  ])

  const message = firstNonEmptyString([
    errorObject?.message,
    errorObject?.msg,
    errorObject?.detail,
    root.message,
    root.msg,
    root.detail,
    root.error_description,
    root.description,
    root.title,
    typeof errorNode === 'string' ? errorNode : undefined,
  ])

  const detailValue = firstDefined([
    errorObject?.details,
    errorObject?.errors,
    errorObject?.violations,
    root.details,
    root.errors,
    root.violations,
    root.trace,
  ])

  const detailParts: string[] = []
  if (code) {
    detailParts.push(`后端错误码: ${code}`)
  }

  if (type) {
    detailParts.push(`后端错误类型: ${type}`)
  }

  const normalizedDetailValue = formatDetailValue(detailValue)
  if (normalizedDetailValue && normalizedDetailValue !== message) {
    detailParts.push(normalizedDetailValue)
  }

  const payloadPreview = summarizePayload(root)
  if (!normalizedDetailValue && payloadPreview && payloadPreview !== message) {
    detailParts.push(payloadPreview)
  }

  const details = detailParts.length > 0 ? detailParts.join(' | ') : undefined
  if (!message && details) {
    return {
      message: details,
      code,
      type,
    }
  }

  return {
    message,
    details,
    code,
    type,
  }
}

export function summarizePayload(payload: unknown): string | undefined {
  if (payload == null) {
    return undefined
  }

  if (typeof payload === 'string') {
    return normalizeBackendText(payload)
  }

  if (typeof payload === 'number' || typeof payload === 'boolean') {
    return String(payload)
  }

  try {
    const serialized = JSON.stringify(payload)
    return normalizeErrorText(serialized, MAX_PAYLOAD_PREVIEW_LENGTH)
  } catch {
    return undefined
  }
}

function classifyHttpStatus(
  status: number,
  fallbackMessage: string,
): { code: AppErrorCode; message: string; retryable: boolean } {
  if (status === 400) {
    return {
      code: 'VALIDATION',
      message: '请求参数无效，请检查模型或生成参数。',
      retryable: false,
    }
  }

  if (status === 401 || status === 403) {
    return {
      code: 'AUTH',
      message: '认证失败：请检查 API Key 是否正确且仍然有效。',
      retryable: false,
    }
  }

  if (status === 404) {
    return {
      code: 'UNKNOWN',
      message: '接口地址不存在：请确认 Base URL 与路由路径是否正确。',
      retryable: false,
    }
  }

  if (status === 408 || status === 504) {
    return {
      code: 'NETWORK',
      message: '上游响应超时，请稍后重试。',
      retryable: true,
    }
  }

  if (status === 413) {
    return {
      code: 'VALIDATION',
      message: '请求体过大：请缩短提示词或降低生成参数。',
      retryable: false,
    }
  }

  if (status === 415 || status === 422) {
    return {
      code: 'VALIDATION',
      message: '请求格式不被接受，请检查参数结构和字段类型。',
      retryable: false,
    }
  }

  if (status === 425 || status === 429) {
    return {
      code: 'RATE_LIMIT',
      message: '请求过于频繁或服务繁忙，请稍后重试。',
      retryable: true,
    }
  }

  if (status >= 500) {
    return {
      code: 'NETWORK',
      message: '服务端暂时不可用，请稍后再试。',
      retryable: true,
    }
  }

  if (status >= 400) {
    return {
      code: 'UNKNOWN',
      message: fallbackMessage,
      retryable: false,
    }
  }

  return {
    code: 'UNKNOWN',
    message: fallbackMessage,
    retryable: true,
  }
}

function firstDefined(values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value
    }
  }

  return undefined
}

function firstNonEmptyString(values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = normalizeErrorText(
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : undefined,
    )
    if (normalized) {
      return normalized
    }
  }

  return undefined
}

function formatDetailValue(value: unknown): string | undefined {
  if (value == null) {
    return undefined
  }

  if (typeof value === 'string') {
    return normalizeBackendText(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => formatDetailValue(item))
      .filter((item): item is string => Boolean(item))
      .slice(0, 5)

    if (items.length === 0) {
      return undefined
    }

    return normalizeErrorText(items.join(' ; '), MAX_ERROR_TEXT_LENGTH)
  }

  return summarizePayload(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function looksLikeJson(value: string): boolean {
  const first = value[0]
  return first === '{' || first === '['
}

function normalizeBackendText(value: string): string | undefined {
  const normalized = normalizeErrorText(value, MAX_PAYLOAD_PREVIEW_LENGTH)
  if (!normalized) {
    return undefined
  }

  if (looksLikeHtml(normalized)) {
    const titleMatch = normalized.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (titleMatch?.[1]) {
      return normalizeErrorText(titleMatch[1], MAX_ERROR_TEXT_LENGTH)
    }

    const stripped = normalized.replace(/<[^>]+>/g, ' ')
    return normalizeErrorText(stripped, MAX_ERROR_TEXT_LENGTH)
  }

  return normalizeErrorText(normalized, MAX_ERROR_TEXT_LENGTH)
}

function looksLikeHtml(value: string): boolean {
  return /<\s*html|<\s*!doctype\s+html|<\s*body|<\s*title/i.test(value)
}

function normalizeErrorText(value?: string, maxLength = MAX_ERROR_TEXT_LENGTH): string | undefined {
  if (!value) {
    return undefined
  }

  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (!collapsed) {
    return undefined
  }

  if (collapsed.length <= maxLength) {
    return collapsed
  }

  return `${collapsed.slice(0, Math.max(0, maxLength - 3))}...`
}

function buildJoinedDetails(parts: Array<string | undefined>): string | undefined {
  const normalized = parts
    .map((item) => normalizeErrorText(item))
    .filter((item): item is string => Boolean(item))

  if (normalized.length === 0) {
    return undefined
  }

  return normalized.join(' | ')
}
