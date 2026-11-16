import type { GeminiImageParams, OpenAIImageParams, OpenAIQuality, OpenAIOutputFormat, OpenAIBackground, GeminiImageSize, GeminiThinkingLevel, ProviderConfig } from '../types/generation.ts'
import { DEFAULT_PROVIDER_PROFILES } from './configDefaults.ts'
export const OPENAI_QUALITIES: readonly OpenAIQuality[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
export const OPENAI_OUTPUT_FORMATS: readonly OpenAIOutputFormat[] = ['png', 'jpeg', 'webp']
export const OPENAI_BACKGROUNDS: readonly OpenAIBackground[] = ['auto', 'opaque', 'transparent']
export const GEMINI_IMAGE_SIZES: readonly GeminiImageSize[] = ['auto', '512', '1K', '2K', '4K']
export const GEMINI_THINKING_LEVELS: readonly GeminiThinkingLevel[] = ['auto', 'minimal', 'medium', 'high']
export const OPENAI_FIXED_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const
export const OPENAI_FLEXIBLE_SIZES = [...OPENAI_FIXED_SIZES, '2048x2048', '2560x1440'] as const
// Protocol suggestions only. Model discovery and permission come exclusively from the API.
export function getOpenAIModel(model: string) { return { id: model, flexibleSize: true, qualities: OPENAI_QUALITIES, transparentBackground: true } }
export function getGeminiModel(model: string) { return { id: model, imageSizes: GEMINI_IMAGE_SIZES, aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'], thinkingLevels: GEMINI_THINKING_LEVELS } }
export function isOpenAISizeSupported(_model: string, size: string): boolean { return size === 'auto' || /^\d+x\d+$/.test(size) }
export function normalizeOpenAIParams(_model: string, params: Partial<OpenAIImageParams>): OpenAIImageParams { return { ...DEFAULT_PROVIDER_PROFILES['openai-compatible'].params, ...params } }
export function normalizeGeminiParams(_model: string, params: Partial<GeminiImageParams>): GeminiImageParams { return { ...DEFAULT_PROVIDER_PROFILES['gemini-compatible'].params, ...params } }
export function resolveExpectedAspectRatio(config: ProviderConfig): string {
  if (config.activeProvider === 'gemini-compatible') {
    const ratio = config.profiles['gemini-compatible'].params.aspectRatio
    return ratio === 'auto' ? '1:1' : ratio
  }
  const size = config.profiles['openai-compatible'].params.size
  const [width, height] = size.split('x').map(Number)
  return width > 0 && height > 0 ? `${width}:${height}` : '1:1'
}
