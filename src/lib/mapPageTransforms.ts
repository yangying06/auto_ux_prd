import type { DecompositionSourcePayload } from './api'
import { getNodeFigmaDraftSources, nodeHasGeneratedFigmaDraftSource, nodeHasPrototypeInFlight, type FigmaDraftSource } from './figmaDraftPrototype'
import { collectDeliveryNodes } from './prdNodeDelivery'
import type { AddNodePayload } from '../components/map/AddNodeModal'
import type { AppStoreState } from '../store/appStore'
import type { AssetWorkbenchState } from '../types/assetWorkbench'
import { PROJECT_ARCHIVE_EXTENSION } from '../types/archive'
import type { PrdNode, PrdNodeReference, PrdTree } from '../types/prdNode'
import type { ProjectBaselineScan, ProjectIterationContext } from '../types/projectWorkflow'

function getImportedSourceText(sources: DecompositionSourcePayload) {
  return sources.sourceText?.trim() || sources.mdText?.trim() || ''
}

function getImportedSourceFilename(sources: DecompositionSourcePayload) {
  return sources.sourceFilename?.trim() || sources.mdFilename?.trim() || 'source-corpus.md'
}

export function buildImportSourceDocumentText(sources: DecompositionSourcePayload) {
  const figmaUrl = sources.figmaUrl?.trim()
  const figmaPrdUrl = sources.figmaPrdUrl?.trim()
  const sourceText = getImportedSourceText(sources)
  const parts: string[] = []

  if (figmaUrl) {
    parts.push(`# Figma 设计稿链接\n\n${figmaUrl}`)
  }

  if (figmaPrdUrl) {
    parts.push(`# Figma PRD 画布链接\n\n${figmaPrdUrl}`)
  }

  if (sourceText) {
    const filename = getImportedSourceFilename(sources)
    parts.push(`# 导入素材：${filename}\n\n${sourceText}`)
  }

  return parts.join('\n\n---\n\n')
}

export function buildImportSourceFilename(sources: DecompositionSourcePayload) {
  const hasFigma = Boolean(sources.figmaUrl?.trim())
  const hasFigmaPrd = Boolean(sources.figmaPrdUrl?.trim())
  const sourceFilename = getImportedSourceText(sources) ? getImportedSourceFilename(sources) : ''
  if ((hasFigma || hasFigmaPrd) && sourceFilename) return `figma+${sourceFilename}`
  if (hasFigma && hasFigmaPrd) return 'figma-design+figma-prd.md'
  if (hasFigmaPrd) return 'figma-prd.md'
  if (hasFigma) return 'figma-design.md'
  return sourceFilename || 'source-corpus.md'
}

export function buildIterationSourceText(sources: DecompositionSourcePayload) {
  const sourceText = getImportedSourceText(sources)
  return [
    sources.figmaUrl?.trim() ? `Figma 设计稿：${sources.figmaUrl.trim()}` : null,
    sources.figmaPrdUrl?.trim() ? `Figma PRD 画布：${sources.figmaPrdUrl.trim()}` : null,
    sourceText || null,
  ].filter(Boolean).join('\n\n')
}

export interface FlowConnectionDraftItem {
  originalIndex: number | null
  label: string
  reason: string
}

export interface FlowConnectionDraft {
  isOpen: boolean
  mode: 'incoming' | 'outgoing' | 'edge'
  sourceNodeId: string
  targetNodeId: string
  originalSourceNodeId: string | null
  originalTargetNodeId: string | null
  items: FlowConnectionDraftItem[]
}

export interface CanvasConnectionDraft {
  nodeId: string
  direction: 'incoming' | 'outgoing'
}

export interface FigmaDraftTarget {
  node: PrdNode
  source: FigmaDraftSource
  sourceIndex: number
  sourceCount: number
}

export interface GeneratedNodePrototype {
  node: PrdNode
  html: string
}

export interface PrototypeFlowEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  label: string
  reason: string | null
  count: number
}

export interface PrototypeFlowStep extends GeneratedNodePrototype {
  incoming: PrototypeFlowEdge[]
  outgoing: PrototypeFlowEdge[]
  sequenceIndex: number
  previousNodeId: string | null
  nextNodeId: string | null
  previousEdge: PrototypeFlowEdge | null
  nextEdge: PrototypeFlowEdge | null
}

