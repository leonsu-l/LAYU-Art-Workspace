export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

export interface ContainerMorphFrame {
  transform: string
  clipPath: string
  radiusAtScale: number
}

export function parseDimensionsText(dimensions: string): { width: number; height: number } {
  const match = dimensions.match(/(\d+)\s*[×xX]\s*(\d+)/)
  if (!match) return { width: 4, height: 3 }
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 4, height: 3 }
  }
  return { width, height }
}

export function measureContainImageRect(
  surfaceRect: RectLike,
  imgEl: HTMLImageElement,
  fallbackDimensions: string,
): RectLike {
  const measured = imgEl.getBoundingClientRect()
  if (measured.width >= 20 && measured.height >= 20) {
    return {
      left: measured.left,
      top: measured.top,
      width: measured.width,
      height: measured.height,
    }
  }

  const canvasRect = imgEl.parentElement?.getBoundingClientRect() ?? surfaceRect
  const intrinsic =
    imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0
      ? { width: imgEl.naturalWidth, height: imgEl.naturalHeight }
      : parseDimensionsText(fallbackDimensions)

  const scale = Math.min(
    canvasRect.width / Math.max(1, intrinsic.width),
    canvasRect.height / Math.max(1, intrinsic.height),
  )
  const width = intrinsic.width * scale
  const height = intrinsic.height * scale
  return {
    left: canvasRect.left + (canvasRect.width - width) / 2,
    top: canvasRect.top + (canvasRect.height - height) / 2,
    width,
    height,
  }
}

interface ContainerMorphGeometry {
  s: number
  localImgCX: number
  localImgCY: number
  localThumbCX: number
  localThumbCY: number
  clipTop: number
  clipRight: number
  clipBottom: number
  clipLeft: number
  radiusAtScale: number
}

function computeContainerMorphGeometry(
  thumbRect: RectLike,
  surfaceRect: RectLike,
  imgRect: RectLike,
  thumbRadiusPx = 14,
): ContainerMorphGeometry {
  const safeImgW = Math.max(1, imgRect.width)
  const safeImgH = Math.max(1, imgRect.height)
  const s = Math.max(thumbRect.width / safeImgW, thumbRect.height / safeImgH)

  const localImgCX = imgRect.left - surfaceRect.left + safeImgW / 2
  const localImgCY = imgRect.top - surfaceRect.top + safeImgH / 2
  const localThumbCX = thumbRect.left + thumbRect.width / 2 - surfaceRect.left
  const localThumbCY = thumbRect.top + thumbRect.height / 2 - surfaceRect.top

  const halfW = thumbRect.width / (2 * s)
  const halfH = thumbRect.height / (2 * s)

  return {
    s,
    localImgCX,
    localImgCY,
    localThumbCX,
    localThumbCY,
    clipLeft: Math.max(0, localImgCX - halfW),
    clipRight: Math.max(0, surfaceRect.width - (localImgCX + halfW)),
    clipTop: Math.max(0, localImgCY - halfH),
    clipBottom: Math.max(0, surfaceRect.height - (localImgCY + halfH)),
    radiusAtScale: thumbRadiusPx / s,
  }
}

export function computeContainerMorphFrame(
  thumbRect: RectLike,
  surfaceRect: RectLike,
  imgRect: RectLike,
  thumbRadiusPx = 14,
): ContainerMorphFrame {
  const g = computeContainerMorphGeometry(thumbRect, surfaceRect, imgRect, thumbRadiusPx)
  const tx = g.localThumbCX - g.localImgCX * g.s
  const ty = g.localThumbCY - g.localImgCY * g.s

  return {
    transform: `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0px) scale(${g.s.toFixed(5)})`,
    clipPath: `inset(${g.clipTop.toFixed(2)}px ${g.clipRight.toFixed(2)}px ${g.clipBottom.toFixed(2)}px ${g.clipLeft.toFixed(2)}px round ${g.radiusAtScale.toFixed(2)}px)`,
    radiusAtScale: g.radiusAtScale,
  }
}

function bezierSample(t: number, p1: number, p2: number): number {
  const c = 3 * p1
  const b = 3 * (p2 - p1) - c
  const a = 1 - c - b
  return ((a * t + b) * t + c) * t
}

function bezierSlope(t: number, p1: number, p2: number): number {
  const c = 3 * p1
  const b = 3 * (p2 - p1) - c
  const a = 1 - c - b
  return (3 * a * t + 2 * b) * t + c
}

export function solveCubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  xTarget: number,
): number {
  if (xTarget <= 0) return 0
  if (xTarget >= 1) return 1

  let lo = 0
  let hi = 1
  let u = xTarget

  for (let i = 0; i < 6; i += 1) {
    const err = bezierSample(u, x1, x2) - xTarget
    if (Math.abs(err) < 1e-6) break
    if (err < 0) lo = u
    else hi = u

    const slope = bezierSlope(u, x1, x2)
    if (Math.abs(slope) > 1e-6) {
      const next = u - err / slope
      u = next > lo && next < hi ? next : (lo + hi) * 0.5
    } else {
      u = (lo + hi) * 0.5
    }
  }

  for (let i = 0; i < 8; i += 1) {
    const err = bezierSample(u, x1, x2) - xTarget
    if (Math.abs(err) < 1e-5) break
    if (err < 0) lo = u
    else hi = u
    u = (lo + hi) * 0.5
  }

  return Math.min(1, Math.max(0, bezierSample(u, y1, y2)))
}

