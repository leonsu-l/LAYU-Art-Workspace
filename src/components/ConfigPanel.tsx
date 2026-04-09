import { useMemo, useState } from 'react'
import styles from './ConfigPanel.module.css'
import type { AppError, ProviderConfig, ProviderType } from '../types/generation'

interface ConfigPanelProps {
    config: ProviderConfig
    hasApiKey: boolean
    isHydrated: boolean
    lastSavedAt: string | null
    saveError: AppError | null
    saveNotice: string | null
    onConfigChange: (patch: Partial<ProviderConfig>) => void
    onSaveConfig: () => void
    onClearConfig: () => void
}

const providerLabelMap: Record<ProviderType, string> = {
    'gemini-official': 'Gemini Official',
    'openai-compatible': 'OpenAI-Compatible',
    'custom-openai-compatible': 'Custom Provider',
}

export function ConfigPanel(props: ConfigPanelProps) {
    const {
        config,
        hasApiKey,
        isHydrated,
        lastSavedAt,
        saveError,
        saveNotice,
        onConfigChange,
        onSaveConfig,
        onClearConfig,
    } = props

    const [showApiKey, setShowApiKey] = useState(false)
    const shouldShowBaseUrl = config.provider !== 'gemini-official'

    const saveStatus = useMemo(() => {
        if (saveError) {
            return saveError.message
        }

        if (saveNotice) {
            return saveNotice
        }

        if (!lastSavedAt) {
            return '尚未保存配置'
        }

        const formatted = new Date(lastSavedAt).toLocaleString('zh-CN', {
            hour12: false,
        })

        return `已保存：${formatted}`
    }, [lastSavedAt, saveError, saveNotice])

    return (
        <aside className={`${styles.panel} rounded-3xl p-5 md:p-6`}>
            <header className="mb-5 flex flex-col items-start justify-between gap-3 ">
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-semibold tracking-tight text-slate-900">连接配置</h2>
                    <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${hasApiKey ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                            }`}
                    >
                        {hasApiKey ? '已配置密钥' : '未配置密钥'}

                    </span>
                </div>
                <p className="text-sm text-slate-600">支持供应商、模型、密钥本地持久化。</p>
            </header>

            <div className="space-y-4">
                <label className="block">
                    <span className={styles.label}>供应商</span>
                    <select
                        className={styles.input}
                        value={config.provider}
                        onChange={(event) =>
                            onConfigChange({
                                provider: event.target.value as ProviderType,
                            })
                        }
                        disabled={!isHydrated}
                    >
                        {Object.entries(providerLabelMap).map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="block">
                    <span className={styles.label}>模型</span>
                    <input
                        className={styles.input}
                        value={config.model}
                        onChange={(event) => onConfigChange({ model: event.target.value })}
                        placeholder="gemini-3.1-flash-image-preview"
                        disabled={!isHydrated}
                    />
                </label>

                {shouldShowBaseUrl ? (
                    <label className="block">
                        <span className={styles.label}>Base URL</span>
                        <input
                            className={styles.input}
                            value={config.baseUrl}
                            onChange={(event) => onConfigChange({ baseUrl: event.target.value })}
                            placeholder="https://api.openai.com"
                            disabled={!isHydrated}
                        />
                    </label>
                ) : null}

                <label className="block">
                    <span className={styles.label}>API Key</span>
                    <div className="relative">
                        <input
                            className={`${styles.input} pr-24`}
                            type={showApiKey ? 'text' : 'password'}
                            value={config.apiKey}
                            onChange={(event) => onConfigChange({ apiKey: event.target.value })}
                            placeholder="输入可用 API Key"
                            autoComplete="off"
                            disabled={!isHydrated}
                        />
                        <button
                            type="button"
                            className={styles.inlineAction}
                            onClick={() => setShowApiKey((state) => !state)}
                        >
                            {showApiKey ? '隐藏' : '显示'}
                        </button>
                    </div>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={config.rememberApiKey}
                        onChange={(event) => onConfigChange({ rememberApiKey: event.target.checked })}
                    />
                    保存密钥到本地（localStorage）
                </label>
            </div>

            <footer className="mt-6 space-y-3">
                <div className="flex gap-2">
                    <button type="button" className={styles.primaryButton} onClick={onSaveConfig}>
                        保存配置
                    </button>
                    <button type="button" className={styles.ghostButton} onClick={onClearConfig}>
                        清空本地
                    </button>
                </div>
                <p
                    className={`text-xs ${saveError ? 'text-rose-700' : saveNotice ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                >
                    {saveStatus}
                </p>
            </footer>
        </aside>
    )
}
