import { Icon } from '../components/Icon'
import { SkeletonBlock, SkeletonTextStack } from './Skeleton'
import styles from './Pages.module.css'

type AccountMode = 'login' | 'register' | 'password'

export function AccountShowcase({ authMode }: { authMode: AccountMode }) {
  return (
    <section className={styles.authShowcase}>
      <div className={styles.authBrandBadge}>
        <span className={styles.authGlyph}>
          <Icon name="banana" size={24} />
        </span>
        <div>
          <strong>NanoBanana Studio</strong>
          <span>Multi-User AI Darkroom</span>
        </div>
      </div>

      <h1 className={styles.authHeroTitle}>
        {authMode === 'password'
          ? '更新你的工作区密码'
          : authMode === 'register'
            ? '凭邀请码加入创作暗房'
            : '回到你的创作工作台'}
      </h1>

      <p className={styles.authHeroCopy}>
        作品和任务历史按账号隔离。共享渠道额度按北京时间每日统计。
      </p>

      <ul className={styles.securityHighlights}>
        <li>
          <Icon name="shield" size={16} />
          <span>HttpOnly 会话 Cookie + CSRF 保护，防跨站伪造</span>
        </li>
        <li>
          <Icon name="check" size={16} />
          <span>私有渠道 API Key 由服务端 AES-GCM 加密保管</span>
        </li>
        <li>
          <Icon name="sparkles" size={16} />
          <span>提交确认后即使关闭页面，后台队列仍继续完成生图</span>
        </li>
      </ul>
    </section>
  )
}

export function AccountSkeleton({ authMode }: { authMode: AccountMode }) {
  return (
    <div
    className={styles.authSplitCard}
    role="status"
    aria-busy="true"
    aria-label="正在连接会话"
  >
    <section className={styles.authShowcase} aria-hidden="true">
      <div className={styles.authBrandBadge}>
        <SkeletonBlock variant="rect" width={44} height={44} radius={14} />
        <div className={styles.skeletonListStack} style={{ gap: 6 }}>
          <SkeletonBlock variant="text" width={140} height={15} />
          <SkeletonBlock variant="text" width={116} height={11} staggerIndex={1} />
        </div>
      </div>

      <div className={styles.skeletonListStack} style={{ gap: 8 }}>
        <SkeletonBlock variant="text" width="84%" height={26} staggerIndex={1} />
        <SkeletonBlock variant="text" width="56%" height={26} staggerIndex={2} />
      </div>

      <SkeletonTextStack widths={['94%', '72%']} lineHeight={14} staggerIndex={2} />

      <div className={styles.securityHighlights} style={{ gap: 12 }}>
        {[76, 84, 70].map((pct, idx) => (
          <div key={idx} className={styles.skeletonRow}>
            <SkeletonBlock variant="circle" width={16} height={16} staggerIndex={idx} />
            <SkeletonBlock variant="text" width={`${pct}%`} height={13} staggerIndex={idx + 1} />
          </div>
        ))}
      </div>
    </section>

    <section className={styles.authFormPane} aria-hidden="true">
      <div className={styles.skeletonListStack} style={{ gap: 6 }}>
        <SkeletonBlock variant="text" width={110} height={11} />
        <SkeletonBlock variant="text" width={160} height={22} staggerIndex={1} />
      </div>

      <div className={styles.authForm}>
        <div className={styles.filledField}>
          <SkeletonBlock variant="text" width={146} height={12} />
          <SkeletonBlock variant="field" staggerIndex={0} />
        </div>
        <div className={styles.filledField}>
          <SkeletonBlock variant="text" width={128} height={12} />
          <SkeletonBlock variant="field" staggerIndex={1} />
        </div>
        {authMode !== 'login' ? (
          <div className={styles.filledField}>
            <SkeletonBlock variant="text" width={92} height={12} />
            <SkeletonBlock variant="field" staggerIndex={2} />
          </div>
        ) : null}

        <div className={styles.authActions}>
          <SkeletonBlock variant="pill" width="100%" height={44} radius={22} staggerIndex={2} />
          {authMode !== 'password' ? (
            <SkeletonBlock variant="pill" width="100%" height={44} radius={22} staggerIndex={3} />
          ) : null}
        </div>
      </div>
    </section>
  </div>
  )
}
