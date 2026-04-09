import type { ProviderConfig, ValidationResult } from '../types/generation'
import { createAppError } from './errors'

const MAX_PROMPT_LENGTH = 4000
const OPENAI_SIZE_PATTERN = /^\d{2,5}x\d{2,5}$/i
const ASPECT_RATIO_PATTERN = /^\d{1,2}:\d{1,2}$/
const GEMINI_IMAGE_SIZES = new Set(['512', '1K', '2K', '4K'])
const GEMINI_THINKING_LEVELS = new Set(['minimal', 'high'])
const OPENAI_QUALITIES = new Set(['standard', 'hd'])

export function validatePrompt(prompt: string): ValidationResult {
  const normalized = prompt.trim()

  if (!normalized) {
    return {
      valid: false,
      error: createAppError('VALIDATION', '请输入用于生成图片的提示词。', false),
    }
  }

  if (normalized.length > MAX_PROMPT_LENGTH) {
    return {
      valid: false,
      error: createAppError(
        'VALIDATION',
        `提示词长度不能超过 ${MAX_PROMPT_LENGTH} 个字符。`,
        false,
      ),
    }
  }

  return { valid: true }
}

export function validateProviderConfig(config: ProviderConfig): ValidationResult {
  const profile = config.profiles[config.activeProvider]

  if (!profile) {
    return {
      valid: false,
      error: createAppError('VALIDATION', '当前供应商配置不存在。', false),
    }
  }

  if (!profile.model.trim()) {
    return {
      valid: false,
      error: createAppError('VALIDATION', '模型不能为空。', false),
    }
  }

  if (!profile.apiKey.trim()) {
    return {
      valid: false,
      error: createAppError('VALIDATION', 'API Key 不能为空。', false),
    }
  }

  if (!profile.baseUrl.trim()) {
    return {
      valid: false,
      error: createAppError('VALIDATION', '当前供应商需要填写 Base URL。', false),
    }
  }

  if (!isValidHttpUrl(profile.baseUrl)) {
    return {
      valid: false,
      error: createAppError('VALIDATION', 'Base URL 必须是合法的 http(s) 地址。', false),
    }
  }

  if (config.activeProvider === 'openai-compatible') {
    const openAIProfile = config.profiles['openai-compatible']

    if (!OPENAI_SIZE_PATTERN.test(openAIProfile.params.size.trim())) {
      return {
        valid: false,
        error: createAppError('VALIDATION', 'OpenAI 分辨率必须是 WxH 格式，例如 1024x1024。', false),
      }
    }

    if (!ASPECT_RATIO_PATTERN.test(openAIProfile.params.aspectRatio.trim())) {
      return {
        valid: false,
        error: createAppError('VALIDATION', 'OpenAI 比例必须是 X:Y 格式，例如 16:9。', false),
      }
    }

    if (!OPENAI_QUALITIES.has(openAIProfile.params.quality)) {
      return {
        valid: false,
        error: createAppError('VALIDATION', 'OpenAI 质量参数无效，请使用 standard 或 hd。', false),
      }
    }

    if (!Number.isInteger(openAIProfile.params.n) || openAIProfile.params.n < 1 || openAIProfile.params.n > 10) {
      return {
        valid: false,
        error: createAppError('VALIDATION', 'OpenAI 数量 n 必须为 1 到 10 的整数。', false),
      }
    }
  }

  if (config.activeProvider === 'gemini-compatible') {
    const geminiProfile = config.profiles['gemini-compatible']

    if (!GEMINI_IMAGE_SIZES.has(geminiProfile.params.imageSize)) {
      return {
        valid: false,
        error: createAppError('VALIDATION', 'Gemini 分辨率仅支持 512、1K、2K、4K。', false),
      }
    }

    if (!ASPECT_RATIO_PATTERN.test(geminiProfile.params.aspectRatio.trim())) {
      return {
        valid: false,
        error: createAppError('VALIDATION', 'Gemini 比例必须是 X:Y 格式，例如 16:9。', false),
      }
    }

    if (!GEMINI_THINKING_LEVELS.has(geminiProfile.params.thinkingLevel)) {
      return {
        valid: false,
        error: createAppError('VALIDATION', 'Gemini thinkingLevel 仅支持 minimal 或 high。', false),
      }
    }

    if (typeof geminiProfile.params.imageOnly !== 'boolean') {
      return {
        valid: false,
        error: createAppError('VALIDATION', 'Gemini imageOnly 必须为布尔值。', false),
      }
    }
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
