import type { GalleryImageRecord, GalleryStorageStats, ServerGalleryImage } from '../types/generation'
import {
  deleteGalleryImage as deleteBrowserImage,
  deleteGalleryImages as deleteBrowserImages,
  downloadGalleryImage as downloadBrowserImage,
  getGalleryStorageStats,
  listGalleryImages,
} from '../utils/galleryDb'
import { backendErrorMessage, backendRequest } from './backendClient'

export type GalleryItem =
  | (GalleryImageRecord & { source: 'browser'; key: string })
  | (ServerGalleryImage & { source: 'server'; key: string })

export interface GallerySnapshot {
  images: GalleryItem[]
  browserError: string | null
  serverError: string | null
}

export interface GalleryStorageSummary {
  browser: GalleryStorageStats | null
  server: GalleryStorageStats | null
  browserError: string | null
  serverError: string | null
}

/** Load metadata, never download backend files or write new images into IndexedDB. */
export async function loadGallery(previous: GalleryItem[] = [], signal?: AbortSignal): Promise<GallerySnapshot> {
  const [browser, server] = await Promise.allSettled([
    listGalleryImages(),
    backendRequest<{ images: ServerGalleryImage[] }>('/gallery', { signal }).then((response) => {
      if (!Array.isArray(response.images)) throw new Error('后端图库响应格式错误。')
      return response.images
    }),
  ])
  const browserImages: GalleryItem[] = browser.status === 'fulfilled'
    ? browser.value.map((image) => ({ ...image, source: 'browser', key: `browser:${image.id}` }))
    : previous.filter((image) => image.source === 'browser')
  const serverImages: GalleryItem[] = server.status === 'fulfilled'
    ? server.value.map((image) => ({ ...image, source: 'server', key: `server:${image.id}` }))
    : previous.filter((image) => image.source === 'server')
  return {
    images: [...serverImages, ...browserImages].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    browserError: browser.status === 'rejected' ? backendErrorMessage(browser.reason) : null,
    serverError: server.status === 'rejected' ? backendErrorMessage(server.reason) : null,
  }
}

export async function getGalleryStorageSummary(signal?: AbortSignal): Promise<GalleryStorageSummary> {
  const [browser, server] = await Promise.allSettled([
    getGalleryStorageStats(),
    backendRequest<GalleryStorageStats>('/gallery/stats', { signal }),
  ])
  return {
    browser: browser.status === 'fulfilled' ? browser.value : null,
    server: server.status === 'fulfilled' ? server.value : null,
    browserError: browser.status === 'rejected' ? backendErrorMessage(browser.reason) : null,
    serverError: server.status === 'rejected' ? backendErrorMessage(server.reason) : null,
  }
}

export async function deleteGalleryItem(image: GalleryItem): Promise<void> {
  if (image.source === 'browser') return deleteBrowserImage(image.id)
  await backendRequest<{ deletedCount: number }>(`/gallery/${encodeURIComponent(image.id)}`, { method: 'DELETE' })
}

export async function deleteGalleryItems(images: GalleryItem[]): Promise<number> {
  const browserIds = images.filter((image) => image.source === 'browser').map((image) => image.id)
  const serverIds = images.filter((image) => image.source === 'server').map((image) => image.id)
  // Independent stores: a server outage must not prevent legacy browser deletion.
  const outcomes = await Promise.allSettled([
    browserIds.length ? deleteBrowserImages(browserIds) : Promise.resolve(0),
    serverIds.length ? backendRequest<{ deletedCount: number }>('/gallery/delete', {
      method: 'POST', body: JSON.stringify({ ids: serverIds }),
    }).then((response) => response.deletedCount) : Promise.resolve(0),
  ])
  let deletedCount = 0
  const errors: string[] = []
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') deletedCount += outcome.value
    else errors.push(`${index === 0 ? '浏览器' : '后端'}：${backendErrorMessage(outcome.reason)}`)
  })
  if (errors.length) throw new Error(`已删除 ${deletedCount} 张；${errors.join('；')}。请刷新确认其余图片。`)
  return deletedCount
}

export function downloadGalleryItem(image: GalleryItem): void {
  if (image.source === 'browser') return downloadBrowserImage(image)
  const anchor = document.createElement('a')
  anchor.href = image.url
  const extension = image.mimeType.includes('jpeg') ? 'jpg' : image.mimeType.split('/')[1] || 'png'
  anchor.download = `${image.model.replace(/[^a-z0-9-_]+/gi, '-')}-${image.id}.${extension}`
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
