import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { IncomingMessage, RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import type { AppError, ProviderConfig, ProviderType, ReferenceImage } from '@nanobanana/shared/types/generation'
import { getReferenceImageLimitError, getReferenceImageLimits, MAX_TASK_BODY_BYTES, parseReferenceImages } from '@nanobanana/shared/utils/referenceImages'
import { getDroppedReferenceFiles } from '../../../web/src/utils/referenceImages.ts'
import { buildRequestPreview } from '../../../web/src/services/requestPreview.ts'
import { getOutputSizeWarning } from '../../../web/src/utils/outputImageSize.ts'
import { isAppError } from '@nanobanana/shared/utils/errors'
import { createDefaultProviderConfig } from '@nanobanana/shared/utils/configDefaults'
import { getGeminiModel, GEMINI_IMAGE_MODELS, OPENAI_IMAGE_MODELS, isOpenAISizeSupported, normalizeGeminiParams, normalizeOpenAIParams, resolveExpectedAspectRatio } from '@nanobanana/shared/utils/imageModels'
import { buildGeminiRequestBody, buildOpenAIRequestBody } from '@nanobanana/shared/utils/providerRequests'
import { loadPersistedConfig, savePersistedConfig, STORAGE_KEY } from '../../../web/src/utils/storage.ts'
import { parseTaskRequest } from '../../src/validation.ts'
import { generateImageWithProvider } from '../../src/providerService.ts'
import { getImageRequestTimeoutMs } from '../../src/providers/requestTimeout.ts'

const providers: ProviderType[] = ['openai-compatible', 'gemini-compatible']

function makeConfig(origin: string, activeProvider: ProviderType): ProviderConfig {
  return {
    activeProvider,
    profiles: {
      'openai-compatible': {
        baseUrl: `${origin}/v1///`,
        model: ' image-model ',
        apiKey: ' fake-key ',
        params: { size: '1024x1024', quality: 'high', n: 2, background: 'auto', outputFormat: 'png', outputCompression: 100, moderation: 'auto' },
      },
      'gemini-compatible': {
        baseUrl: `${origin}/v1beta/`,
        model: ' gemini image/test ',
        apiKey: ' fake & key ',
        params: { imageSize: '1K', aspectRatio: '16:9', imageOnly: false, thinkingLevel: 'auto' },
      },
    },
  }
}

async function startProvider(t: TestContext, handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => error ? reject(error) : resolve())
  }))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function checkAppError(expected: Partial<AppError>): (error: unknown) => boolean {
  return (error) => {
    assert.ok(isAppError(error), 'failure must be a structured AppError')
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(error[key as keyof AppError], value)
    }
    return true
  }
}

function restoreTimeout(t: TestContext): void {
  const previous = process.env.IMAGE_REQUEST_TIMEOUT_MS
  t.after(() => {
    if (previous === undefined) delete process.env.IMAGE_REQUEST_TIMEOUT_MS
    else process.env.IMAGE_REQUEST_TIMEOUT_MS = previous
  })
}

test('OpenAI sends the existing image protocol and accepts base64 or URL results', async (t) => {
  let received: { url?: string; method?: string; authorization?: string; body: unknown } | undefined
  const origin = await startProvider(t, (request, response) => {
    void readBody(request).then((body) => {
      received = {
        url: request.url,
        method: request.method,
        authorization: request.headers.authorization,
        body,
      }
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [
        null,
        { b64_json: 'aW1hZ2U=', revised_prompt: 'First revision' },
        { url: `${origin}/image.png`, revised_prompt: 'Second revision' },
        { b64_json: 42, revised_prompt: 42 },
      ] }))
    }).catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined))
  })
  const config = makeConfig(origin, 'openai-compatible')
  const result = await generateImageWithProvider({ prompt: '  Paint a banana  ', config })

  assert.deepEqual(received, {
    url: '/v1/images/generations',
    method: 'POST',
    authorization: 'Bearer fake-key',
    body: {
      model: 'image-model', prompt: 'Paint a banana', size: '1024x1024',
      quality: 'high', n: 2, background: 'auto', output_format: 'png', moderation: 'auto',
    },
  })
  assert.equal(result.provider, 'openai-compatible')
  assert.equal(result.model, config.profiles['openai-compatible'].model)
  assert.equal(result.text, 'First revision\nSecond revision')
  assert.deepEqual(result.images, [
    { mimeType: 'image/png', base64Data: 'aW1hZ2U=' },
    { mimeType: 'image/png', url: `${origin}/image.png` },
  ])
  assert.ok(Number.isFinite(Date.parse(result.createdAt)))
})

