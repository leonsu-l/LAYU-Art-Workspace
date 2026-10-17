import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, get, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { GenerateImageRequest, GenerateImageResult } from '../src/types/generation.ts'
import { createDefaultProviderConfig } from '../src/utils/configDefaults.ts'
import { createAppError } from '../src/utils/errors.ts'
import { createApplication } from './app.ts'
import { TaskStore } from './taskStore.ts'
import { parseTaskRequest } from './validation.ts'
import { MAX_TASK_BODY_BYTES } from '../src/utils/referenceImages.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7mQAAAAASUVORK5CYII=', 'base64')

function request(): GenerateImageRequest {
  const config = createDefaultProviderConfig()
  config.profiles['openai-compatible'].apiKey = 'test-secret-active'
  config.profiles['gemini-compatible'].apiKey = 'test-secret-inactive'
  return { prompt: 'a small banana', config }
}

function generated(): GenerateImageResult {
  return {
    provider: 'openai-compatible', model: 'gpt-image-1', createdAt: new Date().toISOString(),
    images: [{ mimeType: 'image/png', base64Data: PNG.toString('base64') }],
  }
}

async function directory(t: TestContext): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), 'nanobanana-test-'))
  t.after(async () => {
    const absolute = resolve(path)
    assert.ok(basename(absolute).startsWith('nanobanana-test-'))
    assert.equal(resolve(absolute, '..'), resolve(tmpdir()))
    await rm(absolute, { recursive: true, force: true })
  })
  return path
}

async function listen(t: TestContext, server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

function post(url: string, body: unknown) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify(body) })
}

test('acknowledged tasks outlive the client connection, deduplicate and survive reload with disk images', async (t) => {
  const data = await directory(t)
  let finish!: () => void
  const gate = new Promise<void>((resolve) => { finish = resolve })
  let calls = 0
  const referenceBytes = Buffer.concat([PNG, Buffer.alloc(80 * 1024)])
  const referenceImages = [{ name: 'reference.png', mimeType: 'image/png' as const, base64Data: referenceBytes.toString('base64') }]
  const store = await TaskStore.open(data, async (input) => {
    calls++
    assert.deepEqual(input.referenceImages, referenceImages)
    assert.equal(input.config.profiles['openai-compatible'].params.size, '3840x2160')
    await gate
    return generated()
  })
  const url = await listen(t, createApplication(store, resolve(data, 'no-dist')))
  const body = { id: randomUUID(), ...request(), referenceImages }
  body.config.profiles['openai-compatible'].model = 'gpt-image-2.5-sunburst'
  body.config.profiles['openai-compatible'].params.size = '3840x2160'
  const response = await post(`${url}/api/tasks`, body)
  assert.equal(response.status, 202)
  const accepted = await response.json()
  assert.equal(accepted.task.id, body.id)
  assert.ok(['queued', 'running'].includes(accepted.task.status))
  assert.ok(!JSON.stringify(accepted).includes('test-secret'))
  assert.equal(accepted.task.referenceImageCount, 1)
  assert.equal(accepted.task.requestedSize, '3840x2160')
  assert.equal(accepted.task.expectedAspectRatio, '16:9')
  assert.ok(!JSON.stringify(accepted).includes(referenceImages[0].base64Data))
  const persisted = await readFile(resolve(data, 'state.json'), 'utf8')
  assert.ok(persisted.includes('test-secret-active'))
  assert.ok(!persisted.includes('test-secret-inactive'))
  assert.ok(persisted.includes(referenceImages[0].base64Data))
  assert.equal((await post(`${url}/api/tasks`, body)).status, 202)
  assert.equal((await post(`${url}/api/tasks`, { ...body, prompt: 'different prompt' })).status, 409)
  assert.equal((await post(`${url}/api/tasks`, { ...body, referenceImages: [] })).status, 409)

  // No page/polling connection is kept alive while the backend finishes its work.
  finish()
  await store.waitForIdle()
  assert.equal(calls, 1)
  assert.equal(store.getTask(body.id)?.status, 'succeeded')
  assert.ok(!(await readFile(resolve(data, 'state.json'), 'utf8')).includes(referenceImages[0].base64Data))
  assert.ok(!(await readFile(resolve(data, 'state.json'), 'utf8')).includes('test-secret'))
  await store.stop()
  const reopened = await TaskStore.open(data, async () => { throw new Error('Must not rerun completed work') })
  const task = reopened.getTask(body.id)
  assert.equal(task?.status, 'succeeded')
  assert.equal(task?.requestedSize, '3840x2160', 'requested dimensions must remain available after terminal request cleanup and reload')
  assert.equal(reopened.listImages().length, 1)
  assert.deepEqual(await reopened.images.read(reopened.listImages()[0]), PNG)
  const imageResponse = await fetch(`${url}${task?.result?.images[0].url}`)
  assert.equal(imageResponse.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), PNG)
  const tasksResponse = await fetch(`${url}/api/tasks`)
  assert.ok(!(await tasksResponse.text()).includes('requestHash'))
  await reopened.stop()
})

