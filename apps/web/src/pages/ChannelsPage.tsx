import { useEffect, useState, type FormEvent } from 'react'
import type { Channel, ModelCatalog } from '@nanobanana/shared/types/studio'
import type { ProviderType } from '@nanobanana/shared/types/generation'
import { backendRequest, backendErrorMessage } from '../services/backendClient'
import styles from './AccountPage.module.css'
export function ChannelsPage() { return <><main id="main" className={styles.page}><h1>我的自定义渠道</h1><ChannelManager scope="private" /></main></> }
export function ChannelManager({ scope }: { scope: 'shared' | 'private' }) {
  const [channels, setChannels] = useState<Channel[]>([]); const [editing, setEditing] = useState<Channel | null | undefined>(undefined)
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false)
  async function refresh() { const response = await backendRequest<{ channels: Channel[] }>('/channels'); setChannels(response.channels.filter((item) => item.scope === scope && item.canManage)) }
  useEffect(() => { void refresh().catch((e) => setNotice(backendErrorMessage(e))) }, [scope])
  async function remove(channel: Channel) {
    if (!window.confirm(`删除渠道“${channel.name}”？排队任务会停止，历史作品保留。`)) return
    setBusy(true)
    try { await backendRequest(`/channels/${channel.id}`, { method: 'DELETE' }); await refresh(); setNotice('渠道已删除。') } catch (e) { setNotice(backendErrorMessage(e)) } finally { setBusy(false) }
  }
  return <><div className={styles.actions}><button disabled={busy} onClick={() => setEditing(null)}>新增{scope === 'shared' ? '共享' : '自定义'}渠道</button><button disabled={busy} onClick={() => void refresh().catch((e) => setNotice(backendErrorMessage(e)))}>刷新列表</button></div>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {editing !== undefined && <ChannelEditor key={editing?.id ?? 'new'} channel={editing} scope={scope} onClose={() => setEditing(undefined)} onSaved={async () => { setEditing(undefined); await refresh(); setNotice('渠道已保存。') }} />}
    {channels.map((channel) => <section key={channel.id} className={styles.card}><h2>{channel.name}</h2><p>{channel.provider} · {channel.enabled ? '启用' : '停用'} · {channel.hasApiKey ? '密钥已设置（只写）' : '未设置密钥'}</p><p>{channel.baseUrl}</p><div className={styles.actions}><button disabled={busy} onClick={() => setEditing(channel)}>编辑渠道与模型</button><button disabled={busy} onClick={() => void remove(channel)}>删除渠道</button></div></section>)}
    {!channels.length && <p>尚无渠道。新增后可刷新模型目录，或手填模型 ID。</p>}
  </>
}
function ChannelEditor({ channel, scope, onClose, onSaved }: { channel: Channel | null; scope: 'shared' | 'private'; onClose: () => void; onSaved: () => Promise<void> }) {
  const [provider, setProvider] = useState<ProviderType>(channel?.provider ?? 'openai-compatible')
  const [enabledModels, setEnabledModels] = useState(channel?.enabledModels.join('\n') ?? '')
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { if (channel) void backendRequest<ModelCatalog>(`/channels/${channel.id}/models`).then(setCatalog).catch((e) => setError(backendErrorMessage(e))) }, [channel])
  async function refreshModels() { if (!channel) return; setBusy(true); setError(''); try { setCatalog(await backendRequest<ModelCatalog>(`/channels/${channel.id}/models/refresh`, { method: 'POST', body: '{}' })) } catch (e) { setError(backendErrorMessage(e)) } finally { setBusy(false) } }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setError('')
    const body = { name: data.get('name'), provider, baseUrl: data.get('baseUrl'), apiKey: data.get('apiKey'), enabled: data.get('enabled') === 'on', enabledModels: Array.from(new Set(enabledModels.split(/\r?\n/).map((id) => id.trim()).filter(Boolean))), ...(!channel ? { scope } : {}) }
    try { await backendRequest(channel ? `/channels/${channel.id}` : '/channels', { method: channel ? 'PUT' : 'POST', body: JSON.stringify(body) }); form.reset(); await onSaved() } catch (e) { setError(backendErrorMessage(e)) } finally { setBusy(false) }
  }
  const selected = enabledModels.split(/\r?\n/).filter(Boolean)
  return <section className={styles.card}><h2>{channel ? '编辑渠道' : '新增渠道'}</h2><form className={styles.form} onSubmit={(e) => void submit(e)}><label className={styles.field}>名称<input className={styles.input} name="name" defaultValue={channel?.name ?? ''} required /></label>
    <label className={styles.field}>协议<select value={provider} onChange={(e) => setProvider(e.target.value as ProviderType)}><option value="openai-compatible">OpenAI</option><option value="gemini-compatible">Gemini</option></select></label>
    <label className={styles.field}>Base URL<input className={styles.input} type="url" name="baseUrl" defaultValue={channel?.baseUrl ?? ''} required /></label>
    <label className={styles.field}>新密钥（只写，留空保留原值）<input className={styles.input} type="password" name="apiKey" autoComplete="new-password" required={!channel} /></label>
    <label><input type="checkbox" name="enabled" defaultChecked={channel?.enabled ?? true} />启用渠道</label>
    <label className={styles.field}>启用 / 手填模型 ID（每行一个）<textarea className={styles.input} rows={5} value={enabledModels} onChange={(e) => setEnabledModels(e.target.value)} /></label>
    {catalog && <div><p>发现目录 {catalog.updatedAt ?? '尚未刷新'} {catalog.stale ? '（缓存过期）' : ''}</p>{catalog.models.map((model) => <label className={styles.field} key={model.id}><span><input type="checkbox" checked={selected.includes(model.id)} onChange={(e) => setEnabledModels((e.target.checked ? [...selected, model.id] : selected.filter((id) => id !== model.id)).join('\n'))} />{model.name || model.id} · {model.id}</span></label>)}{catalog.error && <p role="alert">刷新失败，保留旧目录：{catalog.error}</p>}</div>}
    {error && <p role="alert">{error}</p>}<div className={styles.actions}><button disabled={busy}>保存渠道</button>{channel && <button type="button" disabled={busy} onClick={() => void refreshModels()}>发现 / 刷新模型</button>}<button type="button" disabled={busy} onClick={onClose}>取消</button></div>
  </form><p>模型目录不保证图片能力。共享用户只能选择显式启用的 ID。密钥不会回显或保存在浏览器。</p></section>
}
