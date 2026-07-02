import { useEffect, useRef, type MouseEvent } from 'react'
import { formatSpecLens, resolveNodeSpecLens } from '../../lib/prdNodeLens'
import { buildDeliverySections, deliverySectionStatusLabel, isDeliveryNode, type DeliverySectionStatus, type DeliverySectionSummary } from '../../lib/prdNodeDelivery'
import type { PrdNode, PrdNodeSectionKey, PrdNodeSpecLens, PrdTree } from '../../types/prdNode'
import { DocumentMiniPreview } from './DocumentPreview'
import { FigmaMiniPreview, figmaPreviewImages } from './FigmaStatePreview'
import { PrototypePreviewSurface } from '../state/PrototypeSandboxPreview'

interface NodeCardProps {
  node: PrdNode
  tree: PrdTree
  isSelected: boolean
  previewHtml?: string | null
  onNodeClick: (id: string) => void
  onNodeDoubleClick: (id: string) => void
  onOpenStatePreview?: (id: string) => void
}

function canForgeNode(node: PrdNode, tree: PrdTree) {
  return isDeliveryNode(node, tree) && (node.needsPolish || node.status === 'done')
}

function StatusBadge({ node, tree }: { node: PrdNode; tree: PrdTree }) {
  if (node.status === 'done') {
    return (
      <div className="flex items-center gap-xs rounded-full border border-on-tertiary-container bg-tertiary-container/40 px-2 py-1 text-[10px] font-bold tracking-wider text-tertiary">
        <span className="material-symbols-outlined" style={{ fontSize: '12px', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        已确认
      </div>
    )
  }
  if (canForgeNode(node, tree)) {
    return (
      <div className="flex items-center gap-xs rounded-full border border-[#ff5429] bg-[#b22a00]/20 px-2 py-1 text-[10px] font-bold tracking-wider text-[#ff8b6b]">
        <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>auto_awesome</span>
        待打磨
      </div>
    )
  }
  if (node.status === 'pending_refine') return null
  if (node.status === 'pending') {
    return (
      <div className="flex items-center gap-xs rounded-full border border-outline-variant bg-surface-container-high px-2 py-1 text-[10px] font-bold tracking-wider text-on-surface-variant">
        <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>checklist</span>
        可整理
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
  if (status !== 'ready') return mvcTone('default')
  return mvcTone(toneForSection(key))
}

function DeliveryMiniPreview({ sections }: { sections: DeliverySectionSummary[] }) {
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

function incomingReferenceCount(nodeId: string, tree: PrdTree) {
  return Object.values(tree).reduce((count, node) => (
    count + (node.references ?? []).filter((reference) => reference.targetNodeId === nodeId).length
  ), 0)
}

function flowCounts(node: PrdNode, tree: PrdTree) {
  return {
    upstream: (node.parentId ? 1 : 0) + incomingReferenceCount(node.id, tree),
    downstream: node.children.length + (node.references ?? []).filter((reference) => Boolean(reference.targetNodeId)).length,
  }
}

function FlowCountChips({ node, tree }: { node: PrdNode; tree: PrdTree }) {
  const counts = flowCounts(node, tree)
  return (
    <div className="flex shrink-0 items-center gap-xs">
      <span className="inline-flex items-center gap-[2px] rounded border border-outline-variant/70 bg-surface-container px-xs py-[1px] font-code-sm text-[10px] text-on-surface-variant">
        <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>input</span>
        {counts.upstream}
      </span>
      <span className="inline-flex items-center gap-[2px] rounded border border-outline-variant/70 bg-surface-container px-xs py-[1px] font-code-sm text-[10px] text-on-surface-variant">
        <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>output</span>
        {counts.downstream}
      </span>
    </div>
  )
}

function nodeKindMeta(node: PrdNode, tree: PrdTree) {
  if (node.type === 'module' && node.parentId === null) return { icon: 'inventory_2', label: 'PRD 源包' }
  if (node.type === 'module') return { icon: 'hub', label: '流程分组' }
  if (isDeliveryNode(node, tree)) return { icon: 'web_asset', label: '界面屏' }
  return { icon: 'conversion_path', label: '交互细节' }
}

export function NodeCard({ node, tree, isSelected, previewHtml, onNodeClick, onNodeDoubleClick, onOpenStatePreview }: NodeCardProps) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const specLens = resolveNodeSpecLens(node)
  const lensLabel = formatSpecLens(specLens)
  const meta = nodeKindMeta(node, tree)

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

  function handleOpenStatePreview(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    onOpenStatePreview?.(node.id)
  }

  if (node.type === 'module' && node.parentId === null) {
    return (
      <div
        onClick={handleClick}
        className={`relative flex h-full cursor-pointer flex-col rounded-lg border border-outline-variant bg-surface-container p-md transition-colors hover:border-primary ${isSelected ? 'active-glow' : 'node-glow'}`}
      >
        <div className="mb-sm flex items-center justify-between gap-sm">
          <div className="flex min-w-0 items-center gap-sm text-primary">
            <span className="material-symbols-outlined">{meta.icon}</span>
            <span className="truncate font-label-md text-label-md">{meta.label}</span>
          </div>
          <FlowCountChips node={node} tree={tree} />
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
        <div className="mb-xs flex items-center justify-between gap-sm">
          <div className="flex min-w-0 items-center gap-sm text-secondary">
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>{meta.icon}</span>
            <span className="truncate font-label-md text-label-md">{meta.label}</span>
          </div>
          <FlowCountChips node={node} tree={tree} />
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
  const deliverySections = isDelivery ? buildDeliverySections(node, tree) : []
  const hasFigmaPreview = figmaPreviewImages(node).length > 0

  return (
    <div
      onClick={handleClick}
      className={`group relative flex h-full cursor-pointer flex-col rounded-lg border border-outline-variant bg-surface-container-highest p-md transition-colors hover:border-primary ${isSelected ? 'active-glow' : 'node-glow'}`}
    >
      <div className="mb-sm flex items-start justify-between gap-sm">
        <div className="min-w-0">
          <div className="mb-xs flex items-center gap-xs text-primary">
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>{meta.icon}</span>
            <span className="truncate font-label-md text-label-md">{meta.label}</span>
            <span className="truncate font-code-sm text-code-sm text-on-surface-variant">{node.docPath ?? node.id}</span>
          </div>
          <h4 className="line-clamp-2 font-headline-sm text-headline-sm text-on-surface">{node.label}</h4>
          <div className="mt-xs flex max-w-full flex-wrap items-center gap-xs">
            <span className={`inline-flex max-w-full rounded border px-xs py-[2px] font-code-sm text-code-sm ${mvcTone(node.status === 'done' ? toneForLens(specLens) : 'default')}`}>
              <span className="truncate">{lensLabel}</span>
            </span>
            <FlowCountChips node={node} tree={tree} />
          </div>
        </div>
        <StatusBadge node={node} tree={tree} />
      </div>
      <div
        data-node-preview-kind={previewHtml ? 'prototype' : isDelivery ? 'delivery' : 'document'}
        className="min-h-0 flex-1 overflow-hidden rounded border border-outline-variant/60 bg-surface-container/70 p-sm"
      >
        {previewHtml ? (
          <div data-node-prototype-preview={node.id} className="h-full w-full">
            <PrototypePreviewSurface
              html={previewHtml}
              title={`${node.label} preview`}
              fit="thumbnail"
              interactive={false}
              surfaceClassName="!h-full !w-full"
              fallback={(
                <div className="flex h-full items-center justify-center p-xs text-center text-[10px] text-on-surface-variant">
                  预览加载中
                </div>
              )}
            />
          </div>
        ) : hasFigmaPreview
          ? <FigmaMiniPreview node={node} />
          : isDelivery
          ? <DeliveryMiniPreview sections={deliverySections} />
          : <DocumentMiniPreview node={node} tree={tree} maxLines={8} />}
      </div>
      <div className="mt-sm flex items-center justify-between border-t border-outline-variant pt-sm">
        <span className="font-label-md text-label-md text-on-surface-variant">界面与链路预览</span>
        <div className="flex items-center gap-xs">
          {hasFigmaPreview ? (
            <button
              type="button"
              onClick={handleOpenStatePreview}
              className="inline-flex min-h-[26px] items-center gap-[3px] rounded border border-tertiary/45 bg-tertiary/10 px-xs text-label-md font-medium text-tertiary transition-colors hover:border-tertiary hover:bg-tertiary/15"
              title="直接打开状态预览"
              aria-label={`打开「${node.label}」状态预览`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>view_carousel</span>
              状态
            </button>
          ) : null}
          <span className="font-label-md text-label-md text-primary opacity-0 transition-opacity group-hover:opacity-100">
            {canForge ? '双击打磨' : '单击查看'}
          </span>
        </div>
      </div>
    </div>
  )
}
