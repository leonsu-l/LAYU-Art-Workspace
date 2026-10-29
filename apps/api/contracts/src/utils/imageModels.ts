import type {
  GeminiImageParams,
  GeminiImageSize,
  GeminiThinkingLevel,
  OpenAIBackground,
  OpenAIImageParams,
  OpenAIOutputFormat,
  OpenAIQuality,
  ProviderConfig,
} from '../types/generation.ts'

// Shared by the UI, persisted-config migration, server validation and request builders.
// Sources: https://developers.openai.com/api/docs/guides/image-generation
// https://ai.google.dev/gemini-api/docs/generate-content/image-generation
interface ImageModel {
  id: string
  label: string
  description: string
}

interface OpenAIImageModel extends ImageModel {
  flexibleSize: boolean
  qualities: readonly OpenAIQuality[]
  transparentBackground: boolean
}

interface GeminiImageModel extends ImageModel {
  imageSizes: readonly GeminiImageSize[]
  aspectRatios: readonly string[]
  thinkingLevels: readonly GeminiThinkingLevel[]
}

export const OPENAI_QUALITIES: readonly OpenAIQuality[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
export const OPENAI_OUTPUT_FORMATS: readonly OpenAIOutputFormat[] = ['png', 'jpeg', 'webp']
export const OPENAI_BACKGROUNDS: readonly OpenAIBackground[] = ['auto', 'opaque', 'transparent']
export const GEMINI_IMAGE_SIZES: readonly GeminiImageSize[] = ['512', '1K', '2K', '4K']
export const GEMINI_THINKING_LEVELS: readonly GeminiThinkingLevel[] = ['auto', 'minimal', 'medium', 'high']
const standardQualities = ['auto', 'low', 'medium', 'high'] as const
const standardRatios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const
const flashRatios = [...standardRatios, '1:4', '4:1', '1:8', '8:1']

export const OPENAI_IMAGE_MODELS: readonly OpenAIImageModel[] = [
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', description: '精细生成与编辑；支持灵活尺寸。', flexibleSize: true, qualities: OPENAI_QUALITIES, transparentBackground: true },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', description: '快速图片生成；支持灵活尺寸。', flexibleSize: true, qualities: OPENAI_QUALITIES, transparentBackground: true },
  { id: 'gpt-image-2', label: 'GPT Image 2', description: '支持灵活尺寸；透明背景为预览功能。', flexibleSize: true, qualities: standardQualities, transparentBackground: true },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5', description: '支持透明背景，使用固定尺寸。', flexibleSize: false, qualities: standardQualities, transparentBackground: true },
  { id: 'gpt-image-1-mini', label: 'GPT Image 1 Mini', description: '轻量图片模型；可用性以供应商为准。', flexibleSize: false, qualities: standardQualities, transparentBackground: true },
  { id: 'gpt-image-1', label: 'GPT Image 1', description: '上一代图片模型；可用性以供应商为准。', flexibleSize: false, qualities: standardQualities, transparentBackground: true },
]

