export const providerOptions = [
    'openai-compatible',
    'gemini-compatible',
] as const

export type ProviderType = (typeof providerOptions)[number]

export type OpenAIQuality = 'standard' | 'hd'

export type GeminiThinkingLevel = 'minimal' | 'high'

export type GeminiImageSize = '512' | '1K' | '2K' | '4K'

export interface OpenAIImageParams {
    size: string
    aspectRatio: string
    quality: OpenAIQuality
    n: number
}

export interface GeminiImageParams {
    imageSize: GeminiImageSize
    aspectRatio: string
    imageOnly: boolean
    thinkingLevel: GeminiThinkingLevel
}

export interface OpenAIProviderProfile {
    baseUrl: string
    model: string
    apiKey: string
    params: OpenAIImageParams
}

export interface GeminiProviderProfile {
    baseUrl: string
    model: string
    apiKey: string
    params: GeminiImageParams
}

export interface ProviderProfiles {
    'openai-compatible': OpenAIProviderProfile
    'gemini-compatible': GeminiProviderProfile
}

export interface ProviderConfig {
    activeProvider: ProviderType
    profiles: ProviderProfiles
    rememberApiKey: boolean
    draftCacheEnabled: boolean
}

export type LegacyProviderType =
    | 'gemini-official'
    | 'openai-compatible'
    | 'custom-openai-compatible'

export interface LegacyProviderConfigV1 {
    provider: LegacyProviderType
    model: string
    apiKey: string
    baseUrl: string
    rememberApiKey: boolean
}

export interface PersistedConfigV1 {
    schemaVersion: 1
    config: LegacyProviderConfigV1
}

export interface PersistedConfigV2 {
    schemaVersion: 2
    config: ProviderConfig
}

export interface GenerateImageRequest {
    prompt: string
    config: ProviderConfig
}

export interface GeneratedImage {
    mimeType: string
    base64Data?: string
    url?: string
}

export interface GalleryImageRecord {
    id: string
    createdAt: string
    provider: ProviderType
    model: string
    prompt: string
    mimeType: string
    blob: Blob
    bytes: number
}

export interface GalleryStorageStats {
    totalBytes: number
    imageCount: number
}

export interface GallerySaveSummary {
    savedCount: number
    skippedCount: number
}

export interface GenerateImageResult {
    provider: ProviderType
    model: string
    text?: string
    images: GeneratedImage[]
    createdAt: string
}

export type AppErrorCode =
    | 'VALIDATION'
    | 'AUTH'
    | 'RATE_LIMIT'
    | 'NETWORK'
    | 'CORS'
    | 'BAD_RESPONSE'
    | 'UNSUPPORTED'
    | 'UNKNOWN'

export interface AppError {
    code: AppErrorCode
    message: string
    retryable: boolean
    status?: number
    details?: string
}

export interface ValidationResult {
    valid: boolean
    error?: AppError
}

export interface RequestPreview {
    provider: ProviderType
    endpoint: string
    method: 'POST'
    headersPreview: Record<string, string>
    bodyPreview: Record<string, unknown>
}
