import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { SegmentedRail, StudioSelect } from '../studio/Controls'
import { LabIcon } from '../studio/LabIcon'
import { RippleButton } from '../studio/Ripple'
import { SkeletonBlock, SkeletonTextStack } from '../studio/Skeleton'
import { backendErrorMessage, backendRequest, BackendRequestError } from '../services/backendClient'
import type { AdminIssueKind, AdminIssuesPage, AdminIssueStatus } from '@nanobanana/shared/types/studio'
import { useNotify } from '../studio/useNotify'
import { formatLocalDateTime, formatRelativeAge } from '../utils/retentionFormat'
import pageStyles from '../studio/Pages.module.css'
import styles from '../studio/AdminModules.module.css'

const ISSUE_KIND_META: Record<
  AdminIssueKind,
  { label: string; badgeTone: 'fallback' | 'delete' | 'critical' }
> = {
  GENERATION_FAILED: { label: '生图失败', badgeTone: 'critical' },
  R2_FALLBACK: { label: 'R2 故障转存本地', badgeTone: 'fallback' },
  IMAGE_WRITE_FAILED: { label: '图片保存失败', badgeTone: 'critical' },
  IMAGE_READ_FAILED: { label: '图片读取失败', badgeTone: 'critical' },
  IMAGE_DELETE_FAILED: { label: '清理未完成', badgeTone: 'delete' },
}

function shortUuid(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}


