import type {
  LegacyProviderType,
  ProviderConfig,
  ProviderProfiles,
  ProviderType,
} from '../types/generation.ts'

export const DEFAULT_PROVIDER: ProviderType = 'openai-compatible'

export const DEFAULT_PROVIDER_PROFILES: ProviderProfiles = {
  'openai-compatible': {
    baseUrl: 'https://api.openai.com',
    model: 'gpt-image-2.5-flare',
    apiKey: '',
    params: {
      size: '1024x1024',
      quality: 'auto',
      n: 1,
      background: 'auto',
      outputFormat: 'png',
      outputCompression: 100,
      moderation: 'auto',
    },
  },
  'gemini-compatible': {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-nano-banana-2.1',
    apiKey: '',
    params: {
      imageSize: '1K',
      aspectRatio: '1:1',
      imageOnly: false,
      thinkingLevel: 'auto',
    },
  },
}

export function createDefaultProviderConfig(): ProviderConfig {
  return {
    activeProvider: DEFAULT_PROVIDER,
    profiles: {
      'openai-compatible': {
        ...DEFAULT_PROVIDER_PROFILES['openai-compatible'],
        params: {
          ...DEFAULT_PROVIDER_PROFILES['openai-compatible'].params,
        },
      },
      'gemini-compatible': {
        ...DEFAULT_PROVIDER_PROFILES['gemini-compatible'],
        params: {
          ...DEFAULT_PROVIDER_PROFILES['gemini-compatible'].params,
        },
      },
    },
  }
}

export function mapLegacyProviderToCurrent(provider: LegacyProviderType): ProviderType {
  if (provider === 'gemini-official') {
    return 'gemini-compatible'
  }

  return 'openai-compatible'
}