export interface PrototypeFlowPreview {
  nodes: GeneratedNodePrototype[]
  edges: PrototypeFlowEdge[]
  steps: PrototypeFlowStep[]
  orderedNodeIds: string[]
  entryNodeId: string | null
}

function compactText(value: string | null | undefined, maxLength = 72) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

function nodeInteractionHint(node: PrdNode) {
  return compactText(
    node.sections?.interaction?.summary
    ?? node.sections?.interaction?.content
    ?? node.sections?.view?.summary
    ?? node.summary
    ?? node.content,
  )
}

const TRIGGER_VERBS = ['点击并', '点击', '按下', '选择', '勾选', '切换', '触发', '提交', '确认', '登录', '注册', '支付', '购买', '删除', '新增', '编辑', '返回', '退出', '长按', '双击', '拖拽', '滑动']

// 从源界面的交互描述里抠出一个短动作短语（如“点击登录按钮”），用来当画布上的跳转标题。
function extractTriggerAction(sourceNode: PrdNode): string {
  const hint = nodeInteractionHint(sourceNode)
  if (!hint) return ''
  const matched = TRIGGER_VERBS.find((v) => hint.includes(v))
  const start = matched ? hint.indexOf(matched) : 0
  const rest = hint.slice(start)
  const stop = rest.search(/[，。；,.;:：、\n\r（）()【】\[\]「」""'']/)
  const phrase = stop > 0 ? rest.slice(0, stop) : rest
  return compactText(phrase, 14)
}

export function buildSmartReference(sourceNode: PrdNode, targetNode: PrdNode): PrdNodeReference {
  const sourceHint = nodeInteractionHint(sourceNode)
  const targetHint = nodeInteractionHint(targetNode)
  const trigger = extractTriggerAction(sourceNode)
  const label = defaultFlowConnectionLabel(sourceNode, targetNode, trigger)
  const reason = buildStructuredFlowDetail(sourceNode, targetNode, { label: trigger, hint: sourceHint, targetHint })

  return {
    targetNodeId: targetNode.id,
    label,
    reason,
    sourceNodeId: sourceNode.id,
  }
}

function findNodeStateLabel(node: PrdNode | null | undefined, stateId: string | null | undefined) {
  if (!node || !stateId) return ''
  return node.uiStates?.find((state) => state.id === stateId)?.label?.trim() ?? ''
}

function defaultNodeStateLabel(node: PrdNode | null | undefined) {
  if (!node?.uiStates?.length) return ''
  const base = node.uiStates.find((state) => state.kind === 'default')
  return (base ?? node.uiStates[0]).label?.trim() ?? ''
}

// 找出 source 节点上指向 target 的状态转移（出向优先，再回退入向）。
function findTransitionBetween(sourceNode: PrdNode, targetNode: PrdNode) {
  const outgoing = (sourceNode.stateTransitions ?? []).find((transition) => transition.targetNodeId === targetNode.id)
  if (outgoing) return outgoing
  const incoming = (targetNode.stateTransitions ?? []).find((transition) => transition.targetNodeId === sourceNode.id && transition.sourceNodeId === sourceNode.id)
  return incoming ?? null
}

// 生成「从 X 界面的 Y 状态，通过 ... 跳转到 A 界面的 B 状态」的结构化跳转描述。
function buildStructuredFlowDetail(
  sourceNode: PrdNode,
  targetNode: PrdNode,
  fallback: { label?: string; hint?: string; targetHint?: string },
): string {
  const transition = findTransitionBetween(sourceNode, targetNode)
  const sourceState = findNodeStateLabel(sourceNode, transition?.sourceStateId) || defaultNodeStateLabel(sourceNode)
  const targetState = findNodeStateLabel(targetNode, transition?.targetStateId) || defaultNodeStateLabel(targetNode)
  const trigger = compactText(transition?.trigger ?? fallback.label ?? '', 24)
  const condition = compactText(transition?.condition ?? '', 40)
  const hint = fallback.hint ?? ''

  const fromClause = sourceState ? `「${sourceNode.label}」的「${sourceState}」状态` : `「${sourceNode.label}」`
  const toClause = targetState ? `「${targetNode.label}」的「${targetState}」状态` : `「${targetNode.label}」`

  const howParts: string[] = []
  if (trigger) howParts.push(trigger)
  if (condition) howParts.push(`满足「${condition}」`)
  const howClause = howParts.length ? `通过${howParts.join('、')}触发` : (hint ? `由「${compactText(hint, 28)}」触发` : '跳转')

  return `从${fromClause}${howClause}，进入${toClause}。`
}

