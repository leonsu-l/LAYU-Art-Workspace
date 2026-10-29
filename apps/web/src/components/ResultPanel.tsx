import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { getOutputSizeWarning } from '../utils/outputImageSize'
import styles from './ResultPanel.module.css'
import type { AppError, GenerateImageResult, GenerationTaskStatus } from '@nanobanana/shared/types/generation'

interface ResultPanelProps {
  isGenerating: boolean
  isSubmitting: boolean
  taskStatus?: GenerationTaskStatus
  result: GenerateImageResult | null
  error: AppError | null
  expectedImageCount: number
  expectedAspectRatio: string
  requestedSize?: string
  onUseIdea: () => void
  onClearResult: () => void
}

const errorGuidance: Record<AppError['code'], string> = {
  VALIDATION: '请检查提示词和左侧的连接设置，再试一次。',
  AUTH: '请检查 API Key 是否正确，以及是否有权使用当前模型。',
  RATE_LIMIT: '请求过于频繁或额度不足，请检查账户额度，稍后再试。',
  NETWORK: '请检查网络与接口地址，再重新生成。',
  CORS: '接口未允许浏览器访问，请使用支持跨域请求的接口地址。',
  BAD_RESPONSE: '接口返回的内容无法识别，请检查模型与兼容协议是否匹配。',
  UNSUPPORTED: '当前接口不支持此操作，请检查模型与协议设置。',
  UNKNOWN: '请检查连接设置，或稍后重新生成。',
}

