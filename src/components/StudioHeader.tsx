import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import styles from './StudioHeader.module.css'

export function StudioHeader() {
  return (
    <header className={styles.header}>
      <a className={styles.skip} href="#main">跳到主要内容</a>
      <div className={styles.inner}>
        <NavLink to="/" className={styles.brand} aria-label="NanoBanana Studio 首页">
          <span className={styles.mark}><Icon name="banana" size={23} /></span>
          <span className={styles.wordmark}>
            nanobanana
            <small>STUDIO · 暗房</small>
          </span>
        </NavLink>
        <nav className={styles.nav} aria-label="主导航">
          <NavLink to="/" end className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            <Icon name="sparkles" size={16} />
            <span>创作工作台</span>
          </NavLink>
          <NavLink to="/gallery" className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
            <Icon name="film" size={16} />
            <span>我的图库</span>
          </NavLink>
        </nav>
        <p className={styles.localNote}>
          <span className={styles.dot} aria-hidden="true" />
          本地暗房 · 密钥只留在这个浏览器
        </p>
      </div>
      <div className="sprocket" aria-hidden="true" />
    </header>
  )
}
