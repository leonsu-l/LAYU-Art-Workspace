import { useId, useState } from 'react'
import { Icon } from './Icon'
import {
  GEMINI_IMAGE_MODELS,
  OPENAI_IMAGE_MODELS,
  OPENAI_FIXED_SIZES,
  OPENAI_FLEXIBLE_SIZES,
  getGeminiModel,
  getOpenAIModel,
} from '@nanobanana/shared/utils/imageModels'
import styles from './ConfigPanel.module.css'
import type {
  GeminiImageParams,
  OpenAIImageParams,
  ProviderConfig,
  ProviderType,
  RequestPreview,
} from '@nanobanana/shared/types/generation'

interface ConfigPanelProps {
  config: ProviderConfig
  activeProvider: ProviderType
  activeProfile: ProviderConfig['profiles'][ProviderType]
  hasApiKey: boolean
  isHydrated: boolean
  apiKeyRiskNotice: string | null
  requestPreview: RequestPreview | null
  hasReferenceImages: boolean
  onProviderChange: (provider: ProviderType) => void
  onProfileChange: (patch: Partial<{ baseUrl: string; model: string; apiKey: string }>) => void
  onDismissApiKeyRiskNotice: () => void
  onOpenAIParamsChange: (patch: Partial<OpenAIImageParams>) => void
  onGeminiParamsChange: (patch: Partial<GeminiImageParams>) => void
}

const qualityLabels: Record<OpenAIImageParams['quality'], string> = {
  auto: '自动', low: '低（low）', medium: '中（medium）', high: '高（high）', xhigh: '超高（xhigh）', max: '最高（max）',
}
const thinkingLabels: Record<GeminiImageParams['thinkingLevel'], string> = {
  auto: '模型默认', minimal: '精简（minimal）', medium: '中等（medium）', high: '深入（high）',
}

