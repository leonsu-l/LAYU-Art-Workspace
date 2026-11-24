import { useState } from 'react'
import { OPENAI_FLEXIBLE_SIZES, OPENAI_QUALITIES, OPENAI_OUTPUT_FORMATS, getGeminiModel } from '@nanobanana/shared/utils/imageModels'
import type { GeminiImageParams, OpenAIImageParams, ProviderConfig, ProviderType, RequestPreview } from '@nanobanana/shared/types/generation'
import { CountStepper, RatioTileSelector, SegmentedRail, StudioSelect } from '../studio/Controls'
import { RippleButton } from '../studio/Ripple'
import { ConnectedRatioSkeleton, SkeletonBlock } from '../studio/Skeleton'
import { Icon } from './Icon'
import styles from '../studio/Workbench.module.css'
import page from '../studio/Pages.module.css'
import details from './ConfigPanel.module.css'

const pixels: Record<string, string> = { auto: 'auto', '1:1': '1024x1024', '4:3': '1536x1152', '3:4': '1152x1536', '16:9': '2560x1440', '9:16': '1440x2560' }
const names: Record<string, string> = { auto: '自动', medium: '标准', high: '高', max: '极致', low: '低', xhigh: '超高', opaque: '不透明', transparent: '透明' }
function choices(values: readonly string[]) { return values.map((value) => ({ value, label: names[value] ?? value })) }

interface CustomParameterProps {
  label: string
  value: string
  options: readonly string[]
  onChange: (next: string) => void
  disabled?: boolean
  labels?: Record<string, string>
}
function CustomParameter({ label, value, options, onChange, disabled, labels = names }: CustomParameterProps) {
  const [custom, setCustom] = useState(false)
  const manual = !disabled && (custom || !options.includes(value))
  const presets = options.map((id) => ({ value: id, label: labels[id] ?? id }))
  return <div className={page.filledField}>
    <span>{label}</span>
    <StudioSelect label={label} disabled={disabled} value={manual ? '__custom' : value}
      options={[...presets, { value: '__custom', label: '自定义值' }]} onChange={(next) => {
        setCustom(next === '__custom')
        if (next !== '__custom') onChange(next)
      }} />
    {manual && <input aria-label={`自定义${label}`} value={value} spellCheck={false} onChange={(e) => onChange(e.target.value)} />}
  </div>
}

