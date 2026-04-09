import type {
    GenerateImageRequest,
    GenerateImageResult,
    GeneratedImage,
    ProviderType,
} from '../../types/generation'
import {
    createAppError,
    mapFetchFailureToError,
    mapHttpStatusToError,
} from '../../utils/errors'
import type { ProviderAdapter } from './adapter'

const REQUEST_TIMEOUT_MS = 45_000

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
    readonly provider: ProviderType

    constructor(provider: ProviderType) {
        this.provider = provider
    }

    async generateImage(request: GenerateImageRequest): Promise<GenerateImageResult> {
        const { config, prompt } = request
        const endpoint = buildImageEndpoint(config.baseUrl)

        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${config.apiKey.trim()}`,
                },
                body: JSON.stringify({
                    model: config.model.trim(),
                    prompt: prompt.trim(),
                    size: '1024x1024',
                    response_format: 'b64_json',
                }),
                signal: controller.signal,
            })

            const payload = (await response.json()) as OpenAIImageResponse

            if (!response.ok) {
                throw mapHttpStatusToError(
                    response.status,
                    'OpenAI-Compatible 请求失败，请确认 Base URL 与鉴权方式。',
                    payload.error?.message,
                )
            }

            const images = parseOpenAIImages(payload)
            if (images.length === 0) {
                throw createAppError(
                    'BAD_RESPONSE',
                    '供应商返回成功但未包含图片字段。',
                    false,
                )
            }

            const text = payload.data
                ?.map((entry) => entry.revised_prompt)
                .filter((value): value is string => Boolean(value && value.trim()))
                .join('\n')

            return {
                provider: this.provider,
                model: config.model,
                text: text || undefined,
                images,
                createdAt: new Date().toISOString(),
            }
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error) {
                throw error
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
    const normalized = baseUrl.trim().replace(/\/+$/, '')

    if (!normalized) {
        throw createAppError('VALIDATION', 'Base URL 不能为空。', false)
    }

    if (normalized.endsWith('/images/generations')) {
        return normalized
    }

    if (normalized.endsWith('/v1')) {
        return `${normalized}/images/generations`
    }

    if (normalized.endsWith('/#')) {
        return normalized.replace('/#', '')
    }

    return `${normalized}/v1/images/generations`
}
