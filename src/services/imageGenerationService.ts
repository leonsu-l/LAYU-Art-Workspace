import type {
  GenerateImageRequest,
  ProviderConfig,
  ProviderType,
  RequestPreview,
} from '../types/generation'
import { createAppError } from '../utils/errors'
import type { ProviderAdapter } from './providers/adapter'
import { GeminiOfficialAdapter } from './providers/geminiOfficialAdapter'
import { OpenAICompatibleAdapter } from './providers/openAICompatibleAdapter'

const adapterRegistry: Record<ProviderType, ProviderAdapter> = {
  'openai-compatible': new OpenAICompatibleAdapter(),
  'gemini-compatible': new GeminiOfficialAdapter(),
}

export async function generateImageWithProvider(request: GenerateImageRequest) {
  const adapter = adapterRegistry[request.config.activeProvider]

  if (!adapter) {
    throw createAppError('UNSUPPORTED', `不支持的供应商：${request.config.activeProvider}`, false)
  }

  return adapter.generateImage(request)
}

export function buildRequestPreview(config: ProviderConfig): RequestPreview {
  const adapter = adapterRegistry[config.activeProvider]

  if (!adapter) {
    throw createAppError('UNSUPPORTED', `不支持的供应商：${config.activeProvider}`, false)
  }

  return adapter.buildRequestPreview(config)
}
