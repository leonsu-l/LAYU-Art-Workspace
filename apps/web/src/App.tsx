import { useEffect, useMemo, useState } from 'react'
import { ConnectionSettingsPanel, GenerationParamsPanel } from './components/ConfigPanel'
import { Icon } from './components/Icon'
import { ChannelModelBar, M3SplitGenerateButton } from './studio/Controls'
import { RippleButton } from './studio/Ripple'
import { SkeletonBlock } from './studio/Skeleton'
import { useNotify } from './studio/useNotify'
import type { Template } from '@nanobanana/shared/types/studio'
import work from './studio/Workbench.module.css'
import { userStorageKey } from './services/sessionScope'
import { PromptPanel } from './components/PromptPanel'
import { ResultPanel } from './components/ResultPanel'
import { TaskRoll } from './components/TaskRoll'
import { useBeforeUnloadGuard } from './hooks/useBeforeUnloadGuard'
import { useImageGeneration } from './hooks/useImageGeneration'
import { usePersistentConfig } from './hooks/usePersistentConfig'
import { getGalleryStorageSummary, type GalleryStorageSummary } from './services/galleryService'
import { buildRequestPreview } from './services/imageGenerationService'
import { formatBytes } from './utils/galleryDb'
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
    ready, hasCachedSelection, selectionLoaded, channels, channel, catalog, templates, quota, error: configError, saveStatus, selectChannel,
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
    selectionLoaded && canSubmit &&
    isHydrated && ready && (channel?.scope !== 'shared' || Boolean(quota?.configured && (quota.unlimited || (quota.remaining ?? 0) > 0))) &&
    !isSubmitting &&
    !isReadingImages &&
    !referenceImageError &&
    promptLength > 0 &&
    promptLength <= 4000

  const notify = useNotify()

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

  function handleGenerate() {
    if (canGenerate) {
      void generateImage(prompt, config, referenceImages)
    }
  }

  function handleUseIdea(idea: string) {
    setPrompt(idea)
    document.getElementById('image-prompt')?.focus()
  }

  function handleDeleteTask(task: GenerationTask) {
    if (deletingTaskId || isSubmitting || task.status === 'queued' || task.status === 'running') return
    const count = task.result?.images.length ?? 0
    if (window.confirm(`确认删除这条任务历史${count ? `及关联的 ${count} 张图片` : ''}吗？\n该任务在图库和磁盘中的全部生成图片会一并删除，此操作无法撤销。`)) {
      void deleteTask(task.id)
    }
  }

  function applyTemplate(template: Template) {
    if (!isHydrated || template.provider !== activeProvider) return
    if (activeProvider === 'openai-compatible') updateOpenAIParams(template.params)
    else updateGeminiParams(template.params)
    notify({ tone: 'success', message: `已套用「${template.name}」，渠道与模型保持不变。` })
  }
  const availableTemplates = isHydrated && !isSubmitting ? templates.filter((i) => i.provider === activeProvider) : []
  const initialLoad = !hasCachedSelection && !selectionLoaded && !channels.length && !configError
  const blocker = !ready ? '请先选择可用渠道和模型' : !isHydrated ? '正在加载最近参数…'
    : channel?.scope === 'shared' && !quota?.configured ? '共享额度尚未配置或加载' : channel?.scope === 'shared' && !quota?.unlimited && !quota?.remaining ? '今日共享额度已用完'
    : isReadingImages ? '正在读取参考图…' : referenceImageError ? '请先调整参考图' : pendingSubmissions.length ? '存在待确认提交，请先恢复'
    : connectionError ? '连接中断，请重连' : !hasDiscovered ? '正在恢复后端任务…' : isSubmitting ? '等待后端确认接收' : deletingTaskId ? '正在删除任务…'
    : !promptLength ? '输入画面描述后即可生成' : promptLength > 4000 ? '提示词超出 4,000 字上限' : ''
  const selectionHint = config.channelId && !channel ? '原渠道已不可用，请重新选择。'
    : channel && !channel.enabled ? '所选渠道已停用，请重新选择。'
    : channel?.scope === 'shared' && activeProfile.model && !channel.enabledModels.includes(activeProfile.model) ? '原模型已停用，请选择管理员启用的模型。'
    : '请在上方选择已启用的渠道与模型。'
  const count = activeProvider === 'openai-compatible' ? config.profiles[activeProvider].params.n : 1

  return <main id="main" aria-label="创作工作台">
    <div className={work.proLayout}>
      <aside className={work.proRail} aria-label="创作设置">
        <div className={work.proRailScroll}>
          {initialLoad ? <div className={work.paramStack}><SkeletonBlock variant="text" width="35%" /><SkeletonBlock variant="field" /><SkeletonBlock variant="field" /></div> : <ChannelModelBar explicitSelection channels={channels} channelId={config.channelId ?? ''}
            provider={activeProvider} model={activeProfile.model} catalog={catalog} catalogLoading={Boolean(channel && !catalog && !configError)}
            templates={availableTemplates} quota={quota} onChannelChange={selectChannel} onProviderChange={setActiveProvider}
            onModelChange={(model) => updateProviderProfile(activeProvider, { model })} onApplyTemplate={applyTemplate} />}
          {configError && <p role="alert" className={work.recoveryAlert}>{configError}</p>}
          {!initialLoad && !ready && <p className={work.blockerAlert}><Icon name="settings" size={16} />{selectionHint}</p>}
          {catalog?.error && <p className={work.blockerAlert}>目录刷新失败，保留上次目录：{catalog.error}</p>}
          {catalog?.stale && <p className={work.fieldMeta}>目录缓存已过期，可由渠道管理者刷新。</p>}
          {connectionError && <div className={work.recoveryAlert} role="alert"><p>{connectionError} · 正在重连</p><RippleButton className={work.recoveryBtnTonal} disabled={isRefreshing} onClick={refreshTasks}>刷新状态</RippleButton></div>}
          {submissionError && <p className={work.recoveryAlert} role="alert">提交提示：{submissionError.message}</p>}
          {pendingSubmissions.length > 0 && <div className={work.recoveryAlert} role="alert"><strong>有待确认的提交</strong><p>保留原提示词和参数，按原顺序重新选择参考图；恢复只会使用原请求 ID。</p>
            {pendingSubmissions.map((i) => <div className={work.recoveryActions} key={i.id}><code>{i.id}</code><RippleButton className={work.recoveryBtnPrimary} disabled={isSubmitting || isReadingImages || Boolean(deletingTaskId)} onClick={() => void retrySubmission(i, prompt, config, referenceImages)}>恢复 / 重试同一请求</RippleButton></div>)}
          </div>}
          <PromptPanel prompt={prompt} isSubmitting={isSubmitting} canGenerate={canGenerate} onPromptChange={setPrompt} onGenerate={handleGenerate}
            referenceImages={referenceImages} referenceLimits={referenceLimits} referenceImageError={referenceImageError} onReferenceImagesChange={setReferenceImages} onReadingImagesChange={setIsReadingImages} />
          <GenerationParamsPanel config={config} activeProvider={activeProvider} isHydrated={!initialLoad} busy={!isHydrated} hasReferenceImages={referenceImages.length > 0}
            onOpenAIParamsChange={updateOpenAIParams} onGeminiParamsChange={updateGeminiParams} />
          {saveStatus && <span className={work.fieldMeta} role="status">{saveStatus}</span>}
        </div>
        <footer className={work.proRailFooter}><div className={work.readinessLine}><span className={blocker ? work.readinessErr : work.readinessOk}>{blocker || (channel?.scope === 'shared' ? '就绪 · 将消耗 1 次共享额度' : '就绪 · 使用私有渠道')}</span><span className={work.shortcutHint}>Ctrl / ⌘ ↵</span></div>
          <M3SplitGenerateButton label={isSubmitting ? '正在提交…' : `生成图像 (${count})`} busy={isSubmitting} disabled={!canGenerate} templates={availableTemplates} onGenerate={handleGenerate} onApplyTemplate={applyTemplate} />
        </footer>
      </aside>
      <section className={work.proStage} aria-label="结果画布"><div className={work.stageCard}>
        <ResultPanel loading={!hasDiscovered && !connectionError} isGenerating={isGenerating} isSubmitting={isSubmitting} taskStatus={selectedTask?.status} model={(isSubmitting ? activeProfile.model : selectedTask?.model) || activeProfile.model}
          result={result} error={error} expectedImageCount={expectedImageCount} expectedAspectRatio={expectedAspectRatio} requestedSize={isSubmitting ? undefined : selectedTask?.requestedSize}
          onUseIdea={handleUseIdea} onClearResult={() => { clearResult(); notify({message: '已清空画布，可从任务胶卷重新查看。'}) }} />
        <TaskRoll tasks={tasks} selectedTask={selectedTask} loading={!hasDiscovered && !connectionError} isSubmitting={isSubmitting} isRefreshing={isRefreshing} deletingTaskId={deletingTaskId}
          deletionError={deletionError} deletionNotice={deletionNotice} onSelectTask={selectTask} onDeleteTask={handleDeleteTask} onRefresh={refreshTasks} />
      </div></section>
    </div>
    <footer className={styles.footer}><ConnectionSettingsPanel requestPreview={requestPreview} />
      <span>本机提示词 {formatBytes(cacheSummary.localBytes)} · 云端图库 {cacheSummary.gallery?.server ? `${formatBytes(cacheSummary.gallery.server.totalBytes)} / ${cacheSummary.gallery.server.imageCount} 张` : '暂不可用'} · {providerNameMap[activeProvider]}</span>
    </footer>
  </main>
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
