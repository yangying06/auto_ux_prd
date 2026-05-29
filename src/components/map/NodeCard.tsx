import { useEffect, useRef } from 'react'
import type { PrdNode } from '../../types/prdNode'
import { DocumentMiniPreview } from './DocumentPreview'

interface NodeCardProps {
  node: PrdNode
  isSelected: boolean
  onNodeClick: (id: string) => void
  onNodeDoubleClick: (id: string) => void
}

function StatusBadge({ node }: { node: PrdNode }) {
  if (node.status === 'pending' && node.needsPolish) {
    return (
      <div className="flex items-center gap-xs bg-[#b22a00]/20 border border-[#ff5429] text-[#ff8b6b] px-2 py-1 rounded-full text-[10px] font-bold tracking-wider">
        <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>auto_awesome</span>
        待打磨
      </div>
    )
  }
  if (node.status === 'pending') {
    return (
      <div className="flex items-center gap-xs bg-surface-container-high border border-outline-variant text-on-surface-variant px-2 py-1 rounded-full text-[10px] font-bold tracking-wider">
        <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>checklist</span>
        可导出
      </div>
    )
  }
  return (
    <div className="flex items-center gap-xs bg-tertiary-container/40 border border-on-tertiary-container text-tertiary px-2 py-1 rounded-full text-[10px] font-bold tracking-wider">
      <span className="material-symbols-outlined" style={{ fontSize: '12px', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
      已确认
    </div>
  )
}

export function NodeCard({ node, isSelected, onNodeClick, onNodeDoubleClick }: NodeCardProps) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    }
  }, [])

  function handleClick() {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      onNodeDoubleClick(node.id)
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null
        onNodeClick(node.id)
      }, 300)
    }
  }

  if (node.parentId === null) {
    return (
      <div
        onClick={handleClick}
        className={`relative flex h-full cursor-pointer flex-col rounded-lg border border-outline-variant bg-surface-container p-md transition-colors hover:border-primary ${isSelected ? 'active-glow' : 'node-glow'}`}
      >
        <div className="flex items-center gap-sm mb-sm text-primary">
          <span className="material-symbols-outlined">folder_special</span>
          <span className="font-label-md text-label-md">顶层目录</span>
        </div>
        <h2 className="mb-sm line-clamp-2 font-headline-sm text-headline-sm text-on-surface">{node.label}</h2>
        <div className="min-h-0 flex-1 overflow-hidden rounded border border-outline-variant/60 bg-surface-container-low/70 p-sm">
          <DocumentMiniPreview node={node} maxLines={5} />
        </div>
        <div className="mt-sm border-t border-outline-variant pt-sm font-code-sm text-code-sm text-on-surface-variant">
          {node.docPath ?? node.id}
        </div>
      </div>
    )
  }

  if (node.type === 'module') {
    return (
      <div
        onClick={handleClick}
        className={`flex h-full cursor-pointer flex-col rounded-lg border border-outline-variant bg-surface-container p-md shadow-sm transition-colors hover:border-primary ${isSelected ? 'active-glow' : 'node-glow'}`}
      >
        <div className="flex items-center gap-sm mb-xs text-secondary">
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>category</span>
          <span className="font-label-md text-label-md">文档分组</span>
        </div>
        <h3 className="mb-xs line-clamp-2 font-body-lg text-body-lg text-on-surface">{node.label}</h3>
        <div className="mt-sm min-h-0 flex-1 overflow-hidden rounded border border-outline-variant/60 bg-surface-container-low/70 p-sm">
          <DocumentMiniPreview node={node} maxLines={5} />
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={handleClick}
      className={`group relative flex h-full cursor-pointer flex-col rounded-lg border border-outline-variant bg-surface-container-highest p-md transition-colors hover:border-primary ${isSelected ? 'active-glow' : 'node-glow'}`}
    >
      <div className="mb-sm flex items-start justify-between gap-sm">
        <div className="min-w-0">
          <div className="mb-xs flex items-center gap-xs text-primary">
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>article</span>
            <span className="truncate font-code-sm text-code-sm">{node.docPath ?? node.id}</span>
          </div>
          <h4 className="line-clamp-2 font-headline-sm text-headline-sm text-on-surface">{node.label}</h4>
        </div>
        <StatusBadge node={node} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded border border-outline-variant/60 bg-surface-container/70 p-sm">
        <DocumentMiniPreview node={node} maxLines={8} />
      </div>
      <div className="mt-sm flex items-center justify-between border-t border-outline-variant pt-sm">
        <span className="font-label-md text-label-md text-on-surface-variant">文档预览</span>
        <span className="font-label-md text-label-md text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          双击打磨
        </span>
      </div>
    </div>
  )
}