test('restart fails interrupted running work without replay, resumes queued work and scrubs terminal secrets', async (t) => {
  const data = await directory(t)
  const first = await TaskStore.open(data)
  await first.stop()
  const file = resolve(data, 'state.json')
  const state = JSON.parse(await readFile(file, 'utf8'))
  const runningId = randomUUID()
  const queuedId = randomUUID()
  const now = new Date().toISOString()
  const references = [{ name: 'restart-reference.png', mimeType: 'image/png' as const, base64Data: PNG.toString('base64') }]
  for (const [id, status] of [[runningId, 'running'], [queuedId, 'queued']]) {
    state.tasks.push({
      id, status, createdAt: now, updatedAt: now, provider: 'openai-compatible', model: 'gpt-image-1',
      prompt: 'restart fixture', expectedImageCount: 1, expectedAspectRatio: '1:1', request: { ...request(), referenceImages: references }, requestHash: 'fixture',
    })
  }
  await writeFile(file, JSON.stringify(state))
  let calls = 0
  const restored = await TaskStore.open(data, async (input) => { calls++; assert.deepEqual(input.referenceImages, references); return generated() })
  await restored.waitForIdle()
  assert.equal(calls, 1)
  assert.equal(restored.getTask(runningId)?.status, 'failed')
  assert.match(restored.getTask(runningId)?.error?.message ?? '', /可能已扣费/)
  assert.equal(restored.getTask(queuedId)?.status, 'succeeded')
  assert.ok(!(await readFile(file, 'utf8')).includes('test-secret'))
  assert.ok(!(await readFile(file, 'utf8')).includes('restart-reference.png'))
  await restored.stop()
})

test('gallery deletion removes the entire task group and disk files after downloading URL results', async (t) => {
  const data = await directory(t)
  let downloads = 0
  const supplier = await listen(t, createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined)
    downloads++
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(PNG)
  }))
  const store = await TaskStore.open(data, async () => ({ ...generated(), images: [
    { mimeType: 'image/png', url: `${supplier}/short-lived.png` }, ...generated().images,
  ] }))
  const id = randomUUID()
  await store.create(id, parseTaskRequest({ id, ...request() }).request)
  await store.waitForIdle()
  assert.equal(downloads, 1)
  assert.equal(store.getTask(id)?.status, 'succeeded')
  const images = store.listImages()
  assert.equal(images.length, 2)
  const image = images[0]
  assert.ok(image.url.startsWith('/api/images/'))
  const url = await listen(t, createApplication(store, data))
  assert.equal((await (await fetch(`${url}/api/gallery/stats`)).json()).totalBytes, PNG.length * 2)
  const deleted = await post(`${url}/api/gallery/delete`, { ids: [image.id, image.id] })
  assert.deepEqual(await deleted.json(), { deletedCount: 2 }, 'unselected siblings in the same task are deleted as a group')
  assert.deepEqual(store.listImages(), [])
  assert.equal(store.getTask(id), undefined)
  for (const entry of images) {
    await assert.rejects(store.images.read(entry), { code: 'ENOENT' })
    assert.equal((await fetch(`${url}${entry.url}`)).status, 404)
  }
  assert.equal((await fetch(`${url}/api/tasks/${id}`)).status, 410)
  assert.equal((await post(`${url}/api/tasks`, { id, ...request() })).status, 410)
  assert.equal(downloads, 1, 'late submissions must never repeat paid work')
  await store.stop()
})

