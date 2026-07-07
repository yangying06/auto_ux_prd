/**
 * PRD document source-index construction.
 *
 * Extracted from server/index.ts. Parses markdown headings, builds structured
 * source sections, derives keyword signals and preview issues, and assembles a
 * PrdImportPreview (sections + candidate page nodes) for the decompose flow.
 *
 * Pure functions over (mdText, headings, config). External dependencies are
 * limited to the shared text utilities and the source-slice helper so the
 * module is independently testable.
 */
import type {
  DocumentKeywordSignal,
  DocumentSourceIndex,
  DocumentSourceIssue,
  DocumentSourceSection,
  PrdImportCandidateNode,
  PrdImportPreview,
} from '../../src/types/prdNode'
import {
  compactExcerpt,
  countLinesMatching,
  countPattern,
  estimateTextTokens,
  idSegmentFromTitle,
} from '../lib/textUtils'
import { splitLongSectionLines } from './sourceSlice'

export interface MarkdownHeading {
  rawLevel: number
  level: number
  title: string
  line: number
  id: string
  parentId: string | null
  order: number
  sectionText: string
}

export function compactMarkdownTitle(title: string) {
  return title
    .replace(/^#+\s*/, '')
    .replace(/^\d+[\.\、\)]\s*/, '')
    .replace(/^[一二三四五六七八九十]+[、.]\s*/, '')
    .replace(/[：:]\s*$/, '')
    .trim()
}

export function extractMarkdownHeadings(mdText: string): MarkdownHeading[] {
  const lines = mdText.split(/\r?\n/)
  const rawHeadings = lines
    .map((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
      if (!match) return null
      const title = compactMarkdownTitle(match[2])
      if (!title) return null
      return { rawLevel: match[1].length, title, line: index + 1 }
    })
    .filter((item): item is { rawLevel: number; title: string; line: number } => item !== null)

  if (!rawHeadings.length) return []

  const minLevel = Math.min(...rawHeadings.map((heading) => heading.rawLevel))
  const stack: MarkdownHeading[] = []
  const orderByParent = new Map<string, number>()

  return rawHeadings.map((heading, index) => {
    const nextRawHeading = rawHeadings[index + 1]
    const level = Math.min(4, Math.max(1, heading.rawLevel - minLevel + 1))
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()

    const parent = stack[stack.length - 1] ?? null
    const parentKey = parent?.id ?? 'root'
    const order = orderByParent.get(parentKey) ?? 0
    orderByParent.set(parentKey, order + 1)

    const id = `OUTLINE-${index + 1}-${idSegmentFromTitle(heading.title, String(index + 1))}`
    const startLine = heading.line
    const endLine = nextRawHeading ? nextRawHeading.line - 1 : lines.length
    const sectionText = lines.slice(startLine, endLine).join('\n').trim()
    const item: MarkdownHeading = {
      rawLevel: heading.rawLevel,
      level,
      title: heading.title,
      line: heading.line,
      id,
      parentId: parent?.id ?? null,
      order,
      sectionText,
    }
    stack.push(item)
    return item
  })
}

const keywordSignalDefinitions: Array<{ category: DocumentKeywordSignal['category']; label: string; pattern: RegExp }> = [
  { category: 'pages', label: '页面/界面', pattern: /页面|界面|弹窗|面板|浮层|主界面|详情页|规则页|帮助页|排行榜|商城|背包|任务页|结算页/gu },
  { category: 'states', label: '状态/反馈', pattern: /状态|空状态|加载|Loading|成功|失败|完成|未完成|可领取|已领取|倒计时|冷却|禁用|置灰/gu },
  { category: 'rewards', label: '奖励/资源', pattern: /奖励|道具|金币|钻石|积分|经验|宝箱|货币|体力|奖池|领取/gu },
  { category: 'navigation', label: '入口/跳转', pattern: /入口|跳转|返回|关闭|打开|进入|退出|导航|路由|引导/gu },
  { category: 'apis', label: '接口/请求', pattern: /接口|API|endpoint|请求|响应|返回值|服务端|客户端|协议/giu },
  { category: 'configs', label: '配置/参数', pattern: /配置|参数|开关|阈值|概率|权重|字段|枚举|表格|数值/gu },
]

function buildSectionSignals(text: string) {
  return keywordSignalDefinitions
    .filter((definition) => countPattern(text, definition.pattern) > 0)
    .map((definition) => definition.label)
}

