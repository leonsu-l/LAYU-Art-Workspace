import type { AppError } from '@nanobanana/shared/types/generation'
import { createAppError, isAppError } from '@nanobanana/shared/utils/errors'

import { getSessionEpoch, getSessionUserId, trackRequest } from './sessionScope.ts'

const REQUEST_TIMEOUT_MS = 15_000
const MODEL_REFRESH_TIMEOUT_MS = 180_000
const writes = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
export function requestTimeoutMs(path: string): number {
  return /^\/channels\/[^/]+\/models\/refresh(?:\?|$)/.test(path) ? MODEL_REFRESH_TIMEOUT_MS : REQUEST_TIMEOUT_MS
}

export function csrfHeaders(method = 'GET', cookie = document.cookie): Record<string, string> {
  if (!writes.has(method.toUpperCase())) return {}
  const token = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('XSRF-TOKEN='))
  return token ? { 'X-XSRF-TOKEN': decodeURIComponent(token.slice('XSRF-TOKEN='.length)) } : {}
}

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

// 已认证的读取也可能轮换 CSRF Cookie。同一会话共享一次补取，不重放业务写入。
let csrfRefresh: { epoch: number; done: Promise<void> } | null = null
function refreshCsrf(epoch: number) {
  if (csrfRefresh?.epoch === epoch) return csrfRefresh.done
  const owner = getSessionUserId()
  const done = backendRequest<{ user: { id: string } | null }>('/auth/session').then(({ user }) => {
    if (owner && user?.id !== owner && epoch === getSessionEpoch()) {
      window.dispatchEvent(new Event('studio:unauthorized'))
      throw new BackendRequestError(createAppError('AUTH', '账号会话已改变，请重新登录。', false))
    }
  }).finally(() => { if (csrfRefresh?.epoch === epoch) csrfRefresh = null })
  csrfRefresh = { epoch, done }
  return done
}

/** A timeout cancels this HTTP exchange, never the durable backend task. */
export async function backendRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const epoch = getSessionEpoch()
  const untrack = trackRequest(controller)
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) controller.abort()
  const timeoutId = window.setTimeout(abort, requestTimeoutMs(path))

  try {
    let csrf = csrfHeaders(options.method)
    if (writes.has((options.method ?? 'GET').toUpperCase()) && !csrf['X-XSRF-TOKEN']) {
      await refreshCsrf(epoch)
      if (controller.signal.aborted || epoch !== getSessionEpoch()) throw new Error('会话已切换')
      csrf = csrfHeaders(options.method)
      if (!csrf['X-XSRF-TOKEN']) throw new BackendRequestError(createAppError('AUTH', '未取得会话校验令牌，请重新连接。', true))
    }
    const response = await fetch(`/api${path}`, {
      ...options,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers, ...csrf },
      signal: controller.signal,
    })
    const payload: unknown = await response.json().catch(() => null)
    if (controller.signal.aborted || epoch !== getSessionEpoch()) throw new Error('会话已切换')
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('studio:unauthorized'))
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
    untrack()
    window.clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', abort)
  }
}

export function backendErrorMessage(error: unknown): string {
  if (error instanceof Error || isAppError(error)) return error.message
  return '请求失败，请重试。'
}
