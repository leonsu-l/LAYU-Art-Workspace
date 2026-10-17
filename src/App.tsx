import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfigPanel } from './components/ConfigPanel'
import { PromptPanel } from './components/PromptPanel'
import { ResultPanel } from './components/ResultPanel'
import { StudioHeader } from './components/StudioHeader'
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
import type { GenerationTask, GenerationTaskStatus, ProviderType, ReferenceImage } from './types/generation'

const providerNameMap: Record<ProviderType, string> = {
  'openai-compatible': 'OpenAI Compatible',
  'gemini-compatible': 'Gemini Compatible',
}

const taskStatusNames: Record<GenerationTaskStatus, string> = {
  queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败',
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
  const activeTaskCount = tasks.filter((task) => task.status === 'queued' || task.status === 'running').length
  const failedTaskCount = tasks.filter((task) => task.status === 'failed').length

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
    <div className={styles.appShell}>
      <StudioHeader />
      <main className={styles.page}>
        <header className={styles.pageHeading}>
          <div>
            <p className={styles.eyebrow}>A LITTLE PROMPT. A BIG POSSIBILITY.</p>
            <h1>今天，想造点什么<span>？</span></h1>
            <p className={styles.subtitle}>把脑海里的画面，交给你的想象力。</p>
          </div>
          <span className={styles.modeBadge}><Icon name="image" size={15} /> {referenceImages.length ? '文字 + 参考图' : '文本生图'} <span>IMAGE STUDIO</span></span>
        </header>

        <div className={styles.workspace}>
          <div className={styles.sidebar}>
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
              <Icon name="shield" size={17} />
              <div><strong>任务与新作品，由后端持久保存</strong><p>后端确认接收后可安全关闭或刷新页面。配置与提示词仍保存在浏览器；旧图库不迁移、不删除。</p></div>
            </div>
          </div>

          <div className={styles.creationArea}>
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
            <section className={styles.taskPanel} aria-label="持久任务历史">
              <div className={styles.taskHeader}>
                <div className={styles.taskHeading}><Icon name="folder" size={17} /><h2>任务历史</h2><span>{tasks.length}</span></div>
                <div className={styles.taskTools}>
                  {activeTaskCount > 0 ? <span className={styles.taskCount}>进行中 {activeTaskCount}</span> : null}
                  {failedTaskCount > 0 ? <span className={styles.failedCount}>失败 {failedTaskCount}</span> : null}
                  <button type="button" className={styles.refreshButton} onClick={refreshTasks} disabled={isRefreshing}>
                    <Icon name="loader" size={13} className={isRefreshing ? styles.spinner : ''} />{isRefreshing ? '正在同步' : '刷新 / 重连'}
                  </button>
                </div>
              </div>
              {!hasDiscovered ? <p className={styles.taskHint} role="status">正在发现后端已有任务；完成前暂停新提交。</p> : null}
              {connectionError ? <p className={styles.taskWarning} role="status">连接 / 恢复提示：{connectionError} 会自动重连，已有任务不会因此被标记为失败。</p> : null}
              {submissionError ? <p className={styles.taskError} role="alert">提交提示：{submissionError.message}</p> : null}
              {deletionError ? <p className={styles.taskError} role="alert">删除提示：{deletionError}</p> : null}
              {deletionNotice ? <p className={styles.taskHint} role="status">{deletionNotice}</p> : null}
              {isSubmitting ? <p className={styles.taskWarning} role="status">正在提交，尚待后端确认接收。此时建议不要关闭页面。</p> : null}
              {pendingSubmissions.length > 0 ? (
                <div className={styles.pendingTasks}>
                  <p>以下提交尚未确认，暂不创建新任务以防重复扣费。重试只使用同一 ID 和原始请求；刷新后需保持原提示词与配置，并按原顺序重新选择相同参考图。</p>
                  {pendingSubmissions.map((pending) => (
                    <div key={pending.id} className={styles.pendingRow}>
                      <code>{pending.id}</code>
                      <button type="button" className={styles.refreshButton} disabled={isSubmitting || isReadingImages || Boolean(deletingTaskId)}
                        onClick={() => void retrySubmission(pending, prompt, config, referenceImages)}>恢复 / 重试同一请求</button>
                    </div>
                  ))}
                </div>
              ) : null}
              {tasks.length > 0 ? <div className={styles.taskList}>
                {tasks.map((task) => (
                  <div key={task.id} className={styles.taskRow} aria-busy={deletingTaskId === task.id}>
                    <button type="button" aria-pressed={selectedTask?.id === task.id} onClick={() => selectTask(task.id)}
                      className={`${styles.taskItem} ${selectedTask?.id === task.id ? styles.selectedTask : ''}`}>
                      <span className={styles.taskTopline}>
                        <span className={styles.taskStatus} data-status={task.status}>{taskStatusNames[task.status]}</span>
                        <span className={styles.taskMeta}>{new Date(task.createdAt).toLocaleString('zh-CN')} · {task.model} · {task.referenceImageCount ? `${task.referenceImageCount} 张参考图` : '文生图'} · {task.id.slice(0, 8)}</span>
                        <Icon name="arrow-up-right" size={13} />
                      </span>
                      <span className={styles.taskPrompt} title={task.prompt}>{task.prompt}</span>
                    </button>
                    <button type="button" className={styles.deleteTaskButton}
                      disabled={Boolean(deletingTaskId) || isSubmitting || task.status === 'queued' || task.status === 'running'}
                      title={task.status === 'queued' || task.status === 'running' ? '进行中的任务不能删除，请等待生成结束' : '删除任务历史及该任务的全部生成图片'}
                      aria-label={`删除任务及关联图片：${task.prompt.slice(0, 60)}`}
                      onClick={() => handleDeleteTask(task)}>
                      <Icon name={deletingTaskId === task.id ? 'loader' : 'trash'} size={14} className={deletingTaskId === task.id ? styles.spinner : ''} />
                      {deletingTaskId === task.id ? '删除中' : '删除'}
                    </button>
                  </div>
                ))}
              </div> : hasDiscovered && !connectionError ? <p className={styles.taskHint}>还没有生成任务。写下灵感，开始第一张作品。</p> : null}
              {tasks.length > 0 ? <p className={styles.taskHint}>任务与图片按整组删除：删除任一后端图片也会删除所属任务及同组全部图片。排队中、生成中的任务暂不可删除。</p> : null}
              {!isSubmitting && selectedTask ? <p className={styles.taskHint}>
                当前任务：{taskStatusNames[selectedTask.status]}。{selectedTask.status === 'queued' || selectedTask.status === 'running'
                  ? '后端已接收，可安全关闭页面；下次打开自动恢复。' : '已保存任务状态，可随时从历史记录重新查看。'}
              </p> : null}
            </section>
            {selectedTask?.status === 'succeeded' ? (
              <div className={styles.galleryNotice} role="status">
                <span>新图片由后端保存，不会重复写入浏览器旧图库。</span><Link to="/gallery">查看图库 <Icon name="arrow-up-right" size={14} /></Link>
              </div>
            ) : null}
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
          </div>
        </div>

        <footer className={styles.footer}>
          <span className={styles.footerBrand}>nanobanana <span>·</span> 给想象一个形状</span>
          <span className={styles.cacheSummary}>
            <Icon name="folder" size={13} /> 配置与提示词 {formatBytes(cacheSummary.localBytes)}
            <span>·</span>浏览器旧图库 {cacheSummary.gallery?.browser ? `${formatBytes(cacheSummary.gallery.browser.totalBytes)} / ${cacheSummary.gallery.browser.imageCount} 张` : '暂不可用'}
          </span>
          <span className={styles.cacheSummary} title={cacheSummary.gallery?.serverError ?? ''}>
            后端图库 {cacheSummary.gallery?.server ? `${formatBytes(cacheSummary.gallery.server.totalBytes)} / ${cacheSummary.gallery.server.imageCount} 张` : '暂不可用'}（非浏览器缓存）
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
