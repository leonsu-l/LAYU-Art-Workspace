import { useId, useState } from 'react'
import {
  OPENAI_FIXED_SIZES,
  OPENAI_FLEXIBLE_SIZES,
  getGeminiModel,
  getOpenAIModel,
} from '@nanobanana/shared/utils/imageModels'
import type {
  GeminiImageParams,
  OpenAIImageParams,
  ProviderConfig,
  ProviderType,
  RequestPreview,
} from '@nanobanana/shared/types/generation'
import { M3Select, type SelectOptionItem } from './ui/M3Select'
import styles from './ConfigPanel.module.css'

const qualityLabels: Record<OpenAIImageParams['quality'], string> = {
  auto: '自动',
  low: '低（low）',
  medium: '中（medium）',
  high: '高（high）',
  xhigh: '超高（xhigh）',
  max: '最高（max）',
}

const thinkingLabels: Record<GeminiImageParams['thinkingLevel'], string> = {
  auto: '模型默认',
  minimal: '精简（minimal）',
  medium: '中等（medium）',
  high: '深入（high）',
}

const backgroundLabels: Record<OpenAIImageParams['background'], string> = {
  auto: '自动',
  opaque: '不透明',
  transparent: '透明',
}

const formatLabels: Record<OpenAIImageParams['outputFormat'], string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
}

const moderationLabels: Record<OpenAIImageParams['moderation'], string> = {
  auto: '自动（auto）',
  low: '较宽松（low）',
}

interface GenerationParamsPanelProps {
  config: ProviderConfig
  activeProvider: ProviderType
  activeProfile: ProviderConfig['profiles'][ProviderType]
  isHydrated: boolean
  hasReferenceImages: boolean
  onProfileChange: (patch: Partial<{ baseUrl: string; model: string; apiKey: string }>) => void
  onOpenAIParamsChange: (patch: Partial<OpenAIImageParams>) => void
  onGeminiParamsChange: (patch: Partial<GeminiImageParams>) => void
}

