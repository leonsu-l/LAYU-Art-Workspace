import type { ProviderConfig, ValidationResult } from '../types/generation'
import { createAppError } from './errors'

const MAX_PROMPT_LENGTH = 4000

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
    if (!config.model.trim()) {
        return {
            valid: false,
            error: createAppError('VALIDATION', '模型不能为空。', false),
        }
    }

    if (!config.apiKey.trim()) {
        return {
            valid: false,
            error: createAppError('VALIDATION', 'API Key 不能为空。', false),
        }
    }

    if (config.provider !== 'gemini-official') {
        if (!config.baseUrl.trim()) {
            return {
                valid: false,
                error: createAppError('VALIDATION', '当前供应商需要填写 Base URL。', false),
            }
        }

        if (!isValidHttpUrl(config.baseUrl)) {
            return {
                valid: false,
                error: createAppError('VALIDATION', 'Base URL 必须是合法的 http(s) 地址。', false),
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
