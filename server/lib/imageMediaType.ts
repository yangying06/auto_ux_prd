/**
 * Image media-type detection helpers (server-side).
 *
 * Consolidates the previously separate mediaTypeFromValue /
 * mediaTypeFromFilePath / normalizeImageMediaType / normalizeSourceImageMediaType
 * helpers that each re-implemented the same content-type sniffing.
 */
import path from 'node:path'
import type { ImageMediaType } from '../../src/types/imageMedia'

const SUPPORTED: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

/** Resolve a raw Content-Type / media-type string to a supported type, or null. */
export function mediaTypeFromValue(value: string | null | undefined): ImageMediaType | null {
  const normalized = value?.split(';')[0]?.trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'image/jpg') return 'image/jpeg'
  return SUPPORTED.has(normalized) ? (normalized as ImageMediaType) : null
}

/** Resolve a media type from a file path's extension, or null. */
export function mediaTypeFromFilePath(filePath: string): ImageMediaType | null {
  const extension = path.extname(filePath).toLowerCase()
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    default:
      return null
  }
}

/** Like mediaTypeFromValue, but falls back to image/png for Figma exports. */
export function normalizeImageMediaTypeWithFallback(mediaType: string | null | undefined): ImageMediaType {
  return mediaTypeFromValue(mediaType) ?? 'image/png'
}
