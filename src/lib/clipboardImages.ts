import type { ImageBlock } from '../types/chat'

export interface ClipboardImageAttachment {
  name: string
  mediaType: ImageBlock['source']['media_type']
  data: string
  previewUrl: string
  size: number
}

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

export function isSupportedImageMediaType(type: string): type is ImageBlock['source']['media_type'] {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(type)
}

export function getClipboardImageFiles(clipboardData: DataTransfer | null | undefined) {
  if (!clipboardData) return []

  const itemFiles = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))

  if (itemFiles.length > 0) return itemFiles

  return Array.from(clipboardData.files ?? []).filter((file) => file.type.startsWith('image/'))
}

export function readImageFileAsClipboardAttachment(file: File, fallbackName: string) {
  return new Promise<ClipboardImageAttachment>((resolve, reject) => {
    if (!isSupportedImageMediaType(file.type)) {
      reject(new Error('仅支持 png、jpg、webp 或 gif 图片。'))
      return
    }
    const mediaType = file.type

    const reader = new FileReader()
    reader.onload = (event) => {
      const previewUrl = String(event.target?.result ?? '')
      const data = previewUrl.split(',')[1]
      if (!data) {
        reject(new Error('图片读取失败，请重试。'))
        return
      }
      resolve({
        name: file.name || fallbackName,
        mediaType,
        data,
        previewUrl,
        size: file.size,
      })
    }
    reader.onerror = () => reject(new Error('图片读取失败，请重试。'))
    reader.readAsDataURL(file)
  })
}
