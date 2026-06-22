import type { ProjectSourceDocument } from '../src/types/archive'
import type { ChatMessage, ContentBlock } from '../src/types/chat'
import type { PrdNode, PrdNodeEvidenceRef, PrdNodeSectionKey } from '../src/types/prdNode'
import { formatSectionTitle, formatSpecLens, resolveNodeAudience, resolveNodeSpecLens } from '../src/lib/prdNodeLens'

export type ProjectKnowledgeDocumentType =
  | 'source'
  | 'node'
  | 'section'
  | 'backend'
  | 'evidence'
  | 'reference'
  | 'chat'

export interface ProjectKnowledgeDocument {
  id: string
  type: ProjectKnowledgeDocumentType
  title: string
  source: string
  text: string
  nodeId?: string | null
  parentNodeId?: string | null
  tags?: string[]
}

export interface ProjectKnowledgeHit {
  id: string
  type: ProjectKnowledgeDocumentType
  title: string
  source: string
  text: string
  score: number
  nodeId?: string | null
}

export interface ProjectKnowledgeSearchInput {
  query: string
  tree?: Record<string, PrdNode> | null
  sourceDocument?: ProjectSourceDocument | null
  messages?: ChatMessage[]
  currentNodeId?: string | null
  limit?: number
}

export interface ProjectKnowledgeSearchResponse {
  status: 'connected' | 'error'
  answer: string
  references: Array<{ title: string; source: string }>
  indexedDocuments: number
  hits: ProjectKnowledgeHit[]
}

const MAX_SOURCE_SECTION_CHARS = 4500
const MAX_INDEX_TEXT_CHARS = 6000
const MAX_HIT_TEXT_CHARS = 520
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'node', 'null', 'true', 'false'])

