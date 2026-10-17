import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
    GeminiImageParams,
    OpenAIImageParams,
    ProviderConfig,
    ProviderType,
} from '../types/generation'
import { createDefaultProviderConfig } from '../utils/configDefaults'
import { loadPersistedConfig, savePersistedConfig } from '../utils/storage'
import { normalizeText } from '../utils/validation'
import { normalizeGeminiParams, normalizeOpenAIParams } from '../utils/imageModels'

const RISK_ACK_KEY = 'nanobanana.api-key-risk-ack'
const API_KEY_RISK_NOTICE = 'API Key 会自动缓存到浏览器本地存储，请仅在可信设备使用。'

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = createDefaultProviderConfig()

export function usePersistentConfig() {
    const [config, setConfig] = useState<ProviderConfig>(
        () => loadPersistedConfig() ?? createDefaultProviderConfig(),
    )
    const [apiKeyRiskNotice, setApiKeyRiskNotice] = useState<string | null>(null)
    const isHydrated = true

    useEffect(() => {
        try {
            savePersistedConfig(normalizeProviderConfigForSave(config))
        } catch {
            // Ignore storage failures so editing remains non-blocking.
        }
    }, [config])

    const maybeRevealApiKeyRiskNotice = useCallback((apiKey: string) => {
        if (!apiKey.trim()) {
            return
        }

        try {
            const hasAcknowledged = sessionStorage.getItem(RISK_ACK_KEY) === '1'
            if (hasAcknowledged) {
                return
            }

            sessionStorage.setItem(RISK_ACK_KEY, '1')
        } catch {
            // Ignore sessionStorage failures and still show notice.
        }

        setApiKeyRiskNotice((previous) => previous ?? API_KEY_RISK_NOTICE)
    }, [])

    const dismissApiKeyRiskNotice = useCallback(() => {
        setApiKeyRiskNotice(null)
    }, [])

    const setActiveProvider = useCallback((provider: ProviderType) => {
        setConfig((previous) => ({
            ...previous,
            activeProvider: provider,
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
            if (typeof patch.apiKey === 'string') {
                maybeRevealApiKeyRiskNotice(patch.apiKey)
            }

            setConfig((previous) => {
                const next = { ...previous, profiles: { ...previous.profiles } }
                if (provider === 'openai-compatible') {
                    const profile = { ...previous.profiles[provider], ...patch }
                    next.profiles[provider] = {
                        ...profile,
                        params: patch.model === undefined ? profile.params : normalizeOpenAIParams(profile.model, profile.params),
                    }
                } else {
                    const profile = { ...previous.profiles[provider], ...patch }
                    next.profiles[provider] = {
                        ...profile,
                        params: patch.model === undefined ? profile.params : normalizeGeminiParams(profile.model, profile.params),
                    }
                }
                return next
            })
        },
        [maybeRevealApiKeyRiskNotice],
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
                        // JPEG cannot carry alpha; keep the visible setting consistent with the request.
                        ...(patch.outputFormat === 'jpeg' && previous.profiles['openai-compatible'].params.background === 'transparent'
                            ? { background: 'auto' as const } : {}),
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

    const activeProvider = config.activeProvider
    const activeProfile = config.profiles[activeProvider]
    const hasApiKey = useMemo(() => activeProfile.apiKey.trim().length > 0, [activeProfile.apiKey])

    return {
        config,
        activeProvider,
        activeProfile,
        isHydrated,
        hasApiKey,
        apiKeyRiskNotice,
        dismissApiKeyRiskNotice,
        setActiveProvider,
        updateProviderProfile,
        updateOpenAIParams,
        updateGeminiParams,
    }
}

function normalizeProviderConfigForSave(config: ProviderConfig): ProviderConfig {
    const normalizedOpenAI = config.profiles['openai-compatible']
    const normalizedGemini = config.profiles['gemini-compatible']

    return {
        ...config,
        profiles: {
            'openai-compatible': {
                ...normalizedOpenAI,
                model: normalizeText(normalizedOpenAI.model),
                apiKey: normalizeText(normalizedOpenAI.apiKey),
                baseUrl: normalizeText(normalizedOpenAI.baseUrl),
                params: normalizeOpenAIParams(normalizedOpenAI.model, normalizedOpenAI.params),
            },
            'gemini-compatible': {
                ...normalizedGemini,
                model: normalizeText(normalizedGemini.model),
                apiKey: normalizeText(normalizedGemini.apiKey),
                baseUrl: normalizeText(normalizedGemini.baseUrl),
                params: normalizeGeminiParams(normalizedGemini.model, normalizedGemini.params),
            },
        },
    }
}
