import type { AppError } from '../types/generation.ts'
import { createAppError, isAppError } from '../utils/errors.ts'

const REQUEST_TIMEOUT_MS = 15_000

export class BackendRequestError extends Error {
  readonly appError: AppError
  readonly isApiError: boolean

  constructor(appError: AppError, isApiError = false) {
    super(appError.message)
    this.name = 'BackendRequestError'
    this.appError = appError
    this.isApiError = isApiError
  }
}

/** A timeout cancels this HTTP exchange, never the durable backend task. */
export async function backendRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) controller.abort()
  const timeoutId = window.setTimeout(abort, REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      cache: 'no-store',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      signal: controller.signal,
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const error = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null
      if (isAppError(error)) {
        throw new BackendRequestError({ ...error, status: response.status }, true)
      }
      throw new BackendRequestError(createAppError('NETWORK', `后端请求失败（HTTP ${response.status}）。`, true, response.status))
    }
    if (payload === null) {
      throw new BackendRequestError(createAppError('BAD_RESPONSE', '后端返回了无法识别的响应。', true))
    }
    return payload as T
  } catch (error) {
    if (error instanceof BackendRequestError) throw error
    throw new BackendRequestError(createAppError('NETWORK', controller.signal.aborted
      ? '后端请求超时或连接已中断；任务状态尚未确认。'
      : '无法连接后端，请检查网络及后端服务。', true))
  } finally {
    window.clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', abort)
  }
}

export function backendErrorMessage(error: unknown): string {
  if (error instanceof Error || isAppError(error)) return error.message
  return '请求失败，请重试。'
}
