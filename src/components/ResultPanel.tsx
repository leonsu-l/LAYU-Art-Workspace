import { useState, type CSSProperties } from 'react'
import styles from './ResultPanel.module.css'
import type { AppError, GenerateImageResult } from '../types/generation'

interface ResultPanelProps {
  isGenerating: boolean
  result: GenerateImageResult | null
  error: AppError | null
  expectedImageCount: number
  expectedAspectRatio: string
}

export function ResultPanel(props: ResultPanelProps) {
  const { isGenerating, result, error, expectedImageCount, expectedAspectRatio } = props
  const normalizedExpectedCount = normalizeExpectedImageCount(expectedImageCount)
  const ratioValue = parseAspectRatioValue(expectedAspectRatio)
  const settledResult = isGenerating ? null : result
  const trackStyle = {
    '--preview-ratio': ratioValue,
  } as CSSProperties

  if (error) {
    return (
      <section className={`${styles.panel} rounded-3xl p-5 md:p-6`}>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">生成结果</h2>
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-medium">{error.message}</p>
          {error.details ? <p className="mt-1 opacity-80">详情：{error.details}</p> : null}
          <p className="mt-2 opacity-80">错误类型：{error.code}</p>
        </div>
      </section>
    )
  }

  if (!isGenerating && !settledResult) {
    return (
      <section className={`${styles.panel} rounded-3xl p-5 md:p-6`}>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">生成结果</h2>
        <p className="mt-4 text-sm text-slate-600">提交提示词后，结果将在此展示。当前仅启用文本生图链路。</p>
      </section>
    )
  }

  const imageSources = settledResult
    ? settledResult.images
      .map((image) => (image.base64Data ? `data:${image.mimeType};base64,${image.base64Data}` : image.url))
      .filter((source): source is string => Boolean(source))
    : []

  const slotCount = isGenerating
    ? normalizedExpectedCount
    : Math.max(normalizedExpectedCount, imageSources.length)

  const generationKey = settledResult?.createdAt ?? 'pending'

  return (
    <section className={`${styles.panel} rounded-3xl p-5 md:p-6`}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">生成结果</h2>
        <div className="text-xs text-slate-500">
          {settledResult ? (
            <>
              <p>Provider: {settledResult.provider}</p>
              <p>Model: {settledResult.model}</p>
              <p>Aspect ratio: {expectedAspectRatio}</p>
              <p>Images: {imageSources.length}/{normalizedExpectedCount}</p>
            </>
          ) : (
            <>
              <p>预计生成 {normalizedExpectedCount} 张</p>
              <p>比例: {expectedAspectRatio}</p>
            </>
          )}
        </div>
      </header>

      {settledResult?.text ? (
        <p className="mb-4 rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-700">{settledResult.text}</p>
      ) : null}

      <p className={styles.scrollHint}>横向滚动查看图片</p>

      <div className={styles.scroller}>
        <div className={styles.track} style={trackStyle}>
          {Array.from({ length: slotCount }).map((_, index) => {
            const imageSrc = imageSources[index]

            return (
              <div key={`${generationKey}-${index}`} className={styles.slot}>
                {imageSrc ? (
                  <ResultImageCard imageSrc={imageSrc} index={index} />
                ) : (
                  <div className={styles.placeholderCard}>
                    <div className={styles.skeleton} aria-hidden="true" />
                    {!isGenerating ? <p className={styles.placeholderText}>等待图片 {index + 1}</p> : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

interface ResultImageCardProps {
  imageSrc: string
  index: number
}

function ResultImageCard({ imageSrc, index }: ResultImageCardProps) {
  const [isLoaded, setIsLoaded] = useState(false)

  return (
    <figure className={styles.figure}>
      {!isLoaded ? <div className={styles.skeleton} aria-hidden="true" /> : null}
      <img
        src={imageSrc}
        alt={`Generated ${index + 1}`}
        className={`${styles.image} ${isLoaded ? styles.imageLoaded : ''}`}
        loading="lazy"
        onLoad={() => setIsLoaded(true)}
        onError={() => setIsLoaded(true)}
      />
    </figure>
  )
}

function normalizeExpectedImageCount(value: number): number {
  const raw = Number(value)
  if (!Number.isFinite(raw)) {
    return 1
  }

  return Math.max(1, Math.min(10, Math.round(raw)))
}

function parseAspectRatioValue(ratio: string): number {
  const [rawWidth, rawHeight] = ratio.split(':')
  const width = Number(rawWidth)
  const height = Number(rawHeight)

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1
  }

  const computedRatio = width / height
  return Math.max(0.4, Math.min(2.5, computedRatio))
}
