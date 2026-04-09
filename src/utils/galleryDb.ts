import type {
    GalleryImageRecord,
    GallerySaveSummary,
    GalleryStorageStats,
    GenerateImageResult,
} from '../types/generation'

const DB_NAME = 'nanobanana-gallery-db'
const DB_VERSION = 1
const STORE_NAME = 'images'

let galleryDbPromise: Promise<IDBDatabase> | null = null

interface NewGalleryImageRecord {
    provider: GalleryImageRecord['provider']
    model: string
    prompt: string
    mimeType: string
    blob: Blob
}

export async function addGeneratedResultToGallery(
    result: GenerateImageResult,
    prompt: string,
): Promise<GallerySaveSummary> {
    const records: NewGalleryImageRecord[] = []

    for (const image of result.images) {
        try {
            const blob = await resolveImageBlob(image.base64Data, image.url, image.mimeType)
            if (!blob) {
                continue
            }

            records.push({
                provider: result.provider,
                model: result.model,
                prompt,
                mimeType: image.mimeType || blob.type || 'image/png',
                blob,
            })
        } catch {
            // Skip invalid image data and continue to keep successful entries.
        }
    }

    if (records.length === 0) {
        return {
            savedCount: 0,
            skippedCount: result.images.length,
        }
    }

    const savedCount = await addGalleryImages(records)

    return {
        savedCount,
        skippedCount: Math.max(0, result.images.length - savedCount),
    }
}

export async function listGalleryImages(): Promise<GalleryImageRecord[]> {
    const all = await withObjectStore('readonly', (store) =>
        requestToPromise<GalleryImageRecord[]>(store.getAll()),
    )

    return all
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function getGalleryStorageStats(): Promise<GalleryStorageStats> {
    const images = await listGalleryImages()
    const totalBytes = images.reduce((sum, item) => sum + item.bytes, 0)

    return {
        totalBytes,
        imageCount: images.length,
    }
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B'
    }

    const units = ['B', 'KB', 'MB', 'GB']
    let value = bytes
    let unitIndex = 0

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024
        unitIndex += 1
    }

    const fixed = unitIndex === 0 ? value.toFixed(0) : value.toFixed(2)
    return `${fixed} ${units[unitIndex]}`
}

export function downloadGalleryImage(record: GalleryImageRecord): void {
    const objectUrl = URL.createObjectURL(record.blob)
    const anchor = document.createElement('a')
    const safeModel = sanitizeFileName(record.model)
    const extension = mimeTypeToExtension(record.mimeType)

    anchor.href = objectUrl
    anchor.download = `${safeModel}-${formatTimestamp(record.createdAt)}.${extension}`
    anchor.style.display = 'none'

    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()

    window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl)
    }, 500)
}

async function addGalleryImages(records: NewGalleryImageRecord[]): Promise<number> {
    const db = await openGalleryDb()

    return new Promise<number>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)

        let savedCount = 0

        for (const record of records) {
            const now = new Date().toISOString()
            const payload: GalleryImageRecord = {
                id: buildRecordId(),
                createdAt: now,
                provider: record.provider,
                model: record.model,
                prompt: record.prompt,
                mimeType: record.mimeType,
                blob: record.blob,
                bytes: record.blob.size,
            }

            const request = store.put(payload)
            request.onsuccess = () => {
                savedCount += 1
            }
            request.onerror = () => {
                // Continue processing other records in the same transaction.
            }
        }

        transaction.oncomplete = () => resolve(savedCount)
        transaction.onerror = () => reject(transaction.error ?? new Error('Failed to save gallery images.'))
        transaction.onabort = () => reject(transaction.error ?? new Error('Gallery transaction aborted.'))
    })
}

async function resolveImageBlob(
    base64Data?: string,
    url?: string,
    mimeType = 'image/png',
): Promise<Blob | null> {
    if (base64Data) {
        return base64ToBlob(base64Data, mimeType)
    }

    if (url) {
        return fetchImageAsBlob(url)
    }

    return null
}

async function fetchImageAsBlob(url: string): Promise<Blob> {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to fetch image from URL: ${response.status}`)
    }

    return response.blob()
}

function base64ToBlob(base64Data: string, mimeType: string): Blob {
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)

    for (let index = 0; index < binaryString.length; index += 1) {
        bytes[index] = binaryString.charCodeAt(index)
    }

    return new Blob([bytes], { type: mimeType || 'image/png' })
}

function buildRecordId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID()
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function sanitizeFileName(value: string): string {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-')
    return normalized || 'generated-image'
}

function formatTimestamp(isoDate: string): string {
    const date = new Date(isoDate)
    const pad = (value: number) => value.toString().padStart(2, '0')

    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
        date.getHours(),
    )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function mimeTypeToExtension(mimeType: string): string {
    const normalized = mimeType.toLowerCase()

    if (normalized.includes('jpeg') || normalized.includes('jpg')) {
        return 'jpg'
    }

    if (normalized.includes('webp')) {
        return 'webp'
    }

    if (normalized.includes('gif')) {
        return 'gif'
    }

    return 'png'
}

async function withObjectStore<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
    const db = await openGalleryDb()
    const transaction = db.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)

    const result = await action(store)
    await transactionDone(transaction)
    return result
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
    })
}

function openGalleryDb(): Promise<IDBDatabase> {
    if (galleryDbPromise) {
        return galleryDbPromise
    }

    galleryDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB is not available in this environment.'))
            return
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onupgradeneeded = () => {
            const db = request.result

            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
                store.createIndex('createdAt', 'createdAt', { unique: false })
            }
        }

        request.onsuccess = () => {
            const db = request.result
            db.onversionchange = () => {
                db.close()
            }
            resolve(db)
        }

        request.onerror = () => {
            reject(request.error ?? new Error('Failed to open gallery database.'))
        }

        request.onblocked = () => {
            reject(new Error('Gallery database open request was blocked.'))
        }
    })

    return galleryDbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
    })
}