export function ConfigPanel(props: ConfigPanelProps) {
  const {
    config,
    activeProvider,
    activeProfile,
    hasApiKey,
    isHydrated,
    apiKeyRiskNotice,
    requestPreview,
    hasReferenceImages,
    onProviderChange,
    onProfileChange,
    onDismissApiKeyRiskNotice,
    onOpenAIParamsChange,
    onGeminiParamsChange,
  } = props

  const fieldId = useId()
  const [showApiKey, setShowApiKey] = useState(false)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const isOpenAI = activeProvider === 'openai-compatible'

  const openAIProfile = config.profiles['openai-compatible']
  const geminiProfile = config.profiles['gemini-compatible']
  const openAIModel = getOpenAIModel(openAIProfile.model)
  const geminiModel = getGeminiModel(geminiProfile.model)
  const modelOptions = isOpenAI ? OPENAI_IMAGE_MODELS : GEMINI_IMAGE_MODELS
  const knownModel = modelOptions.some((model) => model.id === activeProfile.model)
  const sizeOptions = openAIModel.flexibleSize ? OPENAI_FLEXIBLE_SIZES : OPENAI_FIXED_SIZES
  const [customSize, setCustomSize] = useState(false)
  const isCustomSize = openAIModel.flexibleSize && (customSize || !sizeOptions.some((size) => size === openAIProfile.params.size))

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
    <aside id="connection-settings" className={styles.panel} aria-labelledby={`${fieldId}-title`}>
      <header className={styles.header}>
        <div className={styles.headingRow}>
          <div>
            <span className={styles.eyebrow}>DARKROOM</span>
            <h2 id={`${fieldId}-title`} className={styles.title}>暗房设置</h2>
          </div>
          <span className={`${styles.status} ${isHydrated && hasApiKey ? styles.configured : ''}`}>
            <span className={styles.statusDot} aria-hidden="true" />
            {!isHydrated ? '加载中' : hasApiKey ? '已配置密钥' : '待配置密钥'}
          </span>
        </div>
        <p className={styles.description}>设置自动保存在此浏览器，随时继续创作。</p>
      </header>

      {apiKeyRiskNotice ? (
        <div className={styles.riskNotice} role="status" aria-live="polite">
          <div className={styles.riskContent}>
            <Icon name="shield" size={16} />
            <p>{apiKeyRiskNotice}</p>
          </div>
          <button type="button" className={styles.riskNoticeClose} onClick={onDismissApiKeyRiskNotice}>
            我知道了
          </button>
        </div>
      ) : null}

      <div className={styles.connectionFields}>
        <fieldset className={styles.protocolGroup} disabled={!isHydrated}>
          <legend className={styles.label}>接口协议</legend>
          <div className={styles.segmented}>
            <button
              type="button"
              className={styles.protocolButton}
              aria-pressed={isOpenAI}
              onClick={() => onProviderChange('openai-compatible')}
            >
              OpenAI
            </button>
            <button
              type="button"
              className={styles.protocolButton}
              aria-pressed={!isOpenAI}
              onClick={() => onProviderChange('gemini-compatible')}
            >
              Gemini
            </button>
          </div>
        </fieldset>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fieldId}-model`}>模型</label>
          <select
            id={`${fieldId}-model`}
            className={styles.input}
            value={knownModel ? activeProfile.model : '__custom__'}
            onChange={(event) => {
              setCustomSize(false)
              onProfileChange({ model: event.target.value === '__custom__' ? '' : event.target.value })
            }}
            aria-describedby={`${fieldId}-model-hint`}
            disabled={!isHydrated}
          >
            {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            <option value="__custom__">自定义模型 / 兼容服务别名</option>
          </select>
          {!knownModel ? (
            <label className={styles.customField}>
              <span className={styles.label}>自定义模型 ID</span>
              <input
                className={styles.input}
                value={activeProfile.model}
                onChange={(event) => onProfileChange({ model: event.target.value })}
                placeholder="输入供应商提供的模型 ID"
                spellCheck={false}
                autoCapitalize="none"
                disabled={!isHydrated}
              />
            </label>
          ) : null}
          <p id={`${fieldId}-model-hint`} className={styles.fieldHint}>
            {(isOpenAI ? openAIModel : geminiModel).description} 切换模型时会自动调整不支持的选项。
          </p>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>接口地址 <span className={styles.labelHint}>BASE URL</span></span>
          <input
            className={styles.input}
            value={activeProfile.baseUrl}
            onChange={(event) => onProfileChange({ baseUrl: event.target.value })}
            placeholder="https://api.example.com/v1"
            inputMode="url"
            spellCheck={false}
            autoCapitalize="none"
            disabled={!isHydrated}
          />
        </label>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fieldId}-api-key`}>
            访问密钥 <span className={styles.labelHint}>API KEY</span>
          </label>
          <div className={styles.passwordField}>
            <input
              id={`${fieldId}-api-key`}
              className={`${styles.input} ${styles.passwordInput}`}
              type={showApiKey ? 'text' : 'password'}
              value={activeProfile.apiKey}
              onChange={(event) => onProfileChange({ apiKey: event.target.value })}
              placeholder="输入 API Key"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={`${fieldId}-key-hint`}
              disabled={!isHydrated}
            />
            <button
              type="button"
              className={styles.inlineAction}
              onClick={() => setShowApiKey((state) => !state)}
              aria-label={showApiKey ? '隐藏访问密钥' : '显示访问密钥'}
              aria-controls={`${fieldId}-api-key`}
              disabled={!isHydrated}
            >
              <Icon name={showApiKey ? 'eye-off' : 'eye'} size={16} />
            </button>
          </div>
          <p id={`${fieldId}-key-hint`} className={styles.fieldHint}>密钥已填写不代表连接已验证。</p>
        </div>
      </div>

      <section className={styles.paramsSection} aria-labelledby={`${fieldId}-params-title`}>
        <h3 id={`${fieldId}-params-title`} className={styles.sectionTitle}>生成偏好</h3>

        {isOpenAI ? (
          <div className={styles.paramsGrid}>
            <label className={styles.field}>
              <span className={styles.label}>图片尺寸 / 比例</span>
              <select
                className={styles.input}
                value={isCustomSize ? '__custom__' : openAIProfile.params.size}
                onChange={(event) => {
                  const custom = event.target.value === '__custom__'
                  setCustomSize(custom)
                  if (!custom) onOpenAIParamsChange({ size: event.target.value })
                }}
                disabled={!isHydrated}
              >
                {sizeOptions.map((size) => <option key={size} value={size}>{size === 'auto' ? '自动' : size.replace('x', ' × ')}</option>)}
                {openAIModel.flexibleSize ? <option value="__custom__">自定义宽 × 高</option> : null}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>图片质量</span>
              <select
                className={styles.input}
                value={openAIProfile.params.quality}
                onChange={(event) => onOpenAIParamsChange({ quality: event.target.value as OpenAIImageParams['quality'] })}
                disabled={!isHydrated}
              >
                {openAIModel.qualities.map((quality) => <option key={quality} value={quality}>{qualityLabels[quality]}</option>)}
              </select>
            </label>
            {isCustomSize ? (
              <label className={styles.fullWidthField}>
                <span className={styles.label}>自定义尺寸（像素）</span>
                <input
                  className={styles.input}
                  value={openAIProfile.params.size}
                  onChange={(event) => onOpenAIParamsChange({ size: event.target.value })}
                  placeholder="例如 2048x1152"
                  spellCheck={false}
                  disabled={!isHydrated}
                />
                <span className={styles.fieldHint}>宽高为 16 的倍数、最长边 3840、比例 1:3–3:1，总像素 655360–8294400。</span>
              </label>
            ) : null}
            {openAIModel.flexibleSize ? <p className={styles.paramsHint}>尺寸决定图片比例；超过 2560 × 1440 总像素的输出为实验性功能。</p> : null}
            <label className={styles.field}>
              <span className={styles.label}>输出格式</span>
              <select
                className={styles.input}
                value={openAIProfile.params.outputFormat}
                onChange={(event) => onOpenAIParamsChange({ outputFormat: event.target.value as OpenAIImageParams['outputFormat'] })}
                disabled={!isHydrated}
              >
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>背景</span>
              <select
                className={styles.input}
                value={openAIProfile.params.background}
                onChange={(event) => onOpenAIParamsChange({ background: event.target.value as OpenAIImageParams['background'] })}
                disabled={!isHydrated}
              >
                <option value="auto">自动</option>
                <option value="opaque">不透明</option>
                {openAIModel.transparentBackground && openAIProfile.params.outputFormat !== 'jpeg' ? <option value="transparent">透明</option> : null}
              </select>
            </label>
            {openAIProfile.params.outputFormat !== 'png' ? (
              <label className={styles.field}>
                <span className={styles.label}>压缩质量（0–100）</span>
                <input
                  className={styles.input}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={openAIProfile.params.outputCompression}
                  onChange={(event) => onOpenAIParamsChange({ outputCompression: Number(event.target.value) })}
                  disabled={!isHydrated}
                />
              </label>
            ) : null}
            <label className={styles.field}>
              <span className={styles.label}>内容审核</span>
              <select
                className={styles.input}
                value={hasReferenceImages ? 'auto' : openAIProfile.params.moderation}
                onChange={(event) => onOpenAIParamsChange({ moderation: event.target.value as OpenAIImageParams['moderation'] })}
                disabled={!isHydrated || hasReferenceImages}
              >
                <option value="auto">自动（auto）</option>
                <option value="low">较宽松（low）</option>
              </select>
              {hasReferenceImages ? <span className={styles.fieldHint}>参考图模式使用编辑接口默认审核，不发送此参数。</span> : null}
            </label>
            <label className={styles.field}>
              <span className={styles.label}>生成数量（1–10）</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={10}
                step={1}
                value={openAIProfile.params.n}
                onChange={(event) => onOpenAIParamsChange({ n: Number(event.target.value) })}
                disabled={!isHydrated}
              />
            </label>
          </div>
        ) : (
          <div className={styles.paramsGrid}>
            <label className={styles.field}>
              <span className={styles.label}>图片比例</span>
              <select
                className={styles.input}
                value={geminiProfile.params.aspectRatio}
                onChange={(event) => onGeminiParamsChange({ aspectRatio: event.target.value })}
                disabled={!isHydrated}
              >
                <option value="auto">自动</option>
                {geminiModel.aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>输出分辨率</span>
              <select
                className={styles.input}
                value={geminiProfile.params.imageSize}
                onChange={(event) => onGeminiParamsChange({ imageSize: event.target.value as GeminiImageParams['imageSize'] })}
                disabled={!isHydrated || geminiModel.imageSizes.length === 0}
              >
                {geminiModel.imageSizes.length
                  ? geminiModel.imageSizes.map((size) => <option key={size} value={size}>{size === '512' ? '512 px' : size}</option>)
                  : <option value="1K">模型默认（约 1K）</option>}
              </select>
            </label>
            {geminiModel.thinkingLevels.length > 1 ? (
              <label className={styles.field}>
                <span className={styles.label}>思考深度</span>
                <select
                  className={styles.input}
                  value={geminiProfile.params.thinkingLevel}
                  onChange={(event) => onGeminiParamsChange({ thinkingLevel: event.target.value as GeminiImageParams['thinkingLevel'] })}
                  disabled={!isHydrated}
                >
                  {geminiModel.thinkingLevels.map((level) => <option key={level} value={level}>{thinkingLabels[level]}</option>)}
                </select>
              </label>
            ) : null}
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={geminiProfile.params.imageOnly}
                onChange={(event) => onGeminiParamsChange({ imageOnly: event.target.checked })}
                disabled={!isHydrated}
              />
              <span>仅输出图片</span>
            </label>
          </div>
        )}
      </section>

      <details className={styles.previewCard}>
        <summary className={styles.previewSummary}>
          <span>请求预览</span>
          <Icon name="chevron-down" size={15} />
        </summary>
        <div className={styles.previewContent}>
          <div className={styles.previewToolbar}>
            <span className={`${styles.method} tnum`}>{requestPreview?.method ?? 'POST'}</span>
            <button
              type="button"
              className={styles.previewButton}
              onClick={handleCopyEndpoint}
              disabled={!requestPreview}
            >
              <Icon name="copy" size={13} />
              复制地址
            </button>
          </div>
          <code className={styles.endpoint}>
            {requestPreview?.endpoint ?? '完善连接设置后可预览请求地址'}
          </code>
          {requestPreview ? (
            <pre className={styles.bodyPreview}>{JSON.stringify(requestPreview.bodyPreview, null, 2)}</pre>
          ) : null}
          <p className={styles.copyNotice} role="status" aria-live="polite">{copyNotice}</p>
        </div>
      </details>
    </aside>
  )
}
