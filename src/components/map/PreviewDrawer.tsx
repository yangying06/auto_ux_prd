import { useLocation } from 'wouter'
import type { PrdNode } from '../../types/prdNode'
import { DocumentPreview } from './DocumentPreview'

interface PreviewDrawerProps {
  node: PrdNode | null
  onClose: () => void
}

export function PreviewDrawer({ node, onClose }: PreviewDrawerProps) {
  const [, navigate] = useLocation()
  const isOpen = node !== null

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
          <DocumentPreview node={node} />
        </div>
      )}

      {/* Footer */}
      {node && (
        <div className="p-md border-t border-outline-variant shrink-0 bg-surface-container-low">
          <button
            onClick={() => navigate('/forge/' + node.id)}
            className="w-full bg-secondary-container hover:bg-secondary-container/90 text-on-secondary-container font-headline-sm text-headline-sm py-sm px-lg rounded-lg flex items-center justify-center gap-sm transition-all shadow-lg shadow-secondary-container/20 border border-[#2b88ff]/30 cursor-pointer"
          >
            <span className="material-symbols-outlined">construction</span>
            打磨文档包
          </button>
        </div>
      )}
    </aside>
  )
}
