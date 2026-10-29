import type {
  GenerateImageRequest,
  GenerateImageResult,
  GeneratedImage,
} from '@nanobanana/shared/types/generation'
import {
  createAppError,
  extractBackendErrorInfo,
  summarizePayload,
} from '@nanobanana/shared/utils/errors'
import { buildGeminiEndpoint, buildGeminiRequestBody } from '@nanobanana/shared/utils/providerRequests'
import type { ProviderAdapter } from './adapter.ts'
import { asRecord, isNonEmptyString, requestProviderJson } from './request.ts'

export class GeminiOfficialAdapter implements ProviderAdapter {
  readonly provider = 'gemini-compatible' as const

  async generateImage(request: GenerateImageRequest): Promise<GenerateImageResult> {
    const profile = request.config.profiles[this.provider]
    const { payload, status } = await requestProviderJson({
      endpoint: buildGeminiEndpoint(profile.baseUrl, profile.model, profile.apiKey),
      headers: { 'Content-Type': 'application/json' },
      body: buildGeminiRequestBody(profile, request.prompt, request.referenceImages),
      failureMessage: 'Gemini 请求失败，请检查配置后重试。',
      invalidJsonMessage: 'Gemini 返回成功但响应不是合法 JSON。',
    })

    const candidates = asRecord(payload)?.candidates
    const candidate = Array.isArray(candidates) ? asRecord(candidates[0]) : undefined
    const content = asRecord(candidate?.content)
    const parts = Array.isArray(content?.parts) ? content.parts : []
    const images: GeneratedImage[] = []
    const texts: string[] = []
    for (const value of parts) {
      const part = asRecord(value)
      if (!part) continue

      const inline = asRecord(part.inlineData ?? part.inline_data)
      if (isNonEmptyString(inline?.data)) {
        images.push({
          mimeType: isNonEmptyString(inline.mimeType)
            ? inline.mimeType
            : isNonEmptyString(inline.mime_type) ? inline.mime_type : 'image/png',
          base64Data: inline.data,
        })
      }
      if (isNonEmptyString(part.text)) {
        texts.push(part.text)
      }
    }

    if (images.length === 0) {
      const backendError = extractBackendErrorInfo(payload)
      throw createAppError(
        'BAD_RESPONSE',
        backendError.message ?? 'Gemini 返回成功但未包含图片数据。',
        false,
        status,
        backendError.details ?? summarizePayload(payload),
      )
    }

    return {
      provider: this.provider,
      model: profile.model,
      text: texts.join('\n') || undefined,
      images,
      createdAt: new Date().toISOString(),
    }
  }
}
