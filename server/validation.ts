import type { GenerateImageRequest, ProviderType } from '../src/types/generation.ts'
import { createDefaultProviderConfig } from '../src/utils/configDefaults.ts'
import { createAppError } from '../src/utils/errors.ts'
import { validatePrompt, validateProviderConfig } from '../src/utils/validation.ts'
import { GEMINI_IMAGE_SIZES, GEMINI_THINKING_LEVELS, OPENAI_BACKGROUNDS, OPENAI_OUTPUT_FORMATS, OPENAI_QUALITIES } from '../src/utils/imageModels.ts'

import { getReferenceImageLimits, parseReferenceImages } from '../src/utils/referenceImages.ts'

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function invalid(message: string): never {
  throw createAppError('VALIDATION', message, false, 400)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('请求对象格式无效。')
  return value as Record<string, unknown>
}

function text(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) invalid(`${name} 格式或长度无效。`)
  return value.trim()
}

function option<T extends string>(value: unknown, choices: readonly T[], name: string): T {
  const selected = choices.find((choice) => choice === value)
  if (selected === undefined) invalid(`${name} 参数无效。`)
  return selected
}

// Whitelist fields: an inactive profile (and its API key) is never persisted.
export function parseTaskRequest(body: unknown): { id: string; request: GenerateImageRequest } {
  const input = record(body)
  const id = text(input.id, '任务 ID', 36).toLowerCase()
  if (!UUID_PATTERN.test(id)) invalid('任务 ID 必须是 UUID。')
  const prompt = text(input.prompt, '提示词', 4000)
  const rawConfig = record(input.config)
  if (rawConfig.activeProvider !== 'openai-compatible' && rawConfig.activeProvider !== 'gemini-compatible') {
    invalid('不支持的供应商。')
  }
  const provider: ProviderType = rawConfig.activeProvider
  const source = record(record(rawConfig.profiles)[provider])
  const params = record(source.params)
  const config = createDefaultProviderConfig()
  config.activeProvider = provider
  const common = {
    baseUrl: text(source.baseUrl, 'Base URL', 2048),
    model: text(source.model, '模型', 512),
    apiKey: text(source.apiKey, 'API Key', 4096),
  }
  if (provider === 'openai-compatible') {
    if (typeof params.n !== 'number') invalid('图片数量参数无效。')
    if (params.outputCompression !== undefined && typeof params.outputCompression !== 'number') invalid('输出压缩质量参数无效。')
    const quality = params.quality === 'hd' ? 'high' : params.quality === 'standard' ? 'medium' : params.quality
    config.profiles[provider] = {
      ...common,
      params: {
        size: text(params.size, '分辨率', 20),
        quality: option(quality, OPENAI_QUALITIES, '图片质量'),
        n: params.n,
        background: option(params.background ?? 'auto', OPENAI_BACKGROUNDS, '背景'),
        outputFormat: option(params.outputFormat ?? 'png', OPENAI_OUTPUT_FORMATS, '输出格式'),
        outputCompression: params.outputCompression === undefined ? 100 : params.outputCompression,
        moderation: option(params.moderation ?? 'auto', ['auto', 'low'], '内容审核'),
      },
    }
  } else {
    if (typeof params.imageOnly !== 'boolean') invalid('imageOnly 参数无效。')
    config.profiles[provider] = {
      ...common,
      params: {
        imageSize: option(params.imageSize, GEMINI_IMAGE_SIZES, '图片分辨率'),
        aspectRatio: text(params.aspectRatio, '比例', 5),
        imageOnly: params.imageOnly,
        thinkingLevel: option(params.thinkingLevel ?? 'auto', GEMINI_THINKING_LEVELS, '思考等级'),
      },
    }
  }
  for (const validation of [validatePrompt(prompt), validateProviderConfig(config)]) {
    if (!validation.valid) throw { ...validation.error, status: 400 }
  }
  const baseUrl = new URL(common.baseUrl)
  if (baseUrl.username || baseUrl.password || baseUrl.hash) invalid('Base URL 不允许包含用户名、密码或 URL 片段。')
  const referenceImages = parseReferenceImages(input.referenceImages, getReferenceImageLimits(provider, common.model))
  return { id, request: { prompt, config, ...(referenceImages.length ? { referenceImages } : {}) } }
}

export function parseImageIds(body: unknown): string[] {
  const ids = record(body).ids
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
    invalid('图片 ID 列表无效（每批最多 1000 张）。')
  }
  return [...new Set(ids as string[])]
}
