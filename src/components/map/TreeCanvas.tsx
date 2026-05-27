import { useRef, useState, useMemo, useLayoutEffect } from 'react'
import type { PrdTree, PrdNode } from '../../types/prdNode'
import { NodeCard } from './NodeCard'

const MIN_SCALE = 0.35
const MAX_SCALE = 2.4
const ZOOM_STEP = 0.15

interface TreeCanvasProps {
  tree: PrdTree
  selectedNodeId: string | null
  onNodeClick: (id: string) => void
  onNodeDoubleClick: (id: string) => void
}

function sortByOrder(a: PrdNode, b: PrdNode) {
  return a.order - b.order || a.id.localeCompare(b.id)
}

function groupByParent(nodes: PrdNode[]) {
  const groups = new Map<string | null, PrdNode[]>()
  for (const node of nodes) {
    const siblings = groups.get(node.parentId) ?? []
    siblings.push(node)
    groups.set(node.parentId, siblings)
  }

  for (const siblings of groups.values()) {
    siblings.sort(sortByOrder)
  }

  return groups
}

function buildColumns(tree: PrdTree): PrdNode[][] {
  const nodes = Object.values(tree)
  if (nodes.length === 0) return []

  const byParent = groupByParent(nodes)
  const roots = byParent.get(null) ?? []
  const columns: PrdNode[][] = []
  const visited = new Set<string>()
  let currentLevel = roots

  while (currentLevel.length > 0) {
    columns.push(currentLevel)
    const nextLevel: PrdNode[] = []

    for (const node of currentLevel) {
      visited.add(node.id)
      const linkedChildren = node.children
        .map((childId) => tree[childId])
        .filter((child): child is PrdNode => Boolean(child))

      const fallbackChildren = byParent.get(node.id) ?? []
      const children = (linkedChildren.length > 0 ? linkedChildren : fallbackChildren)
        .filter((child) => !visited.has(child.id))
        .sort(sortByOrder)

      nextLevel.push(...children)
    }

    currentLevel = nextLevel
  }

  const orphans = nodes.filter((node) => !visited.has(node.id))
  if (orphans.length > 0) {
    columns.push(orphans.sort((a, b) => a.level - b.level || sortByOrder(a, b)))
  }

  return columns
}

function clampScale(scale: number) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale))
}

export function TreeCanvas({ tree, selectedNodeId, onNodeClick, onNodeDoubleClick }: TreeCanvasProps) {
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [paths, setPaths] = useState<string[]>([])
  const [scaleLabel, setScaleLabel] = useState(1)

  const columns = useMemo(() => buildColumns(tree), [tree])

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
    applyTransform({ scale: 1, tx: 0, ty: 0 })
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

  useLayoutEffect(() => {
    const innerEl = innerRef.current
    if (!innerEl) return

    const newPaths: string[] = []
    const nodes = Object.values(tree)

    nodes.forEach((node) => {
      if (!node.parentId) return
      const parentEl = nodeRefs.current.get(node.parentId)
      const childEl = nodeRefs.current.get(node.id)
      if (!parentEl || !childEl) return

      const px = parentEl.offsetLeft + parentEl.offsetWidth
      const py = parentEl.offsetTop + parentEl.offsetHeight / 2
      const cx = childEl.offsetLeft
      const cy = childEl.offsetTop + childEl.offsetHeight / 2
      const midX = (px + cx) / 2

      newPaths.push(`M ${px} ${py} C ${midX} ${py}, ${midX} ${cy}, ${cx} ${cy}`)
    })

    setPaths(newPaths)
  }, [tree, columns])

  return (
    <div
      ref={viewportRef}
      className="flex-1 relative blueprint-grid overflow-hidden cursor-grab active:cursor-grabbing"
      onWheel={handleWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {/* Zoom controls — absolute positioned, outside the transformed inner */}
      <div className="absolute bottom-lg right-lg flex gap-xs bg-surface-container border border-outline-variant rounded-lg p-xs shadow-lg z-10">
        <button
          onClick={handleZoomOut}
          disabled={scaleLabel <= MIN_SCALE}
          title="缩小"
          className="p-sm text-on-surface-variant hover:text-primary transition-colors hover:bg-surface-variant rounded disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="material-symbols-outlined">zoom_out</span>
        </button>
        <button
          onClick={handleFitScreen}
          title="重置视图"
          className="p-sm text-on-surface-variant hover:text-primary transition-colors hover:bg-surface-variant rounded"
        >
          <span className="material-symbols-outlined">fit_screen</span>
        </button>
        <button
          onClick={handleZoomIn}
          disabled={scaleLabel >= MAX_SCALE}
          title="放大"
          className="p-sm text-on-surface-variant hover:text-primary transition-colors hover:bg-surface-variant rounded disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="material-symbols-outlined">zoom_in</span>
        </button>
      </div>

      {/* Inner transformed container */}
      <div
        ref={innerRef}
        className="relative flex items-center p-xl gap-[80px] min-w-max"
        style={{ willChange: 'transform' }}
      >
        {/* SVG connection lines — behind columns, z-index 0 */}
        <svg
          className="absolute top-0 left-0 pointer-events-none"
          style={{ width: '100%', height: '100%', zIndex: 0, overflow: 'visible' }}
        >
          {paths.map((d, i) => (
            <path key={i} d={d} className="svg-line" />
          ))}
        </svg>

        {/* Columns */}
        {columns.map((col, colIdx) => (
          <div
            key={colIdx}
            className={`z-10 flex flex-col shrink-0 ${
              colIdx === 0 ? 'w-[280px] gap-[48px]' :
              colIdx === 1 ? 'w-[240px] gap-[56px]' :
              'w-[320px] gap-[40px]'
            }`}
          >
            {col.map((node) => (
              <div
                key={node.id}
                ref={(el) => {
                  if (el) nodeRefs.current.set(node.id, el)
                  else nodeRefs.current.delete(node.id)
                }}
                data-node-card="true"
              >
                <NodeCard
                  node={node}
                  isSelected={node.id === selectedNodeId}
                  onNodeClick={onNodeClick}
                  onNodeDoubleClick={onNodeDoubleClick}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
