/**
 * PRD spec markdown generation & export helpers.
 *
 * Extracted from server/index.ts. Pure functions that turn a PrdTree into
 * markdown documents, evidence files, and zipped spec folders.
 */
import { existsSync, writeFileSync, statSync, type Dirent, copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import {
  buildDeliverySections,
  collectBackendContracts,
  collectDeliveryEvidence,
  collectDeliveryNodes,
  filterDeliveryNodesByDepth,
  type ExportDepth,
} from '../../src/lib/prdNodeDelivery'
import { figmaUiStateKindLabel } from '../figmaSemantics'

import {
  formatSectionTitle,
  hasNodeSections,
  resolveNodeAudience,
  formatSpecLens,
  resolveNodeSpecLens,
} from '../../src/lib/prdNodeLens'
import {
  formatPerformanceSpecMarkdown,
  resolveNodePerformanceSpec,
} from '../../src/lib/performanceOrchestration'
import type { PrdNodeSectionKey } from '../../src/types/prdNode'

import type {
  PrdNode,
  PrdNodeEvidenceRef,
  PrdStateTransition,
} from '../../src/types/prdNode'

const SPEC_EXPORT_ROOT = path.resolve(process.cwd(), 'generated', 'specs')
const SPEC_UI_FLOW_DOC_PATH = 'UI-FLOW.md'

export interface SourceDetailBlock {
  title: string
  body: string
  origin: string
}

export interface UiFlowExportDoc {
  docPath: string
  markdown: string
  nodeCount: number
  edgeCount: number
}

export interface RenderableNodeSection {
  key: PrdNodeSectionKey
  section: NonNullable<NonNullable<PrdNode['sections']>[PrdNodeSectionKey]>
  sectionContent: string
}

export interface AssetExportSummary {
  exportDir: string
  manifestPath: string
  copiedFiles: number
  copiedBytes: number
  skippedItems: number
}

export interface MutableAssetExportSummary extends AssetExportSummary {
  manifestLines: string[]
  skippedLines: string[]
}


export function normalizeTextValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function normalizeZipPath(value: string) {
  return value.replace(/\\+/g, '/').replace(/^\/+|\/+$/g, '')
}

export interface EvidenceExportDoc {
  nodeId: string
  docPath: string
  evidencePath: string
}

export interface UiFlowExportEdge {
  sourceNodeId: string
  targetNodeId: string
  label: string
  reason: string | null
  source: string
}

export function sanitizeLabel(label: string): string {
  const sanitized = label
    .replace(/[^\w一-鿿\-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '')
  return sanitized || 'untitled'
}


export function sanitizeNodeId(id: string): string {
  const sanitized = id
    .replace(/[^\w.-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48)
    .replace(/^-|-$/g, '')
  return sanitized || 'node'
}


export function sanitizeDocPathSegment(segment: string) {
  const sanitized = segment
    .replace(/[<>:"\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+$/, '')
    .replace(/^-|-$/g, '')
  return sanitized || 'untitled'
}


export function normalizeExportDocPath(docPath: string | null | undefined): string | null {
  if (!docPath) return null
  const normalized = docPath
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:\//, '')
    .replace(/^\/+/, '')
    .replace(/^\.\/+/, '')
    .trim()
  const parts = normalized
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map(sanitizeDocPathSegment)
  if (!parts.length) return null
  const last = parts[parts.length - 1]
  parts[parts.length - 1] = last.toLowerCase().endsWith('.md') ? last : `${last}.md`
  return parts.join('/')
}


export function buildNodePath(nodeId: string, tree: Record<string, PrdNode>): string {
  const explicitPath = normalizeExportDocPath(tree[nodeId]?.docPath)
  if (explicitPath) return explicitPath

  const parts: string[] = []
  let current: PrdNode | undefined = tree[nodeId]
  while (current) {
    parts.unshift(sanitizeNodeId(current.id))
    current = current.parentId ? tree[current.parentId] : undefined
  }
  // parts = [rootId, ...ancestors, leafId]
  // All segments except the last become folder names; last becomes the filename
  const folders = parts.slice(0, -1)
  const leaf = tree[nodeId]
  const filename = `${sanitizeNodeId(leaf.id)}-${sanitizeLabel(leaf.label)}.md`
  return [...folders, filename].join('/')
}


export function formatNodeType(type: PrdNode['type']) {
  if (type === 'module') return '模块'
  if (type === 'page') return '页面'
  if (type === 'ui') return '界面/交互'
  return '功能'
}


export function formatAudience(audience: PrdNode['audience'] | null | undefined) {
  if (audience === 'overview') return '项目概览 / 路线规划 AI'
  if (audience === 'client') return '客户端 / UI AI'
  if (audience === 'server') return '服务端 / 业务逻辑 AI'
  if (audience === 'config') return '配置 / 数值 AI'
  if (audience === 'api') return '接口 / 联调 AI'
  if (audience === 'acceptance') return '验收 / 测试 AI'
  if (audience === 'appendix') return '附录 / 风险 AI'
  if (audience === 'mixed') return '跨职责 AI'
  return '未指定'
}


export function formatNodeSectionsForContext(sections: PrdNode['sections']) {
  if (!hasNodeSections(sections)) return ''
  return [
    '页面规格视角:',
    ...(['view', 'interaction', 'data'] as const).map((key) => {
      const section = sections?.[key]
      if (!section?.summary && !section?.content) return null
      return [
        `- ${section.title ?? formatSectionTitle(key)}`,
        section.summary ? `  摘要: ${section.summary}` : null,
        section.content ? `  内容: ${section.content}` : null,
      ].filter(Boolean).join('\n')
    }).filter((item): item is string => Boolean(item)),
  ].join('\n')
}


export function findNodeStateLabel(node: PrdNode | null | undefined, stateId: string | null | undefined) {
  if (!node || !stateId) return null
  return node.uiStates?.find((state) => state.id === stateId)?.label ?? null
}


export function formatStateTransitionLine(transition: PrdStateTransition, tree?: Record<string, PrdNode> | null, options: { includeEvidence?: boolean } = {}) {
  const source = tree?.[transition.sourceNodeId]
  const target = tree?.[transition.targetNodeId]
  const sourceLabel = source?.label ?? transition.sourceNodeId
  const targetLabel = target?.label ?? transition.targetNodeId
  const sourceState = findNodeStateLabel(source, transition.sourceStateId)
  const targetState = findNodeStateLabel(target, transition.targetStateId)
  const trigger = transition.trigger ? `触发：${transition.trigger}` : null
  const condition = transition.condition ? `条件：${transition.condition}` : null
  const effect = transition.effect ? `结果：${transition.effect}` : null
  const transitionSource = transition.source ? `来源：${transition.source}` : null
  const evidence = transition.evidence.length ? `证据：${transition.evidence.join(' / ')}` : null
  return [
    `- ${sourceLabel}${sourceState ? `「${sourceState}」` : ''} -> ${targetLabel}${targetState ? `「${targetState}」` : ''}`,
    `  ${[trigger, condition, effect, transitionSource, `置信度：${transition.confidence}%`].filter(Boolean).join('；')}`,
    options.includeEvidence !== false && evidence ? `  ${evidence}` : null,
  ].filter(Boolean).join('\n')
}


export function collectIncomingStateTransitions(node: PrdNode, tree?: Record<string, PrdNode> | null) {
  if (!tree) return []
  return Object.values(tree)
    .filter((source) => source.id !== node.id)
    .flatMap((source) => (source.stateTransitions ?? []).filter((transition) => transition.targetNodeId === node.id))
}


export function formatFigmaStateSemanticsMarkdown(node: PrdNode, tree?: Record<string, PrdNode> | null, options: { includeEvidence?: boolean } = {}) {
  const includeEvidence = options.includeEvidence !== false
  const lines: string[] = []
  if (node.figmaUxMap) {
    lines.push('## Figma UX Map 审阅摘要', '')
    lines.push(`- Screen：${node.figmaUxMap.screenLabel}（${node.figmaUxMap.screenId}）`)
    lines.push(`- 审阅来源：${node.figmaUxMap.reviewSource}，总体置信度 ${node.figmaUxMap.reviewConfidence}%`)
    if (includeEvidence && node.figmaUxMap.sourceFrameIds.length) lines.push(`- 来源 Frames：${node.figmaUxMap.sourceFrameIds.join(', ')}`)
    if (node.figmaUxMap.transitionIds.length) lines.push(`- 相关流转：${node.figmaUxMap.transitionIds.join(', ')}`)
    if (node.figmaUxMap.ambiguityIds.length) lines.push(`- 待确认项：${node.figmaUxMap.ambiguityIds.join(', ')}`)
    if (node.figmaUxMap.notes.length) lines.push(`- 审阅备注：${node.figmaUxMap.notes.join('；')}`)
  }

  if (node.uiStates?.length) {
    lines.push('', '## Figma 状态语义', '')
    for (const state of node.uiStates) {
      const visibleTexts = state.visibleTexts.length ? `；文案：${state.visibleTexts.slice(0, 5).join(' / ')}` : ''
      const annotations = state.annotations.length ? `；注释：${state.annotations.join(' / ')}` : ''
      lines.push(`- ${state.label}（${figmaUiStateKindLabel(state.kind)}，置信度 ${state.confidence}%，node-id=${state.figmaNodeId}${visibleTexts}${annotations}）`)
    }
  }

  const outgoing = node.stateTransitions ?? []
  const incoming = collectIncomingStateTransitions(node, tree)
  if (outgoing.length || incoming.length) {
    lines.push('', '## Figma 状态/界面流转', '')
    if (outgoing.length) {
      lines.push('### 流出', ...outgoing.map((transition) => formatStateTransitionLine(transition, tree, { includeEvidence })))
    }
    if (incoming.length) {
      lines.push('', '### 流入', ...incoming.map((transition) => formatStateTransitionLine(transition, tree, { includeEvidence })))
    }
  }

  return lines.join('\n').trim()
}


export function normalizeMarkdownBody(content: string) {
  return content
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}


export function sourceDetailTitle(title: string) {
  return /原文|摘录|证据引用|折叠来源/.test(title)
}


export function splitMarkdownSections(content: string) {
  const sections: Array<{ heading: string | null; marker: string | null; body: string }> = []
  const lines = content.split(/\r?\n/)
  let currentHeading: string | null = null
  let currentMarker: string | null = null
  let currentBody: string[] = []

  const flush = () => {
    const body = currentBody.join('\n').trim()
    if (currentHeading || body) sections.push({ heading: currentHeading, marker: currentMarker, body })
    currentBody = []
  }

  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.+)$/.exec(line.trim())
    if (heading) {
      flush()
      currentMarker = heading[1]
      currentHeading = heading[2].trim()
    } else {
      currentBody.push(line)
    }
  }
  flush()

  return sections
}


export function extractSourceBlocks(content: string | null | undefined, origin: string): { visible: string; sourceBlocks: SourceDetailBlock[] } {
  const normalized = normalizeMarkdownBody(content ?? '')
  if (!normalized) return { visible: '', sourceBlocks: [] }

  const sections = splitMarkdownSections(normalized)
  if (!sections.some((section) => section.heading && sourceDetailTitle(section.heading))) {
    return { visible: normalized, sourceBlocks: [] }
  }

  const visible: string[] = []
  const sourceBlocks: SourceDetailBlock[] = []

  for (const section of sections) {
    if (section.heading && sourceDetailTitle(section.heading)) {
      if (section.body) sourceBlocks.push({ title: section.heading, body: section.body, origin })
      continue
    }
    if (section.heading) visible.push(`${section.marker ?? '##'} ${section.heading}`)
    if (section.body) visible.push(section.body)
  }

  return {
    visible: visible.join('\n\n').trim(),
    sourceBlocks,
  }
}


export function evidenceExportPathFor(node: PrdNode) {
  return `evidence/by-node/${sanitizeNodeId(node.id)}-${sanitizeLabel(node.label)}.md`
}


export function markdownRelativeLink(fromDocPath: string | null | undefined, targetPath: string) {
  const from = (fromDocPath ?? '').replace(/\\/g, '/').trim()
  const target = targetPath.replace(/\\/g, '/').trim()
  const fromDir = from ? path.posix.dirname(from) : '.'
  const relative = path.posix.relative(fromDir, target)
  return relative || path.posix.basename(target)
}


export function localEvidenceKey(ref: PrdNodeEvidenceRef) {
  return `${ref.sourceKind}:${ref.sourceLabel}:${ref.quote ?? ''}`
}


export function uniqueLocalEvidenceRefs(refs: PrdNodeEvidenceRef[]) {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = localEvidenceKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}


export function evidenceRefLine(ref: PrdNodeEvidenceRef) {
  return `- [${ref.sourceKind}] ${ref.sourceLabel}${ref.quote ? `：${ref.quote}` : ''}`
}


export function collectSourceBlocksForEvidence(node: PrdNode, tree?: Record<string, PrdNode> | null) {
  const blocks: SourceDetailBlock[] = []
  blocks.push(...extractSourceBlocks(node.content, '节点正文').sourceBlocks)
  for (const section of buildDeliverySections(node, tree)) {
    blocks.push(...extractSourceBlocks(section.content, `${section.title} 规格`).sourceBlocks)
  }
  return blocks
}


export function collectOpenQuestionsForEvidence(node: PrdNode, tree?: Record<string, PrdNode> | null) {
  const questions = [
    ...(node.sections ? Object.values(node.sections).flatMap((section) => section?.openQuestions ?? []) : []),
    ...buildDeliverySections(node, tree).flatMap((section) => section.openQuestions),
  ].map((item) => item.trim()).filter(Boolean)
  return Array.from(new Set(questions))
}


export function isExportFallbackSummary(value: string | null | undefined) {
  const text = value?.trim() ?? ''
  return Boolean(text)
    && (
      text.includes('AI 通读原文失败')
      || text.includes('AI 分片通读未返回页面节点')
      || text.includes('系统先保留该页面候选')
      || text.includes('本地候选兜底')
      || text.includes('AI 未能在超时时间内完成')
    )
}


export function exportSummaryForNode(node: PrdNode) {
  if (!isExportFallbackSummary(node.summary)) return node.summary || '未填写'
  const figmaCount = node.figmaPreviews?.length ?? node.uiStates?.length ?? 0
  if (figmaCount > 0 || node.figmaUxMap) {
    return `来自 Figma 的确定性界面节点，包含 ${Math.max(1, figmaCount)} 个界面状态；PRD 失败/兜底信息已移入证据链，业务规则需后续打磨确认。`
  }
  return node.handoffGoal ?? '该节点缺少稳定摘要，请先补齐页面范围、交互目标和验收口径。'
}


export function generateEvidenceMarkdown(node: PrdNode, tree?: Record<string, PrdNode>, options: { docPath?: string | null; evidencePath?: string | null } = {}) {
  const sourceBlocks = collectSourceBlocksForEvidence(node, tree)
  const evidenceRefs = uniqueLocalEvidenceRefs(collectDeliveryEvidence(node, tree))
  const openQuestions = collectOpenQuestionsForEvidence(node, tree)
  const visibleContent = extractSourceBlocks(node.content, '节点正文').visible
  const specLink = options.docPath && options.evidencePath
    ? markdownRelativeLink(options.evidencePath, options.docPath)
    : options.docPath

  const lines = [
    `# 证据链：${node.label}`,
    '',
    '> 本文件用于审计和复盘推导来源。实现 AI 默认只需要阅读对应主规格文档；当规格与 PRD/Figma/用户补充发生争议时，再回到这里检查证据。',
    '',
    '## 对应规格',
    '',
    `- 节点编号：${node.id}`,
    `- 节点类型：${formatNodeType(node.type)}`,
    specLink ? `- 主规格文档：[${options.docPath}](${specLink})` : null,
    node.extractedFrom ? `- 原文位置：${node.extractedFrom}` : '- 原文位置：未定位',
    '',
    '## AI 整理结论快照',
    '',
    `- AI 接力目标：${node.handoffGoal ?? '未指定'}`,
    `- 质量门槛：${node.qualityGate ?? '未指定'}`,
    `- 需求摘要：${node.summary || '未填写'}`,
    visibleContent ? ['', '### 整理说明', '', visibleContent] : null,
  ].flat().filter((item): item is string => typeof item === 'string')

  if (sourceBlocks.length) {
    lines.push('', '## 原文 / 来源片段')
    for (const block of sourceBlocks) {
      lines.push('', `### ${block.origin} / ${block.title}`, '', block.body)
    }
  } else {
    lines.push('', '## 原文 / 来源片段', '', '暂无可单独抽离的原文片段。')
  }

  lines.push('', '## 证据引用', '')
  if (evidenceRefs.length) {
    lines.push(...evidenceRefs.map(evidenceRefLine))
  } else {
    lines.push('暂无结构化证据引用。')
  }

  const figmaEvidenceMarkdown = formatFigmaStateSemanticsMarkdown(node, tree, { includeEvidence: true })
  if (figmaEvidenceMarkdown) {
    lines.push('', '## Figma / 状态流转推导', '', figmaEvidenceMarkdown)
  }

  if (openQuestions.length) {
    lines.push('', '## 待确认 / 可能误读点', '', ...openQuestions.map((item) => `- ${item}`))
  }

  return lines.join('\n')
}


export function generateMarkdown(node: PrdNode, tree?: Record<string, PrdNode>, options: { evidencePath?: string | null; includeInlineEvidence?: boolean } = {}): string {
  const includeInlineEvidence = options.includeInlineEvidence ?? !options.evidencePath
  const nodeSource = extractSourceBlocks(node.content, '节点正文')
  const nodeContent = nodeSource.visible || (includeInlineEvidence ? node.content : '')
  const statusLabel = node.status === 'done' ? '已完成' : node.status === 'pending_refine' || node.needsPolish ? '待打磨' : '无需打磨'
  const exportSummary = exportSummaryForNode(node)
  const lines = [
    `# ${node.label}`,
    '',
    `**节点编号：** ${node.id}`,
    `**节点类型：** ${formatNodeType(node.type)}`,
    `**导出路径：** ${node.docPath ?? '未指定'}`,
    `**面向角色：** ${formatAudience(resolveNodeAudience(node))}`,
    `**规格视角：** ${formatSpecLens(resolveNodeSpecLens(node))}`,
    `**完成状态：** ${statusLabel}`,
    `**打磨要求：** ${node.needsPolish ? '需要 Deep Forge 确认' : '无需 Deep Forge 确认'}`,
    '',
    '## AI 接力目标',
    '',
    node.handoffGoal ?? '未指定。请先补齐该文档要交给哪个 AI/角色完成什么任务。',
    '',
    '## 质量门槛',
    '',
    node.qualityGate ?? '未指定。请先补齐职责边界、依赖关系和可测试检查点。',
    '',
    '## 需求摘要',
    '',
    exportSummary,
    '',
    '## 详细内容',
    '',
    nodeContent || '未补充详细内容。',
  ]
  if (options.evidencePath) {
    lines.push('', '## 追溯', '', `证据链文件：${options.evidencePath}`)
  }
  if (hasNodeSections(node.sections)) {
    const renderableSections: RenderableNodeSection[] = []
    for (const key of ['view', 'interaction', 'data'] as const) {
      const section = node.sections?.[key]
      if (!section?.summary && !section?.content && !section?.evidenceRefs?.length && !section?.openQuestions?.length) continue
      const sectionContent = extractSourceBlocks(section.content, `${section.title ?? formatSectionTitle(key)} 规格`).visible
      const shouldRenderSection = Boolean(
        section.summary
        || sectionContent
        || section.openQuestions?.length
        || (includeInlineEvidence && section.evidenceRefs?.length),
      )
      if (shouldRenderSection) renderableSections.push({ key, section, sectionContent })
    }

    if (renderableSections.length) {
      lines.push('', '## 页面规格视角')
    }
    for (const { key, section, sectionContent } of renderableSections) {
      lines.push('', `### ${section.title ?? formatSectionTitle(key)}`)
      if (section.summary) lines.push('', section.summary)
      if (sectionContent) lines.push('', sectionContent)
      if (includeInlineEvidence && section.evidenceRefs?.length) {
        lines.push('', '#### 证据引用')
        for (const ref of section.evidenceRefs) {
          lines.push(evidenceRefLine(ref))
        }
      }
      if (section.openQuestions?.length) {
        lines.push('', '#### 需澄清点', ...section.openQuestions.map((item) => `- ${item}`))
      }
    }
  }
  if (tree) {
    const foldedSections = buildDeliverySections(node, tree)
      .filter((section) => section.sourceNodeIds.length > 0)
      .map((section) => {
        const sectionContent = extractSourceBlocks(section.content, `${section.title} 规格`).visible
        const shouldRenderSection = Boolean(
          section.summary
          || sectionContent
          || section.openQuestions.length
          || (includeInlineEvidence && section.evidenceRefs.length),
        )
        return shouldRenderSection ? { section, sectionContent } : null
      })
      .filter((item): item is { section: ReturnType<typeof buildDeliverySections>[number]; sectionContent: string } => Boolean(item))
    if (foldedSections.length) {
      lines.push('', '## 折叠子节点补充')
      for (const { section, sectionContent } of foldedSections) {
        lines.push('', `### ${section.title}`)
        if (section.summary) lines.push('', section.summary)
        if (sectionContent) lines.push('', sectionContent)
        if (includeInlineEvidence && section.evidenceRefs.length) {
          lines.push('', '#### 证据引用')
          for (const ref of section.evidenceRefs) {
            lines.push(evidenceRefLine(ref))
          }
        }
        if (section.openQuestions.length) lines.push('', '#### 需澄清点', ...section.openQuestions.map((item) => `- ${item}`))
      }
    }
  }

  const figmaStateMarkdown = formatFigmaStateSemanticsMarkdown(node, tree, { includeEvidence: includeInlineEvidence })
  if (figmaStateMarkdown) {
    lines.push('', figmaStateMarkdown)
  }

  const performanceMarkdown = formatPerformanceSpecMarkdown(resolveNodePerformanceSpec(node))
  if (performanceMarkdown) {
    lines.push('', performanceMarkdown)
  }
  if (node.references?.length) {
    lines.push('', '## 跨页面引用', '')
    for (const reference of node.references) {
      lines.push(`- ${reference.label}${reference.targetNodeId ? ` → ${reference.targetNodeId}` : ''}${reference.reason ? `：${reference.reason}` : ''}`)
    }
  }
  const backendContracts = collectBackendContracts(node, tree)
  if (backendContracts.length) {
    lines.push('', '## 服务端交互 / 依赖引用')
    for (const contract of backendContracts) {
      lines.push('', `### ${contract.title}`, '', `- 类型：${contract.kind}`)
      if (contract.targetNodeId) lines.push(`- 目标节点：${contract.targetNodeId}`)
      if (contract.summary) lines.push(`- 说明：${contract.summary}`)
      if (contract.fields?.length) lines.push(`- 字段：${contract.fields.join('、')}`)
      if (includeInlineEvidence && contract.evidenceRefs?.length) {
        lines.push('', '#### 证据引用')
        for (const ref of contract.evidenceRefs) {
          lines.push(evidenceRefLine(ref))
        }
      }
    }
  }

  const evidenceRefs = collectDeliveryEvidence(node, tree)
  if (includeInlineEvidence && evidenceRefs.length) {
    lines.push('', '## 汇总证据')
    for (const ref of evidenceRefs) {
      lines.push(evidenceRefLine(ref))
    }
  }

  if (node.techNotes) {
    lines.push('', '## 技术备注', '', node.techNotes)
  }
  return lines.join('\n')
}


export function uniqueExportPath(path: string, files: Record<string, Uint8Array>) {
  if (!files[path]) return path
  const dot = path.toLowerCase().endsWith('.md') ? path.length - 3 : path.length
  const base = path.slice(0, dot)
  const ext = path.slice(dot)
  let index = 2
  let candidate = `${base}-${index}${ext}`
  while (files[candidate]) {
    index += 1
    candidate = `${base}-${index}${ext}`
  }
  return candidate
}


export function pathDepth(path: string) {
  return path.split('/').length
}


export function exportedPathFor(node: PrdNode, tree: Record<string, PrdNode>, pathByNodeId: Map<string, string>) {
  return pathByNodeId.get(node.id) ?? buildNodePath(node.id, tree)
}


export function generateIndexMarkdown(
  exportedNodes: PrdNode[],
  tree: Record<string, PrdNode>,
  pathByNodeId: Map<string, string>,
  evidenceDocs: EvidenceExportDoc[] = [],
  options: { uiFlowPath?: string | null } = {},
) {
  const sorted = [...exportedNodes].sort((a, b) => exportedPathFor(a, tree, pathByNodeId).localeCompare(exportedPathFor(b, tree, pathByNodeId)))
  const byAudience = sorted.reduce<Record<string, PrdNode[]>>((groups, node) => {
    const key = formatAudience(resolveNodeAudience(node))
    groups[key] = [...(groups[key] ?? []), node]
    return groups
  }, {})

  const fileTreeLines = sorted.map((node) => {
    const path = exportedPathFor(node, tree, pathByNodeId)
    const indent = '  '.repeat(Math.max(0, pathDepth(path) - 1))
    return `${indent}- [${path}](${path}) - ${exportSummaryForNode(node)}`
  })

  const audienceLines = Object.entries(byAudience).flatMap(([audience, nodes]) => [
    `### ${audience}`,
    '',
    ...nodes.map((node) => {
      const path = exportedPathFor(node, tree, pathByNodeId)
      return `- [${path}](${path}): ${node.handoffGoal ?? exportSummaryForNode(node)}`
    }),
    '',
  ])

  const topLevelLines = Object.values(tree)
    .filter((node) => node.parentId === 'SOURCE_OUTLINE_ROOT' || (node.parentId === null && node.id !== 'SOURCE_OUTLINE_ROOT'))
    .sort((a, b) => a.order - b.order)
    .map((node) => `- **${node.label}**：${exportSummaryForNode(node)}`)

  const evidenceLines = evidenceDocs.length
    ? [
        '## 证据链附件',
        '',
        '- [证据链总索引](evidence/EVIDENCE-INDEX.md)',
        '- 每篇主规格文档只保留追溯链接；PRD/Figma/用户补充证据集中放在 `evidence/by-node/`。',
        '',
      ]
    : []
  const uiFlowLines = options.uiFlowPath
    ? [
        '## 全局交互图',
        '',
        `- [UI 交互流](${options.uiFlowPath})：汇总导出页面、跨页面引用、状态流转和待补齐连接。`,
        '',
      ]
    : []

  return [
    '# PRD 文档包索引',
    '',
    '> 本索引由 UX SpecForge 自动生成。主规格文档面向后续实现 AI；证据链附件用于审计和复盘推导。',
    '',
    ...uiFlowLines,
    '## 文件树',
    '',
    ...fileTreeLines,
    '',
    ...evidenceLines,
    '## 按角色快速导航',
    '',
    ...audienceLines,
    '## 顶层范围速查',
    '',
    ...topLevelLines,
    '',
    '## 使用方式',
    '',
    '1. 先阅读本索引和 `01-overview.md`（如存在）建立全局认知。',
    '2. 根据任务角色只读取相关目录，例如客户端任务优先读取 `client/` 与相关 `api/` 文档。',
    '3. 实现 AI 默认阅读主规格文档；只有需要证明推导是否正确时，再打开 `evidence/` 下的证据链文件。',
    '4. 发现 `[需澄清]`、`[待验证]` 时先向用户确认，不要自行补规则。',
  ].join('\n')
}


export function generateEvidenceIndexMarkdown(evidenceDocs: EvidenceExportDoc[], tree: Record<string, PrdNode>) {
  const lines = [
    '# 证据链总索引',
    '',
    '> 证据文件用于审计 UX SpecForge 的拆分和 AI 推导。实现任务优先阅读主规格文档；当规格有争议时，再回到对应证据文件核对。',
    '',
    '## 节点证据',
    '',
  ]

  for (const doc of evidenceDocs) {
    const node = tree[doc.nodeId]
    const label = node?.label ?? doc.nodeId
    const evidenceCount = node ? collectDeliveryEvidence(node, tree).length : 0
    const sourceCount = node ? collectSourceBlocksForEvidence(node, tree).length : 0
    lines.push(`- [${label}](by-node/${path.posix.basename(doc.evidencePath)})：主规格 [${doc.docPath}](../${doc.docPath})；结构化证据 ${evidenceCount} 条，来源片段 ${sourceCount} 段`)
  }

  if (!evidenceDocs.length) lines.push('暂无证据文件。')
  return lines.join('\n')
}


export function compactFlowText(value: string | null | undefined, maxLength = 160) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}


export function tableCell(value: string | null | undefined, maxLength = 180) {
  return compactFlowText(value, maxLength).replace(/\|/g, '\\|') || '-'
}


export function mermaidLabel(value: string | null | undefined, maxLength = 60) {
  return compactFlowText(value, maxLength)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}


export function collectUiFlowExportEdges(exportedNodes: PrdNode[]) {
  const exportedIds = new Set(exportedNodes.map((node) => node.id))
  const edges: UiFlowExportEdge[] = []
  const seen = new Set<string>()

  const pushEdge = (edge: UiFlowExportEdge) => {
    if (!exportedIds.has(edge.sourceNodeId) || !exportedIds.has(edge.targetNodeId)) return
    if (edge.sourceNodeId === edge.targetNodeId) return
    const key = `${edge.sourceNodeId}->${edge.targetNodeId}|${edge.label}|${edge.source}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push(edge)
  }

  for (const node of exportedNodes) {
    for (const reference of node.references ?? []) {
      if (!reference.targetNodeId) continue
      pushEdge({
        sourceNodeId: node.id,
        targetNodeId: reference.targetNodeId,
        label: compactFlowText(reference.label, 80) || '进入目标界面',
        reason: reference.reason ?? null,
        source: '跨页面引用',
      })
    }

    for (const transition of node.stateTransitions ?? []) {
      pushEdge({
        sourceNodeId: transition.sourceNodeId,
        targetNodeId: transition.targetNodeId,
        label: compactFlowText(transition.trigger ?? transition.effect ?? transition.condition, 80) || '状态流转',
        reason: formatStateTransitionLine(transition, Object.fromEntries(exportedNodes.map((item) => [item.id, item]))),
        source: transition.source ?? '状态流转',
      })
    }
  }

  return edges
}


export function generateUiFlowMarkdown(exportedNodes: PrdNode[], tree: Record<string, PrdNode>, pathByNodeId: Map<string, string>, evidenceDocs: EvidenceExportDoc[]) {
  const sorted = [...exportedNodes].sort((a, b) => a.level - b.level || a.order - b.order || a.id.localeCompare(b.id))
  const edges = collectUiFlowExportEdges(sorted)
  const nodeAlias = new Map(sorted.map((node, index) => [node.id, `N${index + 1}`]))
  const evidenceByNodeId = new Map(evidenceDocs.map((doc) => [doc.nodeId, doc.evidencePath]))
  const connectedIds = new Set(edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]))
  const disconnected = sorted.filter((node) => !connectedIds.has(node.id))

  const mermaidLines = [
    'flowchart LR',
    ...sorted.map((node) => `  ${nodeAlias.get(node.id)}["${mermaidLabel(node.label)}"]`),
    ...(edges.length
      ? edges.map((edge) => `  ${nodeAlias.get(edge.sourceNodeId)} -->|"${mermaidLabel(edge.label, 36)}"| ${nodeAlias.get(edge.targetNodeId)}`)
      : ['  %% 暂无明确跨页面流转边；请在 Deep Forge 中补充触发动作或 Figma 连接线。']),
  ]

  const nodeRows = sorted.map((node) => {
    const docPath = exportedPathFor(node, tree, pathByNodeId)
    const evidencePath = evidenceByNodeId.get(node.id)
    return `| ${tableCell(node.label)} | [${tableCell(docPath, 90)}](${docPath}) | ${evidencePath ? `[证据](${evidencePath})` : '-'} | ${tableCell(exportSummaryForNode(node))} |`
  })

  const edgeRows = edges.map((edge) => {
    const source = tree[edge.sourceNodeId]?.label ?? edge.sourceNodeId
    const target = tree[edge.targetNodeId]?.label ?? edge.targetNodeId
    return `| ${tableCell(source)} | ${tableCell(edge.label)} | ${tableCell(target)} | ${tableCell(edge.source, 40)} | ${tableCell(edge.reason, 220)} |`
  })

  return {
    docPath: SPEC_UI_FLOW_DOC_PATH,
    nodeCount: sorted.length,
    edgeCount: edges.length,
    markdown: [
      '# UI 交互流',
      '',
      '> 本文件是导出包的全局交互入口。它只汇总当前导图中已有的页面、Figma 状态流转、跨页面引用和证据链，不补造缺失流程。',
      '',
      '## 总览',
      '',
      `- 页面节点：${sorted.length}`,
      `- 已识别流转：${edges.length}`,
      `- 未接入流转的页面：${disconnected.length}`,
      '',
      '## Mermaid 流程图',
      '',
      '```mermaid',
      ...mermaidLines,
      '```',
      '',
      '## 页面节点',
      '',
      '| 页面 | 规格文档 | 证据链 | 摘要 |',
      '|---|---|---|---|',
      ...(nodeRows.length ? nodeRows : ['| - | - | - | - |']),
      '',
      '## 交互流转',
      '',
      '| 起点 | 触发 / 动作 | 终点 | 来源 | 证据摘要 |',
      '|---|---|---|---|---|',
      ...(edgeRows.length ? edgeRows : ['| - | - | - | - | 当前导图尚未提供可追溯的跨页面流转。 |']),
      '',
      '## 待补齐连接',
      '',
      ...(disconnected.length
        ? disconnected.map((node) => `- ${node.label}：未发现明确流入或流出，需要在 Figma 连线、PRD 步骤或节点引用中补充。`)
        : ['- 暂无。']),
    ].join('\n'),
  } satisfies UiFlowExportDoc
}


export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}


