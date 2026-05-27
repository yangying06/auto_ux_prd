import type { PrdNode } from '../../types/prdNode'

interface ForgeNodePanelProps {
  node: PrdNode
}

const TYPE_BADGE: Record<PrdNode['type'], string> = {
  module: 'bg-surface-variant text-on-surface-variant',
  feature: 'bg-secondary-container text-on-secondary-container',
  ui: 'bg-tertiary-container text-on-tertiary-container',
}

const TYPE_LABEL: Record<PrdNode['type'], string> = {
  module: '模块',
  feature: '功能',
  ui: '界面/交互',
}

function StatusBadge({ status }: { status: PrdNode['status'] }) {
  const cls =
    status === 'done'
      ? 'bg-tertiary-container text-on-tertiary-container'
      : 'bg-surface-variant text-on-surface-variant'
  const label = status === 'done' ? '已完成' : '待处理'
  return (
    <span className={`${cls} rounded px-sm py-xs text-label-md font-medium`}>{label}</span>
  )
}

export function ForgeNodePanel({ node }: ForgeNodePanelProps) {
  return (
    <aside className="w-[360px] shrink-0 h-full bg-surface-container border-r border-outline-variant flex flex-col overflow-y-auto">
      <div className="px-lg pt-lg pb-md flex items-center gap-sm flex-wrap">
        <span className={`${TYPE_BADGE[node.type]} rounded px-sm py-xs text-label-md font-medium`}>
          {TYPE_LABEL[node.type]}
        </span>
        <span className="text-code-sm text-on-primary-container bg-primary-container rounded px-sm py-xs">
          {node.id}
        </span>
      </div>

      <h2 className="px-lg pb-md text-headline-sm text-on-surface font-semibold leading-snug">
        {node.label}
      </h2>

      <div className="px-lg flex flex-col gap-md flex-1 pb-lg">
        <section>
          <p className="text-label-md text-on-surface-variant uppercase tracking-wider mb-1">摘要</p>
          <p className="text-body-md text-on-surface leading-relaxed">{node.summary}</p>
        </section>

        {node.techNotes && (
          <section>
            <p className="text-label-md text-on-surface-variant uppercase tracking-wider mb-1">技术备注</p>
            <p className="text-body-md text-on-surface-variant leading-relaxed">{node.techNotes}</p>
          </section>
        )}

        <section className="mt-auto">
          <p className="text-label-md text-on-surface-variant uppercase tracking-wider mb-1">状态</p>
          <StatusBadge status={node.status} />
        </section>
      </div>
    </aside>
  )
}
