/**
 * Canonical image media-type used across chat content blocks, source-image
 * imports, Figma exports, and reference-image classification.
 *
 * Previously this same four-value union was duplicated in src/types/chat.ts
 * (ImageBlock['source']['media_type']), server/index.ts
 * (SupportedSourceImageMediaType, ReferenceImageMediaType), and re-derived
 * ad-hoc in normalizeImageMediaType/mediaTypeFromValue/mediaTypeFromFilePath.
 */
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

/** File extension for a media type (e.g. image/jpeg -> jpg). */
export function extensionForMediaType(mediaType: string): string {
  if (mediaType.includes('jpeg')) return 'jpg'
  if (mediaType.includes('webp')) return 'webp'
  if (mediaType.includes('gif')) return 'gif'
  return 'png'
}
