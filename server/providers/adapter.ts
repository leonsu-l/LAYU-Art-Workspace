import type {
  GenerateImageRequest,
  GenerateImageResult,
  ProviderType,
} from '../../src/types/generation.ts'

export interface ProviderAdapter {
  readonly provider: ProviderType
  generateImage(request: GenerateImageRequest): Promise<GenerateImageResult>
}
