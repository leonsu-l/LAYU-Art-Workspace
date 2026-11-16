import { useEffect, useState, type FormEvent } from 'react'
import type { AdminUser, Invite, Settings, Template, Usage } from '@nanobanana/shared/types/studio'
import type { ProviderType, ProviderConfig } from '@nanobanana/shared/types/generation'
import { createDefaultProviderConfig } from '@nanobanana/shared/utils/configDefaults'
import { backendRequest, backendErrorMessage } from '../services/backendClient'
import { StudioHeader } from '../components/StudioHeader'
import { GenerationParamsPanel } from '../components/ConfigPanel'
import { ChannelManager } from './ChannelsPage'
import styles from './AccountPage.module.css'
export function AdminPage() {
  const [tab, setTab] = useState('channels')
  return <><StudioHeader /><main id="main" className={styles.page}><h1>站点管理</h1><nav className={styles.tabs} aria-label="管理分类">{Object.entries({ channels: '共享渠道', users: '用户', invites: '邀请码', settings: '额度与队列', templates: '参数模板', usage: '使用统计' }).map(([id, name]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{name}</button>)}</nav>
    {tab === 'channels' ? <ChannelManager scope="shared" /> : tab === 'users' ? <UsersAdmin /> : tab === 'invites' ? <InvitesAdmin /> : tab === 'settings' ? <SettingsAdmin /> : tab === 'templates' ? <TemplatesAdmin /> : <UsageAdmin />}
  </main></>
}
function UsersAdmin() {
  const [users, setUsers] = useState<AdminUser[]>([]); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false)
  async function load() { setUsers((await backendRequest<{ users: AdminUser[] }>('/admin/users')).users) }
  useEffect(() => { void load().catch((e) => setNotice(backendErrorMessage(e))) }, [])
  async function update(user: AdminUser, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setNotice('')
    const limit = String(data.get('dailyLimit') ?? '')
    const resetPassword = String(data.get('password') ?? '')
    if (resetPassword && (resetPassword.length < 12 || resetPassword.length > 1024)) { setNotice('重置密码须为 12–1024 个字符，不会自动截断。'); setBusy(false); return }
    try {
      await backendRequest(`/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ dailyLimit: limit === '' ? null : Number(limit), ...(user.role === 'USER' ? { enabled: data.get('enabled') === 'on' } : {}) }) })
      const password = String(data.get('password') ?? '')
      if (password && user.role === 'USER') await backendRequest(`/admin/users/${user.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) })
      form.reset(); await load(); setNotice('用户已更新；如重置密码，该用户下次登录须改密。')
    } catch (e) { setNotice(backendErrorMessage(e)) } finally { setBusy(false) }
  }
  return <><p>日额度留空继承站点，-1 无限，0 禁止共享调用。不显示用户提示词或图片。</p>{notice && <p role="status">{notice}</p>}{users.map((user) => <section className={styles.card} key={`${user.id}:${user.enabled}:${user.dailyLimit}`}><h2>{user.username} · {user.role}</h2><form className={styles.form} onSubmit={(e) => void update(user, e)}>{user.role === 'USER' && <label><input name="enabled" type="checkbox" defaultChecked={user.enabled} />启用账号</label>}<label className={styles.field}>日额度覆盖<input className={styles.input} name="dailyLimit" type="number" min={-1} step={1} defaultValue={user.dailyLimit ?? ''} /></label>{user.role === 'USER' && <label className={styles.field}>重置密码（12–1024 字符；留空不更改）<input className={styles.input} type="password" name="password" autoComplete="new-password" /></label>}<button disabled={busy}>保存用户设置</button></form></section>)}</>
}
function InvitesAdmin() {
  const [invites, setInvites] = useState<Invite[]>([]); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false)
  async function load() { setInvites((await backendRequest<{ invites: Invite[] }>('/admin/invites')).invites) }
  useEffect(() => { void load().catch((e) => setNotice(backendErrorMessage(e))) }, [])
  async function change(id?: string) { setBusy(true); try { await backendRequest(id ? `/admin/invites/${id}` : '/admin/invites', { method: id ? 'DELETE' : 'POST', ...(!id ? { body: '{}' } : {}) }); await load(); setNotice(id ? '邀请码已撤销。' : '邀请码已创建。') } catch (e) { setNotice(backendErrorMessage(e)) } finally { setBusy(false) } }
  return <section className={styles.card}><h2>无限次邀请码</h2><p>邀请码不过期、可无限注册普通用户；撤销后不能继续注册。</p><button disabled={busy} onClick={() => void change()}>创建邀请码</button>{notice && <p role="status">{notice}</p>}{invites.map((invite) => <div className={styles.actions} key={invite.id}><code>{invite.code}</code><span>{invite.enabled ? '有效' : '已撤销'} · 已注册 {invite.registrationCount}</span><button disabled={busy || !invite.enabled} onClick={() => void change(invite.id)}>撤销</button></div>)}</section>
}
function SettingsAdmin() {
  const [settings, setSettings] = useState<Settings | null>(null); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { void backendRequest<{ settings: Settings }>('/admin/settings').then((r) => setSettings(r.settings)).catch((e) => setNotice(backendErrorMessage(e))) }, [])
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); try { const body = Object.fromEntries(['defaultDailyLimit', 'globalConcurrency', 'perUserConcurrency', 'queueLimit'].map((key) => [key, data.get(key) === '' ? null : Number(data.get(key))])); setSettings((await backendRequest<{ settings: Settings }>('/admin/settings', { method: 'PUT', body: JSON.stringify(body) })).settings); setNotice('全站配置已保存。') } catch (e) { setNotice(`保存失败：${backendErrorMessage(e)}`) } finally { setBusy(false) } }
  return <section className={styles.card}><h2>共享额度、并发与队列</h2><p>默认日额度留空代表未配置共享生成，-1 为无限额，0 为禁止。按北京时间统计。</p>{notice && <p role="status">{notice}</p>}{settings && <form className={styles.form} onSubmit={(e) => void save(e)}>{([{ key: 'defaultDailyLimit', name: '默认日任务额度', min: -1 }, { key: 'globalConcurrency', name: '全站并发', min: 1, max: 32 }, { key: 'perUserConcurrency', name: '单人并发', min: 1, max: 32 }, { key: 'queueLimit', name: '队列上限', min: 1, max: 10000 }] as const).map((field) => <label className={styles.field} key={field.key}>{field.name}<input className={styles.input} type="number" step={1} name={field.key} min={field.min} max={'max' in field ? field.max : undefined} required={field.key !== 'defaultDailyLimit'} defaultValue={settings[field.key] ?? ''} /></label>)}<button disabled={busy}>保存全站配置</button></form>}</section>
}
function TemplatesAdmin() {
  const [templates, setTemplates] = useState<Template[]>([]); const [editing, setEditing] = useState<Template | null | undefined>(undefined)
  const [config, setConfig] = useState<ProviderConfig>(createDefaultProviderConfig); const [name, setName] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false)
  async function load() { setTemplates((await backendRequest<{ templates: Template[] }>('/templates')).templates) }
  useEffect(() => { void load().catch((e) => setNotice(backendErrorMessage(e))) }, [])
  function edit(template: Template | null) { const next = createDefaultProviderConfig(); if (template) { next.activeProvider = template.provider; Object.assign(next.profiles[template.provider].params, template.params) }; setConfig(next); setName(template?.name ?? ''); setEditing(template) }
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); try { await backendRequest(editing ? `/admin/templates/${editing.id}` : '/admin/templates', { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ name, provider: config.activeProvider, params: config.profiles[config.activeProvider].params }) }); await load(); setEditing(undefined); setNotice('模板已保存；不覆盖已有用户参数。') } catch (e) { setNotice(backendErrorMessage(e)) } finally { setBusy(false) } }
  async function remove(id: string) { if (!window.confirm('删除此参数模板？')) return; setBusy(true); try { await backendRequest(`/admin/templates/${id}`, { method: 'DELETE' }); await load(); setNotice('模板已删除。') } catch (e) { setNotice(backendErrorMessage(e)) } finally { setBusy(false) } }
  function params(provider: ProviderType, patch: object) { setConfig((previous) => ({ ...previous, profiles: { ...previous.profiles, [provider]: { ...previous.profiles[provider], params: { ...previous.profiles[provider].params, ...patch } } } }) as ProviderConfig) }
  return <><button onClick={() => edit(null)}>新增参数模板</button>{notice && <p role="status">{notice}</p>}{editing !== undefined && <form onSubmit={(e) => void save(e)} className={styles.card}><label className={styles.field}>模板名称<input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} required /></label><label className={styles.field}>协议<select value={config.activeProvider} onChange={(e) => setConfig((p) => ({ ...p, activeProvider: e.target.value as ProviderType }))}><option value="openai-compatible">OpenAI</option><option value="gemini-compatible">Gemini</option></select></label><GenerationParamsPanel config={config} activeProvider={config.activeProvider} activeProfile={config.profiles[config.activeProvider]} isHydrated={!busy} hasReferenceImages={false} onProfileChange={() => undefined} onOpenAIParamsChange={(patch) => params('openai-compatible', patch)} onGeminiParamsChange={(patch) => params('gemini-compatible', patch)} /><div className={styles.actions}><button disabled={busy}>保存模板</button><button type="button" onClick={() => setEditing(undefined)}>取消</button></div></form>}{templates.map((template) => <section className={styles.card} key={template.id}><h2>{template.name}</h2><p>{template.provider}</p><div className={styles.actions}><button disabled={busy} onClick={() => edit(template)}>编辑</button><button disabled={busy} onClick={() => void remove(template.id)}>删除</button></div></section>)}</>
}
function UsageAdmin() {
  const [usage, setUsage] = useState<Usage | null>(null); const [error, setError] = useState('')
  async function load() { try { setUsage(await backendRequest<Usage>('/admin/usage')); setError('') } catch (e) { setError(backendErrorMessage(e)) } }
  useEffect(() => { void load() }, [])
  return <section className={styles.card}><h2>非私密使用统计</h2><p>仅统计数量及任务状态，不含提示词、图片或密钥。</p><button onClick={() => void load()}>刷新统计</button>{error && <p role="alert">{error}</p>}{usage && <><h3>用户</h3><div className={styles.scroll}><table className={styles.table}><thead><tr><th>用户</th><th>总计</th><th>成功</th><th>失败</th><th>活动</th></tr></thead><tbody>{usage.users.map((item) => <tr key={item.userId}><td>{item.username}</td><td>{item.total}</td><td>{item.succeeded}</td><td>{item.failed}</td><td>{item.active}</td></tr>)}</tbody></table></div><h3>渠道</h3><div className={styles.scroll}><table className={styles.table}><thead><tr><th>渠道</th><th>总计</th><th>成功</th><th>失败</th><th>活动</th></tr></thead><tbody>{usage.channels.map((item) => <tr key={item.channelId}><td>{item.name}</td><td>{item.total}</td><td>{item.succeeded}</td><td>{item.failed}</td><td>{item.active}</td></tr>)}</tbody></table></div><h3>最近任务（最多 100 条）</h3><div className={styles.scroll}><table className={styles.table}><thead><tr><th>任务 ID</th><th>用户</th><th>渠道 ID</th><th>状态</th><th>创建时间</th></tr></thead><tbody>{usage.tasks.map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.username}</td><td>{item.channelId}</td><td>{item.status}</td><td>{item.createdAt}</td></tr>)}</tbody></table></div></>}</section>
}
