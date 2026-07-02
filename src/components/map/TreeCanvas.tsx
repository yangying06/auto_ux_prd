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
const FREE_CANVAS_BASE_EXTENT = 12000
const FREE_CANVAS_SAFE_MARGIN = 1600
const FREE_CANVAS_MIN_WIDTH = 2600
const FREE_CANVAS_MIN_HEIGHT = 1800
const FREE_DRAG_AUTOPAN_EDGE = 72
const FREE_DRAG_AUTOPAN_MAX_STEP = 28

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
  fitRequest?: number
  connectableNodeIds?: string[]
  connectionDraft?: CanvasConnectionDraft | null
  onNodeClick: (id: string) => void
  onNodeDoubleClick: (id: string) => void
  onCanvasBlankClick?: () => void
  onOpenStatePreview?: (nodeId: string) => void
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

interface CanvasMetrics {
  contentWidth: number
  contentHeight: number
  renderOffsetX: number
  renderOffsetY: number
  fitBounds: Rect
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
  fromLabel: string
  toLabel: string
  startX: number
  startY: number
  endX: number
  endY: number
  d: string
  label: string
  labelX: number
  labelY: number
  selected: boolean
  note?: string | null
  referenceCount?: number
}

interface DirectedReferenceEdge {
  fromId: string
  toId: string
}