const flashCapabilities = { imageSizes: GEMINI_IMAGE_SIZES, aspectRatios: flashRatios, thinkingLevels: ['auto', 'minimal', 'high'] as const }
const proCapabilities = { imageSizes: ['1K', '2K', '4K'] as const, aspectRatios: standardRatios, thinkingLevels: ['auto'] as const }
export const GEMINI_IMAGE_MODELS: readonly GeminiImageModel[] = [
  { id: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1 · 推荐', description: '支持 1K / 2K / 4K、14 种比例；默认中等思考深度。', imageSizes: ['1K', '2K', '4K'], aspectRatios: flashRatios, thinkingLevels: GEMINI_THINKING_LEVELS },
  // Lite's resolution table conflicts with its model page; only expose the confirmed 1K tier.
  { id: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite Image · Nano Banana 2 Lite', description: '快速轻量；开放已确认的 1K 分辨率，支持 14 种比例。', imageSizes: ['1K'], aspectRatios: flashRatios, thinkingLevels: ['auto', 'minimal', 'high'] },
  { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image · Nano Banana 2', description: '支持 512–4K 分辨率、扩展比例与可选思考深度。', ...flashCapabilities },
  { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image · Nano Banana Pro', description: '支持 1K / 2K / 4K；思考由模型自动管理。', ...proCapabilities },
  { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image · Nano Banana', description: '固定约 1K 输出，不发送分辨率或思考参数。', imageSizes: [], aspectRatios: standardRatios, thinkingLevels: ['auto'] },
]

export const OPENAI_FIXED_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const
export const OPENAI_FLEXIBLE_SIZES = [
  ...OPENAI_FIXED_SIZES, '1536x864', '864x1536', '2048x2048', '2048x1536', '1536x2048',
  '2560x1440', '1440x2560', '3840x2160', '2160x3840',
] as const

export function getOpenAIModel(model: string): OpenAIImageModel {
  const id = model.trim()
  return OPENAI_IMAGE_MODELS.find((item) => id === item.id || id.startsWith(`${item.id}-20`)) ?? {
    id, label: '自定义 GPT Image 模型', description: '按标准 GPT Image 参数发送；模型别名与支持能力请向兼容服务确认。',
    flexibleSize: false, qualities: standardQualities, transparentBackground: true,
  }
}

export function getGeminiModel(model: string): GeminiImageModel {
  // Older compatible services may still expose preview aliases with the same capabilities.
  return GEMINI_IMAGE_MODELS.find((item) => item.id === model.trim().replace(/-preview$/, '')) ?? {
    id: model.trim(), label: '自定义 Gemini 图片模型',
    description: '使用基础 Gemini 图片协议；不发送未确认支持的分辨率或思考参数。',
    imageSizes: [], aspectRatios: standardRatios, thinkingLevels: ['auto'],
  }
}

export function isOpenAISizeSupported(model: string, size: string): boolean {
  if (size === 'auto') return true
  if (!getOpenAIModel(model).flexibleSize) return OPENAI_FIXED_SIZES.some((value) => value === size)
  if (!/^\d+x\d+$/.test(size)) return false
  const [width, height] = size.split('x').map(Number)
  return width >= 16 && height >= 16 && width % 16 === 0 && height % 16 === 0 &&
    Math.max(width, height) <= 3840 && Math.max(width, height) / Math.min(width, height) <= 3 &&
    width * height >= 655_360 && width * height <= 8_294_400
}

export function normalizeOpenAIParams(model: string, params: Partial<OpenAIImageParams>): OpenAIImageParams {
  const capabilities = getOpenAIModel(model)
  // Migrate the old DALL-E-style settings without discarding saved credentials/model aliases.
  const oldQuality = params.quality as string | undefined
  const quality = oldQuality === 'hd' ? 'high' : oldQuality === 'standard' ? 'medium' : params.quality
  const outputFormat = OPENAI_OUTPUT_FORMATS.includes(params.outputFormat!) ? params.outputFormat! : 'png'
  const background = OPENAI_BACKGROUNDS.includes(params.background!) ? params.background! : 'auto'
  return {
    size: typeof params.size === 'string' && isOpenAISizeSupported(model, params.size.trim()) ? params.size.trim() : '1024x1024',
    quality: quality && capabilities.qualities.includes(quality) ? quality : 'auto',
    n: Number.isFinite(params.n) ? Math.max(1, Math.min(10, Math.round(params.n!))) : 1,
    background: background === 'transparent' && (!capabilities.transparentBackground || outputFormat === 'jpeg') ? 'auto' : background,
    outputFormat,
    outputCompression: Number.isFinite(params.outputCompression) ? Math.max(0, Math.min(100, Math.round(params.outputCompression!))) : 100,
    moderation: params.moderation === 'low' ? 'low' : 'auto',
  }
}

export function normalizeGeminiParams(model: string, params: Partial<GeminiImageParams>): GeminiImageParams {
  const capabilities = getGeminiModel(model)
  // Some older clients used 512px; generateContent uses the literal "512".
  const imageSize = (params.imageSize as string) === '512px' ? '512' : params.imageSize
  return {
    imageSize: imageSize && capabilities.imageSizes.includes(imageSize) ? imageSize : '1K',
    aspectRatio: params.aspectRatio === 'auto' || capabilities.aspectRatios.includes(params.aspectRatio!) ? params.aspectRatio! : '1:1',
    thinkingLevel: capabilities.thinkingLevels.includes(params.thinkingLevel!) ? params.thinkingLevel! : 'auto',
    imageOnly: typeof params.imageOnly === 'boolean' ? params.imageOnly : false,
  }
}

export function resolveExpectedAspectRatio(config: ProviderConfig): string {
  if (config.activeProvider === 'gemini-compatible') {
    const ratio = config.profiles['gemini-compatible'].params.aspectRatio
    return ratio === 'auto' ? '1:1' : ratio
  }
  const size = config.profiles['openai-compatible'].params.size
  if (!/^\d+x\d+$/.test(size)) return '1:1'
  const [width, height] = size.split('x').map(Number)
  if (!width || !height) return '1:1'
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}
