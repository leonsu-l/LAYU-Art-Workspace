import { StudioCache } from './studioCache.ts'
let cache = new StudioCache()
export function getStudioCache() { return cache }
let userId = ''
let epoch = 0
const controllers = new Set<AbortController>()
export function getSessionUserId(): string { return userId }
export function getSessionEpoch(): number { return epoch }
export function trackRequest(controller: AbortController): () => void {
  controllers.add(controller)
  return () => controllers.delete(controller)
}
export function changeSessionScope(id: string): void {
  cache.clear()
  cache = new StudioCache()
  epoch += 1
  userId = id
  controllers.forEach((controller) => controller.abort())
  controllers.clear()
}
export function userStorageKey(key: string): string { return `${key}.user.${userId || 'anonymous'}` }
