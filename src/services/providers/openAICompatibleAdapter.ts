import type {
  GenerateImageRequest,
  GenerateImageResult,
  GeneratedImage,
  ProviderConfig,
  RequestPreview,
} from '../../types/generation'
import {
  createAppError,
  extractBackendErrorInfo,
  mapFetchFailureToError,
  mapHttpStatusToError,
  parseResponsePayload,
  summarizePayload,
} from '../../utils/errors'
import type { ProviderAdapter } from './adapter'
import {
  getImageRequestTimeoutMs,
  getImageRequestTimeoutSeconds,
} from './requestTimeout'

const REQUEST_TIMEOUT_MS = getImageRequestTimeoutMs()
const REQUEST_TIMEOUT_SECONDS = getImageRequestTimeoutSeconds()

interface OpenAIImageResponse {
  data?: Array<{
    b64_json?: string
    url?: string
    revised_prompt?: string
  }>
  error?: {
    message?: string
  }
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly provider = 'openai-compatible' as const

  buildRequestPreview(config: ProviderConfig): RequestPreview {
    const profile = config.profiles[this.provider]
    const endpoint = buildImageEndpoint(profile.baseUrl)

    return {
      provider: this.provider,
      endpoint,
      method: 'POST',
      headersPreview: {
        'Content-Type': 'application/json',
        Authorization: profile.apiKey ? 'Bearer ***' : 'Bearer [API_KEY]',
      },
      bodyPreview: {
        model: profile.model,
        size: profile.params.size,
        aspect_ratio: profile.params.aspectRatio,
        quality: profile.params.quality,
        n: profile.params.n,
        response_format: 'b64_json',
      },
    }
  }

  async generateImage(request: GenerateImageRequest): Promise<GenerateImageResult> {
    const profile = request.config.profiles[this.provider]
    const endpoint = buildImageEndpoint(profile.baseUrl)

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${profile.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: profile.model.trim(),
          prompt: request.prompt.trim(),
          size: profile.params.size,
          aspect_ratio: profile.params.aspectRatio,
          quality: profile.params.quality,
          n: profile.params.n,
          response_format: 'b64_json',
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorPayload = await parseResponsePayload(response)
        const backendError = extractBackendErrorInfo(errorPayload)

        throw mapHttpStatusToError(
          response.status,
          'OpenAI-Compatible 请求失败，请确认 Base URL 与鉴权方式。',
          {
            statusText: response.statusText,
            method: 'POST',
            backendMessage: backendError.message,
            backendDetails: backendError.details ?? summarizePayload(errorPayload),
          },
        )
      }

      let payload: OpenAIImageResponse
      try {
        payload = (await response.json()) as OpenAIImageResponse
      } catch (error) {
        throw createAppError(
          'BAD_RESPONSE',
          '供应商返回成功但响应不是合法 JSON。',
          false,
          response.status,
          error instanceof Error ? error.message : undefined,
        )
      }

      const images = parseOpenAIImages(payload)
      if (images.length === 0) {
        const backendError = extractBackendErrorInfo(payload)
        throw createAppError(
          'BAD_RESPONSE',
          backendError.message ?? '供应商返回成功但未包含图片字段。',
          false,
          response.status,
          backendError.details ?? summarizePayload(payload),
        )
      }

      const text = payload.data
        ?.map((entry) => entry.revised_prompt)
        .filter((value): value is string => Boolean(value && value.trim()))
        .join('\n')

      return {
        provider: this.provider,
        model: profile.model,
        text: text || undefined,
        images,
        createdAt: new Date().toISOString(),
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        throw error
      }

      if (controller.signal.aborted) {
        throw createAppError(
          'NETWORK',
          `请求超时（${REQUEST_TIMEOUT_SECONDS}秒），请重试或提高超时配置。`,
          true,
        )
      }

      throw mapFetchFailureToError(error)
    } finally {
      window.clearTimeout(timeoutId)
    }
  }
}

function parseOpenAIImages(payload: OpenAIImageResponse): GeneratedImage[] {
  const records = payload.data ?? []
  const images: GeneratedImage[] = []

  for (const record of records) {
    if (record.b64_json) {
      images.push({
        mimeType: 'image/png',
        base64Data: record.b64_json,
      })
      continue
    }

    if (record.url) {
      images.push({
        mimeType: 'image/png',
        url: record.url,
      })
    }
  }

  return images
}

function buildImageEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '').replace(/\/$/, '')

  if (!normalized) {
    throw createAppError('VALIDATION', 'Base URL 不能为空。', false)
  }

  if (normalized.endsWith('/images/generations')) {
    return normalized
  }

  if (normalized.endsWith('/v1')) {
    return `${normalized}/images/generations`
  }

  return `${normalized}/v1/images/generations`
}
