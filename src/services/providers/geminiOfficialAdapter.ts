import type {
    GenerateImageRequest,
    GenerateImageResult,
    GeneratedImage,
    ProviderConfig,
    RequestPreview,
} from '../../types/generation'
import {
    createAppError,
    mapFetchFailureToError,
    mapHttpStatusToError,
} from '../../utils/errors'
import type { ProviderAdapter } from './adapter'
import {
    getImageRequestTimeoutMs,
    getImageRequestTimeoutSeconds,
} from './requestTimeout'

const REQUEST_TIMEOUT_MS = getImageRequestTimeoutMs()
const REQUEST_TIMEOUT_SECONDS = getImageRequestTimeoutSeconds()

interface GeminiInlineData {
    data?: string
    mimeType?: string
    mime_type?: string
}

interface GeminiPart {
    text?: string
    inlineData?: GeminiInlineData
    inline_data?: GeminiInlineData
}

interface GeminiApiResponse {
    candidates?: Array<{
        content?: {
            parts?: GeminiPart[]
        }
    }>
    error?: {
        message?: string
    }
}

export class GeminiOfficialAdapter implements ProviderAdapter {
    readonly provider = 'gemini-compatible' as const

    buildRequestPreview(config: ProviderConfig): RequestPreview {
        const profile = config.profiles[this.provider]
        const endpoint = buildGeminiEndpoint(
            profile.baseUrl,
            profile.model,
            profile.apiKey ? '***' : '[API_KEY]',
        )

        return {
            provider: this.provider,
            endpoint,
            method: 'POST',
            headersPreview: {
                'Content-Type': 'application/json',
            },
            bodyPreview: {
                model: profile.model,
                responseModalities: profile.params.imageOnly ? ['IMAGE'] : ['TEXT', 'IMAGE'],
                image_size: profile.params.imageSize,
                aspect_ratio: profile.params.aspectRatio,
                thinkingLevel: profile.params.thinkingLevel,
            },
        }
    }

    async generateImage(request: GenerateImageRequest): Promise<GenerateImageResult> {
        const profile = request.config.profiles[this.provider]
        const endpoint = buildGeminiEndpoint(profile.baseUrl, profile.model, profile.apiKey)

        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(buildGeminiRequestBody(profile, request.prompt)),
                signal: controller.signal,
            })

            const payload = (await response.json()) as GeminiApiResponse

            if (!response.ok) {
                const details = payload.error?.message
                throw mapHttpStatusToError(
                    response.status,
                    'Gemini 请求失败，请检查配置后重试。',
                    details,
                )
            }

            const parts = payload.candidates?.[0]?.content?.parts ?? []
            const images = parseGeminiImages(parts)

            if (images.length === 0) {
                throw createAppError(
                    'BAD_RESPONSE',
                    'Gemini 返回成功但未包含图片数据。',
                    false,
                )
            }

            const text = parts
                .map((part) => part.text)
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

function buildGeminiRequestBody(
    profile: ProviderConfig['profiles']['gemini-compatible'],
    prompt: string,
) {
    const generationConfig: Record<string, unknown> = {
        responseModalities: profile.params.imageOnly ? ['IMAGE'] : ['TEXT', 'IMAGE'],
        imageConfig: {
            imageSize: profile.params.imageSize,
            aspectRatio: profile.params.aspectRatio,
        },
        thinkingConfig: {
            thinkingLevel: profile.params.thinkingLevel,
        },
    }

    return {
        contents: [
            {
                role: 'user',
                parts: [{ text: prompt.trim() }],
            },
        ],
        generationConfig,
    }
}

function buildGeminiEndpoint(baseUrl: string, model: string, apiKey: string): string {
    const normalizedBase = normalizeBaseUrl(baseUrl)
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

    if (normalizedBase.includes(':generateContent')) {
        return appendQueryParam(normalizedBase, 'key', encodedKey)
    }

    const endpoint = `${normalizedBase}/models/${encodedModel}:generateContent`
    return appendQueryParam(endpoint, 'key', encodedKey)
}

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.trim().replace(/\/+$/, '')
}

function appendQueryParam(url: string, key: string, value: string): string {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}${key}=${value}`
}

function parseGeminiImages(parts: GeminiPart[]): GeneratedImage[] {
    return parts
        .map((part) => part.inlineData ?? part.inline_data)
        .filter((inline): inline is GeminiInlineData => Boolean(inline?.data))
        .map((inline) => ({
            mimeType: inline.mimeType ?? inline.mime_type ?? 'image/png',
            base64Data: inline.data,
        }))
}