interface FreeComponentPlan {
  width: number
  height: number
  gapAfterX: number
  place: (originX: number, originY: number) => PositionedNode[]
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

function hasVisualPreview(node: PrdNode, previewHtmlByNodeId: Record<string, string>) {
  return Boolean(previewHtmlByNodeId[node.id])
    || Boolean(node.figmaPreviews?.some((preview) => preview.imageUrl))
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

function buildReferenceEdges(nodes: PrdNode[], fullTree: PrdTree): DirectedReferenceEdge[] {
  const visibleIds = new Set(nodes.map((node) => node.id))
  const seen = new Set<string>()
  const edges: DirectedReferenceEdge[] = []

  for (const node of nodes) {
    const source = fullTree[node.id] ?? node
    for (const reference of source.references ?? []) {
      const targetNodeId = reference.targetNodeId
      if (!targetNodeId || targetNodeId === source.id || !visibleIds.has(targetNodeId)) continue
      const key = `${source.id}->${targetNodeId}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ fromId: source.id, toId: targetNodeId })
    }
  }

  return edges
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

function freeLineCorridorGap(nodeWidth: number) {
  return nodeWidth
}

function freeLooseNodeGap(nodeWidth: number) {
  return nodeWidth / 2
}

function hasReachablePath(adjacency: Map<string, Set<string>>, fromId: string, toId: string) {
  const visited = new Set<string>()
  const queue = [fromId]

  while (queue.length) {
    const nodeId = queue.shift()!
    if (nodeId === toId) return true
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    for (const nextId of adjacency.get(nodeId) ?? []) queue.push(nextId)
  }

  return false
}

function buildAcyclicReferenceBackbone(component: PrdNode[], edges: DirectedReferenceEdge[]) {
  const nodeById = new Map(component.map((node) => [node.id, node]))
  const forward = new Map(component.map((node) => [node.id, new Set<string>()]))
  const sortedEdges = [...edges].sort((a, b) => {
    const sourceA = nodeById.get(a.fromId)
    const sourceB = nodeById.get(b.fromId)
    const targetA = nodeById.get(a.toId)
    const targetB = nodeById.get(b.toId)
    if (sourceA && sourceB) {
      const sourceOrder = sortByOrder(sourceA, sourceB)
      if (sourceOrder !== 0) return sourceOrder
    }
    if (targetA && targetB) {
      const targetOrder = sortByOrder(targetA, targetB)
      if (targetOrder !== 0) return targetOrder
    }
    return `${a.fromId}->${a.toId}`.localeCompare(`${b.fromId}->${b.toId}`)
  })
  const backbone: DirectedReferenceEdge[] = []

  for (const edge of sortedEdges) {
    if (hasReachablePath(forward, edge.toId, edge.fromId)) continue
    forward.get(edge.fromId)?.add(edge.toId)
    backbone.push(edge)
  }

  return backbone
}

function rankLayeredComponent(
  component: PrdNode[],
  edges: DirectedReferenceEdge[],
  adjacency: Map<string, Set<string>>,
  focusNodeId?: string | null,
) {
  const nodeById = new Map(component.map((node) => [node.id, node]))
  const incomingCount = new Map(component.map((node) => [node.id, 0]))
  const outgoing = new Map(component.map((node) => [node.id, [] as string[]]))
  const ranks = new Map(component.map((node) => [node.id, 0]))

  for (const edge of edges) {
    if (!nodeById.has(edge.fromId) || !nodeById.has(edge.toId)) continue
    incomingCount.set(edge.toId, (incomingCount.get(edge.toId) ?? 0) + 1)
    outgoing.get(edge.fromId)?.push(edge.toId)
  }

  const compare = freeNodeSort(adjacency, focusNodeId)
  const queue = component.filter((node) => (incomingCount.get(node.id) ?? 0) === 0).sort(compare)
  const visited = new Set<string>()

  while (queue.length) {
    const node = queue.shift()!
    if (visited.has(node.id)) continue
    visited.add(node.id)

    for (const targetId of outgoing.get(node.id) ?? []) {
      ranks.set(targetId, Math.max(ranks.get(targetId) ?? 0, (ranks.get(node.id) ?? 0) + 1))
      const nextIncoming = (incomingCount.get(targetId) ?? 0) - 1
      incomingCount.set(targetId, nextIncoming)
      if (nextIncoming === 0) {
        const targetNode = nodeById.get(targetId)
        if (targetNode) {
          queue.push(targetNode)
          queue.sort(compare)
        }
      }
    }
  }

  for (const node of [...component].sort(compare)) {
    if (visited.has(node.id)) continue
    const predecessorRanks = edges
      .filter((edge) => edge.toId === node.id && visited.has(edge.fromId))
      .map((edge) => ranks.get(edge.fromId) ?? 0)
    ranks.set(node.id, predecessorRanks.length ? Math.max(...predecessorRanks) + 1 : 0)
  }

  return ranks
}

function groupNodesByRank(component: PrdNode[], ranks: Map<string, number>) {
  const groups = new Map<number, PrdNode[]>()
  for (const node of component) {
    const rank = ranks.get(node.id) ?? 0
    const group = groups.get(rank) ?? []
    group.push(node)
    groups.set(rank, group)
  }
  return groups
}

function freeRankFallbackSort(
  adjacency: Map<string, Set<string>>,
  focusNodeId?: string | null,
) {
  return (a: PrdNode, b: PrdNode) => (
    (b.id === focusNodeId ? 1 : 0) - (a.id === focusNodeId ? 1 : 0)
    || (adjacency.get(b.id)?.size ?? 0) - (adjacency.get(a.id)?.size ?? 0)
    || sortByOrder(a, b)
  )
}

function buildRankOrderIndex(groups: Map<number, PrdNode[]>) {
  const index = new Map<string, number>()
  for (const nodes of groups.values()) {
    nodes.forEach((node, order) => index.set(node.id, order))
  }
  return index
}

function averageNeighborOrder(nodeId: string, edges: DirectedReferenceEdge[], orderIndex: Map<string, number>, direction: 'incoming' | 'outgoing') {
  const neighborOrders = edges
    .map((edge) => {
      if (direction === 'incoming' && edge.toId === nodeId) return orderIndex.get(edge.fromId)
      if (direction === 'outgoing' && edge.fromId === nodeId) return orderIndex.get(edge.toId)
      return undefined
    })
    .filter((value): value is number => typeof value === 'number')

  if (neighborOrders.length === 0) return Number.POSITIVE_INFINITY
  return neighborOrders.reduce((sum, value) => sum + value, 0) / neighborOrders.length
}

function abstractSegmentCcw(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x)
}

function abstractSegmentsIntersect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
) {
  return (
    abstractSegmentCcw(a, c, d) !== abstractSegmentCcw(b, c, d)
    && abstractSegmentCcw(a, b, c) !== abstractSegmentCcw(a, b, d)
  )
}

function countLayerCrossings(groups: Map<number, PrdNode[]>, edges: DirectedReferenceEdge[]) {
  const rankKeys = [...groups.keys()].sort((a, b) => a - b)
  const positions = new Map<string, { x: number; y: number }>()

  rankKeys.forEach((rank, rankIndex) => {
    const nodes = groups.get(rank) ?? []
    nodes.forEach((node, nodeIndex) => {
      positions.set(node.id, {
        x: rankIndex,
        y: nodeIndex - (nodes.length - 1) / 2,
      })
    })
  })

  let count = 0
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const first = edges[i]
      const second = edges[j]
      if (new Set([first.fromId, first.toId, second.fromId, second.toId]).size < 4) continue

      const a = positions.get(first.fromId)
      const b = positions.get(first.toId)
      const c = positions.get(second.fromId)
      const d = positions.get(second.toId)
      if (a && b && c && d && abstractSegmentsIntersect(a, b, c, d)) count += 1
    }
  }

  return count
}

function factorial(value: number) {
  let result = 1
  for (let index = 2; index <= value; index += 1) result *= index
  return result
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  const result: T[][] = []

  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)]
    for (const tail of permutations(rest)) result.push([item, ...tail])
  })

  return result
}

function reduceSmallRankCrossings(groups: Map<number, PrdNode[]>, edges: DirectedReferenceEdge[]) {
  const rankKeys = [...groups.keys()].sort((a, b) => a - b)
  const permutationBudget = rankKeys.reduce((product, rank) => (
    product * factorial(groups.get(rank)?.length ?? 1)
  ), 1)
  if (permutationBudget > 2400) return false

  const rankPermutations = rankKeys.map((rank) => permutations(groups.get(rank) ?? []))
  const originalCrossings = countLayerCrossings(groups, edges)
  let bestCrossings = originalCrossings
  let bestGroups: Map<number, PrdNode[]> | null = null

  function visit(rankIndex: number, candidate: Map<number, PrdNode[]>) {
    if (rankIndex >= rankKeys.length) {
      const crossings = countLayerCrossings(candidate, edges)
      if (crossings < bestCrossings) {
        bestCrossings = crossings
        bestGroups = new Map([...candidate.entries()].map(([rank, nodes]) => [rank, [...nodes]]))
      }
      return
    }

    const rank = rankKeys[rankIndex]
    for (const nodes of rankPermutations[rankIndex]) {
      candidate.set(rank, nodes)
      visit(rankIndex + 1, candidate)
    }
  }

  visit(0, new Map())

  const winningGroups = bestGroups as Map<number, PrdNode[]> | null
  if (!winningGroups) return false
  for (const [rank, nodes] of winningGroups.entries()) groups.set(rank, nodes)
  return true
}

function reduceRankCrossings(groups: Map<number, PrdNode[]>, edges: DirectedReferenceEdge[]) {
  if (reduceSmallRankCrossings(groups, edges)) return

  const rankKeys = [...groups.keys()].sort((a, b) => a - b)
  for (let sweep = 0; sweep < 6; sweep += 1) {
    let improved = false

    for (const rank of rankKeys) {
      const nodes = groups.get(rank)
      if (!nodes || nodes.length < 2) continue

      for (let index = 0; index < nodes.length - 1; index += 1) {
        const currentNodes = groups.get(rank) ?? nodes
        const before = countLayerCrossings(groups, edges)
        const nextNodes = [...currentNodes]
        const temp = nextNodes[index]
        nextNodes[index] = nextNodes[index + 1]
        nextNodes[index + 1] = temp
        groups.set(rank, nextNodes)

        const after = countLayerCrossings(groups, edges)
        if (after < before) {
          improved = true
        } else {
          groups.set(rank, currentNodes)
        }
      }
    }

    if (!improved) break
  }
}

function orderLayeredRanks(
  component: PrdNode[],
  ranks: Map<string, number>,
  edges: DirectedReferenceEdge[],
  adjacency: Map<string, Set<string>>,
  focusNodeId?: string | null,
) {
  const groups = groupNodesByRank(component, ranks)
  const rankKeys = [...groups.keys()].sort((a, b) => a - b)
  const fallback = freeRankFallbackSort(adjacency, focusNodeId)

  for (const rank of rankKeys) {
    groups.get(rank)?.sort(fallback)
  }

  for (let sweep = 0; sweep < 4; sweep += 1) {
    let orderIndex = buildRankOrderIndex(groups)
    for (const rank of rankKeys) {
      groups.get(rank)?.sort((a, b) => (
        averageNeighborOrder(a.id, edges, orderIndex, 'incoming')
        - averageNeighborOrder(b.id, edges, orderIndex, 'incoming')
        || fallback(a, b)
      ))
    }

    orderIndex = buildRankOrderIndex(groups)
    for (const rank of [...rankKeys].reverse()) {
      groups.get(rank)?.sort((a, b) => (
        averageNeighborOrder(a.id, edges, orderIndex, 'outgoing')
        - averageNeighborOrder(b.id, edges, orderIndex, 'outgoing')
        || fallback(a, b)
      ))
    }
  }

  reduceRankCrossings(groups, edges)

  return rankKeys.map((rank) => groups.get(rank) ?? []).filter((group) => group.length > 0)
}

function buildGridComponentPlan(component: PrdNode[], previewNodeIds: Set<string>): FreeComponentPlan {
  const cols = freeComponentColumns(component.length)
  const rows = Math.ceil(component.length / cols)
  const componentSizes = component.map((node) => getCardSize(node, previewNodeIds.has(node.id)))
  const maxNodeWidth = componentSizes.reduce((max, size) => Math.max(max, size.width), DEFAULT_CARD_WIDTH)
  const maxNodeHeight = componentSizes.reduce((max, size) => Math.max(max, size.height), DEFAULT_CARD_HEIGHT)
  const looseGap = freeLooseNodeGap(maxNodeWidth)
  const colStep = maxNodeWidth + looseGap
  const rowStep = Math.max(FREE_NODE_Y_STEP, maxNodeHeight + looseGap)
  const width = (cols - 1) * colStep + maxNodeWidth + 72
  const height = (rows - 1) * rowStep + maxNodeHeight + 28

  return {
    width,
    height,
    gapAfterX: looseGap,
    place(originX, originY) {
      return component.map((node, index) => {
        const col = index % cols
        const row = Math.floor(index / cols)
        const size = getCardSize(node, previewNodeIds.has(node.id))
        const staggerX = row % 2 === 1 ? 72 : 0
        const staggerY = col % 2 === 1 ? 28 : 0
        return {
          node,
          x: originX + col * colStep + staggerX,
          y: originY + row * rowStep + staggerY,
          width: size.width,
          height: size.height,
          depth: 0,
        }
      })
    },
  }
}

function rankGapHasReferenceLine(edges: DirectedReferenceEdge[], rankIndexByNodeId: Map<string, number>, gapIndex: number) {
  return edges.some((edge) => {
    const fromRank = rankIndexByNodeId.get(edge.fromId)
    const toRank = rankIndexByNodeId.get(edge.toId)
    if (fromRank === undefined || toRank === undefined || fromRank === toRank) return false
    return Math.min(fromRank, toRank) <= gapIndex && Math.max(fromRank, toRank) > gapIndex
  })
}

function buildLayeredComponentPlan(
  component: PrdNode[],
  componentEdges: DirectedReferenceEdge[],
  adjacency: Map<string, Set<string>>,
  previewNodeIds: Set<string>,
  focusNodeId?: string | null,
): FreeComponentPlan | null {
  const backbone = buildAcyclicReferenceBackbone(component, componentEdges)
  if (backbone.length === 0) return null

  const ranks = rankLayeredComponent(component, backbone, adjacency, focusNodeId)
  const rankGroups = orderLayeredRanks(component, ranks, backbone, adjacency, focusNodeId)
  if (rankGroups.length <= 1 && component.length > 2) return null

  const rankHeights = rankGroups.map((group) => (
    group.reduce((sum, node) => (
      sum + getCardSize(node, previewNodeIds.has(node.id)).height
    ), 0)
  ))
  const maxNodeWidth = component.reduce((max, node) => Math.max(max, getCardSize(node, previewNodeIds.has(node.id)).width), DEFAULT_CARD_WIDTH)
  const looseGap = freeLooseNodeGap(maxNodeWidth)
  const rankNodeGap = looseGap
  const rankHeightsWithGaps = rankGroups.map((group, index) => (
    rankHeights[index] + Math.max(0, group.length - 1) * rankNodeGap
  ))
  const rankWidths = rankGroups.map((group) => (
    group.reduce((max, node) => Math.max(max, getCardSize(node, previewNodeIds.has(node.id)).width), DEFAULT_CARD_WIDTH)
  ))
  const rankIndexByNodeId = new Map<string, number>()
  rankGroups.forEach((group, rankIndex) => {
    group.forEach((node) => rankIndexByNodeId.set(node.id, rankIndex))
  })
  const rankGaps = rankGroups.slice(0, -1).map((_, gapIndex) => (
    rankGapHasReferenceLine(componentEdges, rankIndexByNodeId, gapIndex)
      ? freeLineCorridorGap(maxNodeWidth)
      : looseGap
  ))
  const rankXOffsets = rankGroups.map((_, rankIndex) => {
    if (rankIndex === 0) return 0
    return rankGroups.slice(0, rankIndex).reduce((sum, _group, index) => (
      sum + rankWidths[index] + rankGaps[index]
    ), 0)
  })
  const height = Math.max(DEFAULT_CARD_HEIGHT, ...rankHeightsWithGaps) + 28
  const width = rankXOffsets[rankXOffsets.length - 1] + rankWidths[rankWidths.length - 1] + 72

  return {
    width,
    height,
    gapAfterX: looseGap,
    place(originX, originY) {
      return rankGroups.flatMap((group, rankIndex) => {
        const rankHeight = rankHeightsWithGaps[rankIndex] ?? 0
        let cursorY = originY + (height - rankHeight) / 2
        return group.map((node) => {
          const size = getCardSize(node, previewNodeIds.has(node.id))
          const item = {
            node,
            x: originX + rankXOffsets[rankIndex],
            y: cursorY,
            width: size.width,
            height: size.height,
            depth: rankIndex,
          }
          cursorY += size.height + rankNodeGap
          return item
        })
      })
    },
  }
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
  const referenceEdges = buildReferenceEdges(nodes, fullTree)
  const components = collectFreeComponents(nodes, adjacency, focusNodeId)
  const positioned: PositionedNode[] = []
  const byId = new Map<string, PositionedNode>()

  let cursorX = PADDING_X
  let cursorY = PADDING_TOP + 28
  let rowHeight = 0
  let maxRight = cursorX
  let maxBottom = cursorY

  for (const component of components) {
    const componentIds = new Set(component.map((node) => node.id))
    const componentEdges = referenceEdges.filter((edge) => componentIds.has(edge.fromId) && componentIds.has(edge.toId))
    const plan = buildLayeredComponentPlan(component, componentEdges, adjacency, previewNodeIds, focusNodeId)
      ?? buildGridComponentPlan(component, previewNodeIds)

    if (cursorX > PADDING_X && cursorX + plan.width > PADDING_X + FREE_ROW_WIDTH) {
      cursorX = PADDING_X
      cursorY += rowHeight + FREE_COMPONENT_GAP_Y
      rowHeight = 0
    }

    for (const item of plan.place(cursorX, cursorY)) {
      positioned.push(item)
      byId.set(item.node.id, item)
      maxRight = Math.max(maxRight, item.x + item.width)
      maxBottom = Math.max(maxBottom, item.y + item.height)
    }

    cursorX += plan.width + Math.max(FREE_COMPONENT_GAP_X, plan.gapAfterX)
    rowHeight = Math.max(rowHeight, plan.height)
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
      x: Number.isFinite(manual.x) ? manual.x : item.x,
      y: Number.isFinite(manual.y) ? manual.y : item.y,
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
    startX: sx,
    startY: sy,
    endX: ex,
    endY: ey,
    labelX: midX - 62,
    labelY: (sy + ey) / 2 - 13,
  }
}

function referenceGeometry(
  source: PositionedNode,
  target: PositionedNode,
  laneOffset = 0,
) {
  const sourceCenterX = source.x + source.width / 2
  const targetCenterX = target.x + target.width / 2
  const sourceCenterY = source.y + source.height / 2
  const targetCenterY = target.y + target.height / 2
  const horizontalSpan = Math.abs(targetCenterX - sourceCenterX)
  const verticalSpan = Math.abs(targetCenterY - sourceCenterY)
  const isHorizontalDominant = horizontalSpan >= verticalSpan

  // Two directed edges between the same pair (A->B and B->A) are separated by a
  // constant perpendicular offset on the node edges, producing two close parallel lines.
  const laneGap = 10
  const sourceAnchorOffset = laneOffset * laneGap
  const targetAnchorOffset = laneOffset * laneGap

  let sx: number
  let sy: number
  let ex: number
  let ey: number

  if (isHorizontalDominant) {
    const direction = targetCenterX >= sourceCenterX ? 1 : -1
    sx = direction > 0 ? source.x + source.width : source.x
    sy = sourceCenterY + sourceAnchorOffset
    ex = direction > 0 ? target.x : target.x + target.width
    ey = targetCenterY + targetAnchorOffset
  } else {
    const direction = targetCenterY >= sourceCenterY ? 1 : -1
    sx = sourceCenterX + sourceAnchorOffset
    sy = direction > 0 ? source.y + source.height : source.y
    ex = targetCenterX + targetAnchorOffset
    ey = direction > 0 ? target.y : target.y + target.height
  }

  const spanX = Math.abs(ex - sx)
  const spanY = Math.abs(ey - sy)
  const controlGap = Math.max(72, (isHorizontalDominant ? spanX : spanY) / 2)

  let c1x: number
  let c1y: number
  let c2x: number
  let c2y: number

  if (isHorizontalDominant) {
    const sign = ex >= sx ? 1 : -1
    c1x = sx + sign * controlGap
    c2x = ex - sign * controlGap
    c1y = sy
    c2y = ey
  } else {
    const sign = ey >= sy ? 1 : -1
    c1x = sx
    c1y = sy + sign * controlGap
    c2x = ex
    c2y = ey - sign * controlGap
  }

  return {
    d: `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`,
    startX: sx,
    startY: sy,
    endX: ex,
    endY: ey,
    labelX: (c1x + c2x) / 2 - 62,
    labelY: (c1y + c2y) / 2 - 13 + (isHorizontalDominant ? laneOffset * 9 : 0),
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

function includeRect(bounds: Rect | null, rect: Rect): Rect {
  if (!bounds) return rect
  return {
    left: Math.min(bounds.left, rect.left),
    top: Math.min(bounds.top, rect.top),
    right: Math.max(bounds.right, rect.right),
    bottom: Math.max(bounds.bottom, rect.bottom),
  }
}

function fallbackRect(width: number, height: number): Rect {
  return {
    left: 0,
    top: 0,
    right: Math.max(1, width),
    bottom: Math.max(1, height),
  }
}

function buildGraphBounds(
  layout: LayoutResult,
  addSlot: AddNodeSlot | null,
  flowEdges: FlowEdge[],
  fallbackWidth: number,
  fallbackHeight: number,
  layoutMode: LayoutMode,
): Rect {
  let bounds: Rect | null = layoutMode === 'free' ? null : fallbackRect(fallbackWidth, fallbackHeight)

  for (const item of layout.nodes) {
    bounds = includeRect(bounds, positionedNodeRect(item))
  }

  if (addSlot) {
    bounds = includeRect(bounds, positionedNodeRect(addSlot))
  }

  for (const edge of flowEdges) {
    bounds = includeRect(bounds, edgeLabelRect(edge))
  }

  return bounds ?? fallbackRect(fallbackWidth, fallbackHeight)
}

function buildCanvasMetrics(
  layoutMode: LayoutMode,
  graphBounds: Rect,
  nominalContentWidth: number,
  nominalContentHeight: number,
): CanvasMetrics {
  if (layoutMode !== 'free') {
    return {
      contentWidth: nominalContentWidth,
      contentHeight: nominalContentHeight,
      renderOffsetX: 0,
      renderOffsetY: 0,
      fitBounds: fallbackRect(nominalContentWidth, nominalContentHeight),
    }
  }

  const canvasLeft = Math.min(-FREE_CANVAS_BASE_EXTENT, graphBounds.left - FREE_CANVAS_SAFE_MARGIN)
  const canvasTop = Math.min(-FREE_CANVAS_BASE_EXTENT, graphBounds.top - FREE_CANVAS_SAFE_MARGIN)
  const canvasRight = Math.max(
    FREE_CANVAS_BASE_EXTENT,
    nominalContentWidth,
    graphBounds.right + FREE_CANVAS_SAFE_MARGIN,
    canvasLeft + FREE_CANVAS_MIN_WIDTH,
  )
  const canvasBottom = Math.max(
    FREE_CANVAS_BASE_EXTENT,
    nominalContentHeight,
    graphBounds.bottom + FREE_CANVAS_SAFE_MARGIN,
    canvasTop + FREE_CANVAS_MIN_HEIGHT,
  )

  return {
    contentWidth: canvasRight - canvasLeft,
    contentHeight: canvasBottom - canvasTop,
    renderOffsetX: -canvasLeft,
    renderOffsetY: -canvasTop,
    fitBounds: {
      left: graphBounds.left - canvasLeft,
      top: graphBounds.top - canvasTop,
      right: graphBounds.right - canvasLeft,
      bottom: graphBounds.bottom - canvasTop,
    },
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

const GENERIC_REFERENCE_LABELS = new Set([
  '跨页面跳转',
  '跨页面引用',
  '引用到当前',
  '跳转',
  '关联',
  '引用',
])

const REFERENCE_TRIGGER_VERBS = [
  '点击', '跳转', '进入', '打开', '触发', '切换', '返回', '提交', '选择', '确认',
  '关闭', '展开', '收起', '购买', '升级', '领取', '兑换', '挑战', '继续', '开始',
  '完成', '结算', '领取奖励', '查看详情', '查看', '长按', '双击', '滑动', '拖动',
]

function cleanReferenceText(text: string | null | undefined) {
  if (!text) return ''
  const trimmed = String(text).replace(/\s+/g, ' ').trim()
  if (!trimmed || trimmed.length < 2) return ''
  return trimmed
}

function normalizeNodeSearchText(node: PrdNode) {
  const parts: string[] = []
  if (node.label) parts.push(node.label)
  if (node.summary) parts.push(node.summary)
  const content = cleanReferenceText(node.content)
  if (content) parts.push(content)
  const interaction = node.sections?.interaction
  if (interaction?.summary) parts.push(interaction.summary)
  if (interaction?.content) parts.push(interaction.content)
  return parts.join('\n')
}

function extractTriggerPhrase(haystack: string, targetLabel: string) {
  if (!haystack || !targetLabel) return ''
  const label = targetLabel.trim()
  if (label.length < 2) return ''
  if (!haystack.includes(label)) return ''
  const sentences = haystack.split(/[。！？\n；;]/).map((s) => s.trim()).filter(Boolean)
  for (const sentence of sentences) {
    if (!sentence.includes(label)) continue
    for (const verb of REFERENCE_TRIGGER_VERBS) {
      if (sentence.includes(verb)) return verb
    }
  }
  return ''
}

const REFERENCE_LABEL_MAX = 10

function briefLabel(text: string, max = REFERENCE_LABEL_MAX) {
  const t = cleanReferenceText(text)
  if (!t) return ''
  if (t.length <= max) return t
  return t.slice(0, max) + '…'
}

function deriveReferenceEdgeLabel(source: PrdNode, target: PrdNode, references: NonNullable<PrdNode['references']>) {
  const targetLabel = cleanReferenceText(target.label) || '目标'
  const referenceCount = references.length

  const meaningfulLabels = references
    .map((reference) => cleanReferenceText(reference.label))
    .filter((label) => Boolean(label) && !GENERIC_REFERENCE_LABELS.has(label))
  if (meaningfulLabels.length === 1) return briefLabel(meaningfulLabels[0])
  if (meaningfulLabels.length > 1 && referenceCount > 1) {
    return briefLabel(meaningfulLabels[0]) + ' 等' + referenceCount + '条'
  }

  const meaningfulReasons = references
    .map((reference) => cleanReferenceText(reference.reason))
    .filter(Boolean)
  if (meaningfulReasons.length === 1) {
    return briefLabel(meaningfulReasons[0])
  }

  const sourceText = normalizeNodeSearchText(source)
  const trigger = extractTriggerPhrase(sourceText, targetLabel)
  if (trigger) {
    return referenceCount > 1 ? briefLabel(trigger) + ' 等' + referenceCount + '条' : briefLabel(trigger)
  }

  const fallback = '进入' + targetLabel
  return referenceCount > 1 ? fallback + ' 等' + referenceCount + '条' : fallback
}

function deriveReferenceEdgeNote(references: NonNullable<PrdNode['references']>) {
  if (references.length > 1) {
    return '共 ' + references.length + ' 个跳转条件，点击编辑'
  }
  const reason = cleanReferenceText(references[0] && references[0].reason)
  return reason || null
}

function isEdgeSelected(edge: Pick<FlowEdge, 'fromId' | 'toId'>, selectedNodeId: string | null) {
  return Boolean(selectedNodeId && (edge.fromId === selectedNodeId || edge.toId === selectedNodeId))
}

function normalizeEdgeEndpointLabel(value: string) {
  return value.replace(/[\s_-]+/g, '').trim().toLowerCase()
}

function edgeSemanticPairKey(edge: FlowEdge) {
  if (edge.fromId && edge.toId) return `id:${edge.fromId}->${edge.toId}`
  const fromLabelKey = normalizeEdgeEndpointLabel(edge.fromLabel)
  const toLabelKey = normalizeEdgeEndpointLabel(edge.toLabel)
  if (fromLabelKey && toLabelKey) return `label:${fromLabelKey}->${toLabelKey}`
  return null
}

function edgeGeometryPairKey(edge: FlowEdge) {
  if (
    Number.isFinite(edge.startX)
    && Number.isFinite(edge.startY)
    && Number.isFinite(edge.endX)
    && Number.isFinite(edge.endY)
  ) {
    const snap = (value: number) => Math.round(value / 8) * 8
    return `${snap(edge.startX)},${snap(edge.startY)}->${snap(edge.endX)},${snap(edge.endY)}`
  }

  return null
}

function edgeVisualPairKey(edge: FlowEdge) {
  return edgeSemanticPairKey(edge) ?? edgeGeometryPairKey(edge) ?? edge.id
}

function collapseDuplicateFlowEdges(edges: FlowEdge[]) {
  const byPair = new Map<string, FlowEdge>()

  for (const edge of edges) {
    const pairKey = edgeVisualPairKey(edge)
    const existing = byPair.get(pairKey)
    if (!existing) {
      byPair.set(pairKey, edge)
      continue
    }

    if (edge.kind === 'reference' && existing.kind !== 'reference') {
      byPair.set(pairKey, {
        ...edge,
        selected: edge.selected || existing.selected,
      })
      continue
    }

    if (edge.kind === existing.kind) {
      const referenceCount = (existing.referenceCount ?? 1) + (edge.referenceCount ?? 1)
      byPair.set(pairKey, {
        ...existing,
        label: edge.kind === 'reference' && referenceCount > 1
          ? `${existing.label.replace(/\s+等\s+\d+\s+条$/, '')} 等 ${referenceCount} 条`
          : existing.label,
        note: edge.kind === 'reference' && referenceCount > 1
          ? `共 ${referenceCount} 个条件标题，点击编辑`
          : existing.note,
        referenceCount: edge.kind === 'reference' ? referenceCount : existing.referenceCount,
        selected: existing.selected || edge.selected,
      })
    }
  }

  return [...byPair.values()]
}

function buildFlowEdges(layout: LayoutResult, tree: PrdTree, sourceTree: PrdTree | undefined, selectedNodeId: string | null): FlowEdge[] {
  const fullTree = sourceTree ?? tree
  const edges: FlowEdge[] = []
  const referenceGroups: Array<{
    item: PositionedNode
    source: PrdNode
    target: PositionedNode
    references: Array<{
      referenceIndex: number
      reference: NonNullable<PrdNode['references']>[number]
    }>
  }> = []
  const referenceGroupByKey = new Map<string, (typeof referenceGroups)[number]>()

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
      fromLabel: parent.node.label,
      toLabel: item.node.label,
      ...geometry,
      label: primaryEdgeLabel(parent.node, item.node),
      selected: isEdgeSelected(base, selectedNodeId),
    })
  }

  for (const item of layout.nodes) {
    const source = fullTree[item.node.id]
    if (!source?.references?.length) continue

    for (const [referenceIndex, reference] of source.references.entries()) {
      if (!reference.targetNodeId || reference.targetNodeId === source.id) continue
      const target = layout.byId.get(reference.targetNodeId)
      if (!target) continue
      const groupKey = `${source.id}->${reference.targetNodeId}`
      let group = referenceGroupByKey.get(groupKey)
      if (!group) {
        group = { item, source, target, references: [] }
        referenceGroupByKey.set(groupKey, group)
        referenceGroups.push(group)
      }
      group.references.push({ referenceIndex, reference })
    }
  }

  // Detect bidirectional reference pairs so we can fan the two directed edges
  // apart instead of letting them overlap on the same path.
  const referencePairKeys = new Set(referenceGroups.map((group) => group.source.id + '->' + group.target.node.id))

  for (const group of referenceGroups) {
    const reverseKey = group.target.node.id + '->' + group.source.id
    const isBidirectional = referencePairKeys.has(reverseKey)
    // Assign a deterministic lane: the edge whose source id sorts first takes the
    // negative lane (up/left), the other takes the positive lane (down/right).
    const laneOffset = isBidirectional
      ? (group.source.id < group.target.node.id ? -1 : 1)
      : 0
    const geometry = referenceGeometry(group.item, group.target, laneOffset)
    const base = { fromId: group.source.id, toId: group.target.node.id }
    const references = group.references.map((entry) => entry.reference)
    const referenceCount = references.length
    edges.push({
      id: `reference-${group.source.id}-${group.target.node.id}`,
      kind: 'reference',
      ...base,
      fromLabel: group.source.label,
      toLabel: group.target.node.label,
      ...geometry,
      label: deriveReferenceEdgeLabel(group.source, group.target.node, references),
      note: deriveReferenceEdgeNote(references),
      referenceCount,
      selected: isEdgeSelected(base, selectedNodeId),
    })
  }

  return avoidEdgeLabelOverlaps(collapseDuplicateFlowEdges(edges), layout)
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
  fitRequest,
  connectableNodeIds,
  connectionDraft,
  onNodeClick,
  onNodeDoubleClick,
  onCanvasBlankClick,
  onOpenStatePreview,
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
  const canvasDragMovedRef = useRef(false)
  const nodeDragRef = useRef<NodeDragState | null>(null)
  const suppressNodeClickRef = useRef<{ nodeId: string; until: number } | null>(null)
  const didInitialFitRef = useRef(false)
  const lastFitRequestRef = useRef(fitRequest)
  const [scaleLabel, setScaleLabel] = useState(1)

  const focusNodeId = connectionDraft?.nodeId ?? selectedNodeId
  const connectableNodeSet = useMemo(() => new Set(connectableNodeIds), [connectableNodeIds])
  const previewNodeIds = useMemo(() => (
    new Set(Object.values(tree).filter((node) => hasVisualPreview(node, previewHtmlByNodeId)).map((node) => node.id))
  ), [previewHtmlByNodeId, tree])
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
      const occupiedRects = layout.nodes.map((item) => positionedNodeRect(item, 36))
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
        x: layout.contentWidth + 32,
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
  }, [layout, layoutMode, onAddNode])
  const baseContentWidth = Math.max(
    layout.contentWidth,
    addSlot ? addSlot.x + addSlot.width + PADDING_X : 0,
  )
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
  }, { right: baseContentWidth, bottom: baseContentHeight })
  const nominalContentWidth = Math.max(
    labelBounds.right + PADDING_X,
    baseContentWidth,
  )
  const nominalContentHeight = Math.max(baseContentHeight, labelBounds.bottom + PADDING_BOTTOM)
  const graphBounds = useMemo(() => (
    buildGraphBounds(layout, addSlot, flowEdges, nominalContentWidth, nominalContentHeight, layoutMode)
  ), [addSlot, flowEdges, layout, layoutMode, nominalContentHeight, nominalContentWidth])
  const canvasMetrics = useMemo(() => (
    buildCanvasMetrics(layoutMode, graphBounds, nominalContentWidth, nominalContentHeight)
  ), [graphBounds, layoutMode, nominalContentHeight, nominalContentWidth])
  const { contentWidth, contentHeight, renderOffsetX, renderOffsetY, fitBounds } = canvasMetrics
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
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    const candidate = positionedNodeRect({ x, y, width: current.width, height: current.height }, NODE_DROP_GAP)
    return !blockedRectsForNode(nodeId).some((rect) => rectsOverlap(candidate, rect))
  }

  function clampDropPosition(x: number, y: number) {
    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 56,
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

  function autoPanWhileDragging(e: globalThis.PointerEvent, scale: number) {
    const viewport = viewportRef.current
    if (!viewport) return { panX: 0, panY: 0 }

    const rect = viewport.getBoundingClientRect()
    let panX = 0
    let panY = 0

    if (e.clientX < rect.left + FREE_DRAG_AUTOPAN_EDGE) {
      panX = ((rect.left + FREE_DRAG_AUTOPAN_EDGE - e.clientX) / FREE_DRAG_AUTOPAN_EDGE) * FREE_DRAG_AUTOPAN_MAX_STEP
    } else if (e.clientX > rect.right - FREE_DRAG_AUTOPAN_EDGE) {
      panX = -((e.clientX - (rect.right - FREE_DRAG_AUTOPAN_EDGE)) / FREE_DRAG_AUTOPAN_EDGE) * FREE_DRAG_AUTOPAN_MAX_STEP
    }

    if (e.clientY < rect.top + FREE_DRAG_AUTOPAN_EDGE) {
      panY = ((rect.top + FREE_DRAG_AUTOPAN_EDGE - e.clientY) / FREE_DRAG_AUTOPAN_EDGE) * FREE_DRAG_AUTOPAN_MAX_STEP
    } else if (e.clientY > rect.bottom - FREE_DRAG_AUTOPAN_EDGE) {
      panY = -((e.clientY - (rect.bottom - FREE_DRAG_AUTOPAN_EDGE)) / FREE_DRAG_AUTOPAN_EDGE) * FREE_DRAG_AUTOPAN_MAX_STEP
    }

    if (panX === 0 && panY === 0) return { panX: 0, panY: 0 }

    applyTransform({
      ...transformRef.current,
      tx: transformRef.current.tx + panX,
      ty: transformRef.current.ty + panY,
    })

    return {
      panX: panX / scale,
      panY: panY / scale,
    }
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
    const pan = autoPanWhileDragging(e, scale)
    drag.originX -= pan.panX
    drag.originY -= pan.panY

    const nextPosition = clampDropPosition(drag.originX + dx / scale, drag.originY + dy / scale)

    drag.currentX = nextPosition.x
    drag.currentY = nextPosition.y
    drag.element.style.left = `${nextPosition.x + renderOffsetX}px`
    drag.element.style.top = `${nextPosition.y + renderOffsetY}px`
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
      drag.element.style.left = `${settledPosition.x + renderOffsetX}px`
      drag.element.style.top = `${settledPosition.y + renderOffsetY}px`
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

    const fitWidth = Math.max(1, fitBounds.right - fitBounds.left)
    const fitHeight = Math.max(1, fitBounds.bottom - fitBounds.top)
    const scale = clampScale(Math.min(
      1,
      Math.max(1, viewport.clientWidth - 56) / fitWidth,
      Math.max(1, viewport.clientHeight - 56) / fitHeight,
    ))
    if (layoutMode === 'free') {
      applyTransform({
        scale,
        tx: (viewport.clientWidth - fitWidth * scale) / 2 - fitBounds.left * scale,
        ty: (viewport.clientHeight - fitHeight * scale) / 2 - fitBounds.top * scale,
      })
      return
    }

    applyTransform({ scale, tx: 28, ty: 28 })
  }

  useEffect(() => {
    if (didInitialFitRef.current || layout.nodes.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      didInitialFitRef.current = true
      handleFitScreen()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [fitBounds, layout.nodes.length, layoutMode])

  useEffect(() => {
    if (fitRequest === undefined || lastFitRequestRef.current === fitRequest) return
    lastFitRequestRef.current = fitRequest
    const frame = window.requestAnimationFrame(() => handleFitScreen())
    return () => window.cancelAnimationFrame(frame)
  }, [fitBounds, fitRequest, layoutMode])

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
    canvasDragMovedRef.current = false
    dragStartRef.current = {
      x: e.clientX - transformRef.current.tx,
      y: e.clientY - transformRef.current.ty,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return
    canvasDragMovedRef.current = true
    applyTransform({
      ...transformRef.current,
      tx: e.clientX - dragStartRef.current.x,
      ty: e.clientY - dragStartRef.current.y,
    })
  }

  function onPointerUp() {
    dragStartRef.current = null
  }

  function onCanvasClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (connectionDraft) return
    if (target.closest('[data-node-card], [data-flow-edge-label], [data-add-interface-node], button, input, textarea, select, a')) return
    if (canvasDragMovedRef.current) {
      canvasDragMovedRef.current = false
      return
    }
    onCanvasBlankClick?.()
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
      onClick={onCanvasClick}
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
            style={{ left: layer.x + renderOffsetX, width: layer.width }}
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
            <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="11" markerHeight="11" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#919095" />
            </marker>
            <marker id="flow-arrow-selected" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="13" markerHeight="13" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#4edea3" />
            </marker>
          </defs>

          <g transform={`translate(${renderOffsetX} ${renderOffsetY})`}>
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
                strokeDasharray={edge.kind === 'reference' ? '9 7' : undefined}
                strokeLinecap="round"
                strokeWidth={edge.selected ? 3.2 : 2.4}
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
          </g>

        </svg>

        {flowEdges.map((edge) => {
          const className = [
            'absolute z-20 flex max-w-[176px] flex-col items-center justify-center rounded-md border px-sm py-[4px] text-center font-label-md text-[11px] font-semibold leading-tight shadow-md backdrop-blur',
            edge.selected
              ? 'border-tertiary bg-tertiary-container text-tertiary'
              : edge.kind === 'reference'
                ? 'border-secondary/70 bg-secondary-container text-secondary'
                : 'border-outline-variant bg-surface-container-high text-on-surface-variant',
          ].join(' ')
          const style = {
            left: edge.labelX - 20 + renderOffsetX,
            top: edge.labelY - 13 + renderOffsetY,
            width: 176,
          }

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
              style={{ left: item.x + renderOffsetX, top: item.y + renderOffsetY, width: item.width, height: item.height }}
            >
              <NodeCard
                node={item.node}
                tree={sourceTree ?? tree}
                isSelected={item.node.id === selectedNodeId}
                previewHtml={previewHtmlByNodeId[item.node.id] ?? null}
                onNodeClick={handleCanvasNodeClick}
                onNodeDoubleClick={handleCanvasNodeDoubleClick}
                onOpenStatePreview={onOpenStatePreview}
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
              style={{
                left: selectedPosition.x - 48 + renderOffsetX,
                top: selectedPosition.y + selectedPosition.height / 2 - 18 + renderOffsetY,
              }}
              title="连接流入界面"
              aria-label="连接流入界面"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>add</span>
            </button>
            <button
              type="button"
              onClick={() => handleStartConnection(selectedPosition.node.id, 'outgoing')}
              className="absolute z-30 flex h-9 w-9 items-center justify-center rounded-full border border-tertiary/60 bg-tertiary-container text-tertiary shadow-lg transition-transform hover:scale-105 hover:border-tertiary"
              style={{
                left: selectedPosition.x + selectedPosition.width + 10 + renderOffsetX,
                top: selectedPosition.y + selectedPosition.height / 2 - 18 + renderOffsetY,
              }}
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
            style={{ left: addSlot.x + renderOffsetX, top: addSlot.y + renderOffsetY, width: addSlot.width, height: addSlot.height }}
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
