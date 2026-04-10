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
  const [expectedImageCount, setExpectedImageCount] = useState(1)
  const [expectedAspectRatio, setExpectedAspectRatio] = useState('1:1')

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

    setExpectedImageCount(resolveExpectedImageCount(config))
    setExpectedAspectRatio(resolveExpectedAspectRatio(config))
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
    setExpectedImageCount(1)
    setExpectedAspectRatio('1:1')
  }, [])

  return {
    isGenerating,
    result,
    error,
    expectedImageCount,
    expectedAspectRatio,
    generateImage,
    clearResult,
  }
}

function resolveExpectedImageCount(config: ProviderConfig): number {
  if (config.activeProvider !== 'openai-compatible') {
    return 1
  }

  const rawCount = Number(config.profiles['openai-compatible'].params.n)
  if (!Number.isFinite(rawCount)) {
    return 1
  }

  return Math.max(1, Math.min(10, Math.round(rawCount)))
}

function resolveExpectedAspectRatio(config: ProviderConfig): string {
  const ratio = config.activeProvider === 'openai-compatible'
    ? config.profiles['openai-compatible'].params.aspectRatio
    : config.profiles['gemini-compatible'].params.aspectRatio

  if (!/^\d{1,2}:\d{1,2}$/.test(ratio.trim())) {
    return '1:1'
  }

  return ratio.trim()
}
