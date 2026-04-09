import type { GenerateImageRequest, ProviderType } from '../types/generation'
import { createAppError } from '../utils/errors'
import type { ProviderAdapter } from './providers/adapter'
import { GeminiOfficialAdapter } from './providers/geminiOfficialAdapter'
import { OpenAICompatibleAdapter } from './providers/openAICompatibleAdapter'

const adapterRegistry: Record<ProviderType, ProviderAdapter> = {
    'gemini-official': new GeminiOfficialAdapter(),
    'openai-compatible': new OpenAICompatibleAdapter('openai-compatible'),
    'custom-openai-compatible': new OpenAICompatibleAdapter('custom-openai-compatible'),
}

export async function generateImageWithProvider(request: GenerateImageRequest) {
    const adapter = adapterRegistry[request.config.provider]

    if (!adapter) {
        throw createAppError('UNSUPPORTED', `不支持的供应商：${request.config.provider}`, false)
    }

    return adapter.generateImage(request)
}
