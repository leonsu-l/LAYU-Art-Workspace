import type { PersistedConfigV1, ProviderConfig } from '../types/generation'

const STORAGE_KEY = 'nanobanana.provider-config.v1'
const SCHEMA_VERSION = 1

export function loadPersistedConfig(): ProviderConfig | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) {
            return null
        }

        const parsed = JSON.parse(raw) as Partial<PersistedConfigV1>
        if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !parsed.config) {
            return null
        }

        if (!isValidProviderConfig(parsed.config)) {
            return null
        }

        return parsed.config
    } catch {
        return null
    }
}

export function savePersistedConfig(config: ProviderConfig): void {
    const payload: PersistedConfigV1 = {
        schemaVersion: SCHEMA_VERSION,
        config: {
            ...config,
            apiKey: config.rememberApiKey ? config.apiKey : '',
        },
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export function clearPersistedConfig(): void {
    localStorage.removeItem(STORAGE_KEY)
}

function isValidProviderConfig(config: unknown): config is ProviderConfig {
    if (!config || typeof config !== 'object') {
        return false
    }

    const candidate = config as Partial<ProviderConfig>

    return (
        typeof candidate.provider === 'string' &&
        typeof candidate.model === 'string' &&
        typeof candidate.apiKey === 'string' &&
        typeof candidate.baseUrl === 'string' &&
        typeof candidate.rememberApiKey === 'boolean'
    )
}
