import { useState, type ReactNode } from 'react'
import { formatPerformanceSpecMarkdown, resolveNodePerformanceSpec } from '../../lib/performanceOrchestration'
import { formatSectionTitle, formatSpecLens, hasNodeSections, resolveNodeAudience, resolveNodeSpecLens } from '../../lib/prdNodeLens'
import { buildDeliverySections, collectBackendContracts, collectDeliveryEvidence } from '../../lib/prdNodeDelivery'
import type { PrdNode, PrdNodeDocumentSnapshot, PrdNodeEvidenceRef, PrdNodePolishRevision, PrdNodeSectionKey, PrdTree } from '../../types/prdNode'
import { FigmaStatePreviewPanel, figmaPreviewImages } from './FigmaStatePreview'

type DocumentPreviewVariant = 'drawer' | 'full'
export type DocumentPreviewTab = 'overview' | PrdNodeSectionKey | 'contracts' | 'evidence'
type MarkdownDensity = 'full' | 'compact'

const WRAP_ANYWHERE_CLASS = 'break-words [overflow-wrap:anywhere]'

interface SourceDetailBlock {
  title: string
  body: string
}

interface DocumentSourceDetails {
  locations: string[]
  evidenceRefs: PrdNodeEvidenceRef[]
  foldedSourceNodeIds: string[]
  sourceBlocks: SourceDetailBlock[]
}

interface DocumentPreviewProps {
  node: PrdNode
  tree?: PrdTree | null
  variant?: DocumentPreviewVariant
  tab?: DocumentPreviewTab
}

interface DocumentDiffPreviewProps {
  node: PrdNode
  revision: PrdNodePolishRevision
}

interface DocumentComparePreviewProps {
  node: PrdNode
  revision: PrdNodePolishRevision
}

type LineDiffType = 'equal' | 'delete' | 'insert'

interface LineDiffOp {
  type: LineDiffType
  text: string
}

type DiffChunk =
  | { type: 'equal'; lines: string[] }
  | { type: 'change'; deleted: string[]; inserted: string[] }

type TokenDiffType = 'equal' | 'delete' | 'insert'

interface TokenDiffOp {
  type: TokenDiffType
  token: string
}

function textOrNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function normalizeBody(content: string) {
  return content
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function hasMarkdownHeading(content: string) {
  return /^#{1,4}\s+\S/m.test(content)
}

function sourceDetailTitle(title: string) {
  return /原文|摘录|证据引用|折叠来源/.test(title)
}

function splitMarkdownSections(content: string) {
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

function extractSourceBlocks(content: string | null | undefined): { visible: string; sourceBlocks: SourceDetailBlock[] } {
  const normalized = normalizeBody(content ?? '')
  if (!normalized) return { visible: '', sourceBlocks: [] }

  const sections = splitMarkdownSections(normalized)
  if (!sections.some((section) => section.heading && sourceDetailTitle(section.heading))) {
    return { visible: normalized, sourceBlocks: [] }
  }

  const visible: string[] = []
  const sourceBlocks: SourceDetailBlock[] = []

  for (const section of sections) {
    if (section.heading && sourceDetailTitle(section.heading)) {
      if (section.body) sourceBlocks.push({ title: section.heading, body: section.body })
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

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)))
}

function evidenceKey(ref: PrdNodeEvidenceRef) {
  return `${ref.sourceKind}:${ref.sourceLabel}:${ref.quote ?? ''}`
}

function uniqueEvidenceRefs(refs: PrdNodeEvidenceRef[]) {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = evidenceKey(ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function collectDocumentSourceDetails(node: PrdNode, tree?: PrdTree | null): DocumentSourceDetails {
  const deliverySections = buildDeliverySections(node, tree)
  const nodeSource = extractSourceBlocks(node.content)
  const sectionSources = deliverySections.flatMap((section) => extractSourceBlocks(section.content).sourceBlocks)

  return {
    locations: uniqueStrings([node.extractedFrom ?? '']),
    evidenceRefs: uniqueEvidenceRefs(collectDeliveryEvidence(node, tree)),
    foldedSourceNodeIds: uniqueStrings(deliverySections.flatMap((section) => section.sourceNodeIds)),
    sourceBlocks: [...nodeSource.sourceBlocks, ...sectionSources],
  }
}

function hasDocumentSourceDetails(details: DocumentSourceDetails) {
  return Boolean(
    details.locations.length ||
    details.evidenceRefs.length ||
    details.foldedSourceNodeIds.length ||
    details.sourceBlocks.length,
  )
}

function formatAudienceLabel(audience: ReturnType<typeof resolveNodeAudience>) {
  if (audience === 'overview') return '项目概览'
  if (audience === 'client') return '客户端/UI'
  if (audience === 'server') return '服务端'
  if (audience === 'config') return '配置/数值'
  if (audience === 'api') return '接口'
  if (audience === 'acceptance') return '验收/测试'
  if (audience === 'appendix') return '附录'
  if (audience === 'mixed') return '跨职责'
  return '未指定'
}

function appendSections(lines: string[], node: PrdNode) {
  if (!hasNodeSections(node.sections)) return
  lines.push('', '## 页面规格视角')
  for (const key of ['view', 'interaction', 'data'] as const) {
    const section = node.sections?.[key]
    if (!section?.summary && !section?.content && !section?.evidenceRefs?.length && !section?.openQuestions?.length) continue
    lines.push('', `### ${section.title ?? formatSectionTitle(key)}`)
    if (section.summary) lines.push('', section.summary)
    const visibleContent = extractSourceBlocks(section.content).visible
    if (visibleContent) lines.push('', visibleContent)
    if (section.openQuestions?.length) {
      lines.push('', '#### 需澄清点', ...section.openQuestions.map((item) => `- ${item}`))
    }
  }
}

function formatBackendContractKind(kind: ReturnType<typeof collectBackendContracts>[number]['kind']) {
  if (kind === 'api') return '接口'
  if (kind === 'config') return '配置/数值'
  if (kind === 'server') return '服务端规则'
  return '数据模型'
}

function appendDeliverySections(lines: string[], node: PrdNode, tree?: PrdTree | null) {
  if (tree === null && node.id === '__legacy_sections__') appendSections(lines, node)
  if (!hasNodeSections(node.sections) && !tree) return
  const sections = buildDeliverySections(node, tree)
  if (!sections.some((section) => section.status !== 'missing')) return

  lines.push('', '## View / Flow / Data')
  for (const section of sections) {
    if (section.status === 'missing') continue
    lines.push('', `### ${section.title ?? formatSectionTitle(section.key)}`)
    lines.push('', `> ${section.label} · ${section.status === 'ready' ? '已整理' : '待确认'}`)
    if (section.summary) lines.push('', section.summary)
    const visibleContent = extractSourceBlocks(section.content).visible
    if (visibleContent) lines.push('', visibleContent)
    if (section.openQuestions.length) lines.push('', '#### 需澄清点', ...section.openQuestions.map((item) => `- ${item}`))
  }
}

function appendBackendContracts(lines: string[], node: PrdNode, tree?: PrdTree | null) {
  const contracts = collectBackendContracts(node, tree)
  if (!contracts.length) return

  lines.push('', '## 服务端交互 / 依赖引用')
  for (const contract of contracts) {
    lines.push('', `### ${contract.title}`, '', `- 类型：${formatBackendContractKind(contract.kind)}`)
    if (contract.targetNodeId) lines.push(`- 关联节点：${contract.targetNodeId}`)
    if (contract.summary) lines.push(`- 页面影响：${contract.summary}`)
    if (contract.fields?.length) lines.push(`- 请求/返回/配置字段：${contract.fields.join('、')}`)
  }
}

function buildSectionMarkdown(node: PrdNode, tree: PrdTree | null | undefined, key: PrdNodeSectionKey) {
  const section = buildDeliverySections(node, tree).find((item) => item.key === key)
  const lines = [`# ${node.label} / ${section?.label ?? formatSectionTitle(key)}`]
  if (!section || section.status === 'missing') {
    lines.push('', '暂无已整理内容。')
    return lines.join('\n')
  }

  lines.push('', `> 状态：${section.status === 'ready' ? '已整理' : '待确认'}`)
  if (section.summary) lines.push('', '## 摘要', '', section.summary)
  const visibleContent = extractSourceBlocks(section.content).visible
  if (visibleContent) lines.push('', '## 详细规格', '', visibleContent)
  if (section.openQuestions.length) lines.push('', '## 需澄清点', '', ...section.openQuestions.map((item) => `- ${item}`))
  return lines.join('\n')
}

function buildContractsMarkdown(node: PrdNode, tree?: PrdTree | null) {
  const lines = [`# ${node.label} / 服务端`]
  const contracts = collectBackendContracts(node, tree)
  if (!contracts.length) {
    lines.push(
      '',
      '暂无服务端交互内容。',
      '',
      '可补充当前页面依赖的接口、服务端规则、配置表、数据模型字段，或关联已经单独拆出的服务端/API/配置节点。',
    )
    return lines.join('\n')
  }
  lines.push('', '> 当前页面与服务端/API/配置/数据模型之间的交互内容。')
  appendBackendContracts(lines, node, tree)
  return lines.join('\n')
}

function buildEvidenceMarkdown(node: PrdNode, tree?: PrdTree | null) {
  const lines = [`# ${node.label} / 证据`]
  const evidence = collectDeliveryEvidence(node, tree)
  if (!evidence.length) {
    lines.push('', '暂无证据引用。')
    return lines.join('\n')
  }
  for (const ref of evidence) {
    lines.push('', `- [${ref.sourceKind}] ${ref.sourceLabel}${ref.quote ? `：${ref.quote}` : ''}`)
  }
  return lines.join('\n')
}

function isSectionPreviewTab(tab: DocumentPreviewTab): tab is PrdNodeSectionKey {
  return tab === 'view' || tab === 'interaction' || tab === 'data'
}

export function extractNodeSnippet(node: PrdNode, maxLength = 170) {
  const source = textOrNull(node.content) ?? textOrNull(node.summary) ?? node.label
  const normalized = source
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+[\.)]\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength).replace(/[，。；、\s]+$/u, '')}...`
}

export function buildDocumentMarkdown(node: PrdNode, tree?: PrdTree | null, tab: DocumentPreviewTab = 'overview') {
  if (isSectionPreviewTab(tab)) {
    return buildSectionMarkdown(node, tree, tab)
  }
  if (tab === 'contracts') return buildContractsMarkdown(node, tree)
  if (tab === 'evidence') return buildEvidenceMarkdown(node, tree)

  const lines: string[] = [`# ${node.label}`]

  if (node.docPath) {
    lines.push('', `> 导出：${node.docPath}`)
  }

  lines.push('', `> 规格视角：${formatSpecLens(resolveNodeSpecLens(node))} · 面向角色：${formatAudienceLabel(resolveNodeAudience(node))}`)

  if (textOrNull(node.summary)) {
    lines.push('', '## 提炼内容', '', node.summary.trim())
  }

  const body = extractSourceBlocks(node.content).visible
  if (body && body !== node.summary?.trim()) {
    lines.push('', hasMarkdownHeading(body) ? body : `## 拆分整理\n\n${body}`)
  }

  appendDeliverySections(lines, node, tree)

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

  if (textOrNull(node.handoffGoal)) {
    lines.push('', '## AI 接力用途', '', node.handoffGoal!.trim())
  }

  if (textOrNull(node.qualityGate)) {
    lines.push('', '## 交付检查', '', node.qualityGate!.trim())
  }

  if (textOrNull(node.techNotes)) {
    lines.push('', '## 实现备注', '', node.techNotes!.trim())
  }

  appendBackendContracts(lines, node, tree)

  return lines.join('\n')
}

