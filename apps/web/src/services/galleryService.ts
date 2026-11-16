import type { GalleryImageRecord, GalleryStorageStats, ServerGalleryImage } from '@nanobanana/shared/types/generation'
import { backendErrorMessage, backendRequest } from './backendClient'
// Keep the view's discriminant while accepting server records only; legacy IndexedDB is never opened.
export type GalleryItem = (GalleryImageRecord & { source: 'browser'; key: string }) | (ServerGalleryImage & { source: 'server'; key: string })
export interface GallerySnapshot { images: GalleryItem[]; browserError: string | null; serverError: string | null }
export interface GalleryStorageSummary { browser: GalleryStorageStats | null; server: GalleryStorageStats | null; browserError: string | null; serverError: string | null }
export async function loadGallery(previous: GalleryItem[] = [], signal?: AbortSignal): Promise<GallerySnapshot> {
  try {
    const response = await backendRequest<{ images: ServerGalleryImage[] }>('/gallery', { signal })
    if (!Array.isArray(response.images)) throw new Error('图库响应格式错误。')
    return { images: response.images.map((image) => ({ ...image, source: 'server', key: `server:${image.id}` })), browserError: null, serverError: null }
  } catch (e) { return { images: previous.filter((image) => image.source === 'server'), browserError: null, serverError: backendErrorMessage(e) } }
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
