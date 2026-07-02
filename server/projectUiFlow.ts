import type {
  FigmaUxMap,
  FigmaUxMapTransitionSource,
  ProjectUiFlow,
  ProjectUiFlowAmbiguity,
  ProjectUiFlowAmbiguityKind,
  ProjectUiFlowEdge,
  ProjectUiFlowEdgeSource,
  ProjectUiFlowEvidenceRef,
  ProjectUiFlowNode,
  ProjectUiFlowPath,
} from '../src/types/prdNode'

export interface ProjectUiFlowFrameInput {
  id: string
  name: string
  visibleTexts?: string[]
  annotations?: string[]
}

export interface ProjectUiFlowGroupInput {
  key: string
  label: string
  frames: ProjectUiFlowFrameInput[]
}

export interface ProjectUiFlowRelationInput {
  sourceGroupKey: string
  targetGroupKey: string
  label: string
  reason: string
  confidence: number
  source: FigmaUxMapTransitionSource | 'prd_relation'
}

export interface ProjectUiFlowAlignmentInput {
  groupKey: string
  sourceLabel: string
  excerpt: string
  confidence: number
}

export interface BuildProjectUiFlowInput {
  groups: ProjectUiFlowGroupInput[]
  figmaUxMap?: FigmaUxMap | null
  figmaRelations?: ProjectUiFlowRelationInput[]
  prdRelations?: ProjectUiFlowRelationInput[]
  alignments?: ProjectUiFlowAlignmentInput[]
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function compact(value: string | null | undefined, maxLength = 180) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function slug(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'flow'
}

function uniqueTexts(values: Array<string | null | undefined>, maxItems = 12) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const text = compact(value)
    const key = text.toLocaleLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= maxItems) break
  }
  return result
}

function evidence(kind: ProjectUiFlowEvidenceRef['kind'], label: string, quote?: string | null): ProjectUiFlowEvidenceRef {
  return { kind, label: compact(label, 120), quote: compact(quote, 220) || null }
}

