import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import type { PrdNode } from '../../types/prdNode'
import { DocumentPreview } from './DocumentPreview'

interface PreviewDrawerProps {
  node: PrdNode | null
  onClose: () => void
  onDelete?: (node: PrdNode) => void
  onOpenDoc?: (node: PrdNode) => void
  onUpdateContent?: (nodeId: string, content: string) => void
}

export function PreviewDrawer({ node, onClose, onDelete, onOpenDoc, onUpdateContent }: PreviewDrawerProps) {
  const [, navigate] = useLocation()
  const isOpen = node !== null
  const canForge = Boolean(node && node.type === 'page' && node.needsPolish && node.status !== 'done')
  const [isEditing, setIsEditing] = useState(false)
  const [draftContent, setDraftContent] = useState('')

  useEffect(() => {
    setIsEditing(false)
    setDraftContent(node?.content ?? '')
  }, [node?.id, node?.content])

  const saveContent = () => {
    if (!node) return
    onUpdateContent?.(node.id, draftContent)
    setIsEditing(false)
  }

  return (
    <aside
      className="bg-surface-container border-l border-outline-variant shadow-[-8px_0_24px_rgba(0,0,0,0.5)] flex flex-col z-20 shrink-0 overflow-hidden"
      style={{
        width: isOpen ? '38%' : '0',
        minWidth: isOpen ? '440px' : '0',
        transition: 'width 300ms ease, min-width 300ms ease',
      }}
    >
      {/* Header */}
      <div className="flex justify-between items-center p-md border-b border-outline-variant shrink-0 bg-surface">
        <div className="flex items-center gap-sm">
          <span className="material-symbols-outlined text-primary">data_object</span>
          <h2 className="font-headline-sm text-headline-sm text-on-surface truncate">{node?.label}</h2>
        </div>
        <button
          onClick={onClose}
          className="text-on-surface-variant hover:text-primary transition-colors cursor-pointer p-xs rounded hover:bg-surface-variant"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      {/* Content — only render internals when node is available to avoid layout artifacts */}
      {node && (
        <div className="flex-1 overflow-y-auto custom-scrollbar px-lg py-md">
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
            <DocumentPreview node={node} />
          )}
        </div>
      )}

      {/* Footer */}
      {node && (
        <div className="p-md border-t border-outline-variant shrink-0 bg-surface-container-low">
          <div className="mb-sm grid grid-cols-3 gap-xs">
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
              onClick={() => onDelete?.(node)}
              className="rounded border border-error/40 px-sm py-xs text-label-md text-error hover:bg-error/10"
            >
              删除
            </button>
          </div>
          {canForge && (
            <button
              onClick={() => navigate('/forge/' + node.id)}
              className="w-full bg-secondary-container hover:bg-secondary-container/90 text-on-secondary-container font-headline-sm text-headline-sm py-sm px-lg rounded-lg flex items-center justify-center gap-sm transition-all shadow-lg shadow-secondary-container/20 border border-[#2b88ff]/30 cursor-pointer"
            >
              <span className="material-symbols-outlined">construction</span>
              打磨文档包
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