function buildDocumentMarkdownFromSnapshot(node: PrdNode, snapshot: PrdNodeDocumentSnapshot) {
  return buildDocumentMarkdown({
    ...node,
    summary: snapshot.summary,
    content: snapshot.content,
    techNotes: snapshot.techNotes,
    sections: snapshot.sections,
    handoffGoal: snapshot.handoffGoal,
    qualityGate: snapshot.qualityGate,
    backendContracts: snapshot.backendContracts,
    evidenceRefs: snapshot.evidenceRefs,
    performanceSpec: snapshot.performanceSpec,
  })
}

function buildNodeBodyMarkdown(node: PrdNode, tree?: PrdTree | null) {
  const lines: string[] = []

  if (textOrNull(node.summary)) {
    lines.push('## 提炼内容', '', node.summary.trim())
  }

  const body = extractSourceBlocks(node.content).visible
  if (body && body !== node.summary?.trim()) {
    lines.push('', hasMarkdownHeading(body) ? body : body)
  }

  appendDeliverySections(lines, node, tree)

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

  if (textOrNull(node.handoffGoal)) {
    lines.push('', '## AI 接力用途', '', node.handoffGoal!.trim())
  }

  if (textOrNull(node.qualityGate)) {
    lines.push('', '## 交付检查', '', node.qualityGate!.trim())
  }

  if (textOrNull(node.techNotes)) {
    lines.push('', '## 实现备注', '', node.techNotes!.trim())
  }

  appendBackendContracts(lines, node, tree)

  return lines.join('\n').trim()
}

