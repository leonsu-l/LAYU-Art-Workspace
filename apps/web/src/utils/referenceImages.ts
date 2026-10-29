import type { ReferenceImage } from '@nanobanana/shared/types/generation'
import { createAppError } from '@nanobanana/shared/utils/errors'
import { detectReferenceMime, getReferenceImageLimitError } from '@nanobanana/shared/utils/referenceImages'
import type { ReferenceImageLimits } from '@nanobanana/shared/utils/referenceImages'

export * from '@nanobanana/shared/utils/referenceImages'

function invalid(message: string): never {
  throw createAppError('VALIDATION', message, false, 400)
}

export function getDroppedReferenceFiles(transfer: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const items = Array.from(transfer.items)
  if (items.some((item) => item.kind === 'file' && item.webkitGetAsEntry?.()?.isDirectory)) {
    invalid('不支持上传文件夹，请拖入具体的图片文件。')
  }
  const files = Array.from(transfer.files)
  if (!files.length) invalid('请拖入本地图片文件，不支持网页链接或文件夹。')
  return files
}

export async function readReferenceImage(file: File, limits: ReferenceImageLimits): Promise<ReferenceImage> {
  const error = getReferenceImageLimitError([file.size], limits)
  if (error) invalid(`${file.name}：${error}`)
  const mimeType = detectReferenceMime(new Uint8Array(await file.slice(0, 12).arrayBuffer()))
  if (!mimeType || (file.type && file.type !== mimeType)) invalid(`${file.name} 不是有效的 PNG、JPEG 或 WebP 图片。`)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(createAppError('VALIDATION', `无法读取 ${file.name}。`, false))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取图片。'))
    reader.readAsDataURL(file)
  })
  const image: ReferenceImage = { name: file.name.slice(0, 255), mimeType, base64Data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
  const preview = new Image()
  preview.src = `data:${mimeType};base64,${image.base64Data}`
  try { await preview.decode() } catch { invalid(`${file.name} 无法解码，请重新导出图片。`) }
  return image
}
