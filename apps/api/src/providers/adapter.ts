import type {
  GenerateImageRequest,
  GenerateImageResult,
  ProviderType,
} from '@nanobanana/shared/types/generation'

export interface ProviderAdapter {
  readonly provider: ProviderType
  generateImage(request: GenerateImageRequest): Promise<GenerateImageResult>
}
