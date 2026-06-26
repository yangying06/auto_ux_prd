import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from 'react'
import type { PrdNode, PrdTree } from '../../types/prdNode'
import { NodeCard } from './NodeCard'

const MIN_SCALE = 0.35
const MAX_SCALE = 2.4
const ZOOM_STEP = 0.15
const PADDING_X = 72
const PADDING_TOP = 92
const PADDING_BOTTOM = 96
const X_STEP = 480
const SIBLING_GAP = 28
const ROOT_GAP = 64
const REFERENCE_LANE_GAP = 28
const FREE_NODE_X_STEP = 540
const FREE_NODE_Y_STEP = 350
const FREE_COMPONENT_GAP_X = 92
const FREE_COMPONENT_GAP_Y = 118
const FREE_ROW_WIDTH = 1780
const ADD_SLOT_WIDTH = 246
const ADD_SLOT_HEIGHT = 104
const DEFAULT_CARD_WIDTH = 400
const DEFAULT_CARD_HEIGHT = 270
const PROTOTYPE_CARD_HEIGHT = 420
const EDGE_LABEL_WIDTH = 164
const EDGE_LABEL_HEIGHT = 26
const EDGE_LABEL_NOTE_HEIGHT = 40
const EDGE_LABEL_GAP = 10
const NODE_DRAG_THRESHOLD = 4
const NODE_DROP_GAP = 12
const NODE_DROP_SEARCH_STEP = 32
const NODE_DROP_SEARCH_RADIUS = 1280

type ConnectionDirection = 'incoming' | 'outgoing'
type LayoutMode = 'tree' | 'free'

interface CanvasConnectionDraft {
  nodeId: string
  direction: ConnectionDirection
}

interface TreeCanvasProps {
  tree: PrdTree
  sourceTree?: PrdTree
  layoutMode?: LayoutMode
  selectedNodeId: string | null
  canvasNodePositions?: Record<string, { x: number; y: number }>
  previewHtmlByNodeId?: Record<string, string>
  connectableNodeIds?: string[]
  connectionDraft?: CanvasConnectionDraft | null
  onNodeClick: (id: string) => void
  onNodeDoubleClick: (id: string) => void
  onAddNode?: (parentId: string | null) => void
  onStartConnection?: (nodeId: string, direction: ConnectionDirection) => void
  onCompleteConnection?: (targetNodeId: string) => void
  onNodePositionCommit?: (nodeId: string, position: { x: number; y: number }) => void
  onCancelConnection?: () => void
  onOpenConnection?: (nodeId: string, direction: ConnectionDirection) => void
  onEditReference?: (sourceNodeId: string, targetNodeId: string) => void
}

interface PositionedNode {
  node: PrdNode
  x: number
  y: number
  width: number
  height: number
  depth: number
}

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

interface AddNodeSlot {
  parent: PositionedNode | null
  x: number
  y: number
  width: number
  height: number
  d: string | null
}

interface NodeDragState {
  nodeId: string
  pointerId: number
  element: HTMLDivElement
  startClientX: number
  startClientY: number
  originX: number
  originY: number
  currentX: number
  currentY: number
  moved: boolean
}

interface LayoutResult {
  nodes: PositionedNode[]
  byId: Map<string, PositionedNode>
  layers: Array<{ depth: number; x: number; width: number; label: string }>
  contentWidth: number
  contentHeight: number
}

type FlowEdgeKind = 'primary' | 'reference'

interface FlowEdge {
  id: string
  kind: FlowEdgeKind
  fromId: string
  toId: string
  d: string
  label: string
  labelX: number
  labelY: number
  selected: boolean
  note?: string | null
}

function sortByOrder(a: PrdNode, b: PrdNode) {
  return a.order - b.order || a.id.localeCompare(b.id)
}

function getCardSize(node: PrdNode, hasPrototypePreview = false) {
  if (node.type === 'module' && node.parentId === null) return { width: 340, height: 214 }
  if (node.type === 'module') return { width: 330, height: 196 }
  return {
    width: DEFAULT_CARD_WIDTH,
    height: hasPrototypePreview ? PROTOTYPE_CARD_HEIGHT : DEFAULT_CARD_HEIGHT,
  }
}

function connectionDegree(node: PrdNode, tree: PrdTree) {
  const incomingReferences = Object.values(tree).reduce((count, source) => (
    count + (source.references ?? []).filter((reference) => reference.targetNodeId === node.id).length
  ), 0)
  const outgoingReferences = (node.references ?? []).filter((reference) => Boolean(reference.targetNodeId)).length
  return (node.parentId ? 1 : 0) + node.children.length + incomingReferences + outgoingReferences
}

function relationWeight(node: PrdNode, focusNodeId: string | null | undefined, tree: PrdTree) {
  if (!focusNodeId) return 0
  if (node.id === focusNodeId) return 1000

  const focus = tree[focusNodeId]
  if (!focus) return 0

  if (node.parentId === focus.id || focus.parentId === node.id) return 360
  if (
    (focus.references ?? []).some((reference) => reference.targetNodeId === node.id)
    || (node.references ?? []).some((reference) => reference.targetNodeId === focus.id)
  ) return 320

  if (node.parentId === focus.parentId) return 80
  if (node.level === focus.level) return 32
  return 0
}

function centerWeightedSiblings(siblings: PrdNode[], tree: PrdTree, focusNodeId?: string | null) {
  const sorted = [...siblings].sort((a, b) => (
    relationWeight(b, focusNodeId, tree) - relationWeight(a, focusNodeId, tree)
    || connectionDegree(b, tree) - connectionDegree(a, tree)
    || sortByOrder(a, b)
  ))
  const positioned = new Array<PrdNode>(sorted.length)
  const center = Math.floor((sorted.length - 1) / 2)
  const positions: number[] = []

  for (let offset = 0; positions.length < sorted.length; offset += 1) {
    const lower = center - offset
    const upper = center + offset
    if (lower >= 0 && !positions.includes(lower)) positions.push(lower)
    if (upper < sorted.length && !positions.includes(upper)) positions.push(upper)
  }

  sorted.forEach((node, index) => {
    positioned[positions[index]] = node
  })

  return positioned.filter(Boolean)
}

