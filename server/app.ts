import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { createAppError, isAppError } from '../src/utils/errors.ts'
import type { TaskStore } from './taskStore.ts'
import { parseImageIds, parseTaskRequest, UUID_PATTERN } from './validation.ts'
import { MAX_TASK_BODY_BYTES } from '../src/utils/referenceImages.ts'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const MAX_BODY_BYTES = 64 * 1024
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

export function createApplication(source: TaskStore | (() => TaskStore | undefined), distDirectory: string) {
  const dist = resolve(distDirectory)
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (response.destroyed) return
      const normalized = isAppError(error) ? error : createAppError('UNKNOWN', '后端处理失败，请检查服务日志与磁盘状态。', true, 500)
      sendJson(response, normalized.status && normalized.status >= 400 ? normalized.status : 500, { error: normalized })
    })
  })
  server.requestTimeout = 30_000

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    response.setHeader('Cache-Control', 'no-store')
    assertLocalRequest(request)
    const store = typeof source === 'function' ? source() : source
    if (!store) throw createAppError('UNKNOWN', '后端正在初始化，请稍后重试。', true, 503)
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
    const path = url.pathname
    const method = request.method ?? 'GET'
    if (method === 'GET' && path === '/api/health') {
      sendJson(response, 200, { ok: true })
      return
    }
    if (method === 'GET' && path === '/api/tasks') {
      sendJson(response, 200, { tasks: store.listTasks() })
      return
    }
    if (method === 'POST' && path === '/api/tasks') {
      const { id, request: generationRequest } = parseTaskRequest(await readJson(request, MAX_TASK_BODY_BYTES))
      // Commit first, acknowledge second. Work is independent of the HTTP connection.
      const task = await store.create(id, generationRequest)
      sendJson(response, 202, { task })
      return
    }
    const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/)
    if (method === 'GET' && taskMatch) {
      const task = store.getTask(taskMatch[1])
      if (!task) {
        if (store.isTaskDeleted(taskMatch[1])) throw createAppError('VALIDATION', '此任务已删除，不能恢复或重放原请求。', false, 410)
        notFound()
      }
      sendJson(response, 200, { task })
      return
    }
    if (method === 'DELETE' && taskMatch && UUID_PATTERN.test(taskMatch[1])) {
      sendJson(response, 200, await store.deleteTask(taskMatch[1]))
      return
    }
    if (method === 'GET' && path === '/api/gallery') {
      sendJson(response, 200, { images: store.listImages() })
      return
    }
    if (method === 'GET' && path === '/api/gallery/stats') {
      const images = store.listImages()
      sendJson(response, 200, { totalBytes: images.reduce((sum, image) => sum + image.bytes, 0), imageCount: images.length })
      return
    }
    const imageMatch = path.match(/^\/api\/gallery\/([^/]+)$/)
    if (method === 'DELETE' && imageMatch && UUID_PATTERN.test(imageMatch[1])) {
      sendJson(response, 200, { deletedCount: await store.deleteImages([imageMatch[1]]) })
      return
    }
    if (method === 'POST' && path === '/api/gallery/delete') {
      const ids = parseImageIds(await readJson(request))
      sendJson(response, 200, { deletedCount: await store.deleteImages(ids) })
      return
    }
    if (method === 'GET' && path.startsWith('/api/images/')) {
      const image = store.getImage(path)
      if (!image) notFound()
      const bytes = await store.images.read(image)
      response.setHeader('Content-Type', image.mimeType)
      response.setHeader('Content-Length', bytes.length)
      response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
      response.end(bytes)
      return
    }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) notFound()
    let decoded: string
    try {
      decoded = decodeURIComponent(path)
    } catch {
      throw createAppError('VALIDATION', 'URL 编码无效。', false, 400)
    }
    if (decoded.includes('\0') || decoded.includes('\\')) notFound()
    const target = resolve(dist, `.${decoded}`)
    if (target !== dist && !target.startsWith(`${dist}${sep}`)) notFound()
    const file = extname(target) ? target : resolve(dist, 'index.html')
    try {
      const contents = await readFile(file)
      response.setHeader('Content-Type', MIME_TYPES[extname(file)] ?? 'application/octet-stream')
      response.setHeader('Content-Length', contents.length)
      response.end(method === 'HEAD' ? undefined : contents)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      throw createAppError('UNKNOWN', '页面不存在。生产运行前请先执行 npm run build；开发时请访问 Vite 地址。', false, 404)
    }
  }
  return server
}

function assertLocalRequest(request: IncomingMessage): void {
  let host: URL
  try {
    host = new URL(`http://${request.headers.host ?? ''}`)
  } catch {
    throw createAppError('AUTH', '无效的 Host。', false, 403)
  }
  // The initial backend is deliberately local-only: no unauthenticated LAN/public proxy.
  if (!LOCAL_HOSTS.has(host.hostname) || host.username || host.password) {
    throw createAppError('AUTH', '此后端仅允许本机访问。', false, 403)
  }
  const origin = request.headers.origin
  if (origin) {
    let allowed = false
    try {
      const parsed = new URL(origin)
      allowed = ['http:', 'https:'].includes(parsed.protocol) && LOCAL_HOSTS.has(parsed.hostname)
    } catch { /* Reject opaque or malformed origins. */ }
    if (!allowed) throw createAppError('AUTH', '拒绝来自外部站点的请求。', false, 403)
  }
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw createAppError('AUTH', '拒绝跨站请求。', false, 403)
  }
}

async function readJson(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw createAppError('VALIDATION', '请求必须使用 application/json。', false, 415)
  }
  const chunks: Buffer[] = []
  let length = 0
  let tooLarge = Number(request.headers['content-length']) > maxBytes
  for await (const chunk of request) {
    length += chunk.length
    if (tooLarge || length > maxBytes) {
      tooLarge = true
      chunks.length = 0
      // Drain without retaining more bytes. Closing mid-upload can hide the 413 behind ECONNRESET.
      // The server's requestTimeout still bounds clients that never finish uploading.
      continue
    }
    chunks.push(Buffer.from(chunk))
  }
  if (tooLarge) throw createAppError('VALIDATION', `请求体不能超过 ${maxBytes / 1024} KiB。`, false, 413)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw createAppError('VALIDATION', '请求体不是合法 JSON。', false, 400)
  }
}

function notFound(): never {
  throw createAppError('VALIDATION', '未找到请求的任务、图片或接口。', false, 404)
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed) return
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}
