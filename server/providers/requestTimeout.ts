const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 180_000
const MIN_IMAGE_REQUEST_TIMEOUT_MS = 15_000
const MAX_IMAGE_REQUEST_TIMEOUT_MS = 600_000

export function getImageRequestTimeoutMs(): number {
  const rawValue = process.env.IMAGE_REQUEST_TIMEOUT_MS
  if (!rawValue) {
    return DEFAULT_IMAGE_REQUEST_TIMEOUT_MS
  }

  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_IMAGE_REQUEST_TIMEOUT_MS
  }

  return Math.min(
    MAX_IMAGE_REQUEST_TIMEOUT_MS,
    Math.max(MIN_IMAGE_REQUEST_TIMEOUT_MS, Math.round(parsed)),
  )
}
