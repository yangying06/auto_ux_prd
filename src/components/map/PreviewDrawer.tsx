import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { buildDeliverySections, isDeliveryNode } from '../../lib/prdNodeDelivery'
import type { PrdNode, PrdNodeSectionKey, PrdTree, UpdateNodePatch } from '../../types/prdNode'
import { DocumentPreview, type DocumentPreviewTab } from './DocumentPreview'
import { FigmaPreviewManager } from './FigmaPreviewManager'
import { figmaPreviewImages } from './FigmaStatePreview'

interface PreviewDrawerProps {
  node: PrdNode | null
  tree?: PrdTree | null
  onClose: () => void
  onDelete?: (node: PrdNode) => void
  onOpenDoc?: (node: PrdNode) => void
  onUpdateNode?: (nodeId: string, patch: UpdateNodePatch) => void
  onUpdateContent?: (nodeId: string, content: string) => void
  onOpenQa?: (node: PrdNode) => void
  proxyBaseUrl: string
}

const previewTabs: Array<{ id: DocumentPreviewTab; label: string; icon: string }> = [
  { id: 'overview', label: '总览', icon: 'article' },
  { id: 'view', label: '画面', icon: 'visibility' },
  { id: 'interaction', label: '操作', icon: 'account_tree' },
  { id: 'data', label: '数据', icon: 'database' },
  { id: 'contracts', label: '服务端', icon: 'dns' },
]

const activeTabFrame = 'border-[#FACC15] ring-2 ring-[#FACC15] ring-offset-1 ring-offset-surface-container shadow-[0_0_0_1px_rgba(250,204,21,0.45)]'

const tabToneMap: Partial<Record<DocumentPreviewTab, { active: string; inactive: string }>> = {
  overview: {
    active: 'bg-[#8B5CF6]/20 text-[#A78BFA]',
    inactive: 'border-[#8B5CF6]/40 bg-[#8B5CF6]/10 text-[#A78BFA] hover:border-[#8B5CF6]/70 hover:bg-[#8B5CF6]/15',
  },
  view: {
    active: 'bg-[#10B981]/20 text-[#10B981]',
    inactive: 'border-[#10B981]/35 bg-[#10B981]/10 text-[#10B981] hover:border-[#10B981]/70 hover:bg-[#10B981]/15',
  },
  interaction: {
    active: 'bg-[#F59E0B]/20 text-[#F59E0B]',
    inactive: 'border-[#F59E0B]/35 bg-[#F59E0B]/10 text-[#F59E0B] hover:border-[#F59E0B]/70 hover:bg-[#F59E0B]/15',
  },
  data: {
    active: 'bg-[#3B82F6]/20 text-[#3B82F6]',
    inactive: 'border-[#3B82F6]/35 bg-[#3B82F6]/10 text-[#3B82F6] hover:border-[#3B82F6]/70 hover:bg-[#3B82F6]/15',
  },
  contracts: {
    active: 'bg-[#8B5E3C]/25 text-[#C08457]',
    inactive: 'border-[#8B5E3C]/50 bg-[#8B5E3C]/15 text-[#C08457] hover:border-[#8B5E3C]/80 hover:bg-[#8B5E3C]/20',
  },
}

function isSectionTab(tab: DocumentPreviewTab): tab is PrdNodeSectionKey {
  return tab === 'view' || tab === 'interaction' || tab === 'data'
}

function tabTone(tab: DocumentPreviewTab, active: boolean) {
  const tone = tabToneMap[tab] ?? tabToneMap.overview
  return active ? `${tone?.active ?? ''} ${activeTabFrame}` : tone?.inactive ?? ''
}

