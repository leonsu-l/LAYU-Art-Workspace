import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  acknowledgeSubmission, deleteGenerationTask, getGenerationTask, isDefiniteSubmissionRejection, isDeletedTaskError, PENDING_TASK_PREFIX,
  prepareSubmission, readPendingSubmissions, submitPendingRequest, withSubmissionLock,
} from '../src/services/imageGenerationService.ts'
import { changeSessionScope, userStorageKey } from '../src/services/sessionScope.ts'
import { clearSubmissionMemory } from '../src/services/imageGenerationService.ts'
import { taskParams } from '@nanobanana/shared/utils/generationParams'
import { validateProviderConfig } from '@nanobanana/shared/utils/validation'
import { getReferenceImageLimits } from '@nanobanana/shared/utils/referenceImages'
import { buildRequestPreview } from '../src/services/requestPreview.ts'
import { restoreChannelSelection, reconcileChannelProtocol, applyChannelSelection } from '../src/utils/channelSelection.ts'
import type { Channel } from '@nanobanana/shared/types/studio'
import { BackendRequestError, backendRequest, csrfHeaders, requestTimeoutMs } from '../src/services/backendClient.ts'
import { createDefaultProviderConfig } from '@nanobanana/shared/utils/configDefaults'
import { createAppError } from '@nanobanana/shared/utils/errors'
import type { GenerationTask } from '@nanobanana/shared/types/generation'
import { reconcileTaskHistory } from '../src/utils/taskHistory.ts'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  clear() { this.values.clear() }
}

test('submission recovery freezes requests, persists only identity, and never invents another task after unknown outcomes', async (t) => {
  const originals = ['window', 'localStorage', 'navigator', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  const storage = new MemoryStorage()
  changeSessionScope('user-a')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: 'XSRF-TOKEN=test-token' } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    locks: { request: (_name: string, _options: unknown, action: (lock: object) => Promise<unknown>) => action({}) },
  } })
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const config = createDefaultProviderConfig()
  config.channelId = 'channel-a'
  config.profiles['openai-compatible'].model = 'dynamic-model'
  config.profiles['openai-compatible'].apiKey = 'active-test-secret'
  config.profiles['gemini-compatible'].apiKey = 'inactive-test-secret'
  const originalsImages = [
    { name: 'first.png', mimeType: 'image/png' as const, base64Data: 'iVBORw0KGgo=' },
    { name: 'second.png', mimeType: 'image/png' as const, base64Data: 'iVBORw0KGgoBAgME' },
  ]
  const input = { prompt: 'original prompt', config, referenceImages: structuredClone(originalsImages) }
  const pending = await withSubmissionLock(() => prepareSubmission(input))
  const marker = storage.getItem(`${userStorageKey(PENDING_TASK_PREFIX)}.${pending.id}`)!
  assert.ok(!marker.includes('test-secret') && !marker.includes('original prompt'))
  assert.ok(!marker.includes(originalsImages[0].base64Data) && !marker.includes('first.png'))
  assert.equal(readPendingSubmissions()[0].id, pending.id)
  await assert.rejects(prepareSubmission(input), { code: 'VALIDATION' })
  const bodies: string[] = []
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    assert.equal(readPendingSubmissions()[0].id, pending.id, 'recovery identity must precede network I/O')
    assert.equal((options.headers as Record<string, string>)['X-XSRF-TOKEN'], 'test-token')
    assert.equal(options.credentials, 'same-origin')
    bodies.push(String(options.body))
    throw new TypeError('connection reset after server may have accepted POST')
  })
  await assert.rejects(submitPendingRequest(pending, input), (error) => error instanceof BackendRequestError && !isDefiniteSubmissionRejection(error))
  input.referenceImages = []
  input.prompt = 'edited while response unknown'
  input.config.profiles['openai-compatible'].apiKey = 'edited-key'
  await assert.rejects(submitPendingRequest(pending, input))
  assert.equal(bodies[0], bodies[1])
  assert.ok(!bodies[0].includes('test-secret'))
  assert.deepEqual(Object.keys(JSON.parse(bodies[0])).sort(), ['channelId', 'id', 'model', 'params', 'prompt', 'referenceImages'])
  assert.equal(JSON.parse(bodies[0]).channelId, 'channel-a')
  assert.equal(JSON.parse(bodies[0]).id, pending.id)
  assert.deepEqual(JSON.parse(bodies[0]).referenceImages, originalsImages)

  // Simulate reload by dropping in-memory request and restoring only the persisted marker.
  acknowledgeSubmission(pending.id)
  storage.setItem(`${userStorageKey(PENDING_TASK_PREFIX)}.${pending.id}`, marker)
  const previousCalls = bodies.length
  await assert.rejects(submitPendingRequest(pending, input), { code: 'VALIDATION' })
  assert.equal(bodies.length, previousCalls, 'changed form cannot overwrite an existing id')
  input.prompt = 'original prompt'
  input.config.profiles['openai-compatible'].apiKey = 'active-test-secret'
  await assert.rejects(submitPendingRequest(pending, input), { code: 'VALIDATION' })
  input.referenceImages = [...originalsImages].reverse()
  await assert.rejects(submitPendingRequest(pending, input), { code: 'VALIDATION' })
  assert.equal(bodies.length, previousCalls, 'missing or reordered images must not be sent under the same ID')
  input.referenceImages = structuredClone(originalsImages)
  // The unused profile is deliberately not part of the request or retry identity.
  input.config.profiles['gemini-compatible'].apiKey = 'changed-inactive-key'
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ task: { id: pending.id, status: 'queued' } }), { status: 202 }))
  assert.equal((await submitPendingRequest(pending, input)).id, pending.id)
  acknowledgeSubmission(pending.id)
  assert.deepEqual(readPendingSubmissions(), [])
  const isolated = await prepareSubmission(input)
  changeSessionScope('user-b'); clearSubmissionMemory()
  assert.deepEqual(readPendingSubmissions(), [])
  await assert.rejects(submitPendingRequest(isolated, input), { code: 'AUTH' })
  changeSessionScope('user-a')
  assert.equal(readPendingSubmissions()[0].id, isolated.id)
  acknowledgeSubmission(isolated.id)
  assert.equal(isDefiniteSubmissionRejection(new BackendRequestError(createAppError('RATE_LIMIT', 'queue full', true, 429), true)), true)

  assert.equal(isDefiniteSubmissionRejection(new BackendRequestError(createAppError('VALIDATION', 'bad input', false, 400), true)), true)
  assert.equal(isDefiniteSubmissionRejection(new BackendRequestError(createAppError('UNKNOWN', 'server error', true, 500), true)), false)
  assert.equal(isDefiniteSubmissionRejection(new BackendRequestError(createAppError('NETWORK', 'proxy error', true, 400))), false)
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ error: createAppError('VALIDATION', 'not found', false, 404) }), { status: 404 }))
  assert.equal(await getGenerationTask(pending.id), null)
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ error: createAppError('VALIDATION', 'deleted', false, 410) }), { status: 410 }))
  await assert.rejects(getGenerationTask(pending.id), (error) => isDeletedTaskError(error) && isDefiniteSubmissionRejection(error))
  fetchMock.mock.mockImplementation(async (url: unknown, options?: RequestInit) => {
    assert.equal(url, `/api/tasks/${pending.id}`)
    assert.equal(options?.method, 'DELETE')
    return new Response(JSON.stringify({ deletedTaskCount: 1, deletedImageCount: 2 }))
  })
  assert.deepEqual(await deleteGenerationTask(pending.id), { deletedTaskCount: 1, deletedImageCount: 2 })
})

