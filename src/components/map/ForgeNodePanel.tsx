import type { PrdNode } from '../../types/prdNode'
import { DocumentPreview } from './DocumentPreview'

interface ForgeNodePanelProps {
  node: PrdNode
}

function statusLabel(node: PrdNode) {
  if (node.status === 'done') return '已确认'
  return node.needsPolish ? '待补齐' : '可直接导出'
}

function audienceLabel(audience: PrdNode['audience']) {
  if (audience === 'client') return '客户端'
  if (audience === 'server') return '服务端'
  if (audience === 'config') return '配置'
  if (audience === 'api') return '接口'
  if (audience === 'acceptance') return '验收'
  if (audience === 'appendix') return '附录'
  if (audience === 'overview') return '概览'
  if (audience === 'mixed') return '跨职责'
  return '文档包'
}

export function ForgeNodePanel({ node }: ForgeNodePanelProps) {
  return (
    <aside className="flex h-full w-[460px] shrink-0 flex-col overflow-hidden border-r border-outline-variant bg-surface-container">
      <div className="shrink-0 border-b border-outline-variant bg-surface px-lg py-md">
        <div className="flex flex-wrap items-center gap-sm">
          <span className="rounded bg-primary-container px-sm py-xs text-label-md font-medium text-on-primary-container">
            {audienceLabel(node.audience)}
          </span>
          <span className="rounded bg-surface-container-high px-sm py-xs font-code-sm text-code-sm text-on-surface-variant">
            {node.docPath ?? node.id}
          </span>
          <span className={[
            'rounded px-sm py-xs text-label-md font-medium',
            node.status === 'done'
              ? 'bg-tertiary-container text-on-tertiary-container'
              : node.needsPolish
                ? 'bg-secondary-container text-on-secondary-container'
                : 'bg-surface-variant text-on-surface-variant',
          ].join(' ')}>
            {statusLabel(node)}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-lg py-md">
        <DocumentPreview node={node} variant="full" />
      </div>
    </aside>
  )
}
