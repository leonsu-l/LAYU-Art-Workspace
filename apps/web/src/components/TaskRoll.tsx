import type { CSSProperties } from 'react'
import { Icon } from './Icon'
import styles from './TaskRoll.module.css'
import type { AppError, GenerationTask, GenerationTaskStatus } from '@nanobanana/shared/types/generation'
import type { PendingSubmission } from '../services/imageGenerationService'

const taskStatusNames: Record<GenerationTaskStatus, string> = {
  queued: '排队中', running: '生成中', succeeded: '已完成', failed: '失败',
}

interface TaskRollProps {
  tasks: GenerationTask[]
  selectedTask: GenerationTask | null
  pendingSubmissions: PendingSubmission[]
  isSubmitting: boolean
  isRefreshing: boolean
  isReadingImages: boolean
  hasDiscovered: boolean
  connectionError: string | null
  submissionError: AppError | null
  deletingTaskId: string | null
  deletionError: string | null
  deletionNotice: string | null
  onSelectTask: (id: string) => void
  onDeleteTask: (task: GenerationTask) => void
  onRefresh: () => void
  onRetrySubmission: (pending: PendingSubmission) => void
}

export function TaskRoll({ tasks, selectedTask, pendingSubmissions, isSubmitting, isRefreshing, isReadingImages, hasDiscovered, connectionError, submissionError, deletingTaskId, deletionError, deletionNotice, onSelectTask, onDeleteTask, onRefresh, onRetrySubmission }: TaskRollProps) {
  const activeTaskCount = tasks.filter((task) => task.status === 'queued' || task.status === 'running').length
  const failedTaskCount = tasks.filter((task) => task.status === 'failed').length

  return (
    <section className={styles.roll} aria-labelledby="roll-heading">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>ROLL 001 · TASK HISTORY</span>
          <h2 id="roll-heading" className={styles.heading}>任务胶卷</h2>
        </div>
        <div className={styles.tools}>
          {activeTaskCount > 0 ? <span className={styles.running}>{activeTaskCount} 进行中</span> : null}
          {failedTaskCount > 0 ? <span className={styles.failed}>{failedTaskCount} 失败</span> : null}
          <button type="button" className={styles.refresh} onClick={onRefresh} disabled={isRefreshing}>
            <Icon name="loader" size={13} className={isRefreshing ? styles.spinner : undefined} />{isRefreshing ? '正在同步' : '刷新 / 重连'}
          </button>
        </div>
      </header>

      <div className={styles.notices}>
        {!hasDiscovered ? <p className={styles.notice} role="status">正在发现后端已有任务；完成前暂停新提交。</p> : null}
        {connectionError ? <p className={styles.caution} role="status">连接 / 恢复提示：{connectionError} 会自动重连，已有任务不会因此被标记为失败。</p> : null}
        {submissionError ? <p className={styles.alert} role="alert">提交提示：{submissionError.message}</p> : null}
        {deletionError ? <p className={styles.alert} role="alert">删除提示：{deletionError}</p> : null}
        {deletionNotice ? <p className={styles.notice} role="status">{deletionNotice}</p> : null}
        {isSubmitting ? <p className={styles.caution} role="status">正在提交，尚待后端确认接收。此时建议不要关闭页面。</p> : null}
        {pendingSubmissions.length > 0 ? (
          <div className={styles.pending}>
            <p>以下提交尚未确认，暂不创建新任务以防重复扣费。重试只使用同一 ID 和原始请求；刷新后需保持原提示词与配置，并按原顺序重新选择相同参考图。</p>
            {pendingSubmissions.map((pending) => (
              <div key={pending.id} className={styles.pendingRow}>
                <code>{pending.id}</code>
                <button type="button" className={styles.refresh} disabled={isSubmitting || isReadingImages || Boolean(deletingTaskId)} onClick={() => onRetrySubmission(pending)}>恢复 / 重试同一请求</button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {tasks.length > 0 ? (
        <div className={styles.filmstrip}>
          <div className={styles.scroller} tabIndex={0} aria-label="任务历史胶卷，支持横向滚动">
            <ol className={styles.strip}>
              {tasks.map((task, index) => {
                const thumb = getTaskThumbnail(task)
                const isSelected = selectedTask?.id === task.id
                const isDeleting = deletingTaskId === task.id
                const isLocked = task.status === 'queued' || task.status === 'running'
                const meta = new Date(task.createdAt).toLocaleString('zh-CN')
                return (
                  <li key={task.id} className={styles.frame} aria-busy={isDeleting}
                    style={{ '--md-enter-delay': `${Math.min(index, 10) * 45}ms` } as CSSProperties}>
                    <button type="button" aria-pressed={isSelected} onClick={() => onSelectTask(task.id)}
                      className={`${styles.frameButton} ${isSelected ? styles.selectedFrame : ''}`}
                      title={`${meta} · ${task.model} · ${task.referenceImageCount ? `${task.referenceImageCount} 张参考图` : '文生图'} · ${task.id.slice(0, 8)}\n${task.prompt}`}>
                      <span className={styles.thumb} data-status={task.status}>
                        {thumb
                          ? <img src={thumb} alt="" width={320} height={240} loading="lazy" decoding="async" />
                          : <Icon name={task.status === 'failed' ? 'close' : task.status === 'succeeded' ? 'image' : 'loader'} size={20} className={isLocked ? styles.spinner : undefined} />}
                        <span className={styles.frameNo} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                      </span>
                      <span className={styles.frameMeta}>
                        <span className={styles.statusName} data-status={task.status}>{taskStatusNames[task.status]}</span>
                        <span className={styles.frameTime}>{formatStamp(task.createdAt)}</span>
                      </span>
                      <span className={styles.prompt}>{task.prompt}</span>
                    </button>
                    <button type="button" className={styles.remove}
                      disabled={Boolean(deletingTaskId) || isSubmitting || isLocked}
                      title={isLocked ? '进行中的任务不能删除，请等待生成结束' : '删除任务历史及该任务的全部生成图片'}
                      aria-label={isDeleting ? `正在删除任务：${task.prompt.slice(0, 60)}` : `删除任务及关联图片：${task.prompt.slice(0, 60)}`}
                      onClick={() => onDeleteTask(task)}>
                      <Icon name={isDeleting ? 'loader' : 'trash'} size={12} className={isDeleting ? styles.spinner : undefined} />
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      ) : hasDiscovered && !connectionError ? (
        <p className={styles.empty}>还没有生成任务。写下灵感，开始第一张作品。</p>
      ) : null}

      {tasks.length > 0 ? <p className={styles.note}>任务与图片按整组删除：删除任一后端图片也会删除所属任务及同组全部图片。排队中、生成中的任务暂不可删除。</p> : null}
      {!isSubmitting && selectedTask ? <p className={styles.note}>
        当前任务：{taskStatusNames[selectedTask.status]}。{selectedTask.status === 'queued' || selectedTask.status === 'running'
          ? '后端已接收，可安全关闭页面；下次打开自动恢复。' : '已保存任务状态，可随时从历史记录重新查看。'}
      </p> : null}
    </section>
  )
}

function getTaskThumbnail(task: GenerationTask): string | null {
  const image = task.result?.images.find((candidate) => candidate.url || candidate.base64Data)
  if (!image) return null
  return image.base64Data ? `data:${image.mimeType};base64,${image.base64Data}` : image.url ?? null
}

function formatStamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
