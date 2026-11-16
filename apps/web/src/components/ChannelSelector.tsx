import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ProviderType } from '@nanobanana/shared/types/generation'
import type { Channel, ModelCatalog, Template, Quota } from '@nanobanana/shared/types/studio'
import { M3Select } from './ui/M3Select'
import styles from './ConfigPanel.module.css'
export function ChannelSelector({ channels, channelId, provider, model, catalog, templates, quota, error, saveStatus, isHydrated, onChannel, onProvider, onModel, onTemplate }: {
  channels: Channel[]; channelId?: string; provider: ProviderType; model: string; catalog: ModelCatalog | null; templates: Template[]; quota: Quota | null; error: string | null; saveStatus: string; isHydrated: boolean;
  onChannel: (id: string) => void; onProvider: (provider: ProviderType) => void; onModel: (id: string) => void; onTemplate: (template: Template) => void;
}) {
  const [scope, setScope] = useState<'shared' | 'private'>('shared')
  const channel = channels.find((item) => item.id === channelId)
  const activeScope = channel?.scope ?? scope
  const visible = channels.filter((item) => item.scope === activeScope && item.provider === provider)
  const models = catalog?.models ?? []
  return <section id="connection-settings" className={styles.panel} aria-label="渠道与模型"><header className={styles.sectionHeader}><h2 className={styles.title}>渠道与模型</h2><Link to="/channels">管理自定义渠道</Link></header>
    <div className={styles.segmented} role="group" aria-label="渠道来源">{(['shared', 'private'] as const).map((value) => <button key={value} className={styles.protocolButton} aria-pressed={activeScope === value} onClick={() => { setScope(value); onChannel('') }}>{value === 'shared' ? '站点默认渠道' : '自定义渠道'}</button>)}</div>
    <div className={styles.segmented} role="group" aria-label="协议">{(['openai-compatible', 'gemini-compatible'] as const).map((value) => <button key={value} className={styles.protocolButton} aria-pressed={provider === value} onClick={() => { setScope(activeScope); onProvider(value) }}>{value === 'openai-compatible' ? 'OpenAI' : 'Gemini'}</button>)}</div>
    <label className={styles.field}><span className={styles.label}>具体渠道</span><M3Select value={channelId ?? ''} options={[{ value: '', label: '请选择渠道' }, ...visible.map((item) => ({ value: item.id, label: `${item.name}${item.enabled ? '' : '（已停用）'}`, disabled: !item.enabled }))]} onChange={onChannel} />{channelId && !channel && <span role="alert">原渠道已不可用，请手动重新选择。</span>}</label>
    <label className={styles.field}><span className={styles.label}>模型目录</span><M3Select value={model} disabled={!channel} options={[{ value: '', label: '请选择模型' }, ...models.map((item) => ({ value: item.id, label: item.name || item.id }))]} onChange={onModel} /></label>
    {channel?.scope === 'private' && <label className={styles.field}><span className={styles.label}>模型 ID（可手填）</span><input className={styles.input} value={model} onChange={(e) => onModel(e.target.value)} spellCheck={false} /></label>}
    {channel?.scope === 'shared' && model && !channel.enabledModels.includes(model) && <p role="alert">所选模型已停用，请手动选择管理员启用的模型。</p>}
    {catalog?.error && <p role="status">目录刷新失败：{catalog.error}；保留上次目录。</p>}{catalog?.stale && <p className={styles.fieldHint}>目录缓存已过期，可由渠道管理者刷新。</p>}
    <label className={styles.field}><span className={styles.label}>参数模板（仅预填，不切换模型或渠道）</span><M3Select value="" disabled={!isHydrated} options={[{ value: '', label: '选择模板预填' }, ...templates.filter((item) => item.provider === provider).map((item) => ({ value: item.id, label: item.name }))]} onChange={(id) => { const template = templates.find((item) => item.id === id); if (template) onTemplate(template) }} /></label>
    <p className={styles.fieldHint} role="status">{saveStatus || '参数按账号、渠道与模型保存。'} 目录中的模型不保证支持图片生成。</p>
    {quota && <p className={styles.fieldHint}>共享额度：{!quota.configured ? '管理员尚未配置，暂不可调用' : quota.unlimited ? '无限额' : `剩余 ${quota.remaining ?? 0} / ${quota.limit ?? 0}`} · 今日使用 {quota.used} · 私有渠道不占共享额度</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