export function defaultFlowConnectionLabel(_sourceNode: PrdNode, targetNode: PrdNode, trigger?: string) {
  if (trigger) return trigger
  return `进入「${targetNode.label}」`
}

export function buildFlowConnectionDraftItems(sourceNode: PrdNode, targetNode: PrdNode): FlowConnectionDraftItem[] {
  const fallbackLabel = defaultFlowConnectionLabel(sourceNode, targetNode)
  const trigger = extractTriggerAction(sourceNode)
  const structuredReason = buildStructuredFlowDetail(sourceNode, targetNode, {
    label: trigger,
    hint: nodeInteractionHint(sourceNode),
    targetHint: nodeInteractionHint(targetNode),
  })
  const matches = (sourceNode.references ?? [])
    .map((reference, index) => ({ reference, index }))
    .filter(({ reference }) => reference.targetNodeId === targetNode.id)

  if (!matches.length) {
    return [{ originalIndex: null, label: fallbackLabel, reason: structuredReason }]
  }

  return matches.map(({ reference, index }) => ({
    originalIndex: index,
    label: reference.label?.trim() || fallbackLabel,
    reason: reference.reason?.trim() || structuredReason,
  }))
}

export function buildInterfaceFlowDisplayTree(tree: PrdTree): PrdTree {
  return Object.fromEntries(
    collectDeliveryNodes(tree).map((node) => [
      node.id,
      {
        ...node,
        parentId: null,
        children: [],
      },
    ]),
  ) as PrdTree
}

export function findLastActiveIdx(steps: Array<{ status: string }>) {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].status === 'active') return i
  }
  return -1
}

export function normalizeStepPhase(label: string) {
  return label
    .replace(/（已等待 \d+ 秒，AI 正在分析原文）$/, '')
    .replace(/（\d+\/\d+）$/, '')
    .replace(/[.。…]+$/, '')
    .trim()
}

export function completionGateNodes(tree: PrdTree) {
  const deliveryNodes = collectDeliveryNodes(tree)
  if (deliveryNodes.length) return deliveryNodes
  const nodes = Object.values(tree)
  const leaves = nodes.filter((node) => node.children.length === 0)
  return leaves.length ? leaves : nodes
}

export function allCompletionGateNodesDone(tree: PrdTree) {
  const targets = completionGateNodes(tree)
  return targets.length > 0 && targets.every((node) => node.status === 'done')
}

function clipNodeSourceText(text: string) {
  const trimmed = text.trim()
  if (trimmed.length <= 5000) return trimmed
  return `${trimmed.slice(0, 5000)}\n\n[资料内容较长，节点预览仅保留前半部分，AI 分析文本也按附件上限截断]`
}

export function buildAddedNodeContent(title: string, supplementText: string, sources: AddNodePayload['sources']) {
  const sections = [
    `# ${title}`,
    '## 节点目标',
    supplementText.trim() || '待基于补充资料完善页面目标、交互范围和验收点。',
  ]

  if (sources.length) {
    sections.push(
      '## 用户提供资料',
      ...sources.map((source) => `### ${source.name}\n\n${clipNodeSourceText(source.text)}`),
    )
  }

  sections.push('## View / Flow / Data', '等待 AI 建议或人工补齐画面、操作、数据三类细节；服务端依赖记录到服务端交互内容中。')
  return sections.join('\n\n')
}

export function shouldGenerateAddedNodeDocument(
  supplementText: string,
  sources: AddNodePayload['sources'],
  sourceDocument: { text?: string | null } | null | undefined,
) {
  return Boolean(
    supplementText.trim()
    || sources.some((source) => source.text.trim())
    || sourceDocument?.text?.trim(),
  )
}

