import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AppError, GenerateImageRequest, GenerateImageResult, GenerationTask, ServerGalleryImage, TaskDeletionSummary } from '../src/types/generation.ts'
import { createAppError, isAppError } from '../src/utils/errors.ts'
import { ImageStorage } from './imageStorage.ts'
import { generateImageWithProvider } from './providerService.ts'
import { lockStore } from './storeLock.ts'
import { UUID_PATTERN } from './validation.ts'
import { resolveExpectedAspectRatio } from '../src/utils/imageModels.ts'

interface StoredTask extends GenerationTask {
  request?: GenerateImageRequest
  requestHash: string
}

interface StoreState {
  version: 1
  tasks: StoredTask[]
  images: ServerGalleryImage[]
  // Keep only IDs to reject late retries without retaining deleted prompts/results.
  deletedTaskIds?: string[]
  pendingImageDeletes?: ServerGalleryImage[]
}

interface Completion {
  id: string
  result: GenerateImageResult
  images: ServerGalleryImage[]
}

type Generator = (request: GenerateImageRequest) => Promise<GenerateImageResult>

export class TaskStore {
  readonly images: ImageStorage
  private readonly statePath: string
  private readonly completionDirectory: string
  private readonly unlock: () => Promise<void>
  private readonly generate: Generator
  private state: StoreState = { version: 1, tasks: [], images: [] }
  private mutation: Promise<void> = Promise.resolve()
  private worker: Promise<void> | null = null
  private paused = false

  private constructor(dataDirectory: string, generate: Generator, unlock: () => Promise<void>) {
    this.statePath = resolve(dataDirectory, 'state.json')
    this.completionDirectory = resolve(dataDirectory, 'completed')
    this.images = new ImageStorage(dataDirectory)
    this.generate = generate
    this.unlock = unlock
  }

