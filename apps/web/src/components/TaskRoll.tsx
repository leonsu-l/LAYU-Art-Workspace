import { useEffect } from 'react'
import type { GenerationTask, GenerationTaskStatus } from '@nanobanana/shared/types/generation'
import { Icon } from './Icon'
import { RippleButton } from '../studio/Ripple'
import { ShimmerImage, SkeletonBlock } from '../studio/Skeleton'
import { useNotify } from '../studio/useNotify'
import styles from '../studio/Workbench.module.css'

const statusNames: Record<GenerationTaskStatus, string> = { queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败' }
interface TaskRollProps {
  tasks: GenerationTask[]; selectedTask: GenerationTask | null; isSubmitting: boolean; isRefreshing: boolean; loading: boolean
  deletingTaskId: string | null; deletionError: string | null; deletionNotice: string | null
  onSelectTask: (id: string) => void; onDeleteTask: (task: GenerationTask) => void; onRefresh: () => void
}
export function TaskRoll({ tasks, selectedTask, isSubmitting, isRefreshing, loading, deletingTaskId, deletionError, deletionNotice, onSelectTask, onDeleteTask, onRefresh }: TaskRollProps) {
  const notify = useNotify()
  useEffect(() => { if (deletionNotice) notify({ tone: 'success', message: deletionNotice }) }, [deletionNotice, notify])
  return <section className={styles.filmstripDock} aria-label="任务胶卷">
    <div className={styles.filmstripHead}><strong>任务胶卷</strong><span className={styles.filmstripCount}>{tasks.length} 条记录 · 点击切换画布</span>
      <RippleButton className={styles.stageTextBtn} type="button" onClick={onRefresh} disabled={isRefreshing}><Icon name="loader" size={14} />刷新</RippleButton></div>
    {deletionError && <p className={styles.recoveryAlert} role="alert">{deletionError}</p>}
    {loading ? <div className={`${styles.filmstripRow} ${styles.historyRail}`} data-no-swipe="true">{[0, 1, 2].map((i) => <SkeletonBlock key={i} variant="media" width="100%" height={68} staggerIndex={i} />)}</div> : !tasks.length ? <p className={styles.fieldMeta}>还没有生成任务。</p> : <div className={`${styles.filmstripRow} ${styles.historyRail}`} data-no-swipe="true" role="group" aria-label="最近生成任务">
      {tasks.map((task) => {
        const image = task.result?.images.find((i) => i.url || i.base64Data)
        const thumb = image?.base64Data ? `data:${image.mimeType};base64,${image.base64Data}` : image?.url
        const inputKind = task.referenceImageCount ? `${task.referenceImageCount} 张参考图` : '文生图'
        const active = task.status === 'running' || task.status === 'queued', selected = task.id === selectedTask?.id
        return <div key={task.id} className={styles.filmEntry}>
          <RippleButton type="button" className={`${styles.filmCard} ${selected ? styles.filmCardSelected : ''}`} aria-pressed={selected} disabled={isSubmitting}
            title={`${new Date(task.createdAt).toLocaleString()} · ${task.model} · ${inputKind} · ${task.id}\n${task.prompt}`} onClick={() => { onSelectTask(task.id); notify({ tone: task.status === 'failed' ? 'warning' : 'info', message: `${statusNames[task.status]} · ${task.model} · ${inputKind} · ${task.error?.message ?? new Date(task.createdAt).toLocaleString()}` }) }}>
            <span className={styles.filmThumb}>{thumb ? <ShimmerImage src={thumb} alt="" aspectRatio="1 / 1" iconSize={14} /> : <Icon name={active ? 'loader' : task.status === 'failed' ? 'alert-circle' : 'image'} size={16} />}</span>
            <span className={styles.filmMeta}><strong data-status={task.status}>{statusNames[task.status]}</strong><span>{task.prompt}</span></span>
          </RippleButton>
          <RippleButton type="button" className={styles.filmDelete} aria-label={`删除任务及关联图片：${task.prompt.slice(0, 60)}`} title="删除任务及同组全部图片" disabled={active || isSubmitting || Boolean(deletingTaskId)} onClick={() => onDeleteTask(task)}><Icon name="trash" size={12} /></RippleButton>
        </div>
      })}</div>}
  </section>
}