export function buildAddedNodePolishRequest(input: {
  title: string
  parentLabel?: string | null
  supplementText: string
  sources: AddNodePayload['sources']
  hasProjectPrd: boolean
}) {
  const sourceBlocks = input.sources
    .filter((source) => source.text.trim())
    .map((source, index) => [
      `### 附件 ${index + 1}：${source.name}`,
      clipNodeSourceText(source.text),
    ].join('\n\n'))

  return [
    `新增界面节点：${input.title}`,
    input.parentLabel ? `父级节点：${input.parentLabel}` : null,
    input.hasProjectPrd
      ? '项目已导入 PRD 原文。请优先从项目 PRD、当前导图上下文和相关证据中检索这个界面对应的入口、状态、规则、字段和验收点。'
      : '当前没有可用的项目 PRD 原文，请只基于本轮补充资料生成初稿，并把缺口写入需澄清点。',
    '请立即为这个新增界面生成可导出的 Markdown 子文档；这是需求文档打磨，不是右侧 HTML 原型修改，也不是 prototype_update。',
    '必须把结果写入 nodePatch.summary、nodePatch.content，并尽量补齐 nodePatch.sections.view、nodePatch.sections.interaction、nodePatch.sections.data、handoffGoal、qualityGate 和 evidenceRefs。',
    '不要只回复简短说明；如果 PRD 没有明确视觉稿、截图或 Figma 细节，也请先按文字 PRD 生成，在“需澄清点”记录视觉资源缺口。',
    input.supplementText.trim() ? `## 本轮补充说明\n${input.supplementText.trim()}` : null,
    sourceBlocks.length ? `## 本轮附件资料\n${sourceBlocks.join('\n\n')}` : null,
  ].filter(Boolean).join('\n\n')
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function hasProjectData(tree: PrdTree | null, sourceDocument: unknown) {
  return Boolean(sourceDocument) || Object.keys(tree ?? {}).length > 0
}

export function defaultArchiveFilename(projectName: string, sourceFilename?: string | null) {
  const sourceBase = sourceFilename?.replace(/\.[^.]+$/u, '') ?? projectName
  const safeName = (sourceBase || projectName || 'ux-specforge-project')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return `${safeName || 'ux-specforge-project'}-${new Date().toISOString().slice(0, 10)}.${PROJECT_ARCHIVE_EXTENSION}`
}

export function collectGeneratedNodePrototypes(tree: PrdTree, nodePrototypeStates: AppStoreState['nodePrototypeStates']) {
  return collectDeliveryNodes(tree)
    .sort((a, b) => a.level - b.level || a.order - b.order || a.id.localeCompare(b.id))
    .map((node) => {
      const state = nodePrototypeStates[node.id]
      const selectedVariant = state?.prototypeVariants.find((variant) => variant.index === state.selectedVariantIndex)
      const html = selectedVariant?.html ?? state?.prototypeHtml ?? null
      return html ? { node, html } : null
    })
    .filter((item): item is GeneratedNodePrototype => Boolean(item))
}

function sortGeneratedNodePrototypes(a: GeneratedNodePrototype, b: GeneratedNodePrototype) {
  return a.node.level - b.node.level || a.node.order - b.node.order || a.node.id.localeCompare(b.node.id)
}

function makePrototypeFlowEdges(tree: PrdTree, nodes: GeneratedNodePrototype[]): PrototypeFlowEdge[] {
  const generatedNodeIds = new Set(nodes.map((item) => item.node.id))
  const edgeDrafts = new Map<string, {
    sourceNodeId: string
    targetNodeId: string
    labels: string[]
    reason: string | null
    count: number
  }>()

  for (const item of nodes) {
    const sourceNode = item.node
    for (const reference of sourceNode.references ?? []) {
      const targetNodeId = reference.targetNodeId
      if (!targetNodeId || targetNodeId === sourceNode.id || !generatedNodeIds.has(targetNodeId)) continue

      const targetNode = tree[targetNodeId]
      if (!targetNode) continue

      const key = `${sourceNode.id}->${targetNodeId}`
      const label = reference.label?.trim() || defaultFlowConnectionLabel(sourceNode, targetNode)
      const reason = reference.reason?.trim() || null
      const draft = edgeDrafts.get(key)

      if (draft) {
        draft.count += 1
        if (label && !draft.labels.includes(label)) draft.labels.push(label)
        if (!draft.reason && reason) draft.reason = reason
      } else {
        edgeDrafts.set(key, {
          sourceNodeId: sourceNode.id,
          targetNodeId,
          labels: label ? [label] : [],
          reason,
          count: 1,
        })
      }
    }
  }

  return [...edgeDrafts.values()].map((draft): PrototypeFlowEdge => {
    const firstLabel = draft.labels[0] ?? ''
    const label = draft.count > 1
      ? `${firstLabel || 'Jump'} 等 ${draft.count} 条`
      : firstLabel || 'Jump'

    return {
      id: `prototype-flow-${draft.sourceNodeId}-${draft.targetNodeId}`,
      sourceNodeId: draft.sourceNodeId,
      targetNodeId: draft.targetNodeId,
      label,
      reason: draft.reason,
      count: draft.count,
    }
  })
}

function sortPrototypeFlowEdges(edges: PrototypeFlowEdge[], orderIndex: Map<string, number>) {
  return [...edges].sort((a, b) => (
    (orderIndex.get(a.sourceNodeId) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.sourceNodeId) ?? Number.MAX_SAFE_INTEGER)
    || (orderIndex.get(a.targetNodeId) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.targetNodeId) ?? Number.MAX_SAFE_INTEGER)
    || a.label.localeCompare(b.label)
  ))
}

