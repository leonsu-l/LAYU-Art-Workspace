import type {
  LegacyProviderType,
  ProviderConfig,
  ProviderProfiles,
  ProviderType,
} from '../types/generation'

export const DEFAULT_PROVIDER: ProviderType = 'openai-compatible'

export const DEFAULT_PROVIDER_PROFILES: ProviderProfiles = {
  'openai-compatible': {
    baseUrl: 'https://api.openai.com',
    model: 'gpt-image-1',
    apiKey: '',
    params: {
      size: '1024x1024',
      aspectRatio: '1:1',
      quality: 'standard',
      n: 1,
    },
  },
  'gemini-compatible': {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.1-flash-image-preview',
    apiKey: '',
    params: {
      imageSize: '1K',
      aspectRatio: '1:1',
      imageOnly: false,
      thinkingLevel: 'minimal',
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
    rememberApiKey: true,
    draftCacheEnabled: true,
  }
}

export function mapLegacyProviderToCurrent(provider: LegacyProviderType): ProviderType {
  if (provider === 'gemini-official') {
    return 'gemini-compatible'
  }

  return 'openai-compatible'
}
