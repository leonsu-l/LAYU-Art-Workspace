import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfigPanel } from './components/ConfigPanel'
import { PromptPanel } from './components/PromptPanel'
import { ResultPanel } from './components/ResultPanel'
import { useBeforeUnloadGuard } from './hooks/useBeforeUnloadGuard'
import { useImageGeneration } from './hooks/useImageGeneration'
import { usePersistentConfig } from './hooks/usePersistentConfig'
import { buildRequestPreview } from './services/imageGenerationService'
import { addGeneratedResultToGallery, formatBytes, getGalleryStorageStats } from './utils/galleryDb'
import { getTrackedLocalStorageUsage, PROMPT_STORAGE_KEY } from './utils/storage'
import styles from './App.module.css'
import type { ProviderType } from './types/generation'

const providerNameMap: Record<ProviderType, string> = {
  'openai-compatible': 'OpenAI-Compatible',
  'gemini-compatible': 'Gemini-Compatible',
}

interface SiteCacheSummary {
  totalBytes: number
  localBytes: number
  galleryBytes: number
  galleryImageCount: number
}

function App() {
  const {
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
  } = usePersistentConfig()

  const { isGenerating, result, error, generateImage, clearResult } = useImageGeneration()
  useBeforeUnloadGuard(isGenerating, '还未收到图片，若现在离开页面图片会丢失')

  const [prompt, setPrompt] = useState(() => loadPromptFromStorage())
  const [galleryNotice, setGalleryNotice] = useState<string | null>(null)
  const [cacheSummary, setCacheSummary] = useState<SiteCacheSummary>({
    totalBytes: 0,
    localBytes: 0,
    galleryBytes: 0,
    galleryImageCount: 0,
  })

  const refreshCacheSummary = useCallback(async () => {
    const localUsage = getTrackedLocalStorageUsage()

    try {
      const galleryStats = await getGalleryStorageStats()
      setCacheSummary({
        totalBytes: localUsage.totalBytes + galleryStats.totalBytes,
        localBytes: localUsage.totalBytes,
        galleryBytes: galleryStats.totalBytes,
        galleryImageCount: galleryStats.imageCount,
      })
    } catch {
      setCacheSummary({
        totalBytes: localUsage.totalBytes,
        localBytes: localUsage.totalBytes,
        galleryBytes: 0,
        galleryImageCount: 0,
      })
    }
  }, [])

  useEffect(() => {
    savePromptToStorage(prompt)
  }, [prompt])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshCacheSummary()
    }, 240)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [config, prompt, refreshCacheSummary])

  const providerText = useMemo(() => providerNameMap[activeProvider], [activeProvider])
  const requestPreview = useMemo(() => {
    try {
      return buildRequestPreview(config)
    } catch {
      return null
    }
  }, [config])

  async function handleGenerate() {
    setGalleryNotice(null)

    const generated = await generateImage(prompt, config)
    if (!generated) {
      return
    }

    try {
      const summary = await addGeneratedResultToGallery(generated, prompt)
      if (summary.savedCount > 0) {
        const skippedNotice = summary.skippedCount > 0 ? `（${summary.skippedCount} 张未保存）` : ''
        setGalleryNotice(`已自动保存 ${summary.savedCount} 张图片到本地 Gallery ${skippedNotice}`)
        void refreshCacheSummary()
        return
      }

      setGalleryNotice('生成成功，但未识别到可保存图片。')
      void refreshCacheSummary()
    } catch {
      setGalleryNotice('图片已生成，但保存到本地 Gallery 失败。')
      void refreshCacheSummary()
    }
  }

  return (
    <div className={styles.appShell}>
      <div className={styles.gradientOrbTop} aria-hidden="true" />
      <div className={styles.gradientOrbBottom} aria-hidden="true" />

      <main className={styles.page}>
        <header className={styles.hero}>
          <span className={styles.badge}>NanoBanana Frontend Console</span>
          <h1 className={styles.title}>Image API Playground</h1>
          <p className={styles.subtitle}>
            当前兼容协议：{providerText}。所有请求地址均可自定义，配置与提示词会自动缓存到浏览器。
          </p>
          <p className={styles.cacheSummary}>
            站点缓存：
            <strong>{formatBytes(cacheSummary.totalBytes)}</strong>
            <span className={styles.cacheDetail}>
              配置与 Prompt <strong>{formatBytes(cacheSummary.localBytes)}</strong> · Gallery <strong>{formatBytes(cacheSummary.galleryBytes)}</strong>
              （{cacheSummary.galleryImageCount} 张）
            </span>
          </p>
          <div className={styles.heroActions}>
            <Link to="/gallery" className={styles.galleryLink}>
              打开 Gallery
            </Link>
          </div>
        </header>

        <section className={styles.grid}>
          <ConfigPanel
            config={config}
            activeProvider={activeProvider}
            activeProfile={activeProfile}
            hasApiKey={hasApiKey}
            isHydrated={isHydrated}
            apiKeyRiskNotice={apiKeyRiskNotice}
            requestPreview={requestPreview}
            onProviderChange={setActiveProvider}
            onProfileChange={(patch) => updateProviderProfile(activeProvider, patch)}
            onDismissApiKeyRiskNotice={dismissApiKeyRiskNotice}
            onOpenAIParamsChange={updateOpenAIParams}
            onGeminiParamsChange={updateGeminiParams}
          />

          <div className="space-y-4">
            {galleryNotice ? <p className={styles.galleryNotice}>{galleryNotice}</p> : null}

            <PromptPanel
              prompt={prompt}
              isGenerating={isGenerating}
              onPromptChange={setPrompt}
              onGenerate={handleGenerate}
              onClearResult={clearResult}
            />

            <ResultPanel isGenerating={isGenerating} result={result} error={error} />
          </div>
        </section>
      </main>
    </div>
  )
}

function loadPromptFromStorage(): string {
  try {
    return localStorage.getItem(PROMPT_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function savePromptToStorage(value: string): void {
  try {
    localStorage.setItem(PROMPT_STORAGE_KEY, value)
  } catch {
    // Ignore storage failures so prompt editing remains non-blocking.
  }
}

export default App