function pickPrototypeFlowEntryNodeId(nodes: GeneratedNodePrototype[], edges: PrototypeFlowEdge[]) {
  if (!nodes.length) return null
  const incomingCount = new Map(nodes.map((item) => [item.node.id, 0]))
  const outgoingCount = new Map(nodes.map((item) => [item.node.id, 0]))

  for (const edge of edges) {
    incomingCount.set(edge.targetNodeId, (incomingCount.get(edge.targetNodeId) ?? 0) + 1)
    outgoingCount.set(edge.sourceNodeId, (outgoingCount.get(edge.sourceNodeId) ?? 0) + 1)
  }

  const entryCandidates = nodes.filter((item) => (incomingCount.get(item.node.id) ?? 0) === 0)
  return (
    entryCandidates.find((item) => (outgoingCount.get(item.node.id) ?? 0) > 0)
    ?? entryCandidates[0]
    ?? nodes[0]
  ).node.id
}

function buildOrderedPrototypeNodeIds(
  nodes: GeneratedNodePrototype[],
  edges: PrototypeFlowEdge[],
  entryNodeId: string | null,
) {
  const outgoingByNodeId = new Map<string, PrototypeFlowEdge[]>()
  for (const edge of edges) {
    const outgoing = outgoingByNodeId.get(edge.sourceNodeId) ?? []
    outgoing.push(edge)
    outgoingByNodeId.set(edge.sourceNodeId, outgoing)
  }

  const orderedNodeIds: string[] = []
  const visited = new Set<string>()
  const nodeIds = new Set(nodes.map((item) => item.node.id))

  const visit = (nodeId: string | null) => {
    if (!nodeId || visited.has(nodeId) || !nodeIds.has(nodeId)) return
    visited.add(nodeId)
    orderedNodeIds.push(nodeId)
    for (const edge of outgoingByNodeId.get(nodeId) ?? []) {
      visit(edge.targetNodeId)
    }
  }

  visit(entryNodeId)

  const incomingTargets = new Set(edges.map((edge) => edge.targetNodeId))
  for (const item of nodes) {
    if (!incomingTargets.has(item.node.id)) visit(item.node.id)
  }
  for (const item of nodes) visit(item.node.id)

  return orderedNodeIds
}

export function buildPrototypeFlowPreview(tree: PrdTree, nodePrototypeStates: AppStoreState['nodePrototypeStates']): PrototypeFlowPreview {
  const nodes = collectGeneratedNodePrototypes(tree, nodePrototypeStates).sort(sortGeneratedNodePrototypes)
  const originalOrderIndex = new Map(nodes.map((item, index) => [item.node.id, index]))
  const edges = sortPrototypeFlowEdges(makePrototypeFlowEdges(tree, nodes), originalOrderIndex)
  const entryNodeId = pickPrototypeFlowEntryNodeId(nodes, edges)
  const orderedNodeIds = buildOrderedPrototypeNodeIds(nodes, edges, entryNodeId)
  const orderedIndex = new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index]))
  const nodeById = new Map(nodes.map((item) => [item.node.id, item]))
  const edgeBetween = (sourceNodeId: string | null, targetNodeId: string | null) => (
    sourceNodeId && targetNodeId
      ? edges.find((edge) => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId) ?? null
      : null
  )

  const steps = orderedNodeIds
    .map((nodeId, index): PrototypeFlowStep | null => {
      const item = nodeById.get(nodeId)
      if (!item) return null
      const previousNodeId = orderedNodeIds[index - 1] ?? null
      const nextNodeId = orderedNodeIds[index + 1] ?? null
      const incoming = edges
        .filter((edge) => edge.targetNodeId === nodeId)
        .sort((a, b) => (orderedIndex.get(a.sourceNodeId) ?? 0) - (orderedIndex.get(b.sourceNodeId) ?? 0))
      const outgoing = edges
        .filter((edge) => edge.sourceNodeId === nodeId)
        .sort((a, b) => (orderedIndex.get(a.targetNodeId) ?? 0) - (orderedIndex.get(b.targetNodeId) ?? 0))

      return {
        ...item,
        incoming,
        outgoing,
        sequenceIndex: index,
        previousNodeId,
        nextNodeId,
        previousEdge: edgeBetween(previousNodeId, nodeId),
        nextEdge: edgeBetween(nodeId, nextNodeId),
      }
    })
    .filter((step): step is PrototypeFlowStep => Boolean(step))

  return {
    nodes,
    edges,
    steps,
    orderedNodeIds,
    entryNodeId,
  }
}