test('Gemini encodes model/key and accepts camelCase and snake_case image parts', async (t) => {
  let received: { url?: string; method?: string; body: unknown } | undefined
  const origin = await startProvider(t, (request, response) => {
    void readBody(request).then((body) => {
      received = { url: request.url, method: request.method, body }
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ candidates: [{ content: { parts: [
        null,
        { text: 'Here is your image.' },
        { inlineData: { data: 'aW1hZ2Ux', mimeType: 'image/webp' } },
        { inline_data: { data: 'aW1hZ2Uy', mime_type: 'image/jpeg' } },
        { inlineData: { data: 'aW1hZ2Uz' } },
        { text: 42, inlineData: { data: 42 } },
      ] } }] }))
    }).catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined))
  })
  const config = makeConfig(origin, 'gemini-compatible')
  const result = await generateImageWithProvider({ prompt: '  Paint a banana  ', config })

  assert.deepEqual(received, {
    url: '/v1beta/models/gemini%20image%2Ftest:generateContent?key=fake%20%26%20key',
    method: 'POST',
    body: {
      contents: [{ role: 'user', parts: [{ text: 'Paint a banana' }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '16:9' },
      },
    },
  })
  assert.equal(result.provider, 'gemini-compatible')
  assert.equal(result.model, config.profiles['gemini-compatible'].model)
  assert.equal(result.text, 'Here is your image.')
  assert.deepEqual(result.images, [
    { mimeType: 'image/webp', base64Data: 'aW1hZ2Ux' },
    { mimeType: 'image/jpeg', base64Data: 'aW1hZ2Uy' },
    { mimeType: 'image/png', base64Data: 'aW1hZ2Uz' },
  ])
  assert.ok(Number.isFinite(Date.parse(result.createdAt)))
})

for (const provider of providers) {
  test(`${provider}: malformed successful responses are BAD_RESPONSE`, async (t) => {
    let body = ''
    const origin = await startProvider(t, (_request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(body)
    })
    const config = makeConfig(origin, provider)
    const malformedShapes = provider === 'openai-compatible'
      ? [{ data: {} }, { data: [null, 42, { b64_json: 42 }, { url: ' ' }] }]
      : [{ candidates: [{ content: { parts: {} } }] },
        { candidates: [{ content: { parts: [null, 42, { inlineData: { data: 42 } }] } }] }]
    for (const value of [null, [], {}, ...malformedShapes]) {
      body = JSON.stringify(value)
      await assert.rejects(generateImageWithProvider({ prompt: 'test', config }),
        checkAppError({ code: 'BAD_RESPONSE', status: 200, retryable: false }))
    }
    body = '{invalid JSON'
    await assert.rejects(generateImageWithProvider({ prompt: 'test', config }),
      checkAppError({ code: 'BAD_RESPONSE', status: 200, retryable: false }))
    body = JSON.stringify({ error: { message: 'Provider refused content' } })
    await assert.rejects(generateImageWithProvider({ prompt: 'test', config }),
      checkAppError({ code: 'BAD_RESPONSE', message: 'Provider refused content' }))
  })

  test(`${provider}: provider HTTP errors keep status, details and retry policy`, async (t) => {
    let status = 401
    let body = JSON.stringify({ error: { message: 'Invalid test key', code: 'invalid_key' } })
    let contentType = 'application/json'
    const origin = await startProvider(t, (_request, response) => {
      response.writeHead(status, { 'Content-Type': contentType })
      response.end(body)
    })
    const config = makeConfig(origin, provider)
    await assert.rejects(generateImageWithProvider({ prompt: 'test', config }), (error: unknown) => {
      checkAppError({ code: 'AUTH', status: 401, message: 'Invalid test key', retryable: false })(error)
      assert.ok(isAppError(error))
      assert.match(error.details ?? '', /invalid_key/)
      assert.match(error.details ?? '', /HTTP 401/)
      assert.match(error.details ?? '', /Method: POST/)
      return true
    })

    status = 429
    body = 'Too many test requests'
    contentType = 'text/plain'
    await assert.rejects(generateImageWithProvider({ prompt: 'test', config }),
      checkAppError({ code: 'RATE_LIMIT', status, message: body, retryable: true }))

    status = 503
    body = '<html><title>Mock upstream unavailable</title></html>'
    contentType = 'text/html'
    await assert.rejects(generateImageWithProvider({ prompt: 'test', config }),
      checkAppError({ code: 'NETWORK', status, message: 'Mock upstream unavailable', retryable: true }))
  })

  test(`${provider}: disconnected local provider becomes a retryable NETWORK error`, async (t) => {
    const origin = await startProvider(t, (request) => request.socket.destroy())
    const config = makeConfig(origin, provider)
    await assert.rejects(generateImageWithProvider({ prompt: 'test', config }),
      checkAppError({ code: 'NETWORK', retryable: true }))
  })
}

