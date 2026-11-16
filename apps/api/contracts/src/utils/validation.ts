import type { ProviderConfig, ValidationResult } from '../types/generation.ts'
import { createAppError } from './errors.ts'
function invalid(message: string): ValidationResult { return { valid: false, error: createAppError('VALIDATION', message, false) } }
export function validatePrompt(prompt: string): ValidationResult {
  if (!prompt.trim()) return invalid('请输入用于生成图片的提示词。')
  return prompt.trim().length > 4000 ? invalid('提示词长度不能超过 4000 个字符。') : { valid: true }
}
export function validateProviderConfig(config: ProviderConfig): ValidationResult {
  const profile = config.profiles[config.activeProvider]
  if (!config.channelId) return invalid('请选择可用渠道。')
  if (!profile?.model.trim()) return invalid('请选择或填写模型 ID。')
  if (config.activeProvider === 'openai-compatible') {
    const p = config.profiles['openai-compatible'].params
    if (!p.size.trim() || !p.quality.trim()) return invalid('请填写尺寸与质量。')
    if (!Number.isInteger(p.n) || p.n < 1 || p.n > 10) return invalid('数量必须为 1 到 10 的整数。')
    if (!Number.isInteger(p.outputCompression) || p.outputCompression < 0 || p.outputCompression > 100) return invalid('压缩质量须为 0 到 100 的整数。')
  } else if (typeof config.profiles['gemini-compatible'].params.imageOnly !== 'boolean') return invalid('imageOnly 必须为布尔值。')
  return { valid: true }
}
export function isValidHttpUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}
export function normalizeText(value: string): string { return value.trim() }