test('task history deletion cascades images, is idempotent and persists deletion across restart', async (t) => {
  const data = await directory(t)
  const store = await TaskStore.open(data, async (input) => {
    if (input.prompt === 'failed task to remove') throw createAppError('BAD_RESPONSE', 'expected failure', false)
    return { ...generated(), images: [...generated().images, ...generated().images] }
  })
  const first = randomUUID()
  const other = randomUUID()
  const failed = randomUUID()
  await store.create(first, { ...request(), prompt: 'private task to remove' })
  await store.create(other, request())
  await store.create(failed, { ...request(), prompt: 'failed task to remove' })
  await store.waitForIdle()
  const images = store.listImages()
  const url = await listen(t, createApplication(store, data))
  const deleted = await fetch(`${url}/api/tasks/${first}`, { method: 'DELETE' })
  assert.equal(deleted.status, 200)
  assert.deepEqual(await deleted.json(), { deletedTaskCount: 1, deletedImageCount: 2 })
  assert.equal(store.getTask(first), undefined)
  assert.equal(store.getTask(other)?.status, 'succeeded')
  assert.equal(store.listImages().length, 2, 'unrelated task images must remain')
  assert.ok(!(await readFile(resolve(data, 'state.json'), 'utf8')).includes('private task to remove'))
  for (const image of images.filter((entry) => entry.url.includes(first))) {
    await assert.rejects(store.images.read(image), { code: 'ENOENT' })
  }
  for (const id of [first, randomUUID()]) {
    assert.deepEqual(await (await fetch(`${url}/api/tasks/${id}`, { method: 'DELETE' })).json(), { deletedTaskCount: 0, deletedImageCount: 0 })
  }
  assert.deepEqual(await (await fetch(`${url}/api/tasks/${failed}`, { method: 'DELETE' })).json(), { deletedTaskCount: 1, deletedImageCount: 0 })
  const otherImage = store.listImages()[0]
  assert.deepEqual(await (await fetch(`${url}/api/gallery/${otherImage.id}`, { method: 'DELETE' })).json(), { deletedCount: 2 })
  assert.deepEqual(store.listTasks(), [])
  assert.deepEqual(store.listImages(), [])
  assert.deepEqual(await readdir(resolve(data, 'images')), [])
  await store.stop()
  let calls = 0
  const reopened = await TaskStore.open(data, async () => { calls++; return generated() })
  assert.deepEqual(reopened.listTasks(), [])
  for (const id of [first, other, failed]) {
    assert.ok(reopened.isTaskDeleted(id))
    await assert.rejects(reopened.create(id, request()), { status: 410 })
  }
  assert.equal(calls, 0)
  await reopened.stop()
})

test('deletion rejects active tasks and serializes overlapping task/gallery deletions', async (t) => {
  const data = await directory(t)
  let finish!: () => void
  let started!: () => void
  const gate = new Promise<void>((resolve) => { finish = resolve })
  const running = new Promise<void>((resolve) => { started = resolve })
  let calls = 0
  const store = await TaskStore.open(data, async () => {
    calls++
    started()
    await gate
    return generated()
  })
  const first = randomUUID()
  const second = randomUUID()
  await store.create(first, request())
  await running
  await store.create(second, request())
  const url = await listen(t, createApplication(store, data))
  try {
    for (const id of [first, second]) {
      const response = await fetch(`${url}/api/tasks/${id}`, { method: 'DELETE' })
      assert.equal(response.status, 409)
      assert.match((await response.json()).error.message, /不能删除/)
    }
    assert.equal(store.getTask(first)?.status, 'running')
    assert.equal(store.getTask(second)?.status, 'queued')
    assert.equal(calls, 1)
  } finally { finish() }
  await store.waitForIdle()
  const image = store.listImages().find((entry) => entry.url.includes(first))!
  const [taskDeletion, imageDeletion] = await Promise.all([
    fetch(`${url}/api/tasks/${first}`, { method: 'DELETE' }).then((response) => response.json()),
    post(`${url}/api/gallery/delete`, { ids: [image.id] }).then((response) => response.json()),
  ])
  assert.equal(taskDeletion.deletedImageCount + imageDeletion.deletedCount, 1)
  assert.equal(store.getTask(first), undefined)
  assert.equal(store.getTask(second)?.status, 'succeeded')
  assert.equal(store.listImages().length, 1)
  assert.equal(calls, 2)
  await store.stop()
})