test('pure previews mask credentials, preserve endpoint variants and reuse request options', () => {
  const config = makeConfig('http://127.0.0.1:12345', 'openai-compatible')
  const profile = config.profiles['openai-compatible']
  for (const baseUrl of ['http://127.0.0.1:12345', 'http://127.0.0.1:12345/v1/',
    'http://127.0.0.1:12345/v1/images/generations/']) {
    profile.baseUrl = baseUrl
    const preview = buildRequestPreview(config)
    assert.equal(preview.endpoint, 'http://127.0.0.1:12345/v1/images/generations')
    assert.equal(preview.headersPreview.Authorization, 'Bearer ***')
    assert.deepEqual(preview.bodyPreview, {
      model: 'image-model', size: '1024x1024',
      quality: 'high', n: 2, background: 'auto', output_format: 'png', moderation: 'auto',
    })
    assert.ok(!JSON.stringify(preview).includes(profile.apiKey.trim()))
  }
  profile.apiKey = ''
  assert.equal(buildRequestPreview(config).headersPreview.Authorization, 'Bearer [API_KEY]')

  config.activeProvider = 'gemini-compatible'
  const gemini = config.profiles['gemini-compatible']
  gemini.baseUrl = 'http://127.0.0.1:12345/models/custom:generateContent?region=test'
  gemini.params.imageOnly = true
  const preview = buildRequestPreview(config)
  assert.equal(preview.endpoint, `${gemini.baseUrl}&key=***`)
  assert.deepEqual(preview.bodyPreview, {
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } },
  })
  assert.ok(!JSON.stringify(preview).includes('fake'))
  gemini.apiKey = ''
  assert.equal(buildRequestPreview(config).endpoint, `${gemini.baseUrl}&key=%5BAPI_KEY%5D`)
})

test('unsupported providers and invalid endpoint configuration fail before network access', async () => {
  const config = makeConfig('http://127.0.0.1:12345', 'toString' as ProviderType)
  await assert.rejects(generateImageWithProvider({ prompt: 'test', config }),
    checkAppError({ code: 'UNSUPPORTED', retryable: false }))
  assert.throws(() => buildRequestPreview(config), checkAppError({ code: 'UNSUPPORTED' }))

  for (const provider of providers) {
    config.activeProvider = provider
    config.profiles[provider].baseUrl = ' '
    await assert.rejects(generateImageWithProvider({ prompt: 'test', config }),
      checkAppError({ code: 'VALIDATION', retryable: false }))
  }
})