  static async open(dataDirectory: string, generate: Generator = generateImageWithProvider): Promise<TaskStore> {
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
    const unlock = await lockStore(dataDirectory)
    const store = new TaskStore(dataDirectory, generate, unlock)
    try {
      await store.images.initialize()
      await mkdir(store.completionDirectory, { recursive: true, mode: 0o700 })
      try {
        const state: StoreState = JSON.parse(await readFile(store.statePath, 'utf8'))
        if (state.version !== 1 || !Array.isArray(state.tasks) || !Array.isArray(state.images) ||
          (state.deletedTaskIds !== undefined && (!Array.isArray(state.deletedTaskIds) || state.deletedTaskIds.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id)))) ||
          (state.pendingImageDeletes !== undefined && !Array.isArray(state.pendingImageDeletes))) {
          throw new Error('Unsupported task store format. Restore the data directory from backup.')
        }
        store.state = state
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const completions: Completion[] = []
      for (const task of store.state.tasks) {
        if (!UUID_PATTERN.test(task.id)) throw new Error('Invalid task ID in persistent state.')
        if (task.status !== 'queued' && task.status !== 'running') continue
        try {
          const completion: Completion = JSON.parse(await readFile(store.completionPath(task.id), 'utf8'))
          if (completion.id !== task.id || !Array.isArray(completion.images) || !Array.isArray(completion.result?.images)) {
            throw new Error('Invalid completion receipt. Preserve the data directory for recovery.')
          }
          completions.push(completion)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      // Restore already-downloaded results without ever repeating the supplier request.
      // A synchronous provider call without a receipt cannot safely resume after a crash.
      await store.change((state) => {
        for (const completion of completions) applyCompletion(state, completion)
        for (const task of state.tasks) {
          if (task.status === 'running' || (task.status === 'queued' && !task.request)) {
            task.status = 'failed'
            task.updatedAt = new Date().toISOString()
            task.error = createAppError('UNKNOWN', '后端重启中断了任务，供应商可能已扣费。请确认后手动重新提交。', false)
            delete task.request
          }
        }
      })
      for (const completion of completions) await store.removeReceipt(completion.id)
      await store.cleanDeletedImages()
      store.kick()
      return store
    } catch (error) {
      await unlock()
      throw error
    }
  }

  listTasks(): GenerationTask[] {
    return this.state.tasks.map(publicTask).reverse()
  }

  getTask(id: string): GenerationTask | undefined {
    const task = this.state.tasks.find((entry) => entry.id === id)
    return task ? publicTask(task) : undefined
  }

  isTaskDeleted(id: string): boolean {
    return this.state.deletedTaskIds?.includes(id) ?? false
  }

  listImages(): ServerGalleryImage[] {
    return structuredClone(this.state.images).reverse()
  }

  getImage(url: string): ServerGalleryImage | undefined {
    return this.state.images.find((image) => image.url === url)
  }

  async create(id: string, request: GenerateImageRequest): Promise<GenerationTask> {
    const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    await this.change((state) => {
      if (this.paused) throw createAppError('UNKNOWN', '后端停止接收任务，请检查服务状态并重启。', false, 503)
      if (state.deletedTaskIds?.includes(id)) {
        throw createAppError('VALIDATION', '此任务已删除，不能重放原请求；如需重新生成，请创建新任务。', false, 410)
      }
      const existing = state.tasks.find((entry) => entry.id === id)
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw createAppError('VALIDATION', '任务 ID 已用于不同请求，请勿覆盖原任务。', false, 409)
        }
        return
      }
      if (state.tasks.filter((task) => task.status === 'queued' || task.status === 'running').length >= 100) {
        throw createAppError('RATE_LIMIT', '等待中的任务过多，请稍后再提交。', true, 429)
      }
      const profile = request.config.profiles[request.config.activeProvider]
      const now = new Date().toISOString()
      state.tasks.push({
        id,
        status: 'queued',
        provider: request.config.activeProvider,
        model: profile.model,
        prompt: request.prompt,
        expectedImageCount: request.config.activeProvider === 'openai-compatible' ? request.config.profiles['openai-compatible'].params.n : 1,
        expectedAspectRatio: resolveExpectedAspectRatio(request.config),
        requestedSize: request.config.activeProvider === 'openai-compatible' ? request.config.profiles['openai-compatible'].params.size : undefined,
        referenceImageCount: request.referenceImages?.length ?? 0,
        createdAt: now,
        updatedAt: now,
        request: structuredClone(request),
        requestHash,
      })
    })
    const task = this.getTask(id)!
    this.kick()
    return task
  }

  async deleteTask(id: string): Promise<TaskDeletionSummary> {
    return this.deleteTaskGroups([id], [])
  }

  async deleteImages(ids: string[]): Promise<number> {
    return (await this.deleteTaskGroups([], ids)).deletedImageCount
  }

  private async deleteTaskGroups(taskIds: string[], imageIds: string[]): Promise<TaskDeletionSummary> {
    const selectedTasks = new Set(taskIds)
    const selectedImages = new Set(imageIds)
    let removed: ServerGalleryImage[] = []
    let removedTaskIds: string[] = []
    await this.change((state) => {
      if (this.paused) throw createAppError('UNKNOWN', '后端停止接收修改，请检查服务状态。', false, 503)
      const selectedUrls = new Set(state.images.filter((image) => selectedImages.has(image.id)).map((image) => image.url))
      // Match existing records by result URL, with task-prefixed filenames as a fallback
      // for legacy records whose result references were previously removed individually.
      for (const image of state.images) {
        if (selectedImages.has(image.id)) {
          const owner = image.url.match(/^\/api\/images\/([0-9a-f-]{36})_/i)?.[1]
          if (owner && UUID_PATTERN.test(owner)) selectedTasks.add(owner)
        }
      }
      for (const task of state.tasks) {
        if (task.result?.images.some((image) => image.url && selectedUrls.has(image.url))) selectedTasks.add(task.id)
      }
      const targets = state.tasks.filter((task) => selectedTasks.has(task.id))
      if (targets.some((task) => task.status === 'queued' || task.status === 'running')) {
        throw createAppError('VALIDATION', '排队中或生成中的任务不能删除；请等待结束，删除记录不会取消供应商执行或计费。', false, 409)
      }
      const relatedUrls = new Set(targets.flatMap((task) => task.result?.images.flatMap((image) => image.url ? [image.url] : []) ?? []))
      removed = state.images.filter((image) => selectedImages.has(image.id) || relatedUrls.has(image.url) ||
        selectedTasks.has(image.url.match(/^\/api\/images\/([0-9a-f-]{36})_/i)?.[1] ?? ''))
      removedTaskIds = targets.map((task) => task.id)
      const removedImages = new Set(removed.map((image) => image.id))
      state.images = state.images.filter((image) => !removedImages.has(image.id))
      state.tasks = state.tasks.filter((task) => !selectedTasks.has(task.id))
      state.deletedTaskIds = [...new Set([...(state.deletedTaskIds ?? []), ...removedTaskIds])]
      state.pendingImageDeletes = [...(state.pendingImageDeletes ?? []), ...removed]
    })
    // Commit the entire group's metadata before unlinking. A durable cleanup list
    // makes retries/restart finish file deletion even after an interruption or disk error.
    for (const id of removedTaskIds) await this.removeReceipt(id)
    try {
      await this.cleanDeletedImages()
    } catch {
      throw createAppError('UNKNOWN', '任务与图片记录已删除，但磁盘文件清理失败。请检查存储权限后重试删除或重启后端以完成清理。', true, 500)
    }
    return { deletedTaskCount: removedTaskIds.length, deletedImageCount: removed.length }
  }

  private async cleanDeletedImages(): Promise<void> {
    const pending = this.state.pendingImageDeletes ?? []
    if (!pending.length) return
    await this.images.remove(pending)
    const cleaned = new Set(pending.map((image) => image.id))
    await this.change((state) => {
      state.pendingImageDeletes = (state.pendingImageDeletes ?? []).filter((image) => !cleaned.has(image.id))
    })
  }

  async waitForIdle(): Promise<void> {
    while (this.worker) await this.worker
    await this.mutation
  }

  // Graceful shutdown stops accepting work; already running work is allowed to finish.
  async stop(): Promise<void> {
    this.paused = true
    await this.waitForIdle()
    await this.unlock()
  }

  private completionPath(id: string): string {
    if (!UUID_PATTERN.test(id)) throw new Error('Invalid task ID for completion receipt.')
    return resolve(this.completionDirectory, `${id}.json`)
  }

  private async removeReceipt(id: string): Promise<void> {
    // completionPath validates the UUID and resolves the exact file before deletion.
    await unlink(this.completionPath(id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') console.error('Unable to clean up a committed completion receipt.')
    })
  }

  private async change(action: (state: StoreState) => void): Promise<void> {
    const operation = this.mutation.then(async () => {
      const next = structuredClone(this.state)
      action(next)
      const temporary = `${this.statePath}.tmp`
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
      await rename(temporary, this.statePath)
      this.state = next
    })
    this.mutation = operation.catch(() => {})
    await operation
  }

  private kick(): void {
    if (this.worker || this.paused) return
    this.worker = this.drain().catch(() => {
      this.paused = true
      // Never print supplier payloads or persisted credentials in logs.
      console.error('Task persistence failed. Check disk space/permissions and restart the backend.')
    }).finally(() => {
      this.worker = null
      if (!this.paused && this.state.tasks.some((task) => task.status === 'queued')) this.kick()
    })
  }

  private async drain(): Promise<void> {
    while (!this.paused) {
      const queued = this.state.tasks.find((task) => task.status === 'queued')
      if (!queued?.request) return
      const id = queued.id
      const request = queued.request
      await this.change((state) => {
        const task = state.tasks.find((entry) => entry.id === id)!
        task.status = 'running'
        task.updatedAt = new Date().toISOString()
      })
      let completion: Completion
      try {
        const generated = await this.generate(request)
        const saved = await this.images.save(generated, request.prompt, id)
        completion = {
          id,
          result: {
            provider: queued.provider,
            model: queued.model,
            createdAt: generated.createdAt,
            text: generated.text ? redact(generated.text, request) : undefined,
            images: saved.map((image) => ({ mimeType: image.mimeType, url: image.url })),
          },
          images: saved,
        }
      } catch (error) {
        const normalized: AppError = isAppError(error)
          ? { ...error, message: redact(error.message, request), details: error.details ? redact(error.details, request) : undefined }
          : createAppError('UNKNOWN', '生成或保存图片失败，请检查供应商与后端存储后手动重试。', true)
        await this.change((state) => {
          const task = state.tasks.find((entry) => entry.id === id)!
          task.status = 'failed'
          task.updatedAt = new Date().toISOString()
          task.error = normalized
          delete task.request
        })
        continue
      }
      // Local metadata failures must never destroy a paid, downloaded result or
      // retry the upstream. A small receipt lets startup replay only this commit.
      // If even the receipt cannot be saved, task-prefixed image files remain for recovery.
      const receipt = this.completionPath(id)
      await writeFile(`${receipt}.tmp`, JSON.stringify(completion), { mode: 0o600 })
      await rename(`${receipt}.tmp`, receipt)
      await this.change((state) => applyCompletion(state, completion))
      await this.removeReceipt(id)
    }
  }
}