function buildChildrenMap(tree: PrdTree, focusNodeId?: string | null) {
  const groups = new Map<string | null, PrdNode[]>()
  for (const node of Object.values(tree)) {
    const parentId = node.parentId && tree[node.parentId] ? node.parentId : null
    const siblings = groups.get(parentId) ?? []
    siblings.push(node)
    groups.set(parentId, siblings)
  }

  for (const siblings of groups.values()) {
    siblings.splice(0, siblings.length, ...centerWeightedSiblings(siblings, tree, focusNodeId))
  }

  return groups
}

function layerLabel(depth: number) {
  if (depth === 0) return 'PRD 源'
  if (depth === 1) return '功能流'
  if (depth === 2) return '界面节点'
  if (depth === 3) return '交互细节'
  return `流程层 ${depth - 2}`
}

function buildTreeLayout(tree: PrdTree, focusNodeId?: string | null, previewNodeIds = new Set<string>()): LayoutResult {
  const childrenMap = buildChildrenMap(tree, focusNodeId)
  const roots = childrenMap.get(null) ?? []
  const heightCache = new Map<string, number>()
  const positioned: PositionedNode[] = []
  const byId = new Map<string, PositionedNode>()
  const layerWidths = new Map<number, number>()

  function childrenOf(nodeId: string) {
    return childrenMap.get(nodeId) ?? []
  }

  function measure(node: PrdNode, trail = new Set<string>()): number {
    if (heightCache.has(node.id)) return heightCache.get(node.id)!
    if (trail.has(node.id)) return getCardSize(node, previewNodeIds.has(node.id)).height

    const nextTrail = new Set(trail)
    nextTrail.add(node.id)
    const ownHeight = getCardSize(node, previewNodeIds.has(node.id)).height
    const children = childrenOf(node.id)

    if (children.length === 0) {
      heightCache.set(node.id, ownHeight)
      return ownHeight
    }

    const childrenHeight = children.reduce((sum, child, index) => (
      sum + measure(child, nextTrail) + (index === 0 ? 0 : SIBLING_GAP)
    ), 0)
    const subtreeHeight = Math.max(ownHeight, childrenHeight)
    heightCache.set(node.id, subtreeHeight)
    return subtreeHeight
  }

  function place(node: PrdNode, depth: number, top: number, trail = new Set<string>()) {
    if (trail.has(node.id)) return
    const nextTrail = new Set(trail)
    nextTrail.add(node.id)

    const size = getCardSize(node, previewNodeIds.has(node.id))
    const subtreeHeight = measure(node)
    const x = PADDING_X + depth * X_STEP
    const y = top + subtreeHeight / 2 - size.height / 2
    const item = { node, x, y, width: size.width, height: size.height, depth }

    positioned.push(item)
    byId.set(node.id, item)
    layerWidths.set(depth, Math.max(layerWidths.get(depth) ?? 0, size.width))

    const children = childrenOf(node.id)
    if (children.length === 0) return

    const childrenHeight = children.reduce((sum, child, index) => (
      sum + measure(child, nextTrail) + (index === 0 ? 0 : SIBLING_GAP)
    ), 0)
    let childTop = top + (subtreeHeight - childrenHeight) / 2

    for (const child of children) {
      place(child, depth + 1, childTop, nextTrail)
      childTop += measure(child, nextTrail) + SIBLING_GAP
    }
  }

  let top = PADDING_TOP
  for (const root of roots) {
    place(root, 0, top)
    top += measure(root) + ROOT_GAP
  }

  const maxRight = positioned.reduce((max, item) => Math.max(max, item.x + item.width), PADDING_X)
  const maxDepth = positioned.reduce((max, item) => Math.max(max, item.depth), 0)
  const layers = Array.from({ length: maxDepth + 1 }, (_, depth) => ({
    depth,
    x: PADDING_X + depth * X_STEP,
    width: layerWidths.get(depth) ?? 240,
    label: layerLabel(depth),
  }))

  return {
    nodes: positioned,
    byId,
    layers,
    contentWidth: maxRight + PADDING_X,
    contentHeight: Math.max(520, top - ROOT_GAP + PADDING_BOTTOM),
  }
}

function rectsOverlap(a: Rect, b: Rect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function inflateRect(rect: Rect, padding: number): Rect {
  return {
    left: rect.left - padding,
    top: rect.top - padding,
    right: rect.right + padding,
    bottom: rect.bottom + padding,
  }
}

function positionedNodeRect(item: Pick<PositionedNode, 'x' | 'y' | 'width' | 'height'>, padding = 0): Rect {
  return inflateRect({
    left: item.x,
    top: item.y,
    right: item.x + item.width,
    bottom: item.y + item.height,
  }, padding)
}

function buildReferenceGraph(nodes: PrdNode[], fullTree: PrdTree) {
  const visibleIds = new Set(nodes.map((node) => node.id))
  const adjacency = new Map<string, Set<string>>()
  for (const node of nodes) adjacency.set(node.id, new Set())

  for (const node of nodes) {
    const source = fullTree[node.id] ?? node
    for (const reference of source.references ?? []) {
      const targetNodeId = reference.targetNodeId
      if (!targetNodeId || targetNodeId === source.id || !visibleIds.has(targetNodeId)) continue
      adjacency.get(source.id)?.add(targetNodeId)
      adjacency.get(targetNodeId)?.add(source.id)
    }
  }

  return adjacency
}

function freeNodeSort(
  adjacency: Map<string, Set<string>>,
  focusNodeId?: string | null,
) {
  return (a: PrdNode, b: PrdNode) => (
    (b.id === focusNodeId ? 1 : 0) - (a.id === focusNodeId ? 1 : 0)
    || (adjacency.get(b.id)?.size ?? 0) - (adjacency.get(a.id)?.size ?? 0)
    || sortByOrder(a, b)
  )
}

function collectFreeComponents(nodes: PrdNode[], adjacency: Map<string, Set<string>>, focusNodeId?: string | null) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const visited = new Set<string>()
  const components: PrdNode[][] = []
  const seeds = [...nodes].sort(freeNodeSort(adjacency, focusNodeId))

  for (const seed of seeds) {
    if (visited.has(seed.id)) continue
    const queue = [seed.id]
    const component: PrdNode[] = []
    visited.add(seed.id)

    while (queue.length) {
      const nodeId = queue.shift()!
      const node = nodeById.get(nodeId)
      if (node) component.push(node)
      for (const nextId of adjacency.get(nodeId) ?? []) {
        if (visited.has(nextId)) continue
        visited.add(nextId)
        queue.push(nextId)
      }
    }

    components.push(component.sort(freeNodeSort(adjacency, focusNodeId)))
  }

  return components.sort((a, b) => {
    const aHasFocus = a.some((node) => node.id === focusNodeId)
    const bHasFocus = b.some((node) => node.id === focusNodeId)
    const aDegree = a.reduce((sum, node) => sum + (adjacency.get(node.id)?.size ?? 0), 0)
    const bDegree = b.reduce((sum, node) => sum + (adjacency.get(node.id)?.size ?? 0), 0)
    return (
      Number(bHasFocus) - Number(aHasFocus)
      || Number(bDegree > 0) - Number(aDegree > 0)
      || b.length - a.length
      || bDegree - aDegree
      || sortByOrder(a[0], b[0])
    )
  })
}

