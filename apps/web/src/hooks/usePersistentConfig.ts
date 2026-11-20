import { useCallback, useEffect, useRef, useState } from 'react'
import type { GeminiImageParams, OpenAIImageParams, ProviderConfig, ProviderType } from '@nanobanana/shared/types/generation'
import type { Channel, ModelCatalog, Template, Quota } from '@nanobanana/shared/types/studio'
import { createDefaultProviderConfig } from '@nanobanana/shared/utils/configDefaults'
import { backendRequest, backendErrorMessage } from '../services/backendClient'
import { getSessionEpoch, userStorageKey } from '../services/sessionScope'
import { applyChannelSelection, reconcileChannelProtocol, restoreChannelSelection } from '../utils/channelSelection'
export const DEFAULT_PROVIDER_CONFIG = createDefaultProviderConfig()
export function usePersistentConfig() {
  const [config, setConfig] = useState<ProviderConfig>(createDefaultProviderConfig)
  const [channels, setChannels] = useState<Channel[]>([])
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadedKey, setLoadedKey] = useState('')
  const [dirty, setDirty] = useState(0)
  const [saveStatus, setSaveStatus] = useState('')
  const ownerEpoch = useRef(getSessionEpoch())
  const revision = useRef(0)
  const selectionRestored = useRef(false)
  const channelRefreshSequence = useRef(0)
  const [selectionLoaded, setSelectionLoaded] = useState(false)
  const [selectionStorageKey] = useState(() => userStorageKey('nanobanana.channel-selection'))
  const activeProvider = config.activeProvider
  const activeProfile = config.profiles[activeProvider]
  const key = `${config.channelId ?? ''}:${activeProfile.model}`
  const currentKey = useRef(key); currentKey.current = key
  const channel = channels.find((item) => item.id === config.channelId)
  const isHydrated = loadedKey === key
  const ready = Boolean(channel?.enabled && channel.provider === activeProvider && channel.hasApiKey && activeProfile.model.trim() && (channel.scope === 'private' || channel.enabledModels.includes(activeProfile.model)))
  const refreshChannels = useCallback(async () => {
    const sequence = ++channelRefreshSequence.current
    try {
      const data = await backendRequest<{ channels: Channel[] }>('/channels')
      if (ownerEpoch.current !== getSessionEpoch() || sequence !== channelRefreshSequence.current) return
      let restored: ReturnType<typeof restoreChannelSelection> = null
      if (!selectionRestored.current) {
        selectionRestored.current = true
        try { restored = restoreChannelSelection(localStorage.getItem(selectionStorageKey), data.channels) } catch { /* Optional local selection. */ }
      }
      setChannels(data.channels)
      setConfig((previous) => restored && !previous.channelId ? applyChannelSelection(previous, restored) : reconcileChannelProtocol(previous, data.channels))
      setSelectionLoaded(true); setError(null)
    } catch (e) { if (ownerEpoch.current === getSessionEpoch() && sequence === channelRefreshSequence.current) setError(backendErrorMessage(e)) }
  }, [selectionStorageKey])
  useEffect(() => {
    if (!selectionLoaded || ownerEpoch.current !== getSessionEpoch()) return
    try {
      if (channel?.enabled && channel.provider === activeProvider) localStorage.setItem(selectionStorageKey, JSON.stringify({ channelId: channel.id, model: activeProfile.model, provider: activeProvider }))
      else localStorage.removeItem(selectionStorageKey)
    } catch { /* Saving local selection is optional; server parameters are unaffected. */ }
  }, [selectionLoaded, selectionStorageKey, channel, activeProvider, activeProfile.model])
  useEffect(() => {
    void refreshChannels()
    void backendRequest<{ templates: Template[] }>('/templates').then((r) => setTemplates(r.templates)).catch((e) => setError(backendErrorMessage(e)))
    const controller = new AbortController()
    const refreshQuota = () => { if (ownerEpoch.current !== getSessionEpoch()) return; void backendRequest<Quota>('/me/quota', { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setQuota(data) }).catch((e) => { if (!controller.signal.aborted) setError(backendErrorMessage(e)) }) }
    refreshQuota()
    const timer = window.setInterval(refreshQuota, 10_000)
    const refreshOnFocus = () => { void refreshChannels() }
    window.addEventListener('focus', refreshOnFocus)
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', refreshOnFocus) }
  }, [refreshChannels])
  useEffect(() => {
    setCatalog(null)
    if (!config.channelId) return
    const controller = new AbortController()
    void backendRequest<ModelCatalog>(`/channels/${encodeURIComponent(config.channelId)}/models`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setCatalog(data) }).catch((e) => { if (!controller.signal.aborted) setError(backendErrorMessage(e)) })
    return () => controller.abort()
  }, [config.channelId, activeProvider])
  useEffect(() => {
    setSaveStatus(''); setDirty(0)
    if (!config.channelId || !activeProfile.model.trim()) { setLoadedKey(key); return }
    const controller = new AbortController()
    void backendRequest<{ params: Partial<OpenAIImageParams & GeminiImageParams> | null }>(`/preferences?channelId=${encodeURIComponent(config.channelId)}&model=${encodeURIComponent(activeProfile.model)}`, { signal: controller.signal }).then(({ params }) => {
      if (controller.signal.aborted || currentKey.current !== key) return
      setConfig((previous) => {
        const defaults = createDefaultProviderConfig().profiles[activeProvider].params
        return { ...previous, profiles: { ...previous.profiles, [activeProvider]: { ...previous.profiles[activeProvider], params: { ...defaults, ...params } } } } as ProviderConfig
      }); setLoadedKey(key); setSaveStatus('已加载最近参数')
    }).catch((e) => { if (!controller.signal.aborted) { setLoadedKey(key); setSaveStatus(`加载失败，当前使用默认参数：${backendErrorMessage(e)}`) } })
    return () => controller.abort()
  }, [key, config.channelId, activeProfile.model, activeProvider])
  useEffect(() => {
    if (!dirty || !isHydrated || !config.channelId || !activeProfile.model.trim()) return
    const snapshot = { channelId: config.channelId, model: activeProfile.model, params: { ...activeProfile.params } }
    const version = revision.current
    const controller = new AbortController()
    setSaveStatus('尚未保存')
    const timer = window.setTimeout(() => {
      if (ownerEpoch.current !== getSessionEpoch()) return
      setSaveStatus('正在保存…')
      void backendRequest('/preferences', { method: 'PUT', body: JSON.stringify(snapshot), signal: controller.signal }).then(() => {
        if (!controller.signal.aborted && currentKey.current === key && revision.current === version) setSaveStatus('已保存最近参数')
      }).catch((e) => { if (!controller.signal.aborted && currentKey.current === key && revision.current === version) setSaveStatus(`保存失败：${backendErrorMessage(e)}`) })
    }, 700)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [dirty, isHydrated, config.channelId, activeProfile.model, activeProfile.params, key])
  function selectChannel(id: string) {
    if (id === config.channelId) return
    const selected = channels.find((item) => item.id === id)
    setLoadedKey(''); setDirty(0)
    setConfig((previous) => ({ ...previous, channelId: id, activeProvider: selected?.provider ?? previous.activeProvider, profiles: { ...previous.profiles, [selected?.provider ?? previous.activeProvider]: { ...createDefaultProviderConfig().profiles[selected?.provider ?? previous.activeProvider], model: '' } } }))
    selectionRestored.current = true
  }
  const setActiveProvider = (provider: ProviderType) => { if (provider === activeProvider) return; selectionRestored.current = true; setDirty(0); setLoadedKey(''); setConfig((p) => ({ ...p, channelId: undefined, activeProvider: provider })) }
  const updateProviderProfile = (_provider: ProviderType, patch: Partial<{ model: string; baseUrl: string; apiKey: string }>) => {
    if (patch.model === undefined || patch.model === activeProfile.model) return
    setDirty(0); setLoadedKey('')
    setConfig((p) => ({ ...p, profiles: { ...p.profiles, [p.activeProvider]: { ...p.profiles[p.activeProvider], model: patch.model ?? p.profiles[p.activeProvider].model, params: createDefaultProviderConfig().profiles[p.activeProvider].params } } }) as ProviderConfig)
  }
  function updateParams(provider: ProviderType, patch: Partial<OpenAIImageParams & GeminiImageParams>) {
    revision.current += 1; setDirty(revision.current)
    setConfig((p) => ({ ...p, profiles: { ...p.profiles, [provider]: { ...p.profiles[provider], params: { ...p.profiles[provider].params, ...patch } } } }) as ProviderConfig)
  }
  return { config, activeProvider, activeProfile, selectionLoaded, channels, channel, catalog, templates, quota, error, saveStatus, isHydrated, ready, selectChannel, refreshChannels, setActiveProvider, updateProviderProfile,
    updateOpenAIParams: (patch: Partial<OpenAIImageParams>) => updateParams('openai-compatible', patch),
    updateGeminiParams: (patch: Partial<GeminiImageParams>) => updateParams('gemini-compatible', patch),
  }
}
