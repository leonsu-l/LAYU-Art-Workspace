import type {
  GenerateImageRequest,
  GenerateImageResult,
} from '@nanobanana/shared/types/generation'
import { createAppError } from '@nanobanana/shared/utils/errors'
import { GeminiOfficialAdapter } from './providers/geminiOfficialAdapter.ts'
import { OpenAICompatibleAdapter } from './providers/openAICompatibleAdapter.ts'

const openAIAdapter = new OpenAICompatibleAdapter()
const geminiAdapter = new GeminiOfficialAdapter()

export async function generateImageWithProvider(
  request: GenerateImageRequest,
): Promise<GenerateImageResult> {
  switch (request.config.activeProvider) {
    case 'openai-compatible':
      return openAIAdapter.generateImage(request)
    case 'gemini-compatible':
      return geminiAdapter.generateImage(request)
    default:
      throw createAppError('UNSUPPORTED', `不支持的供应商：${request.config.activeProvider}`, false)
  }
}
