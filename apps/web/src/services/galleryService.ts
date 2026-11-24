import type { GalleryStorageStats, ServerGalleryImage } from '@nanobanana/shared/types/generation'
import { backendErrorMessage, backendRequest } from './backendClient.ts'
export type GalleryItem = ServerGalleryImage & { source: 'server'; key: string }
export interface GallerySnapshot { images: GalleryItem[]; retentionDays: number | null; hasRetentionPolicy: boolean; browserError: string | null; serverError: string | null }
export interface GalleryStorageSummary { browser: GalleryStorageStats | null; server: GalleryStorageStats | null; browserError: string | null; serverError: string | null }
type GalleryResponse = { images: ServerGalleryImage[]; retentionDays: number | null }
export function parseGalleryResponse(response: GalleryResponse): GallerySnapshot {
  if (!Array.isArray(response.images)) throw new Error('图库响应格式错误。')
  return {
    images: response.images.map(image => ({ ...image, source: 'server', key: 'server:' + image.id })),
    retentionDays: response.retentionDays, hasRetentionPolicy: true, browserError: null, serverError: null,
  }
}
export async function loadGallery(previous?: Pick<GallerySnapshot, 'images' | 'retentionDays'>, signal?: AbortSignal): Promise<GallerySnapshot> {
  try {
    return parseGalleryResponse(await backendRequest<GalleryResponse>('/gallery', { signal }))
  } catch (error) {
    return { images: previous?.images ?? [], retentionDays: previous?.retentionDays ?? null,
      hasRetentionPolicy: Boolean(previous), browserError: null, serverError: backendErrorMessage(error) }
  }
}
export async function getGalleryStorageSummary(signal?: AbortSignal): Promise<GalleryStorageSummary> {
  try { return { browser: null, server: await backendRequest<GalleryStorageStats>('/gallery/stats', { signal }), browserError: null, serverError: null } }
  catch (e) { return { browser: null, server: null, browserError: null, serverError: backendErrorMessage(e) } }
}
export async function deleteGalleryItem(image: GalleryItem): Promise<void> {
  if (image.source !== 'server') throw new Error('旧图库不属于当前账号。')
  await backendRequest(`/gallery/${encodeURIComponent(image.id)}`, { method: 'DELETE' })
}
export async function deleteGalleryItems(images: GalleryItem[]): Promise<number> {
  return (await backendRequest<{ deletedCount: number }>('/gallery/delete', { method: 'POST', body: JSON.stringify({ ids: images.filter((image) => image.source === 'server').map((image) => image.id) }) })).deletedCount
}
export function downloadGalleryItem(image: GalleryItem): void {
  if (image.source !== 'server') return
  const anchor = document.createElement('a'); anchor.href = image.url
  anchor.download = `${image.model.replace(/[^a-z0-9-_]+/gi, '-')}-${image.id}.${image.mimeType.includes('jpeg') ? 'jpg' : image.mimeType.split('/')[1] || 'png'}`
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
}
