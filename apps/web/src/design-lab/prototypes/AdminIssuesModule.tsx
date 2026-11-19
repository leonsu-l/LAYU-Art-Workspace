import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { SegmentedRail, StudioSelect } from '../components/LabControls'
import { LabIcon } from '../components/LabIcon'
import { RippleButton } from '../components/LabRipple'
import { SkeletonBlock, SkeletonTextStack } from '../components/LabSkeleton'
import type { SnackbarPayload } from '../components/useSnackbar'
import type {
  AdminIssueKind,
  AdminIssueRecord,
  AdminIssueStatus,
  R2BucketInfo,
} from '../mockData'
import { formatLocalDateTime, formatRelativeAge } from '../utils/retentionFormat'
import type { LabLoadMode } from './MultiPagePrototypes'
import pageStyles from './MultiPagePrototypes.module.css'
import styles from './AdminModules.module.css'

const ISSUE_KIND_META: Record<
  AdminIssueKind,
  { label: string; badgeTone: 'fallback' | 'delete' | 'critical' }
> = {
  GENERATION_FAILED: { label: '生图任务失败', badgeTone: 'critical' },
  R2_FALLBACK: { label: 'R2 回退本地存储', badgeTone: 'fallback' },
  IMAGE_WRITE_FAILED: { label: '图片保存未完成', badgeTone: 'critical' },
  IMAGE_READ_FAILED: { label: '有效图片读取失败', badgeTone: 'critical' },
  IMAGE_DELETE_FAILED: { label: '物理清理未完成', badgeTone: 'delete' },
}