test('model catalog builds only supported Gemini options and matches the preview', () => {
  const config = createDefaultProviderConfig()
  config.activeProvider = 'gemini-compatible'
  const profile = config.profiles['gemini-compatible']
  profile.apiKey = 'test-key'
  for (const model of GEMINI_IMAGE_MODELS) {
    profile.model = model.id
    profile.params = normalizeGeminiParams(model.id, { imageSize: '4K', aspectRatio: '1:8', thinkingLevel: 'medium', imageOnly: true })
    const generationConfig = buildGeminiRequestBody(profile, 'test').generationConfig
    assert.deepEqual(generationConfig.responseModalities, ['IMAGE'])
    assert.equal(generationConfig.imageConfig.imageSize, model.imageSizes.length ? profile.params.imageSize : undefined)
    assert.equal(generationConfig.thinkingConfig?.thinkingLevel, model.id === 'gemini-nano-banana-2.1' ? 'MEDIUM' : undefined)
    assert.deepEqual(buildRequestPreview(config).bodyPreview, { generationConfig })
    assert.doesNotThrow(() => parseTaskRequest({ id: '11111111-1111-4111-8111-111111111111', prompt: 'test', config }))
  }
  profile.model = 'gemini-3.1-flash-image'
  profile.params = { imageSize: '512', aspectRatio: '1:8', thinkingLevel: 'minimal', imageOnly: false }
  assert.deepEqual(buildGeminiRequestBody(profile, 'test').generationConfig, {
    responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: '512', aspectRatio: '1:8' }, thinkingConfig: { thinkingLevel: 'MINIMAL' },
  })
  profile.params.aspectRatio = 'auto'
  profile.params.thinkingLevel = 'auto'
  assert.deepEqual(buildGeminiRequestBody(profile, 'test').generationConfig, {
    responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: '512' },
  })
  assert.deepEqual(getGeminiModel('gemini-3.1-flash-lite-image').imageSizes, ['1K'])
  assert.deepEqual(getGeminiModel('gemini-2.5-flash-image').imageSizes, [])
})

test('model catalog enforces GPT sizes, quality tiers and request fields', () => {
  const config = createDefaultProviderConfig()
  const profile = config.profiles['openai-compatible']
  profile.apiKey = 'test-key'
  for (const model of OPENAI_IMAGE_MODELS) {
    profile.model = model.id
    profile.params = normalizeOpenAIParams(model.id, { size: '3840x2160', quality: 'max', n: 10, outputFormat: 'webp', background: 'transparent', outputCompression: 0 })
    const body = buildOpenAIRequestBody(profile, ' test ')
    assert.equal(body.size, model.flexibleSize ? '3840x2160' : '1024x1024')
    assert.equal(body.quality, model.id.startsWith('gpt-image-2.5-') ? 'max' : 'auto')
    assert.equal(body.output_compression, 0)
    assert.equal(body.background, 'transparent')
    assert.equal(body.prompt, 'test')
    for (const absent of ['response_format', 'aspect_ratio', 'style']) assert.ok(!(absent in body))
    assert.doesNotThrow(() => parseTaskRequest({ id: '11111111-1111-4111-8111-111111111111', prompt: 'test', config }))
  }
  for (const size of ['auto', '1536x864', '2048x2048', '3840x2160', '2160x3840', '1024x640']) {
    assert.equal(isOpenAISizeSupported('gpt-image-2', size), true, size)
  }
  for (const size of ['512x512', '4096x4096', '3840x3840', '1025x1024', '3072x640', '1024x624', '0x1024']) {
    assert.equal(isOpenAISizeSupported('gpt-image-2', size), false, size)
  }
  assert.equal(isOpenAISizeSupported('gpt-image-1.5', '2048x2048'), false)
  assert.equal(isOpenAISizeSupported('gpt-image-2.5-flare-2026-09-08', '2048x2048'), true)
  profile.params.size = '1536x864'
  assert.equal(resolveExpectedAspectRatio(config), '16:9')
})