export function buildContainerMorphKeyframes(
  thumbRect: RectLike,
  surfaceRect: RectLike,
  imgRect: RectLike,
  direction: 'open' | 'close',
  thumbRadiusPx = 14,
  steps = 28,
): Keyframe[] {
  const g = computeContainerMorphGeometry(thumbRect, surfaceRect, imgRect, thumbRadiusPx)
  const p0x = g.localThumbCX
  const p0y = g.localThumbCY
  const p2x = g.localImgCX
  const p2y = g.localImgCY

  const dx = p2x - p0x
  const dy = p2y - p0y
  const dist = Math.hypot(dx, dy)

  // Upward concave parabolic arch on launch; tighter return arc on close.
  const baseLift = Math.min(surfaceRect.height * 0.2, Math.min(156, Math.max(58, dist * 0.32)))
  const liftY = direction === 'open' ? baseLift : baseLift * 0.58
  const horizFactor = Math.max(0, 1 - Math.abs(dx) / 160)
  const sideDir = p0x <= p2x ? -1 : 1
  const maxBow = Math.min(44, surfaceRect.width * 0.09)
  const centerBow = sideDir * maxBow * horizFactor * (direction === 'open' ? 1 : 0.65)
  const skewX = -dx * 0.06 * (1 - horizFactor) * (direction === 'open' ? 1 : 0.5)

  const p1x = Math.min(surfaceRect.width - 24, Math.max(24, (p0x + p2x) * 0.5 + centerBow + skewX))
  const p1y = Math.max(16, (p0y + p2y) * 0.5 - liftY)

  const frames: Keyframe[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const uPos =
      direction === 'open'
        ? solveCubicBezier(0.14, 0.78, 0.2, 1.0, t)
        : 1 - solveCubicBezier(0.32, 0.04, 0.16, 1.0, t)
    const uScale =
      direction === 'open'
        ? solveCubicBezier(0.28, 0.56, 0.22, 1.0, t)
        : 1 - solveCubicBezier(0.22, 0.1, 0.18, 1.0, t)
    const uClip =
      direction === 'open'
        ? solveCubicBezier(0.24, 0.64, 0.24, 1.0, t)
        : 1 - solveCubicBezier(0.22, 0.1, 0.18, 1.0, t)

    const invPos = 1 - uPos
    const cx = invPos * invPos * p0x + 2 * invPos * uPos * p1x + uPos * uPos * p2x
    const cy = invPos * invPos * p0y + 2 * invPos * uPos * p1y + uPos * uPos * p2y

    const scaleNow = g.s + (1 - g.s) * uScale
    const tx = cx - g.localImgCX * scaleNow
    const ty = cy - g.localImgCY * scaleNow

    const clipFactor = 1 - uClip
    const cTop = g.clipTop * clipFactor
    const cRight = g.clipRight * clipFactor
    const cBottom = g.clipBottom * clipFactor
    const cLeft = g.clipLeft * clipFactor
    const rad = g.radiusAtScale * clipFactor

    let bgColor: string
    if (direction === 'open') {
      const bgAlpha =
        t < 0.72
          ? 0.98 - 0.22 * (t / 0.72)
          : Math.max(0, 0.76 * (1 - (t - 0.72) / 0.28))
      const rgb = t < 0.72 ? '18, 22, 33' : '14, 17, 25'
      bgColor = `rgba(${rgb}, ${bgAlpha.toFixed(3)})`
    } else {
      const bgAlpha =
        t < 0.18 ? 0.96 * (t / 0.18) : 0.96 + 0.02 * ((t - 0.18) / 0.82)
      const rgb = t < 0.04 ? '14, 17, 25' : '18, 22, 33'
      bgColor = `rgba(${rgb}, ${bgAlpha.toFixed(3)})`
    }

    frames.push({
      offset: t,
      transform: `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0px) scale(${scaleNow.toFixed(5)})`,
      clipPath: `inset(${cTop.toFixed(2)}px ${cRight.toFixed(2)}px ${cBottom.toFixed(2)}px ${cLeft.toFixed(2)}px round ${rad.toFixed(2)}px)`,
      backgroundColor: bgColor,
    })
  }

  return frames
}

export function isRectMostlyInViewport(rect: RectLike): boolean {
  const vh = window.innerHeight || 900
  const vw = window.innerWidth || 1440
  const bottom = rect.top + rect.height
  const right = rect.left + rect.width
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    bottom > 16 &&
    rect.top < vh - 16 &&
    right > 16 &&
    rect.left < vw - 16
  )
}
