import { useMemo, useState } from 'react'
import styles from './ConfigPanel.module.css'
import type {
    AppError,
    GeminiImageParams,
    OpenAIImageParams,
    ProviderConfig,
    ProviderType,
    RequestPreview,
} from '../types/generation'

interface ConfigPanelProps {
    config: ProviderConfig
    activeProvider: ProviderType
    activeProfile: ProviderConfig['profiles'][ProviderType]
    hasApiKey: boolean
    isHydrated: boolean
    lastSavedAt: string | null
    requestPreview: RequestPreview | null
    saveError: AppError | null
    saveNotice: string | null
    onProviderChange: (provider: ProviderType) => void
    onProfileChange: (patch: Partial<{ baseUrl: string; model: string; apiKey: string }>) => void
    onRememberApiKeyChange: (rememberApiKey: boolean) => void
    onOpenAIParamsChange: (patch: Partial<OpenAIImageParams>) => void
    onGeminiParamsChange: (patch: Partial<GeminiImageParams>) => void
    onSaveConfig: () => void
    onClearConfig: () => void
}

const providerLabelMap: Record<ProviderType, string> = {
    'openai-compatible': 'OpenAI-Compatible',
    'gemini-compatible': 'Gemini-Compatible',
}

export function ConfigPanel(props: ConfigPanelProps) {
    const {
        config,
        activeProvider,
        activeProfile,
        hasApiKey,
        isHydrated,
        lastSavedAt,
        requestPreview,
        saveError,
        saveNotice,
        onProviderChange,
        onProfileChange,
        onRememberApiKeyChange,
        onOpenAIParamsChange,
        onGeminiParamsChange,
        onSaveConfig,
        onClearConfig,
    } = props

    const [showApiKey, setShowApiKey] = useState(false)
    const [copyNotice, setCopyNotice] = useState<string | null>(null)
    const isOpenAI = activeProvider === 'openai-compatible'

    const openAIProfile = config.profiles['openai-compatible']
    const geminiProfile = config.profiles['gemini-compatible']

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

    async function handleCopyEndpoint() {
        if (!requestPreview) {
            return
        }

        try {
            await navigator.clipboard.writeText(requestPreview.endpoint)
            setCopyNotice('请求地址已复制。')
        } catch {
            setCopyNotice('复制失败，请手动复制。')
        }
    }

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
                        value={activeProvider}
                        onChange={(event) => onProviderChange(event.target.value as ProviderType)}
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
                        value={activeProfile.model}
                        onChange={(event) => onProfileChange({ model: event.target.value })}
                        placeholder="输入当前兼容协议可用模型"
                        disabled={!isHydrated}
                    />
                </label>

                <label className="block">
                    <span className={styles.label}>Base URL</span>
                    <input
                        className={styles.input}
                        value={activeProfile.baseUrl}
                        onChange={(event) => onProfileChange({ baseUrl: event.target.value })}
                        placeholder="输入完整接口根地址"
                        disabled={!isHydrated}
                    />
                </label>

                <label className="block">
                    <span className={styles.label}>API Key</span>
                    <div className="relative">
                        <input
                            className={`${styles.input} pr-24`}
                            type={showApiKey ? 'text' : 'password'}
                            value={activeProfile.apiKey}
                            onChange={(event) => onProfileChange({ apiKey: event.target.value })}
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
                        onChange={(event) => onRememberApiKeyChange(event.target.checked)}
                    />
                    保存密钥到本地（localStorage）
                </label>

                {isOpenAI ? (
                    <section className={styles.paramsSection}>
                        <p className={styles.sectionTitle}>OpenAI 生图参数</p>
                        <div className={styles.paramsGrid}>
                            <label className="block">
                                <span className={styles.label}>分辨率（size）</span>
                                <input
                                    className={styles.input}
                                    value={openAIProfile.params.size}
                                    onChange={(event) => onOpenAIParamsChange({ size: event.target.value })}
                                    placeholder="1024x1024"
                                    disabled={!isHydrated}
                                />
                            </label>

                            <label className="block">
                                <span className={styles.label}>比例（aspect_ratio）</span>
                                <input
                                    className={styles.input}
                                    value={openAIProfile.params.aspectRatio}
                                    onChange={(event) => onOpenAIParamsChange({ aspectRatio: event.target.value })}
                                    placeholder="1:1"
                                    disabled={!isHydrated}
                                />
                            </label>

                            <label className="block">
                                <span className={styles.label}>质量（quality）</span>
                                <select
                                    className={styles.input}
                                    value={openAIProfile.params.quality}
                                    onChange={(event) =>
                                        onOpenAIParamsChange({ quality: event.target.value as OpenAIImageParams['quality'] })
                                    }
                                    disabled={!isHydrated}
                                >
                                    <option value="standard">standard</option>
                                    <option value="hd">hd</option>
                                </select>
                            </label>

                            <label className="block">
                                <span className={styles.label}>数量（n）</span>
                                <input
                                    className={styles.input}
                                    type="number"
                                    min={1}
                                    max={10}
                                    value={openAIProfile.params.n}
                                    onChange={(event) =>
                                        onOpenAIParamsChange({ n: Number.parseInt(event.target.value, 10) || 1 })
                                    }
                                    disabled={!isHydrated}
                                />
                            </label>
                        </div>
                    </section>
                ) : (
                    <section className={styles.paramsSection}>
                        <p className={styles.sectionTitle}>Gemini 生图参数</p>
                        <div className={styles.paramsGrid}>
                            <label className="block">
                                <span className={styles.label}>分辨率（image_size）</span>
                                <select
                                    className={styles.input}
                                    value={geminiProfile.params.imageSize}
                                    onChange={(event) =>
                                        onGeminiParamsChange({
                                            imageSize: event.target.value as GeminiImageParams['imageSize'],
                                        })
                                    }
                                    disabled={!isHydrated}
                                >
                                    <option value="512">512</option>
                                    <option value="1K">1K</option>
                                    <option value="2K">2K</option>
                                    <option value="4K">4K</option>
                                </select>
                            </label>

                            <label className="block">
                                <span className={styles.label}>比例（aspect_ratio）</span>
                                <input
                                    className={styles.input}
                                    value={geminiProfile.params.aspectRatio}
                                    onChange={(event) => onGeminiParamsChange({ aspectRatio: event.target.value })}
                                    placeholder="1:1"
                                    disabled={!isHydrated}
                                />
                            </label>

                            <label className="block">
                                <span className={styles.label}>Thinking Level</span>
                                <select
                                    className={styles.input}
                                    value={geminiProfile.params.thinkingLevel}
                                    onChange={(event) =>
                                        onGeminiParamsChange({
                                            thinkingLevel: event.target.value as GeminiImageParams['thinkingLevel'],
                                        })
                                    }
                                    disabled={!isHydrated}
                                >
                                    <option value="minimal">minimal</option>
                                    <option value="high">high</option>
                                </select>
                            </label>

                            <label className="flex items-center gap-2 text-sm text-slate-700">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300"
                                    checked={geminiProfile.params.imageOnly}
                                    onChange={(event) => onGeminiParamsChange({ imageOnly: event.target.checked })}
                                    disabled={!isHydrated}
                                />
                                仅图片输出（Image-only）
                            </label>
                        </div>
                    </section>
                )}

                <section className={styles.previewCard}>
                    <div className="flex items-center justify-between gap-2">
                        <p className={styles.sectionTitle}>请求地址预览</p>
                        <button type="button" className={styles.previewButton} onClick={handleCopyEndpoint}>
                            复制地址
                        </button>
                    </div>

                    <p className="mt-2 text-xs text-slate-500">Method: {requestPreview?.method ?? 'POST'}</p>
                    <code className={styles.endpoint}>{requestPreview?.endpoint ?? '请输入完整配置以预览请求地址'}</code>

                    {requestPreview ? (
                        <pre className={styles.bodyPreview}>{JSON.stringify(requestPreview.bodyPreview, null, 2)}</pre>
                    ) : null}

                    {copyNotice ? <p className="mt-2 text-xs text-emerald-700">{copyNotice}</p> : null}
                </section>
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