function compactText(value: string, maxLength = MAX_INDEX_TEXT_CHARS) {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trim()}...`
}

function normalizeSearchText(value: string) {
  return value.normalize('NFKC').toLowerCase()
}

export function tokenizeKnowledgeText(value: string) {
  const tokens: string[] = []
  const normalized = normalizeSearchText(value)
  const matches = normalized.matchAll(/[\p{Script=Han}]+|[a-z0-9][a-z0-9_.:/#-]*/gu)
  for (const match of matches) {
    const segment = match[0]
    if (!segment || STOP_WORDS.has(segment)) continue
    if (/^[\p{Script=Han}]+$/u.test(segment)) {
      tokens.push(segment)
      if (segment.length === 1) continue
      for (let index = 0; index < segment.length - 1; index += 1) tokens.push(segment.slice(index, index + 2))
      if (segment.length > 2) {
        for (let index = 0; index < segment.length - 2; index += 1) tokens.push(segment.slice(index, index + 3))
      }
      continue
    }
    if (segment.length > 1 && !STOP_WORDS.has(segment)) tokens.push(segment)
  }
  return tokens
}

function messageText(content: ChatMessage['content']) {
  if (typeof content === 'string') return content
  return content
    .map((block: ContentBlock) => {
      if (block.type === 'text') return block.text
      if (block.type === 'document') return `${block.title}\n${block.context ?? ''}\n${block.source.data}`
      return `[image:${block.source.media_type}]`
    })
    .join('\n')
}

function evidenceText(refs: PrdNodeEvidenceRef[] | null | undefined) {
  if (!refs?.length) return ''
  return refs.map((ref) => `[${ref.sourceKind}] ${ref.sourceLabel}${ref.quote ? `: ${ref.quote}` : ''}`).join('\n')
}

function pushDocument(documents: ProjectKnowledgeDocument[], document: ProjectKnowledgeDocument) {
  const text = compactText(document.text)
  if (!text) return
  documents.push({ ...document, text, tags: document.tags?.filter(Boolean) })
}

function pushSourceDocument(documents: ProjectKnowledgeDocument[], sourceDocument: ProjectSourceDocument | null | undefined) {
  if (!sourceDocument?.text?.trim()) return
  const lines = sourceDocument.text.split(/\r?\n/u)
  const sections: Array<{ title: string; startLine: number; lines: string[] }> = []
  let current = { title: '文档开头', startLine: 1, lines: [] as string[] }

  lines.forEach((line, index) => {
    const heading = /^(#{1,6})\s+(.+?)\s*$/u.exec(line)
    if (heading && current.lines.some((item) => item.trim())) {
      sections.push(current)
      current = { title: heading[2] ?? '未命名章节', startLine: index + 1, lines: [line] }
      return
    }
    if (heading && !current.lines.some((item) => item.trim())) {
      current.title = heading[2] ?? current.title
      current.startLine = index + 1
    }
    current.lines.push(line)
  })
  if (current.lines.some((item) => item.trim())) sections.push(current)

  const sourceSections = sections.length ? sections : [{ title: sourceDocument.filename, startLine: 1, lines }]
  sourceSections.forEach((section, sectionIndex) => {
    let chunkStart = 0
    let chunkIndex = 0
    while (chunkStart < section.lines.length) {
      let chunkEnd = chunkStart
      let charCount = 0
      while (chunkEnd < section.lines.length && charCount < MAX_SOURCE_SECTION_CHARS) {
        charCount += section.lines[chunkEnd]?.length ?? 0
        chunkEnd += 1
      }
      const startLine = section.startLine + chunkStart
      const endLine = section.startLine + chunkEnd - 1
      pushDocument(documents, {
        id: `source:${sectionIndex}:${chunkIndex}`,
        type: 'source',
        title: `PRD 原文: ${section.title}${chunkIndex > 0 ? ` #${chunkIndex + 1}` : ''}`,
        source: `${sourceDocument.filename}:${startLine}-${endLine}`,
        text: section.lines.slice(chunkStart, chunkEnd).join('\n'),
        tags: ['prd', 'source', sourceDocument.filename],
      })
      chunkStart = chunkEnd
      chunkIndex += 1
    }
  })
}

function nodeBaseText(node: PrdNode) {
  return [
    node.label,
    node.summary,
    node.content,
    node.docPath,
    node.extractedFrom,
    node.handoffGoal,
    node.qualityGate,
    node.techNotes,
    `audience:${resolveNodeAudience(node)}`,
    `spec:${formatSpecLens(resolveNodeSpecLens(node))}`,
    evidenceText(node.evidenceRefs),
  ].filter(Boolean).join('\n')
}

function pushNodeDocuments(documents: ProjectKnowledgeDocument[], tree: Record<string, PrdNode>) {
  Object.values(tree).forEach((node) => {
    pushDocument(documents, {
      id: `node:${node.id}`,
      type: 'node',
      title: `节点: ${node.label}`,
      source: node.docPath ?? node.id,
      text: nodeBaseText(node),
      nodeId: node.id,
      parentNodeId: node.parentId ?? null,
      tags: [node.id, node.type, node.status, resolveNodeAudience(node) ?? '', resolveNodeSpecLens(node)],
    })

    Object.entries(node.sections ?? {}).forEach(([key, section]) => {
      if (!section) return
      const sectionKey = key as PrdNodeSectionKey
      pushDocument(documents, {
        id: `section:${node.id}:${key}`,
        type: 'section',
        title: `${node.label} / ${formatSectionTitle(sectionKey)}`,
        source: node.docPath ?? node.id,
        text: [section.title, section.summary, section.content, evidenceText(section.evidenceRefs), section.openQuestions?.join('\n')].filter(Boolean).join('\n'),
        nodeId: node.id,
        parentNodeId: node.parentId ?? null,
        tags: [node.id, key, 'section'],
      })
    })

    if (node.backendContracts?.length) {
      pushDocument(documents, {
        id: `backend:${node.id}`,
        type: 'backend',
        title: `${node.label} / 服务端与数据契约`,
        source: node.docPath ?? node.id,
        text: node.backendContracts.map((contract) => [
          `${contract.kind}: ${contract.title}`,
          contract.summary,
          contract.fields?.join(', '),
          contract.targetNodeId ? `target:${contract.targetNodeId}` : null,
          evidenceText(contract.evidenceRefs),
        ].filter(Boolean).join('\n')).join('\n\n'),
        nodeId: node.id,
        parentNodeId: node.parentId ?? null,
        tags: [node.id, 'backend', 'api', 'data', 'contract'],
      })
    }

    if (node.evidenceRefs?.length) {
      pushDocument(documents, {
        id: `evidence:${node.id}`,
        type: 'evidence',
        title: `${node.label} / 证据引用`,
        source: node.docPath ?? node.id,
        text: evidenceText(node.evidenceRefs),
        nodeId: node.id,
        parentNodeId: node.parentId ?? null,
        tags: [node.id, 'evidence'],
      })
    }

    if (node.references?.length) {
      pushDocument(documents, {
        id: `reference:${node.id}`,
        type: 'reference',
        title: `${node.label} / 跨节点关系`,
        source: node.docPath ?? node.id,
        text: node.references.map((reference) => [reference.label, reference.reason, reference.targetNodeId ? `target:${reference.targetNodeId}` : null].filter(Boolean).join('\n')).join('\n\n'),
        nodeId: node.id,
        parentNodeId: node.parentId ?? null,
        tags: [node.id, 'reference'],
      })
    }
  })
}

function pushChatDocuments(documents: ProjectKnowledgeDocument[], messages: ChatMessage[] | undefined, currentNodeId: string | null | undefined) {
  if (!messages?.length) return
  messages.slice(-16).forEach((message, index) => {
    const text = messageText(message.content)
    if (!text.trim()) return
    pushDocument(documents, {
      id: `chat:${currentNodeId ?? 'project'}:${index}`,
      type: 'chat',
      title: `最近对话确认: ${message.role === 'user' ? '用户' : 'AI'} #${index + 1}`,
      source: currentNodeId ? `node-chat:${currentNodeId}` : 'node-chat',
      text,
      nodeId: currentNodeId ?? null,
      tags: ['chat', message.role, currentNodeId ?? 'project'],
    })
  })
}