export function ResultPanel({ isGenerating, isSubmitting, taskStatus, result, error, expectedImageCount, expectedAspectRatio, requestedSize, onUseIdea, onClearResult }: ResultPanelProps) {
  const normalizedExpectedCount = normalizeExpectedImageCount(expectedImageCount)
  const settledResult = isGenerating ? null : result
  const imageSources = settledResult
    ? settledResult.images
      .map((image) => (image.base64Data ? `data:${image.mimeType};base64,${image.base64Data}` : image.url))
      .filter((source): source is string => Boolean(source))
    : []
  const slotCount = isGenerating ? normalizedExpectedCount : imageSources.length
  const trackStyle = { '--preview-ratio': parseAspectRatioValue(expectedAspectRatio) } as CSSProperties
  const isEmpty = !isGenerating && !settledResult && !error
  const statusText = isSubmitting ? '正在提交' : isGenerating ? taskStatus === 'queued' ? '排队中' : '显影中' : '等待曝光'

  return (
    <section className={styles.panel} aria-labelledby="result-heading" aria-busy={isGenerating}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>CONTACT SHEET</span>
          <h2 id="result-heading" className={styles.heading}>接触印相</h2>
          <p className={styles.sub}>生成的每一张，按顺序编号</p>
        </div>
        {!isGenerating && (result || error) ? (
          <button type="button" className={styles.clearButton} onClick={onClearResult}><Icon name="trash" size={13} />清空结果</button>
        ) : (
          <span className={styles.status}>
            <span className={isGenerating ? styles.activeDot : styles.idleDot} aria-hidden="true" />
            {statusText}
          </span>
        )}
      </header>

      {error ? (
        <div className={styles.error} role="alert">
          <span className={styles.errorIcon}><Icon name="image" size={22} /></span>
          <h3 className={styles.errorTitle}>这次没能生成画面</h3>
          <p className={styles.errorMessage}>{error.message}</p>
          <p className={styles.errorHint}>{errorGuidance[error.code]}</p>
          {error.details ? <details className={styles.errorDetails}><summary>查看错误详情</summary><pre>{error.details}</pre></details> : null}
          <span className={`${styles.errorCode} tnum`}>{error.code}</span>
        </div>
      ) : isEmpty ? (
        <div className={styles.empty}>
          <div className={styles.emptyCopy}>
            <span className={styles.emptyLabel}>FRAME 00 · 待曝光</span>
            <h3 className={styles.emptyTitle}>让想象，<br />有画面。</h3>
            <p className={styles.emptyText}>一点奇思妙想，<br />下一张作品就从这里开始。</p>
            <button type="button" className={styles.ideaButton} onClick={onUseIdea}>
              试试这个灵感<Icon name="arrow-up-right" size={15} />
            </button>
          </div>
          <figure className={styles.sample}>
            <img src="/studio-still-life.webp" alt="灵感示例：浅紫色展台上，香蕉果皮像雕塑一样卷曲展开" width={1200} height={800} />
            <figcaption className={styles.sampleCaption}>
              <span>灵感示例 · 非生成结果</span>
              <span>超现实静物 / 柔和日光 / 淡紫色</span>
            </figcaption>
          </figure>
        </div>
      ) : (
        <>
          <div className={styles.metaRow} role="status">
            <span className={styles.metaStatus}>
              {isGenerating ? <><Icon name="loader" size={14} className={styles.spinner} />{isSubmitting ? '正在提交，等待后端确认接收' : taskStatus === 'queued' ? '后端已接收，正在排队；可安全关闭页面' : '后端正在生成，可安全关闭或刷新页面'}</> : <><span className={styles.successDot} aria-hidden="true" />已生成 {imageSources.length} 张图片<span className={styles.model}>{settledResult?.model}</span></>}
            </span>
            <span className={`${styles.ratio} tnum`}>{requestedSize === 'auto' ? '请求：自动尺寸' : requestedSize ? `请求：${requestedSize.replace('x', ' × ')}` : `请求比例：${expectedAspectRatio}`}</span>
          </div>
          {settledResult?.text ? <p className={styles.responseText}>{settledResult.text}</p> : null}
          {slotCount > 0 ? (
            <div className={styles.scroller} tabIndex={0} aria-label="生成图片，支持横向滚动">
              <div className={styles.track} style={trackStyle}>
                {Array.from({ length: slotCount }).map((_, index) => (
                  <div key={`${settledResult?.createdAt ?? 'pending'}-${index}`} className={styles.slot}
                    style={{ '--md-enter-delay': `${index * 70}ms` } as CSSProperties}>
                    {imageSources[index] ? <ResultImageCard imageSrc={imageSources[index]} index={index}
                      requestedSize={requestedSize} expectedAspectRatio={expectedAspectRatio}
                      checkSize={settledResult?.provider === 'openai-compatible'} /> : (
                      <div className={styles.placeholderCard}>
                        <div className={styles.skeleton} aria-hidden="true" />
                        <div className={styles.pendingLabel}>
                          <Icon name="sparkles" size={22} />
                          <span>画面正在酝酿</span>
                          <small className="tnum">{index + 1} / {normalizedExpectedCount}</small>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : <p className={styles.noImages}>模型没有返回图片，请调整提示词或检查模型是否支持生图。</p>}
          <div className={styles.canvasFooter}>
            <span>{slotCount > 1 ? '左右滚动，查看全部画面' : isGenerating ? '复杂画面可能需要更多时间' : '生成的画面，属于你的想象'}</span>
            {settledResult && imageSources.length > 0 ? <Link to="/gallery" viewTransition>到图库预览与下载<Icon name="arrow-up-right" size={13} /></Link> : null}
          </div>
        </>
      )}
    </section>
  )
}

interface ResultImageCardProps {
  imageSrc: string
  index: number
  requestedSize?: string
  expectedAspectRatio: string
  checkSize: boolean
}

function ResultImageCard({ imageSrc, index, requestedSize, expectedAspectRatio, checkSize }: ResultImageCardProps) {
  const [loaded, setLoaded] = useState<{ source: string; width: number; height: number } | null>(null)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const dimensions = loaded?.source === imageSrc ? loaded : null
  const hasFailed = failedSource === imageSrc
  const warning = checkSize && dimensions
    ? getOutputSizeWarning(requestedSize, expectedAspectRatio, dimensions.width, dimensions.height) : null

  return (
    <>
      <figure className={styles.figure}>
        {!dimensions && !hasFailed ? <div className={styles.skeleton} aria-hidden="true" /> : null}
        {hasFailed ? <p className={styles.loadError}>图片加载失败，请检查网络或前往图库查看。</p> : (
          <img src={imageSrc} alt={`生成图片 ${index + 1}`} className={`${styles.image} ${dimensions ? styles.imageLoaded : ''}`} loading="lazy"
            onLoad={(event) => setLoaded({ source: imageSrc, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => setFailedSource(imageSrc)} />
        )}
        <figcaption className={styles.frameCaption}>
          <span className={styles.frameNo}>FRAME {String(index + 1).padStart(2, '0')}</span>
          {dimensions ? <span className={`${styles.actualSize} tnum`}>{dimensions.width} × {dimensions.height}</span> : null}
        </figcaption>
      </figure>
      {warning ? <p className={styles.sizeWarning} role="status">{warning} 原图已保留，未裁剪或拉伸；请向接口服务商核对尺寸支持。不会自动重新生成，以免产生额外费用。</p> : null}
    </>
  )
}

function normalizeExpectedImageCount(value: number): number {
  const raw = Number(value)
  if (!Number.isFinite(raw)) return 1
  return Math.max(1, Math.min(10, Math.round(raw)))
}

function parseAspectRatioValue(ratio: string): number {
  const [rawWidth, rawHeight] = ratio.split(':')
  const width = Number(rawWidth)
  const height = Number(rawHeight)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1
  return Math.max(0.4, Math.min(2.5, width / height))
}
