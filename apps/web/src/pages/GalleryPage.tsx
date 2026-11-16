import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { StudioHeader } from '../components/StudioHeader'
import { formatBytes } from '../utils/galleryDb'
import {
  deleteGalleryItem,
  deleteGalleryItems,
  downloadGalleryItem,
  loadGallery,
  type GalleryItem,
} from '../services/galleryService'
import styles from './GalleryPage.module.css'

type GalleryViewRecord = GalleryItem & { objectUrl: string }

function revokeObjectUrls(records: GalleryViewRecord[]): void {
  for (const record of records) {
    if (record.source === 'browser') URL.revokeObjectURL(record.objectUrl)
  }
}

export function GalleryPage() {
  const [images, setImages] = useState<GalleryViewRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [browserError, setBrowserError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [previewRecordId, setPreviewRecordId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const latestImagesRef = useRef<GalleryViewRecord[]>([])
  const requestRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)

  const previewRecord = useMemo(
    () => images.find((item) => item.key === previewRecordId) ?? null,
    [images, previewRecordId],
  )

  const refreshGallery = useCallback(async () => {
    if (!mountedRef.current) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setIsLoading(true)
    try {
      const snapshot = await loadGallery(latestImagesRef.current, controller.signal)
      if (controller.signal.aborted) return
      const previous = new Map(latestImagesRef.current.map((image) => [image.key, image]))
      const loadedViewRecords: GalleryViewRecord[] = snapshot.images.map((image) => ({
        ...image,
        objectUrl: image.source === 'server' ? image.url
          : previous.get(image.key)?.objectUrl ?? URL.createObjectURL(image.blob),
      }))
      const availableIds = new Set(loadedViewRecords.map((image) => image.key))
      revokeObjectUrls(latestImagesRef.current.filter((image) => !availableIds.has(image.key)))
      latestImagesRef.current = loadedViewRecords
      setImages(loadedViewRecords)
      setBrowserError(snapshot.browserError)
      setServerError(snapshot.serverError)
      setPreviewRecordId((current) => current && availableIds.has(current) ? current : null)
      setSelectedIds((current) => new Set(Array.from(current).filter((id) => availableIds.has(id))))
    } catch (error) {
      if (!controller.signal.aborted) setActionNotice(`图库刷新失败：${error instanceof Error ? error.message : '请重试'}`)
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refreshGallery()
    const refreshWhenIdle = () => { if (!requestRef.current) void refreshGallery() }
    const timerId = window.setInterval(refreshWhenIdle, 10_000)
    window.addEventListener('focus', refreshWhenIdle)
    window.addEventListener('online', refreshWhenIdle)
    return () => {
      mountedRef.current = false
      window.clearInterval(timerId)
      window.removeEventListener('focus', refreshWhenIdle)
      window.removeEventListener('online', refreshWhenIdle)
      requestRef.current?.abort()
      revokeObjectUrls(latestImagesRef.current)
    }
  }, [refreshGallery])

  const sourceSummary = (source: GalleryItem['source']) => {
    const entries = images.filter((image) => image.source === source)
    return `${entries.length} 张 · ${formatBytes(entries.reduce((sum, image) => sum + image.bytes, 0))}`
  }
  const gallerySummary = `后端 ${sourceSummary('server')}`
  const selectedCount = selectedIds.size
  const isAllSelected = images.length > 0 && selectedCount === images.length

  function toggleSelect(recordId: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return next
    })
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds(checked ? new Set(images.map((item) => item.key)) : new Set())
  }

  async function handleDeleteOne(record: GalleryItem) {
    const confirmation = record.source === 'server'
      ? '确认删除这张后端图片所属的整个生成任务吗？将同时删除该任务历史及全部图片，包括未选中的同任务图片。此操作无法撤销。'
      : '确认删除这张浏览器旧图库图片吗？仅删除此图，不影响后端任务历史。此操作无法撤销。'
    if (isDeleting || !window.confirm(confirmation)) return

    setIsDeleting(true)
    setActionNotice(null)
    try {
      await deleteGalleryItem(record)
      if (previewRecordId === record.key) setPreviewRecordId(null)
      setActionNotice(record.source === 'server'
        ? '已删除该生成任务的历史及全部图片，包括未选中的同任务图片。'
        : '已删除这张浏览器旧图库图片。')
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown error'
      setActionNotice(`删除失败：${details}`)
    } finally {
      // A timed-out delete may still have succeeded; reconcile both stores.
      await refreshGallery()
      if (mountedRef.current) setIsDeleting(false)
    }
  }

  async function handleDeleteSelected() {
    if (selectedCount === 0 || isDeleting) return
    const selectedImages = images.filter((image) => selectedIds.has(image.key))
    const serverCount = selectedImages.filter((image) => image.source === 'server').length
    const browserCount = selectedImages.length - serverCount
    const deletionDetails = [
      serverCount > 0 ? `${serverCount} 张后端图片将按生成任务整组删除：同时删除所属任务历史及全部图片，包括未选中的同任务图片。` : '',
      browserCount > 0 ? `${browserCount} 张浏览器旧图库图片仅删除选中项，不影响后端任务历史。` : '',
    ].filter(Boolean).join('\n')
    if (!window.confirm(`确认删除已选中的 ${selectedCount} 张图片吗？\n${deletionDetails}\n此操作无法撤销。`)) return

    setIsDeleting(true)
    setActionNotice(null)
    try {
      const deletedCount = await deleteGalleryItems(selectedImages)
      if (previewRecordId && selectedIds.has(previewRecordId)) setPreviewRecordId(null)
      setSelectedIds(new Set())
      setActionNotice(serverCount > 0
        ? `已删除所选后端图片所属的任务历史及全部图片，包括未选中的同任务图片。${browserCount > 0 ? `同时删除了 ${browserCount} 张选中的浏览器旧图库图片。` : ''}`
        : `已删除 ${deletedCount} 张浏览器旧图库图片。`)
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown error'
      setActionNotice(`批量删除失败：${details}`)
    } finally {
      // A timed-out delete may still have succeeded; reconcile both stores.
      await refreshGallery()
      if (mountedRef.current) setIsDeleting(false)
    }
  }

  return (
    <div className={styles.shell}>
      <StudioHeader />
      <main id="main" className={styles.page}>
        <header className={styles.masthead}>
          <div className={styles.mastheadMain}>
            <p className={styles.kicker}><span className={styles.kickerMark} aria-hidden="true" />SERVER &amp; BROWSER COLLECTION</p>
            <h1 className={styles.title}>我的图库</h1>
            <p className={styles.subtitle}>灵感的每一次成形，都值得好好收藏。</p>
          </div>
          <div className={styles.mastheadSide}>
            <p className={`${styles.summary} tnum`}>{gallerySummary}{isLoading ? ' · 刷新中…' : ''}</p>
            <div className={styles.pageActions}>
              <button type="button" className={styles.secondaryButton} disabled={isLoading} onClick={() => void refreshGallery()}>
                <Icon name="loader" size={14} />{isLoading ? '正在刷新…' : '刷新图库'}
              </button>
              <Link to="/" viewTransition className={styles.primaryButton}>
                <Icon name="plus" size={16} />创建新作品<Icon name="arrow-up-right" size={14} />
              </Link>
            </div>
          </div>
        </header>

        <div role="status" aria-live="polite" aria-atomic="true">
          {actionNotice ? <p className={styles.actionNotice}>{actionNotice}</p> : null}
          {serverError ? <p className={styles.actionNotice}>后端图库暂不可用：{serverError} 已保留当前账号上次元数据。</p> : null}
          {browserError ? <p className={styles.actionNotice}>浏览器旧图库读取失败：{browserError}</p> : null}
        </div>

        <section className={styles.collection} aria-label="我的图片收藏" aria-busy={isLoading}>
          {isLoading && images.length === 0 ? (
            <div className={styles.loadingState} role="status">
              <span className={styles.spinner}><Icon name="loader" size={22} /></span>
              <p>正在整理你的灵感收藏…</p>
            </div>
          ) : images.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyLabel}>FRAME 00 · 待曝光</span>
              <h2 className={styles.emptyTitle}>下一张作品，<br />从一个灵感开始。</h2>
              <p className={styles.emptyText}>这里还没有图片。去创作你的第一张作品，<br className={styles.emptyBreak} />生成的图片会自动收录在这里。</p>
              <Link to="/" viewTransition className={styles.primaryButton}>
                <Icon name="sparkles" size={16} />
                开始创作
                <Icon name="arrow-right" size={15} />
              </Link>
            </div>
          ) : (
            <>
              <div className={styles.sheetBar}>
                <div className={styles.sheetLabel}>
                  <span className={styles.frameTotal}>全部作品</span>
                  <span className={styles.sheetCount}>最新优先</span>
                </div>
                <div className={styles.batchActions}>
                  <label className={styles.selectLabel}>
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      ref={(node) => {
                        if (node) node.indeterminate = selectedCount > 0 && !isAllSelected
                      }}
                      onChange={(event) => toggleSelectAll(event.target.checked)}
                      disabled={isDeleting}
                    />
                    全选
                  </label>
                  <span className={`${styles.batchSummary} tnum`} role="status" aria-live="polite">已选 {selectedCount} 张</span>
                  <button
                    type="button"
                    className={styles.batchDeleteButton}
                    onClick={() => void handleDeleteSelected()}
                    disabled={selectedCount === 0 || isDeleting}
                  >
                    <Icon name="trash" size={14} />
                    {isDeleting ? '正在删除…' : '删除所选'}
                  </button>
                </div>
              </div>
              <div className={styles.sheet}>
                {images.map((record, index) => (
                  <GalleryCard
                    key={record.key}
                    record={record}
                    index={index}
                    selected={selectedIds.has(record.key)}
                    isDeleting={isDeleting}
                    onToggleSelect={() => toggleSelect(record.key)}
                    onPreview={() => setPreviewRecordId(record.key)}
                    onDownload={() => downloadGalleryItem(record)}
                    onDelete={() => void handleDeleteOne(record)}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        <p className={styles.storageNote}>
          <Icon name="shield" size={14} />
          <span>新作品由后端保存，关闭页面不会中断生成。后端任务历史与图片双向联动：删除任务历史或任一图片，都会删除所属生成任务的历史及全部图片，包括未选中的同任务图片，且无法撤销。旧浏览器图库不展示，也不会分配给当前账号。每 10 秒刷新元数据，不会预先下载全部后端图片。</span>
        </p>
      </main>

      {previewRecord ? (
        <GalleryPreview record={previewRecord} onClose={() => setPreviewRecordId(null)} />
      ) : null}
    </div>
  )
}

interface GalleryCardProps {
  record: GalleryViewRecord
  index: number
  selected: boolean
  isDeleting: boolean
  onToggleSelect: () => void
  onPreview: () => void
  onDownload: () => void
  onDelete: () => void
}

function GalleryCard(props: GalleryCardProps) {
  const { record, index, selected, isDeleting, onToggleSelect, onPreview, onDownload, onDelete } = props
  const prompt = record.prompt.trim() || '未记录提示词'

  return (
    <article
      className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
      style={{ '--md-enter-delay': `${Math.min(index, 12) * 55}ms` } as CSSProperties}
    >
      <div className={styles.cardTopline}>
        <span className={styles.frameIndex} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <span className={styles.modelLabel} title={record.model}>{record.model}</span>
        <label className={styles.selectLabel}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            disabled={isDeleting}
            aria-label={`选择图片：${prompt.slice(0, 60)}`}
          />
          <span>选择</span>
        </label>
      </div>
      <button type="button" className={styles.imageButton} onClick={onPreview} aria-label={`预览图片：${prompt.slice(0, 60)}`}>
        <img src={record.objectUrl} alt={prompt} className={styles.cardImage} width={320} height={240} loading="lazy" decoding="async" />
        <span className={styles.imageHint}><Icon name="eye" size={15} />预览</span>
      </button>
      <div className={styles.cardMeta}>
        <p className={styles.cardPrompt} title={prompt}>{prompt}</p>
        <div className={styles.metaLine}>
          <time dateTime={record.createdAt} title={new Date(record.createdAt).toLocaleString('zh-CN')}>
            {new Date(record.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}
          </time>
          <span>{record.source === 'server' ? '后端' : '浏览器旧图库'} · {formatBytes(record.bytes)}</span>
        </div>
      </div>
      <div className={styles.cardActions}>
        <button type="button" className={styles.cardAction} onClick={onPreview}>
          <Icon name="eye" size={14} />预览
        </button>
        <button type="button" className={styles.cardAction} onClick={onDownload}>
          <Icon name="download" size={14} />下载
        </button>
        <button type="button" className={`${styles.cardAction} ${styles.deleteAction}`} onClick={onDelete} disabled={isDeleting}>
          <Icon name="trash" size={14} />删除
        </button>
      </div>
    </article>
  )
}

function GalleryPreview({ record, onClose }: { record: GalleryViewRecord; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    dialog?.showModal()
    document.body.style.overflow = 'hidden'

    return () => {
      dialog?.close()
      document.body.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={styles.previewDialog}
      aria-labelledby="gallery-preview-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={styles.previewHeader}>
        <div className={styles.previewTitle}>
          <span className={styles.previewEyebrow}>PRINT · 底片</span>
          <h2 id="gallery-preview-title">作品预览</h2>
        </div>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="关闭预览" autoFocus>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className={styles.previewCanvas}>
        <img src={record.objectUrl} alt={record.prompt || '生成的图片'} className={styles.previewImage} />
      </div>
      <div className={styles.previewDetails}>
        <div className={styles.previewMetadata}>
          <span className={styles.previewEyebrow}>PROMPT / 提示词</span>
          <p className={styles.previewPrompt}>{record.prompt || '未记录提示词'}</p>
          <p className={`${styles.previewInfo} tnum`}>
            <span>{record.model}</span>
            <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString('zh-CN')}</time>
            <span>{record.source === 'server' ? '后端' : '浏览器旧图库'} · {formatBytes(record.bytes)}</span>
          </p>
        </div>
        <button type="button" className={styles.primaryButton} onClick={() => downloadGalleryItem(record)}>
          <Icon name="download" size={16} />下载图片
        </button>
      </div>
    </dialog>
  )
}