export function buildNodePreviewHtmlMap(nodePrototypeStates: AppStoreState['nodePrototypeStates']) {
  return Object.fromEntries(
    Object.entries(nodePrototypeStates)
      .map(([nodeId, state]) => {
        const selectedVariant = state.prototypeVariants.find((variant) => (
          variant.index === state.selectedVariantIndex && Boolean(variant.html)
        ))
        const html = selectedVariant?.html ?? state.prototypeHtml ?? null
        return html ? [nodeId, html] : null
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  )
}

export function collectPendingFigmaDraftTargets(
  tree: PrdTree,
  nodePrototypeStates: AppStoreState['nodePrototypeStates'],
) {
  return collectDeliveryNodes(tree).flatMap((node): FigmaDraftTarget[] => {
    const sources = getNodeFigmaDraftSources(node)
    if (!sources.length) return []
    const state = nodePrototypeStates[node.id]
    if (nodeHasPrototypeInFlight(state)) return []
    return sources
      .map((source, sourceIndex) => ({
        node,
        source,
        sourceIndex,
        sourceCount: sources.length,
      }))
      .filter((target) => !nodeHasGeneratedFigmaDraftSource(state, target.source))
  })
}

export function countFigmaBoundDeliveryNodes(tree: PrdTree) {
  return collectDeliveryNodes(tree).reduce((sum, node) => sum + getNodeFigmaDraftSources(node).length, 0)
}

export function countExportableAssetRows(assetWorkbench: AssetWorkbenchState) {
  const uiCount = assetWorkbench.uiRows.filter((row) => row.status === 'ready' && row.result).length
  const effectCount = assetWorkbench.effectRows.filter((row) =>
    row.loadStatus === 'loaded' || Boolean(row.loadedPath) || row.files.length > 0
  ).length
  const audioCount = assetWorkbench.audioRows.filter((row) =>
    row.loadStatus === 'loaded' || Boolean(row.loadedPath) || row.files.length > 0
  ).length
  return uiCount + effectCount + audioCount
}

export function buildPlatformStrategyNotes(scan: ProjectBaselineScan) {
  return scan.platforms.map((platform) => `${platform.platform}: ${platform.strategy}`)
}

export function buildIterationAcceptanceFocus(scan: ProjectBaselineScan) {
  const evidenceKinds = Array.from(new Set(scan.evidence.map((item) => item.kind))).filter(Boolean)
  return [
    '只生成本次迭代 PRD 命中的界面节点',
    '代码证据只挂在界面节点详情中，不生成代码结构导图',
    '标出当前现状、本次变更、影响范围、资源/文案/数据变更和待确认问题',
    evidenceKinds.length ? `重点回归证据类型：${evidenceKinds.join(' / ')}` : '若缺少代码证据，先要求用户确认目标界面',
  ]
}

export function compactIterationContext(context: ProjectIterationContext | null | undefined) {
  if (!context) return null
  const scan = context.baselineScan
  return {
    codebasePath: context.codebasePath,
    focus: context.focus,
    platforms: scan?.platforms.map((item) => `${item.platform} ${item.confidence}%`) ?? [],
    evidenceCount: scan?.evidence.length ?? 0,
    queryTerms: scan?.queryTerms.slice(0, 8) ?? [],
  }
}
