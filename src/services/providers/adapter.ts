import type {
    GenerateImageRequest,
    GenerateImageResult,
    ProviderType,
} from '../../types/generation'

export interface ProviderAdapter {
    readonly provider: ProviderType
    generateImage(request: GenerateImageRequest): Promise<GenerateImageResult>
}
