import type {
    LegacyProviderConfigV1,
    PersistedConfigV1,
    PersistedConfigV2,
    ProviderConfig,
    ProviderType,
} from '../types/generation'
import {
    createDefaultProviderConfig,
    mapLegacyProviderToCurrent,
} from './configDefaults'

const STORAGE_KEY = 'nanobanana.provider-config'
const LEGACY_STORAGE_KEY = 'nanobanana.provider-config.v1'
const SCHEMA_VERSION = 2

const GEMINI_IMAGE_SIZES = new Set(['512', '1K', '2K', '4K'])
const GEMINI_THINKING_LEVELS = new Set(['minimal', 'high'])
const OPENAI_QUALITIES = new Set(['standard', 'hd'])

export function loadPersistedConfig(): ProviderConfig | null {
    try {
        const rawV2 = localStorage.getItem(STORAGE_KEY)
        if (rawV2) {
            const parsed = JSON.parse(rawV2) as unknown
            if (isPersistedConfigV2(parsed)) {
                return normalizeProviderConfig(parsed.config)
            }
        }

        const rawV1 = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (!rawV1) {
            return null
        }

        const parsed = JSON.parse(rawV1) as unknown
        if (!isPersistedConfigV1(parsed)) {
            return null
        }

        const migrated = migrateLegacyConfig(parsed.config)
        savePersistedConfig(migrated)
        localStorage.removeItem(LEGACY_STORAGE_KEY)
        return migrated
    } catch {
        return null
    }
}

export function savePersistedConfig(config: ProviderConfig): void {
    const normalized = normalizeProviderConfig(config)
    const payload: PersistedConfigV2 = {
        schemaVersion: SCHEMA_VERSION,
        config: {
            ...normalized,
            profiles: {
                ...normalized.profiles,
                'openai-compatible': {
                    ...normalized.profiles['openai-compatible'],
                    apiKey: normalized.rememberApiKey
                        ? normalized.profiles['openai-compatible'].apiKey
                        : '',
                },
                'gemini-compatible': {
                    ...normalized.profiles['gemini-compatible'],
                    apiKey: normalized.rememberApiKey
                        ? normalized.profiles['gemini-compatible'].apiKey
                        : '',
                },
            },
        },
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    localStorage.removeItem(LEGACY_STORAGE_KEY)
}

export function clearPersistedConfig(): void {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
}

function migrateLegacyConfig(legacyConfig: LegacyProviderConfigV1): ProviderConfig {
    const defaults = createDefaultProviderConfig()
    const activeProvider = mapLegacyProviderToCurrent(legacyConfig.provider)
    const targetProfile = defaults.profiles[activeProvider]

    return normalizeProviderConfig({
        ...defaults,
        activeProvider,
        rememberApiKey: legacyConfig.rememberApiKey,
        profiles: {
            ...defaults.profiles,
            [activeProvider]: {
                ...targetProfile,
                baseUrl: legacyConfig.baseUrl || targetProfile.baseUrl,
                model: legacyConfig.model || targetProfile.model,
                apiKey: legacyConfig.apiKey || '',
            },
        },
    })
}

function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
    const defaults = createDefaultProviderConfig()
    const activeProvider: ProviderType =
        config.activeProvider === 'gemini-compatible' ? 'gemini-compatible' : 'openai-compatible'

    const openaiProfile = config.profiles?.['openai-compatible']
    const geminiProfile = config.profiles?.['gemini-compatible']

    const openaiNRaw = Number(openaiProfile?.params?.n)
    const openaiN = Number.isFinite(openaiNRaw)
        ? Math.max(1, Math.min(10, Math.round(openaiNRaw)))
        : defaults.profiles['openai-compatible'].params.n

    return {
        activeProvider,
        rememberApiKey: Boolean(config.rememberApiKey),
        profiles: {
            'openai-compatible': {
                ...defaults.profiles['openai-compatible'],
                ...openaiProfile,
                params: {
                    ...defaults.profiles['openai-compatible'].params,
                    ...openaiProfile?.params,
                    size:
                        typeof openaiProfile?.params?.size === 'string' && openaiProfile.params.size.trim()
                            ? openaiProfile.params.size
                            : defaults.profiles['openai-compatible'].params.size,
                    aspectRatio:
                        typeof openaiProfile?.params?.aspectRatio === 'string' &&
                            openaiProfile.params.aspectRatio.trim()
                            ? openaiProfile.params.aspectRatio
                            : defaults.profiles['openai-compatible'].params.aspectRatio,
                    quality:
                        typeof openaiProfile?.params?.quality === 'string' &&
                            OPENAI_QUALITIES.has(openaiProfile.params.quality)
                            ? openaiProfile.params.quality
                            : defaults.profiles['openai-compatible'].params.quality,
                    n: openaiN,
                },
            },
            'gemini-compatible': {
                ...defaults.profiles['gemini-compatible'],
                ...geminiProfile,
                params: {
                    ...defaults.profiles['gemini-compatible'].params,
                    ...geminiProfile?.params,
                    imageSize:
                        typeof geminiProfile?.params?.imageSize === 'string' &&
                            GEMINI_IMAGE_SIZES.has(geminiProfile.params.imageSize)
                            ? geminiProfile.params.imageSize
                            : defaults.profiles['gemini-compatible'].params.imageSize,
                    aspectRatio:
                        typeof geminiProfile?.params?.aspectRatio === 'string' &&
                            geminiProfile.params.aspectRatio.trim()
                            ? geminiProfile.params.aspectRatio
                            : defaults.profiles['gemini-compatible'].params.aspectRatio,
                    imageOnly:
                        typeof geminiProfile?.params?.imageOnly === 'boolean'
                            ? geminiProfile.params.imageOnly
                            : defaults.profiles['gemini-compatible'].params.imageOnly,
                    thinkingLevel:
                        typeof geminiProfile?.params?.thinkingLevel === 'string' &&
                            GEMINI_THINKING_LEVELS.has(geminiProfile.params.thinkingLevel)
                            ? geminiProfile.params.thinkingLevel
                            : defaults.profiles['gemini-compatible'].params.thinkingLevel,
                },
            },
        },
    }
}