export function safeAssetExportSegment(value: string | null | undefined, fallback: string) {
  return sanitizeDocPathSegment((value?.trim() || fallback).replace(/[\\/]+/g, '-'))
}


export function normalizeAssetExportPath(relativePath: string) {
  const parts = relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map(sanitizeDocPathSegment)
  return parts.length ? parts.join('/') : null
}


export function resolveGeneratedAssetExportPath(relativePath: string) {
  const safeRelative = normalizeAssetExportPath(`assets/${relativePath}`)
  if (!safeRelative) throw new Error('素材导出路径无效')
  const resolved = path.resolve(SPEC_EXPORT_ROOT, safeRelative)
  const rootWithSep = SPEC_EXPORT_ROOT.endsWith(path.sep) ? SPEC_EXPORT_ROOT : `${SPEC_EXPORT_ROOT}${path.sep}`
  if (resolved !== SPEC_EXPORT_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error('素材导出路径越界')
  }
  return { resolved, relative: safeRelative }
}


export function addAssetSkip(summary: MutableAssetExportSummary, label: string, reason: string) {
  summary.skippedItems += 1
  summary.skippedLines.push(`- ${label}：${reason}`)
}


export function copyAssetFile(sourcePath: string, targetRelativePath: string, summary: MutableAssetExportSummary, label: string) {
  try {
    if (!existsSync(sourcePath)) {
      addAssetSkip(summary, label, `源文件不存在：${sourcePath}`)
      return
    }
    const stat = statSync(sourcePath)
    if (!stat.isFile()) {
      addAssetSkip(summary, label, `不是文件：${sourcePath}`)
      return
    }
    const target = resolveGeneratedAssetExportPath(targetRelativePath)
    mkdirSync(path.dirname(target.resolved), { recursive: true })
    copyFileSync(sourcePath, target.resolved)
    summary.copiedFiles += 1
    summary.copiedBytes += stat.size
  } catch (error) {
    addAssetSkip(summary, label, error instanceof Error ? error.message : '复制失败')
  }
}


