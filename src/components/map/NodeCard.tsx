import { useEffect, useRef } from 'react'
import type { PrdNode } from '../../types/prdNode'

interface NodeCardProps {
  node: PrdNode
  isSelected: boolean
  onNodeClick: (id: string) => void
  onNodeDoubleClick: (id: string) => void
}

function StatusBadge({ status }: { status: PrdNode['status'] }) {
  if (status === 'pending') {
    return (
      <div className="flex items-center gap-xs bg-[#b22a00]/20 border border-[#ff5429] text-[#ff8b6b] px-2 py-1 rounded-full text-[10px] font-bold tracking-wider">
        <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>auto_awesome</span>
        待打磨
      </div>
    )
  }
  return (
    <div className="flex items-center gap-xs bg-tertiary-container/40 border border-on-tertiary-container text-tertiary px-2 py-1 rounded-full text-[10px] font-bold tracking-wider">
      <span className="material-symbols-outlined" style={{ fontSize: '12px', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
      已完成
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

  // Root node
  if (node.parentId === null) {
    return (
      <div
        onClick={handleClick}
        className="bg-surface-container border border-outline-variant rounded-xl p-md node-glow cursor-pointer hover:border-primary transition-colors relative"
      >
        <div className="flex items-center gap-sm mb-sm text-primary">
          <span className="material-symbols-outlined">folder_special</span>
          <span className="font-label-md text-label-md">顶层节点</span>
        </div>
        <h2 className="font-headline-sm text-headline-sm text-on-surface mb-sm">{node.label}</h2>
        <div className="font-code-sm text-code-sm text-on-surface-variant border-t border-outline-variant pt-sm mt-sm">
          编号：<span className="text-tertiary">{node.id}</span>
        </div>
      </div>
    )
  }

  // Module node
  if (node.type === 'module') {
    return (
      <div
        onClick={handleClick}
        className="bg-surface-container border border-outline-variant rounded-lg p-md shadow-sm cursor-pointer hover:border-primary transition-colors node-glow"
      >
        <div className="flex items-center gap-sm mb-xs text-secondary">
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>category</span>
          <span className="font-label-md text-label-md">模块</span>
        </div>
        <h3 className="font-body-lg text-body-lg text-on-surface">{node.label}</h3>
      </div>
    )
  }

  // Feature / UI leaf node
  return (
    <div
      onClick={handleClick}
      className={`bg-surface-container-highest border border-outline-variant rounded-xl p-md cursor-pointer relative group transition-colors hover:border-primary ${isSelected ? 'active-glow' : 'node-glow'}`}
    >
      <div className="flex justify-between items-start mb-sm">
        <div className="flex items-center gap-sm text-on-surface">
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>bolt</span>
          <h4 className="font-headline-sm text-headline-sm">{node.label}</h4>
        </div>
        <StatusBadge status={node.status} />
      </div>
      <p className="font-body-md text-body-md text-on-surface-variant line-clamp-2 mb-md">{node.summary}</p>
      <div className="flex items-center justify-between border-t border-outline-variant pt-sm">
        <span className="font-code-sm text-code-sm text-on-primary-container">编号：{node.id}</span>
        <span className="font-label-md text-label-md text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          双击打磨
        </span>
      </div>
    </div>
  )
}
