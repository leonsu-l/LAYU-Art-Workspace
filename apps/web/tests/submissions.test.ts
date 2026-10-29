import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  acknowledgeSubmission, deleteGenerationTask, getGenerationTask, isDefiniteSubmissionRejection, isDeletedTaskError, PENDING_TASK_PREFIX,
  prepareSubmission, readPendingSubmissions, submitPendingRequest, withSubmissionLock,
} from '../src/services/imageGenerationService.ts'
import { BackendRequestError } from '../src/services/backendClient.ts'
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
  const originals = ['window', 'localStorage', 'navigator'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  const storage = new MemoryStorage()
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
  config.profiles['openai-compatible'].apiKey = 'active-test-secret'
  config.profiles['gemini-compatible'].apiKey = 'inactive-test-secret'
  const originalsImages = [
    { name: 'first.png', mimeType: 'image/png' as const, base64Data: 'iVBORw0KGgo=' },
    { name: 'second.png', mimeType: 'image/png' as const, base64Data: 'iVBORw0KGgoBAgME' },
  ]
  const input = { prompt: 'original prompt', config, referenceImages: structuredClone(originalsImages) }
  const pending = await withSubmissionLock(() => prepareSubmission(input))
  const marker = storage.getItem(`${PENDING_TASK_PREFIX}${pending.id}`)!
  assert.ok(!marker.includes('test-secret') && !marker.includes('original prompt'))
  assert.ok(!marker.includes(originalsImages[0].base64Data) && !marker.includes('first.png'))
  assert.equal(readPendingSubmissions()[0].id, pending.id)
  await assert.rejects(prepareSubmission(input), { code: 'VALIDATION' })
  const bodies: string[] = []
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    assert.equal(readPendingSubmissions()[0].id, pending.id, 'recovery identity must precede network I/O')
    bodies.push(String(options.body))
    throw new TypeError('connection reset after server may have accepted POST')
  })
  await assert.rejects(submitPendingRequest(pending, input), (error) => error instanceof BackendRequestError && !isDefiniteSubmissionRejection(error))
  input.referenceImages = []
  input.prompt = 'edited while response unknown'
  input.config.profiles['openai-compatible'].apiKey = 'edited-key'
  await assert.rejects(submitPendingRequest(pending, input))
  assert.equal(bodies[0], bodies[1])
  assert.ok(bodies[0].includes('active-test-secret') && !bodies[0].includes('inactive-test-secret'))
  assert.equal(JSON.parse(bodies[0]).id, pending.id)
  assert.deepEqual(JSON.parse(bodies[0]).referenceImages, originalsImages)

  // Simulate reload by dropping in-memory request and restoring only the persisted marker.
  acknowledgeSubmission(pending.id)
  storage.setItem(`${PENDING_TASK_PREFIX}${pending.id}`, marker)
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
