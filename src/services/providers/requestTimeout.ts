const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 180_000
const MIN_IMAGE_REQUEST_TIMEOUT_MS = 15_000
const MAX_IMAGE_REQUEST_TIMEOUT_MS = 600_000

const IMAGE_REQUEST_TIMEOUT_MS = resolveTimeoutMs(
    import.meta.env.VITE_IMAGE_REQUEST_TIMEOUT_MS,
)

export function getImageRequestTimeoutMs(): number {
    return IMAGE_REQUEST_TIMEOUT_MS
}

export function getImageRequestTimeoutSeconds(): number {
    return Math.ceil(IMAGE_REQUEST_TIMEOUT_MS / 1000)
}

function resolveTimeoutMs(rawValue: string | undefined): number {
    if (!rawValue) {
        return DEFAULT_IMAGE_REQUEST_TIMEOUT_MS
    }

    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed)) {
        return DEFAULT_IMAGE_REQUEST_TIMEOUT_MS
    }

    const normalized = Math.round(parsed)
    if (normalized < MIN_IMAGE_REQUEST_TIMEOUT_MS) {
        return MIN_IMAGE_REQUEST_TIMEOUT_MS
    }

    if (normalized > MAX_IMAGE_REQUEST_TIMEOUT_MS) {
        return MAX_IMAGE_REQUEST_TIMEOUT_MS
    }

    return normalized
}