function buildKeywordSignals(mdText: string): DocumentKeywordSignal[] {
  return keywordSignalDefinitions
    .map((definition) => ({
      category: definition.category,
      label: definition.label,
      matches: countPattern(mdText, definition.pattern),
    }))
    .filter((signal) => signal.matches > 0)
    .sort((a, b) => b.matches - a.matches || a.label.localeCompare(b.label))
}

export function markdownHeadingTitlePath(heading: MarkdownHeading, headingMap: Map<string, MarkdownHeading>) {
  const titles: string[] = []
  let current: MarkdownHeading | undefined = heading
  while (current) {
    titles.unshift(current.title)
    current = current.parentId ? headingMap.get(current.parentId) : undefined
  }
  return titles.join(' / ')
}

function makeDocumentSourceSection(
  id: string,
  title: string,
  titlePath: string,
  level: number,
  startLine: number,
  endLine: number,
  text: string,
): DocumentSourceSection {
  const normalizedText = text.trim()
  return {
    id,
    title,
    titlePath,
    level,
    startLine,
    endLine,
    charCount: normalizedText.length,
    estimatedTokens: estimateTextTokens(normalizedText),
    excerpt: compactExcerpt(normalizedText),
    signals: buildSectionSignals(`${title}\n${titlePath}\n${normalizedText}`),
  }
}

export interface DocumentSourceIndexConfig {
  /** char threshold above which a document is treated as "large". */
  largePrdDecomposeThreshold: number
  /** target char length per slice when a section must be split. */
  largePrdSliceTargetLength: number
}

export function buildDocumentSourceSections(mdText: string, config: DocumentSourceIndexConfig) {
  const lines = mdText.split(/\r?\n/)
  const headings = extractMarkdownHeadings(mdText)

  if (!headings.length) {
    return splitLongSectionLines(lines, 1, config.largePrdSliceTargetLength).map((slice, index) =>
      makeDocumentSourceSection(
        `SRC-${String(index + 1).padStart(3, '0')}`,
        `全文片段 ${index + 1}`,
        `全文片段 ${index + 1}`,
        1,
        slice.startLine,
        slice.endLine,
        slice.text,
      )
    )
  }

  const headingMap = new Map(headings.map((heading) => [heading.id, heading]))
  return headings
    .map((heading, index) => {
      const nextHeading = headings[index + 1]
      const endLine = nextHeading ? nextHeading.line - 1 : lines.length
      return makeDocumentSourceSection(
        `SRC-${String(index + 1).padStart(3, '0')}`,
        heading.title,
        markdownHeadingTitlePath(heading, headingMap),
        heading.level,
        heading.line,
        endLine,
        lines.slice(heading.line - 1, endLine).join('\n'),
      )
    })
    .filter((section) => section.charCount > 0)
}

function buildDocumentSourceIssues(mdText: string, sections: DocumentSourceSection[], headingCount: number, config: DocumentSourceIndexConfig): DocumentSourceIssue[] {
  const issues: DocumentSourceIssue[] = []
  const imageRefs = countPattern(mdText, /!\[[^\]]*\]\([^)]+\)|\.(png|jpe?g|webp|gif)\b/giu)
  const tableLines = countLinesMatching(mdText, /^\s*\|.+\|\s*$/)
  const largest = sections.reduce<DocumentSourceSection | null>(
    (current, section) => (!current || section.charCount > current.charCount ? section : current),
    null,
  )

  if (!headingCount) {
    issues.push({
      id: 'no-markdown-headings',
      severity: 'warning',
      title: '缺少 Markdown 标题',
      detail: '系统会按长度切片建立索引，页面边界更依赖正文线索，建议确认结构预览后再拆解。',
      sectionId: null,
    })
  }

  if (mdText.length >= config.largePrdDecomposeThreshold) {
    issues.push({
      id: 'large-document',
      severity: 'info',
      title: '大 PRD 分段分析',
      detail: `文档超过 ${Math.round(config.largePrdDecomposeThreshold / 1024)}KB，正式拆解会分段识别页面线索后归并。`,
      sectionId: null,
    })
  }

  if (largest && largest.charCount > config.largePrdSliceTargetLength) {
    issues.push({
      id: 'large-section',
      severity: 'warning',
      title: '存在超长章节',
      detail: `「${largest.titlePath}」约 ${largest.charCount} 字符，后续会切成多个片段，建议检查该章节是否包含多个页面。`,
      sectionId: largest.id,
    })
  }

  if (headingCount > 120) {
    issues.push({
      id: 'many-headings',
      severity: 'info',
      title: '标题数量较多',
      detail: `检测到 ${headingCount} 个标题，预览只展示关键线索，正式导图仍会以页面/弹窗为单位归并。`,
      sectionId: null,
    })
  }

  if (tableLines > 12) {
    issues.push({
      id: 'table-heavy',
      severity: 'info',
      title: '表格内容较多',
      detail: `检测到约 ${tableLines} 行表格，字段/配置更可能进入 model 子节点而不是页面节点。`,
      sectionId: null,
    })
  }

  if (imageRefs > 0) {
    issues.push({
      id: 'image-references',
      severity: 'warning',
      title: '包含图片引用',
      detail: `检测到 ${imageRefs} 处图片引用。当前导入只读取 Markdown 文本，图片细节需要后续在 Deep Forge 中补充。`,
      sectionId: null,
    })
  }

  if (mdText.trim().length < 500) {
    issues.push({
      id: 'short-document',
      severity: 'warning',
      title: '文档内容较短',
      detail: '可读文本较少，AI 可能只能生成少量页面节点，建议确认 PRD 是否完整。',
      sectionId: null,
    })
  }

  return issues
}