test('interrupted deletion resumes disk cleanup without restoring history or replaying generation', async (t) => {
  const data = await directory(t)
  const store = await TaskStore.open(data, async () => generated())
  const id = randomUUID()
  await store.create(id, request())
  await store.waitForIdle()
  const image = store.listImages()[0]
  const remove = store.images.remove.bind(store.images)
  store.images.remove = async () => { throw new Error('simulated disk cleanup failure') }
  await assert.rejects(store.deleteTask(id), { status: 500 })
  assert.equal(store.getTask(id), undefined)
  assert.deepEqual(store.listImages(), [])
  assert.deepEqual(await store.images.read(image), PNG)
  assert.equal(JSON.parse(await readFile(resolve(data, 'state.json'), 'utf8')).pendingImageDeletes.length, 1)
  store.images.remove = remove
  await store.stop()
  const reopened = await TaskStore.open(data, async () => { throw new Error('Must not replay deleted work') })
  assert.equal(reopened.getTask(id), undefined)
  await assert.rejects(reopened.images.read(image), { code: 'ENOENT' })
  assert.deepEqual(JSON.parse(await readFile(resolve(data, 'state.json'), 'utf8')).pendingImageDeletes, [])
  await assert.rejects(reopened.create(id, request()), { status: 410 })
  await reopened.stop()
})

test('failed work does not block the queue; provider keys are redacted from public and persisted errors', async (t) => {
  const data = await directory(t)
  let calls = 0
  const store = await TaskStore.open(data, async () => {
    calls++
    if (calls === 1) throw createAppError('AUTH', 'rejected test-secret-active', false, 401, 'https://example.test/?key=test-secret-active')
    return generated()
  })
  const first = randomUUID()
  const second = randomUUID()
  await Promise.all([store.create(first, request()), store.create(second, request())])
  await store.waitForIdle()
  assert.equal(calls, 2)
  assert.equal(store.getTask(first)?.status, 'failed')
  assert.equal(store.getTask(second)?.status, 'succeeded')
  assert.ok(!JSON.stringify(store.listTasks()).includes('test-secret'))
  assert.ok(!(await readFile(resolve(data, 'state.json'), 'utf8')).includes('test-secret'))
  await store.stop()
})

