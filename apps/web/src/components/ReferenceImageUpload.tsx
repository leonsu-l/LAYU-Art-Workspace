import { useEffect, useId, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import type { ReferenceImage } from '@nanobanana/shared/types/generation'
import { isAppError } from '@nanobanana/shared/utils/errors'
import {
  formatReferenceLimit, getDroppedReferenceFiles, getReferenceImageLimitError,
  parseReferenceImages, readReferenceImage, referenceImageBytes, REFERENCE_IMAGE_ACCEPT,
} from '../utils/referenceImages'
import type { ReferenceImageLimits } from '../utils/referenceImages'
import { Icon } from './Icon'
import { RippleButton } from '../studio/Ripple'
import styles from '../studio/Workbench.module.css'

interface ReferenceImageUploadProps {
  children: ReactNode
  images: ReferenceImage[]
  limits: ReferenceImageLimits
  selectionError: string | null
  disabled: boolean
  onChange: (images: ReferenceImage[]) => void
  onLoadingChange: (loading: boolean) => void
}

export function ReferenceImageUpload({ children, images, limits, selectionError, disabled, onChange, onLoadingChange }: ReferenceImageUploadProps) {
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
    <div className={styles.promptCard}>
      <div className={styles.promptToolbar}
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
        <RippleButton type="button" className={`${styles.refAttachBtn} ${images.length || dragging ? styles.refAttachActive : ''}`} disabled={blocked || images.length >= limits.maxImages}
          aria-describedby={`${id}-limits`} onClick={() => input.current?.click()}><Icon name={loading ? 'loader' : 'image'} size={14} />
          {loading ? '正在读取…' : dragging ? '松开以添加' : images.length ? `已附 ${images.length} 张参考图` : '+ 参考图'}
        </RippleButton>
        {children}
      </div>
      <input ref={input} type="file" hidden multiple accept={REFERENCE_IMAGE_ACCEPT} aria-label="上传参考图片" disabled={blocked}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void addFiles(files)
        }} />
      <details className={styles.fieldMeta}>
        <summary>参考图限制与处理方式</summary>
        <p id={`${id}-limits`}>PNG / JPEG / WebP，可拖入或多选文件。已选 {images.length}/{limits.maxImages} 张，{(totalBytes / 1024 / 1024).toFixed(1)} / {formatReferenceLimit(limits.maxTotalBytes)}，单张 ≤ {formatReferenceLimit(limits.maxImageBytes)}。</p>
        <p>{limits.note}</p>
        <p>图片仅在创建任务时发送到后端和所选供应商，不缓存到浏览器。刷新后如需重试未确认的提交，请按原顺序重新选择相同图片。</p>
      </details>
      {displayError ? <p className={styles.recoveryAlert} role="alert">{displayError}</p> : null}
      {images.length ? (
        <ol className={styles.promptCard}>
          {images.map((image, index) => (
            <li key={`${index}-${image.name}`} className={styles.refMiniStrip}>
              <img src={`data:${image.mimeType};base64,${image.base64Data}`} alt={`参考图 ${index + 1}：${image.name}`} width={104} height={104} draggable={false} />
              <div>
                <strong title={`${image.name} · ${Math.ceil(referenceImageBytes(image) / 1024)} KiB`}>{image.name}</strong><span>图生图 · {Math.ceil(referenceImageBytes(image) / 1024)} KiB</span>
              </div>
              <RippleButton type="button" aria-label={`移除参考图 ${index + 1}：${image.name}`} disabled={blocked}
                onClick={() => { onChange(images.filter((_, current) => current !== index)); setError(null) }}><Icon name="close" size={13} /></RippleButton>
            </li>
          ))}
        </ol>
      ) : null}
      {loading ? <span className={styles.fieldMeta} role="status">正在检查参考图，请稍候再创建任务。</span> : null}
    </div>
  )
}
