import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConnectionSettingsPanel, GenerationParamsPanel } from './components/ConfigPanel'
import { Icon } from './components/Icon'
import { ChannelSelector } from './components/ChannelSelector'
import { userStorageKey } from './services/sessionScope'
import { PromptPanel } from './components/PromptPanel'
import { ResultPanel } from './components/ResultPanel'
import { TaskRoll } from './components/TaskRoll'
import { useRipple } from './components/ui/useRipple'
import { useBeforeUnloadGuard } from './hooks/useBeforeUnloadGuard'
import { useImageGeneration } from './hooks/useImageGeneration'
import { usePersistentConfig } from './hooks/usePersistentConfig'
import { getGalleryStorageSummary, type GalleryStorageSummary } from './services/galleryService'
import { buildRequestPreview } from './services/imageGenerationService'
import { formatBytes } from './utils/galleryDb'
import { promptIdeas } from './utils/promptIdeas'
import { getReferenceImageLimitError, getReferenceImageLimits, referenceImageBytes } from './utils/referenceImages'
import { PROMPT_STORAGE_KEY } from './utils/storage'
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
    ready, channels, channel, catalog, templates, quota, error: configError, saveStatus, selectChannel,
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

  const [promptKey] = useState(() => userStorageKey(PROMPT_STORAGE_KEY))
  const [prompt, setPrompt] = useState(() => loadPromptFromStorage(promptKey))
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [isReadingImages, setIsReadingImages] = useState(false)


  const referenceLimits = getReferenceImageLimits(activeProvider, activeProfile.model)
  const referenceImageError = getReferenceImageLimitError(referenceImages.map(referenceImageBytes), referenceLimits)
  const [cacheSummary, setCacheSummary] = useState<SiteCacheSummary>({ localBytes: 0, gallery: null })
  const completedTaskVersion = tasks.filter((task) => task.status === 'succeeded').map((task) => task.id).join(',')

  const promptLength = prompt.trim().length
  const canGenerate =
    canSubmit &&
    isHydrated && ready && (channel?.scope !== 'shared' || Boolean(quota?.configured && (quota.unlimited || (quota.remaining ?? 0) > 0))) &&
    !isSubmitting &&
    !isReadingImages &&
    !referenceImageError &&
    promptLength > 0 &&
    promptLength <= 4000

  const { ripples, triggerRipple, dismissRipple } = useRipple(!canGenerate)

  useEffect(() => {
    savePromptToStorage(promptKey, prompt)
  }, [prompt, promptKey])

  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      void getGalleryStorageSummary(controller.signal).then((gallery) => {
        if (!controller.signal.aborted) setCacheSummary({ localBytes: new TextEncoder().encode(prompt).length, gallery })
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

  function openConnectionSettings() {
    document.getElementById('connection-settings')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function handleGenerate() {
    if (canGenerate) {
      void generateImage(prompt, config, referenceImages)
    }
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

  const hasTopAlerts =
    !hasDiscovered ||
    Boolean(connectionError) ||
    Boolean(submissionError) ||
    isSubmitting ||
    pendingSubmissions.length > 0

  return (
    <div className={styles.shell}>
      <main id="main" className={styles.page}>
        <header className={styles.studioBar}>
          <div className={styles.studioTitleGroup}>
            <h1 className={styles.title}>创作工作台</h1>
            <p className={styles.subtitle}>输入描述与参考图，在右侧即时对照查看生成结果。</p>
          </div>
          <div className={styles.studioBadges}>
            <span className={styles.modeChip}>
              <span className={styles.modeDot} aria-hidden="true" />
              {referenceImages.length ? `图文生图 · ${referenceImages.length} 张` : '文本生图'}
            </span>
            <span className={styles.modelChip} title={activeProfile.model || '未填模型 ID'}>
              {activeProvider === 'openai-compatible' ? 'OpenAI' : 'Gemini'} · {activeProfile.model || '自定义模型'}
            </span>
            <button
              type="button"
              className={`${styles.keyChip} ${ready ? styles.keyChipReady : styles.keyChipMissing}`}
              onClick={openConnectionSettings}
            >
              <Icon name={ready ? 'check' : 'settings'} size={13} />
              <span>{ready ? '渠道就绪' : '选择渠道'}</span>
            </button>
          </div>
        </header>

        {hasTopAlerts ? (
          <section className={styles.alertStack} aria-label="状态与恢复提示">
            {!hasDiscovered ? (
              <div className={styles.alertCard} data-tone="neutral" role="status">
                <Icon name="loader" size={16} className={styles.spinner} />
                <p className={styles.alertMessage}>正在发现后端已有任务；完成前暂停新提交。</p>
              </div>
            ) : null}

            {connectionError ? (
              <div className={styles.alertCard} data-tone="warning" role="status">
                <Icon name="alert-circle" size={16} />
                <p className={styles.alertMessage}>
                  连接 / 恢复提示：{connectionError} 会自动重连，已有任务不会因此被标记为失败。
                </p>
                <button type="button" className={styles.alertButton} onClick={refreshTasks} disabled={isRefreshing}>
                  {isRefreshing ? '正在同步' : '刷新 / 重连'}
                </button>
              </div>
            ) : null}

            {submissionError ? (
              <div className={styles.alertCard} data-tone="error" role="alert">
                <Icon name="alert-circle" size={16} />
                <p className={styles.alertMessage}>提交提示：{submissionError.message}</p>
              </div>
            ) : null}

            {isSubmitting ? (
              <div className={styles.alertCard} data-tone="warning" role="status">
                <Icon name="loader" size={16} className={styles.spinner} />
                <p className={styles.alertMessage}>正在提交，尚待后端确认接收。此时建议不要关闭页面。</p>
              </div>
            ) : null}

            {pendingSubmissions.length > 0 ? (
              <div className={styles.pendingBanner} role="alert">
                <p className={styles.pendingCopy}>
                  以下提交尚未确认，暂不创建新任务以防重复扣费。重试只使用同一 ID 和原始请求；刷新后需保持原提示词与配置，并按原顺序重新选择相同参考图。
                </p>
                <div className={styles.pendingList}>
                  {pendingSubmissions.map((pending) => (
                    <div key={pending.id} className={styles.pendingRow}>
                      <code>{pending.id}</code>
                      <button
                        type="button"
                        className={styles.alertButton}
                        disabled={isSubmitting || isReadingImages || Boolean(deletingTaskId)}
                        onClick={() => void retrySubmission(pending, prompt, config, referenceImages)}
                      >
                        恢复 / 重试同一请求
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <div className={styles.workspace}>
          <div className={styles.controlsColumn}>
            <ChannelSelector channels={channels} channelId={config.channelId} provider={activeProvider} model={activeProfile.model} catalog={catalog} templates={templates} quota={quota} error={configError} saveStatus={saveStatus} isHydrated={isHydrated} onChannel={selectChannel} onProvider={setActiveProvider} onModel={(model) => updateProviderProfile(activeProvider, { model })} onTemplate={(template) => activeProvider === 'openai-compatible' ? updateOpenAIParams(template.params) : updateGeminiParams(template.params)} />
            <PromptPanel
              prompt={prompt}
              isSubmitting={isSubmitting}
              canGenerate={canGenerate}
              onPromptChange={setPrompt}
              onGenerate={handleGenerate}
              referenceImages={referenceImages}
              referenceLimits={referenceLimits}
              referenceImageError={referenceImageError}
              onReferenceImagesChange={setReferenceImages}
              onReadingImagesChange={setIsReadingImages}
            />

            <GenerationParamsPanel
              config={config}
              activeProvider={activeProvider}
              activeProfile={activeProfile}
              isHydrated={isHydrated}
              hasReferenceImages={referenceImages.length > 0}
              onProfileChange={(patch) => updateProviderProfile(activeProvider, patch)}
              onOpenAIParamsChange={updateOpenAIParams}
              onGeminiParamsChange={updateGeminiParams}
            />

            <ConnectionSettingsPanel requestPreview={requestPreview} />

            <div className={styles.actionBar}>
              <div className={styles.actionStatus}>
                {!ready ? (
                  <button type="button" className={styles.setupLink} onClick={openConnectionSettings}>
                    <Icon name="settings" size={15} />
                    <span>请先选择可用渠道和模型</span>
                  </button>
                ) : referenceImageError ? (
                  <span className={styles.blockerError}>
                    <Icon name="alert-circle" size={15} />
                    <span>参考图超出限制，请先调整</span>
                  </span>
                ) : isReadingImages ? (
                  <span className={styles.blockerMuted}>正在读取参考图…</span>
                ) : !hasDiscovered ? (
                  <span className={styles.blockerMuted}>正在恢复后端任务，请稍候…</span>
                ) : pendingSubmissions.length > 0 ? (
                  <span className={styles.blockerError}>存在待确认提交，请先在上方恢复或刷新</span>
                ) : connectionError ? (
                  <span className={styles.blockerError}>连接异常，等待重连或刷新任务后可提交</span>
                ) : promptLength === 0 ? (
                  <span className={styles.blockerMuted}>输入提示词后即可开始生成</span>
                ) : promptLength > 4000 ? (
                  <span className={styles.blockerError}>提示词超出 4,000 字上限</span>
                ) : (
                  <span className={styles.readyHint}>
                    <Icon name="check" size={14} />
                    <span>就绪 · Ctrl / ⌘ + ↵ 快速提交</span>
                  </span>
                )}
              </div>

              <button
                type="button"
                className={styles.primaryButton}
                onPointerDown={triggerRipple}
                onClick={handleGenerate}
                disabled={!canGenerate}
              >
                <span className={styles.rippleLayer} aria-hidden="true">
                  {ripples.map((wave) => (
                    <span
                      key={wave.id}
                      className={styles.ripple}
                      style={{
                        width: `${wave.size}px`,
                        height: `${wave.size}px`,
                        left: `${wave.left}px`,
                        top: `${wave.top}px`,
                      }}
                      onAnimationEnd={() => dismissRipple(wave.id)}
                    />
                  ))}
                </span>
                <Icon name={isSubmitting ? 'loader' : 'sparkles'} size={17} className={isSubmitting ? styles.spinner : ''} />
                <span>
                  {isSubmitting
                    ? '正在提交'
                    : isReadingImages
                      ? '正在读取图片'
                      : !hasDiscovered
                        ? '正在恢复任务'
                        : !canSubmit
                          ? '等待连接 / 确认'
                          : '开始生成'}
                </span>
              </button>
            </div>
          </div>

          <div className={styles.resultColumn}>
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
                <Link to="/gallery" viewTransition>
                  查看图库
                  <Icon name="arrow-up-right" size={13} />
                </Link>
              </p>
            ) : null}
          </div>
        </div>

        <div className={styles.historySection}>
          <TaskRoll
            tasks={tasks}
            selectedTask={selectedTask}
            pendingSubmissions={[]}
            isSubmitting={isSubmitting}
            isRefreshing={isRefreshing}
            isReadingImages={isReadingImages}
            hasDiscovered={hasDiscovered}
            connectionError={null}
            submissionError={null}
            deletingTaskId={deletingTaskId}
            deletionError={deletionError}
            deletionNotice={deletionNotice}
            onSelectTask={selectTask}
            onDeleteTask={handleDeleteTask}
            onRefresh={refreshTasks}
            onRetrySubmission={(pending) => void retrySubmission(pending, prompt, config, referenceImages)}
          />
        </div>

        <aside className={styles.storageNote} aria-label="存储说明">
          <Icon name="shield" size={16} />
          <div>
            <strong>任务与新作品由后端持久保存</strong>
            <span>后端确认接收后可安全关闭或刷新页面；参数在账号内同步，提示词仅按账号保存在当前浏览器；旧图库不展示、不认领。</span>
          </div>
        </aside>

        <footer className={styles.footer}>
          <span className={styles.footerBrand}>nanobanana <span aria-hidden="true">·</span> 给想象一个形状</span>
          <span className={styles.cacheItem}>
            <Icon name="folder" size={13} />
            本机提示词 <span className={`${styles.cacheValue} tnum`}>{formatBytes(cacheSummary.localBytes)}</span>
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

function loadPromptFromStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function savePromptToStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Ignore storage failures so prompt editing remains non-blocking.
  }
}

export default App