function freeComponentColumns(size: number) {
  if (size <= 1) return 1
  if (size === 2) return 2
  return Math.ceil(Math.sqrt(size * 1.25))
}

function buildFreeLayout(
  tree: PrdTree,
  sourceTree: PrdTree | undefined,
  focusNodeId?: string | null,
  previewNodeIds = new Set<string>(),
): LayoutResult {
  const nodes = Object.values(tree).sort(sortByOrder)
  if (nodes.length === 0) {
    return {
      nodes: [],
      byId: new Map(),
      layers: [],
      contentWidth: 760,
      contentHeight: 520,
    }
  }

  const fullTree = sourceTree ?? tree
  const adjacency = buildReferenceGraph(nodes, fullTree)
  const components = collectFreeComponents(nodes, adjacency, focusNodeId)
  const positioned: PositionedNode[] = []
  const byId = new Map<string, PositionedNode>()

  let cursorX = PADDING_X
  let cursorY = PADDING_TOP + 28
  let rowHeight = 0
  let maxRight = cursorX
  let maxBottom = cursorY

  for (const component of components) {
    const cols = freeComponentColumns(component.length)
    const rows = Math.ceil(component.length / cols)
    const componentSizes = component.map((node) => getCardSize(node, previewNodeIds.has(node.id)))
    const maxNodeWidth = componentSizes.reduce((max, size) => Math.max(max, size.width), DEFAULT_CARD_WIDTH)
    const maxNodeHeight = componentSizes.reduce((max, size) => Math.max(max, size.height), DEFAULT_CARD_HEIGHT)
    const rowStep = Math.max(FREE_NODE_Y_STEP, maxNodeHeight + 80)
    const componentWidth = (cols - 1) * FREE_NODE_X_STEP + maxNodeWidth + 72
    const componentHeight = (rows - 1) * rowStep + maxNodeHeight + 28

    if (cursorX > PADDING_X && cursorX + componentWidth > PADDING_X + FREE_ROW_WIDTH) {
      cursorX = PADDING_X
      cursorY += rowHeight + FREE_COMPONENT_GAP_Y
      rowHeight = 0
    }

    component.forEach((node, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      const size = getCardSize(node, previewNodeIds.has(node.id))
      const staggerX = row % 2 === 1 ? 72 : 0
      const staggerY = col % 2 === 1 ? 28 : 0
      const item: PositionedNode = {
        node,
        x: cursorX + col * FREE_NODE_X_STEP + staggerX,
        y: cursorY + row * rowStep + staggerY,
        width: size.width,
        height: size.height,
        depth: 0,
      }
      positioned.push(item)
      byId.set(node.id, item)
      maxRight = Math.max(maxRight, item.x + item.width)
      maxBottom = Math.max(maxBottom, item.y + item.height)
    })

    cursorX += componentWidth + FREE_COMPONENT_GAP_X
    rowHeight = Math.max(rowHeight, componentHeight)
  }

  return {
    nodes: positioned,
    byId,
    layers: [],
    contentWidth: maxRight + PADDING_X,
    contentHeight: Math.max(520, maxBottom + PADDING_BOTTOM),
  }
}

function applyManualPositions(layout: LayoutResult, manualPositions: Record<string, { x: number; y: number }>) {
  if (Object.keys(manualPositions).length === 0) return layout

  const nodes = layout.nodes.map((item) => {
    const manual = manualPositions[item.node.id]
    if (!manual) return item
    return {
      ...item,
      x: Math.max(24, manual.x),
      y: Math.max(72, manual.y),
    }
  })
  const byId = new Map(nodes.map((item) => [item.node.id, item]))
  const maxRight = nodes.reduce((max, item) => Math.max(max, item.x + item.width), PADDING_X)
  const maxBottom = nodes.reduce((max, item) => Math.max(max, item.y + item.height), PADDING_TOP)

  return {
    ...layout,
    nodes,
    byId,
    contentWidth: Math.max(layout.contentWidth, maxRight + PADDING_X),
    contentHeight: Math.max(layout.contentHeight, maxBottom + PADDING_BOTTOM),
  }
}

function clampScale(scale: number) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}

function connectorGeometry(parent: PositionedNode, child: PositionedNode) {
  const sx = parent.x + parent.width
  const sy = parent.y + parent.height / 2
  const ex = child.x
  const ey = child.y + child.height / 2
  const midX = sx + Math.max(56, (ex - sx) / 2)
  return {
    d: `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ey}, ${ex} ${ey}`,
    labelX: midX - 62,
    labelY: (sy + ey) / 2 - 13,
  }
}

function laneOffset(index: number, count: number) {
  return (index - (count - 1) / 2) * REFERENCE_LANE_GAP
}

function referenceGeometry(
  source: PositionedNode,
  target: PositionedNode,
  lanes: { outgoingIndex: number; outgoingCount: number; incomingIndex: number; incomingCount: number },
) {
  const outgoingOffset = laneOffset(lanes.outgoingIndex, lanes.outgoingCount)
  const incomingOffset = laneOffset(lanes.incomingIndex, lanes.incomingCount)
  const sourceCenterX = source.x + source.width / 2
  const targetCenterX = target.x + target.width / 2
  const direction = targetCenterX >= sourceCenterX ? 1 : -1
  const sx = direction > 0 ? source.x + source.width : source.x
  const sy = source.y + source.height / 2
  const ex = direction > 0 ? target.x : target.x + target.width
  const ey = target.y + target.height / 2
  const controlGap = Math.max(88, Math.abs(ex - sx) / 2)
  const c1x = sx + direction * controlGap
  const c2x = ex - direction * controlGap
  const c1y = sy + outgoingOffset
  const c2y = ey + incomingOffset

  return {
    d: `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`,
    labelX: (c1x + c2x) / 2 - 62,
    labelY: (c1y + c2y) / 2 - 13,
  }
}

