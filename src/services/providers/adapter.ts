import type {
    GenerateImageRequest,
    GenerateImageResult,
    ProviderConfig,
    ProviderType,
    RequestPreview,
} from '../../types/generation'

export interface ProviderAdapter {
    readonly provider: ProviderType
    generateImage(request: GenerateImageRequest): Promise<GenerateImageResult>
    buildRequestPreview(config: ProviderConfig): RequestPreview
}
