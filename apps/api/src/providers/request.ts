import {
  createAppError,
  extractBackendErrorInfo,
  isAppError,
  mapHttpStatusToError,
  parseResponsePayload,
  summarizePayload,
} from '@nanobanana/shared/utils/errors'
import { getImageRequestTimeoutMs } from './requestTimeout.ts'

interface ProviderJsonRequest {
  endpoint: string
  headers: Record<string, string>
  body: unknown
  failureMessage: string
  invalidJsonMessage: string
}

export async function requestProviderJson(request: ProviderJsonRequest): Promise<{
  payload: unknown
  status: number
}> {
  const timeoutMs = getImageRequestTimeoutMs()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      body: request.body instanceof FormData ? request.body : JSON.stringify(request.body),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorPayload = await parseResponsePayload(response)
      const backendError = extractBackendErrorInfo(errorPayload)
      throw mapHttpStatusToError(response.status, request.failureMessage, {
        statusText: response.statusText,
        method: 'POST',
        backendMessage: backendError.message,
        backendDetails: backendError.details ?? summarizePayload(errorPayload),
      })
    }

    try {
      return { payload: await response.json(), status: response.status }
    } catch (error) {
      // A stalled/aborted body is a network failure, not malformed JSON.
      if (!(error instanceof SyntaxError)) {
        throw error
      }
      throw createAppError(
        'BAD_RESPONSE',
        request.invalidJsonMessage,
        false,
        response.status,
        error.message,
      )
    }
  } catch (error) {
    // Node's AbortError has a numeric `code`; never pass it through as an AppError.
    if (controller.signal.aborted) {
      throw createAppError(
        'NETWORK',
        `请求超时（${Math.ceil(timeoutMs / 1000)}秒），请重试或提高超时配置。`,
        true,
      )
    }

    if (isAppError(error)) {
      throw error
    }

    if (error instanceof Error) {
      throw createAppError(
        'NETWORK',
        '网络请求失败（可能是网关波动、DNS/TLS 异常）。',
        true,
        undefined,
        `name=${error.name} | ${error.message}`,
      )
    }

    throw createAppError('UNKNOWN', '发生未知错误。', false)
  } finally {
    clearTimeout(timeoutId)
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
