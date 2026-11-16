import { useRef } from 'react'
import { Icon } from './Icon'
import { ReferenceImageUpload } from './ReferenceImageUpload'
import type { ReferenceImage } from '@nanobanana/shared/types/generation'
import type { ReferenceImageLimits } from '../utils/referenceImages'
import { promptIdeas } from '../utils/promptIdeas'
import styles from './PromptPanel.module.css'

interface PromptPanelProps {
  prompt: string
  isSubmitting: boolean
  canGenerate: boolean
  onPromptChange: (value: string) => void
  onGenerate: () => void
  referenceImages: ReferenceImage[]
  referenceLimits: ReferenceImageLimits
  referenceImageError: string | null
  onReferenceImagesChange: (images: ReferenceImage[]) => void
  onReadingImagesChange: (loading: boolean) => void
}

export function PromptPanel({
  prompt,
  isSubmitting,
  canGenerate,
  onPromptChange,
  onGenerate,
  referenceImages,
  referenceLimits,
  referenceImageError,
  onReferenceImagesChange,
  onReadingImagesChange,
}: PromptPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const count = prompt.trim().length

  return (
    <section className={styles.panel} aria-labelledby="prompt-heading">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>PROMPT &amp; REFERENCES</span>
          <h2 id="prompt-heading" className={styles.heading}>画面描述</h2>
          <p className={styles.sub}>描述主体、光线与风格 · Ctrl / ⌘ + ↵ 直接提交</p>
        </div>
        <span className={styles.saveTag}>
          <Icon name="check" size={12} />
          自动保存
        </span>
      </header>

      <div className={styles.editor}>
        <label htmlFor="image-prompt" className={styles.srOnly}>图片提示词</label>
        <textarea
          ref={inputRef}
          id="image-prompt"
          className={styles.textarea}
          placeholder={'一场不合常理的想象，也可以是一个好开头。\n试着描述主体、场景、光线和你喜欢的风格…'}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (canGenerate) onGenerate()
            }
          }}
          aria-describedby="prompt-count"
          aria-invalid={count > 4000}
          maxLength={4000}
          rows={4}
        />
        <span id="prompt-count" className={`${styles.counter} tnum ${count > 4000 ? styles.overLimit : ''}`}>
          {count.toLocaleString()}
          <span> / 4,000</span>
        </span>
      </div>

      <div className={styles.ideas}>
        <span className={styles.ideasLabel}>试试灵感</span>
        {promptIdeas.map((idea) => (
          <button
            key={idea.label}
            type="button"
            className={styles.chip}
            disabled={isSubmitting}
            onClick={() => {
              onPromptChange(idea.prompt)
              inputRef.current?.focus()
            }}
          >
            <Icon name="plus" size={12} />
            <span>{idea.label}</span>
          </button>
        ))}
      </div>

      <ReferenceImageUpload
        images={referenceImages}
        limits={referenceLimits}
        selectionError={referenceImageError}
        disabled={isSubmitting}
        onChange={onReferenceImagesChange}
        onLoadingChange={onReadingImagesChange}
      />
    </section>
  )
}