export function copyAssetDirectory(sourcePath: string, targetRelativeDir: string, summary: MutableAssetExportSummary, label: string) {
  try {
    if (!existsSync(sourcePath)) {
      addAssetSkip(summary, label, `源目录不存在：${sourcePath}`)
      return
    }
    const stat = statSync(sourcePath)
    if (stat.isFile()) {
      copyAssetFile(sourcePath, `${targetRelativeDir}/${path.basename(sourcePath)}`, summary, label)
      return
    }
    if (!stat.isDirectory()) {
      addAssetSkip(summary, label, `不是目录：${sourcePath}`)
      return
    }
    const entries = readdirSync(sourcePath, { withFileTypes: true }) as Dirent[]
    for (const entry of entries) {
      const sourceChild = path.join(sourcePath, entry.name)
      const targetChild = `${targetRelativeDir}/${entry.name}`
      if (entry.isSymbolicLink()) {
        addAssetSkip(summary, `${label}/${entry.name}`, '跳过符号链接')
      } else if (entry.isDirectory()) {
        copyAssetDirectory(sourceChild, targetChild, summary, `${label}/${entry.name}`)
      } else if (entry.isFile()) {
        copyAssetFile(sourceChild, targetChild, summary, `${label}/${entry.name}`)
      }
    }
  } catch (error) {
    addAssetSkip(summary, label, error instanceof Error ? error.message : '复制目录失败')
  }
}


