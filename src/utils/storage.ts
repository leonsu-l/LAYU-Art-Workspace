import type {
    LegacyProviderConfigV1,
    PersistedConfigV1,
    PersistedConfigV2,
    ProviderConfig,
    ProviderType,
} from '../types/generation.ts'
import { createDefaultProviderConfig, mapLegacyProviderToCurrent } from './configDefaults.ts'
import { normalizeGeminiParams, normalizeOpenAIParams } from './imageModels.ts'

export const STORAGE_KEY = 'nanobanana.provider-config'
const LEGACY_STORAGE_KEY = 'nanobanana.provider-config.v1'
const DRAFT_STORAGE_KEY = 'nanobanana.provider-config.draft.v2'
const LEGACY_DRAFT_SESSION_STORAGE_KEY = 'nanobanana.provider-config.draft.v2'
export const PROMPT_STORAGE_KEY = 'nanobanana.prompt.last'
const SCHEMA_VERSION = 2

const TRACKED_LOCAL_STORAGE_KEYS = [
    STORAGE_KEY,
    PROMPT_STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    DRAFT_STORAGE_KEY,
]

interface LocalStorageUsageItem {
    key: string
    bytes: number
}

export interface LocalStorageUsageSummary {
    totalBytes: number
    items: LocalStorageUsageItem[]
}

export function loadPersistedConfig(): ProviderConfig | null {
    try {
        const rawV2 = localStorage.getItem(STORAGE_KEY)
        if (rawV2) {
            const parsed = JSON.parse(rawV2) as unknown
            if (isPersistedConfigV2(parsed)) {
                return normalizeProviderConfig(parsed.config, true)
            }
        }

        const draft = loadLegacyDraftConfig()
        if (draft) {
            savePersistedConfig(draft)
            return draft
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
        config: normalized,
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    sessionStorage.removeItem(LEGACY_DRAFT_SESSION_STORAGE_KEY)
}

export function clearPersistedConfig(): void {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    sessionStorage.removeItem(LEGACY_DRAFT_SESSION_STORAGE_KEY)
}

export function getTrackedLocalStorageUsage(): LocalStorageUsageSummary {
    const usageItems: LocalStorageUsageItem[] = []

    for (const key of TRACKED_LOCAL_STORAGE_KEYS) {
        try {
            const value = localStorage.getItem(key)
            if (value === null) {
                continue
            }

            const bytes = estimateUtf8Bytes(key) + estimateUtf8Bytes(value)
            usageItems.push({
                key,
                bytes,
            })
        } catch {
            continue
        }
    }

    const totalBytes = usageItems.reduce((sum, item) => sum + item.bytes, 0)
    return {
        totalBytes,
        items: usageItems,
    }
}

function loadLegacyDraftConfig(): ProviderConfig | null {
    try {
        const rawDraft = localStorage.getItem(DRAFT_STORAGE_KEY)
        if (rawDraft) {
            const parsed = JSON.parse(rawDraft) as unknown
            if (isPersistedConfigV2(parsed)) {
                return normalizeProviderConfig(parsed.config, true)
            }
        }

        const legacyRawDraft = sessionStorage.getItem(LEGACY_DRAFT_SESSION_STORAGE_KEY)
        if (!legacyRawDraft) {
            return null
        }

        const parsed = JSON.parse(legacyRawDraft) as unknown
        if (!isPersistedConfigV2(parsed)) {
            return null
        }

        return normalizeProviderConfig(parsed.config, true)
    } catch {
        return null
    }
}

function migrateLegacyConfig(legacyConfig: LegacyProviderConfigV1): ProviderConfig {
    const defaults = createDefaultProviderConfig()
    const activeProvider = mapLegacyProviderToCurrent(legacyConfig.provider)
    const targetProfile = defaults.profiles[activeProvider]

    return normalizeProviderConfig({
        ...defaults,
        activeProvider,
        profiles: {
            ...defaults.profiles,
            [activeProvider]: {
                ...targetProfile,
                baseUrl: legacyConfig.baseUrl || targetProfile.baseUrl,
                model: legacyConfig.model || targetProfile.model,
                apiKey: legacyConfig.apiKey || '',
            },
        },
    }, true)
}

function normalizeProviderConfig(config: ProviderConfig, migrateRetiredModels = false): ProviderConfig {
    const defaults = createDefaultProviderConfig()
    const activeProvider: ProviderType =
        config.activeProvider === 'gemini-compatible' ? 'gemini-compatible' : 'openai-compatible'

    const openaiProfile = config.profiles?.['openai-compatible']
    const geminiProfile = config.profiles?.['gemini-compatible']

    const openaiModel = typeof openaiProfile?.model === 'string'
        ? openaiProfile.model : defaults.profiles['openai-compatible'].model
    let geminiModel = typeof geminiProfile?.model === 'string'
        ? geminiProfile.model : defaults.profiles['gemini-compatible'].model
    // Official preview IDs have retired; leave third-party aliases untouched.
    if (migrateRetiredModels && geminiProfile?.baseUrl?.trim().startsWith('https://generativelanguage.googleapis.com/') &&
        ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview', 'gemini-2.5-flash-image-preview'].includes(geminiModel)) {
        geminiModel = geminiModel.replace(/-preview$/, '')
    }

    return {
        activeProvider,
        profiles: {
            'openai-compatible': {
                ...defaults.profiles['openai-compatible'],
                ...openaiProfile,
                model: openaiModel,
                params: normalizeOpenAIParams(openaiModel, openaiProfile?.params ?? {}),
            },
            'gemini-compatible': {
                ...defaults.profiles['gemini-compatible'],
                ...geminiProfile,
                model: geminiModel,
                params: normalizeGeminiParams(geminiModel, geminiProfile?.params ?? {}),
            },
        },
    }
}

function estimateUtf8Bytes(value: string): number {
    try {
        return new TextEncoder().encode(value).length
    } catch {
        return value.length
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
    if (
        candidate.activeProvider !== 'openai-compatible' &&
        candidate.activeProvider !== 'gemini-compatible'
    ) {
        return false
    }

    if (!candidate.profiles || typeof candidate.profiles !== 'object') {
        return false
    }

    const openai = candidate.profiles['openai-compatible']
    const gemini = candidate.profiles['gemini-compatible']

    return Boolean(openai && gemini)
}