export function GenerationParamsPanel({
  config,
  activeProvider,
  isHydrated,
  hasReferenceImages,
  onOpenAIParamsChange,
  onGeminiParamsChange,
}: GenerationParamsPanelProps) {
  const fieldId = useId()
  const isOpenAI = activeProvider === 'openai-compatible'

  const openAIProfile = config.profiles['openai-compatible']
  const geminiProfile = config.profiles['gemini-compatible']
  const openAIModel = getOpenAIModel(openAIProfile.model)
  const geminiModel = getGeminiModel(geminiProfile.model)
  const sizeList = openAIModel.flexibleSize ? OPENAI_FLEXIBLE_SIZES : OPENAI_FIXED_SIZES
  const [customSize, setCustomSize] = useState(false)
  const isCustomSize =
    openAIModel.flexibleSize &&
    (customSize || !sizeList.some((size) => size === openAIProfile.params.size))

  const sizeOptions: SelectOptionItem[] = [
    ...sizeList.map((size) => ({
      value: size,
      label: size === 'auto' ? '自动' : size.replace('x', ' × '),
    })),
    ...(openAIModel.flexibleSize ? [{ value: '__custom__', label: '自定义宽 × 高' }] : []),
  ]

  const qualityOptions: SelectOptionItem<OpenAIImageParams['quality']>[] = openAIModel.qualities.map(
    (quality) => ({
      value: quality,
      label: qualityLabels[quality],
    }),
  )

  const formatOptions: SelectOptionItem<OpenAIImageParams['outputFormat']>[] = (
    ['png', 'jpeg', 'webp'] as const
  ).map((format) => ({
    value: format,
    label: formatLabels[format],
  }))

  const backgroundOptions: SelectOptionItem<OpenAIImageParams['background']>[] = [
    { value: 'auto', label: backgroundLabels.auto },
    { value: 'opaque', label: backgroundLabels.opaque },
    ...(openAIModel.transparentBackground && openAIProfile.params.outputFormat !== 'jpeg'
      ? [{ value: 'transparent' as const, label: backgroundLabels.transparent }]
      : []),
  ]

  const moderationOptions: SelectOptionItem<OpenAIImageParams['moderation']>[] = [
    { value: 'auto', label: moderationLabels.auto },
    { value: 'low', label: moderationLabels.low },
  ]

  const aspectRatioOptions: SelectOptionItem[] = [
    { value: 'auto', label: '自动' },
    ...geminiModel.aspectRatios.map((ratio) => ({ value: ratio, label: ratio })),
  ]

  const imageSizeOptions: SelectOptionItem<GeminiImageParams['imageSize']>[] =
    geminiModel.imageSizes.length > 0
      ? geminiModel.imageSizes.map((size) => ({
          value: size,
          label: size === 'auto' ? '自动（不发送）' : size === '512' ? '512 px' : size,
        }))
      : [{ value: '1K', label: '模型默认（约 1K）' }]

  const thinkingOptions: SelectOptionItem<GeminiImageParams['thinkingLevel']>[] =
    geminiModel.thinkingLevels.map((level) => ({
      value: level,
      label: thinkingLabels[level],
    }))

  return (
    <section className={styles.panel} aria-labelledby={`${fieldId}-params-heading`}>
      <header className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>PARAMETERS</span>
          <h2 id={`${fieldId}-params-heading`} className={styles.title}>模型与生成参数</h2>
        </div>
        <span className={styles.protocolTag}>{isOpenAI ? 'OpenAI 兼容' : 'Gemini 兼容'}</span>
      </header>

      {isOpenAI ? (
        <div className={styles.paramsGrid}>
          <div className={styles.field}>
            <label id={`${fieldId}-size-label`} className={styles.label} htmlFor={`${fieldId}-size`}>
              图片尺寸 / 比例
            </label>
            <M3Select
              id={`${fieldId}-size`}
              aria-labelledby={`${fieldId}-size-label`}
              value={isCustomSize ? '__custom__' : openAIProfile.params.size}
              options={sizeOptions}
              disabled={!isHydrated}
              onChange={(nextValue) => {
                const custom = nextValue === '__custom__'
                setCustomSize(custom)
                if (!custom) onOpenAIParamsChange({ size: nextValue })
              }}
            />
          </div>

          <div className={styles.field}>
            <label id={`${fieldId}-quality-label`} className={styles.label} htmlFor={`${fieldId}-quality`}>
              图片质量
            </label>
            <ParameterSelect
              id={`${fieldId}-quality`}
              aria-labelledby={`${fieldId}-quality-label`}
              value={openAIProfile.params.quality}
              options={qualityOptions}
              disabled={!isHydrated}
              onChange={(nextValue) => onOpenAIParamsChange({ quality: nextValue })}
            />
          </div>

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
              <span className={styles.fieldHint}>
                填写渠道支持的 WxH；参数不会按模型 ID 自动改写。
              </span>
            </label>
          ) : null}

          {openAIModel.flexibleSize ? (
            <p className={styles.paramsHint}>
              建议值仅供预填；支持范围与实际费用以所选渠道为准。
            </p>
          ) : null}

          <div className={styles.field}>
            <label id={`${fieldId}-format-label`} className={styles.label} htmlFor={`${fieldId}-format`}>
              输出格式
            </label>
            <ParameterSelect
              id={`${fieldId}-format`}
              aria-labelledby={`${fieldId}-format-label`}
              value={openAIProfile.params.outputFormat}
              options={formatOptions}
              disabled={!isHydrated}
              onChange={(nextValue) => onOpenAIParamsChange({ outputFormat: nextValue })}
            />
          </div>

          <div className={styles.field}>
            <label id={`${fieldId}-bg-label`} className={styles.label} htmlFor={`${fieldId}-bg`}>
              背景
            </label>
            <ParameterSelect
              id={`${fieldId}-bg`}
              aria-labelledby={`${fieldId}-bg-label`}
              value={openAIProfile.params.background}
              options={backgroundOptions}
              disabled={!isHydrated}
              onChange={(nextValue) => onOpenAIParamsChange({ background: nextValue })}
            />
          </div>

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
                onChange={(event) =>
                  onOpenAIParamsChange({ outputCompression: Number(event.target.value) })
                }
                disabled={!isHydrated}
              />
            </label>
          ) : null}

          <div className={styles.field}>
            <label
              id={`${fieldId}-moderation-label`}
              className={styles.label}
              htmlFor={`${fieldId}-moderation`}
            >
              内容审核
            </label>
            <ParameterSelect
              id={`${fieldId}-moderation`}
              aria-labelledby={`${fieldId}-moderation-label`}
              aria-describedby={hasReferenceImages ? `${fieldId}-moderation-hint` : undefined}
              value={hasReferenceImages ? 'auto' : openAIProfile.params.moderation}
              options={moderationOptions}
              disabled={!isHydrated || hasReferenceImages}
              onChange={(nextValue) => onOpenAIParamsChange({ moderation: nextValue })}
            />
            {hasReferenceImages ? (
              <span id={`${fieldId}-moderation-hint`} className={styles.fieldHint}>
                参考图模式使用编辑接口默认审核，不发送此参数。
              </span>
            ) : null}
          </div>

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
          <div className={styles.field}>
            <label id={`${fieldId}-ratio-label`} className={styles.label} htmlFor={`${fieldId}-ratio`}>
              图片比例
            </label>
            <ParameterSelect
              id={`${fieldId}-ratio`}
              aria-labelledby={`${fieldId}-ratio-label`}
              value={geminiProfile.params.aspectRatio}
              options={aspectRatioOptions}
              disabled={!isHydrated}
              onChange={(nextValue) => onGeminiParamsChange({ aspectRatio: nextValue })}
            />
          </div>

          <div className={styles.field}>
            <label
              id={`${fieldId}-imgsize-label`}
              className={styles.label}
              htmlFor={`${fieldId}-imgsize`}
            >
              输出分辨率
            </label>
            <ParameterSelect
              id={`${fieldId}-imgsize`}
              aria-labelledby={`${fieldId}-imgsize-label`}
              value={geminiProfile.params.imageSize}
              options={imageSizeOptions}
              disabled={!isHydrated || geminiModel.imageSizes.length === 0}
              onChange={(nextValue) => onGeminiParamsChange({ imageSize: nextValue })}
            />
          </div>

          {geminiModel.thinkingLevels.length > 1 ? (
            <div className={styles.field}>
              <label
                id={`${fieldId}-thinking-label`}
                className={styles.label}
                htmlFor={`${fieldId}-thinking`}
              >
                思考深度
              </label>
              <ParameterSelect
                id={`${fieldId}-thinking`}
                aria-labelledby={`${fieldId}-thinking-label`}
                value={geminiProfile.params.thinkingLevel}
                options={thinkingOptions}
                disabled={!isHydrated}
                onChange={(nextValue) => onGeminiParamsChange({ thinkingLevel: nextValue })}
              />
            </div>
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
  )
}

