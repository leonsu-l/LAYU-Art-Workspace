import type { ProviderConfig, ValidationResult } from '../types/generation.ts'
import { createAppError } from './errors.ts'
import {
  getGeminiModel,
  getOpenAIModel,
  isOpenAISizeSupported,
  OPENAI_BACKGROUNDS,
  OPENAI_OUTPUT_FORMATS,
} from './imageModels.ts'

const MAX_PROMPT_LENGTH = 4000

function invalid(message: string): ValidationResult {
  return { valid: false, error: createAppError('VALIDATION', message, false) }
}

export function validatePrompt(prompt: string): ValidationResult {
  const normalized = prompt.trim()
  if (!normalized) return invalid('请输入用于生成图片的提示词。')
  if (normalized.length > MAX_PROMPT_LENGTH) return invalid(`提示词长度不能超过 ${MAX_PROMPT_LENGTH} 个字符。`)
  return { valid: true }
}

export function validateProviderConfig(config: ProviderConfig): ValidationResult {
  const profile = config.profiles[config.activeProvider]
  if (!profile) return invalid('当前供应商配置不存在。')
  if (!profile.model.trim()) return invalid('模型不能为空。')
  if (!profile.apiKey.trim()) return invalid('API Key 不能为空。')
  if (!profile.baseUrl.trim()) return invalid('当前供应商需要填写 Base URL。')
  if (!isValidHttpUrl(profile.baseUrl)) return invalid('Base URL 必须是合法的 http(s) 地址。')

  if (config.activeProvider === 'openai-compatible') {
    const { model, params } = config.profiles['openai-compatible']
    const capabilities = getOpenAIModel(model)
    if (!isOpenAISizeSupported(model, params.size)) {
      return invalid(capabilities.flexibleSize
        ? '尺寸须为 auto 或 WxH：宽高为 16 的倍数，长边不超过 3840，比例介于 1:3–3:1，总像素为 655360–8294400。'
        : '当前模型尺寸仅支持 auto、1024x1024、1536x1024、1024x1536。')
    }
    if (!capabilities.qualities.includes(params.quality)) return invalid('当前模型不支持所选图片质量。')
    if (!Number.isInteger(params.n) || params.n < 1 || params.n > 10) return invalid('OpenAI 数量 n 必须为 1 到 10 的整数。')
    if (!OPENAI_OUTPUT_FORMATS.includes(params.outputFormat)) return invalid('图片格式仅支持 png、jpeg 或 webp。')
    if (!OPENAI_BACKGROUNDS.includes(params.background)) return invalid('背景参数无效。')
    if (params.background === 'transparent' && (!capabilities.transparentBackground || params.outputFormat === 'jpeg')) {
      return invalid('透明背景需要支持该功能的模型，并选择 PNG 或 WebP 格式。')
    }
    if (!Number.isInteger(params.outputCompression) || params.outputCompression < 0 || params.outputCompression > 100) {
      return invalid('输出压缩质量必须为 0 到 100 的整数。')
    }
    if (params.moderation !== 'auto' && params.moderation !== 'low') return invalid('内容审核仅支持 auto 或 low。')
  } else {
    const { model, params } = config.profiles['gemini-compatible']
    const capabilities = getGeminiModel(model)
    if (capabilities.imageSizes.length ? !capabilities.imageSizes.includes(params.imageSize) : params.imageSize !== '1K') {
      return invalid('当前 Gemini 模型不支持所选分辨率。')
    }
    if (params.aspectRatio !== 'auto' && !capabilities.aspectRatios.includes(params.aspectRatio)) {
      return invalid('当前 Gemini 模型不支持所选图片比例。')
    }
    if (!capabilities.thinkingLevels.includes(params.thinkingLevel)) return invalid('当前 Gemini 模型不支持所选思考深度，请使用自动。')
    if (typeof params.imageOnly !== 'boolean') return invalid('Gemini imageOnly 必须为布尔值。')
  }
  return { valid: true }
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function normalizeText(value: string): string {
  return value.trim()
}