test('invalid input and cross-site requests never enqueue provider work', async (t) => {
  const data = await directory(t)
  let calls = 0
  const store = await TaskStore.open(data, async () => { calls++; return generated() })
  const url = await listen(t, createApplication(store, data))
  const valid = { id: randomUUID(), ...request() }
  for (const body of [null, {}, { ...valid, id: '../secret' }, { ...valid, config: {} }, { ...valid, prompt: 123 }, { ...valid, prompt: '' }]) {
    assert.equal((await post(`${url}/api/tasks`, body)).status, 400)
  }
  assert.equal((await post(`${url}/api/tasks`, { ...valid, referenceImages: [{ name: 'bad.svg', mimeType: 'image/svg+xml', base64Data: 'PHN2Zz4=' }] })).status, 400)
  assert.equal((await post(`${url}/api/tasks`, { ...valid, padding: 'x'.repeat(MAX_TASK_BODY_BYTES) })).status, 413)
  // Other JSON routes retain their original small limit.
  assert.equal((await post(`${url}/api/gallery/delete`, { ids: [], padding: 'x'.repeat(65 * 1024) })).status, 413)
  assert.equal((await fetch(`${url}/api/tasks`, { method: 'POST', body: JSON.stringify(valid) })).status, 415)
  assert.equal((await fetch(`${url}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400)
  assert.equal((await fetch(`${url}/api/tasks`, { headers: { Origin: 'https://untrusted.example' } })).status, 403)
  // Fetch controls Host itself; use raw HTTP to exercise DNS-rebinding protection.
  const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(`${url}/api/tasks`, { headers: { Host: 'untrusted.example' } }, (response) => {
      response.resume()
      resolve(response.statusCode)
    }).on('error', reject)
  })
  assert.equal(foreignHostStatus, 403)
  assert.equal((await fetch(`${url}/api/tasks`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
  assert.equal((await fetch(`${url}/api/tasks/${randomUUID()}`)).status, 404)
  assert.equal((await post(`${url}/api/gallery/delete`, { ids: ['../state.json'] })).status, 400)
  assert.equal(calls, 0)
  assert.equal(store.listTasks().length, 0)
  await store.stop()
})

test('invalid image content fails durably instead of retaining an external URL or an unsafe file', async (t) => {
  const data = await directory(t)
  const store = await TaskStore.open(data, async () => ({ ...generated(), images: [{ mimeType: 'image/png', base64Data: Buffer.from('<html>not an image</html>').toString('base64') }] }))
  const id = randomUUID()
  await store.create(id, request())
  await store.waitForIdle()
  assert.equal(store.getTask(id)?.status, 'failed')
  assert.equal(store.getTask(id)?.error?.code, 'BAD_RESPONSE')
  assert.deepEqual(store.listImages(), [])
  await store.stop()
})

test('an exclusive data-directory owner prevents overlapping workers and releases after graceful stop', async (t) => {
  const data = await directory(t)
  let finish!: () => void
  const gate = new Promise<void>((resolve) => { finish = resolve })
  let started!: () => void
  const running = new Promise<void>((resolve) => { started = resolve })
  const store = await TaskStore.open(data, async () => { started(); await gate; return generated() })
  const id = randomUUID()
  await store.create(id, request())
  await running
  const stopping = store.stop()
  await assert.rejects(TaskStore.open(data), /DATA_DIR is already in use/)
  assert.equal(store.getTask(id)?.status, 'running')
  finish()
  await stopping
  const reopened = await TaskStore.open(data)
  assert.equal(reopened.getTask(id)?.status, 'succeeded')
  await reopened.stop()
})

test('a failed completion commit keeps paid images and replays only local metadata on restart', async (t) => {
  const data = await directory(t)
  const blockedPath = resolve(data, 'state.json.tmp')
  const store = await TaskStore.open(data, async () => {
    // The task's running state is already committed. Force only the success commit to fail.
    await mkdir(blockedPath)
    return generated()
  })
  const id = randomUUID()
  await store.create(id, request())
  await store.waitForIdle()
  assert.equal(store.getTask(id)?.status, 'running')
  const filenames = await readdir(resolve(data, 'images'))
  assert.equal(filenames.length, 1)
  assert.ok(filenames[0].startsWith(`${id}_`))
  assert.ok(!(await readFile(resolve(data, 'completed', `${id}.json`), 'utf8')).includes('test-secret'))
  await store.stop()
  assert.equal(blockedPath, resolve(data, 'state.json.tmp'))
  await rm(blockedPath, { recursive: true })
  let retries = 0
  const restored = await TaskStore.open(data, async () => { retries++; throw new Error('Never repeat a paid request') })
  await restored.waitForIdle()
  assert.equal(retries, 0)
  assert.equal(restored.getTask(id)?.status, 'succeeded')
  assert.deepEqual(await restored.images.read(restored.listImages()[0]), PNG)
  assert.ok(!(await readFile(resolve(data, 'state.json'), 'utf8')).includes('test-secret'))
  await restored.stop()
})

test('malformed persistent state fails startup rather than discarding task history', async (t) => {
  const data = await directory(t)
  await writeFile(resolve(data, 'state.json'), '{broken')
  await assert.rejects(TaskStore.open(data))
  assert.equal(await readFile(resolve(data, 'state.json'), 'utf8'), '{broken')
})