export function PreviewDrawer({
  node,
  tree,
  onClose,
  onDelete,
  onOpenDoc,
  onUpdateNode,
  onUpdateContent,
  onOpenQa,
  proxyBaseUrl,
}: PreviewDrawerProps) {
  const [, navigate] = useLocation()
  const isOpen = node !== null
  const canForge = Boolean(node && isDeliveryNode(node, tree) && (node.needsPolish || node.status === 'done'))
  const [isEditing, setIsEditing] = useState(false)
  const [draftContent, setDraftContent] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<DocumentPreviewTab>('overview')
  const [isPreviewManagerOpen, setIsPreviewManagerOpen] = useState(false)
  const deliverySections = node ? buildDeliverySections(node, tree) : []
  const figmaPreviewCount = node ? figmaPreviewImages(node).length : 0
  const visibleTabs = node
    ? previewTabs.filter((tab) => {
      if (tab.id === 'view' && figmaPreviewCount > 0) return true
      if (isSectionTab(tab.id)) return deliverySections.some((section) => section.key === tab.id && section.status !== 'missing')
      return true
    })
    : previewTabs

  useEffect(() => {
    setIsEditing(false)
    setDraftContent(node?.content ?? '')
    setIsCollapsed(false)
    setActiveTab('overview')
    setIsPreviewManagerOpen(false)
  }, [node?.id, node?.content])

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) setActiveTab('overview')
  }, [activeTab, visibleTabs])

  const saveContent = () => {
    if (!node) return
    onUpdateContent?.(node.id, draftContent)
    setIsEditing(false)
  }

  return (
    <aside
      data-preview-drawer="true"
      className="z-20 flex shrink-0 flex-col overflow-hidden border-l border-outline-variant bg-surface-container shadow-[-8px_0_24px_rgba(0,0,0,0.5)]"
      style={{
        width: isOpen ? (isCollapsed ? '48px' : '38%') : '0',
        minWidth: isOpen ? (isCollapsed ? '48px' : '440px') : '0',
        transition: 'width 300ms ease, min-width 300ms ease',
      }}
    >
      {node && isCollapsed && (
        <div className="flex h-full flex-col items-center border-l border-outline-variant bg-surface py-md">
          <button
            onClick={() => setIsCollapsed(false)}
            title="展开详情"
            aria-label="展开详情"
            className="rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>chevron_left</span>
          </button>
          <span className="material-symbols-outlined mt-sm text-primary" style={{ fontSize: '20px' }}>route</span>
          <button
            onClick={onClose}
            title="关闭详情"
            aria-label="关闭详情"
            className="mt-auto rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
          </button>
        </div>
      )}

      {node && !isCollapsed && (
        <>
          <div className="flex shrink-0 items-center justify-between border-b border-outline-variant bg-surface p-md">
            <div className="flex min-w-0 items-center gap-sm">
              <span className="material-symbols-outlined text-primary">route</span>
              <h2 className="truncate font-headline-sm text-headline-sm text-on-surface">{node.label}</h2>
            </div>
            <div className="flex items-center gap-xs">
              <button
                onClick={() => setIsCollapsed(true)}
                title="收起详情"
                aria-label="收起详情"
                className="cursor-pointer rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
              <button
                onClick={onClose}
                title="关闭详情"
                aria-label="关闭详情"
                className="cursor-pointer rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-primary"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </div>

          {!isEditing && (
            <div className="shrink-0 border-b border-outline-variant bg-surface-container px-lg py-sm shadow-sm">
              <div className="flex gap-xs overflow-x-auto">
                {visibleTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={[
                      'flex h-9 shrink-0 items-center gap-xs rounded-lg border px-sm text-label-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15]',
                      tabTone(tab.id, activeTab === tab.id),
                    ].join(' ')}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-lg py-md">
            {isEditing ? (
              <div className="flex h-full flex-col gap-sm">
                <textarea
                  value={draftContent}
                  onChange={(event) => setDraftContent(event.target.value)}
                  className="min-h-[420px] flex-1 rounded border border-outline-variant bg-surface-container-low p-md font-code-sm text-code-sm text-on-surface outline-none focus:border-primary"
                />
                <div className="flex justify-end gap-xs">
                  <button
                    onClick={() => {
                      setDraftContent(node.content)
                      setIsEditing(false)
                    }}
                    className="rounded border border-outline-variant px-sm py-xs text-label-md text-on-surface-variant hover:bg-surface-variant"
                  >
                    取消
                  </button>
                  <button
                    onClick={saveContent}
                    className="rounded bg-primary px-sm py-xs text-label-md text-on-primary hover:bg-primary/90"
                  >
                    保存内容
                  </button>
                </div>
              </div>
            ) : (
              <DocumentPreview key={`${node.id}-${activeTab}`} node={node} tree={tree} tab={activeTab} />
            )}
          </div>

          <div className="shrink-0 border-t border-outline-variant bg-surface-container-low p-md">
            <button
              type="button"
              onClick={() => setIsPreviewManagerOpen(true)}
              className="mb-sm flex min-h-[40px] w-full items-center justify-center gap-xs rounded-lg border border-tertiary bg-tertiary-container px-md text-label-md font-medium text-on-tertiary-container transition-opacity hover:opacity-90"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>dashboard_customize</span>
              画面与状态
              {figmaPreviewCount > 0 ? (
                <span className="rounded border border-on-tertiary-container/25 px-xs font-code-sm text-code-sm">{figmaPreviewCount}</span>
              ) : null}
            </button>
            <div className="mb-sm grid grid-cols-4 gap-xs">
              <button
                onClick={() => setIsEditing(true)}
                className="rounded border border-outline-variant px-sm py-xs text-label-md text-on-surface-variant hover:bg-surface-variant"
              >
                编辑
              </button>
              <button
                onClick={() => onOpenDoc?.(node)}
                className="rounded border border-outline-variant px-sm py-xs text-label-md text-on-surface-variant hover:bg-surface-variant"
              >
                打开文档
              </button>
              <button
                onClick={() => onOpenQa?.(node)}
                className="rounded border border-primary/40 px-sm py-xs text-label-md text-primary hover:bg-primary-container/20"
              >
                提 Bug
              </button>
              <button
                onClick={() => onDelete?.(node)}
                className="rounded border border-error/40 px-sm py-xs text-label-md text-error hover:bg-error/10"
              >
                删除
              </button>
            </div>
            {canForge && (
              <button
                onClick={() => navigate('/forge/' + node.id)}
                className="flex w-full cursor-pointer items-center justify-center gap-sm rounded-lg border border-[#2b88ff]/30 bg-secondary-container px-lg py-sm font-headline-sm text-headline-sm text-on-secondary-container shadow-lg shadow-secondary-container/20 transition-all hover:bg-secondary-container/90"
              >
                <span className="material-symbols-outlined">construction</span>
                打磨文档包
              </button>
            )}
          </div>
          {isPreviewManagerOpen && onUpdateNode ? (
            <FigmaPreviewManager
              node={node}
              tree={tree}
              proxyBaseUrl={proxyBaseUrl}
              onClose={() => setIsPreviewManagerOpen(false)}
              onUpdateNode={onUpdateNode}
            />
          ) : null}
        </>
      )}
    </aside>
  )
}
