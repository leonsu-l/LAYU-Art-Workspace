import type { GenerateImageRequest, GenerationTask, TaskDeletionSummary } from '../types/generation.ts'
import { createDefaultProviderConfig } from '../utils/configDefaults.ts'
import { createAppError } from '../utils/errors.ts'
import { backendRequest, BackendRequestError } from './backendClient.ts'

export { buildRequestPreview } from './requestPreview.ts'

export const PENDING_TASK_PREFIX = 'nanobanana.pending-task.'
const SUBMISSION_LOCK = 'nanobanana.task-submission'
const requestBodies = new Map<string, string>()

export interface PendingSubmission {
  id: string
  createdAt: string
  requestHash: string
}

export async function listGenerationTasks(signal?: AbortSignal): Promise<GenerationTask[]> {
  const response = await backendRequest<{ tasks: GenerationTask[] }>('/tasks', { signal })
  if (!Array.isArray(response.tasks)) throw invalidResponse()
  return response.tasks
}

export async function getGenerationTask(id: string, signal?: AbortSignal): Promise<GenerationTask | null> {
  try {
    const response = await backendRequest<{ task: GenerationTask }>(`/tasks/${encodeURIComponent(id)}`, { signal })
    if (!response.task || response.task.id !== id) throw invalidResponse()
    return response.task
  } catch (error) {
    if (error instanceof BackendRequestError && error.isApiError && error.appError.status === 404) return null
    throw error
  }
}

export async function deleteGenerationTask(id: string): Promise<TaskDeletionSummary> {
  return backendRequest<TaskDeletionSummary>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function isDeletedTaskError(error: unknown): boolean {
  return error instanceof BackendRequestError && error.isApiError && error.appError.status === 410
}

/** Separate records prevent tabs from overwriting each other's unresolved submissions. No API keys are stored here. */
export function readPendingSubmissions(): PendingSubmission[] {
  const pending: PendingSubmission[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(PENDING_TASK_PREFIX)) continue
    const raw = localStorage.getItem(key)
    if (raw === null) continue // Another tab may have reconciled it.
    const value = JSON.parse(raw) as PendingSubmission
    if (!value || typeof value.id !== 'string' || key !== `${PENDING_TASK_PREFIX}${value.id}` ||
      typeof value.createdAt !== 'string' || typeof value.requestHash !== 'string') {
      throw new Error('未确认提交记录已损坏，已暂停新提交以避免重复扣费。')
    }
    pending.push(value)
  }
  return pending.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function withSubmissionLock<T>(action: () => Promise<T>): Promise<T> {
  // Fail closed rather than use a non-atomic localStorage "lock" that races across tabs.
  if (!navigator.locks || !crypto.subtle || !crypto.randomUUID) {
    throw createAppError('UNSUPPORTED', '安全提交需要支持 Web Locks 的浏览器及 HTTPS / localhost 环境。', false)
  }
  return navigator.locks.request(SUBMISSION_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) throw createAppError('VALIDATION', '另一个标签页正在提交或重试，请稍后刷新任务。', true)
    return action()
  })
}

export async function prepareSubmission(request: GenerateImageRequest): Promise<PendingSubmission> {
  if (readPendingSubmissions().length > 0) {
    throw createAppError('VALIDATION', '仍有提交结果未确认，请先恢复或重试原请求，避免重复扣费。', false)
  }
  const id = crypto.randomUUID()
  // Freeze the exact serialized body: editing the form must not change an idempotent retry.
  const body = serializeRequest(id, request)
  const pending = { id, createdAt: new Date().toISOString(), requestHash: await hashBody(body) }
  localStorage.setItem(`${PENDING_TASK_PREFIX}${id}`, JSON.stringify(pending))
  requestBodies.set(id, body)
  return pending
}

export async function submitPendingRequest(pending: PendingSubmission, currentRequest: GenerateImageRequest): Promise<GenerationTask> {
  let body = requestBodies.get(pending.id)
  if (!body) {
    body = serializeRequest(pending.id, currentRequest)
    if (await hashBody(body) !== pending.requestHash) {
      throw createAppError('VALIDATION', '原请求内容已不在内存中。请恢复提交时的提示词、配置、API Key，并按原顺序重新选择相同参考图后重试同一 ID；不会自动创建新任务。', false)
    }
    requestBodies.set(pending.id, body)
  }
  const response = await backendRequest<{ task: GenerationTask }>('/tasks', { method: 'POST', body })
  if (!response.task || response.task.id !== pending.id) throw invalidResponse()
  return response.task
}

export function acknowledgeSubmission(id: string): void {
  localStorage.removeItem(`${PENDING_TASK_PREFIX}${id}`)
  requestBodies.delete(id)
}

/** Only an explicit rejection from the API proves that this POST was not accepted. */
export function isDefiniteSubmissionRejection(error: unknown): boolean {
  return error instanceof BackendRequestError && error.isApiError &&
    [400, 401, 403, 410, 413, 415, 422].includes(error.appError.status ?? 0)
}

function serializeRequest(id: string, request: GenerateImageRequest): string {
  // Match existing config-storage trimming/count normalization and stabilize key
  // order, so a reload alone does not invalidate an otherwise identical retry.
  const config = createDefaultProviderConfig()
  const active = request.config.activeProvider
  config.activeProvider = active
  if (active === 'openai-compatible') config.profiles[active] = request.config.profiles[active]
  else config.profiles[active] = request.config.profiles[active]
  // Only the active profile needs to leave the browser or participate in retry identity.
  return JSON.stringify({ id, prompt: request.prompt, config,
    ...(request.referenceImages?.length ? { referenceImages: request.referenceImages } : {}),
  }, (key, value: unknown) => {
    if (typeof value === 'string') return value.trim()
    if (key === 'n') {
      const count = Number(value)
      return Number.isFinite(count) ? Math.max(1, Math.min(10, Math.round(count))) : 1
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
    }
    return value
  })
}

async function hashBody(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function invalidResponse(): BackendRequestError {
  return new BackendRequestError(createAppError('BAD_RESPONSE', '后端响应缺少任务信息，正在等待确认。', true))
}
