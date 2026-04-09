import { useMemo, useState } from 'react'
import { ConfigPanel } from './components/ConfigPanel'
import { PromptPanel } from './components/PromptPanel'
import { ResultPanel } from './components/ResultPanel'
import { useImageGeneration } from './hooks/useImageGeneration'
import { usePersistentConfig } from './hooks/usePersistentConfig'
import { buildRequestPreview } from './services/imageGenerationService'
import styles from './App.module.css'
import type { AppError, ProviderType } from './types/generation'

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
    updateProviderProfile,
    updateOpenAIParams,
    updateGeminiParams,
    saveConfig,
    clearConfig,
  } = usePersistentConfig()

  const { isGenerating, result, error, generateImage, clearResult } = useImageGeneration()

  const [prompt, setPrompt] = useState('',)
  const [saveError, setSaveError] = useState<AppError | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

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
    await generateImage(prompt, config)
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
            onOpenAIParamsChange={updateOpenAIParams}
            onGeminiParamsChange={updateGeminiParams}
            onSaveConfig={handleSaveConfig}
            onClearConfig={handleClearConfig}
          />

          <div className="space-y-4">
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

export default App