function applyCompletion(state: StoreState, completion: Completion): void {
  const task = state.tasks.find((entry) => entry.id === completion.id)!
  task.status = 'succeeded'
  task.updatedAt = new Date().toISOString()
  task.result = completion.result
  delete task.request
  delete task.error
  const existing = new Set(state.images.map((image) => image.id))
  state.images.push(...completion.images.filter((image) => !existing.has(image.id)))
}

function publicTask(task: StoredTask): GenerationTask {
  // Explicit projection prevents queued credentials/hash from leaking through any API response.
  return structuredClone({
    id: task.id, status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt,
    provider: task.provider, model: task.model, prompt: task.prompt,
    expectedImageCount: task.expectedImageCount, expectedAspectRatio: task.expectedAspectRatio,
    requestedSize: task.requestedSize,
    referenceImageCount: task.referenceImageCount ?? 0,
    result: task.result, error: task.error,
  })
}

function redact(value: string, request: GenerateImageRequest): string {
  const key = request.config.profiles[request.config.activeProvider].apiKey
  let sanitized = value
  if (key) {
    sanitized = sanitized.split(key).join('[REDACTED]').split(encodeURIComponent(key)).join('[REDACTED]')
  }
  return sanitized.replace(/([?&](?:key|api_key)=)[^&\s"']+/gi, '$1[REDACTED]')
}
