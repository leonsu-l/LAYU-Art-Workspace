import { useRef } from 'react'
import type { ReferenceImage } from '@nanobanana/shared/types/generation'
import type { ReferenceImageLimits } from '../utils/referenceImages'
import { ReferenceImageUpload } from './ReferenceImageUpload'
import { RippleButton } from '../studio/Ripple'
import { promptIdeas } from '../utils/promptIdeas'
import styles from '../studio/Workbench.module.css'

interface PromptPanelProps {
  prompt: string; isSubmitting: boolean; canGenerate: boolean; onPromptChange: (value: string) => void; onGenerate: () => void
  referenceImages: ReferenceImage[]; referenceLimits: ReferenceImageLimits; referenceImageError: string | null
  onReferenceImagesChange: (images: ReferenceImage[]) => void; onReadingImagesChange: (loading: boolean) => void
}
export function PromptPanel({ prompt, isSubmitting, canGenerate, onPromptChange, onGenerate, referenceImages, referenceLimits, referenceImageError, onReferenceImagesChange, onReadingImagesChange }: PromptPanelProps) {
  const input = useRef<HTMLTextAreaElement>(null)
  return <section className={styles.promptCard} aria-label="提示词与参考图">
    <div className={styles.fieldHead}><label className={styles.fieldTitle} htmlFor="image-prompt">画面描述</label><span id="prompt-count" className={styles.fieldMeta}>{prompt.trim().length} / 4000</span></div>
    <textarea ref={input} id="image-prompt" className={styles.promptTextarea} rows={4} maxLength={4000} aria-describedby="prompt-count" value={prompt}
      placeholder="描述主体、光线、材质与构图…" onChange={(e) => onPromptChange(e.target.value)} onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (canGenerate) onGenerate() }
      }} />
    <ReferenceImageUpload images={referenceImages} limits={referenceLimits} selectionError={referenceImageError} disabled={isSubmitting}
      onChange={onReferenceImagesChange} onLoadingChange={onReadingImagesChange}>
      <div className={styles.presetMiniRow}>{promptIdeas.slice(0, 2).map((p) => <RippleButton key={p.label} type="button" className={styles.presetChip} disabled={isSubmitting} onClick={() => { onPromptChange(p.prompt); input.current?.focus() }}>{p.label}</RippleButton>)}</div>
    </ReferenceImageUpload>
  </section>
}
