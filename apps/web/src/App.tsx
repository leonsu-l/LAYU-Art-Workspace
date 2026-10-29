import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfigPanel } from './components/ConfigPanel'
import { PromptPanel } from './components/PromptPanel'
import { ResultPanel } from './components/ResultPanel'
import { StudioHeader } from './components/StudioHeader'
import { TaskRoll } from './components/TaskRoll'
import { Icon } from './components/Icon'
import { useBeforeUnloadGuard } from './hooks/useBeforeUnloadGuard'
import { useImageGeneration } from './hooks/useImageGeneration'
import { usePersistentConfig } from './hooks/usePersistentConfig'
import { buildRequestPreview } from './services/imageGenerationService'
import { formatBytes } from './utils/galleryDb'
import { getGalleryStorageSummary, type GalleryStorageSummary } from './services/galleryService'
import { getTrackedLocalStorageUsage, PROMPT_STORAGE_KEY } from './utils/storage'
import { promptIdeas } from './utils/promptIdeas'
import { getReferenceImageLimitError, getReferenceImageLimits, referenceImageBytes } from './utils/referenceImages'
import styles from './App.module.css'
import type { GenerationTask, ProviderType, ReferenceImage } from '@nanobanana/shared/types/generation'

const providerNameMap: Record<ProviderType, string> = {
  'openai-compatible': 'OpenAI Compatible',
  'gemini-compatible': 'Gemini Compatible',
}

interface SiteCacheSummary {
  localBytes: number
  gallery: GalleryStorageSummary | null
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

  const {
    isGenerating,
    result,
    error,
    expectedImageCount,
    expectedAspectRatio,
    generateImage,
    clearResult,
    tasks,
    selectedTask,
    pendingSubmissions,
    isSubmitting,
    isRefreshing,
    hasDiscovered,
    canSubmit,
    connectionError,
    submissionError,
    deletingTaskId,
    deletionError,
    deletionNotice,
    deleteTask,
    retrySubmission,
    refreshTasks,
    selectTask,
  } = useImageGeneration()
  useBeforeUnloadGuard(isSubmitting, '正在提交，尚未确认后端接收。离开后请恢复同一请求，不要重复创建任务。')

  const [prompt, setPrompt] = useState(() => loadPromptFromStorage())
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [isReadingImages, setIsReadingImages] = useState(false)
  const referenceLimits = getReferenceImageLimits(activeProvider, activeProfile.model)
  const referenceImageError = getReferenceImageLimitError(referenceImages.map(referenceImageBytes), referenceLimits)
  const [cacheSummary, setCacheSummary] = useState<SiteCacheSummary>({ localBytes: 0, gallery: null })
  const completedTaskVersion = tasks.filter((task) => task.status === 'succeeded').map((task) => task.id).join(',')