function edgeLabelRect(edge: FlowEdge, labelX = edge.labelX, labelY = edge.labelY): Rect {
  const top = labelY - (edge.note ? 8 : 0)
  const height = edge.note ? EDGE_LABEL_NOTE_HEIGHT : EDGE_LABEL_HEIGHT
  return {
    left: labelX - 20,
    top,
    right: labelX - 20 + EDGE_LABEL_WIDTH,
    bottom: top + height,
  }
}

function hasRectCollision(rect: Rect, blockedRects: Rect[]) {
  return blockedRects.some((blocked) => rectsOverlap(rect, blocked))
}

function avoidEdgeLabelOverlaps(edges: FlowEdge[], layout: LayoutResult) {
  const blockedNodeRects = layout.nodes.map((item) => positionedNodeRect(item, 14))
  const placedLabelRects: Rect[] = []
  const adjusted = new Map<string, FlowEdge>()
  const yOffsets = [0, 36, -36, 72, -72, 108, -108, 144, -144, 180, -180]
  const xOffsets = [0, 46, -46, 92, -92, 138, -138]

  for (const edge of [...edges].sort((a, b) => a.labelY - b.labelY || a.labelX - b.labelX || a.id.localeCompare(b.id))) {
    let nextEdge = edge

    outer:
    for (const xOffset of xOffsets) {
      for (const yOffset of yOffsets) {
        const candidateX = edge.labelX + xOffset
        const candidateY = edge.labelY + yOffset
        const candidateRect = edgeLabelRect(edge, candidateX, candidateY)
        if (!hasRectCollision(candidateRect, blockedNodeRects) && !hasRectCollision(candidateRect, placedLabelRects)) {
          nextEdge = { ...edge, labelX: candidateX, labelY: candidateY }
          break outer
        }
      }
    }

    const rect = inflateRect(edgeLabelRect(nextEdge), EDGE_LABEL_GAP)
    placedLabelRects.push(rect)
    adjusted.set(edge.id, nextEdge)
  }

  return edges.map((edge) => adjusted.get(edge.id) ?? edge)
}

function primaryEdgeLabel(parent: PrdNode, child: PrdNode) {
  if (parent.parentId === null && child.type === 'module') return '拆解为功能流'
  if (child.type === 'module') return '展开流程组'
  if (child.type === 'page' || child.type === 'ui') return '进入界面'
  if (child.children.length > 0) return '继续流程'
  return '查看细节'
}

function isEdgeSelected(edge: Pick<FlowEdge, 'fromId' | 'toId'>, selectedNodeId: string | null) {
  return Boolean(selectedNodeId && (edge.fromId === selectedNodeId || edge.toId === selectedNodeId))
}

function buildFlowEdges(layout: LayoutResult, tree: PrdTree, sourceTree: PrdTree | undefined, selectedNodeId: string | null): FlowEdge[] {
  const fullTree = sourceTree ?? tree
  const edges: FlowEdge[] = []
  const referenceRows: Array<{
    item: PositionedNode
    source: PrdNode
    target: PositionedNode
    reference: NonNullable<PrdNode['references']>[number]
  }> = []

  for (const item of layout.nodes) {
    const parentId = item.node.parentId
    if (!parentId) continue
    const parent = layout.byId.get(parentId)
    if (!parent) continue
    const geometry = connectorGeometry(parent, item)
    const base = { fromId: parent.node.id, toId: item.node.id }
    edges.push({
      id: `primary-${parent.node.id}-${item.node.id}`,
      kind: 'primary',
      ...base,
      ...geometry,
      label: primaryEdgeLabel(parent.node, item.node),
      selected: isEdgeSelected(base, selectedNodeId),
    })
  }

  for (const item of layout.nodes) {
    const source = fullTree[item.node.id]
    if (!source?.references?.length) continue

    for (const reference of source.references) {
      if (!reference.targetNodeId || reference.targetNodeId === source.id) continue
      const target = layout.byId.get(reference.targetNodeId)
      if (!target) continue
      referenceRows.push({ item, source, target, reference })
    }
  }

  const outgoingCounts = new Map<string, number>()
  const incomingCounts = new Map<string, number>()
  for (const row of referenceRows) {
    outgoingCounts.set(row.source.id, (outgoingCounts.get(row.source.id) ?? 0) + 1)
    incomingCounts.set(row.target.node.id, (incomingCounts.get(row.target.node.id) ?? 0) + 1)
  }

  const outgoingSeen = new Map<string, number>()
  const incomingSeen = new Map<string, number>()
  for (const row of referenceRows) {
    const outgoingIndex = outgoingSeen.get(row.source.id) ?? 0
    const incomingIndex = incomingSeen.get(row.target.node.id) ?? 0
    outgoingSeen.set(row.source.id, outgoingIndex + 1)
    incomingSeen.set(row.target.node.id, incomingIndex + 1)

    const geometry = referenceGeometry(row.item, row.target, {
      outgoingIndex,
      outgoingCount: outgoingCounts.get(row.source.id) ?? 1,
      incomingIndex,
      incomingCount: incomingCounts.get(row.target.node.id) ?? 1,
    })
    const base = { fromId: row.source.id, toId: row.target.node.id }
    edges.push({
      id: `reference-${row.source.id}-${row.reference.targetNodeId}-${row.reference.label}`,
      kind: 'reference',
      ...base,
      ...geometry,
      label: row.reference.label || '跨页面跳转',
      note: row.reference.reason,
      selected: isEdgeSelected(base, selectedNodeId),
    })
  }

  return avoidEdgeLabelOverlaps(edges, layout)
}