test('task history reconciliation removes externally deleted tasks without reviving local deletions or losing raced submissions', () => {
  const task = (id: string, status: GenerationTask['status'] = 'succeeded'): GenerationTask => ({
    id, status, provider: 'openai-compatible', model: 'gpt-image-1', prompt: id,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', expectedImageCount: 1, expectedAspectRatio: '1:1',
  })
  const first = task('first')
  const other = task('other')
  const pending = task('newly-submitted', 'queued')
  assert.deepEqual(reconcileTaskHistory([first, other], [other], false, new Set()), [other])
  assert.deepEqual(reconcileTaskHistory([first, other], [first, other], true, new Set(['first'])), [other])
  const raced = reconcileTaskHistory([other, pending], [other], true, new Set())
  assert.ok(raced.some((entry) => entry.id === pending.id), 'an older list must not erase a just-acknowledged submission')
  assert.deepEqual(reconcileTaskHistory(raced, [other], false, new Set()), [other], 'the next authoritative list must prune missing tasks')
  assert.equal(reconcileTaskHistory([first], [task('first', 'running')], false, new Set())[0].status, 'succeeded')
})

test('CSRF headers cover every mutating verb and decode the cookie', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.deepEqual(csrfHeaders(method, 'other=x; XSRF-TOKEN=a%2Fb'), { 'X-XSRF-TOKEN': 'a/b' })
  assert.deepEqual(csrfHeaders('GET', 'XSRF-TOKEN=secret'), {})
})
test('dynamic models keep custom values, application budgets and key-free task previews', () => {
  const config = createDefaultProviderConfig()
  assert.equal(config.profiles['openai-compatible'].model, '')
  assert.equal(validateProviderConfig(config).valid, false)
  config.channelId = 'dynamic-channel'
  config.profiles['openai-compatible'].model = 'never-seen-before'
  config.profiles['openai-compatible'].params.size = '3072x1024'
  assert.equal(validateProviderConfig(config).valid, true, 'no browser key or base URL is required')
  const preview = buildRequestPreview(config)
  assert.equal(preview.endpoint, '/api/tasks')
  assert.equal(preview.bodyPreview.model, 'never-seen-before')
  assert.ok(!JSON.stringify(preview).includes('Bearer'))
  assert.deepEqual(taskParams('gemini-compatible', { imageSize: 'auto', aspectRatio: 'auto', thinkingLevel: 'auto', imageOnly: true, headers: { secret: true } }), { imageOnly: true })
  assert.deepEqual(taskParams('gemini-compatible', { imageSize: '8K', aspectRatio: '7:5', thinkingLevel: 'custom', imageOnly: false }), { imageSize: '8K', aspectRatio: '7:5', thinkingLevel: 'custom', imageOnly: false })
  assert.equal(getReferenceImageLimits('gemini-compatible', 'unknown').maxImages, 14)
  assert.equal(getReferenceImageLimits('gemini-compatible', 'unknown').maxTotalBytes, 12 * 1024 * 1024)
  assert.equal(getReferenceImageLimits('openai-compatible', 'unknown').maxImages, 16)
  assert.equal(getReferenceImageLimits('openai-compatible', 'unknown').maxImageBytes, 20 * 1024 * 1024)
  assert.equal(getReferenceImageLimits('openai-compatible', 'unknown').maxTotalBytes, 32 * 1024 * 1024)
})