function limitMarkdownLines(markdown: string, maxNonEmptyLines: number) {
  const output: string[] = []
  let nonEmptyLines = 0

  for (const line of markdown.split(/\r?\n/)) {
    if (line.trim()) nonEmptyLines += 1
    if (nonEmptyLines > maxNonEmptyLines) break
    output.push(line)
  }

  return output.join('\n').trim()
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`)/g)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="break-all rounded bg-surface-container-high px-1 py-[1px] font-code-sm text-code-sm text-on-primary-container">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <span key={index} className={WRAP_ANYWHERE_CLASS}>{part}</span>
  })
}

function isTableLine(line: string) {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.includes('|', 1)
}

function isTableSeparator(line: string) {
  return /^[\s|:-]+$/.test(line.trim()) && line.includes('-')
}

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function renderTable(lines: string[], key: number, density: MarkdownDensity) {
  const rows = lines.filter((line) => !isTableSeparator(line)).map(tableCells)
  if (!rows.length) return null
  const [head, ...body] = rows

  return (
    <div key={key} className="overflow-hidden rounded border border-outline-variant">
      <table className={`w-full table-fixed border-collapse text-left ${density === 'compact' ? 'text-code-sm' : 'text-body-sm'}`}>
        <thead className="bg-surface-container-high text-on-surface">
          <tr>
            {head.map((cell, index) => (
              <th key={index} className={`border-b border-outline-variant px-sm py-xs align-top font-medium ${WRAP_ANYWHERE_CLASS}`}>
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-outline-variant/60">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={`px-sm py-xs align-top text-on-surface-variant ${WRAP_ANYWHERE_CLASS}`}>
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function flushParagraph(paragraph: string[], blocks: ReactNode[], key: number, density: MarkdownDensity) {
  if (!paragraph.length) return
  blocks.push(
    <p
      key={key}
      className={density === 'compact'
        ? `line-clamp-2 text-body-sm leading-relaxed text-on-surface-variant ${WRAP_ANYWHERE_CLASS}`
        : `whitespace-pre-line text-body-md leading-relaxed text-on-surface-variant ${WRAP_ANYWHERE_CLASS}`}
    >
      {renderInline(paragraph.join('\n'))}
    </p>
  )
  paragraph.length = 0
}

function renderMarkdown(markdown: string, density: MarkdownDensity = 'full') {
  const lines = markdown.split(/\r?\n/)
  const blocks: ReactNode[] = []
  const paragraph: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    const key = blocks.length + index

    if (!trimmed) {
      flushParagraph(paragraph, blocks, key, density)
      continue
    }

    if (isTableLine(line)) {
      flushParagraph(paragraph, blocks, key, density)
      const tableLines = [line]
      while (index + 1 < lines.length && isTableLine(lines[index + 1])) {
        index += 1
        tableLines.push(lines[index])
      }
      blocks.push(renderTable(tableLines, key, density))
      continue
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed)
    if (heading) {
      flushParagraph(paragraph, blocks, key, density)
      const level = heading[1].length
      const className = density === 'compact'
        ? `line-clamp-1 text-label-md font-semibold text-primary ${WRAP_ANYWHERE_CLASS}`
        : level === 1
          ? `text-headline-md font-semibold text-on-surface ${WRAP_ANYWHERE_CLASS}`
          : `border-b border-outline-variant pb-xs text-headline-sm font-semibold text-on-surface ${WRAP_ANYWHERE_CLASS}`
      blocks.push(
        <div key={key} className={density === 'compact' ? 'pt-0' : level === 1 ? 'pt-xs' : 'pt-md'}>
          {level === 1 ? <h1 className={className}>{heading[2]}</h1> : <h2 className={className}>{heading[2]}</h2>}
        </div>
      )
      continue
    }

    if (trimmed.startsWith('>')) {
      flushParagraph(paragraph, blocks, key, density)
      blocks.push(
        <blockquote
          key={key}
          className={density === 'compact'
            ? `line-clamp-2 border-l-2 border-primary pl-sm text-body-sm leading-relaxed text-on-surface-variant ${WRAP_ANYWHERE_CLASS}`
            : `border-l-2 border-primary pl-sm text-body-sm leading-relaxed text-on-surface-variant ${WRAP_ANYWHERE_CLASS}`}
        >
          {renderInline(trimmed.replace(/^>\s*/, ''))}
        </blockquote>
      )
      continue
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed)
    if (bullet) {
      flushParagraph(paragraph, blocks, key, density)
      const items = [bullet[1]]
      while (index + 1 < lines.length) {
        const next = /^[-*]\s+(.+)$/.exec(lines[index + 1].trim())
        if (!next) break
        index += 1
        items.push(next[1])
      }
      blocks.push(
        <ul
          key={key}
          className={density === 'compact'
            ? `list-disc space-y-0.5 pl-md text-body-sm leading-relaxed text-on-surface-variant [&>li]:line-clamp-2 ${WRAP_ANYWHERE_CLASS}`
            : `list-disc space-y-xs pl-lg text-body-md leading-relaxed text-on-surface-variant ${WRAP_ANYWHERE_CLASS}`}
        >
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
        </ul>
      )
      continue
    }

    const ordered = /^\d+[\.)]\s+(.+)$/.exec(trimmed)
    if (ordered) {
      flushParagraph(paragraph, blocks, key, density)
      const items = [ordered[1]]
      while (index + 1 < lines.length) {
        const next = /^\d+[\.)]\s+(.+)$/.exec(lines[index + 1].trim())
        if (!next) break
        index += 1
        items.push(next[1])
      }
      blocks.push(
        <ol
          key={key}
          className={density === 'compact'
            ? `list-decimal space-y-0.5 pl-md text-body-sm leading-relaxed text-on-surface-variant [&>li]:line-clamp-2 ${WRAP_ANYWHERE_CLASS}`
            : `list-decimal space-y-xs pl-lg text-body-md leading-relaxed text-on-surface-variant ${WRAP_ANYWHERE_CLASS}`}
        >
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
        </ol>
      )
      continue
    }

    paragraph.push(line)
  }

  flushParagraph(paragraph, blocks, lines.length + blocks.length, density)
  return blocks.filter(Boolean)
}

function hideFigmaPreviewLinks(markdown: string) {
  return markdown
    .replace(/[，,]\s*截图\s*[=:：]\s*(?:https?:\/\/|\/|data:image\/)[^）\s]+/gu, '')
    .replace(/^\s*-\s*截图预览\s*[:：]\s*(?:https?:\/\/|\/|data:image\/)\S+\s*$/gmu, '')
}

function splitLines(markdown: string) {
  return markdown.split(/\r?\n/)
}

function buildLineDiff(before: string, after: string): LineDiffOp[] {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)
  const dp = Array.from({ length: oldLines.length + 1 }, () => Array<number>(newLines.length + 1).fill(0))

  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: LineDiffOp[] = []
  let i = 0
  let j = 0
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'equal', text: oldLines[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'delete', text: oldLines[i] })
      i += 1
    } else {
      ops.push({ type: 'insert', text: newLines[j] })
      j += 1
    }
  }
  while (i < oldLines.length) {
    ops.push({ type: 'delete', text: oldLines[i] })
    i += 1
  }
  while (j < newLines.length) {
    ops.push({ type: 'insert', text: newLines[j] })
    j += 1
  }

  return ops
}

function chunkLineDiff(ops: LineDiffOp[]): DiffChunk[] {
  const chunks: DiffChunk[] = []
  let index = 0
  while (index < ops.length) {
    const op = ops[index]
    if (op.type === 'equal') {
      const lines: string[] = []
      while (index < ops.length && ops[index].type === 'equal') {
        lines.push(ops[index].text)
        index += 1
      }
      chunks.push({ type: 'equal', lines })
      continue
    }

    const deleted: string[] = []
    const inserted: string[] = []
    while (index < ops.length && ops[index].type !== 'equal') {
      if (ops[index].type === 'delete') deleted.push(ops[index].text)
      if (ops[index].type === 'insert') inserted.push(ops[index].text)
      index += 1
    }
    chunks.push({ type: 'change', deleted, inserted })
  }

  return chunks
}

function tokenize(text: string) {
  return text.match(/[\u4e00-\u9fff]|[A-Za-z0-9_./:-]+|\s+|[^\s]/gu) ?? []
}

function buildTokenDiff(before: string, after: string): TokenDiffOp[] {
  const oldTokens = tokenize(before)
  const newTokens = tokenize(after)
  const dp = Array.from({ length: oldTokens.length + 1 }, () => Array<number>(newTokens.length + 1).fill(0))

  for (let i = oldTokens.length - 1; i >= 0; i -= 1) {
    for (let j = newTokens.length - 1; j >= 0; j -= 1) {
      dp[i][j] = oldTokens[i] === newTokens[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: TokenDiffOp[] = []
  let i = 0
  let j = 0
  while (i < oldTokens.length && j < newTokens.length) {
    if (oldTokens[i] === newTokens[j]) {
      ops.push({ type: 'equal', token: oldTokens[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'delete', token: oldTokens[i] })
      i += 1
    } else {
      ops.push({ type: 'insert', token: newTokens[j] })
      j += 1
    }
  }
  while (i < oldTokens.length) {
    ops.push({ type: 'delete', token: oldTokens[i] })
    i += 1
  }
  while (j < newTokens.length) {
    ops.push({ type: 'insert', token: newTokens[j] })
    j += 1
  }

  return ops
}

function renderTokenDiff(before: string, after: string, mode: 'before' | 'after') {
  return buildTokenDiff(before, after)
    .filter((op) => op.type === 'equal' || op.type === modeToTokenType(mode))
    .map((op, index) => {
      if (op.type === 'equal') return <span key={index}>{op.token}</span>
      if (op.type === 'delete') {
        return (
          <span key={index} className="rounded bg-error-container/60 px-[1px] text-error line-through decoration-error decoration-2">
            {op.token}
          </span>
        )
      }
      return (
        <span key={index} className="rounded bg-tertiary-container/70 px-[1px] text-on-tertiary-container">
          {op.token}
        </span>
      )
    })
}

function modeToTokenType(mode: 'before' | 'after'): TokenDiffType {
  return mode === 'before' ? 'delete' : 'insert'
}

function pairChangedLines(deleted: string[], inserted: string[]) {
  const pairs: Array<{ before: string | null; after: string | null }> = []
  const count = Math.max(deleted.length, inserted.length)
  for (let index = 0; index < count; index += 1) {
    pairs.push({ before: deleted[index] ?? null, after: inserted[index] ?? null })
  }
  return pairs
}

function diffStats(chunks: DiffChunk[]) {
  return chunks.reduce(
    (stats, chunk) => {
      if (chunk.type === 'equal') return stats
      if (chunk.deleted.length && chunk.inserted.length) stats.modified += Math.max(chunk.deleted.length, chunk.inserted.length)
      else if (chunk.deleted.length) stats.deleted += chunk.deleted.length
      else stats.inserted += chunk.inserted.length
      return stats
    },
    { inserted: 0, deleted: 0, modified: 0 },
  )
}

function renderDiffLine(text: ReactNode, tone: 'equal' | 'delete' | 'insert', key: number | string) {
  const marker = tone === 'insert' ? '+' : tone === 'delete' ? '-' : ' '
  const className = tone === 'insert'
    ? 'border-l-2 border-tertiary bg-tertiary-container/35 text-on-surface'
    : tone === 'delete'
      ? 'border-l-2 border-error bg-error-container/35 text-error'
      : 'border-l-2 border-transparent text-on-surface-variant/75'

  return (
    <div key={key} className={`grid grid-cols-[24px_minmax(0,1fr)] gap-sm rounded px-sm py-xs font-code-sm text-code-sm leading-relaxed ${className}`}>
      <span className="select-none text-center text-on-surface-variant/60">{marker}</span>
      <span className={tone === 'delete' ? 'break-words line-through decoration-error decoration-2' : 'break-words'}>
        {text || '\u00a0'}
      </span>
    </div>
  )
}

function renderDiffChunk(chunk: DiffChunk, index: number) {
  if (chunk.type === 'equal') {
    const visibleLines = chunk.lines.length > 12
      ? [...chunk.lines.slice(0, 5), `... ${chunk.lines.length - 10} 行未变化 ...`, ...chunk.lines.slice(-5)]
      : chunk.lines
    return (
      <div key={index} className="space-y-1">
        {visibleLines.map((line, lineIndex) => renderDiffLine(line, 'equal', `${index}-${lineIndex}`))}
      </div>
    )
  }

  if (chunk.deleted.length && chunk.inserted.length) {
    return (
      <div key={index} className="space-y-xs rounded border border-outline-variant bg-surface px-sm py-sm">
        <div className="text-label-md font-medium text-on-surface-variant">修改</div>
        {pairChangedLines(chunk.deleted, chunk.inserted).map((pair, pairIndex) => (
          <div key={pairIndex} className="space-y-1">
            {pair.before !== null && renderDiffLine(
              pair.after === null ? pair.before : renderTokenDiff(pair.before, pair.after, 'before'),
              'delete',
              `${index}-${pairIndex}-before`,
            )}
            {pair.after !== null && renderDiffLine(
              pair.before === null ? pair.after : renderTokenDiff(pair.before, pair.after, 'after'),
              'insert',
              `${index}-${pairIndex}-after`,
            )}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div key={index} className="space-y-1">
      {chunk.deleted.map((line, lineIndex) => renderDiffLine(line, 'delete', `${index}-d-${lineIndex}`))}
      {chunk.inserted.map((line, lineIndex) => renderDiffLine(line, 'insert', `${index}-i-${lineIndex}`))}
    </div>
  )
}

function changedStructuredFieldLabel(field: PrdNodePolishRevision['changedFields'][number]) {
  if (field === 'summary') return '摘要'
  if (field === 'content') return '正文'
  if (field === 'sections') return 'View/Flow/Data'
  if (field === 'handoffGoal') return 'AI 接力'
  if (field === 'qualityGate') return '交付检查'
  if (field === 'backendContracts') return '服务端'
  if (field === 'evidenceRefs') return '证据'
  if (field === 'performanceSpec') return '表现编排'
  return '实现备注'
}

function sourceKindLabel(kind: PrdNodeEvidenceRef['sourceKind']) {
  if (kind === 'prd') return 'PRD 原文'
  if (kind === 'upload') return '上传资料'
  return '用户补充'
}

function SourceDetailsModal({
  details,
  title,
  onClose,
}: {
  details: DocumentSourceDetails
  title: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-md py-lg" role="dialog" aria-modal="true" aria-label={`${title} 原文与证据`}>
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-sm border-b border-outline-variant px-lg py-md">
          <div className="min-w-0">
            <h2 className="truncate text-headline-sm font-semibold text-on-surface">原文与证据</h2>
            <p className="mt-xs truncate text-body-sm text-on-surface-variant">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
            className="rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-md overflow-y-auto px-lg py-md custom-scrollbar">
          {details.locations.length ? (
            <section className="space-y-xs">
              <h3 className="text-label-lg font-semibold text-on-surface">原文位置</h3>
              <ul className="space-y-xs">
                {details.locations.map((location) => (
                  <li key={location} className={`rounded border border-outline-variant bg-surface-container-high px-sm py-xs text-body-sm text-on-surface-variant ${WRAP_ANYWHERE_CLASS}`}>
                    {location}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {details.sourceBlocks.length ? (
            <section className="space-y-xs">
              <h3 className="text-label-lg font-semibold text-on-surface">原文再录</h3>
              <div className="space-y-sm">
                {details.sourceBlocks.map((block, index) => (
                  <div key={`${block.title}-${index}`} className="rounded border border-outline-variant bg-surface-container px-sm py-sm">
                    <div className={`mb-xs text-label-md font-medium text-on-surface ${WRAP_ANYWHERE_CLASS}`}>{block.title}</div>
                    <div className={`space-y-xs text-body-sm leading-relaxed text-on-surface-variant ${WRAP_ANYWHERE_CLASS}`}>
                      {renderMarkdown(block.body, 'full')}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {details.evidenceRefs.length ? (
            <section className="space-y-xs">
              <h3 className="text-label-lg font-semibold text-on-surface">证据引用</h3>
              <ul className="space-y-xs">
                {details.evidenceRefs.map((ref) => (
                  <li key={evidenceKey(ref)} className={`rounded border border-outline-variant bg-surface-container px-sm py-sm text-body-sm leading-relaxed text-on-surface-variant ${WRAP_ANYWHERE_CLASS}`}>
                    <span className="font-medium text-on-surface">[{sourceKindLabel(ref.sourceKind)}] {ref.sourceLabel}</span>
                    {ref.quote ? <span>：{ref.quote}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {details.foldedSourceNodeIds.length ? (
            <section className="space-y-xs">
              <h3 className="text-label-lg font-semibold text-on-surface">折叠来源节点</h3>
              <div className="flex flex-wrap gap-xs">
                {details.foldedSourceNodeIds.map((id) => (
                  <span key={id} className="rounded border border-outline-variant bg-surface-container-high px-sm py-xs font-code-sm text-code-sm text-on-surface-variant break-all">
                    {id}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SourceDetailsButton({ node, tree }: { node: PrdNode; tree?: PrdTree | null }) {
  const [isOpen, setIsOpen] = useState(false)
  const details = collectDocumentSourceDetails(node, tree)
  if (!hasDocumentSourceDetails(details)) return null

  const detailCount = details.locations.length + details.sourceBlocks.length + details.evidenceRefs.length + details.foldedSourceNodeIds.length

  return (
    <div className="border-t border-outline-variant pt-md">
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-xs rounded border border-outline-variant bg-surface-container-high px-sm py-xs text-label-md font-medium text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
      >
        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>fact_check</span>
        查看原文与证据
        <span className="font-code-sm text-code-sm text-on-surface-variant">({detailCount})</span>
      </button>
      {isOpen ? <SourceDetailsModal details={details} title={node.label} onClose={() => setIsOpen(false)} /> : null}
    </div>
  )
}

export function DocumentMiniPreview({ node, tree, maxLines = 9 }: { node: PrdNode; tree?: PrdTree | null; maxLines?: number }) {
  const markdown = limitMarkdownLines(buildNodeBodyMarkdown(node, tree), maxLines)

  if (!markdown) {
    return (
      <p className={`line-clamp-3 text-body-sm leading-relaxed text-on-surface-variant ${WRAP_ANYWHERE_CLASS}`}>
        {extractNodeSnippet(node)}
      </p>
    )
  }

  return (
    <div className="space-y-xs">
      {renderMarkdown(markdown, 'compact')}
    </div>
  )
}

export function DocumentDiffPreview({ node, revision }: DocumentDiffPreviewProps) {
  const before = buildDocumentMarkdownFromSnapshot(node, revision.before)
  const after = buildDocumentMarkdownFromSnapshot(node, revision.after)
  const chunks = chunkLineDiff(buildLineDiff(before, after))
  const stats = diffStats(chunks)

  return (
    <article className="space-y-md pb-lg">
      <div className="border-b border-outline-variant pb-sm">
        <div className="flex flex-wrap items-center gap-xs">
          <span className="rounded bg-tertiary-container px-sm py-xs text-label-md font-medium text-on-tertiary-container">
            +{stats.inserted}
          </span>
          <span className="rounded bg-error-container px-sm py-xs text-label-md font-medium text-error">
            -{stats.deleted}
          </span>
          <span className="rounded bg-secondary-container px-sm py-xs text-label-md font-medium text-on-secondary-container">
            修改 {stats.modified}
          </span>
          {revision.changedFields.map((field) => (
            <span key={field} className="rounded bg-surface-container-high px-sm py-xs text-label-md text-on-surface-variant">
              {changedStructuredFieldLabel(field)}已改
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-sm">
        {chunks.map(renderDiffChunk)}
      </div>
    </article>
  )
}

export function DocumentComparePreview({ node, revision }: DocumentComparePreviewProps) {
  const before = buildDocumentMarkdownFromSnapshot(node, revision.before)
  const after = buildDocumentMarkdownFromSnapshot(node, revision.after)

  return (
    <article className="grid gap-md pb-lg xl:grid-cols-2">
      <section className="min-w-0 space-y-sm">
        <div className="sticky top-0 z-10 border-b border-outline-variant bg-surface-container py-xs text-label-lg font-medium text-error">
          打磨前
        </div>
        <div className="space-y-md rounded border border-error/30 bg-error-container/10 p-sm">
          {renderMarkdown(before, 'full')}
        </div>
      </section>
      <section className="min-w-0 space-y-sm">
        <div className="sticky top-0 z-10 border-b border-outline-variant bg-surface-container py-xs text-label-lg font-medium text-tertiary">
          打磨后
        </div>
        <div className="space-y-md rounded border border-tertiary/30 bg-tertiary-container/10 p-sm">
          {renderMarkdown(after, 'full')}
        </div>
      </section>
    </article>
  )
}

export function DocumentPreview({ node, tree, variant = 'drawer', tab = 'overview' }: DocumentPreviewProps) {
  const hasFigmaImages = tab === 'view' && figmaPreviewImages(node).length > 0
  const baseMarkdown = buildDocumentMarkdown(node, tree, tab)
  const markdown = figmaPreviewImages(node).length > 0
    ? hideFigmaPreviewLinks(baseMarkdown)
    : baseMarkdown

  return (
    <article className={variant === 'full' ? 'space-y-md pb-lg' : 'space-y-md'}>
      {hasFigmaImages ? <FigmaStatePreviewPanel node={node} /> : null}
      {renderMarkdown(markdown, 'full')}
      {tab !== 'evidence' ? <SourceDetailsButton node={node} tree={tree} /> : null}
    </article>
  )
}