export function copyAssetSource(sourcePath: string | null | undefined, targetRelativePath: string, summary: MutableAssetExportSummary, label: string) {
  if (!sourcePath) return
  try {
    const stat = existsSync(sourcePath) ? statSync(sourcePath) : null
    if (!stat) {
      addAssetSkip(summary, label, `源路径不存在：${sourcePath}`)
      return
    }
    if (stat.isDirectory()) {
      copyAssetDirectory(sourcePath, targetRelativePath, summary, label)
    } else if (stat.isFile()) {
      copyAssetFile(sourcePath, targetRelativePath, summary, label)
    } else {
      addAssetSkip(summary, label, `无法复制该路径类型：${sourcePath}`)
    }
  } catch (error) {
    addAssetSkip(summary, label, error instanceof Error ? error.message : '读取素材路径失败')
  }
}


export function relativePathUnderRoot(rootPath: string | null, sourcePath: string, fallbackName: string) {
  if (rootPath) {
    const relative = path.relative(rootPath, sourcePath)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return normalizeZipPath(relative)
  }
  return fallbackName
}


export function assetWorkbenchRows(assetWorkbench: unknown, key: 'uiRows' | 'effectRows' | 'audioRows') {
  const record = objectRecord(assetWorkbench)
  const rows = record ? record[key] : null
  return Array.isArray(rows) ? rows : []
}


