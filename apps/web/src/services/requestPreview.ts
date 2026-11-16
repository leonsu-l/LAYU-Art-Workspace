import type { ProviderConfig, ReferenceImage, RequestPreview } from '@nanobanana/shared/types/generation'
import { taskParams } from '@nanobanana/shared/utils/generationParams'
import { referenceImageBytes } from '../utils/referenceImages.ts'
export function buildRequestPreview(config: ProviderConfig, referenceImages: readonly ReferenceImage[] = []): RequestPreview {
  const profile = config.profiles[config.activeProvider]
  const params = taskParams(config.activeProvider, profile.params)
  return { provider: config.activeProvider, endpoint: '/api/tasks', method: 'POST', headersPreview: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': '[cookie token]' }, bodyPreview: {
    id: '[提交时生成 UUID]', prompt: '[提示词]', channelId: config.channelId ?? '', model: profile.model, params,
    ...(referenceImages.length ? { referenceImages: referenceImages.map((image) => ({ name: image.name, mimeType: image.mimeType, base64Data: `[${referenceImageBytes(image)} bytes，已隐藏]` })) } : {}),
  } }
}
