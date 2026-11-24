import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppError, GenerationTask, ProviderConfig, ReferenceImage } from '@nanobanana/shared/types/generation'
import { getReferenceImageLimits, parseReferenceImages } from '../utils/referenceImages'
import {
  acknowledgeSubmission,
  deleteGenerationTask,
  getGenerationTask,
  isDefiniteSubmissionRejection,
  isDeletedTaskError,
  listGenerationTasks,
  PENDING_TASK_PREFIX,
  prepareSubmission,
  readPendingSubmissions,
  submitPendingRequest,
  withSubmissionLock,
  type PendingSubmission,
} from '../services/imageGenerationService'
import { getStudioCache, getSessionEpoch, getSessionUserId } from '../services/sessionScope'
import { backendErrorMessage, BackendRequestError } from '../services/backendClient'
import { createAppError, isAppError } from '@nanobanana/shared/utils/errors'
import { validatePrompt, validateProviderConfig } from '@nanobanana/shared/utils/validation'
import { resolveExpectedAspectRatio } from '@nanobanana/shared/utils/imageModels'
import { isActiveTask, mergeTasks, reconcileTaskHistory } from '../utils/taskHistory'

export function useImageGeneration() {
  const [cache] = useState(getStudioCache)
  const [tasks, setTasks] = useState<GenerationTask[]>(() => cache.get<GenerationTask[]>('tasks') ?? [])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null | undefined>(() => cache.get<string | null>('selectedTaskId'))
  const [pendingSubmissions, setPendingSubmissions] = useState<PendingSubmission[]>([])
  const [hasDiscovered, setHasDiscovered] = useState(() => cache.get<boolean>('hasDiscovered') ?? false)
  const [confirmed, setConfirmed] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [submissionError, setSubmissionError] = useState<AppError | null>(null)
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null)
  const [deletionError, setDeletionError] = useState<string | null>(null)
  const [deletionNotice, setDeletionNotice] = useState<string | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [submissionShape, setSubmissionShape] = useState({ count: 1, ratio: '1:1' })
  const ownerRef = useRef(getSessionUserId())
  const submittingRef = useRef(false)
  const mountedRef = useRef(false)
  const deletingRef = useRef(false)
  const taskMutationVersion = useRef(0)
  const deletedTaskIds = useRef(new Set<string>())

  useEffect(() => {
    cache.set('tasks', tasks)
    cache.set('selectedTaskId', selectedTaskId)
    cache.set('hasDiscovered', hasDiscovered)
  }, [cache, tasks, selectedTaskId, hasDiscovered])

  const refreshTasks = useCallback(() => setRefreshVersion((version) => version + 1), [])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timerId: number | undefined
    let failures = 0

    async function poll() {
      if (ownerRef.current !== getSessionUserId()) return
      setIsRefreshing(true)
      let nextDelay = 10_000
      try {
        const pending = readPendingSubmissions()
        setPendingSubmissions(pending)
        const version = taskMutationVersion.current
        const loaded = await listGenerationTasks(controller.signal)
        if (controller.signal.aborted) return
        // A list may have raced the POST. Reconcile each unknown id individually;
        // a 404 is NOT evidence that an in-flight POST will never arrive.
        const recovered = await Promise.all(pending.map(async (item) => {
          try {
            return loaded.find((task) => task.id === item.id) ?? await getGenerationTask(item.id, controller.signal)
          } catch (error) {
            if (!isDeletedTaskError(error)) throw error
            // A durable 410 proves this accepted task was deleted, not an unknown POST.
            deletedTaskIds.current.add(item.id)
            acknowledgeSubmission(item.id)
            return null
          }
        }))
        if (controller.signal.aborted) return
        const discovered = mergeTasks(loaded, recovered.filter((task): task is GenerationTask => task !== null))
          .filter((task) => !deletedTaskIds.current.has(task.id))
        setTasks((previous) => reconcileTaskHistory(previous, discovered, version !== taskMutationVersion.current, deletedTaskIds.current))
        setSelectedTaskId((current) => current === undefined ? discovered[0]?.id ?? null : current)
        setHasDiscovered(true)
        setConfirmed(true)
        for (const item of pending) {
          if (discovered.some((task) => task.id === item.id)) acknowledgeSubmission(item.id)
        }
        const remaining = readPendingSubmissions()
        setPendingSubmissions(remaining)
        setConnectionError(null)
        failures = 0
        if (remaining.length || discovered.some(isActiveTask)) nextDelay = 3_000
      } catch (error) {
        if (controller.signal.aborted) return
        // Connectivity/discovery failures never mutate a backend task's status.
        setConnectionError(backendErrorMessage(error))
        failures += 1
        nextDelay = Math.min(30_000, 3_000 * 2 ** Math.min(failures - 1, 4))
      } finally {
        if (!controller.signal.aborted) {
          setIsRefreshing(false)
          timerId = window.setTimeout(() => void poll(), nextDelay)
        }
      }
    }

    void poll()
    return () => {
      controller.abort() // Stops observation only; no backend cancellation endpoint is called.
      window.clearTimeout(timerId)
    }
  }, [refreshVersion])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(PENDING_TASK_PREFIX)) refreshTasks()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('online', refreshTasks)
    window.addEventListener('focus', refreshTasks)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('online', refreshTasks)
      window.removeEventListener('focus', refreshTasks)
    }
  }, [refreshTasks])

  const submit = useCallback(async (prompt: string, config: ProviderConfig, referenceImages: ReferenceImage[], retry?: PendingSubmission) => {
    if (ownerRef.current !== getSessionUserId() || submittingRef.current || deletingRef.current || (!retry && (!confirmed || connectionError))) return
    const epoch = getSessionEpoch()
    if (!retry) {
      const validation = [validatePrompt(prompt), validateProviderConfig(config)].find((item) => !item.valid)
      if (validation) {
        setSubmissionError(validation.error ?? createAppError('VALIDATION', '请检查提示词与配置。', false))
        return
      }
    }

    submittingRef.current = true
    setIsSubmitting(true)
    setSubmissionError(null)
    setSubmissionShape({ count: resolveExpectedImageCount(config), ratio: resolveExpectedAspectRatio(config) })
    let pending: PendingSubmission | undefined = retry
    let postStarted = false
    try {
      const limits = getReferenceImageLimits(config.activeProvider, config.profiles[config.activeProvider].model)
      const request = { prompt, config, referenceImages: retry ? referenceImages : parseReferenceImages(referenceImages, limits) }
      const task = await withSubmissionLock(async () => {
        if (retry) {
          const existing = await getGenerationTask(retry.id)
          if (existing) return existing
        }
        pending = retry ?? await prepareSubmission(request)
        if (mountedRef.current) setPendingSubmissions(readPendingSubmissions())
        postStarted = true
        return submitPendingRequest(pending, request)
      })
      if (epoch !== getSessionEpoch()) return
      taskMutationVersion.current += 1
      if (mountedRef.current && !deletedTaskIds.current.has(task.id)) {
        setTasks((previous) => mergeTasks(previous, [task]).filter((entry) => !deletedTaskIds.current.has(entry.id)))
        setSelectedTaskId(task.id)
        setConnectionError(null)
      }
      // Clear only this id; another tab may have a different unresolved request.
      acknowledgeSubmission(task.id)
    } catch (error) {
      if (epoch !== getSessionEpoch()) return
      if (pending && (postStarted || isDeletedTaskError(error)) && isDefiniteSubmissionRejection(error)) {
        try { acknowledgeSubmission(pending.id) } catch { /* Keep recovery blocked if storage cannot be updated. */ }
      }
      if (mountedRef.current) {
        if (error instanceof BackendRequestError && !isDefiniteSubmissionRejection(error)) {
          setConnectionError(`${backendErrorMessage(error)} 提交结果未知时不会创建新 ID；请恢复连接或重试原请求。`)
        } else {
          setSubmissionError(error instanceof BackendRequestError ? error.appError : isAppError(error)
            ? error : createAppError('UNKNOWN', backendErrorMessage(error), false))
        }
      }
    } finally {
      submittingRef.current = false
      if (mountedRef.current && epoch === getSessionEpoch()) {
        setIsSubmitting(false)
        try { setPendingSubmissions(readPendingSubmissions()) } catch (error) {
          setConnectionError(`无法读取提交恢复记录：${backendErrorMessage(error)}`)
        }
        refreshTasks()
      }
    }
  }, [connectionError, confirmed, refreshTasks])

  const deleteTask = useCallback(async (id: string) => {
    if (deletingRef.current || submittingRef.current) return
    deletingRef.current = true
    setDeletingTaskId(id)
    setDeletionError(null)
    setDeletionNotice(null)
    try {
      const summary = await deleteGenerationTask(id)
      deletedTaskIds.current.add(id)
      taskMutationVersion.current += 1
      if (mountedRef.current) {
        setTasks((previous) => previous.filter((task) => task.id !== id))
        setSelectedTaskId((current) => current === id ? null : current)
        setDeletionNotice(`任务历史及关联图片已删除（${summary.deletedImageCount} 张）。`)
      }
      acknowledgeSubmission(id)
    } catch (error) {
      if (mountedRef.current) setDeletionError(`${backendErrorMessage(error)} 将刷新任务列表确认结果。`)
    } finally {
      deletingRef.current = false
      if (mountedRef.current) {
        setDeletingTaskId(null)
        refreshTasks()
      }
    }
  }, [refreshTasks])

  const generateImage = useCallback((prompt: string, config: ProviderConfig, referenceImages: ReferenceImage[] = []) =>
    submit(prompt, config, referenceImages), [submit])
  const retrySubmission = useCallback((pending: PendingSubmission, prompt: string, config: ProviderConfig, referenceImages: ReferenceImage[] = []) =>
    submit(prompt, config, referenceImages, pending), [submit])
  const selectTask = useCallback((id: string) => {
    setSelectedTaskId(id)
    setSubmissionError(null)
  }, [])
  const clearResult = useCallback(() => {
    setSelectedTaskId(null)
    setSubmissionError(null)
  }, [])

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null
  return {
    tasks,
    selectedTask,
    pendingSubmissions,
    hasDiscovered,
    isRefreshing,
    isSubmitting,
    connectionError,
    submissionError,
    deletingTaskId,
    deletionError,
    deletionNotice,
    deleteTask,
    canSubmit: confirmed && !connectionError && !isSubmitting && !deletingTaskId && pendingSubmissions.length === 0,
    isGenerating: isSubmitting || Boolean(selectedTask && isActiveTask(selectedTask)),
    result: isSubmitting ? null : selectedTask?.result ?? null,
    error: isSubmitting ? null : selectedTask?.error ?? null,
    expectedImageCount: isSubmitting ? submissionShape.count : selectedTask?.expectedImageCount ?? 1,
    expectedAspectRatio: isSubmitting ? submissionShape.ratio : selectedTask?.expectedAspectRatio ?? '1:1',
    generateImage,
    retrySubmission,
    refreshTasks,
    selectTask,
    clearResult,
  }
}

function resolveExpectedImageCount(config: ProviderConfig): number {
  if (config.activeProvider !== 'openai-compatible') return 1
  const rawCount = Number(config.profiles['openai-compatible'].params.n)
  return Number.isFinite(rawCount) ? Math.max(1, Math.min(10, Math.round(rawCount))) : 1
}
