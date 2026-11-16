import type { ProviderConfig, ProviderType } from '@nanobanana/shared/types/generation'
import type { Channel } from '@nanobanana/shared/types/studio'
import { createDefaultProviderConfig } from '@nanobanana/shared/utils/configDefaults'
export interface ChannelSelection { channelId: string; model: string; provider: ProviderType }
/** Restore only the explicitly chosen channel. Never substitute another channel or model. */
export function restoreChannelSelection(raw: string | null, channels: Channel[]): ChannelSelection | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const selection = value as Partial<ChannelSelection>
    if (typeof selection.channelId !== 'string' || typeof selection.model !== 'string') return null
    const channel = channels.find((item) => item.id === selection.channelId && item.enabled)
    if (!channel) return null
    return { channelId: channel.id, provider: channel.provider, model: selection.provider === channel.provider ? selection.model : '' }
  } catch { return null }
}
export function applyChannelSelection(config: ProviderConfig, selection: ChannelSelection): ProviderConfig {
  return { ...config, channelId: selection.channelId, activeProvider: selection.provider, profiles: {
    ...config.profiles,
    [selection.provider]: { ...createDefaultProviderConfig().profiles[selection.provider], model: selection.model },
  } }
}
/** Channel protocol edits invalidate both the old model and its protocol-specific form parameters. */
export function reconcileChannelProtocol(config: ProviderConfig, channels: Channel[]): ProviderConfig {
  const selected = channels.find((item) => item.id === config.channelId)
  if (!selected || selected.provider === config.activeProvider) return config
  return applyChannelSelection(createDefaultProviderConfig(), { channelId: selected.id, provider: selected.provider, model: '' })
}