const candidatePageTitlePattern = /页面|界面|弹窗|面板|浮层|主界面|详情页|规则页|帮助页|排行榜|商城|背包|任务页|结算页|活动页|入口/iu
const candidateContentPattern = /入口|跳转|打开|关闭|展示|按钮|列表|弹窗|页面|界面|空状态|倒计时|领取|返回|结算/giu

function candidateKey(title: string) {
  return title.replace(/[\s《》「」【】\[\]（）()：:，,。.!！?？\-_/\\]/g, '').toLowerCase()
}

export function buildCandidateNodesFromIndex(sourceIndex: DocumentSourceIndex): PrdImportCandidateNode[] {
  const candidates = new Map<string, PrdImportCandidateNode>()

  for (const section of sourceIndex.sections) {
    const text = `${section.title}\n${section.titlePath}\n${section.excerpt}`
    const titleHit = candidatePageTitlePattern.test(section.title) || candidatePageTitlePattern.test(section.titlePath)
    const contentHits = countPattern(text, candidateContentPattern)
    const hasPageSignal = section.signals.includes('页面/界面')
    if (!titleHit && !hasPageSignal && contentHits < 2) continue

    const title = compactMarkdownTitle(section.title).slice(0, 24) || `页面线索 ${candidates.size + 1}`
    const key = candidateKey(title)
    if (!key || candidates.has(key)) continue

    const confidence = Math.min(95, 48 + (titleHit ? 24 : 0) + (hasPageSignal ? 16 : 0) + Math.min(contentHits * 4, 16))
    const reasonParts = [
      titleHit ? '标题包含页面/界面线索' : null,
      hasPageSignal ? '正文出现页面级信号' : null,
      contentHits > 0 ? `命中 ${contentHits} 个交互词` : null,
    ].filter(Boolean)

    candidates.set(key, {
      title,
      sectionId: section.id,
      sourceLabel: `${section.titlePath}（第 ${section.startLine}-${section.endLine} 行）`,
      reason: reasonParts.join('；') || '正文出现交互结构线索',
      confidence,
      excerpt: section.excerpt,
    })
  }

  return [...candidates.values()]
    .sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title))
    .slice(0, 12)
}

export function buildDocumentSourceIndex(mdText: string, config: DocumentSourceIndexConfig): DocumentSourceIndex {
  const lines = mdText.split(/\r?\n/)
  const headings = extractMarkdownHeadings(mdText)
  const sections = buildDocumentSourceSections(mdText, config)
  const largestSectionChars = sections.reduce((max, section) => Math.max(max, section.charCount), 0)

  return {
    sourceLabel: '上传 PRD',
    totalLines: lines.length,
    totalChars: mdText.length,
    estimatedTokens: estimateTextTokens(mdText),
    headingCount: headings.length,
    sectionCount: sections.length,
    largestSectionChars,
    sections,
    keywordSignals: buildKeywordSignals(mdText),
    issues: buildDocumentSourceIssues(mdText, sections, headings.length, config),
  }
}

export function buildPrdImportPreview(mdText: string, config: DocumentSourceIndexConfig): PrdImportPreview {
  const sourceIndex = buildDocumentSourceIndex(mdText, config)
  return {
    sourceIndex,
    candidateNodes: buildCandidateNodesFromIndex(sourceIndex),
  }
}