export function writeUiAssetExports(assetWorkbench: unknown, summary: MutableAssetExportSummary) {
  const rows = assetWorkbenchRows(assetWorkbench, 'uiRows')
  if (!rows.length) return
  summary.manifestLines.push('', '## UI / Figma 素材')

  rows.forEach((rawRow, index) => {
    const row = objectRecord(rawRow)
    if (!row) return
    const result = objectRecord(row.result)
    const name = normalizeTextValue(row.name) ?? normalizeTextValue(result?.panelName) ?? `UI 素材 ${index + 1}`
    const id = normalizeTextValue(row.id) ?? `ui-${index + 1}`
    const baseDir = `ui/${safeAssetExportSegment(`${id}-${name}`, `ui-${index + 1}`)}`
    const before = summary.copiedFiles

    summary.manifestLines.push('', `### ${name}`)
    summary.manifestLines.push(`- 类型：${normalizeTextValue(row.kind) ?? 'ui'}`)
    if (normalizeTextValue(row.purpose)) summary.manifestLines.push(`- 用途：${normalizeTextValue(row.purpose)}`)
    if (normalizeTextValue(row.usageNote)) summary.manifestLines.push(`- 备注：${normalizeTextValue(row.usageNote)}`)
    if (normalizeTextValue(row.figmaUrl)) summary.manifestLines.push(`- 来源：${normalizeTextValue(row.figmaUrl)}`)
    summary.manifestLines.push(`- 导出目录：assets/${baseDir}/`)

    if (!result) {
      addAssetSkip(summary, name, 'UI 素材尚未解析')
      return
    }

    copyAssetSource(normalizeTextValue(result.outputDir), `${baseDir}/output`, summary, `${name} outputDir`)
    copyAssetSource(normalizeTextValue(result.assetsDir), `${baseDir}/assets`, summary, `${name} assetsDir`)
    copyAssetSource(normalizeTextValue(result.zipPath), `${baseDir}/${path.basename(normalizeTextValue(result.zipPath) ?? 'figma-assets.zip')}`, summary, `${name} zipPath`)
    copyAssetSource(normalizeTextValue(result.uiSpecPath), `${baseDir}/${path.basename(normalizeTextValue(result.uiSpecPath) ?? 'ui_spec.json')}`, summary, `${name} uiSpecPath`)
    copyAssetSource(normalizeTextValue(result.manifestPath), `${baseDir}/${path.basename(normalizeTextValue(result.manifestPath) ?? 'export_manifest.json')}`, summary, `${name} manifestPath`)

    const files = Array.isArray(result.files) ? result.files : []
    if (summary.copiedFiles === before) {
      files.forEach((rawFile, fileIndex) => {
        const file = objectRecord(rawFile)
        const sourcePath = normalizeTextValue(file?.path)
        const fileName = normalizeTextValue(file?.name) ?? (sourcePath ? path.basename(sourcePath) : `asset-${fileIndex + 1}`)
        copyAssetSource(sourcePath, `${baseDir}/files/${fileName}`, summary, `${name}/${fileName}`)
      })
    }
    summary.manifestLines.push(`- 文件数量：${summary.copiedFiles - before}`)
  })
}


