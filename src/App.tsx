import { useMemo, useState } from 'react'
import { ConfigPanel } from './components/ConfigPanel'
import { PromptPanel } from './components/PromptPanel'
import { ResultPanel } from './components/ResultPanel'
import { useImageGeneration } from './hooks/useImageGeneration'
import { usePersistentConfig } from './hooks/usePersistentConfig'
import styles from './App.module.css'
import type { AppError, ProviderType } from './types/generation'

const providerNameMap: Record<ProviderType, string> = {
  'gemini-official': 'Gemini 官方接口',
  'openai-compatible': 'OpenAI-Compatible',
  'custom-openai-compatible': '自定义供应商',
}

function App() {
  const {
    config,
    isHydrated,
    hasApiKey,
    lastSavedAt,
    updateConfig,
    saveConfig,
    clearConfig,
  } = usePersistentConfig()

  const { isGenerating, result, error, generateImage, clearResult } = useImageGeneration()

  const [prompt, setPrompt] = useState('',)
  const [saveError, setSaveError] = useState<AppError | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  const providerText = useMemo(() => providerNameMap[config.provider], [config.provider])

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
          <h1 className={styles.title}>Gemini Image Playground</h1>
          <p className={styles.subtitle}>
            当前供应商：{providerText}。首版启用文本生图链路，已为参考图编辑与多轮会话预留服务层扩展位。
          </p>
        </header>

        <section className={styles.grid}>
          <ConfigPanel
            config={config}
            hasApiKey={hasApiKey}
            isHydrated={isHydrated}
            lastSavedAt={lastSavedAt}
            saveError={saveError}
            saveNotice={saveNotice}
            onConfigChange={updateConfig}
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
