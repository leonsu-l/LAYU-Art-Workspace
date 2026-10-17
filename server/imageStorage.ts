import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { GeneratedImage, GenerateImageResult, ServerGalleryImage } from '../src/types/generation.ts'
import { createAppError } from '../src/utils/errors.ts'

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const IMAGE_DOWNLOAD_TIMEOUT_MS = 60_000
const FORMATS = [
  { mime: 'image/png', extension: 'png', matches: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  { mime: 'image/jpeg', extension: 'jpg', matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', extension: 'gif', matches: (b: Buffer) => /^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii')) },
  { mime: 'image/webp', extension: 'webp', matches: (b: Buffer) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
]

export class ImageStorage {
  readonly directory: string

  constructor(dataDirectory: string) {
    this.directory = resolve(dataDirectory, 'images')
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
  }

  private pathFor(url: string): string {
    const filename = url.replace('/api/images/', '')
    if (!/^[0-9a-f-]{36}_[0-9a-f-]{36}\.(png|jpg|gif|webp)$/.test(filename)) throw new Error('Invalid stored image filename.')
    const path = resolve(this.directory, filename)
    if (!path.startsWith(`${this.directory}${sep}`)) throw new Error('Image path escapes data directory.')
    return path
  }

  async read(image: ServerGalleryImage): Promise<Buffer> {
    return readFile(this.pathFor(image.url))
  }

  async remove(images: ServerGalleryImage[]): Promise<void> {
    for (const image of images) {
      // Validate the resolved absolute path before unlinking any generated file.
      await unlink(this.pathFor(image.url)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }

  async save(result: GenerateImageResult, prompt: string, taskId: string): Promise<ServerGalleryImage[]> {
    if (!result.images.length || result.images.length > 10) {
      throw createAppError('BAD_RESPONSE', '供应商图片数量无效。', false)
    }
    const saved: ServerGalleryImage[] = []
    try {
      for (const image of result.images) {
        const bytes = await resolveImage(image)
        const format = FORMATS.find((entry) => entry.matches(bytes))
        if (!format) throw createAppError('BAD_RESPONSE', '供应商返回的内容不是支持的 PNG/JPEG/WebP/GIF 图片。', false)
        const id = randomUUID()
        const record: ServerGalleryImage = {
          id,
          createdAt: result.createdAt,
          provider: result.provider,
          model: result.model,
          prompt,
          mimeType: format.mime,
          bytes: bytes.byteLength,
          // Keep task association in the filename even if metadata cannot be written.
          url: `/api/images/${taskId}_${id}.${format.extension}`,
        }
        // Include this path in cleanup even if a disk write only partially succeeds.
        saved.push(record)
        await writeFile(this.pathFor(record.url), bytes, { flag: 'wx', mode: 0o600 })
      }
      return saved
    } catch (error) {
      await this.remove(saved).catch(() => console.error('Unable to remove incomplete generated images.'))
      throw error
    }
  }
}

async function resolveImage(image: GeneratedImage): Promise<Buffer> {
  if (image.base64Data) {
    const data = image.base64Data.replace(/\s/g, '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
      throw createAppError('BAD_RESPONSE', '图片 Base64 无效或超过 25 MiB。', false)
    }
    const bytes = Buffer.from(data, 'base64')
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw createAppError('BAD_RESPONSE', '图片为空或超过 25 MiB。', false)
    return bytes
  }
  if (!image.url) throw createAppError('BAD_RESPONSE', '供应商没有返回图片内容。', false)
  const url = new URL(image.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw createAppError('BAD_RESPONSE', '供应商图片 URL 无效。', false)
  }
  // Download immediately, without provider credentials: signed URLs may expire later.
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS) })
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw createAppError('BAD_RESPONSE', `下载供应商图片失败（HTTP ${response.status}）。`, true)
    }
    const chunks: Uint8Array[] = []
    let length = 0
    for await (const chunk of response.body) {
      length += chunk.byteLength
      if (length > MAX_IMAGE_BYTES) throw createAppError('BAD_RESPONSE', '供应商图片超过 25 MiB。', false)
      chunks.push(chunk)
    }
    if (!length) throw createAppError('BAD_RESPONSE', '供应商图片为空。', false)
    return Buffer.concat(chunks)
  } catch (error) {
    if (error && typeof error === 'object' && 'retryable' in error) throw error
    throw createAppError('NETWORK', '下载供应商图片失败或超时，生成结果未完整保存。', true)
  }
}