export function writeEffectAssetExports(assetWorkbench: unknown, summary: MutableAssetExportSummary) {
  const rows = assetWorkbenchRows(assetWorkbench, 'effectRows')
  if (!rows.length) return
  summary.manifestLines.push('', '## 特效 / Prefab 素材')

  rows.forEach((rawRow, index) => {
    const row = objectRecord(rawRow)
    if (!row) return
    const name = normalizeTextValue(row.name) ?? `特效素材 ${index + 1}`
    const id = normalizeTextValue(row.id) ?? `effect-${index + 1}`
    const kind = normalizeTextValue(row.kind) ?? 'unknown'
    const baseDir = `effects/${safeAssetExportSegment(`${id}-${name}`, `effect-${index + 1}`)}`
    const sourceRoot = normalizeTextValue(row.sourceRoot)
    const before = summary.copiedFiles

    summary.manifestLines.push('', `### ${name}`)
    summary.manifestLines.push(`- 类型：${kind}`)
    if (normalizeTextValue(row.purpose)) summary.manifestLines.push(`- 用途：${normalizeTextValue(row.purpose)}`)
    if (normalizeTextValue(row.usageNote)) summary.manifestLines.push(`- 备注：${normalizeTextValue(row.usageNote)}`)
    if (normalizeTextValue(row.implementationHint)) summary.manifestLines.push(`- 接入建议：${normalizeTextValue(row.implementationHint)}`)
    summary.manifestLines.push(`- 导出目录：assets/${baseDir}/`)

    const loadedPath = normalizeTextValue(row.loadedPath)
    const loadedRelative = (() => { const p = loadedPath; if (!p) return null; const r = path.relative(path.resolve(process.cwd(), '.cache', 'effect-assets'), p); if (!r || r.startsWith('..') || path.isAbsolute(r)) return null; return normalizeZipPath(r); })()
    if (loadedPath && loadedRelative) {
      copyAssetSource(loadedPath, `${baseDir}/loaded`, summary, `${name} loadedPath`)
    }

    if (summary.copiedFiles === before) {
      const files = Array.isArray(row.files) ? row.files : []
      files.forEach((rawFile, fileIndex) => {
        const file = objectRecord(rawFile)
        const sourcePath = normalizeTextValue(file?.loadedPath) ?? normalizeTextValue(file?.path)
        if (!sourcePath) return
        const fileName = normalizeTextValue(file?.name) ?? path.basename(sourcePath) ?? `asset-${fileIndex + 1}`
        const relative = relativePathUnderRoot(sourceRoot, sourcePath, fileName)
        copyAssetSource(sourcePath, `${baseDir}/source/${relative}`, summary, `${name}/${fileName}`)
      })
    }
    summary.manifestLines.push(`- 文件数量：${summary.copiedFiles - before}`)
  })
}


