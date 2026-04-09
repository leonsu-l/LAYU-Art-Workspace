import { useCallback, useState } from 'react'
import type {
    AppError,
    GenerateImageResult,
    ProviderConfig,
} from '../types/generation'
import { generateImageWithProvider } from '../services/imageGenerationService'
import { createAppError, isAppError } from '../utils/errors'
import { validatePrompt, validateProviderConfig } from '../utils/validation'

export function useImageGeneration() {
    const [isGenerating, setIsGenerating] = useState(false)
    const [result, setResult] = useState<GenerateImageResult | null>(null)
    const [error, setError] = useState<AppError | null>(null)

    const generateImage = useCallback(async (prompt: string, config: ProviderConfig) => {
        const promptValidation = validatePrompt(prompt)
        if (!promptValidation.valid) {
            setError(promptValidation.error ?? createAppError('VALIDATION', '提示词校验失败。', false))
            return null
        }

        const configValidation = validateProviderConfig(config)
        if (!configValidation.valid) {
            setError(configValidation.error ?? createAppError('VALIDATION', '配置校验失败。', false))
            return null
        }

        setIsGenerating(true)
        setError(null)

        try {
            const response = await generateImageWithProvider({
                prompt,
                config,
            })

            setResult(response)
            return response
        } catch (caughtError) {
            const normalizedError = isAppError(caughtError)
                ? caughtError
                : createAppError('UNKNOWN', '生成失败，请稍后重试。', true)
            setError(normalizedError)
            return null
        } finally {
            setIsGenerating(false)
        }
    }, [])

    const clearResult = useCallback(() => {
        setResult(null)
        setError(null)
    }, [])

    return {
        isGenerating,
        result,
        error,
        generateImage,
        clearResult,
    }
}