test('model validation rejects incompatible choices instead of quietly submitting defaults', () => {
  const config = createDefaultProviderConfig()
  const openai = config.profiles['openai-compatible']
  openai.apiKey = 'test-key'
  openai.model = 'gpt-image-2'
  const body = { id: '11111111-1111-4111-8111-111111111111', prompt: 'test', config }
  const valid = { ...openai.params }
  for (const patch of [
    { size: '512x512' }, { size: '4096x4096' }, { quality: 'max' },
    { outputFormat: 'jpeg', background: 'transparent' }, { outputCompression: 101 },
    { outputCompression: 2.5 }, { n: 0 }, { n: 11 }, { n: 1.5 },
  ] as const) {
    openai.params = { ...valid, ...patch }
    assert.throws(() => parseTaskRequest(body), checkAppError({ code: 'VALIDATION', status: 400 }))
  }
  openai.params = valid
  config.activeProvider = 'gemini-compatible'
  const gemini = config.profiles['gemini-compatible']
  gemini.apiKey = 'test-key'
  for (const [model, patch] of [
    ['gemini-3-pro-image', { imageSize: '512' }],
    ['gemini-3-pro-image', { thinkingLevel: 'high' }],
    ['gemini-3-pro-image', { aspectRatio: '1:8' }],
    ['gemini-3.1-flash-image', { thinkingLevel: 'medium' }],
    ['gemini-3.1-flash-lite-image', { imageSize: '2K' }],
    ['gemini-2.5-flash-image', { imageSize: '4K' }],
    ['gemini-2.5-flash-image', { thinkingLevel: 'minimal' }],
  ] as const) {
    gemini.model = model
    gemini.params = { imageSize: '1K', aspectRatio: '1:1', thinkingLevel: 'auto', imageOnly: false, ...patch }
    assert.throws(() => parseTaskRequest(body), checkAppError({ code: 'VALIDATION', status: 400 }))
  }
})

test('OpenAI output formats control compression and returned MIME types', async (t) => {
  let received: Record<string, unknown> = {}
  const responseOptions: { output_format?: string } = {}
  const origin = await startProvider(t, (request, response) => {
    void readBody(request).then((body) => {
      received = body as Record<string, unknown>
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ ...responseOptions, data: [{ b64_json: 'aW1hZ2U=' }] }))
    }).catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined))
  })
  const config = makeConfig(origin, 'openai-compatible')
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    config.profiles['openai-compatible'].params.outputFormat = format
    config.profiles['openai-compatible'].params.outputCompression = 75
    const result = await generateImageWithProvider({ prompt: 'test', config })
    assert.equal(received.output_format, format)
    assert.equal(received.output_compression, format === 'png' ? undefined : 75)
    assert.equal(result.images[0].mimeType, `image/${format}`)
  }
  responseOptions.output_format = 'jpeg'
  assert.equal((await generateImageWithProvider({ prompt: 'test', config })).images[0].mimeType, 'image/jpeg')
})

test('saved model configs migrate legacy parameters without losing keys or compatible aliases', (t) => {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, name, { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    } })
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    })
  }
  const config = createDefaultProviderConfig()
  config.profiles['openai-compatible'].apiKey = 'keep-openai'
  config.profiles['gemini-compatible'].apiKey = 'keep-gemini'
  config.profiles['gemini-compatible'].model = 'gemini-3.1-flash-image-preview'
  const oldConfig = {
    ...config, profiles: { ...config.profiles, 'openai-compatible': {
      ...config.profiles['openai-compatible'], params: { size: '1024x1024', quality: 'hd', n: 2, aspectRatio: '16:9' },
    } },
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 2, config: oldConfig }))
  const loaded = loadPersistedConfig()!
  assert.equal(loaded.profiles['openai-compatible'].params.quality, 'high')
  assert.equal(loaded.profiles['openai-compatible'].params.outputFormat, 'png')
  assert.equal(loaded.profiles['openai-compatible'].params.outputCompression, 100)
  assert.ok(!('aspectRatio' in loaded.profiles['openai-compatible'].params))
  assert.equal(loaded.profiles['openai-compatible'].apiKey, 'keep-openai')
  assert.equal(loaded.profiles['gemini-compatible'].apiKey, 'keep-gemini')
  assert.equal(loaded.profiles['gemini-compatible'].model, 'gemini-3.1-flash-image')
  loaded.profiles['gemini-compatible'].baseUrl = 'https://example.com/v1beta'
  loaded.profiles['gemini-compatible'].model = 'gemini-3.1-flash-image-preview'
  savePersistedConfig(loaded)
  assert.deepEqual(loadPersistedConfig(), loaded)
  const legacyRequest = parseTaskRequest({ id: '11111111-1111-4111-8111-111111111111', prompt: 'test', config: oldConfig })
  assert.equal(legacyRequest.request.config.profiles['openai-compatible'].params.quality, 'high')
  assert.equal(normalizeOpenAIParams('gpt-image-1.5', { outputFormat: 'jpeg', background: 'transparent' }).background, 'auto')
})

