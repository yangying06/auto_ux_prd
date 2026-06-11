import { useEffect, useRef } from 'react'
import { formatSpecLens, resolveNodeSpecLens } from '../../lib/prdNodeLens'
import { buildDeliverySections, deliverySectionStatusLabel, isDeliveryNode, type DeliverySectionStatus } from '../../lib/prdNodeDelivery'
import type { PrdNode, PrdNodeSectionKey, PrdNodeSpecLens, PrdTree } from '../../types/prdNode'
import { DocumentMiniPreview } from './DocumentPreview'

interface NodeCardProps {
  node: PrdNode
  tree: PrdTree
  isSelected: boolean
  onNodeClick: (id: string) => void
  onNodeDoubleClick: (id: string) => void
}

function canForgeNode(node: PrdNode, tree: PrdTree) {
  return isDeliveryNode(node, tree) && (node.needsPolish || node.status === 'done')
}

function StatusBadge({ node, tree }: { node: PrdNode; tree: PrdTree }) {
  if (node.status === 'done') {
    return (
      <div className="flex items-center gap-xs bg-tertiary-container/40 border border-on-tertiary-container text-tertiary px-2 py-1 rounded-full text-[10px] font-bold tracking-wider">
        <span className="material-symbols-outlined" style={{ fontSize: '12px', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        已确认
      </div>
    )
  }
  if (canForgeNode(node, tree)) {
    return (
      <div className="flex items-center gap-xs bg-[#b22a00]/20 border border-[#ff5429] text-[#ff8b6b] px-2 py-1 rounded-full text-[10px] font-bold tracking-wider">
        <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>auto_awesome</span>
        待打磨
      </div>
    )
  }
  if (node.status === 'pending_refine') return null
  if (node.status === 'pending') {
    return (
      <div className="flex items-center gap-xs bg-surface-container-high border border-outline-variant text-on-surface-variant px-2 py-1 rounded-full text-[10px] font-bold tracking-wider">
        <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>checklist</span>
        可导出
      </div>
    )
  }
  return null
}

function mvcTone(tone: 'model' | 'view' | 'control' | 'default') {
  if (tone === 'model') return 'border-[#3B82F6]/55 bg-[#3B82F6]/15 text-[#3B82F6]'
  if (tone === 'view') return 'border-[#10B981]/55 bg-[#10B981]/15 text-[#10B981]'
  if (tone === 'control') return 'border-[#F59E0B]/55 bg-[#F59E0B]/15 text-[#F59E0B]'
  return 'border-[#9CA3AF]/40 bg-surface-container text-[#9CA3AF]'
}

function toneForSection(key: PrdNodeSectionKey) {
  if (key === 'data') return 'model'
  if (key === 'view') return 'view'
  return 'control'
}

function toneForLens(lens: PrdNodeSpecLens) {
  if (lens === 'model') return 'model'
  if (lens === 'view') return 'view'
  if (lens === 'control') return 'control'
  return 'default'
}

function sectionTone(key: PrdNodeSectionKey, status: DeliverySectionStatus) {
  if (status !== 'ready') {
    return mvcTone('default')
  }
  return mvcTone(toneForSection(key))
}

function DeliveryMiniPreview({ node, tree }: { node: PrdNode; tree: PrdTree }) {
  const sections = buildDeliverySections(node, tree)

  return (
    <div className="grid h-full grid-cols-3 gap-xs">
      {sections.map((section) => (
        <div key={section.key} className={`flex min-w-0 flex-col rounded border px-xs py-xs ${sectionTone(section.key, section.status)}`}>
          <div className="flex shrink-0 items-center justify-between gap-xs">
            <span className="truncate text-label-md font-semibold">{section.label}</span>
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
              {section.status === 'ready' ? 'check_circle' : section.status === 'needs_review' ? 'pending' : 'radio_button_unchecked'}
            </span>
          </div>
          <span className="mt-[2px] shrink-0 truncate text-[10px] leading-tight opacity-80">
            {deliverySectionStatusLabel(section.status)}
          </span>
          <p className="mt-xs min-h-0 overflow-hidden text-body-sm leading-snug text-current opacity-80 line-clamp-4">
            {section.summary ?? section.content ?? (section.openQuestions[0] ? `待确认：${section.openQuestions[0]}` : '等待补齐')}
          </p>
        </div>
      ))}
    </div>
  )
}

export function NodeCard({ node, tree, isSelected, onNodeClick, onNodeDoubleClick }: NodeCardProps) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const specLens = resolveNodeSpecLens(node)
  const lensLabel = formatSpecLens(specLens)

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
          <span className="font-label-md text-label-md">原文目录</span>
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

  const canForge = canForgeNode(node, tree)
  const isDelivery = isDeliveryNode(node, tree)

  return (
    <div
      onClick={handleClick}
      className={`group relative flex h-full cursor-pointer flex-col rounded-lg border border-outline-variant bg-surface-container-highest p-md transition-colors hover:border-primary ${isSelected ? 'active-glow' : 'node-glow'}`}
    >
      <div className="mb-sm flex items-start justify-between gap-sm">
        <div className="min-w-0">
          <div className="mb-xs flex items-center gap-xs text-primary">
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>{node.type === 'page' ? 'web_asset' : 'article'}</span>
            <span className="truncate font-code-sm text-code-sm">{node.docPath ?? node.id}</span>
          </div>
          <h4 className="line-clamp-2 font-headline-sm text-headline-sm text-on-surface">{node.label}</h4>
          <div className={`mt-xs inline-flex max-w-full rounded border px-xs py-[2px] font-code-sm text-code-sm ${mvcTone(node.status === 'done' ? toneForLens(specLens) : 'default')}`}>
            <span className="truncate">{lensLabel}</span>
          </div>
        </div>
        <StatusBadge node={node} tree={tree} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded border border-outline-variant/60 bg-surface-container/70 p-sm">
        {isDelivery ? <DeliveryMiniPreview node={node} tree={tree} /> : <DocumentMiniPreview node={node} maxLines={8} />}
      </div>
      <div className="mt-sm flex items-center justify-between border-t border-outline-variant pt-sm">
        <span className="font-label-md text-label-md text-on-surface-variant">文档预览</span>
        <span className="font-label-md text-label-md text-primary opacity-0 group-hover:opacity-100 transition-opacity">
        {canForge ? '双击打磨' : '单击查看'}
        </span>
      </div>
    </div>
  )
}
