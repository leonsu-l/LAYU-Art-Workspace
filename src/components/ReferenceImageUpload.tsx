import { useEffect, useId, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { ReferenceImage } from '../types/generation'
import { isAppError } from '../utils/errors'
import {
  formatReferenceLimit, getDroppedReferenceFiles, getReferenceImageLimitError,
  parseReferenceImages, readReferenceImage, referenceImageBytes, REFERENCE_IMAGE_ACCEPT,
} from '../utils/referenceImages'
import type { ReferenceImageLimits } from '../utils/referenceImages'
import { Icon } from './Icon'
import styles from './ReferenceImageUpload.module.css'

interface ReferenceImageUploadProps {
  images: ReferenceImage[]
  limits: ReferenceImageLimits
  selectionError: string | null
  disabled: boolean
  onChange: (images: ReferenceImage[]) => void
  onLoadingChange: (loading: boolean) => void
}

export function ReferenceImageUpload({ images, limits, selectionError, disabled, onChange, onLoadingChange }: ReferenceImageUploadProps) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const mounted = useRef(false)
  const currentLimits = useRef(limits)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ message: string; limits: ReferenceImageLimits } | null>(null)
  const blocked = disabled || loading
  const totalBytes = images.reduce((sum, image) => sum + referenceImageBytes(image), 0)
  const displayError = selectionError ?? (error?.limits === limits ? error.message : null)

  useEffect(() => { currentLimits.current = limits }, [limits])
  useEffect(() => {
    mounted.current = true
    // A file dropped outside the zone must not navigate away and discard the current task form.
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault()
        if (event.type === 'drop') {
          dragDepth.current = 0
          setDragging(false)
        }
      }
    }
    window.addEventListener('dragover', preventFileNavigation)
    window.addEventListener('drop', preventFileNavigation)
    return () => {
      mounted.current = false
      window.removeEventListener('dragover', preventFileNavigation)
      window.removeEventListener('drop', preventFileNavigation)
    }
  }, [])

  function showError(cause: unknown) {
    setError({ message: isAppError(cause) || cause instanceof Error ? cause.message : '图片读取失败，请重新选择。', limits: currentLimits.current })
  }

  async function addFiles(files: File[]) {
    if (!files.length || disabled || busy.current) return
    setError(null)
    const limitError = getReferenceImageLimitError([...images.map(referenceImageBytes), ...files.map((file) => file.size)], limits)
    if (limitError) {
      setError({ message: limitError, limits })
      return
    }
    busy.current = true
    setLoading(true)
    onLoadingChange(true)
    try {
      // Read sequentially to avoid decoding up to 16 large originals simultaneously.
      const added: ReferenceImage[] = []
      for (const file of files) {
        if (!mounted.current) return
        added.push(await readReferenceImage(file, limits))
      }
      // A model/protocol switch during reading must not bypass the new model's limits.
      const next = parseReferenceImages([...images, ...added], currentLimits.current)
      if (mounted.current) onChange(next)
    } catch (cause) {
      if (mounted.current) showError(cause)
    } finally {
      busy.current = false
      if (mounted.current) {
        setLoading(false)
        onLoadingChange(false)
      }
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    setDragging(false)
    if (blocked || busy.current) return
    try { void addFiles(getDroppedReferenceFiles(event.dataTransfer)) } catch (cause) { showError(cause) }
  }

  return (
    <div className={styles.upload} aria-labelledby={`${id}-title`}>
      <div className={styles.header}>
        <span id={`${id}-title`} className={styles.title}>
          <Icon name="image" size={14} />参考图
          <span className={`${styles.count} tnum`}>可选 · {images.length}/{limits.maxImages}</span>
        </span>
        <span className={`${styles.usage} tnum`}>{(totalBytes / 1024 / 1024).toFixed(1)} / {formatReferenceLimit(limits.maxTotalBytes)}</span>
      </div>
      <div
        className={`${styles.dropZone} ${dragging && !blocked ? styles.dragging : ''}`}
        data-disabled={blocked}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          event.stopPropagation()
          dragDepth.current += 1
          if (!blocked) setDragging(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = blocked || images.length >= limits.maxImages ? 'none' : 'copy'
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          event.stopPropagation()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDrop={handleDrop}
      >
        <button type="button" className={styles.dropButton} disabled={blocked || images.length >= limits.maxImages}
          aria-describedby={`${id}-limits`} onClick={() => input.current?.click()}>
          <Icon name={loading ? 'loader' : 'image'} size={22} className={loading ? styles.spinner : ''} />
          <strong>{loading ? '正在读取图片…' : dragging ? '松开即可添加图片' : '将图片拖到这里'}</strong>
          <span>{images.length >= limits.maxImages ? '已达当前模型张数上限，可先移除图片' : '或点击选择文件，支持一次添加多张'}</span>
        </button>
      </div>
      <input ref={input} type="file" hidden multiple accept={REFERENCE_IMAGE_ACCEPT} aria-label="上传参考图片" disabled={blocked}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void addFiles(files)
        }} />
      <p id={`${id}-limits`} className={styles.hint}>PNG / JPEG / WebP，最多 {limits.maxImages} 张，每张 ≤ {formatReferenceLimit(limits.maxImageBytes)}，合计 ≤ {formatReferenceLimit(limits.maxTotalBytes)}。不上传为文生图，上传后结合提示词生成。</p>
      <details className={styles.notes}>
        <summary>参考图限制与处理方式</summary>
        <p className={styles.note}>{limits.note}</p>
        <p className={styles.note}>图片仅在创建任务时发送到后端和所选供应商，不缓存到浏览器。刷新后如需重试未确认的提交，请按原顺序重新选择相同图片。</p>
      </details>
      {displayError ? <p className={styles.error} role="alert">{displayError}</p> : null}
      {images.length ? (
        <ol className={styles.previews}>
          {images.map((image, index) => (
            <li key={`${index}-${image.name}`} className={styles.preview}>
              <img src={`data:${image.mimeType};base64,${image.base64Data}`} alt={`参考图 ${index + 1}：${image.name}`} draggable={false} />
              <div className={styles.caption}>
                <span className={styles.frameNo}>{String(index + 1).padStart(2, '0')}</span>
                <span className={styles.fileName} title={`${image.name} · ${Math.ceil(referenceImageBytes(image) / 1024)} KiB`}>{image.name}</span>
              </div>
              <button type="button" className={styles.remove} aria-label={`移除参考图 ${index + 1}：${image.name}`} disabled={blocked}
                onClick={() => { onChange(images.filter((_, current) => current !== index)); setError(null) }}><Icon name="close" size={13} /></button>
            </li>
          ))}
        </ol>
      ) : null}
      {loading ? <span className={styles.hint} role="status">正在检查参考图，请稍候再创建任务。</span> : null}
    </div>
  )
}