test('reference images route GPT to multipart edits and Gemini to inlineData without leaking previews', async (t) => {
  const referenceImages: ReferenceImage[] = [
    { name: 'first.png', mimeType: 'image/png', base64Data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7mQAAAAASUVORK5CYII=' },
    { name: 'second.jpg', mimeType: 'image/jpeg', base64Data: '/9j/2Q==' },
  ]
  let receivedUrl = ''
  let receivedAuth: string | undefined
  let form: FormData | undefined
  let json: unknown
  const origin = await startProvider(t, (request, response) => {
    void (async () => {
      receivedUrl = request.url ?? ''
      receivedAuth = request.headers.authorization
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const bytes = Buffer.concat(chunks)
      const contentType = request.headers['content-type'] ?? ''
      if (contentType.startsWith('multipart/form-data; boundary=')) {
        form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData()
      } else {
        json = JSON.parse(bytes.toString('utf8'))
      }
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(request.url?.includes(':generateContent')
        ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }] } }] }
        : { data: [{ b64_json: 'aW1hZ2U=' }] }))
    })().catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined))
  })
  const config = makeConfig(origin, 'openai-compatible')
  config.profiles['openai-compatible'].model = 'gpt-image-2.5-sunburst'
  config.profiles['openai-compatible'].params.size = '3840x2160'
  for (const suffix of ['', '/v1/', '/v1/images/generations/', '/v1/images/edits']) {
    config.profiles['openai-compatible'].baseUrl = origin + suffix
    await generateImageWithProvider({ prompt: ' keep the first subject, use the second style ', config, referenceImages })
    assert.equal(receivedUrl, '/v1/images/edits')
    assert.equal(receivedAuth, 'Bearer fake-key')
    assert.ok(form)
    assert.equal(form.get('prompt'), 'keep the first subject, use the second style')
    assert.equal(form.get('model'), 'gpt-image-2.5-sunburst')
    assert.equal(form.get('size'), '3840x2160', '4K landscape size must survive normalization and multipart encoding')
    assert.equal(form.get('n'), '2')
    assert.equal(form.get('output_format'), 'png')
    for (const absent of ['moderation', 'response_format', 'input_fidelity']) assert.equal(form.has(absent), false)
    const files = form.getAll('image[]') as File[]
    assert.equal(files.length, 2)
    for (const [index, file] of files.entries()) {
      assert.equal(file.type, referenceImages[index].mimeType)
      assert.equal(Buffer.from(await file.arrayBuffer()).toString('base64'), referenceImages[index].base64Data)
    }
    const preview = buildRequestPreview(config, referenceImages)
    assert.equal(preview.endpoint, origin + '/v1/images/edits')
    assert.match(preview.headersPreview['Content-Type'], /multipart/)
    assert.equal(preview.bodyPreview.size, '3840x2160')
    assert.ok(!('moderation' in preview.bodyPreview))
    assert.ok(!JSON.stringify(preview).includes(referenceImages[0].base64Data))
    assert.equal(buildRequestPreview(config).endpoint, origin + '/v1/images/generations')
  }
  config.activeProvider = 'gemini-compatible'
  await generateImageWithProvider({ prompt: 'edit these', config, referenceImages })
  assert.deepEqual(json, {
    contents: [{ role: 'user', parts: [
      { text: 'edit these' },
      ...referenceImages.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.base64Data } })),
    ] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } },
  })
  const preview = buildRequestPreview(config, referenceImages)
  assert.match(preview.endpoint, /:generateContent/)
  assert.ok(!JSON.stringify(preview).includes(referenceImages[0].base64Data))
})

