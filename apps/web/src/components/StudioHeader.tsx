import { useSession } from '../hooks/SessionContext'
import { NavLink } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'
import type { ThemeMode } from '../utils/theme'
import { Icon } from './Icon'
import styles from './StudioHeader.module.css'

const themeOptions: Array<{
  mode: ThemeMode
  label: string
  shortLabel: string
  icon: 'monitor' | 'sun' | 'moon'
}> = [
  { mode: 'system', label: '跟随系统主题', shortLabel: '系统', icon: 'monitor' },
  { mode: 'light', label: '切换浅色主题', shortLabel: '浅色', icon: 'sun' },
  { mode: 'dark', label: '切换深色主题', shortLabel: '深色', icon: 'moon' },
]

export function StudioHeader() {
  const { mode, resolvedTheme, setMode } = useTheme()
  const { user, logout } = useSession()

  return (
    <header className={styles.header}>
      <a className={styles.skip} href="#main">跳到主要内容</a>
      <div className={styles.inner}>
        <NavLink to="/" viewTransition className={styles.brand} aria-label="NanoBanana Studio 首页">
          <span className={styles.mark}><Icon name="banana" size={22} /></span>
          <span className={styles.wordmark}>
            nanobanana
            <small>STUDIO</small>
          </span>
        </NavLink>

        <nav className={styles.nav} aria-label="主导航">
          <NavLink
            to="/"
            end
            viewTransition
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            <Icon name="sparkles" size={16} />
            <span>创作工作台</span>
          </NavLink>
          <NavLink
            to="/gallery"
            viewTransition
            className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
          >
            <Icon name="film" size={16} />
            <span>我的图库</span>
          </NavLink>
          {user && <NavLink to="/password" className={styles.navLink}>修改密码</NavLink>}
          {user?.role === 'ADMIN' && <NavLink to="/admin" className={styles.navLink}>管理</NavLink>}
        </nav>

        <div className={styles.actions}>
          {user && <><span className={styles.localNote}>{user.username}</span><button className={styles.themeButton} onClick={() => void logout().catch(() => undefined)}>注销</button></>}

          <div
            className={styles.themeSwitch}
            role="group"
            aria-label={`界面主题（当前：${mode === 'system' ? `跟随系统 · ${resolvedTheme === 'dark' ? '深色' : '浅色'}` : mode === 'dark' ? '深色' : '浅色'}）`}
          >
            {themeOptions.map((option) => {
              const active = mode === option.mode
              return (
                <button
                  key={option.mode}
                  type="button"
                  className={`${styles.themeButton} ${active ? styles.themeActive : ''}`}
                  aria-pressed={active}
                  aria-label={option.label}
                  title={option.label}
                  onClick={() => setMode(option.mode)}
                >
                  <Icon name={option.icon} size={15} />
                  <span className={styles.themeText}>{option.shortLabel}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </header>
  )
}
