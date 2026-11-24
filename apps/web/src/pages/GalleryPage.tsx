import { getStudioCache } from '../services/sessionScope'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteGalleryItem, deleteGalleryItems, downloadGalleryItem, loadGallery, type GalleryItem } from '../services/galleryService'
import { backendErrorMessage } from '../services/backendClient'
import { Icon } from '../components/Icon'
import { GalleryView } from '../studio/GalleryView'
import { RippleButton } from '../studio/Ripple'
import { useNotify } from '../studio/useNotify'

import { formatRetentionPolicyText, getImageRetentionSummary } from '../utils/retentionFormat'
import styles from '../studio/Pages.module.css'

type CachedGallery = { images: GalleryItem[]; retentionDays: number | null }
const brokenMessage = '图片加载失败，可能已过期或被删除，已移除失效预览。'

export function GalleryPage() {
  const navigate = useNavigate()
  const notify = useNotify()
  const [cache] = useState(getStudioCache)
  const [gallery, setGallery] = useState(() => cache.get<CachedGallery>('galleryWithPolicy'))
  const [brokenKeys, setBrokenKeys] = useState(new Set<string>())
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(() => Boolean(gallery))
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previous = useRef(gallery)
  const request = useRef<AbortController | null>(null)
  const mounted = useRef(false)

  const refresh = useCallback(async (manual = false) => {
    if (!mounted.current) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    try {
      const snapshot = await loadGallery(previous.current, controller.signal)
      if (controller.signal.aborted) return
      const keys = new Set(snapshot.images.map((i) => i.key))
      if (!snapshot.serverError && snapshot.hasRetentionPolicy) {
        const next = { images: snapshot.images, retentionDays: snapshot.retentionDays }
        previous.current = next
        cache.set('galleryWithPolicy', next)
        if (manual) {
          setBrokenKeys(new Set())
        } else {
          setBrokenKeys((old) => {
            if (!old.size) return old
            const nextKeys = new Set([...old].filter((key) => keys.has(key)))
            return nextKeys.size === old.size ? old : nextKeys
          })
        }
        setGallery(next)
      }
      setError(snapshot.serverError ? `图库刷新失败：${snapshot.serverError}` : null)
      setSelected((old) => old.filter((key) => keys.has(key)))
      if (manual && !snapshot.serverError) notify({ message: '图库已刷新。' })
    } finally {
      if (request.current === controller && !controller.signal.aborted) { request.current = null; setLoading(false); setInitialized(true) }
    }
  }, [notify, cache])

  useEffect(() => {
    mounted.current = true
    void refresh()
    const whenIdle = () => { if (!request.current) void refresh() }
    const timer = window.setInterval(whenIdle, 10_000)
    window.addEventListener('focus', whenIdle)
    window.addEventListener('online', whenIdle)
    return () => {
      mounted.current = false
      request.current?.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', whenIdle)
      window.removeEventListener('online', whenIdle)
    }
  }, [refresh])

  async function remove(records: GalleryItem[], batch: boolean) {
    if (!records.length || deleting || !window.confirm(`确定删除${batch ? `所选 ${records.length} 张作品` : '这张作品'}所属的整个生成任务吗？\n任务历史和同组全部图片（含未选中的图片）都会一并删除，无法撤销。`)) return
    setDeleting(true)
    try {
      if (batch) await deleteGalleryItems(records)
      else await deleteGalleryItem(records[0])
      if (mounted.current) notify({ tone: 'success', message: '已删除所属任务及同组全部图片。' })
    } catch (e) {
      if (mounted.current) notify({ tone: 'warning', message: `删除失败：${backendErrorMessage(e)}` })
    } finally {
      await refresh()
      if (mounted.current) setDeleting(false)
    }
  }

  function onImageError(item: GalleryItem) {
    setBrokenKeys(old => new Set(old).add(item.key))
    setSelected(old => old.filter(key => key !== item.key))
    notify({ tone: 'warning', message: brokenMessage, actionLabel: '刷新列表', onAction: () => void refresh(true) })
  }
  const items = gallery?.images.filter(item => !brokenKeys.has(item.key)) ?? []
  return <main id="main"><GalleryView items={items} onImageError={onImageError}
    retention={gallery ? { policyLabel: formatRetentionPolicyText(gallery.retentionDays), describe: item => getImageRetentionSummary(item.retentionDays, item.expiresAt) } : undefined}
    notice={brokenKeys.size > 0 && <div role="status" className={styles.galleryNoticeBanner}><div className={styles.galleryNoticeText}><Icon name="alert-circle" size={16} /><span>{brokenMessage}</span></div><RippleButton type="button" className={styles.tonalBtn} onClick={() => void refresh(true)}>刷新列表</RippleButton></div>}
    selectedKeys={selected} onSelection={setSelected}
    isRefreshing={loading} showListSkeleton={!initialized && loading} deleting={deleting} error={error}
    overlayId="studio-overlay-root" onGoWorkbench={() => void navigate('/')} onRefresh={() => void refresh(true)}
    onDeleteOne={(item) => void remove([item], false)} onDeleteSelected={(list) => void remove(list, true)}
    onDownload={(item) => { downloadGalleryItem(item); notify({ message: '已开始下载原图。' }) }} /></main>
}
