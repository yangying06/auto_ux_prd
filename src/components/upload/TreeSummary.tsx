import type { PrdTree } from '../../types/prdNode'

interface TreeSummaryProps {
  tree: PrdTree
  nodeCount: number
  onReset: () => void
  onViewMap: () => void
}

export function TreeSummary({ tree, nodeCount, onReset, onViewMap }: TreeSummaryProps) {
  const nodes = Object.values(tree)
  const roots = nodes
    .filter((n) => n.level === 1)
    .sort((a, b) => a.order - b.order)

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 w-full">
        <span
          className="material-symbols-outlined text-tertiary flex-shrink-0"
          style={{ fontSize: '18px', fontVariationSettings: "'FILL' 1" }}
        >
          check_circle
        </span>
        <span className="text-headline-sm text-on-surface">拆解完成</span>
        <span className="text-label-md text-on-surface-variant ml-auto">共 {nodeCount} 个节点</span>
      </div>

      {/* Module list */}
      <div className="w-full flex flex-col gap-1 mt-4">
        {roots.map((root) => {
          const childCount = nodes.filter((n) => n.parentId === root.id).length
          return (
            <div
              key={root.id}
              className="flex items-start gap-3 px-3 py-2 rounded bg-surface-container border border-outline-variant/50"
            >
              <span className="text-code-sm text-on-primary-container mt-0.5 flex-shrink-0">{root.id}</span>
              <div className="flex-1 min-w-0">
                <p className="text-body-md text-on-surface truncate">{root.label}</p>
                {childCount > 0 && (
                  <p className="text-body-md text-on-surface-variant">{childCount} 个子节点</p>
                )}
              </div>
              {root.needsPolish && (
                <span className="text-label-md text-secondary flex-shrink-0">需打磨</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer: view map + reset */}
      <div className="w-full border-t border-outline-variant pt-4 mt-2 flex flex-col gap-2">
        <button
          className="w-full flex items-center justify-center gap-2 bg-secondary-container hover:bg-secondary-container/90
            text-on-secondary-container border border-[#2b88ff]/30 rounded-lg px-4 py-2
            text-label-md font-headline-sm transition-colors min-h-[44px]"
          onClick={onViewMap}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>account_tree</span>
          查看导图
        </button>
        <button
          className="w-full flex items-center justify-center gap-2 bg-surface-container-high hover:bg-surface-variant
            border border-outline-variant rounded-lg px-4 py-2
            text-label-md text-on-surface-variant transition-colors min-h-[44px]"
          onClick={onReset}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>upload_file</span>
          重新上传
        </button>
      </div>
    </>
  )
}
