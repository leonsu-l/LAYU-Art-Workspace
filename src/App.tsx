import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfigPanel } from './components/ConfigPanel'
import { PromptPanel } from './components/PromptPanel'
import { ResultPanel } from './components/ResultPanel'
import { useBeforeUnloadGuard } from './hooks/useBeforeUnloadGuard'
import { useImageGeneration } from './hooks/useImageGeneration'
import { usePersistentConfig } from './hooks/usePersistentConfig'
import { buildRequestPreview } from './services/imageGenerationService'
import { addGeneratedResultToGallery } from './utils/galleryDb'
import styles from './App.module.css'
import type { AppError, ProviderType } from './types/generation'

const PROMPT_STORAGE_KEY = 'nanobanana.prompt.last'

const providerNameMap: Record<ProviderType, string> = {
  'openai-compatible': 'OpenAI-Compatible',
  'gemini-compatible': 'Gemini-Compatible',
}

function App() {
  const {
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
  } = usePersistentConfig()

  const { isGenerating, result, error, generateImage, clearResult } = useImageGeneration()
  useBeforeUnloadGuard(isGenerating, '还未收到图片，若现在离开页面图片会丢失')

  const [prompt, setPrompt] = useState(() => loadPromptFromStorage())
  const [saveError, setSaveError] = useState<AppError | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [galleryNotice, setGalleryNotice] = useState<string | null>(null)

  useEffect(() => {
    savePromptToStorage(prompt)
  }, [prompt])

  const providerText = useMemo(() => providerNameMap[activeProvider], [activeProvider])
  const requestPreview = useMemo(() => {
    try {
      return buildRequestPreview(config)
    } catch {
      return null
    }
  }, [config])

  function handleSaveConfig() {
    const maybeError = saveConfig()

    if (maybeError) {
      setSaveError(maybeError)
      setSaveNotice(null)
      return
    }

    setSaveError(null)
    setSaveNotice('配置已保存到本地浏览器。')
  }

  function handleClearConfig() {
    clearConfig()
    setSaveError(null)
    setSaveNotice('本地配置已清空。')
  }

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
        return
      }

      setGalleryNotice('生成成功，但未识别到可保存图片。')
    } catch {
      setGalleryNotice('图片已生成，但保存到本地 Gallery 失败。')
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
            当前兼容协议：{providerText}。所有请求地址均可自定义，并支持生成参数按协议独立持久化。
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
            lastSavedAt={lastSavedAt}
            requestPreview={requestPreview}
            saveError={saveError}
            saveNotice={saveNotice}
            onProviderChange={setActiveProvider}
            onProfileChange={(patch) => updateProviderProfile(activeProvider, patch)}
            onRememberApiKeyChange={updateRememberApiKey}
            onDraftCacheEnabledChange={updateDraftCacheEnabled}
            onOpenAIParamsChange={updateOpenAIParams}
            onGeminiParamsChange={updateGeminiParams}
            onSaveConfig={handleSaveConfig}
            onClearConfig={handleClearConfig}
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
