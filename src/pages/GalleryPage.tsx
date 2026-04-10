import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

interface GalleryViewRecord extends GalleryImageRecord {
  objectUrl: string
}

function revokeObjectUrls(records: GalleryViewRecord[]): void {
  for (const record of records) {
    URL.revokeObjectURL(record.objectUrl)
  }
}

export function GalleryPage() {
  const [images, setImages] = useState<GalleryViewRecord[]>([])
  const [stats, setStats] = useState<GalleryStorageStats>({
    totalBytes: 0,
    imageCount: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [previewRecordId, setPreviewRecordId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const latestImagesRef = useRef<GalleryViewRecord[]>([])

  const previewRecord = useMemo(
    () => images.find((item) => item.id === previewRecordId) ?? null,
    [images, previewRecordId],
  )

  const refreshGallery = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)

    try {
      const loadedImages = await listGalleryImages()
      const totalBytes = loadedImages.reduce((sum, item) => sum + item.bytes, 0)
      const loadedViewRecords: GalleryViewRecord[] = loadedImages.map((item) => ({
        ...item,
        objectUrl: URL.createObjectURL(item.blob),
      }))
      const availableIds = new Set(loadedImages.map((item) => item.id))

      setImages((previous) => {
        revokeObjectUrls(previous)
        return loadedViewRecords
      })
      setStats({
        totalBytes,
        imageCount: loadedImages.length,
      })
      setPreviewRecordId((previous) => {
        if (!previous) {
          return previous
        }

        return availableIds.has(previous) ? previous : null
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
    if (!previewRecordId) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewRecordId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [previewRecordId])

  useEffect(() => {
    latestImagesRef.current = images
  }, [images])

  useEffect(() => {
    return () => {
      revokeObjectUrls(latestImagesRef.current)
    }
  }, [])

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
      if (previewRecordId === record.id) {
        setPreviewRecordId(null)
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

      if (previewRecordId && selectedIds.has(previewRecordId)) {
        setPreviewRecordId(null)
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
                      onPreview={() => setPreviewRecordId(record.id)}
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

      {previewRecord ? (
        <div
          className={styles.modalMask}
          role="button"
          tabIndex={0}
          onClick={() => setPreviewRecordId(null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              setPreviewRecordId(null)
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
                onClick={() => setPreviewRecordId(null)}
              >
                关闭
              </button>
            </div>
            <img
              src={previewRecord.objectUrl}
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
  record: GalleryViewRecord
  selected: boolean
  onToggleSelect: () => void
  onPreview: () => void
  onDownload: () => void
  onDelete: () => void
}

function GalleryCard(props: GalleryCardProps) {
  const { record, selected, onToggleSelect, onPreview, onDownload, onDelete } = props

  return (
    <article className={`${styles.card} ${selected ? styles.cardSelected : ''}`}>
      <img src={record.objectUrl} alt="Gallery item" className={styles.cardImage} loading="lazy" />
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
