import { useRef, useState, useMemo, useLayoutEffect } from 'react'
import type { PrdTree, PrdNode } from '../../types/prdNode'
import { NodeCard } from './NodeCard'

interface TreeCanvasProps {
  tree: PrdTree
  selectedNodeId: string | null
  onNodeClick: (id: string) => void
  onNodeDoubleClick: (id: string) => void
}

function buildColumns(tree: PrdTree): PrdNode[][] {
  const nodes = Object.values(tree)
  if (nodes.length === 0) return []
  const roots = nodes.filter((n) => n.parentId === null).sort((a, b) => a.order - b.order)
  const level1 = nodes.filter((n) => n.level === 1).sort((a, b) => a.order - b.order)
  const level2Plus = nodes.filter((n) => n.level >= 2).sort((a, b) => a.order - b.order)
  const columns: PrdNode[][] = []
  if (roots.length > 0) columns.push(roots)
  if (level1.length > 0) columns.push(level1)
  if (level2Plus.length > 0) columns.push(level2Plus)
  return columns
}

export function TreeCanvas({ tree, selectedNodeId, onNodeClick, onNodeDoubleClick }: TreeCanvasProps) {
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 })
  const innerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [paths, setPaths] = useState<string[]>([])

  const columns = useMemo(() => buildColumns(tree), [tree])

  function applyTransform() {
    if (!innerRef.current) return
    const { scale, tx, ty } = transformRef.current
    innerRef.current.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
    innerRef.current.style.transformOrigin = 'center center'
  }

  function handleZoomIn() {
    transformRef.current.scale = Math.min(transformRef.current.scale + 0.15, 3)
    applyTransform()
  }

  function handleZoomOut() {
    transformRef.current.scale = Math.max(transformRef.current.scale - 0.15, 0.3)
    applyTransform()
  }

  function handleFitScreen() {
    transformRef.current = { scale: 1, tx: 0, ty: 0 }
    applyTransform()
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('[data-node-card]')) return
    dragStartRef.current = {
      x: e.clientX - transformRef.current.tx,
      y: e.clientY - transformRef.current.ty,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return
    transformRef.current.tx = e.clientX - dragStartRef.current.x
    transformRef.current.ty = e.clientY - dragStartRef.current.y
    applyTransform()
  }

  function onPointerUp() {
    dragStartRef.current = null
  }

  useLayoutEffect(() => {
    const canvasEl = innerRef.current
    if (!canvasEl) return
    const canvasRect = canvasEl.getBoundingClientRect()
    const newPaths: string[] = []
    const nodes = Object.values(tree)

    nodes.forEach((node) => {
      if (!node.parentId) return
      const parentEl = nodeRefs.current.get(node.parentId)
      const childEl = nodeRefs.current.get(node.id)
      if (!parentEl || !childEl) return

      const parentRect = parentEl.getBoundingClientRect()
      const childRect = childEl.getBoundingClientRect()

      const px = (parentRect.right - canvasRect.left) / transformRef.current.scale
      const py = (parentRect.top + parentRect.height / 2 - canvasRect.top) / transformRef.current.scale
      const cx = (childRect.left - canvasRect.left) / transformRef.current.scale
      const cy = (childRect.top + childRect.height / 2 - canvasRect.top) / transformRef.current.scale

      const midX = (px + cx) / 2
      newPaths.push(`M ${px} ${py} C ${midX} ${py}, ${midX} ${cy}, ${cx} ${cy}`)
    })

    setPaths(newPaths)
  }, [tree])

  return (
    <div
      className="flex-1 relative blueprint-grid overflow-hidden cursor-grab active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      {/* Zoom controls — absolute positioned, outside the transformed inner */}
      <div className="absolute bottom-lg right-lg flex gap-xs bg-surface-container border border-outline-variant rounded-lg p-xs shadow-lg z-10">
        <button
          onClick={handleZoomOut}
          className="p-sm text-on-surface-variant hover:text-primary transition-colors hover:bg-surface-variant rounded"
        >
          <span className="material-symbols-outlined">zoom_out</span>
        </button>
        <button
          onClick={handleFitScreen}
          className="p-sm text-on-surface-variant hover:text-primary transition-colors hover:bg-surface-variant rounded"
        >
          <span className="material-symbols-outlined">fit_screen</span>
        </button>
        <button
          onClick={handleZoomIn}
          className="p-sm text-on-surface-variant hover:text-primary transition-colors hover:bg-surface-variant rounded"
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
              colIdx === 0 ? 'w-[280px] gap-[40px]' :
              colIdx === 1 ? 'w-[200px] gap-[80px]' :
              'w-[320px] gap-[60px]'
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