export function ConnectionSettingsPanel({ requestPreview }: { requestPreview: RequestPreview | null }) {
  return <section className={styles.panel}><details className={styles.previewCard}><summary className={styles.previewSummary}>应用 API 请求预览</summary><div className={styles.previewContent}><code className={styles.endpoint}>POST /api/tasks</code><pre className={styles.bodyPreview}>{JSON.stringify(requestPreview?.bodyPreview, null, 2)}</pre><p className={styles.fieldHint}>渠道密钥仅由服务器使用，不会返回浏览器。</p></div></details></section>
}
function ParameterSelect<T extends string>(props: { id?: string; value: T; options: readonly SelectOptionItem<T>[]; disabled?: boolean; onChange: (value: T) => void; 'aria-labelledby'?: string; 'aria-describedby'?: string }) {
  const [custom, setCustom] = useState(false)
  const known = props.options.some((option) => option.value === props.value)
  return <><M3Select {...props} value={custom || !known ? '__custom_value__' : props.value} options={[...props.options, { value: '__custom_value__', label: '自定义值' }]} onChange={(value) => { setCustom(value === '__custom_value__'); if (value !== '__custom_value__') props.onChange(value as T) }} />{(custom || !known) && <input className={styles.input} aria-label="自定义参数值" value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value as T)} />}</>
}