function mergeEvidenceRefs(refs: ProjectUiFlowEvidenceRef[]) {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = `${ref.kind}|${ref.label}|${ref.quote ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return Boolean(ref.label)
  }).slice(0, 12)
}

function screenNodeId(screenId: string | null | undefined, groupKey: string, index: number) {
  return screenId || `flow-screen-${String(index + 1).padStart(2, '0')}-${slug(groupKey)}`
}

function buildNodes(input: BuildProjectUiFlowInput) {
  const screenByGroupKey = new Map(input.figmaUxMap?.screens.map((screen) => [screen.groupKey, screen]) ?? [])
  const alignmentsByGroupKey = new Map<string, ProjectUiFlowAlignmentInput[]>()
  for (const alignment of input.alignments ?? []) {
    alignmentsByGroupKey.set(alignment.groupKey, [...(alignmentsByGroupKey.get(alignment.groupKey) ?? []), alignment])
  }

  return input.groups.map((group, index): ProjectUiFlowNode => {
    const screen = screenByGroupKey.get(group.key)
    const alignmentEvidence = alignmentsByGroupKey.get(group.key) ?? []
    const frameEvidence = group.frames.flatMap((frame) => [
      evidence('figma', `Figma：${frame.name}`, uniqueTexts([...(frame.visibleTexts ?? []), ...(frame.annotations ?? [])], 4).join(' / ')),
    ])
    const prdEvidence = alignmentEvidence.map((match) => evidence('prd', match.sourceLabel, match.excerpt))
    return {
      id: screenNodeId(screen?.id, group.key, index),
      screenId: screen?.id ?? null,
      stateId: null,
      groupKey: group.key,
      label: screen?.label || group.label,
      role: 'screen',
      order: index,
      figmaNodeIds: group.frames.map((frame) => frame.id),
      evidenceRefs: mergeEvidenceRefs([...frameEvidence, ...prdEvidence]),
      confidence: clamp(Math.round(Math.max(screen?.confidence ?? 0, ...alignmentEvidence.map((item) => item.confidence), 72)), 40, 98),
    }
  })
}

function edgeSource(source: ProjectUiFlowRelationInput['source'] | FigmaUxMapTransitionSource): ProjectUiFlowEdgeSource {
  return source === 'prd_text' ? 'prd_relation' : source
}

function sourceRank(source: ProjectUiFlowEdgeSource) {
  if (source === 'figma_connector' || source === 'figma_prototype') return 20
  if (source === 'mixed') return 18
  if (source === 'prd_relation' || source === 'prd_text') return 14
  if (source === 'ai_review') return 12
  if (source === 'annotation' || source === 'frame_title') return 10
  return 4
}

function mergeEdge(existing: ProjectUiFlowEdge, incoming: ProjectUiFlowEdge): ProjectUiFlowEdge {
  return {
    ...existing,
    trigger: existing.trigger || incoming.trigger,
    condition: existing.condition || incoming.condition,
    effect: existing.effect || incoming.effect,
    source: existing.source === incoming.source ? existing.source : 'mixed',
    confidence: clamp(Math.max(existing.confidence, incoming.confidence, Math.round((existing.confidence + incoming.confidence) / 2) + 6), 1, 99),
    evidenceRefs: mergeEvidenceRefs([...(existing.evidenceRefs ?? []), ...(incoming.evidenceRefs ?? [])]),
  }
}

function buildEdges(input: BuildProjectUiFlowInput, nodes: ProjectUiFlowNode[]) {
  const nodeByScreenId = new Map(nodes.filter((node) => node.screenId).map((node) => [node.screenId, node]))
  const nodeByGroupKey = new Map(nodes.filter((node) => node.groupKey).map((node) => [node.groupKey, node]))
  const edgesByKey = new Map<string, ProjectUiFlowEdge>()

  const pushEdge = (edge: ProjectUiFlowEdge) => {
    if (edge.sourceNodeId === edge.targetNodeId) return
    const key = `${edge.sourceNodeId}->${edge.targetNodeId}`
    const existing = edgesByKey.get(key)
    edgesByKey.set(key, existing ? mergeEdge(existing, edge) : edge)
  }

  for (const transition of input.figmaUxMap?.transitions ?? []) {
    const sourceNode = nodeByScreenId.get(transition.sourceScreenId)
    const targetNode = nodeByScreenId.get(transition.targetScreenId)
    if (!sourceNode || !targetNode) continue
    pushEdge({
      id: `flow-edge-${slug(transition.id)}`,
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
      trigger: transition.trigger ?? null,
      condition: transition.condition ?? null,
      effect: transition.effect ?? null,
      source: edgeSource(transition.source),
      confidence: transition.confidence,
      evidenceRefs: mergeEvidenceRefs(transition.evidence.map((item) => evidence('figma', `Figma UX Map：${transition.source}`, item))),
    })
  }

  for (const relation of [...(input.figmaRelations ?? []), ...(input.prdRelations ?? [])]) {
    const sourceNode = nodeByGroupKey.get(relation.sourceGroupKey)
    const targetNode = nodeByGroupKey.get(relation.targetGroupKey)
    if (!sourceNode || !targetNode) continue
    pushEdge({
      id: `flow-edge-${slug(sourceNode.id)}-${slug(targetNode.id)}`,
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
      trigger: relation.label,
      condition: null,
      effect: `进入 ${targetNode.label}`,
      source: edgeSource(relation.source),
      confidence: relation.confidence,
      evidenceRefs: [
        evidence(relation.source === 'prd_relation' || relation.source === 'prd_text' ? 'prd' : 'figma', relation.label, relation.reason),
      ],
    })
  }

  return [...edgesByKey.values()]
    .map((edge, index) => ({ ...edge, id: edge.id || `flow-edge-${index + 1}` }))
    .sort((a, b) => nodes.findIndex((node) => node.id === a.sourceNodeId) - nodes.findIndex((node) => node.id === b.sourceNodeId)
      || nodes.findIndex((node) => node.id === a.targetNodeId) - nodes.findIndex((node) => node.id === b.targetNodeId)
      || b.confidence - a.confidence)
}

function preferredEntries(candidates: ProjectUiFlowNode[]) {
  const entryPattern = /入口|开始|打开|进入|首页|主界面|默认/u
  return [...candidates].sort((a, b) => Number(entryPattern.test(b.label)) - Number(entryPattern.test(a.label)) || a.order - b.order)
}

function preferredExits(candidates: ProjectUiFlowNode[]) {
  const exitPattern = /完成|成功|结束|关闭|返回|结算|结果/u
  return [...candidates].sort((a, b) => Number(exitPattern.test(b.label)) - Number(exitPattern.test(a.label)) || b.order - a.order)
}

function buildAdjacency(edges: ProjectUiFlowEdge[]) {
  const outgoing = new Map<string, ProjectUiFlowEdge[]>()
  const incoming = new Map<string, ProjectUiFlowEdge[]>()
  for (const edge of edges) {
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge])
    incoming.set(edge.targetNodeId, [...(incoming.get(edge.targetNodeId) ?? []), edge])
  }
  for (const list of outgoing.values()) {
    list.sort((a, b) => b.confidence + sourceRank(b.source) - (a.confidence + sourceRank(a.source)) || a.targetNodeId.localeCompare(b.targetNodeId))
  }
  return { outgoing, incoming }
}

function selectEntryExit(nodes: ProjectUiFlowNode[], edges: ProjectUiFlowEdge[]) {
  const { outgoing, incoming } = buildAdjacency(edges)
  const entries = preferredEntries(nodes.filter((node) => !(incoming.get(node.id)?.length)))
  const exits = preferredExits(nodes.filter((node) => !(outgoing.get(node.id)?.length)))
  return {
    entryNodeIds: (entries.length ? entries : nodes.slice(0, 1)).map((node) => node.id),
    exitNodeIds: (exits.length ? exits : nodes.slice(-1)).map((node) => node.id),
  }
}

interface PathCandidate {
  nodeIds: string[]
  edgeIds: string[]
  score: number
  confidence: number
}

function bestPaths(nodes: ProjectUiFlowNode[], edges: ProjectUiFlowEdge[], entryNodeIds: string[], exitNodeIds: string[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const exitSet = new Set(exitNodeIds)
  const { outgoing } = buildAdjacency(edges)
  const candidates: PathCandidate[] = []

  const visit = (nodeId: string, nodeIds: string[], edgeIds: string[], score: number, confidenceTotal: number) => {
    if (exitSet.has(nodeId) && nodeIds.length > 1) {
      candidates.push({
        nodeIds,
        edgeIds,
        score,
        confidence: Math.round(confidenceTotal / Math.max(1, edgeIds.length)),
      })
      return
    }
    if (nodeIds.length > nodes.length + 1) return
    for (const edge of outgoing.get(nodeId) ?? []) {
      if (nodeIds.includes(edge.targetNodeId)) continue
      const target = nodeById.get(edge.targetNodeId)
      visit(
        edge.targetNodeId,
        [...nodeIds, edge.targetNodeId],
        [...edgeIds, edge.id],
        score + edge.confidence + sourceRank(edge.source) + (target ? Math.max(0, 100 - target.order) / 100 : 0),
        confidenceTotal + edge.confidence,
      )
    }
  }

  for (const entryNodeId of entryNodeIds) visit(entryNodeId, [entryNodeId], [], 0, 0)

  return candidates.sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.nodeIds.join('|').localeCompare(b.nodeIds.join('|')))
}

function buildAmbiguities(nodes: ProjectUiFlowNode[], edges: ProjectUiFlowEdge[], entryNodeIds: string[], exitNodeIds: string[], happyPathNodeIds: string[]) {
  const ambiguities: ProjectUiFlowAmbiguity[] = []
  const push = (kind: ProjectUiFlowAmbiguityKind, message: string, severity: ProjectUiFlowAmbiguity['severity'], nodeId?: string | null, edgeId?: string | null, refs: ProjectUiFlowEvidenceRef[] = []) => {
    ambiguities.push({
      id: `flow-ambiguity-${String(ambiguities.length + 1).padStart(2, '0')}-${kind}`,
      kind,
      message,
      severity,
      nodeId,
      edgeId,
      evidenceRefs: mergeEvidenceRefs(refs),
    })
  }

  if (!entryNodeIds.length) push('missing_entry', '未识别到稳定流程起点。', 'critical')
  if (!exitNodeIds.length) push('missing_exit', '未识别到稳定流程终点。', 'critical')

  const connected = new Set<string>()
  for (const edge of edges) {
    connected.add(edge.sourceNodeId)
    connected.add(edge.targetNodeId)
    if (edge.confidence < 68) {
      push('low_confidence_edge', '存在低置信流程边，需要设计师确认。', 'warning', null, edge.id, edge.evidenceRefs)
    }
  }
  for (const node of nodes) {
    if (nodes.length > 1 && !connected.has(node.id)) {
      push('disconnected_node', `「${node.label}」未接入端到端流程。`, 'warning', node.id, null, node.evidenceRefs)
    }
  }
  if (edges.length > 0 && happyPathNodeIds.length <= 1) {
    push('cycle_without_exit', '已识别流程边，但无法形成从起点到终点的稳定主路径。', 'warning')
  }

  return ambiguities
}

function flowSummary(nodes: ProjectUiFlowNode[], edges: ProjectUiFlowEdge[], entryNodeIds: string[], exitNodeIds: string[], happyPathNodeIds: string[], ambiguities: ProjectUiFlowAmbiguity[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const entries = entryNodeIds.map((id) => nodeById.get(id)?.label).filter(Boolean).join(' / ') || '未识别'
  const exits = exitNodeIds.map((id) => nodeById.get(id)?.label).filter(Boolean).join(' / ') || '未识别'
  const path = happyPathNodeIds.map((id) => nodeById.get(id)?.label).filter(Boolean).join(' → ') || '未形成稳定主路径'
  return `起点：${entries}；终点：${exits}；主路径：${path}；节点 ${nodes.length} 个，流转 ${edges.length} 条，待确认 ${ambiguities.length} 项。`
}

function flowConfidence(nodes: ProjectUiFlowNode[], edges: ProjectUiFlowEdge[], ambiguities: ProjectUiFlowAmbiguity[]) {
  const edgeConfidence = edges.length ? edges.reduce((sum, edge) => sum + edge.confidence, 0) / edges.length : 56
  const nodeConfidence = nodes.length ? nodes.reduce((sum, node) => sum + node.confidence, 0) / nodes.length : 50
  const penalty = ambiguities.reduce((sum, ambiguity) => sum + (ambiguity.severity === 'critical' ? 16 : ambiguity.severity === 'warning' ? 8 : 3), 0)
  return clamp(Math.round((edgeConfidence * 0.6) + (nodeConfidence * 0.4) - penalty), 20, 98)
}

export function buildProjectUiFlow(input: BuildProjectUiFlowInput): ProjectUiFlow | null {
  const nodes = buildNodes(input)
  if (!nodes.length) return null
  const edges = buildEdges(input, nodes)
  const { entryNodeIds, exitNodeIds } = selectEntryExit(nodes, edges)
  const paths = bestPaths(nodes, edges, entryNodeIds.slice(0, 2), exitNodeIds)
  const happyPath = paths[0] ?? { nodeIds: entryNodeIds.slice(0, 1), edgeIds: [], confidence: 0, score: 0 }
  const ambiguities = buildAmbiguities(nodes, edges, entryNodeIds, exitNodeIds, happyPath.nodeIds)
  const alternatePaths: ProjectUiFlowPath[] = paths.slice(1, 4).map((path, index) => ({
    id: `flow-path-alt-${index + 1}`,
    label: `分支路径 ${index + 1}`,
    nodeIds: path.nodeIds,
    edgeIds: path.edgeIds,
    confidence: path.confidence,
  }))

  return {
    version: 'project-ui-flow.v1',
    summary: flowSummary(nodes, edges, entryNodeIds, exitNodeIds, happyPath.nodeIds, ambiguities),
    confidence: flowConfidence(nodes, edges, ambiguities),
    nodes,
    edges,
    entryNodeIds,
    exitNodeIds,
    happyPathNodeIds: happyPath.nodeIds,
    alternatePaths,
    ambiguities,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeEvidenceRefs(value: unknown): ProjectUiFlowEvidenceRef[] {
  if (!Array.isArray(value)) return []
  const refs: ProjectUiFlowEvidenceRef[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const kind = item.kind === 'figma' || item.kind === 'prd' || item.kind === 'ai' || item.kind === 'heuristic' ? item.kind : 'heuristic'
    const label = compact(typeof item.label === 'string' ? item.label : '')
    if (!label) continue
    refs.push({ kind, label, quote: typeof item.quote === 'string' ? compact(item.quote) : null })
  }
  return mergeEvidenceRefs(refs)
}

export function normalizeProjectUiFlow(value: unknown): ProjectUiFlow | null {
  if (!isRecord(value) || value.version !== 'project-ui-flow.v1') return null
  const nodes = Array.isArray(value.nodes)
    ? value.nodes.map((item, index): ProjectUiFlowNode | null => {
      if (!isRecord(item)) return null
      const id = compact(typeof item.id === 'string' ? item.id : '')
      const label = compact(typeof item.label === 'string' ? item.label : '')
      if (!id || !label) return null
      return {
        id,
        screenId: typeof item.screenId === 'string' ? item.screenId : null,
        stateId: typeof item.stateId === 'string' ? item.stateId : null,
        groupKey: typeof item.groupKey === 'string' ? item.groupKey : null,
        label,
        role: item.role === 'state' ? 'state' : 'screen',
        order: typeof item.order === 'number' ? item.order : index,
        figmaNodeIds: Array.isArray(item.figmaNodeIds) ? item.figmaNodeIds.filter((id): id is string => typeof id === 'string') : [],
        evidenceRefs: normalizeEvidenceRefs(item.evidenceRefs),
        confidence: clamp(typeof item.confidence === 'number' ? item.confidence : 60, 0, 100),
      }
    }).filter((item): item is ProjectUiFlowNode => Boolean(item))
    : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(value.edges)
    ? value.edges.map((item, index): ProjectUiFlowEdge | null => {
      if (!isRecord(item)) return null
      const sourceNodeId = typeof item.sourceNodeId === 'string' ? item.sourceNodeId : ''
      const targetNodeId = typeof item.targetNodeId === 'string' ? item.targetNodeId : ''
      if (!nodeIds.has(sourceNodeId) || !nodeIds.has(targetNodeId)) return null
      return {
        id: compact(typeof item.id === 'string' ? item.id : '') || `flow-edge-${index + 1}`,
        sourceNodeId,
        targetNodeId,
        trigger: typeof item.trigger === 'string' ? compact(item.trigger) : null,
        condition: typeof item.condition === 'string' ? compact(item.condition) : null,
        effect: typeof item.effect === 'string' ? compact(item.effect) : null,
        source: typeof item.source === 'string' ? item.source as ProjectUiFlowEdgeSource : 'visual_order',
        confidence: clamp(typeof item.confidence === 'number' ? item.confidence : 60, 0, 100),
        evidenceRefs: normalizeEvidenceRefs(item.evidenceRefs),
      }
    }).filter((item): item is ProjectUiFlowEdge => Boolean(item))
    : []
  const idsFrom = (raw: unknown) => Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && nodeIds.has(id)) : []
  const edgeIds = new Set(edges.map((edge) => edge.id))
  const alternatePaths = Array.isArray(value.alternatePaths)
    ? value.alternatePaths.map((item, index): ProjectUiFlowPath | null => {
      if (!isRecord(item)) return null
      return {
        id: typeof item.id === 'string' ? item.id : `flow-path-alt-${index + 1}`,
        label: typeof item.label === 'string' ? item.label : `分支路径 ${index + 1}`,
        nodeIds: idsFrom(item.nodeIds),
        edgeIds: Array.isArray(item.edgeIds) ? item.edgeIds.filter((id): id is string => typeof id === 'string' && edgeIds.has(id)) : [],
        confidence: clamp(typeof item.confidence === 'number' ? item.confidence : 60, 0, 100),
      }
    }).filter((item): item is ProjectUiFlowPath => Boolean(item))
    : []
  const ambiguities = Array.isArray(value.ambiguities)
    ? value.ambiguities.map((item, index): ProjectUiFlowAmbiguity | null => {
      if (!isRecord(item)) return null
      const kind = typeof item.kind === 'string' ? item.kind as ProjectUiFlowAmbiguityKind : 'disconnected_node'
      const message = compact(typeof item.message === 'string' ? item.message : '')
      if (!message) return null
      return {
        id: typeof item.id === 'string' ? item.id : `flow-ambiguity-${index + 1}`,
        kind,
        message,
        nodeId: typeof item.nodeId === 'string' && nodeIds.has(item.nodeId) ? item.nodeId : null,
        edgeId: typeof item.edgeId === 'string' && edgeIds.has(item.edgeId) ? item.edgeId : null,
        evidenceRefs: normalizeEvidenceRefs(item.evidenceRefs),
        severity: item.severity === 'critical' || item.severity === 'info' ? item.severity : 'warning',
      }
    }).filter((item): item is ProjectUiFlowAmbiguity => Boolean(item))
    : []

  return {
    version: 'project-ui-flow.v1',
    summary: compact(typeof value.summary === 'string' ? value.summary : '') || flowSummary(nodes, edges, idsFrom(value.entryNodeIds), idsFrom(value.exitNodeIds), idsFrom(value.happyPathNodeIds), ambiguities),
    confidence: clamp(typeof value.confidence === 'number' ? value.confidence : flowConfidence(nodes, edges, ambiguities), 0, 100),
    nodes,
    edges,
    entryNodeIds: idsFrom(value.entryNodeIds),
    exitNodeIds: idsFrom(value.exitNodeIds),
    happyPathNodeIds: idsFrom(value.happyPathNodeIds),
    alternatePaths,
    ambiguities,
  }
}

export function formatProjectUiFlowMarkdown(flow: ProjectUiFlow | null | undefined) {
  if (!flow) return ''
  const nodeById = new Map(flow.nodes.map((node) => [node.id, node]))
  const labels = (ids: string[]) => ids.map((id) => nodeById.get(id)?.label ?? id).join(' → ')
  const edgeLines = flow.edges.length
    ? flow.edges.map((edge) => {
      const source = nodeById.get(edge.sourceNodeId)?.label ?? edge.sourceNodeId
      const target = nodeById.get(edge.targetNodeId)?.label ?? edge.targetNodeId
      return `- ${source} → ${target}：${edge.trigger ?? edge.effect ?? '流转'}（${edge.source}，${edge.confidence}%）`
    }).join('\n')
    : '- 暂无明确流转'
  const ambiguityLines = flow.ambiguities.length
    ? flow.ambiguities.map((item) => `- [${item.severity}] ${item.message}`).join('\n')
    : '- 暂无'

  return [
    '## PRD+Figma UI Flow',
    '',
    `- 总体置信度：${flow.confidence}%`,
    `- 起点：${labels(flow.entryNodeIds) || '未识别'}`,
    `- 终点：${labels(flow.exitNodeIds) || '未识别'}`,
    `- 主路径：${labels(flow.happyPathNodeIds) || '未形成稳定主路径'}`,
    `- 摘要：${flow.summary}`,
    '',
    '### 流程边',
    edgeLines,
    '',
    '### 待确认项',
    ambiguityLines,
  ].join('\n')
}