test('output size diagnostics distinguish requested dimensions from decoded originals without treating auto as square', () => {
  assert.equal(getOutputSizeWarning('3840x2160', '16:9', 3840, 2160), null)
  assert.match(getOutputSizeWarning('3840x2160', '16:9', 1254, 1254) ?? '', /请求 3840 × 2160，实际原图 1254 × 1254/)
  assert.ok(getOutputSizeWarning('3840x2160', '16:9', 1920, 1080), 'matching ratio is not the same as matching pixel dimensions')
  assert.ok(getOutputSizeWarning('3840x2160', '16:9', 2160, 3840), 'orientation must be preserved')
  assert.equal(getOutputSizeWarning('auto', '1:1', 1920, 1080), null)
  assert.equal(getOutputSizeWarning(undefined, '16:9', 1920, 1080), null)
  assert.match(getOutputSizeWarning(undefined, '16:9', 1254, 1254) ?? '', /请求比例 16:9/)
  assert.equal(getOutputSizeWarning(undefined, '1:1', 1920, 1080), null, 'legacy tasks did not distinguish auto from square')
  assert.equal(getOutputSizeWarning('3840x2160', '16:9', 0, 0), null)
})

test('reference image validation rejects malformed, mismatched and oversized uploads', () => {
  const limits = getReferenceImageLimits('gemini-compatible', 'gemini-nano-banana-2.1')
  const image: ReferenceImage = { name: 'image.png', mimeType: 'image/png', base64Data: 'iVBORw0KGgo=' }
  assert.deepEqual(parseReferenceImages(undefined, limits), [])
  assert.deepEqual(parseReferenceImages([{ ...image, ignored: 'not persisted' }], limits), [image])
  for (const value of [
    null, {}, [null], Array(15).fill(image), [{ ...image, name: '' }],
    [{ ...image, mimeType: 'image/svg+xml' }], [{ ...image, mimeType: 'image/jpeg' }],
    [{ ...image, base64Data: '' }], [{ ...image, base64Data: 'not-base64' }],
    [{ ...image, base64Data: 'iVBORw0KGgp=' }], // Noncanonical padding bits.
    [{ ...image, base64Data: 'data:image/png;base64,' + image.base64Data }],
    [{ ...image, base64Data: Buffer.from('<script>bad</script>').toString('base64') }],
    [{ ...image, base64Data: 'A'.repeat(Math.ceil(limits.maxImageBytes / 3) * 4 + 4) }],
  ]) assert.throws(() => parseReferenceImages(value, limits), checkAppError({ code: 'VALIDATION', status: 400 }))
  const large = Buffer.alloc(5 * 1024 * 1024)
  Buffer.from(image.base64Data, 'base64').copy(large)
  const largeImage = { ...image, base64Data: large.toString('base64') }
  // Previously rejected 5 MiB files / 10 MiB total are accepted; 15 MiB still exceeds Gemini's inline budget.
  assert.equal(parseReferenceImages([largeImage, largeImage], limits).length, 2)
  assert.throws(() => parseReferenceImages([largeImage, largeImage, largeImage], limits), checkAppError({ code: 'VALIDATION', status: 400 }))
  const config = makeConfig('http://localhost:12345', 'openai-compatible')
  const input = { id: '11111111-1111-4111-8111-111111111111', prompt: 'test', config }
  assert.deepEqual(parseTaskRequest({ ...input, referenceImages: [image] }).request.referenceImages, [image])
  assert.throws(() => parseTaskRequest({ ...input, referenceImages: [{ ...image, mimeType: 'text/html' }] }), checkAppError({ code: 'VALIDATION', status: 400 }))
  assert.ok(!('referenceImages' in parseTaskRequest(input).request))
})

