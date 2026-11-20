import { useEffect, useState, type FormEvent } from 'react'
import type { Channel, ModelCatalog } from '@nanobanana/shared/types/studio'
import type { ProviderType } from '@nanobanana/shared/types/generation'
import { backendRequest, backendErrorMessage } from '../services/backendClient'
import { useStudioResource } from '../hooks/useStudioResource'
import { Icon } from '../components/Icon'
import { SegmentedRail } from '../studio/Controls'
import { RippleButton } from '../studio/Ripple'
import { SkeletonBlock } from '../studio/Skeleton'
import { useNotify } from '../studio/useNotify'
import styles from '../studio/Pages.module.css'

export function ChannelsPage() { return <main id="main" className={styles.pageWrap}><ChannelManager scope="private" /></main> }

export function ChannelManager({ scope }: { scope: Channel['scope'] }) {
  const { data, loading, error, reload, setData } = useStudioResource<{ channels: Channel[] }>('/channels')
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  const notify = useNotify()
  const channels = data?.channels.filter((c) => c.scope === scope && c.canManage) ?? []
  const active = selected === 'new' ? null : channels.find((c) => c.id === selected) ?? channels[0] ?? null
  const privateScope = scope === 'private'
  const label = privateScope ? '自定义' : '共享'
  async function remove(channel: Channel) {
    if (!window.confirm(`删除渠道“${channel.name}”？排队任务会停止，历史作品保留。`)) return
    setBusy(true)
    try {
      await backendRequest(`/channels/${channel.id}`, { method: 'DELETE' })
      setData((old) => old && ({channels: old.channels.filter((c) => c.id !== channel.id)})); setSelected(null)
      notify({tone: 'success', message: '渠道已删除。'})
    } catch (e) { notify({tone: 'warning', message: backendErrorMessage(e)}) } finally { setBusy(false) }
  }
  return <>
    <header className={styles.pageHeader}><div className={styles.pageTitleGroup}>
      <span className={styles.pageEyebrow}>{privateScope ? 'PRIVATE CHANNELS & KEYS' : 'SHARED CHANNELS'}</span>
      {privateScope ? <h1 className={styles.pageTitle}>我的自定义渠道</h1> : <h2 className={styles.pageTitle}>共享渠道</h2>}
      <p className={styles.pageSub}>{privateScope ? '使用自己的上游地址与密钥，不占用站点共享日额度。密钥仅保存在服务端。' : '为成员配置站点渠道，并选择允许调用的模型。'}</p></div>
      <div className={styles.pageHeaderActions}><RippleButton type="button" className={styles.tonalBtn} disabled={busy || loading} onClick={async () => { if (await reload()) { setRevision((r) => r + 1); notify({message: '渠道列表已刷新。'}) } }}><Icon name="loader" size={14} />刷新列表</RippleButton>
        <RippleButton type="button" className={styles.primaryBtn} disabled={busy || loading} onClick={() => setSelected('new')}><Icon name="plus" size={14} />新增{label}渠道</RippleButton></div></header>
    {error && <p role="alert" className={styles.cautionBanner}>{error}</p>}
    <div className={styles.splitWorkspace}>
      <section className={styles.masterRail} aria-label="渠道列表"><div className={styles.masterHead}><strong>{privateScope ? '私有' : '共享'}渠道列表</strong><span>{channels.length} 个</span></div>
        <div className={styles.channelCardStack}>{loading && !data ? <SkeletonBlock variant="field" /> : channels.length === 0 ? <p className={styles.monoMeta}>尚无{label}渠道。</p> : channels.map((c) => <RippleButton type="button" key={c.id} disabled={busy || loading} aria-pressed={active?.id === c.id}
          className={`${styles.channelItemCard} ${active?.id === c.id ? styles.channelItemActive : ''}`} onClick={() => setSelected(c.id)}>
          <span className={styles.channelItemTop}><strong>{c.name}</strong><span className={c.enabled ? styles.statusOn : styles.statusOff}>{c.enabled ? '启用中' : '已停用'}</span></span>
          <span className={styles.channelItemMeta}><span className={styles.protoTag}>{c.provider === 'openai-compatible' ? 'OpenAI' : 'Gemini'}</span>{c.hasApiKey ? '密钥已配置（只写）' : '未设密钥'}</span><code className={styles.urlSnippet}>{c.baseUrl}</code>
        </RippleButton>)}</div></section>
      {!data && loading ? <section className={styles.detailCard} role="status" aria-label="正在加载渠道配置"><SkeletonBlock variant="text" width="45%" /><SkeletonBlock variant="field" /><SkeletonBlock variant="field" /></section>
        : (active || selected === 'new') ? <ChannelEditor key={`${active?.id ?? 'new'}:${revision}`} channel={active} scope={scope} busy={busy || loading} setBusy={setBusy}
          onCancel={() => { setSelected(active?.id ?? null); setRevision((r) => r + 1) }} onRemove={remove}
          onSaved={(channel) => { setData((old) => ({ channels: [...(old?.channels ?? []).filter((c) => c.id !== channel.id), channel] })); setSelected(channel.id); setRevision((r) => r + 1); notify({tone: 'success', message: `已保存渠道「${channel.name}」。`}) }} />
        : <section className={styles.detailCard}><h2>新增{label}渠道</h2><p className={styles.pageSub}>填写接口地址和只写密钥。保存渠道后即可发现模型，也可以直接填写模型 ID。</p></section>}
    </div>
  </>
}
function ChannelEditor({ channel, scope, busy, setBusy, onCancel, onSaved, onRemove }: {
  channel: Channel | null; scope: Channel['scope']; busy: boolean; setBusy: (value: boolean) => void
  onCancel: () => void; onSaved: (channel: Channel) => void; onRemove: (channel: Channel) => void
}) {
  const [provider, setProvider] = useState<ProviderType>(channel?.provider ?? 'openai-compatible')
  const [enabled, setEnabled] = useState(channel?.enabled ?? true), [modelText, setModelText] = useState(channel?.enabledModels.join('\n') ?? '')
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null), [reading, setReading] = useState(Boolean(channel)), [error, setError] = useState('')
  const notify = useNotify(), id = channel?.id
  const models = [...new Set(modelText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))]
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    void backendRequest<ModelCatalog>(`/channels/${id}/models`, { signal: controller.signal }).then((r) => { if (!controller.signal.aborted) setCatalog(r) })
      .catch((e) => { if (!controller.signal.aborted) setError(backendErrorMessage(e)) }).finally(() => { if (!controller.signal.aborted) setReading(false) })
    return () => controller.abort()
  }, [id])
  async function discover() {
    if (!id) return
    setBusy(true); setReading(true); setError('')
    try { const next = await backendRequest<ModelCatalog>(`/channels/${id}/models/refresh`, {method: 'POST', body: '{}'}); setCatalog(next); if (!next.error) notify({message: `已刷新模型目录，共 ${next.models.length} 个模型。`}) }
    catch (e) { setError(backendErrorMessage(e)) } finally { setBusy(false); setReading(false) }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return
    const data = new FormData(e.currentTarget)
    setBusy(true); setError('')
    try {
      const body = { name: data.get('name'), baseUrl: data.get('baseUrl'), apiKey: data.get('apiKey'), provider, enabled, enabledModels: models, ...(!channel ? {scope} : {}) }
      const result = await backendRequest<{channel: Channel}>(id ? `/channels/${id}` : '/channels', {method: id ? 'PUT' : 'POST', body: JSON.stringify(body)})
      onSaved(result.channel)
    } catch (cause) { setError(backendErrorMessage(cause)) } finally { setBusy(false) }
  }
  return <form aria-label="渠道与模型编辑" className={styles.detailCard} onSubmit={(e) => void save(e)}>
    <div className={styles.detailHeader}><div><span className={styles.pageEyebrow}>CHANNEL CONFIGURATION</span><h2>{channel ? `编辑：${channel.name}` : '新建渠道'}</h2></div>
      <RippleButton type="button" className={`${styles.switchPill} ${enabled ? styles.switchPillOn : ''}`} disabled={busy} aria-pressed={enabled} onClick={() => setEnabled(!enabled)}><span className={styles.switchThumb} />{enabled ? '已启用' : '已停用'}</RippleButton></div>
    <fieldset disabled={busy} className={styles.formGrid}>
      <label className={styles.filledField}><span>渠道名称</span><input name="name" required defaultValue={channel?.name} placeholder="例如：工作室主镜像" /></label>
      <div className={styles.filledField}><span>接口协议</span><SegmentedRail<ProviderType> label="接口协议" value={provider} options={[{value: 'openai-compatible', label: 'OpenAI 兼容'}, {value: 'gemini-compatible', label: 'Gemini 兼容'}]} onChange={setProvider} /></div>
      <label className={`${styles.filledField} ${styles.fullSpan}`}><span>接口地址 Base URL</span><input name="baseUrl" required type="url" defaultValue={channel?.baseUrl} placeholder="https://api.example.com/v1" /></label>
      <label className={`${styles.filledField} ${styles.fullSpan}`}><span>访问密钥（只写不回显）</span><input name="apiKey" type="password" required={!channel} autoComplete="new-password" placeholder={channel?.hasApiKey ? '已设置，留空保留原密钥' : '输入 API Key'} /></label>
    </fieldset>
    <div className={styles.catalogBox}><div className={styles.catalogHead}><div><strong>模型目录与启用列表</strong><span>{scope === 'shared' ? '成员只能选择明确启用的模型。' : '私有渠道也可在工作台手填模型 ID。'}{catalog?.updatedAt && `最近刷新：${new Date(catalog.updatedAt).toLocaleString()}${catalog.stale ? '（缓存已过期）' : ''}`}</span></div>
      <RippleButton type="button" className={styles.tonalBtn} disabled={!channel || busy || reading} onClick={() => void discover()}><Icon name="loader" size={14} />{reading ? '正在发现…' : '发现 / 刷新模型'}</RippleButton></div>
      {reading ? <SkeletonBlock variant="field" /> : <div className={styles.catalogGrid}>{catalog?.models.map((m) => <RippleButton type="button" key={m.id} disabled={busy} title={m.id} aria-pressed={models.includes(m.id)} className={`${styles.catalogModelChip} ${models.includes(m.id) ? styles.catalogModelChipOn : ''}`} onClick={() => setModelText((models.includes(m.id) ? models.filter((i) => i !== m.id) : [...models, m.id]).join('\n'))}><Icon name={models.includes(m.id) ? 'check' : 'plus'} size={13} />{m.name || m.id}</RippleButton>)}</div>}
      {catalog?.error && <p role="alert" className={styles.cautionBanner}>刷新失败，保留上次目录：{catalog.error}</p>}
      <label className={styles.filledField}><span>手动 / 批量编辑模型 ID（每行一个）</span><textarea rows={3} disabled={busy} value={modelText} onChange={(e) => setModelText(e.target.value)} /></label>
    </div>
    {error && <p role="alert" className={styles.cautionBanner}>{error}</p>}<div className={styles.detailFooter}>
      {channel && <RippleButton className={styles.dangerTonalBtn} type="button" disabled={busy} onClick={() => onRemove(channel)}><Icon name="trash" size={14} />删除此渠道</RippleButton>}
      <div className={styles.pageHeaderActions}><RippleButton type="button" className={styles.tonalBtn} disabled={busy} onClick={onCancel}>取消</RippleButton><RippleButton className={styles.primaryBtn} disabled={busy}><Icon name="check" size={15} />保存渠道配置</RippleButton></div>
    </div>
  </form>
}
