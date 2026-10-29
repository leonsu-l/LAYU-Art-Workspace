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
import {
  buildOpenAIImageEndpoint,
  buildOpenAIRequestBody,
} from '@nanobanana/shared/utils/providerRequests'
import type { ProviderAdapter } from './adapter.ts'
import { asRecord, isNonEmptyString, requestProviderJson } from './request.ts'

export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly provider = 'openai-compatible' as const

  async generateImage(request: GenerateImageRequest): Promise<GenerateImageResult> {
    const profile = request.config.profiles[this.provider]
    const references = request.referenceImages ?? []
    const editing = references.length > 0
    const fields = buildOpenAIRequestBody(profile, request.prompt, editing)
    let body: typeof fields | FormData = fields
    if (editing) {
      const form = new FormData()
      for (const [key, value] of Object.entries(fields)) form.append(key, String(value))
      references.forEach((image, index) => {
        const bytes = new Uint8Array(Buffer.from(image.base64Data, 'base64'))
        const extension = image.mimeType.split('/')[1]
        form.append('image[]', new Blob([bytes], { type: image.mimeType }), `reference-${index + 1}.${extension}`)
      })
      body = form
    }
    const { payload, status } = await requestProviderJson({
      endpoint: buildOpenAIImageEndpoint(profile.baseUrl, editing),
      headers: {
        // fetch must supply the multipart boundary, never set this header manually for edits.
        ...(!editing ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${profile.apiKey.trim()}`,
      },
      body,
      failureMessage: 'OpenAI-Compatible 请求失败，请确认 Base URL 与鉴权方式。',
      invalidJsonMessage: '供应商返回成功但响应不是合法 JSON。',
    })

    const responseFormat = asRecord(payload)?.output_format
    const format = responseFormat === 'png' || responseFormat === 'jpeg' || responseFormat === 'webp'
      ? responseFormat : profile.params.outputFormat ?? 'png'
    const mimeType = `image/${format}`
    const data = asRecord(payload)?.data
    const records = Array.isArray(data) ? data : []
    const images: GeneratedImage[] = []
    const revisedPrompts: string[] = []
    for (const value of records) {
      const record = asRecord(value)
      if (!record) continue

      if (isNonEmptyString(record.b64_json)) {
        images.push({ mimeType, base64Data: record.b64_json })
      } else if (isNonEmptyString(record.url)) {
        images.push({ mimeType, url: record.url })
      }
      if (isNonEmptyString(record.revised_prompt)) {
        revisedPrompts.push(record.revised_prompt)
      }
    }

    if (images.length === 0) {
      const backendError = extractBackendErrorInfo(payload)
      throw createAppError(
        'BAD_RESPONSE',
        backendError.message ?? '供应商返回成功但未包含图片字段。',
        false,
        status,
        backendError.details ?? summarizePayload(payload),
      )
    }

    return {
      provider: this.provider,
      model: profile.model,
      text: revisedPrompts.join('\n') || undefined,
      images,
      createdAt: new Date().toISOString(),
    }
  }
}
