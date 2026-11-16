import type { ProviderType, ReferenceImage } from '../types/generation.ts'
import { createAppError } from './errors.ts'


const MiB = 1024 * 1024
export interface ReferenceImageLimits {
  maxImages: number
  maxImageBytes: number
  maxTotalBytes: number
  note: string
}

// Application budgets, not claims about the providers' maximum file sizes.
// GPT edits allows up to 16 inputs (<50 MB each); bound the local JSON queue separately.
const OPENAI_LIMITS: ReferenceImageLimits = {
  maxImages: 16, maxImageBytes: 20 * MiB, maxTotalBytes: 32 * MiB,
  note: 'GPT 编辑接口支持最多 16 张；20 / 32 MiB 是当前应用的单张 / 合计存储预算，非官方文件上限。',
}
// Inline Gemini requests must stay below 20 MB including base64, prompt and config.
// 12 MiB of raw images expands to 16 MiB, leaving room for JSON and text.
const GEMINI_LIMITS: ReferenceImageLimits = {
  maxImages: 14, maxImageBytes: 12 * MiB, maxTotalBytes: 12 * MiB,
  note: 'Gemini 使用内联图片；原图合计 12 MiB 编码后约 16 MiB，为 20 MB 请求上限预留文字和配置空间。',
}
export function getReferenceImageLimits(provider: ProviderType, _model: string): ReferenceImageLimits {
  return provider === 'openai-compatible' ? OPENAI_LIMITS : GEMINI_LIMITS
}

// Base64 for 32 MiB of originals plus JSON overhead; other API routes retain their smaller limit.
export const MAX_TASK_BODY_BYTES = 44 * MiB
export const REFERENCE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'

export function formatReferenceLimit(bytes: number): string {
  return `${bytes / MiB} MiB`
}

export function referenceImageBytes(image: ReferenceImage): number {
  return image.base64Data.length * 3 / 4 - (image.base64Data.endsWith('==') ? 2 : image.base64Data.endsWith('=') ? 1 : 0)
}

/** Cheap preflight shared by file selection, drag/drop, model switches and server parsing. */
export function getReferenceImageLimitError(sizes: readonly number[], limits: ReferenceImageLimits): string | null {
  if (sizes.length > limits.maxImages) return `当前模型最多上传 ${limits.maxImages} 张参考图，已选 ${sizes.length} 张；请移除部分图片或切换模型。`
  if (sizes.some((size) => !Number.isFinite(size) || size <= 0 || size > limits.maxImageBytes)) {
    return `图片不能为空，且每张不得超过 ${formatReferenceLimit(limits.maxImageBytes)}。`
  }
  if (sizes.reduce((sum, size) => sum + size, 0) > limits.maxTotalBytes) {
    return `当前模型的参考图总大小不能超过 ${formatReferenceLimit(limits.maxTotalBytes)}。`
  }
  return null
}

function invalid(message: string): never {
  throw createAppError('VALIDATION', message, false, 400)
}

export function detectReferenceMime(bytes: Uint8Array): ReferenceImage['mimeType'] | undefined {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return undefined
}

/** Validate at both trust boundaries; return only the fields that may be persisted/sent. */
export function parseReferenceImages(value: unknown, limits: ReferenceImageLimits): ReferenceImage[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) invalid('参考图必须是图片列表。')
  if (value.length > limits.maxImages) invalid(`当前模型最多上传 ${limits.maxImages} 张参考图。`)
  let total = 0
  return value.map((item: unknown, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalid('参考图数据格式无效。')
    const image = item as Record<string, unknown>
    if (typeof image.name !== 'string' || !image.name.trim() || image.name.length > 255) invalid('参考图文件名无效。')
    if (image.mimeType !== 'image/png' && image.mimeType !== 'image/jpeg' && image.mimeType !== 'image/webp') {
      invalid('参考图仅支持 PNG、JPEG 和 WebP，不支持 SVG、GIF 或 HEIC。')
    }
    const data = image.base64Data
    if (typeof data !== 'string' || data.length === 0 || data.length > Math.ceil(limits.maxImageBytes / 3) * 4) {
      invalid(`参考图 ${index + 1} 为空或超过单张 ${formatReferenceLimit(limits.maxImageBytes)} 限制。`)
    }
    if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) invalid('参考图不是有效的 Base64 数据。')
    const bytes = referenceImageBytes({ name: image.name, mimeType: image.mimeType, base64Data: data })
    if (bytes > limits.maxImageBytes) invalid(`参考图超过单张 ${formatReferenceLimit(limits.maxImageBytes)} 限制。`)
    total += bytes
    if (total > limits.maxTotalBytes) invalid(`参考图总大小不能超过 ${formatReferenceLimit(limits.maxTotalBytes)}。`)
    let header: Uint8Array
    try {
      // Check canonical padding without allocating a full decoded copy of every large image.
      if (btoa(atob(data.slice(-4))) !== data.slice(-4)) invalid('参考图 Base64 编码不规范。')
      header = Uint8Array.from(atob(data.slice(0, 16)), (char) => char.charCodeAt(0))
    } catch {
      invalid('参考图不是有效的 Base64 数据。')
    }
    if (detectReferenceMime(header) !== image.mimeType) invalid(`参考图 ${index + 1} 的内容与图片格式不符。`)
    return { name: image.name.trim(), mimeType: image.mimeType, base64Data: data }
  })
}