export function writeAudioAssetExports(assetWorkbench: unknown, summary: MutableAssetExportSummary) {
  const rows = assetWorkbenchRows(assetWorkbench, 'audioRows')
  if (!rows.length) return
  summary.manifestLines.push('', '## 音频素材')

  rows.forEach((rawRow, index) => {
    const row = objectRecord(rawRow)
    if (!row) return
    const name = normalizeTextValue(row.name) ?? `音频素材 ${index + 1}`
    const id = normalizeTextValue(row.id) ?? `audio-${index + 1}`
    const kind = normalizeTextValue(row.kind) ?? 'unknown'
    const baseDir = `audio/${safeAssetExportSegment(`${id}-${name}`, `audio-${index + 1}`)}`
    const sourceRoot = normalizeTextValue(row.sourceRoot)
    const before = summary.copiedFiles

    summary.manifestLines.push('', `### ${name}`)
    summary.manifestLines.push(`- 类型：${kind}`)
    if (normalizeTextValue(row.purpose)) summary.manifestLines.push(`- 用途：${normalizeTextValue(row.purpose)}`)
    if (normalizeTextValue(row.triggerHint)) summary.manifestLines.push(`- 触发：${normalizeTextValue(row.triggerHint)}`)
    if (normalizeTextValue(row.playbackHint)) summary.manifestLines.push(`- 播放规则：${normalizeTextValue(row.playbackHint)}`)
    if (normalizeTextValue(row.usageNote)) summary.manifestLines.push(`- 备注：${normalizeTextValue(row.usageNote)}`)
    summary.manifestLines.push(`- 导出目录：assets/${baseDir}/`)

    const loadedPath = normalizeTextValue(row.loadedPath)
    const loadedRelative = (() => { const p = loadedPath; if (!p) return null; const r = path.relative(path.resolve(process.cwd(), '.cache', 'audio-assets'), p); if (!r || r.startsWith('..') || path.isAbsolute(r)) return null; return normalizeZipPath(r); })()
    if (loadedPath && loadedRelative) {
      copyAssetSource(loadedPath, `${baseDir}/loaded`, summary, `${name} loadedPath`)
    }

    if (summary.copiedFiles === before) {
      const files = Array.isArray(row.files) ? row.files : []
      files.forEach((rawFile, fileIndex) => {
        const file = objectRecord(rawFile)
        const sourcePath = normalizeTextValue(file?.loadedPath) ?? normalizeTextValue(file?.path)
        if (!sourcePath) return
        const fileName = normalizeTextValue(file?.name) ?? path.basename(sourcePath) ?? `audio-${fileIndex + 1}`
        const relative = relativePathUnderRoot(sourceRoot, sourcePath, fileName)
        copyAssetSource(sourcePath, `${baseDir}/source/${relative}`, summary, `${name}/${fileName}`)
      })
    }
    summary.manifestLines.push(`- 文件数量：${summary.copiedFiles - before}`)
  })
}


