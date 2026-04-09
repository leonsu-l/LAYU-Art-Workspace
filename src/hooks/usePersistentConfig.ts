import { useCallback, useMemo, useState } from 'react'
import type { AppError, ProviderConfig } from '../types/generation'
import { createAppError } from '../utils/errors'
import {
    clearPersistedConfig,
    loadPersistedConfig,
    savePersistedConfig,
} from '../utils/storage'
import { normalizeText } from '../utils/validation'

const RISK_ACK_KEY = 'nanobanana.api-key-risk-ack'

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
    provider: 'gemini-official',
    model: 'gemini-3.1-flash-image-preview',
    apiKey: '',
    baseUrl: 'https://api.openai.com',
    rememberApiKey: true,
}

export function usePersistentConfig() {
    const [config, setConfig] = useState<ProviderConfig>(() => {
        const persisted = loadPersistedConfig()

        if (!persisted) {
            return DEFAULT_PROVIDER_CONFIG
        }

        return {
            ...DEFAULT_PROVIDER_CONFIG,
            ...persisted,
        }
    })
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
    const isHydrated = true

    const updateConfig = useCallback((patch: Partial<ProviderConfig>) => {
        setConfig((previous) => ({
            ...previous,
            ...patch,
        }))
    }, [])

    const saveConfig = useCallback((): AppError | null => {
        const normalizedConfig: ProviderConfig = {
            ...config,
            model: normalizeText(config.model),
            apiKey: normalizeText(config.apiKey),
            baseUrl: normalizeText(config.baseUrl),
        }

        if (normalizedConfig.rememberApiKey) {
            const hasAcknowledged = sessionStorage.getItem(RISK_ACK_KEY) === '1'
            if (!hasAcknowledged) {
                const accepted = window.confirm(
                    '你正在把 API Key 保存到浏览器本地存储。该方式存在泄露风险，是否继续？',
                )

                if (!accepted) {
                    return createAppError('VALIDATION', '已取消保存敏感配置。', false)
                }

                sessionStorage.setItem(RISK_ACK_KEY, '1')
            }
        }

        try {
            savePersistedConfig(normalizedConfig)
            setConfig(normalizedConfig)
            setLastSavedAt(new Date().toISOString())
            return null
        } catch (error) {
            const details = error instanceof Error ? error.message : 'Unknown storage error'
            return createAppError('UNKNOWN', '保存配置失败，请检查浏览器存储权限。', true, undefined, details)
        }
    }, [config])

    const clearConfig = useCallback(() => {
        clearPersistedConfig()
        setConfig(DEFAULT_PROVIDER_CONFIG)
        setLastSavedAt(null)
    }, [])

    const hasApiKey = useMemo(() => config.apiKey.trim().length > 0, [config.apiKey])

    return {
        config,
        isHydrated,
        hasApiKey,
        lastSavedAt,
        updateConfig,
        saveConfig,
        clearConfig,
    }
}