interface ParamsProps {
  config: ProviderConfig; activeProvider: ProviderType; isHydrated: boolean; busy?: boolean; hasReferenceImages: boolean
  onOpenAIParamsChange: (patch: Partial<OpenAIImageParams>) => void
  onGeminiParamsChange: (patch: Partial<GeminiImageParams>) => void
}
export function GenerationParamsPanel({ config, activeProvider, isHydrated, busy, hasReferenceImages, onOpenAIParamsChange: openAI, onGeminiParamsChange: gemini }: ParamsProps) {
  const [advanced, setAdvanced] = useState(false)
  const oa = config.profiles['openai-compatible'].params, gm = config.profiles['gemini-compatible'].params
  const model = getGeminiModel(config.profiles['gemini-compatible'].model)
  const isOpenAI = activeProvider === 'openai-compatible'
  const selectionKey = `${config.channelId}:${config.profiles[activeProvider].model}`
  const ratio = isOpenAI ? Object.keys(pixels).find((r) => pixels[r] === oa.size) ?? '' : gm.aspectRatio
  if (!isHydrated) return <div className={styles.paramStack} role="status" aria-label="正在加载参数"><SkeletonBlock variant="text" width="30%" /><ConnectedRatioSkeleton /><div className={styles.twoCol}><SkeletonBlock variant="field" /><SkeletonBlock variant="field" /></div><SkeletonBlock variant="button" /></div>
  return <section inert={busy} aria-busy={busy} aria-label="生成参数" className={styles.paramStack}>
    <div className={styles.fieldGroup}><div className={styles.fieldHead}><span className={styles.fieldTitle}>画面比例</span><span className={styles.fieldMeta}>{(isOpenAI ? oa.size : gm.aspectRatio).replace('auto', '模型自动')}</span></div>
      <RatioTileSelector value={ratio} onChange={(next) => isOpenAI ? openAI({ size: pixels[next] }) : gemini({ aspectRatio: next })} /></div>
    <div className={styles.twoCol}>
      <div className={styles.fieldGroup}><span className={styles.fieldTitle}>{isOpenAI ? '画质档位' : '输出分辨率'}</span>
        {isOpenAI ? <SegmentedRail label="画质档位" value={oa.quality} options={choices(['auto', 'medium', 'high', 'max'])} onChange={(quality) => openAI({ quality })} />
          : <SegmentedRail label="输出分辨率" value={gm.imageSize} options={choices(['1K', '2K', '4K'])} onChange={(imageSize) => gemini({ imageSize })} />}</div>
      <div className={styles.fieldGroup}><span className={styles.fieldTitle}>{isOpenAI ? '生成数量' : '输出模式'}</span>
        {isOpenAI ? <CountStepper value={oa.n} onChange={(n) => openAI({ n })} /> : <RippleButton type="button" className={`${styles.toggleChip} ${gm.imageOnly ? styles.toggleChipActive : ''}`} aria-pressed={gm.imageOnly} onClick={() => gemini({ imageOnly: !gm.imageOnly })}><Icon name={gm.imageOnly ? 'check' : 'image'} size={15} />{gm.imageOnly ? '仅输出图片' : '图文混合'}</RippleButton>}</div>
    </div>
    <RippleButton type="button" className={styles.advancedToggle} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><span>高级参数 · {isOpenAI ? '尺寸、格式与审核' : '比例、分辨率与思考深度'}</span><Icon name="chevron-down" size={15} className={advanced ? styles.rotated : ''} /></RippleButton>
    {advanced && <div className={styles.advancedPanel}>{isOpenAI ? <>
      <CustomParameter key={`图片尺寸:${selectionKey}`} label="图片尺寸" value={oa.size} options={[...new Set([...OPENAI_FLEXIBLE_SIZES, ...Object.values(pixels)])]} onChange={(size) => openAI({ size })} />
      <CustomParameter key={`图片质量:${selectionKey}`} label="图片质量" value={oa.quality} options={OPENAI_QUALITIES} onChange={(quality) => openAI({ quality })} />
      <div className={page.filledField}><span>输出格式</span>
        <StudioSelect label="输出格式" value={oa.outputFormat} options={choices(OPENAI_OUTPUT_FORMATS)} onChange={(outputFormat) => openAI({
          outputFormat, ...(outputFormat === 'jpeg' && oa.background === 'transparent' ? { background: 'opaque' } : {}),
        })} />
      </div>
      <CustomParameter key={`背景:${selectionKey}`} label="背景" value={oa.background} options={oa.outputFormat === 'jpeg' ? ['auto', 'opaque'] : ['auto', 'opaque', 'transparent']} onChange={(background) => openAI({ background })} />
      {oa.outputFormat !== 'png' && <label className={page.filledField}><span>压缩质量（0–100）</span><input type="number" min={0} max={100} step={1} value={oa.outputCompression} onChange={(e) => openAI({ outputCompression: Number(e.target.value) })} /></label>}
      <div className={page.filledField}><CustomParameter key={`${selectionKey}:${hasReferenceImages}`} label="内容审核" value={hasReferenceImages ? 'auto' : oa.moderation} disabled={hasReferenceImages} options={['auto', 'low']} labels={{auto: '自动', low: '较宽松'}} onChange={(value) => openAI({ moderation: value as OpenAIImageParams['moderation'] })} />{hasReferenceImages && <small>参考图使用编辑接口默认审核。</small>}</div>
    </> : <>
      <CustomParameter key={`图片比例:${selectionKey}`} label="图片比例" value={gm.aspectRatio} options={['auto', ...model.aspectRatios]} onChange={(aspectRatio) => gemini({ aspectRatio })} />
      <CustomParameter key={`输出分辨率:${selectionKey}`} label="输出分辨率" value={gm.imageSize} options={model.imageSizes} onChange={(imageSize) => gemini({ imageSize })} />
      <CustomParameter key={`思考深度:${selectionKey}`} label="思考深度" value={gm.thinkingLevel} options={model.thinkingLevels} onChange={(thinkingLevel) => gemini({ thinkingLevel })} />
    </>}</div>}
  </section>
}

export function ConnectionSettingsPanel({ requestPreview }: { requestPreview: RequestPreview | null }) {
  return <details className={details.previewCard}><summary className={details.previewSummary}>应用 API 请求预览</summary><div className={details.previewContent}><code className={details.endpoint}>POST /api/tasks</code><pre className={details.bodyPreview}>{JSON.stringify(requestPreview?.bodyPreview, null, 2)}</pre><p className={details.fieldHint}>渠道密钥仅由服务器使用，不会返回浏览器。</p></div></details>
}
