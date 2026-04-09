import styles from './ResultPanel.module.css'
import type { AppError, GenerateImageResult } from '../types/generation'

interface ResultPanelProps {
  isGenerating: boolean
  result: GenerateImageResult | null
  error: AppError | null
}

export function ResultPanel(props: ResultPanelProps) {
  const { isGenerating, result, error } = props

  if (isGenerating) {
    return (
      <section className={`${styles.panel} rounded-3xl p-5 md:p-6`}>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">生成结果</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      </section>
    )
  }

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

  if (!result) {
    return (
      <section className={`${styles.panel} rounded-3xl p-5 md:p-6`}>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">生成结果</h2>
        <p className="mt-4 text-sm text-slate-600">提交提示词后，结果将在此展示。当前仅启用文本生图链路。</p>
      </section>
    )
  }

  return (
    <section className={`${styles.panel} rounded-3xl p-5 md:p-6`}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">生成结果</h2>
        <div className="text-xs text-slate-500">
          <p>Provider: {result.provider}</p>
          <p>Model: {result.model}</p>
        </div>
      </header>

      {result.text ? (
        <p className="mb-4 rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-700">{result.text}</p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {result.images.map((image, index) => {
          const imageSrc = image.base64Data
            ? `data:${image.mimeType};base64,${image.base64Data}`
            : image.url

          if (!imageSrc) {
            return null
          }

          return (
            <figure key={`${image.mimeType}-${index}`} className={styles.figure}>
              <img src={imageSrc} alt={`Generated ${index + 1}`} className={styles.image} loading="lazy" />
            </figure>
          )
        })}
      </div>
    </section>
  )
}
