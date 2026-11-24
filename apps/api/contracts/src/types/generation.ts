export const providerOptions = [
    'openai-compatible',
    'gemini-compatible',
] as const

export type ProviderType = (typeof providerOptions)[number]

export type OpenAIQuality = string

export type OpenAIOutputFormat = string

export type OpenAIBackground = string

export type GeminiThinkingLevel = string

export type GeminiImageSize = string

export interface OpenAIImageParams {
    size: string
    quality: OpenAIQuality
    n: number
    background: OpenAIBackground
    outputFormat: OpenAIOutputFormat
    outputCompression: number
    moderation: 'auto' | 'low'
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
    channelId?: string
    profiles: ProviderProfiles
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

export interface ReferenceImage {
    name: string
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
    base64Data: string
}

export interface GenerateImageRequest {
    prompt: string
    config: ProviderConfig
    referenceImages?: ReferenceImage[]
}

export interface GeneratedImage {
    retentionDays?: number | null
    expiresAt?: string | null
    mimeType: string
    base64Data?: string
    url?: string
}

export interface GalleryStorageStats {
    totalBytes: number
    imageCount: number
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

export type GenerationTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface GenerationTask {
    id: string
    status: GenerationTaskStatus
    createdAt: string
    updatedAt: string
    provider: ProviderType
    model: string
    prompt: string
    expectedImageCount: number
    expectedAspectRatio: string
    requestedSize?: string
    referenceImageCount?: number
    result?: GenerateImageResult
    error?: AppError
}

export interface TaskDeletionSummary {
    deletedTaskCount: number
    deletedImageCount: number
}

export interface ServerGalleryImage {
    retentionDays?: number | null
    expiresAt?: string | null
    id: string
    createdAt: string
    provider: ProviderType
    model: string
    prompt: string
    mimeType: string
    bytes: number
    url: string
}

export interface RequestPreview {
    provider: ProviderType
    endpoint: string
    method: 'POST'
    headersPreview: Record<string, string>
    bodyPreview: Record<string, unknown>
}
