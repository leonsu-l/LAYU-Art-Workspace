import styles from './PromptPanel.module.css'

interface PromptPanelProps {
  prompt: string
  isGenerating: boolean
  onPromptChange: (value: string) => void
  onGenerate: () => void
  onClearResult: () => void
}

export function PromptPanel(props: PromptPanelProps) {
  const { prompt, isGenerating, onPromptChange, onGenerate, onClearResult } = props

  return (
    <section className={`${styles.panel} rounded-3xl p-5 md:p-6`}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">提示词工作台</h2>
          <p className="mt-1 text-sm text-slate-600">首版支持文本生图，已预留后续图片编辑与多轮会话扩展位。</p>
        </div>
        <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
          {prompt.trim().length}/4000
        </span>
      </header>

      <textarea
        className={styles.textarea}
        placeholder="例如：A cinematic wide-angle photo of a futuristic tea house floating above terraced fields at sunrise..."
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        rows={6}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={styles.primaryButton}
          onClick={onGenerate}
          disabled={isGenerating || !prompt.trim()}
        >
          {isGenerating ? '生成中...' : '生成图片'}
        </button>
        <button type="button" className={styles.ghostButton} onClick={onClearResult}>
          清空结果
        </button>
      </div>
    </section>
  )
}
