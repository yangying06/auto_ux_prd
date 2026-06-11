import { useMemo, useRef, useState } from 'react'
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

interface TreeCanvasProps {
  tree: PrdTree
  sourceTree?: PrdTree
  selectedNodeId: string | null
  onNodeClick: (id: string) => void
  onNodeDoubleClick: (id: string) => void
  onAddNode?: (parentId: string | null) => void
}

interface PositionedNode {
  node: PrdNode
  x: number
  y: number
  width: number
  height: number
  depth: number
}

interface LayoutResult {
  nodes: PositionedNode[]
  byId: Map<string, PositionedNode>
  layers: Array<{ depth: number; x: number; width: number; label: string }>
  contentWidth: number
  contentHeight: number
}

function sortByOrder(a: PrdNode, b: PrdNode) {
  return a.order - b.order || a.id.localeCompare(b.id)
}

function getCardSize(node: PrdNode) {
  if (node.parentId === null) return { width: 340, height: 214 }
  if (node.type === 'module') return { width: 330, height: 196 }
  return { width: 400, height: 270 }
}

function buildChildrenMap(tree: PrdTree) {
  const groups = new Map<string | null, PrdNode[]>()
  for (const node of Object.values(tree)) {
    const parentId = node.parentId && tree[node.parentId] ? node.parentId : null
    const siblings = groups.get(parentId) ?? []
    siblings.push(node)
    groups.set(parentId, siblings)
  }

  for (const siblings of groups.values()) {
    siblings.sort(sortByOrder)
  }

  return groups
}

function layerLabel(depth: number) {
  if (depth === 0) return '原文目录'
  if (depth === 1) return '页面节点'
  if (depth === 2) return '交付节点'
  if (depth === 3) return '细分文档'
  return `拆分层 ${depth - 2}`
}

function buildTreeLayout(tree: PrdTree): LayoutResult {
  const childrenMap = buildChildrenMap(tree)
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
    if (trail.has(node.id)) return getCardSize(node).height

    const nextTrail = new Set(trail)
    nextTrail.add(node.id)
    const ownHeight = getCardSize(node).height
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

    const size = getCardSize(node)
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

function clampScale(scale: number) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}

function connectorPath(parent: PositionedNode, child: PositionedNode) {
  const sx = parent.x + parent.width
  const sy = parent.y + parent.height / 2
  const ex = child.x
  const ey = child.y + child.height / 2
  const midX = sx + Math.max(56, (ex - sx) / 2)
  return `M ${sx} ${sy} C ${midX} ${sy}, ${midX} ${ey}, ${ex} ${ey}`
}

function addNodeConnectorPath(root: PositionedNode, addSlot: { x: number; y: number; width: number; height: number }) {
  const sx = root.x + root.width / 2
  const sy = root.y + root.height
  const ex = addSlot.x + addSlot.width / 2
  const ey = addSlot.y
  const midY = sy + Math.max(18, (ey - sy) / 2)
  return `M ${sx} ${sy} C ${sx} ${midY}, ${ex} ${midY}, ${ex} ${ey}`
}

export function TreeCanvas({ tree, sourceTree, selectedNodeId, onNodeClick, onNodeDoubleClick, onAddNode }: TreeCanvasProps) {
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [scaleLabel, setScaleLabel] = useState(1)

  const layout = useMemo(() => buildTreeLayout(tree), [tree])
  const addSlot = useMemo(() => {
    if (!onAddNode) return null
    const root = layout.nodes.find((item) => item.depth === 0) ?? null
    if (!root) return null
    const width = 246
    const height = 104
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
  }, [layout, onAddNode])
  const contentHeight = addSlot
    ? Math.max(layout.contentHeight, addSlot.y + addSlot.height + PADDING_BOTTOM)
    : layout.contentHeight
  const paths = useMemo(() => (
    layout.nodes
      .map((item) => {
        if (!item.node.parentId) return null
        const parent = layout.byId.get(item.node.parentId)
        return parent ? {
          id: `${parent.node.id}-${item.node.id}`,
          d: connectorPath(parent, item),
        } : null
      })
      .filter((path): path is { id: string; d: string } => Boolean(path))
  ), [layout])

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
      (viewport.clientWidth - 56) / layout.contentWidth,
      (viewport.clientHeight - 56) / contentHeight,
    ))
    applyTransform({ scale, tx: 28, ty: 28 })
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault()
    const direction = e.deltaY > 0 ? -1 : 1
    zoomAt(transformRef.current.scale + direction * ZOOM_STEP, e.clientX, e.clientY)
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('[data-node-card]')) return
    if ((e.target as HTMLElement).closest('button')) return
    dragStartRef.current = {
      x: e.clientX - transformRef.current.tx,
      y: e.clientY - transformRef.current.ty,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
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
      className="relative flex-1 cursor-grab overflow-hidden blueprint-grid active:cursor-grabbing"
      onWheel={handleWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
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
          width: layout.contentWidth,
          height: contentHeight,
          minWidth: layout.contentWidth,
          transform: 'translate(0px, 0px) scale(1)',
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {layout.layers.map((layer) => (
          <div
            key={layer.depth}
            className="absolute top-9 flex items-center gap-xs font-mono text-[10px] uppercase tracking-[0.12em] text-on-surface-variant/70"
            style={{ left: layer.x, width: layer.width }}
          >
            <span className="h-px flex-1 bg-outline-variant/30" />
            <span>{layer.label}</span>
            <span className="h-px flex-1 bg-outline-variant/30" />
          </div>
        ))}

        <svg
          className="pointer-events-none absolute top-0 left-0"
          style={{ width: layout.contentWidth, height: contentHeight, overflow: 'visible', zIndex: 0 }}
        >
          {paths.map((path, i) => (
            <path
              key={path.id}
              d={path.d}
              className="svg-line"
              pathLength={1}
              style={{ animationDelay: `${Math.min(i * 45, 420)}ms` }}
            />
          ))}
          {addSlot && (
            <path
              d={addSlot.d}
              className="svg-line"
              pathLength={1}
              style={{ animationDelay: '180ms' }}
            />
          )}
        </svg>

        {layout.nodes.map((item) => (
          <div
            key={item.node.id}
            data-node-card="true"
            className="absolute z-10"
            style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
          >
            <NodeCard
              node={item.node}
              tree={sourceTree ?? tree}
              isSelected={item.node.id === selectedNodeId}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
            />
          </div>
        ))}

        {addSlot && (
          <button
            type="button"
            onClick={() => onAddNode?.(addSlot.parent.node.id)}
            title="新增页面节点"
            aria-label="新增页面节点"
            className="group absolute z-20 flex items-center gap-sm rounded-lg border border-dashed border-primary/70 bg-surface-container-high/95 p-sm text-left shadow-lg transition-all hover:-translate-y-0.5 hover:border-primary hover:bg-primary-container/30 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-primary/50"
            style={{ left: addSlot.x, top: addSlot.y, width: addSlot.width, height: addSlot.height }}
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-primary/50 bg-primary-container text-primary transition-colors group-hover:bg-primary group-hover:text-on-primary">
              <span className="material-symbols-outlined" style={{ fontSize: '30px' }}>add</span>
            </span>
            <span className="min-w-0">
              <span className="block font-label-md text-label-md text-on-surface">新增页面节点</span>
              <span className="mt-xs block text-body-sm leading-snug text-on-surface-variant">
                上传资料，补齐三栏细节
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
