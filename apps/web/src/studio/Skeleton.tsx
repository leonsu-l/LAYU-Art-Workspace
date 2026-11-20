import { useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import styles from './Skeleton.module.css'

export type SkeletonVariant =
  | 'text'
  | 'pill'
  | 'circle'
  | 'rect'
  | 'button'
  | 'field'
  | 'media'

export type SkeletonTone = 'base' | 'subtle'

function toCssSize(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'number' ? `${value}px` : value
}

const VARIANT_CLASS: Record<SkeletonVariant, string> = {
  text: styles.variantText,
  pill: styles.variantPill,
  circle: styles.variantCircle,
  rect: styles.variantRect,
  button: styles.variantButton,
  field: styles.variantField,
  media: styles.variantMedia,
}

export function SkeletonBlock({
  variant = 'rect',
  tone = 'base',
  width,
  height,
  radius,
  aspectRatio,
  staggerIndex = 0,
  icon,
  iconSize = 20,
  className = '',
  style,
}: {
  variant?: SkeletonVariant
  tone?: SkeletonTone
  width?: string | number
  height?: string | number
  radius?: string | number
  aspectRatio?: string
  staggerIndex?: number
  icon?: 'image' | 'sparkles' | 'sliders' | 'banana'
  iconSize?: number
  className?: string
  style?: CSSProperties
}) {
  const inlineStyle: CSSProperties = {
    width: toCssSize(width),
    height: toCssSize(height),
    borderRadius: toCssSize(radius),
    aspectRatio,
    ...(staggerIndex > 0
      ? ({ '--shimmer-delay': `-${(staggerIndex % 8) * 95}ms` } as CSSProperties)
      : {}),
    ...style,
  }

  return (
    <span
      aria-hidden="true"
      className={`${styles.skeleton} ${VARIANT_CLASS[variant]} ${tone === 'subtle' ? styles.toneSubtle : ''} ${className}`}
      style={inlineStyle}
    >
      {icon ? (
        <span className={styles.mediaGlyph}>
          <Icon name={icon} size={iconSize} />
        </span>
      ) : null}
    </span>
  )
}

export function SkeletonTextStack({
  widths = ['92%', '68%'],
  lineHeight = 13,
  staggerIndex = 0,
  className = '',
}: {
  widths?: readonly string[]
  lineHeight?: number
  staggerIndex?: number
  className?: string
}) {
  return (
    <span className={`${styles.textStack} ${className}`} aria-hidden="true">
      {widths.map((w, idx) => (
        <SkeletonBlock
          key={idx}
          variant="text"
          width={w}
          height={lineHeight}
          staggerIndex={staggerIndex + idx}
        />
      ))}
    </span>
  )
}

export function ShimmerImage({
  src,
  alt,
  aspectRatio = '4 / 3',
  radius,
  forceSkeleton = false,
  staggerIndex = 0,
  iconSize = 22,
  className = '',
  wrapperClassName = '',
  onClick,
  title,
}: {
  src: string
  alt: string
  aspectRatio?: string
  radius?: string | number
  forceSkeleton?: boolean
  staggerIndex?: number
  iconSize?: number
  className?: string
  wrapperClassName?: string
  onClick?: () => void
  title?: string
}) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [erroredSrc, setErroredSrc] = useState<string | null>(null)

  const isLoaded = !forceSkeleton && loadedSrc === src && erroredSrc !== src

  return (
    <span
      className={`${styles.shimmerImageWrap} ${wrapperClassName}`}
      style={{
        aspectRatio,
        borderRadius: toCssSize(radius),
      }}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        title={title}
        onClick={onClick}
        className={`${styles.shimmerImageEl} ${isLoaded ? styles.shimmerImageElLoaded : ''} ${className}`}
        onLoad={() => {
          setErroredSrc((prev) => (prev === src ? null : prev))
          setLoadedSrc(src)
        }}
        onError={() => {
          setErroredSrc(src)
        }}
      />
      {erroredSrc === src && !forceSkeleton ? <span className={styles.imageError}>图片加载失败</span> : <span
        aria-hidden="true"
        className={`${styles.shimmerOverlay} ${isLoaded ? styles.shimmerOverlayHidden : ''}`}
        style={
          staggerIndex > 0
            ? ({ '--shimmer-delay': `-${(staggerIndex % 8) * 95}ms` } as CSSProperties)
            : undefined
        }
      >
        <span className={styles.mediaGlyph}>
          <Icon name="image" size={iconSize} />
        </span>
      </span>}
    </span>
  )
}

export function ConnectedRatioSkeleton() {
  return (
    <div className={styles.connectedRatioSkeleton} aria-hidden="true">
      {Array.from({ length: 6 }, (_, idx) => (
        <SkeletonBlock
          key={idx}
          className={styles.connectedRatioTile}
          staggerIndex={idx}
        />
      ))}
    </div>
  )
}

export function SplitCtaSkeleton() {
  return (
    <div className={styles.splitCtaSkeleton} aria-hidden="true">
      <SkeletonBlock className={styles.splitCtaMain} staggerIndex={0} />
      <SkeletonBlock className={styles.splitCtaSide} staggerIndex={1} />
    </div>
  )
}
