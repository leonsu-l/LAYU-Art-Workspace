import type { GeminiProviderProfile, OpenAIProviderProfile, ReferenceImage } from '../types/generation.ts'
import { createAppError } from './errors.ts'
import { getGeminiModel, normalizeGeminiParams, normalizeOpenAIParams } from './imageModels.ts'

export function buildOpenAIImageEndpoint(baseUrl: string, editing = false): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')

  if (!normalized) {
    throw createAppError('VALIDATION', 'Base URL 不能为空。', false)
  }

  const operation = editing ? 'edits' : 'generations'
  if (/\/images\/(generations|edits)$/.test(normalized)) {
    return normalized.replace(/\/(generations|edits)$/, `/${operation}`)
  }

  if (normalized.endsWith('/v1')) {
    return `${normalized}/images/${operation}`
  }

  return `${normalized}/v1/images/${operation}`
}

export function buildOpenAIRequestBody(profile: OpenAIProviderProfile, prompt?: string, editing = false) {
  const params = normalizeOpenAIParams(profile.model, profile.params)
  return {
    model: profile.model.trim(),
    ...(prompt === undefined ? {} : { prompt: prompt.trim() }),
    size: params.size,
    quality: params.quality,
    n: params.n,
    background: params.background,
    output_format: params.outputFormat,
    ...(params.outputFormat === 'png' ? {} : { output_compression: params.outputCompression }),
    // Use the documented multipart edits subset; moderation is a generations option in the SDK.
    ...(editing ? {} : { moderation: params.moderation }),
  }
}

export function buildGeminiEndpoint(baseUrl: string, model: string, apiKey: string): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '')
  const encodedModel = encodeURIComponent(model.trim())
  const encodedKey = encodeURIComponent(apiKey.trim())

  if (!normalizedBase) {
    throw createAppError('VALIDATION', 'Gemini Base URL 不能为空。', false)
  }

  if (!encodedModel) {
    throw createAppError('VALIDATION', 'Gemini 模型不能为空。', false)
  }

  if (!encodedKey) {
    throw createAppError('VALIDATION', 'Gemini API Key 不能为空。', false)
  }

  const endpoint = normalizedBase.includes(':generateContent')
    ? normalizedBase
    : `${normalizedBase}/models/${encodedModel}:generateContent`
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}key=${encodedKey}`
}

export function buildGeminiRequestBody(profile: GeminiProviderProfile, prompt: string, referenceImages: readonly ReferenceImage[] = []) {
  const capabilities = getGeminiModel(profile.model)
  const params = normalizeGeminiParams(profile.model, profile.params)
  return {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt.trim() },
          ...referenceImages.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.base64Data } })),
        ],
      },
    ],
    generationConfig: {
      responseModalities: params.imageOnly ? ['IMAGE'] : ['TEXT', 'IMAGE'],
      imageConfig: {
        ...(capabilities.imageSizes.length ? { imageSize: params.imageSize } : {}),
        ...(params.aspectRatio === 'auto' ? {} : { aspectRatio: params.aspectRatio }),
      },
      ...(params.thinkingLevel === 'auto' ? {} : {
        thinkingConfig: { thinkingLevel: params.thinkingLevel.toUpperCase() },
      }),
    },
  }
}
