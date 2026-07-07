/**
 * Decomposition source normalization.
 *
 * Extracted from server/index.ts. Validates the decompose request body and
 * normalizes attached source images (base64 + media type), then turns them
 * into Anthropic image blocks / evidence markdown for the decompose prompts.
 */
import Anthropic from '@anthropic-ai/sdk'
import { mediaTypeFromValue } from '../lib/imageMediaType'
import type { ImageMediaType } from '../../src/types/imageMedia'

export interface DecompositionSourceRequest {
  mdText?: unknown
  mdFilename?: unknown
  sourceText?: unknown
  sourceFilename?: unknown
  sourceImages?: unknown
  figmaUrl?: unknown
}

export interface NormalizedSourceImage {
  name: string
  mediaType: ImageMediaType
  data: string
  sourceUrl: string | null
  token: string | null
}

export interface NormalizedDecompositionSources {
  mdText: string | null
  mdFilename: string | null
  sourceImages: NormalizedSourceImage[]
  figmaUrl: string | null
}

/** Trimmed non-empty string, or null. */
export function normalizeOptionalSourceText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeBase64ImageData(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || !/^[A-Za-z0-9+/]+={0,2}$/u.test(trimmed)) return null
  return trimmed
}

export function normalizeDecompositionSourceImages(value: unknown, maxImages: number): NormalizedSourceImage[] {
  if (!Array.isArray(value)) return []

  return value
    .slice(0, maxImages)
    .map((item, index): NormalizedSourceImage | null => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const rawMediaType = candidate.mediaType ?? candidate.media_type
      const mediaType = typeof rawMediaType === 'string' ? mediaTypeFromValue(rawMediaType) : null
      const data = normalizeBase64ImageData(candidate.data)
      if (!mediaType || !data) return null
      return {
        name: normalizeOptionalSourceText(candidate.name) ?? `source-image-${index + 1}`,
        mediaType,
        data,
        sourceUrl: normalizeOptionalSourceText(candidate.sourceUrl ?? candidate.source_url),
        token: normalizeOptionalSourceText(candidate.token),
      }
    })
    .filter((image): image is NormalizedSourceImage => Boolean(image))
}

export function sourceImagesToAnthropicBlocks(images: NormalizedSourceImage[]): Anthropic.ImageBlockParam[] {
  return images.map((image) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mediaType,
      data: image.data,
    },
  }))
}

export function buildPrdImageEvidenceInstruction(imageBlocks: Anthropic.ImageBlockParam[], scope: string) {
  if (!imageBlocks.length) return ''
  return [
    '## 多模态 PRD 图片证据',
    `本次请求附带 ${imageBlocks.length} 张图片，来源可能包括 Figma 截图、飞书文档图片或用户导入图片。图片顺序依次对应"Figma 多模态截图证据"和"导入图片资料"中的索引。`,
    `当前拆解范围：${scope}。`,
    '请把这些图片当作 PRD 语义证据，而不是装饰附件：粗略识别界面用途、流程图/状态图、截图含义、可见文案、备注/标注、按钮、布局层级和状态反馈，并与正文交叉验证。',
    '当图片能补足正文省略的信息时，把结论写入对应节点的 summary/content/evidenceRefs/openQuestions；当图片与正文或标题冲突时，写入"需澄清点"，不要只按文字标题下结论。',
    '不要仅因为图片里出现按钮、图标、字段或装饰素材就新建页面节点；只有玩家实际看到且适合逐页打磨的界面/弹窗才作为页面节点。',
    '',
  ].join('\n')
}

export function buildSourceImageEvidenceMarkdown(images: NormalizedSourceImage[]) {
  if (!images.length) return ''
  return [
    '# 导入图片资料',
    '',
    '以下图片来自导入来源，已随本次拆解请求作为视觉证据提供给模型。图片主要用于补充页面结构、布局状态、视觉反馈、图示规则和素材依赖判断。',
    '',
    ...images.map((image, index) => [
      `## 图片 ${index + 1}：${image.name}`,
      image.sourceUrl ? `- 来源 URL：${image.sourceUrl}` : null,
      image.token ? `- 飞书素材 token：${image.token}` : null,
      `- 类型：${image.mediaType}`,
    ].filter(Boolean).join('\n')),
  ].join('\n\n')
}

export function normalizeDecompositionSources(body: DecompositionSourceRequest, maxImages: number): NormalizedDecompositionSources {
  const mdText = normalizeOptionalSourceText(body.sourceText) ?? normalizeOptionalSourceText(body.mdText)
  const mdFilename = normalizeOptionalSourceText(body.sourceFilename) ?? normalizeOptionalSourceText(body.mdFilename)
  const sourceImages = normalizeDecompositionSourceImages(body.sourceImages, maxImages)
  const figmaUrl = normalizeOptionalSourceText(body.figmaUrl)

  if (!mdText && !figmaUrl && sourceImages.length === 0) {
    throw new Error('请至少提供 Figma 设计稿链接或可分析的导入素材。')
  }

  return { mdText, mdFilename, sourceImages, figmaUrl }
}