test('reference limits follow the selected model on client preflight and server submission', () => {
  const MiB = 1024 * 1024
  const config = makeConfig('http://localhost:12345', 'openai-compatible')
  const image: ReferenceImage = { name: 'image.png', mimeType: 'image/png', base64Data: 'iVBORw0KGgo=' }
  const input = { id: '11111111-1111-4111-8111-111111111111', prompt: 'test', config }
  for (const [provider, model, count, single, total] of [
    ['openai-compatible', 'gpt-image-2.5-flare', 16, 20, 32],
    ['openai-compatible', 'gpt-image-1.5', 16, 20, 32],
    ['gemini-compatible', 'gemini-nano-banana-2.1', 14, 12, 12],
    ['gemini-compatible', 'gemini-3.1-flash-image', 14, 12, 12],
    ['gemini-compatible', 'gemini-3.1-flash-lite-image', 14, 12, 12],
    ['gemini-compatible', 'gemini-3-pro-image-preview', 14, 12, 12],
    ['gemini-compatible', 'gemini-2.5-flash-image', 3, 12, 12],
    ['gemini-compatible', 'custom-unknown', 3, 12, 12],
  ] as const) {
    const limits = getReferenceImageLimits(provider, model)
    assert.deepEqual([limits.maxImages, limits.maxImageBytes, limits.maxTotalBytes], [count, single * MiB, total * MiB])
    assert.equal(getReferenceImageLimitError(Array(count).fill(1024), limits), null)
    assert.ok(getReferenceImageLimitError(Array(count + 1).fill(1024), limits))
    assert.equal(getReferenceImageLimitError([single * MiB], limits), null)
    assert.ok(getReferenceImageLimitError([single * MiB + 1], limits))
    assert.equal(getReferenceImageLimitError([total * MiB / 2, total * MiB / 2], limits), null)
    assert.ok(getReferenceImageLimitError([total * MiB / 2, total * MiB / 2, 1], limits))
    config.activeProvider = provider
    config.profiles[provider].model = model
    assert.equal(parseTaskRequest({ ...input, referenceImages: Array(count).fill(image) }).request.referenceImages?.length, count)
    assert.throws(() => parseTaskRequest({ ...input, referenceImages: Array(count + 1).fill(image) }), checkAppError({ code: 'VALIDATION', status: 400 }))
  }
  assert.ok(MAX_TASK_BODY_BYTES > Math.ceil(32 * MiB / 3) * 4 + 64 * 1024)
  assert.ok(Math.ceil(12 * MiB / 3) * 4 + 64 * 1024 < 20_000_000)
})

test('reference file drops preserve local file order and reject directories or remote links', () => {
  const first = new File(['first'], 'first.png', { type: 'image/png' })
  const second = new File(['second'], 'second.webp', { type: 'image/webp' })
  const transfer = (files: File[], items: unknown[]) => ({ files, items }) as unknown as Pick<DataTransfer, 'files' | 'items'>
  assert.deepEqual(getDroppedReferenceFiles(transfer([first, second], [{ kind: 'file' }, { kind: 'file' }])), [first, second])
  assert.throws(() => getDroppedReferenceFiles(transfer([], [{ kind: 'string', type: 'text/uri-list' }])), checkAppError({ code: 'VALIDATION' }))
  assert.throws(() => getDroppedReferenceFiles(transfer([first], [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }])), checkAppError({ code: 'VALIDATION' }))
})

test('backend timeout configuration defaults, rounds and clamps independently of Vite', (t) => {
  restoreTimeout(t)
  for (const [value, expected] of [
    [undefined, 180_000], ['', 180_000], ['invalid', 180_000], ['Infinity', 180_000],
    ['0', 15_000], ['-1', 15_000], ['20000.6', 20_001], ['600001', 600_000],
  ] as const) {
    if (value === undefined) delete process.env.IMAGE_REQUEST_TIMEOUT_MS
    else process.env.IMAGE_REQUEST_TIMEOUT_MS = value
    assert.equal(getImageRequestTimeoutMs(), expected)
  }
})

test('both Node adapters classify real aborts as timeouts, including a stalled JSON body',
  { timeout: 30_000 }, async (t) => {
    restoreTimeout(t)
    process.env.IMAGE_REQUEST_TIMEOUT_MS = '1' // The backend must clamp this to 15 seconds.
    const origin = await startProvider(t, (request, response) => {
      if (request.url?.includes(':generateContent')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.write('{"candidates":')
      }
      // Leave OpenAI waiting for headers and Gemini waiting for the rest of its body.
    })
    await Promise.all(providers.map((provider) => assert.rejects(
      generateImageWithProvider({ prompt: 'test', config: makeConfig(origin, provider) }),
      (error: unknown) => {
        checkAppError({ code: 'NETWORK', retryable: true })(error)
        assert.ok(isAppError(error))
        assert.match(error.message, /请求超时（15秒）/)
        return true
      },
    )))
  })
