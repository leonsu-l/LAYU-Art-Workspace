import { getStudioCache } from '../services/sessionScope'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { deleteGalleryItem, deleteGalleryItems, downloadGalleryItem, loadGallery, type GalleryItem } from '../services/galleryService'
import { backendErrorMessage } from '../services/backendClient'
import { GalleryView } from '../studio/GalleryView'
import { useNotify } from '../studio/useNotify'

export function GalleryPage() {
  const navigate = useNavigate()
  const notify = useNotify()
  const [cache] = useState(getStudioCache)
  const [items, setItems] = useState<GalleryItem[]>(() => cache.get<GalleryItem[]>('gallery') ?? [])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [initialized, setInitialized] = useState(() => Boolean(cache.get('gallery')))
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previous = useRef(items)
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
      if (!snapshot.serverError) cache.set('gallery', snapshot.images)
      previous.current = snapshot.images
      setItems(snapshot.images)
      setError(snapshot.serverError ? `图库刷新失败：${snapshot.serverError}` : null)
      const keys = new Set(snapshot.images.map((i) => i.key))
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

  return <main id="main"><GalleryView items={items} selectedKeys={selected} onSelection={setSelected}
    isRefreshing={loading} showListSkeleton={!initialized && loading} deleting={deleting} error={error}
    overlayId="studio-overlay-root" onGoWorkbench={() => void navigate('/')} onRefresh={() => void refresh(true)}
    onDeleteOne={(item) => void remove([item], false)} onDeleteSelected={(list) => void remove(list, true)}
    onDownload={(item) => { downloadGalleryItem(item); notify({ message: '已开始下载原图。' }) }} /></main>
}