function shortUuid(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

export function AdminIssuesModule({
  issues,
  openCount,
  buckets,
  loadMode = 'ready',
  onResolveIssue,
  onSimulateRecur,
  onSimulate404Resolve,
  onNotify,
}: {
  issues: AdminIssueRecord[]
  openCount: number
  buckets: R2BucketInfo[]
  loadMode?: LabLoadMode
  onResolveIssue: (id: string) => void
  onSimulateRecur: (id: string) => void
  onSimulate404Resolve: (id: string) => void
  onNotify: (payload: SnackbarPayload) => void
}) {
  const [statusFilter, setStatusFilter] = useState<'all' | AdminIssueStatus>('open')
  const [pageSize, setPageSize] = useState<'3' | '10' | '20'>('10')
  const [page, setPage] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const refreshTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
    }
  }, [])

  const showSkeleton = loadMode === 'loading' || isRefreshing

  // Backend sorts by lastSeen DESC
  const filtered = issues
    .filter((issue) => (statusFilter === 'all' ? true : issue.status === statusFilter))
    .slice()
    .sort((a, b) => b.lastSeen - a.lastSeen)

  const numericSize = Number(pageSize)
  const totalPages = Math.max(1, Math.ceil(filtered.length / numericSize))
  const safePage = Math.min(page, totalPages - 1)
  const pagedIssues = filtered.slice(safePage * numericSize, (safePage + 1) * numericSize)

  function copyContextId(label: string, value: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(value).catch(() => {})
    }
    onNotify({
      tone: 'info',
      message: `已复制 ${label}：${value}`,
    })
  }

  return (
    <div className={styles.moduleStack}>
      {/* Summary & Query Filter Bar (/api/admin/issues/summary + /api/admin/issues) */}
      <section className={styles.issuesToolbar} aria-label="问题日志筛选与概览">
        <div className={styles.issuesFilterGroup}>
          <span className={pageStyles.policyPill}>
            <LabIcon name="bell" size={14} />
            <span>待处理问题：{openCount} 条（非累计次数）</span>
          </span>

          <SegmentedRail<'all' | AdminIssueStatus>
            label="按处理状态筛选"
            value={statusFilter}
            options={[
              { value: 'open', label: `未处理 (${openCount})` },
              { value: 'resolved', label: `已处理 (${issues.length - openCount})` },
              { value: 'all', label: `全部 (${issues.length})` },
            ]}
            onChange={(next) => {
              setStatusFilter(next)
              setPage(0)
            }}
          />
        </div>

        <div className={styles.issuesRightControls}>
          <div style={{ minWidth: 146 }}>
            <StudioSelect<'3' | '10' | '20'>
              label="每页条数"
              value={pageSize}
              options={[
                { value: '3', label: '每页 3 条' },
                { value: '10', label: '每页 10 条' },
                { value: '20', label: '每页 20 条' },
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
            onClick={() => {
              if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
              setIsRefreshing(true)
              refreshTimerRef.current = window.setTimeout(() => {
                setNowMs(Date.now())
                setIsRefreshing(false)
                onNotify({
                  tone: 'info',
                  message: '已刷新站内待处理问题摘要与分页列表。',
                })
              }, 750)
            }}
          >
            <LabIcon name="refresh" size={14} />
            <span>{showSkeleton ? '刷新中…' : '刷新日志'}</span>
          </RippleButton>
        </div>
      </section>

      <div className={styles.scopeNotice}>
        <Icon name="shield" size={15} />
        <span>
          <strong>安全与重试边界：</strong>
          仅管理员可见站内日志；不含用户提示词、图片、上游原始响应或凭据。标记「已处理」<strong>不会</strong>触发重绘或文件改动，同一问题再次发生会自动累计次数并重开为 <code>open</code>（按最近发生时间保留 30 天）。
        </span>
      </div>

      {/* Issues Feed */}
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
      ) : pagedIssues.length === 0 ? (
        <div className={pageStyles.galleryEmptyCard}>
          <span className={pageStyles.pageEyebrow}>OPERATIONAL ISSUES · CLEAR</span>
          <h2>{statusFilter === 'open' ? '当前没有待处理问题' : '该筛选下暂无问题记录'}</h2>
          <p>
            当出现生图失败、R2 写入失败回退本地、保存失败、读图失败或清理未完成时，服务端会自动汇总指纹并呈现于此处；可切换筛选查看已处理历史记录。
          </p>
        </div>
      ) : (
        <div className={styles.issueList}>
          {pagedIssues.map((issue) => {
            const meta = ISSUE_KIND_META[issue.kind]
            const isOpen = issue.status === 'open'
            const matchedBucket = issue.bucketId
              ? buckets.find((b) => b.id === issue.bucketId)
              : undefined
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
                    <span className={`${styles.issueKindBadge} ${kindBadgeClass}`}>
                      <Icon name="alert-circle" size={13} />
                      <span>{meta.label}</span>
                      <code>{issue.kind}</code>
                    </span>
                    <span className={styles.issueCodeChip}>{issue.errorCode}</span>
                    <span className={styles.occurrencePill}>
                      累计 {issue.occurrences} 次
                    </span>
                  </div>

                  <span className={isOpen ? pageStyles.statusOff : pageStyles.statusOn}>
                    {isOpen ? 'OPEN · 待处理' : 'RESOLVED · 已处理'}
                  </span>
                </div>

                {issue.kind === 'R2_FALLBACK' ? (
                  <div className={`${styles.scopeNotice} ${styles.scopeNoticeHighlight}`}>
                    <LabIcon name="check-circle" size={15} />
                    <span>
                      回退告警不等于生图失败：若备用本地存储写入成功，用户仍可正常查看与下载作品；服务端不会因回退重新调用上游。
                    </span>
                  </div>
                ) : null}

                <div className={styles.issueBodyGrid}>
                  <div className={styles.issueFactBox}>
                    <span>业务影响（服务端安全摘要）</span>
                    <p>{issue.impact}</p>
                  </div>
                  <div className={styles.issueFactBox}>
                    <span>排查建议</span>
                    <p>{issue.advice}</p>
                  </div>
                </div>

                {/* Nullable Context UUIDs */}
                {(issue.taskId || issue.ownerId || issue.channelId || issue.bucketId) ? (
                  <div className={styles.issueContextRow}>
                    {issue.taskId ? (
                      <RippleButton
                        type="button"
                        className={styles.contextChipBtn}
                        onClick={() => copyContextId('taskId', issue.taskId!)}
                        title={`点击复制 taskId: ${issue.taskId}`}
                      >
                        <Icon name="copy" size={11} />
                        <span>task: {shortUuid(issue.taskId)}</span>
                      </RippleButton>
                    ) : null}
                    {issue.ownerId ? (
                      <RippleButton
                        type="button"
                        className={styles.contextChipBtn}
                        onClick={() => copyContextId('ownerId', issue.ownerId!)}
                        title={`点击复制 ownerId: ${issue.ownerId}`}
                      >
                        <Icon name="copy" size={11} />
                        <span>owner: {shortUuid(issue.ownerId)}</span>
                      </RippleButton>
                    ) : null}
                    {issue.channelId ? (
                      <RippleButton
                        type="button"
                        className={styles.contextChipBtn}
                        onClick={() => copyContextId('channelId', issue.channelId!)}
                        title={`点击复制 channelId: ${issue.channelId}`}
                      >
                        <Icon name="copy" size={11} />
                        <span>channel: {shortUuid(issue.channelId)}</span>
                      </RippleButton>
                    ) : null}
                    {issue.bucketId ? (
                      <RippleButton
                        type="button"
                        className={styles.contextChipBtn}
                        onClick={() => copyContextId('bucketId', issue.bucketId!)}
                        title={`点击复制 bucketId: ${issue.bucketId}`}
                      >
                        <LabIcon name="cloud" size={11} />
                        <span>
                          bucket: {matchedBucket ? matchedBucket.bucketName : shortUuid(issue.bucketId)}
                        </span>
                      </RippleButton>
                    ) : null}
                  </div>
                ) : null}

                <div className={styles.issueFooter}>
                  <div className={styles.issueTimeline}>
                    <span title={`Unix ms: ${issue.lastSeen}`}>
                      最近发生：{formatLocalDateTime(issue.lastSeen, true)}（{formatRelativeAge(issue.lastSeen, nowMs)}）
                    </span>
                    <span title={`Unix ms: ${issue.firstSeen}`}>
                      首次：{formatLocalDateTime(issue.firstSeen, false)}
                    </span>
                  </div>

                  <div className={styles.issueActions}>
                    {isOpen ? (
                      <>
                        <RippleButton
                          type="button"
                          className={styles.smallTonalBtn}
                          onClick={() => onSimulate404Resolve(issue.id)}
                          title="演示该问题已过 30 天保留期或不存在时服务端返回 404"
                        >
                          模拟 404 过期
                        </RippleButton>
                        <RippleButton
                          type="button"
                          className={pageStyles.primaryBtn}
                          onClick={() => onResolveIssue(issue.id)}
                        >
                          <Icon name="check" size={15} />
                          <span>标记已处理</span>
                        </RippleButton>
                      </>
                    ) : (
                      <RippleButton
                        type="button"
                        className={pageStyles.tonalBtn}
                        onClick={() => onSimulateRecur(issue.id)}
                        title="演示相同指纹问题再次发生时，occurrences +1 并重新变为 open"
                      >
                        <LabIcon name="refresh" size={14} />
                        <span>模拟再次发生（重开）</span>
                      </RippleButton>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Pagination Bar */}
      <div className={styles.paginationBar}>
        <span className={pageStyles.monoMeta}>
          GET /api/admin/issues?page={safePage}&amp;size={pageSize}
          {statusFilter !== 'all' ? `&status=${statusFilter}` : ''} · 第 {safePage + 1} / {totalPages} 页 · 共 {filtered.length} 条
        </span>
        <div className={styles.paginationControls}>
          <RippleButton
            type="button"
            className={styles.smallTonalBtn}
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <Icon name="arrow-left" size={13} />
            <span>上一页</span>
          </RippleButton>
          <RippleButton
            type="button"
            className={styles.smallTonalBtn}
            disabled={safePage >= totalPages - 1}
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