test('changing account aborts old HTTP exchanges and rejects late responses', async (t) => {
  const originals = ['window', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { cookie: '' } })
  t.after(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) } })
  changeSessionScope('old-user')
  let resolveResponse!: (value: Response) => void
  let signal: AbortSignal | undefined
  t.mock.method(globalThis, 'fetch', (_url: unknown, options?: RequestInit) => { signal = options?.signal ?? undefined; return new Promise<Response>((resolve) => { resolveResponse = resolve }) })
  const request = backendRequest('/channels/channel/models/refresh', { method: 'POST', body: '{}' })
  changeSessionScope('new-user')
  assert.equal(signal?.aborted, true)
  resolveResponse(new Response(JSON.stringify({ tasks: [{ prompt: 'private old prompt' }] })))
  await assert.rejects(request, BackendRequestError)
})

test('model discovery refresh gets a long budget without changing ordinary API timeouts', () => {
  assert.equal(requestTimeoutMs('/channels/abc/models/refresh'), 180_000)
  assert.equal(requestTimeoutMs('/channels/abc/models'), 15_000)
  assert.equal(requestTimeoutMs('/tasks'), 15_000)
  assert.equal(requestTimeoutMs('/auth/logout'), 15_000)
})

test('local selection restores only visible enabled channels and never upgrades the chosen model', () => {
  const channel: Channel = { id: 'chosen', name: 'Chosen', provider: 'openai-compatible', scope: 'private', baseUrl: '', enabled: true, hasApiKey: true, canManage: true, enabledModels: ['newest-model'] }
  const saved = JSON.stringify({ channelId: channel.id, model: 'explicit-older-model', provider: channel.provider })
  const restored = restoreChannelSelection(saved, [channel])!
  assert.equal(restored.model, 'explicit-older-model')
  assert.equal(restoreChannelSelection(saved, []), null)
  assert.equal(restoreChannelSelection(saved, [{ ...channel, enabled: false }]), null)
  assert.equal(restoreChannelSelection('legacy-unstructured-id', [channel]), null)
  const config = applyChannelSelection(createDefaultProviderConfig(), restored)
  assert.equal(config.profiles['openai-compatible'].model, 'explicit-older-model')
  const editedChannel: Channel = { ...channel, provider: 'gemini-compatible' }
  const changed = reconcileChannelProtocol(config, [editedChannel])
  assert.equal(changed.activeProvider, 'gemini-compatible')
  assert.equal(changed.channelId, channel.id)
  assert.equal(changed.profiles['gemini-compatible'].model, '')
  assert.deepEqual(changed.profiles['gemini-compatible'].params, createDefaultProviderConfig().profiles['gemini-compatible'].params)
  assert.equal(changed.profiles['openai-compatible'].model, '')
  assert.equal(restoreChannelSelection(saved, [editedChannel])?.model, '')
  assert.equal(reconcileChannelProtocol(config, [channel]), config)
})