export function AdminIssuesPanel({ openCount, reloadIssueSummary }: { openCount?: number; reloadIssueSummary: () => void }) {
  const onNotify = useNotify()
  const [statusFilter, setStatusFilter] = useState<'all' | AdminIssueStatus>('open')
  const [pageSize, setPageSize] = useState<'10' | '20' | '50'>('20')
  const [page, setPage] = useState(0)
  const [revision, setRevision] = useState(0)
  const [resolving, setResolving] = useState<string | null>(null)
  const [result, setResult] = useState<{ query: string; revision: number; data?: AdminIssuesPage; error?: string; now: number }>()
  const query = '/admin/issues?page=' + page + '&size=' + pageSize + (statusFilter === 'all' ? '' : '&status=' + statusFilter)
  useEffect(() => {
    const controller = new AbortController()
    backendRequest<AdminIssuesPage>(query, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return
      if (!data.issues.length && page > 0) setPage(Math.min(page - 1, Math.max(0, Math.ceil(data.total / data.size) - 1)))
      else setResult({ query, revision, data, now: Date.now() })
    }).catch(e => { if (!controller.signal.aborted) setResult({ query, revision, error: backendErrorMessage(e), now: Date.now() }) })
    return () => controller.abort()
  }, [query, revision, page])
  const showSkeleton = result?.query !== query || result.revision !== revision
  const pagedIssues = result?.data?.issues ?? []
  const total = result?.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / Number(pageSize)))
  const nowMs = result?.now
  function refresh() {
    setRevision(v => v + 1)
    reloadIssueSummary()
  }
  async function onResolveIssue(id: string) {
    setResolving(id)
    try {
      await backendRequest(`/admin/issues/${encodeURIComponent(id)}/resolve`, { method: 'POST' })
      onNotify({ tone: 'success', message: '已标记为已处理。' })
    } catch (e) {
      if (!(e instanceof BackendRequestError && e.isApiError && e.appError.status === 404)) {
        onNotify({ tone: 'warning', message: backendErrorMessage(e) })
        return
      }
      onNotify({ tone: 'warning', message: '该问题记录已过期或不存在，已刷新列表' })
    } finally { setResolving(null) }
    refresh()
  }
  async function copyContextId(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      onNotify({ message: '已复制' + label })
    } catch { onNotify({ tone: 'warning', message: '复制失败，请手动复制：' + value }) }
  }
  return (
    <div className={styles.moduleStack}>
      <section className={styles.issuesToolbar} aria-label="问题筛选">
        <div className={styles.issuesFilterGroup}>
          <span className={pageStyles.policyPill}>
            <LabIcon name="bell" size={14} />
            <span>待处理 {openCount ?? '—'} 条</span>
          </span>

          <SegmentedRail<'all' | AdminIssueStatus>
            label="按状态筛选"
            value={statusFilter}
            options={[
              { value: 'open', label: `待处理 (${openCount ?? '—'})` },
              { value: 'resolved', label: `已处理` },
              { value: 'all', label: `全部` },
            ]}
            onChange={(next) => {
              setStatusFilter(next)
              setPage(0)
            }}
          />
        </div>

        <div className={styles.issuesRightControls}>
          <div style={{ minWidth: 146 }}>
            <StudioSelect<'10' | '20' | '50'>
              label="每页条数"
              value={pageSize}
              options={[
                { value: '10', label: '每页 10 条' },
                { value: '20', label: '每页 20 条' },
                { value: '50', label: '每页 50 条' },
              ]}
              onChange={(next) => {
                setPageSize(next)
                setPage(0)
              }}
            />
          </div>

          <RippleButton
            type="button"
            className={pageStyles.tonalBtn}
            disabled={showSkeleton}
            onClick={refresh}
          >
            <LabIcon name="refresh" size={14} />
            <span>{showSkeleton ? '刷新中…' : '刷新'}</span>
          </RippleButton>
        </div>
      </section>

      {showSkeleton ? (
        <div className={styles.issueList} role="status" aria-busy="true" aria-label="正在加载问题日志">
          {Array.from({ length: 3 }, (_, idx) => (
            <article key={idx} className={styles.issueCard} aria-hidden="true">
              <div className={styles.issueCardTop}>
                <div className={styles.issueKindCluster}>
                  <SkeletonBlock variant="rect" width={132} height={24} radius={8} staggerIndex={idx} />
                  <SkeletonBlock variant="rect" width={68} height={22} radius={6} staggerIndex={idx + 1} />
                  <SkeletonBlock variant="pill" width={72} height={24} staggerIndex={idx + 2} />
                </div>
                <SkeletonBlock variant="pill" width={68} height={22} staggerIndex={idx + 1} />
              </div>
              <div className={styles.issueBodyGrid}>
                <SkeletonTextStack widths={['40%', '92%']} lineHeight={13} staggerIndex={idx} />
                <SkeletonTextStack widths={['40%', '88%']} lineHeight={13} staggerIndex={idx + 1} />
              </div>
              <div className={styles.issueFooter}>
                <SkeletonBlock variant="text" width={240} height={12} staggerIndex={idx} />
                <SkeletonBlock variant="pill" width={104} height={36} radius={18} staggerIndex={idx + 1} />
              </div>
            </article>
          ))}
        </div>
      ) : result?.error ? <p className={styles.inlineErrorBanner} role="alert">{result.error}</p> : pagedIssues.length === 0 ? (
        <div className={pageStyles.galleryEmptyCard}>
          <h2>{statusFilter === 'open' ? '没有待处理的问题' : '没有符合条件的问题记录'}</h2>
          <p>近 30 天内的异常记录会汇总在这里。</p>
        </div>
      ) : (
        <div className={styles.issueList}>
          {pagedIssues.map((issue) => {
            const meta = ISSUE_KIND_META[issue.kind] ?? { label: issue.kind, badgeTone: 'critical' }
            const isOpen = issue.status === 'open'
            const kindBadgeClass =
              meta.badgeTone === 'critical'
                ? styles.issueKindCritical
                : meta.badgeTone === 'delete'
                  ? styles.issueKindDelete
                  : styles.issueKindFallback

            return (
              <article
                key={issue.id}
                className={`${styles.issueCard} ${!isOpen ? styles.issueCardResolved : ''}`}
              >
                <div className={styles.issueCardTop}>
                  <div className={styles.issueKindCluster}>
                    <span
                      className={`${styles.issueKindBadge} ${kindBadgeClass}`}
                      title={issue.kind}
                    >
                      <Icon name="alert-circle" size={13} />
                      <span>{meta.label}</span>
                    </span>
                    <span className={styles.issueCodeChip}>{issue.errorCode}</span>
                    <span className={styles.occurrencePill}>
                      发生 {issue.occurrences} 次
                    </span>
                  </div>

                  <span className={isOpen ? pageStyles.statusOff : pageStyles.statusOn}>
                    {isOpen ? '待处理' : '已处理'}
                  </span>
                </div>

                {issue.kind === 'R2_FALLBACK' ? (
                  <div className={`${styles.scopeNotice} ${styles.scopeNoticeHighlight}`}>
                    <LabIcon name="check-circle" size={15} />
                    <span>
                      已改存本地，用户可正常看图，不会重复扣费或重新生图。
                    </span>
                  </div>
                ) : null}

                <div className={styles.issueBodyGrid}>
                  <div className={styles.issueFactBox}>
                    <span>影响</span>
                    <p>{issue.impact}</p>
                  </div>
                  <div className={styles.issueFactBox}>
                    <span>建议</span>
                    <p>{issue.advice}</p>
                  </div>
                </div>

                {(issue.taskId || issue.ownerId || issue.channelId || issue.bucketId) ? (
                  <div className={styles.issueContextRow}>
                    {issue.taskId ? (
                      <RippleButton
                        type="button"
                        className={styles.contextChipBtn}
                        onClick={() => copyContextId('任务 ID', issue.taskId!)}
                        title={issue.taskId}
                      >
                        <Icon name="copy" size={11} />
                        <span>任务 {shortUuid(issue.taskId)}</span>
                      </RippleButton>
                    ) : null}
                    {issue.ownerId ? (
                      <RippleButton
                        type="button"
                        className={styles.contextChipBtn}
                        onClick={() => copyContextId('用户 ID', issue.ownerId!)}
                        title={issue.ownerId}
                      >
                        <Icon name="copy" size={11} />
                        <span>用户 {shortUuid(issue.ownerId)}</span>
                      </RippleButton>
                    ) : null}
                    {issue.channelId ? (
                      <RippleButton
                        type="button"
                        className={styles.contextChipBtn}
                        onClick={() => copyContextId('渠道 ID', issue.channelId!)}
                        title={issue.channelId}
                      >
                        <Icon name="copy" size={11} />
                        <span>渠道 {shortUuid(issue.channelId)}</span>
                      </RippleButton>
                    ) : null}
                    {issue.bucketId ? (
                      <RippleButton
                        type="button"
                        className={styles.contextChipBtn}
                        onClick={() => copyContextId('桶 ID', issue.bucketId!)}
                        title={issue.bucketId}
                      >
                        <LabIcon name="cloud" size={11} />
                        <span>
                          桶 {shortUuid(issue.bucketId)}
                        </span>
                      </RippleButton>
                    ) : null}
                  </div>
                ) : null}

                <div className={styles.issueFooter}>
                  <div className={styles.issueTimeline}>
                    <span>
                      最近：{formatLocalDateTime(issue.lastSeen, true)}（{formatRelativeAge(issue.lastSeen, nowMs)}）
                    </span>
                    <span>首次：{formatLocalDateTime(issue.firstSeen, true)}（{formatRelativeAge(issue.firstSeen, nowMs)}）</span>
                  </div>

                  <div className={styles.issueActions}>
                    {isOpen && (
                        <RippleButton
                          type="button"
                          className={pageStyles.primaryBtn}
                          disabled={Boolean(resolving)}
                          onClick={() => onResolveIssue(issue.id)}
                        >
                          <Icon name="check" size={15} />
                          <span>标记已处理</span>
                        </RippleButton>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <div className={styles.paginationBar}>
        <span className={pageStyles.monoMeta}>
          第 {page + 1} / {totalPages} 页 · 共 {total} 条 · 记录保留 30 天，标记已处理不会重绘或删文件
        </span>
        <div className={styles.paginationControls}>
          <RippleButton
            type="button"
            className={styles.smallTonalBtn}
            disabled={showSkeleton || page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <Icon name="arrow-left" size={13} />
            <span>上一页</span>
          </RippleButton>
          <RippleButton
            type="button"
            className={styles.smallTonalBtn}
            disabled={showSkeleton || page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            <span>下一页</span>
            <Icon name="arrow-right" size={13} />
          </RippleButton>
        </div>
      </div>
    </div>
  )
}