export function writeProjectAssetExports(assetWorkbench: unknown): AssetExportSummary {
  const assetDir = resolveGeneratedAssetExportPath('.')
  mkdirSync(assetDir.resolved, { recursive: true })
  const summary: MutableAssetExportSummary = {
    exportDir: assetDir.resolved,
    manifestPath: 'assets/ASSET-MANIFEST.md',
    copiedFiles: 0,
    copiedBytes: 0,
    skippedItems: 0,
    manifestLines: [
      '# 项目素材导出清单',
      '',
      '> 本清单由 UX SpecForge 自动生成。素材路径均相对于当前 spec 导出目录。',
    ],
    skippedLines: [],
  }

  writeUiAssetExports(assetWorkbench, summary)
  writeEffectAssetExports(assetWorkbench, summary)
  writeAudioAssetExports(assetWorkbench, summary)

  summary.manifestLines.push(
    '',
    '## 汇总',
    '',
    `- 已复制文件：${summary.copiedFiles}`,
    `- 已复制体积：${summary.copiedBytes} bytes`,
    `- 跳过项：${summary.skippedItems}`,
  )
  if (summary.skippedLines.length) {
    summary.manifestLines.push('', '## 跳过或失败项', '', ...summary.skippedLines)
  }
  const manifest = resolveGeneratedAssetExportPath('ASSET-MANIFEST.md')
  writeFileSync(manifest.resolved, summary.manifestLines.join('\n'), 'utf-8')

  return {
    exportDir: summary.exportDir,
    manifestPath: summary.manifestPath,
    copiedFiles: summary.copiedFiles,
    copiedBytes: summary.copiedBytes,
    skippedItems: summary.skippedItems,
  }
}


export function resolveGeneratedSpecPath(docPath: string) {
  const normalized = docPath.replace(/\\/g, '/').trim()
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || normalized.split('/').some((part) => part === '..')) {
    throw new Error('文档路径不允许访问生成目录之外的位置')
  }
  const safeRelative = normalizeExportDocPath(normalized)
  if (!safeRelative) throw new Error('文档路径无效')
  const resolved = path.resolve(SPEC_EXPORT_ROOT, safeRelative)
  const rootWithSep = SPEC_EXPORT_ROOT.endsWith(path.sep) ? SPEC_EXPORT_ROOT : `${SPEC_EXPORT_ROOT}${path.sep}`
  if (resolved !== SPEC_EXPORT_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error('文档路径越界')
  }
  return { resolved, relative: safeRelative }
}


export function normalizeExportDepth(value: unknown): ExportDepth {
  if (value === 'forged' || value === 'all' || value === 'done') return value
  return 'done'
}


export function resetSpecExportRoot() {
  rmSync(SPEC_EXPORT_ROOT, { recursive: true, force: true })
  mkdirSync(SPEC_EXPORT_ROOT, { recursive: true })
}


export function writeSpecFolder(tree: Record<string, PrdNode>, options: { depth?: ExportDepth; includeAssets?: boolean; assetWorkbench?: unknown } = {}) {
  const depth = normalizeExportDepth(options.depth)
  const pageNodes = filterDeliveryNodesByDepth(collectDeliveryNodes(tree), depth, tree)
  if (!pageNodes.length) throw new Error('没有找到可导出的页面 spec 节点，请降低导出深度或先打磨至少一个节点')
  resetSpecExportRoot()
  const pathByNodeId = new Map<string, string>()
  const documents: Array<{ nodeId: string; docPath: string }> = []
  for (const node of pageNodes) {
    const relativePath = uniqueExportPath(buildNodePath(node.id, tree), Object.fromEntries(documents.map((doc) => [doc.docPath, new Uint8Array()])))
    const target = resolveGeneratedSpecPath(relativePath)
    const evidencePath = evidenceExportPathFor(node)
    mkdirSync(path.dirname(target.resolved), { recursive: true })
    writeFileSync(
      target.resolved,
      generateMarkdown(
        { ...node, docPath: target.relative },
        tree,
        {
          evidencePath: markdownRelativeLink(target.relative, evidencePath),
          includeInlineEvidence: false,
        },
      ),
      'utf-8',
    )
    pathByNodeId.set(node.id, target.relative)
    documents.push({ nodeId: node.id, docPath: target.relative })
  }

  const evidenceDocs: EvidenceExportDoc[] = documents.map((doc) => {
    const node = tree[doc.nodeId]
    return {
      nodeId: doc.nodeId,
      docPath: doc.docPath,
      evidencePath: node ? evidenceExportPathFor(node) : `evidence/by-node/${sanitizeNodeId(doc.nodeId)}.md`,
    }
  })
  for (const doc of evidenceDocs) {
    const node = tree[doc.nodeId]
    if (!node) continue
    const target = resolveGeneratedSpecPath(doc.evidencePath)
    mkdirSync(path.dirname(target.resolved), { recursive: true })
    writeFileSync(
      target.resolved,
      generateEvidenceMarkdown(
        { ...node, docPath: doc.docPath },
        tree,
        {
          docPath: doc.docPath,
          evidencePath: target.relative,
        },
      ),
      'utf-8',
    )
  }
  const evidenceIndex = resolveGeneratedSpecPath('evidence/EVIDENCE-INDEX.md')
  mkdirSync(path.dirname(evidenceIndex.resolved), { recursive: true })
  writeFileSync(evidenceIndex.resolved, generateEvidenceIndexMarkdown(evidenceDocs, tree), 'utf-8')
  const uiFlowDoc = generateUiFlowMarkdown(pageNodes, tree, pathByNodeId, evidenceDocs)
  const uiFlowTarget = resolveGeneratedSpecPath(uiFlowDoc.docPath)
  writeFileSync(uiFlowTarget.resolved, uiFlowDoc.markdown, 'utf-8')
  writeFileSync(path.join(SPEC_EXPORT_ROOT, '00-INDEX.md'), generateIndexMarkdown(pageNodes, tree, pathByNodeId, evidenceDocs, { uiFlowPath: uiFlowTarget.relative }), 'utf-8')
  const assets = options.includeAssets ? writeProjectAssetExports(options.assetWorkbench) : null
  return {
    exportDir: SPEC_EXPORT_ROOT,
    documents,
    flow: {
      docPath: uiFlowTarget.relative,
      nodeCount: uiFlowDoc.nodeCount,
      edgeCount: uiFlowDoc.edgeCount,
    },
    evidence: {
      manifestPath: 'evidence/EVIDENCE-INDEX.md',
      documents: evidenceDocs.map((doc) => ({ nodeId: doc.nodeId, evidencePath: doc.evidencePath })),
    },
    assets,
  }
}
