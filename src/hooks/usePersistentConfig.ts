import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
    AppError,
    GeminiImageParams,
    OpenAIImageParams,
    ProviderConfig,
    ProviderType,
} from '../types/generation'
import { createAppError } from '../utils/errors'
import { createDefaultProviderConfig } from '../utils/configDefaults'
import {
    clearDraftConfig,
    clearPersistedConfig,
    loadDraftConfig,
    loadPersistedConfig,
    saveDraftConfig,
    savePersistedConfig,
} from '../utils/storage'
import { normalizeText } from '../utils/validation'

const RISK_ACK_KEY = 'nanobanana.api-key-risk-ack'

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = createDefaultProviderConfig()

export function usePersistentConfig() {
    const [config, setConfig] = useState<ProviderConfig>(() => {
        const persisted = loadPersistedConfig()
        const shouldHydrateDraft = persisted?.draftCacheEnabled ?? true

        if (shouldHydrateDraft) {
            const draft = loadDraftConfig()
            if (draft) {
                return draft
            }
        }

        if (persisted) {
            return persisted
        }

        return createDefaultProviderConfig()
    })
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
    const isHydrated = true

    useEffect(() => {
        if (config.draftCacheEnabled) {
            saveDraftConfig(config)
            return
        }

        clearDraftConfig()
    }, [config])

    const setActiveProvider = useCallback((provider: ProviderType) => {
        setConfig((previous) => ({
            ...previous,
            activeProvider: provider,
        }))
    }, [])

    const updateRememberApiKey = useCallback((rememberApiKey: boolean) => {
        setConfig((previous) => ({
            ...previous,
            rememberApiKey,
        }))
    }, [])

    const updateDraftCacheEnabled = useCallback((draftCacheEnabled: boolean) => {
        setConfig((previous) => ({
            ...previous,
            draftCacheEnabled,
        }))
    }, [])

    const updateProviderProfile = useCallback(
        (
            provider: ProviderType,
            patch: Partial<{
                baseUrl: string
                model: string
                apiKey: string
            }>,
        ) => {
            setConfig((previous) => ({
                ...previous,
                profiles: {
                    ...previous.profiles,
                    [provider]: {
                        ...previous.profiles[provider],
                        ...patch,
                    },
                },
            }))
        },
        [],
    )

    const updateOpenAIParams = useCallback((patch: Partial<OpenAIImageParams>) => {
        setConfig((previous) => ({
            ...previous,
            profiles: {
                ...previous.profiles,
                'openai-compatible': {
                    ...previous.profiles['openai-compatible'],
                    params: {
                        ...previous.profiles['openai-compatible'].params,
                        ...patch,
                    },
                },
            },
        }))
    }, [])

    const updateGeminiParams = useCallback((patch: Partial<GeminiImageParams>) => {
        setConfig((previous) => ({
            ...previous,
            profiles: {
                ...previous.profiles,
                'gemini-compatible': {
                    ...previous.profiles['gemini-compatible'],
                    params: {
                        ...previous.profiles['gemini-compatible'].params,
                        ...patch,
                    },
                },
            },
        }))
    }, [])

    const saveConfig = useCallback((): AppError | null => {
        const normalizedConfig = normalizeProviderConfigForSave(config)

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
        clearDraftConfig()
        setConfig(createDefaultProviderConfig())
        setLastSavedAt(null)
    }, [])

    const activeProvider = config.activeProvider
    const activeProfile = config.profiles[activeProvider]
    const hasApiKey = useMemo(() => activeProfile.apiKey.trim().length > 0, [activeProfile.apiKey])

    return {
        config,
        activeProvider,
        activeProfile,
        isHydrated,
        hasApiKey,
        lastSavedAt,
        setActiveProvider,
        updateRememberApiKey,
        updateDraftCacheEnabled,
        updateProviderProfile,
        updateOpenAIParams,
        updateGeminiParams,
        saveConfig,
        clearConfig,
    }
}

function normalizeProviderConfigForSave(config: ProviderConfig): ProviderConfig {
    const normalizedOpenAI = config.profiles['openai-compatible']
    const normalizedGemini = config.profiles['gemini-compatible']

    const openAINRaw = Number(normalizedOpenAI.params.n)

    return {
        ...config,
        draftCacheEnabled: Boolean(config.draftCacheEnabled),
        profiles: {
            'openai-compatible': {
                ...normalizedOpenAI,
                model: normalizeText(normalizedOpenAI.model),
                apiKey: normalizeText(normalizedOpenAI.apiKey),
                baseUrl: normalizeText(normalizedOpenAI.baseUrl),
                params: {
                    ...normalizedOpenAI.params,
                    size: normalizeText(normalizedOpenAI.params.size),
                    aspectRatio: normalizeText(normalizedOpenAI.params.aspectRatio),
                    n: Number.isFinite(openAINRaw) ? Math.max(1, Math.min(10, Math.round(openAINRaw))) : 1,
                },
            },
            'gemini-compatible': {
                ...normalizedGemini,
                model: normalizeText(normalizedGemini.model),
                apiKey: normalizeText(normalizedGemini.apiKey),
                baseUrl: normalizeText(normalizedGemini.baseUrl),
                params: {
                    ...normalizedGemini.params,
                    aspectRatio: normalizeText(normalizedGemini.params.aspectRatio),
                },
            },
        },
    }
}
