import type { ProviderConfig, ReferenceImage, RequestPreview } from '../types/generation.ts'
import { referenceImageBytes } from '../utils/referenceImages.ts'
import { createAppError } from '../utils/errors.ts'
import {
  buildGeminiEndpoint,
  buildGeminiRequestBody,
  buildOpenAIImageEndpoint,
  buildOpenAIRequestBody,
} from '../utils/providerRequests.ts'

export function buildRequestPreview(config: ProviderConfig, referenceImages: readonly ReferenceImage[] = []): RequestPreview {
  const editing = referenceImages.length > 0
  const imageSummary = referenceImages.map((image) => ({ name: image.name, mimeType: image.mimeType, bytes: referenceImageBytes(image) }))
  switch (config.activeProvider) {
    case 'openai-compatible': {
      const profile = config.profiles['openai-compatible']
      return {
        provider: config.activeProvider,
        endpoint: buildOpenAIImageEndpoint(profile.baseUrl, editing),
        method: 'POST',
        headersPreview: {
          'Content-Type': editing ? 'multipart/form-data; boundary=[自动生成]' : 'application/json',
          Authorization: profile.apiKey ? 'Bearer ***' : 'Bearer [API_KEY]',
        },
        bodyPreview: { ...buildOpenAIRequestBody(profile, undefined, editing), ...(editing ? { 'image[]': imageSummary } : {}) },
      }
    }
    case 'gemini-compatible': {
      const profile = config.profiles['gemini-compatible']
      const { generationConfig } = buildGeminiRequestBody(profile, '')
      return {
        provider: config.activeProvider,
        endpoint: buildGeminiEndpoint(
          profile.baseUrl,
          profile.model,
          profile.apiKey ? '***' : '[API_KEY]',
        ),
        method: 'POST',
        headersPreview: { 'Content-Type': 'application/json' },
        bodyPreview: {
          generationConfig,
          ...(editing ? { contents: [{ role: 'user', parts: [
            { text: '[提示词]' },
            ...imageSummary.map((image) => ({ inlineData: { mimeType: image.mimeType, data: `[${image.bytes} bytes，Base64 已隐藏]` } })),
          ] }] } : {}),
        },
      }
    }
    default:
      throw createAppError('UNSUPPORTED', `不支持的供应商：${config.activeProvider}`, false)
  }
}
