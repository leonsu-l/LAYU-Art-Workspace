import type {
    GenerateImageRequest,
    GenerateImageResult,
    GeneratedImage,
} from '../../types/generation'
import {
    createAppError,
    mapFetchFailureToError,
    mapHttpStatusToError,
} from '../../utils/errors'
import type { ProviderAdapter } from './adapter'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const REQUEST_TIMEOUT_MS = 45_000

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
    readonly provider = 'gemini-official' as const

    async generateImage(request: GenerateImageRequest): Promise<GenerateImageResult> {
        const { config, prompt } = request
        const model = encodeURIComponent(config.model.trim())
        const apiKey = encodeURIComponent(config.apiKey.trim())

        const endpoint = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`

        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [
                        {
                            role: 'user',
                            parts: [{ text: prompt.trim() }],
                        },
                    ],
                    generationConfig: {
                        responseModalities: ['TEXT', 'IMAGE'],
                    },
                }),
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

function parseGeminiImages(parts: GeminiPart[]): GeneratedImage[] {
    return parts
        .map((part) => part.inlineData ?? part.inline_data)
        .filter((inline): inline is GeminiInlineData => Boolean(inline?.data))
        .map((inline) => ({
            mimeType: inline.mimeType ?? inline.mime_type ?? 'image/png',
            base64Data: inline.data,
        }))
}
