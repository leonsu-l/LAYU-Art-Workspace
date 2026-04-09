export const providerOptions = [
    'gemini-official',
    'openai-compatible',
    'custom-openai-compatible',
] as const

export type ProviderType = (typeof providerOptions)[number]

export interface ProviderConfig {
    provider: ProviderType
    model: string
    apiKey: string
    baseUrl: string
    rememberApiKey: boolean
}

export interface PersistedConfigV1 {
    schemaVersion: 1
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