  useEffect(() => {
    savePromptToStorage(prompt)
  }, [prompt])

  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      void getGalleryStorageSummary(controller.signal).then((gallery) => {
        if (!controller.signal.aborted) setCacheSummary({ localBytes: getTrackedLocalStorageUsage().totalBytes, gallery })
      })
    }, 240)
    return () => { window.clearTimeout(timeoutId); controller.abort() }
  }, [config, prompt, completedTaskVersion, connectionError])

  const requestPreview = useMemo(() => {
    try {
      return buildRequestPreview(config, referenceImages)
    } catch {
      return null
    }
  }, [config, referenceImages])

  function handleGenerate() {
    if (!isReadingImages && !referenceImageError) void generateImage(prompt, config, referenceImages)
  }

  function handleUseIdea() {
    setPrompt(promptIdeas[0].prompt)
    document.getElementById('image-prompt')?.focus()
  }

  function handleDeleteTask(task: GenerationTask) {
    if (deletingTaskId || isSubmitting || task.status === 'queued' || task.status === 'running') return
    const count = task.result?.images.length ?? 0
    if (window.confirm(`确认删除这条任务历史${count ? `及关联的 ${count} 张图片` : ''}吗？\n该任务在图库和磁盘中的全部生成图片会一并删除，此操作无法撤销。`)) {
      void deleteTask(task.id)
    }
  }

  function handleClearResult() {
    clearResult() // Only clears the selected preview, never a durable task.
  }

  return (
    <div className={styles.shell}>
      <StudioHeader />
      <main id="main" className={styles.page}>
        <header className={styles.masthead}>
          <div className={styles.mastheadMain}>
            <p className={styles.kicker}><span className={styles.kickerMark} aria-hidden="true" />A LITTLE PROMPT. A BIG POSSIBILITY.</p>
            <h1 className={styles.title}>今天，想造点什么<span className={styles.titleMark}>？</span></h1>
            <p className={styles.subtitle}>把脑海里的画面，交给你的想象力。</p>
          </div>
          <div className={styles.mastheadMeta}>
            <span className={styles.mode}>{referenceImages.length ? '文字 + 参考图' : '文本生图'}</span>
            <span className={styles.studio}>IMAGE STUDIO · 本地暗房</span>
          </div>
        </header>

        <div className={styles.workspace}>
          <aside className={styles.sidebar} aria-label="暗房设置与存储说明">
            <ConfigPanel
              config={config}
              activeProvider={activeProvider}
              activeProfile={activeProfile}
              hasApiKey={hasApiKey}
              isHydrated={isHydrated}
              apiKeyRiskNotice={apiKeyRiskNotice}
              requestPreview={requestPreview}
              hasReferenceImages={referenceImages.length > 0}
              onProviderChange={setActiveProvider}
              onProfileChange={(patch) => updateProviderProfile(activeProvider, patch)}
              onDismissApiKeyRiskNotice={dismissApiKeyRiskNotice}
              onOpenAIParamsChange={updateOpenAIParams}
              onGeminiParamsChange={updateGeminiParams}
            />
            <div className={styles.storageNote}>
              <Icon name="shield" size={16} />
              <div>
                <strong>任务与新作品，由后端持久保存</strong>
                <p>后端确认接收后可安全关闭或刷新页面。配置与提示词仍保存在浏览器；旧图库不迁移、不删除。</p>
              </div>
            </div>
          </aside>

          <div className={styles.stage}>
            <PromptPanel
              prompt={prompt}
              isSubmitting={isSubmitting}
              canSubmit={canSubmit && isHydrated}
              hasDiscovered={hasDiscovered}
              hasApiKey={hasApiKey}
              onPromptChange={setPrompt}
              onGenerate={handleGenerate}
              referenceImages={referenceImages}
              referenceLimits={referenceLimits}
              referenceImageError={referenceImageError}
              isReadingImages={isReadingImages}
              onReferenceImagesChange={setReferenceImages}
              onReadingImagesChange={setIsReadingImages}
            />
            <ResultPanel
              isGenerating={isGenerating}
              isSubmitting={isSubmitting}
              taskStatus={selectedTask?.status}
              result={result}
              error={error}
              expectedImageCount={expectedImageCount}
              expectedAspectRatio={expectedAspectRatio}
              requestedSize={isSubmitting ? undefined : selectedTask?.requestedSize}
              onUseIdea={handleUseIdea}
              onClearResult={handleClearResult}
            />
            {selectedTask?.status === 'succeeded' ? (
              <p className={styles.galleryNotice} role="status">
                <span>新图片由后端保存，不会重复写入浏览器旧图库。</span>
                <Link to="/gallery" viewTransition>查看图库<Icon name="arrow-up-right" size={13} /></Link>
              </p>
            ) : null}
            <TaskRoll
              tasks={tasks}
              selectedTask={selectedTask}
              pendingSubmissions={pendingSubmissions}
              isSubmitting={isSubmitting}
              isRefreshing={isRefreshing}
              isReadingImages={isReadingImages}
              hasDiscovered={hasDiscovered}
              connectionError={connectionError}
              submissionError={submissionError}
              deletingTaskId={deletingTaskId}
              deletionError={deletionError}
              deletionNotice={deletionNotice}
              onSelectTask={selectTask}
              onDeleteTask={handleDeleteTask}
              onRefresh={refreshTasks}
              onRetrySubmission={(pending) => void retrySubmission(pending, prompt, config, referenceImages)}
            />
          </div>
        </div>

        <footer className={styles.footer}>
          <span className={styles.footerBrand}>nanobanana <span aria-hidden="true">·</span> 给想象一个形状</span>
          <span className={styles.cacheItem}>
            <Icon name="folder" size={13} />
            配置与提示词 <span className={`${styles.cacheValue} tnum`}>{formatBytes(cacheSummary.localBytes)}</span>
            <span aria-hidden="true">·</span>
            浏览器旧图库 <span className={`${styles.cacheValue} tnum`}>{cacheSummary.gallery?.browser ? `${formatBytes(cacheSummary.gallery.browser.totalBytes)} / ${cacheSummary.gallery.browser.imageCount} 张` : '暂不可用'}</span>
          </span>
          <span className={styles.cacheItem} title={cacheSummary.gallery?.serverError ?? ''}>
            后端图库 <span className={`${styles.cacheValue} tnum`}>{cacheSummary.gallery?.server ? `${formatBytes(cacheSummary.gallery.server.totalBytes)} / ${cacheSummary.gallery.server.imageCount} 张` : '暂不可用'}</span>
            （非浏览器缓存）
          </span>
          <span className={styles.protocol}>{providerNameMap[activeProvider]}</span>
        </footer>
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