function isPersistedConfigV1(value: unknown): value is PersistedConfigV1 {
    if (!value || typeof value !== 'object') {
        return false
    }

    const candidate = value as Partial<PersistedConfigV1>
    return candidate.schemaVersion === 1 && isLegacyProviderConfigV1(candidate.config)
}

function isPersistedConfigV2(value: unknown): value is PersistedConfigV2 {
    if (!value || typeof value !== 'object') {
        return false
    }

    const candidate = value as Partial<PersistedConfigV2>
    return candidate.schemaVersion === 2 && isProviderConfigV2(candidate.config)
}

function isLegacyProviderConfigV1(config: unknown): config is LegacyProviderConfigV1 {
    if (!config || typeof config !== 'object') {
        return false
    }

    const candidate = config as Partial<LegacyProviderConfigV1>
    return (
        typeof candidate.provider === 'string' &&
        typeof candidate.model === 'string' &&
        typeof candidate.apiKey === 'string' &&
        typeof candidate.baseUrl === 'string' &&
        typeof candidate.rememberApiKey === 'boolean'
    )
}

function isProviderConfigV2(config: unknown): config is ProviderConfig {
    if (!config || typeof config !== 'object') {
        return false
    }

    const candidate = config as Partial<ProviderConfig>
    if (candidate.activeProvider !== 'openai-compatible' && candidate.activeProvider !== 'gemini-compatible') {
        return false
    }

    if (typeof candidate.rememberApiKey !== 'boolean') {
        return false
    }

    if (!candidate.profiles || typeof candidate.profiles !== 'object') {
        return false
    }

    const openai = candidate.profiles['openai-compatible']
    const gemini = candidate.profiles['gemini-compatible']

    return Boolean(openai && gemini)
}