export function buildProjectKnowledgeDocuments(input: Omit<ProjectKnowledgeSearchInput, 'query' | 'limit'>) {
  const documents: ProjectKnowledgeDocument[] = []
  pushSourceDocument(documents, input.sourceDocument)
  pushNodeDocuments(documents, input.tree ?? {})
  pushChatDocuments(documents, input.messages, input.currentNodeId)
  return documents
}

function termFrequency(tokens: string[]) {
  const counts = new Map<string, number>()
  tokens.forEach((token) => counts.set(token, (counts.get(token) ?? 0) + 1))
  return counts
}

export class ProjectKnowledgeIndex {
  private readonly termDocumentCounts = new Map<string, number>()
  private readonly documentTerms = new Map<string, Map<string, number>>()

  constructor(private readonly documents: ProjectKnowledgeDocument[]) {
    documents.forEach((document) => {
      const weightedText = [document.title, document.title, document.tags?.join(' '), document.text].filter(Boolean).join('\n')
      const terms = termFrequency(tokenizeKnowledgeText(weightedText))
      this.documentTerms.set(document.id, terms)
      terms.forEach((_count, term) => this.termDocumentCounts.set(term, (this.termDocumentCounts.get(term) ?? 0) + 1))
    })
  }

  search(query: string, options: { currentNodeId?: string | null; limit?: number } = {}) {
    const queryTokens = Array.from(new Set(tokenizeKnowledgeText(query)))
    if (!queryTokens.length) return []

    const normalizedQuery = normalizeSearchText(query)
    const hits = this.documents
      .map((document): ProjectKnowledgeHit | null => {
        const terms = this.documentTerms.get(document.id)
        if (!terms) return null
        let score = 0
        for (const token of queryTokens) {
          const count = terms.get(token)
          if (!count) continue
          const documentFrequency = this.termDocumentCounts.get(token) ?? 1
          const idf = Math.log(1 + this.documents.length / documentFrequency)
          score += (1 + Math.log(count)) * idf
          if (normalizeSearchText(document.title).includes(token)) score += 2.5
        }

        if (score <= 0) {
          const haystack = normalizeSearchText(`${document.title}\n${document.text}`)
          if (!normalizedQuery || !haystack.includes(normalizedQuery.slice(0, 80))) return null
          score = 1
        }

        if (options.currentNodeId && document.nodeId === options.currentNodeId) score *= 1.35
        if (options.currentNodeId && document.parentNodeId === options.currentNodeId) score *= 1.12
        if (document.type === 'source') score *= 1.08
        if (document.type === 'chat') score *= 1.05

        return {
          id: document.id,
          type: document.type,
          title: document.title,
          source: document.source,
          text: compactText(document.text, MAX_HIT_TEXT_CHARS),
          score: Number(score.toFixed(3)),
          nodeId: document.nodeId ?? null,
        }
      })
      .filter((hit): hit is ProjectKnowledgeHit => Boolean(hit))
      .sort((a, b) => b.score - a.score)

    return hits.slice(0, Math.max(1, options.limit ?? 8))
  }
}

export function searchProjectKnowledge(input: ProjectKnowledgeSearchInput): ProjectKnowledgeSearchResponse {
  const documents = buildProjectKnowledgeDocuments(input)
  const index = new ProjectKnowledgeIndex(documents)
  const hits = index.search(input.query, {
    currentNodeId: input.currentNodeId,
    limit: input.limit,
  })

  return {
    status: 'connected',
    indexedDocuments: documents.length,
    hits,
    answer: hits.length
      ? hits.map((hit, index) => `${index + 1}. ${hit.title}\n${hit.text}\n来源: ${hit.source}`).join('\n\n')
      : '当前项目知识索引没有找到直接匹配的内容。请换一个查询，或先导入/打磨更多 PRD 节点。',
    references: hits.map((hit) => ({ title: hit.title, source: hit.source })),
  }
}

export function formatProjectKnowledgeEvidence(hits: ProjectKnowledgeHit[]) {
  if (!hits.length) return ''
  return [
    '项目知识检索证据包：',
    ...hits.map((hit, index) => [
      `${index + 1}. [${hit.type}] ${hit.title}`,
      `来源: ${hit.source}${hit.nodeId ? ` / node:${hit.nodeId}` : ''}`,
      `摘录: ${hit.text}`,
    ].join('\n')),
    '使用规则：优先把这些内容当作当前项目的事实依据；如果证据与用户最新输入冲突，请标记冲突并追问，不要把旧结论静默覆盖为新结论。',
  ].join('\n\n')
}