function addNodeConnectorPath(root: PositionedNode, addSlot: { x: number; y: number; width: number; height: number }) {
  const sx = root.x + root.width / 2
  const sy = root.y + root.height
  const ex = addSlot.x + addSlot.width / 2
  const ey = addSlot.y
  const midY = sy + Math.max(18, (ey - sy) / 2)
  return `M ${sx} ${sy} C ${sx} ${midY}, ${ex} ${midY}, ${ex} ${ey}`
}

export function TreeCanvas({
  tree,
  sourceTree,
  layoutMode = 'tree',
  selectedNodeId,
  canvasNodePositions = {},
  previewHtmlByNodeId = {},
  connectableNodeIds,
  connectionDraft,
  onNodeClick,
  onNodeDoubleClick,
  onAddNode,
  onStartConnection,
  onCompleteConnection,
  onNodePositionCommit,
  onCancelConnection,
  onOpenConnection,
  onEditReference,
}: TreeCanvasProps) {
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const nodeDragRef = useRef<NodeDragState | null>(null)
  const suppressNodeClickRef = useRef<{ nodeId: string; until: number } | null>(null)
  const didInitialFitRef = useRef(false)
  const [scaleLabel, setScaleLabel] = useState(1)

  const focusNodeId = connectionDraft?.nodeId ?? selectedNodeId
  const connectableNodeSet = useMemo(() => new Set(connectableNodeIds), [connectableNodeIds])
  const previewNodeIds = useMemo(() => (
    new Set(Object.entries(previewHtmlByNodeId).filter(([, html]) => Boolean(html)).map(([nodeId]) => nodeId))
  ), [previewHtmlByNodeId])
  const generatedLayout = useMemo(() => (
    layoutMode === 'free'
      ? buildFreeLayout(tree, sourceTree, null, previewNodeIds)
      : buildTreeLayout(tree, focusNodeId, previewNodeIds)
  ), [focusNodeId, layoutMode, previewNodeIds, sourceTree, tree])
  const layout = useMemo(() => (
    layoutMode === 'free' ? applyManualPositions(generatedLayout, canvasNodePositions) : generatedLayout
  ), [canvasNodePositions, generatedLayout, layoutMode])
  const addSlot = useMemo<AddNodeSlot | null>(() => {
    if (!onAddNode) return null
    if (layoutMode === 'free') {
      const occupiedRects = generatedLayout.nodes.map((item) => positionedNodeRect(item, 36))
      for (let row = 0; row < 12; row += 1) {
        for (let col = 0; col < 6; col += 1) {
          const x = PADDING_X + col * 460 + (row % 2 === 1 ? 70 : 0)
          const y = PADDING_TOP + 28 + row * 320
          const candidate = positionedNodeRect({ x, y, width: ADD_SLOT_WIDTH, height: ADD_SLOT_HEIGHT }, 18)
          if (!occupiedRects.some((rect) => rectsOverlap(candidate, rect))) {
            return {
              parent: null,
              x,
              y,
              width: ADD_SLOT_WIDTH,
              height: ADD_SLOT_HEIGHT,
              d: null,
            }
          }
        }
      }

      return {
        parent: null,
        x: generatedLayout.contentWidth + 32,
        y: PADDING_TOP + 28,
        width: ADD_SLOT_WIDTH,
        height: ADD_SLOT_HEIGHT,
        d: null,
      }
    }

    const root = layout.nodes.find((item) => item.depth === 0) ?? null
    if (!root) return null
    const width = ADD_SLOT_WIDTH
    const height = ADD_SLOT_HEIGHT
    const x = root.x + root.width / 2 - width / 2
    const y = root.y + root.height + 36
    return {
      parent: root,
      x,
      y,
      width,
      height,
      d: addNodeConnectorPath(root, {
        x,
        y,
        width,
        height,
      }),
    }
  }, [generatedLayout, layoutMode, onAddNode])
  const baseContentHeight = addSlot
    ? Math.max(layout.contentHeight, addSlot.y + addSlot.height + PADDING_BOTTOM)
    : layout.contentHeight
  const flowEdges = useMemo(() => buildFlowEdges(layout, tree, sourceTree, focusNodeId), [focusNodeId, layout, sourceTree, tree])
  const labelBounds = flowEdges.reduce((bounds, edge) => {
    const rect = edgeLabelRect(edge)
    return {
      right: Math.max(bounds.right, rect.right),
      bottom: Math.max(bounds.bottom, rect.bottom),
    }
  }, { right: layout.contentWidth, bottom: baseContentHeight })
  const contentWidth = Math.max(
    labelBounds.right + PADDING_X,
    layout.contentWidth,
    addSlot ? addSlot.x + addSlot.width + PADDING_X : 0,
  )
  const contentHeight = Math.max(baseContentHeight, labelBounds.bottom + PADDING_BOTTOM)
  const selectedPosition = selectedNodeId ? layout.byId.get(selectedNodeId) ?? null : null
  const isConnecting = Boolean(connectionDraft)

  function isValidConnectionTarget(nodeId: string) {
    if (!connectionDraft || nodeId === connectionDraft.nodeId) return false
    return connectableNodeSet.size === 0 || connectableNodeSet.has(nodeId)
  }

  function handleCanvasNodeClick(nodeId: string) {
    if (connectionDraft) {
      if (isValidConnectionTarget(nodeId)) onCompleteConnection?.(nodeId)
      return
    }
    onNodeClick(nodeId)
  }

  function handleCanvasNodeDoubleClick(nodeId: string) {
    if (connectionDraft) return
    onNodeDoubleClick(nodeId)
  }

  function handleStartConnection(nodeId: string, direction: ConnectionDirection) {
    if (onStartConnection) {
      onStartConnection(nodeId, direction)
      return
    }
    onOpenConnection?.(nodeId, direction)
  }

  function blockedRectsForNode(nodeId: string) {
    return [
      ...layout.nodes
        .filter((item) => item.node.id !== nodeId)
        .map((item) => positionedNodeRect(item, NODE_DROP_GAP)),
      ...(addSlot ? [positionedNodeRect(addSlot, NODE_DROP_GAP)] : []),
    ]
  }

  function canDropNodeAt(nodeId: string, x: number, y: number) {
    const current = layout.byId.get(nodeId)
    if (!current) return false
    const candidate = positionedNodeRect({ x, y, width: current.width, height: current.height }, NODE_DROP_GAP)
    if (candidate.left < 0 || candidate.top < 56) return false
    return !blockedRectsForNode(nodeId).some((rect) => rectsOverlap(candidate, rect))
  }

  function clampDropPosition(x: number, y: number) {
    return {
      x: Math.max(0, x),
      y: Math.max(56, y),
    }
  }

  function resolveNodeDropPosition(nodeId: string, x: number, y: number) {
    const current = layout.byId.get(nodeId)
    if (!current) return clampDropPosition(x, y)

    const desired = clampDropPosition(x, y)
    if (canDropNodeAt(nodeId, desired.x, desired.y)) return desired

    const desiredRect = positionedNodeRect(
      { x: desired.x, y: desired.y, width: current.width, height: current.height },
      NODE_DROP_GAP,
    )
    const sideCandidates = blockedRectsForNode(nodeId)
      .filter((rect) => rectsOverlap(desiredRect, rect))
      .flatMap((rect) => [
        { x: rect.right + NODE_DROP_GAP, y: desired.y },
        { x: rect.left - current.width - NODE_DROP_GAP, y: desired.y },
        { x: desired.x, y: rect.bottom + NODE_DROP_GAP },
        { x: desired.x, y: rect.top - current.height - NODE_DROP_GAP },
        { x: rect.right + NODE_DROP_GAP, y: rect.bottom + NODE_DROP_GAP },
        { x: rect.left - current.width - NODE_DROP_GAP, y: rect.bottom + NODE_DROP_GAP },
        { x: rect.right + NODE_DROP_GAP, y: rect.top - current.height - NODE_DROP_GAP },
        { x: rect.left - current.width - NODE_DROP_GAP, y: rect.top - current.height - NODE_DROP_GAP },
      ])
      .map((position) => clampDropPosition(position.x, position.y))
      .sort((a, b) => (
        Math.hypot(a.x - desired.x, a.y - desired.y) - Math.hypot(b.x - desired.x, b.y - desired.y)
      ))

    const seen = new Set<string>()
    for (const position of sideCandidates) {
      const key = `${Math.round(position.x)}:${Math.round(position.y)}`
      if (seen.has(key)) continue
      seen.add(key)
      if (canDropNodeAt(nodeId, position.x, position.y)) return position
    }

    for (let radius = NODE_DROP_SEARCH_STEP; radius <= NODE_DROP_SEARCH_RADIUS; radius += NODE_DROP_SEARCH_STEP) {
      const segments = Math.max(8, Math.ceil((Math.PI * 2 * radius) / NODE_DROP_SEARCH_STEP))
      for (let index = 0; index < segments; index += 1) {
        const angle = (Math.PI * 2 * index) / segments
        const position = clampDropPosition(
          desired.x + Math.cos(angle) * radius,
          desired.y + Math.sin(angle) * radius,
        )
        if (canDropNodeAt(nodeId, position.x, position.y)) return position
      }
    }

    return canDropNodeAt(nodeId, current.x, current.y) ? { x: current.x, y: current.y } : desired
  }

  function handleNodePointerDown(e: PointerEvent<HTMLDivElement>, item: PositionedNode) {
    if (layoutMode !== 'free' || connectionDraft) return
    const target = e.target as HTMLElement
    if (target.closest('button, input, textarea, select, a')) return

    e.preventDefault()
    window.getSelection()?.removeAllRanges()
    stopWindowNodeDragListeners()
    nodeDragRef.current = {
      nodeId: item.node.id,
      pointerId: e.pointerId,
      element: e.currentTarget,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: item.x,
      originY: item.y,
      currentX: item.x,
      currentY: item.y,
      moved: false,
    }
    window.addEventListener('pointermove', handleWindowNodePointerMove)
    window.addEventListener('pointerup', handleWindowNodePointerEnd)
    window.addEventListener('pointercancel', handleWindowNodePointerEnd)
  }

  function stopWindowNodeDragListeners() {
    window.removeEventListener('pointermove', handleWindowNodePointerMove)
    window.removeEventListener('pointerup', handleWindowNodePointerEnd)
    window.removeEventListener('pointercancel', handleWindowNodePointerEnd)
  }

  function handleWindowNodePointerMove(e: globalThis.PointerEvent) {
    const drag = nodeDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return

    const dx = e.clientX - drag.startClientX
    const dy = e.clientY - drag.startClientY
    if (!drag.moved && Math.hypot(dx, dy) < NODE_DRAG_THRESHOLD) return

    if (!drag.moved) {
      drag.moved = true
    }
    e.preventDefault()
    const scale = transformRef.current.scale || 1
    const nextPosition = clampDropPosition(drag.originX + dx / scale, drag.originY + dy / scale)

    drag.currentX = nextPosition.x
    drag.currentY = nextPosition.y
    drag.element.style.left = `${nextPosition.x}px`
    drag.element.style.top = `${nextPosition.y}px`
    drag.element.style.zIndex = '40'
    drag.element.style.willChange = 'left, top'
  }

  function handleWindowNodePointerEnd(e: globalThis.PointerEvent) {
    const drag = nodeDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return

    if (drag.moved) {
      const settledPosition = resolveNodeDropPosition(drag.nodeId, drag.currentX, drag.currentY)
      drag.currentX = settledPosition.x
      drag.currentY = settledPosition.y
      drag.element.style.left = `${settledPosition.x}px`
      drag.element.style.top = `${settledPosition.y}px`
      suppressNodeClickRef.current = { nodeId: drag.nodeId, until: Date.now() + 350 }
      onNodePositionCommit?.(drag.nodeId, settledPosition)
      drag.element.style.zIndex = ''
      drag.element.style.willChange = ''
      e.preventDefault()
    }
    nodeDragRef.current = null
    stopWindowNodeDragListeners()
  }

  function handleNodeClickCapture(e: MouseEvent<HTMLDivElement>, nodeId: string) {
    const suppress = suppressNodeClickRef.current
    if (!suppress || suppress.nodeId !== nodeId || suppress.until < Date.now()) return
    suppressNodeClickRef.current = null
    e.preventDefault()
    e.stopPropagation()
  }

  function applyTransform(nextTransform = transformRef.current) {
    transformRef.current = nextTransform
    setScaleLabel(nextTransform.scale)

    if (!innerRef.current) return
    const { scale, tx, ty } = nextTransform
    innerRef.current.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
    innerRef.current.style.transformOrigin = '0 0'
  }

  function zoomAt(nextScale: number, anchorX?: number, anchorY?: number) {
    const viewport = viewportRef.current
    if (!viewport) return

    const clampedScale = clampScale(nextScale)
    const current = transformRef.current
    if (clampedScale === current.scale) return

    const viewportRect = viewport.getBoundingClientRect()
    const screenX = anchorX ?? viewportRect.left + viewportRect.width / 2
    const screenY = anchorY ?? viewportRect.top + viewportRect.height / 2
    const localX = screenX - viewportRect.left
    const localY = screenY - viewportRect.top
    const contentX = (localX - current.tx) / current.scale
    const contentY = (localY - current.ty) / current.scale

    applyTransform({
      scale: clampedScale,
      tx: localX - contentX * clampedScale,
      ty: localY - contentY * clampedScale,
    })
  }

  function handleZoomIn() {
    zoomAt(transformRef.current.scale + ZOOM_STEP)
  }

  function handleZoomOut() {
    zoomAt(transformRef.current.scale - ZOOM_STEP)
  }

  function handleFitScreen() {
    const viewport = viewportRef.current
    if (!viewport) {
      applyTransform({ scale: 1, tx: 0, ty: 0 })
      return
    }

    const scale = clampScale(Math.min(
      1,
      (viewport.clientWidth - 56) / contentWidth,
      (viewport.clientHeight - 56) / contentHeight,
    ))
    applyTransform({ scale, tx: 28, ty: 28 })
  }

  useEffect(() => {
    if (didInitialFitRef.current || layout.nodes.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      didInitialFitRef.current = true
      handleFitScreen()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [contentWidth, contentHeight, layout.nodes.length])

  function handleWheel(e: WheelEvent<HTMLDivElement>) {
    e.preventDefault()
    const direction = e.deltaY > 0 ? -1 : 1
    zoomAt(transformRef.current.scale + direction * ZOOM_STEP, e.clientX, e.clientY)
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('[data-node-card]')) return
    if ((e.target as HTMLElement).closest('button')) return
    if (connectionDraft) {
      onCancelConnection?.()
      return
    }
    dragStartRef.current = {
      x: e.clientX - transformRef.current.tx,
      y: e.clientY - transformRef.current.ty,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return
    applyTransform({
      ...transformRef.current,
      tx: e.clientX - dragStartRef.current.x,
      ty: e.clientY - dragStartRef.current.y,
    })
  }

  function onPointerUp() {
    dragStartRef.current = null
  }

  return (
    <div
      ref={viewportRef}
      className={`relative flex-1 overflow-hidden blueprint-grid ${isConnecting ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
      onWheel={handleWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div className="pointer-events-none absolute left-lg top-lg z-10 max-w-[360px] rounded-lg border border-outline-variant bg-surface-container/90 px-md py-sm shadow-lg backdrop-blur">
        <div className="flex items-center gap-sm text-primary">
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>route</span>
          <span className="font-headline-sm text-headline-sm">流程视图</span>
        </div>
        <p className="mt-xs text-body-sm leading-relaxed text-on-surface-variant">
          箭头表示页面进入、流程展开和跨页面引用；选中节点后会高亮它的上下游路径。
        </p>
      </div>

      {connectionDraft ? (
        <div className="absolute left-1/2 top-lg z-40 flex -translate-x-1/2 items-center gap-sm rounded-lg border border-tertiary/60 bg-surface-container-high/95 px-md py-sm text-body-sm text-on-surface shadow-xl backdrop-blur">
          <span className="material-symbols-outlined text-tertiary" style={{ fontSize: '18px' }}>conversion_path</span>
          <span>
            {connectionDraft.direction === 'outgoing' ? '选择要连接出去的目标界面' : '选择流入当前界面的来源'}
          </span>
          <button
            type="button"
            onClick={onCancelConnection}
            className="rounded border border-outline-variant px-sm py-xs text-label-md text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
          >
            取消
          </button>
        </div>
      ) : null}

      <div className="absolute right-lg bottom-lg z-10 flex gap-xs rounded-lg border border-outline-variant bg-surface-container p-xs shadow-lg">
        <button
          onClick={handleZoomOut}
          disabled={scaleLabel <= MIN_SCALE}
          title="缩小"
          className="rounded p-sm text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="material-symbols-outlined">zoom_out</span>
        </button>
        <button
          onClick={handleFitScreen}
          title="适配视图"
          className="rounded p-sm text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
        >
          <span className="material-symbols-outlined">fit_screen</span>
        </button>
        <button
          onClick={handleZoomIn}
          disabled={scaleLabel >= MAX_SCALE}
          title="放大"
          className="rounded p-sm text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="material-symbols-outlined">zoom_in</span>
        </button>
      </div>

      <div
        ref={innerRef}
        className="relative"
        style={{
          width: contentWidth,
          height: contentHeight,
          minWidth: contentWidth,
          transform: 'translate(0px, 0px) scale(1)',
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {layout.layers.map((layer) => (
          <div
            key={layer.depth}
            className="absolute top-9 flex items-center gap-xs font-mono text-[10px] uppercase text-on-surface-variant/70"
            style={{ left: layer.x, width: layer.width }}
          >
            <span className="h-px flex-1 bg-outline-variant/30" />
            <span>{layer.label}</span>
            <span className="h-px flex-1 bg-outline-variant/30" />
          </div>
        ))}

        <svg
          className="pointer-events-none absolute left-0 top-0"
          style={{ width: contentWidth, height: contentHeight, overflow: 'visible', zIndex: 0 }}
        >
          <defs>
            <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#919095" />
            </marker>
            <marker id="flow-arrow-selected" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#4edea3" />
            </marker>
          </defs>

          {flowEdges.map((edge, index) => (
            <path
              key={edge.id}
              data-flow-edge-path={`${edge.fromId}->${edge.toId}`}
              data-flow-edge-kind={edge.kind}
              d={edge.d}
              fill="none"
              markerEnd={edge.selected ? 'url(#flow-arrow-selected)' : 'url(#flow-arrow)'}
              pathLength={1}
              stroke={edge.selected ? '#4edea3' : edge.kind === 'reference' ? '#adc6ff' : '#919095'}
              strokeOpacity={focusNodeId && !edge.selected ? 0.22 : 1}
              strokeDasharray={edge.kind === 'reference' ? '8 8' : undefined}
              strokeLinecap="round"
              strokeWidth={edge.selected ? 3 : 2}
              vectorEffect="non-scaling-stroke"
              style={{ animationDelay: `${Math.min(index * 45, 420)}ms` }}
            />
          ))}

          {addSlot?.d && (
            <path
              d={addSlot.d}
              className="svg-line"
              pathLength={1}
              style={{ animationDelay: '180ms' }}
            />
          )}

        </svg>

        {flowEdges.map((edge) => {
          const className = [
            'absolute z-20 flex max-w-[164px] flex-col items-center justify-center rounded border px-xs py-[3px] text-center font-label-md text-[10px] leading-tight shadow-sm backdrop-blur',
            edge.selected
              ? 'border-tertiary bg-tertiary-container/90 text-tertiary'
              : edge.kind === 'reference'
                ? 'border-secondary/50 bg-secondary-container/30 text-secondary'
                : 'border-outline-variant bg-surface-container-high/90 text-on-surface-variant',
          ].join(' ')
          const style = { left: edge.labelX - 20, top: edge.labelY - (edge.note ? 8 : 0), width: 164 }

          if (edge.kind === 'reference') {
            return (
              <button
                key={`${edge.id}-label`}
                type="button"
                data-flow-edge-label={`${edge.fromId}->${edge.toId}`}
                onClick={() => onEditReference?.(edge.fromId, edge.toId)}
                className={`${className} transition-colors hover:border-primary hover:text-primary`}
                style={style}
                title={[edge.label, edge.note].filter(Boolean).join('\n')}
              >
                <span className="line-clamp-1 max-w-full">{edge.label}</span>
                {edge.note ? <span className="line-clamp-1 max-w-full opacity-75">{edge.note}</span> : null}
              </button>
            )
          }

          return (
            <div key={`${edge.id}-label`} className={className} style={style}>
              <span className="line-clamp-1 max-w-full">{edge.label}</span>
            </div>
          )
        })}

        {layout.nodes.map((item) => {
          const isConnectionSource = connectionDraft?.nodeId === item.node.id
          const isConnectionTarget = isValidConnectionTarget(item.node.id)
          return (
            <div
              key={item.node.id}
              data-node-card="true"
              data-node-id={item.node.id}
              data-connection-target={isConnectionTarget ? item.node.id : undefined}
              draggable={false}
              onClickCapture={(event) => handleNodeClickCapture(event, item.node.id)}
              onPointerDown={(event) => handleNodePointerDown(event, item)}
              className={[
                'absolute z-10 select-none rounded-lg transition-[box-shadow,outline,transform,opacity]',
                layoutMode === 'free' && !connectionDraft ? 'cursor-move' : '',
                isConnectionTarget ? 'outline outline-2 outline-tertiary/70 hover:-translate-y-0.5 hover:shadow-[0_0_0_4px_rgba(78,222,163,0.18)]' : '',
                isConnectionSource ? 'outline outline-2 outline-primary shadow-[0_0_0_4px_rgba(43,136,255,0.16)]' : '',
                connectionDraft && !isConnectionSource && !isConnectionTarget ? 'opacity-45' : '',
              ].join(' ')}
              style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
            >
              <NodeCard
                node={item.node}
                tree={sourceTree ?? tree}
                isSelected={item.node.id === selectedNodeId}
                previewHtml={previewHtmlByNodeId[item.node.id] ?? null}
                onNodeClick={handleCanvasNodeClick}
                onNodeDoubleClick={handleCanvasNodeDoubleClick}
              />
            </div>
          )
        })}

        {selectedPosition
        && !connectionDraft
        && (connectableNodeSet.size === 0 || connectableNodeSet.has(selectedPosition.node.id))
        && (onStartConnection || onOpenConnection) ? (
          <>
            <button
              type="button"
              onClick={() => handleStartConnection(selectedPosition.node.id, 'incoming')}
              className="absolute z-30 flex h-9 w-9 items-center justify-center rounded-full border border-secondary/60 bg-secondary-container text-on-secondary-container shadow-lg transition-transform hover:scale-105 hover:border-secondary"
              style={{ left: selectedPosition.x - 48, top: selectedPosition.y + selectedPosition.height / 2 - 18 }}
              title="连接流入界面"
              aria-label="连接流入界面"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>add</span>
            </button>
            <button
              type="button"
              onClick={() => handleStartConnection(selectedPosition.node.id, 'outgoing')}
              className="absolute z-30 flex h-9 w-9 items-center justify-center rounded-full border border-tertiary/60 bg-tertiary-container text-tertiary shadow-lg transition-transform hover:scale-105 hover:border-tertiary"
              style={{ left: selectedPosition.x + selectedPosition.width + 10, top: selectedPosition.y + selectedPosition.height / 2 - 18 }}
              title="连接流出界面"
              aria-label="连接流出界面"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>add</span>
            </button>
          </>
        ) : null}

        {addSlot && (
          <button
            type="button"
            data-add-interface-node="true"
            onClick={() => onAddNode?.(addSlot.parent?.node.id ?? null)}
            title="新增页面节点"
            aria-label="新增页面节点"
            className="group absolute z-20 flex items-center gap-sm rounded-lg border border-dashed border-primary/70 bg-surface-container-high/95 p-sm text-left shadow-lg transition-all hover:-translate-y-0.5 hover:border-primary hover:bg-primary-container/30 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-primary/50"
            style={{ left: addSlot.x, top: addSlot.y, width: addSlot.width, height: addSlot.height }}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-primary/50 bg-primary-container text-primary transition-colors group-hover:bg-primary group-hover:text-on-primary">
              <span className="material-symbols-outlined" style={{ fontSize: '30px' }}>add</span>
            </span>
            <span className="min-w-0">
              <span className="block font-label-md text-label-md text-on-surface">新增界面节点</span>
              <span className="mt-xs block text-body-sm leading-snug text-on-surface-variant">
                上传资料，补齐 View / Flow / Data
              </span>
            </span>
            <span className="absolute right-sm top-sm rounded border border-primary/30 bg-primary-container/40 px-xs py-[1px] font-mono text-[10px] uppercase text-primary">
              new
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
