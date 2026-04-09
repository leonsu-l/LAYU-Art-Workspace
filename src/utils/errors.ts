import type { AppError, AppErrorCode } from '../types/generation'

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
  details?: string,
): AppError {
  if (status === 401 || status === 403) {
    return createAppError(
      'AUTH',
      '认证失败：请检查 API Key 是否正确且仍然有效。',
      false,
      status,
      details,
    )
  }

  if (status === 429) {
    return createAppError(
      'RATE_LIMIT',
      '请求过于频繁：已触发限流，请稍后重试。',
      true,
      status,
      details,
    )
  }

  if (status >= 500) {
    return createAppError(
      'NETWORK',
      '服务端暂时不可用，请稍后再试。',
      true,
      status,
      details,
    )
  }

  return createAppError('UNKNOWN', fallbackMessage, false, status, details)
}

export function mapFetchFailureToError(cause: unknown): AppError {
  if (cause instanceof Error) {
    if (cause.name === 'AbortError') {
      return createAppError('NETWORK', '请求超时，请重试。', true, undefined, cause.message)
    }

    if (cause.message.includes('Failed to fetch')) {
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
      return isOnline
        ? createAppError(
          'CORS',
          '请求被浏览器拦截（可能是 CORS 或跨域策略）。',
          false,
          undefined,
          cause.message,
        )
        : createAppError('NETWORK', '网络不可用，请检查连接后重试。', true, undefined, cause.message)
    }

    return createAppError('UNKNOWN', '请求失败，请稍后重试。', true, undefined, cause.message)
  }

  return createAppError('UNKNOWN', '发生未知错误。', false)
}
