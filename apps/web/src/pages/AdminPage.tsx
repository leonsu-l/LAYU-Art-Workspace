import { useState, type FormEvent, type ReactNode } from 'react'
import type { AdminUser, Invite, Settings, Template, Usage } from '@nanobanana/shared/types/studio'
import type { ProviderConfig, ProviderType } from '@nanobanana/shared/types/generation'
import { createDefaultProviderConfig } from '@nanobanana/shared/utils/configDefaults'
import { backendRequest, backendErrorMessage } from '../services/backendClient'
import { useStudioResource } from '../hooks/useStudioResource'
import { GenerationParamsPanel } from '../components/ConfigPanel'
import { Icon } from '../components/Icon'
import { M3PrimaryTabs, SegmentedRail } from '../studio/Controls'
import { RippleButton } from '../studio/Ripple'
import { SkeletonBlock } from '../studio/Skeleton'
import { useNotify } from '../studio/useNotify'
import { ChannelManager } from './ChannelsPage'
import styles from '../studio/Pages.module.css'

const sections = [
  { id: 'channels', label: '共享渠道' }, { id: 'users', label: '用户管理' }, { id: 'invites', label: '邀请码' },
  { id: 'settings', label: '额度与队列' }, { id: 'templates', label: '参数模板' }, { id: 'usage', label: '使用统计' },
] as const
export function AdminPage() {
  const [tab, setTab] = useState<typeof sections[number]['id']>('users')
  return <main id="main" className={styles.pageWrap}>
    <header className={styles.pageHeader}><div className={styles.pageTitleGroup}><span className={styles.pageEyebrow}>SITE ADMINISTRATION</span><h1 className={styles.pageTitle}>站点管理台</h1><p className={styles.pageSub}>管理共享渠道、成员额度、邀请码、队列并发、参数模板与使用统计。</p></div></header>
    <div className={styles.adminNavWrap}><M3PrimaryTabs label="站点管理模块" variant="scrollable" value={tab} items={sections} onChange={setTab} /></div>
    <div key={tab} className={`${styles.subPanelFade} ${styles.adminSection}`}>
      {tab === 'channels' ? <ChannelManager scope="shared" /> : tab === 'users' ? <UsersAdmin /> : tab === 'invites' ? <InvitesAdmin /> : tab === 'settings' ? <SettingsAdmin /> : tab === 'templates' ? <TemplatesAdmin /> : <UsageAdmin />}
    </div></main>
}
function LoadState({ error, reload, label }: { error: string; reload: () => void; label: string }) {
  return error ? <div className={styles.sectionNote} role="alert">{error} <RippleButton type="button" className={styles.tonalBtn} onClick={reload}>重试</RippleButton></div>
    : <div className={styles.detailCard} role="status" aria-label={`正在加载${label}`}><SkeletonBlock variant="text" width="35%" /><SkeletonBlock variant="field" /><SkeletonBlock variant="field" staggerIndex={1} /></div>
}
function UsersAdmin() {
  const { data, setData, error, reload } = useStudioResource<{ users: AdminUser[] }>('/admin/users')
  const notify = useNotify(), [busy, setBusy] = useState(false), [failure, setFailure] = useState('')
  async function update(user: AdminUser, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    const form = event.currentTarget, fields = new FormData(form), limit = fields.get('dailyLimit'), password = String(fields.get('password') ?? '')
    setFailure('')
    if (password && (password.length < 12 || password.length > 1024)) { setFailure('重置密码须为 12–1024 个字符。'); return }
    setBusy(true)
    let settingsSaved = false
    try {
      const {user: updated} = await backendRequest<{user: AdminUser}>(`/admin/users/${user.id}`, {method: 'PATCH', body: JSON.stringify({dailyLimit: limit === '' ? null : Number(limit), ...(user.role === 'USER' ? {enabled: fields.get('enabled') === 'on'} : {})})})
      settingsSaved = true
      setData((old) => old && ({users: old.users.map((u) => u.id === user.id ? updated : u)}))
      if (password && user.role === 'USER') {
        await backendRequest(`/admin/users/${user.id}/reset-password`, {method: 'POST', body: JSON.stringify({password})})
        const field = form.elements.namedItem('password'); if (field instanceof HTMLInputElement) field.value = ''
        setData((old) => old && ({users: old.users.map((u) => u.id === user.id ? {...u, mustChangePassword: true} : u)}))
      }
      notify({tone: 'success', message: password ? '新密码已设置，该成员下次登录须改密。' : `已保存 ${user.username} 的设置。`})
    } catch (e) { setFailure(`${settingsSaved ? '账号设置已保存，重置密码未确认：' : ''}${backendErrorMessage(e)}`) } finally { setBusy(false) }
  }
  if (!data) return <LoadState label="用户列表" error={error} reload={reload} />
  return <><p className={styles.sectionNote}>日额度留空继承站点默认；-1 为无限，0 为禁止共享调用。这里只显示账号与额度。</p>
    {failure && <p role="alert" className={styles.cautionBanner}>{failure}</p>}
    <div className={styles.adminGrid}>{data.users.map((u) => <form aria-label={`${u.username} 的设置`} className={styles.adminCard} key={u.id} onSubmit={(e) => void update(u, e)}>
      <div className={styles.adminCardHead}><div><strong>{u.username}</strong><span className={u.role === 'ADMIN' ? styles.roleAdmin : styles.roleUser}>{u.role}</span></div><span className={u.enabled ? styles.statusOn : styles.statusOff}>{u.enabled ? '账号正常' : '已禁用'}</span></div>
      <fieldset disabled={busy} className={styles.adminUserFields}>
        <label className={styles.filledField}><span>日额度覆盖（空值继承）</span><input name="dailyLimit" type="number" step="1" min="-1" max="1000000" defaultValue={u.dailyLimit ?? ''} placeholder="继承站点默认" /></label>
        {u.role === 'USER' && <><label className={styles.filledField}><span>重置密码（12–1024 字符，留空不改）</span><input name="password" type="password" autoComplete="new-password" /></label><label><input type="checkbox" name="enabled" defaultChecked={u.enabled} /> 启用账号</label></>}
      </fieldset><div className={styles.adminCardFooter}><span className={styles.monoMeta}>{u.mustChangePassword ? '下次登录须改密' : '密码状态正常'}</span><RippleButton className={styles.tonalBtn} disabled={busy}>保存设置</RippleButton></div>
    </form>)}</div></>
}
function InvitesAdmin() {
  const { data, setData, reload, error } = useStudioResource<{ invites: Invite[] }>('/admin/invites')
  const notify = useNotify(), [busy, setBusy] = useState(false), [failure, setFailure] = useState('')
  async function change(id?: string) {
    if (busy || (id && !window.confirm('撤销此邀请码？已注册成员不受影响。'))) return
    setBusy(true); setFailure('')
    try {
      if (id) { await backendRequest(`/admin/invites/${id}`, {method: 'DELETE'}); setData((old) => old && ({invites: old.invites.map((i) => i.id === id ? {...i, enabled: false} : i)})) }
      else { const {invite} = await backendRequest<{invite: Invite}>('/admin/invites', {method: 'POST', body: '{}'}); setData((old) => ({invites: [invite, ...(old?.invites ?? [])]})) }
      notify({tone: 'success', message: id ? '邀请码已撤销。' : '邀请码已创建。'})
    } catch (e) { setFailure(backendErrorMessage(e)) } finally { setBusy(false) }
  }
  if (!data) return <LoadState label="邀请码" error={error} reload={reload} />
  return <><div className={styles.toolbarCard}><span className={styles.sectionNoteInline}>邀请码不过期，可重复注册普通成员；撤销后立即停止注册。</span><RippleButton className={styles.primaryBtn} disabled={busy} onClick={() => void change()}><Icon name="plus" size={14} />创建邀请码</RippleButton></div>
    {failure && <p className={styles.cautionBanner} role="alert">{failure}</p>}
    <div className={styles.inviteList}>{!data.invites.length && <p className={styles.sectionNote}>暂无邀请码。</p>}{data.invites.map((i) => <div className={styles.inviteRow} key={i.id}><code className={styles.inviteCode}>{i.code}</code><span className={i.enabled ? styles.statusOn : styles.statusOff}>{i.enabled ? '有效' : '已撤销'}</span><span className={styles.monoMeta}>已注册 {i.registrationCount} 人</span>
      <div className={styles.inviteActions}><RippleButton className={styles.tonalBtn} disabled={!i.enabled} onClick={async () => { try { await navigator.clipboard.writeText(i.code); notify({message: '邀请码已复制。'}) } catch { notify({tone: 'warning', message: '未能写入剪贴板，请选中邀请码复制。'}) } }}>复制</RippleButton><RippleButton className={styles.dangerTonalBtn} disabled={busy || !i.enabled} onClick={() => void change(i.id)}>撤销</RippleButton></div></div>)}</div></>
}
const settingFields = [
  {key: 'defaultDailyLimit', label: '默认日任务额度（留空关闭共享；-1 无限；0 禁止）', min: -1, max: 1000000},
  {key: 'globalConcurrency', label: '全站总并发（1–32）', min: 1, max: 32}, {key: 'perUserConcurrency', label: '单人并发上限（1–32）', min: 1, max: 32},
  {key: 'queueLimit', label: '排队队列上限（1–10000）', min: 1, max: 10000},
] as const
function SettingsAdmin() {
  const {data, setData, error, reload} = useStudioResource<{settings: Settings}>('/admin/settings')
  const notify = useNotify(), [busy, setBusy] = useState(false), [failure, setFailure] = useState('')
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    const fields = new FormData(event.currentTarget); setBusy(true); setFailure('')
    try { const body = Object.fromEntries(settingFields.map(({key}) => [key, fields.get(key) === '' ? null : Number(fields.get(key))])); setData(await backendRequest<{settings: Settings}>('/admin/settings', {method: 'PUT', body: JSON.stringify(body)})); notify({tone: 'success', message: '全站配置已保存。'}) }
    catch (e) { setFailure(backendErrorMessage(e)) } finally { setBusy(false) }
  }
  if (!data) return <LoadState label="额度与队列设置" error={error} reload={reload} />
  return <form className={styles.detailCard} onSubmit={(e) => void save(e)}><div className={styles.detailHeader}><div><span className={styles.pageEyebrow}>QUOTA & QUEUE POLICY</span><h2>共享额度与并发队列设置</h2></div><span className={styles.summaryPill}>按北京时间（Asia/Shanghai）日切</span></div>
    <fieldset className={styles.formGrid} disabled={busy}>{settingFields.map((f) => <label className={styles.filledField} key={f.key}><span>{f.label}</span><input type="number" step="1" name={f.key} min={f.min} max={f.max} required={f.key !== 'defaultDailyLimit'} defaultValue={data.settings[f.key] ?? ''} /></label>)}</fieldset>
    {failure && <p className={styles.cautionBanner} role="alert">{failure}</p>}<div className={styles.detailFooter}><span className={styles.monoMeta}>失败任务退回原提交日额度；删除终态任务不退额。</span><RippleButton className={styles.primaryBtn} disabled={busy}><Icon name="check" size={15} />保存全站配置</RippleButton></div></form>
}
function TemplatesAdmin() {
  const {data, setData, error, reload} = useStudioResource<{templates: Template[]}>('/templates')
  const [selected, setSelected] = useState<string | null>(null), [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false), notify = useNotify()
  if (!data) return <LoadState label="参数模板" error={error} reload={reload} />
  const template = selected === 'new' ? undefined : data.templates.find((t) => t.id === selected) ?? data.templates[0]
  async function remove(id: string) {
    if (!window.confirm('删除此参数模板？')) return
    setBusy(true)
    try { await backendRequest(`/admin/templates/${id}`, {method: 'DELETE'}); setData((old) => old && ({templates: old.templates.filter((t) => t.id !== id)})); setSelected(null); notify({message: '模板已删除。'}) }
    catch (e) { notify({tone: 'warning', message: backendErrorMessage(e)}) } finally { setBusy(false) }
  }
  return <div className={styles.splitWorkspace}><section className={styles.masterRail}><div className={styles.masterHead}><strong>参数模板列表</strong><span>{data.templates.length} 个</span></div>
    <RippleButton className={styles.tonalBtn} disabled={busy} onClick={() => setSelected('new')}><Icon name="plus" size={14} />新增参数模板</RippleButton>
    <div className={styles.channelCardStack}>{data.templates.map((t) => <RippleButton type="button" key={t.id} className={`${styles.channelItemCard} ${template?.id === t.id ? styles.channelItemActive : ''}`} disabled={busy} aria-pressed={template?.id === t.id} onClick={() => setSelected(t.id)}><span className={styles.channelItemTop}><strong>{t.name}</strong><span className={styles.protoTag}>{t.provider === 'openai-compatible' ? 'OpenAI' : 'Gemini'}</span></span><span className={styles.monoMeta}>{t.provider === 'openai-compatible' ? `${t.params.size || 'auto'} · ${t.params.quality || 'auto'} · ${t.params.n ?? 1} 张` : `${t.params.aspectRatio || 'auto'} · ${t.params.imageSize || 'auto'}`}</span></RippleButton>)}</div></section>
    <TemplateEditor key={`${template?.id ?? 'new'}:${revision}`} template={template} busy={busy} setBusy={setBusy} onRemove={remove} onCancel={() => { setSelected(null); setRevision((r) => r + 1) }}
      onSaved={(saved) => { setData((old) => ({templates: [...(old?.templates ?? []).filter((t) => t.id !== saved.id), saved]})); setSelected(saved.id); setRevision((r) => r + 1); notify({tone: 'success', message: '模板已保存。'}) }} /></div>
}
function TemplateEditor({ template, busy, setBusy, onRemove, onSaved, onCancel }: { template?: Template; busy: boolean; setBusy: (v: boolean) => void; onRemove: (id: string) => void; onSaved: (t: Template) => void; onCancel: () => void }) {
  const [config, setConfig] = useState(() => { const initial = createDefaultProviderConfig(); if (template) { initial.activeProvider = template.provider; Object.assign(initial.profiles[template.provider].params, template.params) }; return initial })
  const [failure, setFailure] = useState('')
  function params(provider: ProviderType, patch: object) { setConfig((p) => ({ ...p, profiles: {...p.profiles, [provider]: {...p.profiles[provider], params: {...p.profiles[provider].params, ...patch}}} }) as ProviderConfig) }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return
    const name = new FormData(event.currentTarget).get('name'); setFailure(''); setBusy(true)
    try { const result = await backendRequest<{template: Template}>(template ? `/admin/templates/${template.id}` : '/admin/templates', {method: template ? 'PUT' : 'POST', body: JSON.stringify({name, provider: config.activeProvider, params: config.profiles[config.activeProvider].params})}); onSaved(result.template) }
    catch (e) { setFailure(backendErrorMessage(e)) } finally { setBusy(false) }
  }
  return <form className={styles.detailCard} onSubmit={(e) => void save(e)}><div className={styles.detailHeader}><div><span className={styles.pageEyebrow}>TEMPLATE BUILDER</span><h2>{template ? '编辑' : '新建'}预设模板（仅预填参数）</h2></div></div>
    <fieldset disabled={busy} className={styles.adminSection}><label className={styles.filledField}><span>模板名称</span><input name="name" required defaultValue={template?.name} /></label>
      <SegmentedRail<ProviderType> label="模板协议" value={config.activeProvider} options={[{value: 'openai-compatible', label: 'OpenAI'}, {value: 'gemini-compatible', label: 'Gemini'}]} onChange={(activeProvider) => setConfig((p) => ({...p, activeProvider}))} />
      <GenerationParamsPanel key={config.activeProvider} config={config} activeProvider={config.activeProvider} isHydrated hasReferenceImages={false} onOpenAIParamsChange={(patch) => params('openai-compatible', patch)} onGeminiParamsChange={(patch) => params('gemini-compatible', patch)} /></fieldset>
    {failure && <p className={styles.cautionBanner} role="alert">{failure}</p>}<div className={styles.detailFooter}>{template && <RippleButton type="button" className={styles.dangerTonalBtn} disabled={busy} onClick={() => onRemove(template.id)}>删除模板</RippleButton>}<div className={styles.pageHeaderActions}><RippleButton type="button" className={styles.tonalBtn} disabled={busy} onClick={onCancel}>取消</RippleButton><RippleButton className={styles.primaryBtn} disabled={busy}><Icon name="check" size={15} />保存模板</RippleButton></div></div></form>
}
function UsageTable({ title, columns, children }: {title: string; columns: string[]; children: ReactNode}) {
  return <section><h3>{title}</h3><div className={styles.tableWrap} data-no-swipe="true"><table className={styles.dataTable} aria-label={title}><thead><tr>{columns.map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead><tbody>{children}</tbody></table></div></section>
}
function UsageAdmin() {
  const {data, loading, error, reload} = useStudioResource<Usage>('/admin/usage')
  if (!data) return <LoadState label="使用统计" error={error} reload={reload} />
  const counts = data.users.reduce((a, u) => ({total: a.total + u.total, succeeded: a.succeeded + u.succeeded, active: a.active + u.active}), {total: 0, succeeded: 0, active: 0})
  const channels = new Map(data.channels.map((c) => [c.channelId, c.name]))
  return <><div className={styles.kpiRow}>{[['总任务计数', counts.total, '按用户汇总'], ['成功任务', counts.succeeded, counts.total ? `占全部任务的 ${(counts.succeeded / counts.total * 100).toFixed(1)}%` : '暂无已提交任务'], ['当前活跃任务', counts.active, '排队中与运行中']].map(([title, value, note]) => <div className={styles.kpiCard} key={title}><span>{title}</span><strong>{value}</strong><small>{note}</small></div>)}</div>
    <div className={styles.detailCard}><div className={styles.detailHeader}><div><span className={styles.pageEyebrow}>NON-PRIVATE TELEMETRY</span><h2>用户、渠道与最近任务状态</h2></div><RippleButton className={styles.tonalBtn} disabled={loading} onClick={() => void reload()}><Icon name="loader" size={14} />{loading ? '刷新中…' : '刷新统计'}</RippleButton></div>
      {error && <p className={styles.cautionBanner} role="alert">{error}</p>}
      {(['users', 'channels'] as const).map((key) => { const label = key === 'users' ? '用户' : '渠道'; return <UsageTable key={key} title={`${label}统计`} columns={[label, '总计', '成功', '失败', '活动']}>{data[key].map((r) => <tr key={'userId' in r ? r.userId : r.channelId}><td>{'username' in r ? r.username : r.name}</td><td>{r.total}</td><td>{r.succeeded}</td><td>{r.failed}</td><td>{r.active}</td></tr>)}</UsageTable> })}
      <UsageTable title="最近任务（最多 100 条）" columns={['任务 ID', '用户', '渠道', '状态', '创建时间']}>{data.tasks.map((t) => <tr key={t.id}><td><code>{t.id}</code></td><td>{t.username}</td><td title={t.channelId}>{channels.get(t.channelId) || t.channelId}</td><td><span className={t.status === 'succeeded' ? styles.statusOn : t.status === 'running' ? styles.statusRunningChip : styles.statusOff}>{t.status}</span></td><td>{new Date(t.createdAt).toLocaleString()}</td></tr>)}</UsageTable>
      {!data.tasks.length && <p className={styles.monoMeta}>暂无任务记录。</p>}</div></>
}
