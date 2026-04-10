import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { GalleryImageRecord, GalleryStorageStats } from '../types/generation'
import {
  deleteGalleryImage,
  deleteGalleryImages,
  downloadGalleryImage,
  formatBytes,
  listGalleryImages,
} from '../utils/galleryDb'
import styles from './GalleryPage.module.css'

const pendingBlobUrlRevokes = new Map<string, number>()

function cancelPendingBlobUrlRevoke(objectUrl: string): void {
  const timeoutId = pendingBlobUrlRevokes.get(objectUrl)
  if (typeof timeoutId !== 'number') {
    return
  }

  window.clearTimeout(timeoutId)
  pendingBlobUrlRevokes.delete(objectUrl)
}

function scheduleBlobUrlRevoke(objectUrl: string): void {
  cancelPendingBlobUrlRevoke(objectUrl)

  const timeoutId = window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl)
    pendingBlobUrlRevokes.delete(objectUrl)
  }, 0)

  pendingBlobUrlRevokes.set(objectUrl, timeoutId)
}

export function GalleryPage() {
  const [images, setImages] = useState<GalleryImageRecord[]>([])
  const [stats, setStats] = useState<GalleryStorageStats>({
    totalBytes: 0,
    imageCount: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [previewRecord, setPreviewRecord] = useState<GalleryImageRecord | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionNotice, setActionNotice] = useState<string | null>(null)

  const previewUrl = useBlobUrl(previewRecord?.blob ?? null)

  const refreshGallery = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const loadedImages = await listGalleryImages()
      const totalBytes = loadedImages.reduce((sum, item) => sum + item.bytes, 0)

      setImages(loadedImages)
      setStats({
        totalBytes,
        imageCount: loadedImages.length,
      })
      setSelectedIds((previous) => {
        if (previous.size === 0) {
          return previous
        }

        const availableIds = new Set(loadedImages.map((item) => item.id))
        const next = new Set<string>()

        previous.forEach((id) => {
          if (availableIds.has(id)) {
            next.add(id)
          }
        })

        return next
      })
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown error'
      setLoadError(`加载本地图库失败：${details}`)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshGallery()
  }, [refreshGallery])

  useEffect(() => {
    if (!previewRecord) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewRecord(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [previewRecord])

  const gallerySummary = useMemo(
    () => `${stats.imageCount} 张图片 · ${formatBytes(stats.totalBytes)}`,
    [stats.imageCount, stats.totalBytes],
  )
  const selectedCount = selectedIds.size
  const isAllSelected = images.length > 0 && selectedCount === images.length

  function toggleSelect(recordId: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(recordId)) {
        next.delete(recordId)
      } else {
        next.add(recordId)
      }
      return next
    })
  }

  function toggleSelectAll(checked: boolean) {
    if (!checked) {
      setSelectedIds(new Set())
      return
    }

    setSelectedIds(new Set(images.map((item) => item.id)))
  }

  async function handleDeleteOne(record: GalleryImageRecord) {
    const shouldDelete = window.confirm('确认删除这张图片吗？')
    if (!shouldDelete) {
      return
    }

    try {
      await deleteGalleryImage(record.id)
      if (previewRecord?.id === record.id) {
        setPreviewRecord(null)
      }
      await refreshGallery()
      setActionNotice('图片已删除。')
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown error'
      setActionNotice(`删除失败：${details}`)
    }
  }

  async function handleDeleteSelected() {
    if (selectedCount === 0) {
      return
    }

    const shouldDelete = window.confirm(`确认删除已选中的 ${selectedCount} 张图片吗？`)
    if (!shouldDelete) {
      return
    }

    try {
      const deletedCount = await deleteGalleryImages(Array.from(selectedIds))

      if (previewRecord && selectedIds.has(previewRecord.id)) {
        setPreviewRecord(null)
      }

      setSelectedIds(new Set())
      await refreshGallery()
      setActionNotice(`已删除 ${deletedCount} 张图片。`)
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown error'
      setActionNotice(`批量删除失败：${details}`)
    }
  }

  return (
    <div className={styles.pageShell}>
      <div className={styles.gradientTop} aria-hidden="true" />
      <div className={styles.gradientBottom} aria-hidden="true" />

      <main className={styles.page}>
        <header className={styles.headerCard}>
          <div>
            <span className={styles.badge}>Local Gallery</span>
            <h1 className={styles.title}>本地图片画廊</h1>
            <p className={styles.subtitle}>
              自动收录成功生成的图片，支持预览与下载。
            </p>
          </div>

          <div className={styles.headerActions}>
            <p className={styles.summary}>{gallerySummary}</p>
            <Link to="/" className={styles.backLink}>
              返回主页
            </Link>
          </div>
        </header>

        {isLoading ? (
          <section className={styles.panel}>
            <p className={styles.emptyText}>正在加载本地图库...</p>
          </section>
        ) : null}

        {loadError ? (
          <section className={styles.panel}>
            <p className={styles.errorText}>{loadError}</p>
          </section>
        ) : null}

        {!isLoading && !loadError ? (
          <section className={styles.panel}>
            {images.length === 0 ? (
              <p className={styles.emptyText}>还没有图片。先回主页生成图片后再来查看。</p>
            ) : (
              <>
                <div className={styles.batchBar}>
                  <label className={styles.batchSelectLabel}>
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={(event) => toggleSelectAll(event.target.checked)}
                    />
                    全选
                  </label>
                  <span className={styles.batchSummary}>已选 {selectedCount} 张</span>
                  <button
                    type="button"
                    className={styles.batchDeleteButton}
                    onClick={() => void handleDeleteSelected()}
                    disabled={selectedCount === 0}
                  >
                    批量删除
                  </button>
                </div>

                {actionNotice ? <p className={styles.actionNotice}>{actionNotice}</p> : null}

                <div className={styles.grid}>
                  {images.map((record) => (
                    <GalleryCard
                      key={record.id}
                      record={record}
                      selected={selectedIds.has(record.id)}
                      onToggleSelect={() => toggleSelect(record.id)}
                      onPreview={() => setPreviewRecord(record)}
                      onDownload={() => downloadGalleryImage(record)}
                      onDelete={() => void handleDeleteOne(record)}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        ) : null}
      </main>

      {previewRecord && previewUrl ? (
        <div
          className={styles.modalMask}
          role="button"
          tabIndex={0}
          onClick={() => setPreviewRecord(null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              setPreviewRecord(null)
            }
          }}
        >
          <div
            className={styles.modalContent}
            role="dialog"
            aria-modal="true"
            aria-label="图片预览"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalActionButton}
                onClick={() => downloadGalleryImage(previewRecord)}
              >
                下载
              </button>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setPreviewRecord(null)}
              >
                关闭
              </button>
            </div>
            <img
              src={previewUrl}
              alt="Gallery preview"
              className={styles.modalImage}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

interface GalleryCardProps {
  record: GalleryImageRecord
  selected: boolean
  onToggleSelect: () => void
  onPreview: () => void
  onDownload: () => void
  onDelete: () => void
}

function GalleryCard(props: GalleryCardProps) {
  const { record, selected, onToggleSelect, onPreview, onDownload, onDelete } = props
  const thumbnailUrl = useBlobUrl(record.blob)

  if (!thumbnailUrl) {
    return null
  }

  return (
    <article className={`${styles.card} ${selected ? styles.cardSelected : ''}`}>
      <img src={thumbnailUrl} alt="Gallery item" className={styles.cardImage} loading="lazy" />
      <label className={styles.cardSelectLabel}>
        <input type="checkbox" checked={selected} onChange={onToggleSelect} />
        选择
      </label>
      <div className={styles.overlayActions}>
        <button type="button" className={styles.actionButton} onClick={onPreview}>
          预览
        </button>
        <button type="button" className={styles.actionButton} onClick={onDownload}>
          下载
        </button>
        <button type="button" className={styles.actionDeleteButton} onClick={onDelete}>
          删除
        </button>
      </div>
      <div className={styles.cardMeta}>
        <p className={styles.metaLine}>{record.model}</p>
        <p className={styles.metaLineMuted}>{new Date(record.createdAt).toLocaleString('zh-CN')}</p>
        <p className={styles.metaLineMuted}>{formatBytes(record.bytes)}</p>
      </div>
    </article>
  )
}

function useBlobUrl(blob: Blob | null): string | null {
  const objectUrl = useMemo(() => {
    if (!blob) {
      return null
    }

    return URL.createObjectURL(blob)
  }, [blob])

  useEffect(() => {
    if (!objectUrl) {
      return
    }

    cancelPendingBlobUrlRevoke(objectUrl)

    return () => {
      scheduleBlobUrlRevoke(objectUrl)
    }
  }, [objectUrl])

  return objectUrl
}
