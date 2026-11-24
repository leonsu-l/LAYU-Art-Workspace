import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { AppError, GenerateImageResult, GenerationTaskStatus } from '@nanobanana/shared/types/generation'
import { Icon } from './Icon'
import { getOutputSizeWarning } from '../utils/outputImageSize'
import { promptIdeas } from '../utils/promptIdeas'
import { RippleButton } from '../studio/Ripple'
import { ShimmerImage, SkeletonBlock } from '../studio/Skeleton'
import styles from '../studio/Workbench.module.css'

interface Props {
  loading: boolean; isGenerating: boolean; isSubmitting: boolean; taskStatus?: GenerationTaskStatus
  result: GenerateImageResult | null; error: AppError | null; expectedImageCount: number; expectedAspectRatio: string
  model: string; requestedSize?: string; onUseIdea: (prompt: string) => void; onClearResult: () => void
}
export function ResultPanel({ loading, isGenerating, isSubmitting, taskStatus, result, error, expectedImageCount, expectedAspectRatio, requestedSize, model, onUseIdea, onClearResult }: Props) {
  const images = (result?.images ?? []).flatMap((img, i) => {
    const src = img.base64Data ? `data:${img.mimeType};base64,${img.base64Data}` : img.url
    return src ? [{ src, file: `${model || 'image'}-${i + 1}.${img.mimeType.split('/')[1] || 'png'}` }] : []
  })
  const count = Math.max(1, Math.min(10, expectedImageCount || 1))
  const status = loading ? '正在恢复任务' : isSubmitting ? '正在提交' : isGenerating ? taskStatus === 'queued' ? '任务排队中' : `正在显影 · ${count} 张` : error ? '生成失败' : result ? `已完成 · ${images.length} 张` : '画布就绪'
  return <>
    <header className={styles.stageBar}><div className={styles.stageBarLeft}>
      <span role="status" className={`${styles.statusBadge} ${isGenerating ? styles.statusRunning : error ? styles.statusWarn : result ? styles.statusDone : styles.statusIdle}`}><span className={styles.statusDot} />{status}</span>
      <span className={styles.stageMetaMono}>{model || '未选模型'}{(result || isGenerating) && ` · ${requestedSize || expectedAspectRatio}`}</span></div>
      {(result || error) && <div className={styles.stageBarActions}>{images.length === 1 ? <a href={images[0].src} download={images[0].file} className={styles.stageTonalBtn}><Icon name="download" size={14} />下载原图</a> : images.length > 1 && <Link className={styles.stageTonalBtn} to="/gallery">到图库预览</Link>}
        <RippleButton type="button" className={styles.stageTextBtn} onClick={onClearResult}><Icon name="close" size={14} />清空</RippleButton></div>}
    </header>
    <div className={styles.stageBody} aria-busy={loading || isGenerating}>
      {loading ? <div className={styles.singleLightbox}><SkeletonBlock variant="media" icon="sparkles" aspectRatio="4 / 3" /></div> : isGenerating ? <div className={count > 1 ? styles.generatingGrid : styles.singleLightbox}>
        {Array.from({length: count}, (_, i) => <div key={i} className={styles.developingCard}><div className={styles.developingShimmer} /><div className={styles.developingLabel}><Icon name="loader" className={styles.spin} size={20} /><strong>{status} · {i + 1}/{count}</strong><span>{isSubmitting ? '等待后端确认，请暂勿离开' : '后端已接收，刷新后可恢复'}</span></div></div>)}
      </div> : error ? <section className={styles.recoveryAlert} role="alert"><h2>未能生成画面 · {error.code}</h2><p>{error.message}</p>{error.details && <details><summary>错误详情</summary><pre>{error.details}</pre></details>}</section> : !result ?
        <div className={styles.emptyStage}><span className={styles.emptyTag}>FRAME 00 · CONTACT SHEET</span><h3>把脑海里的画面，变成作品</h3><p>写下描述，或选一个灵感作为起点。生成的画面会在这里并排展示。</p><div className={styles.emptyStarterGrid}>
          {promptIdeas.map((p) => <RippleButton key={p.label} type="button" className={styles.starterCard} onClick={() => onUseIdea(p.prompt)}><strong>{p.label}</strong><span>{p.prompt.slice(0, 32)}…</span></RippleButton>)}
        </div></div> : <>{result.text && <p>{result.text}</p>}{images.length ? <div className={images.length > 1 ? styles.multiGrid : styles.singleLightbox}>
          {images.map((image, i) => <ResultImage key={`${result.createdAt}:${i}`} image={image} index={i} ratio={expectedAspectRatio} size={requestedSize} check={result.provider === 'openai-compatible'} />)}
        </div> : <p>模型没有返回图片，请检查模型是否支持生图。</p>}</>}
    </div>
  </>
}

function ResultImage({ image, index, size, ratio, check }: { image: { src: string; file: string }; index: number; size?: string; ratio: string; check: boolean }) {
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null)
  const warning = check && dimensions ? getOutputSizeWarning(size, ratio, dimensions.w, dimensions.h) : null
  return <div><figure className={styles.artworkFigure}>
    <ShimmerImage src={image.src} alt={`生成图片 ${index + 1}`} aspectRatio={dimensions ? `${dimensions.w} / ${dimensions.h}` : /^\d+:\d+$/.test(ratio) ? ratio.replace(':', ' / ') : '4 / 3'} className={styles.resultOriginal}
      onDimensions={(w, h) => setDimensions({ w, h })} />
    <figcaption className={styles.artworkCaption}><span>FRAME {String(index + 1).padStart(2, '0')}</span><span>{dimensions && `${dimensions.w} × ${dimensions.h}`}</span><a href={image.src} download={image.file} aria-label={`下载原图 ${index + 1}`}><Icon name="download" size={14} /></a></figcaption>
  </figure>{warning && <p role="status" className={styles.blockerAlert}>{warning} 原图已保留。</p>}</div>
}
