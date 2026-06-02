import type { PrdNodeOperationSuggestion, PrdNodeSourceKind } from '../../types/prdNode'

interface NodeOperationReviewProps {
  suggestions: PrdNodeOperationSuggestion[]
  onApply: (suggestionId: string) => void
  onDismiss: (suggestionId: string) => void
}

function sourceLabel(sourceKind: PrdNodeSourceKind | undefined) {
  if (sourceKind === 'prd') return 'PRD 原文'
  if (sourceKind === 'upload') return '上传资料'
  return '用户补充'
}

function sourceTone(sourceKind: PrdNodeSourceKind | undefined) {
  if (sourceKind === 'prd') return 'border-tertiary/40 bg-tertiary-container/20 text-tertiary'
  if (sourceKind === 'upload') return 'border-primary/40 bg-primary-container/20 text-primary'
  return 'border-secondary/40 bg-secondary/10 text-secondary'
}

export function NodeOperationReview({ suggestions, onApply, onDismiss }: NodeOperationReviewProps) {
  return (
    <div className="max-h-52 space-y-xs overflow-y-auto rounded-lg border border-primary/30 bg-primary/5 p-sm">
      <div className="flex items-center gap-xs font-mono text-[10px] uppercase text-primary">
        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>rule_settings</span>
        待确认节点建议
      </div>
      {suggestions.map((suggestion) => {
        const sourceKind = suggestion.patch.sourceKind ?? suggestion.evidenceRefs[0]?.sourceKind
        return (
          <div key={suggestion.id} className="rounded-lg border border-outline-variant bg-surface p-sm">
            <div className="mb-xs flex items-center justify-between gap-sm">
              <div className="min-w-0">
                <div className="truncate text-label-md text-on-surface">
                  {suggestion.operation === 'create' ? '新增' : '更新'}：{suggestion.patch.label ?? suggestion.targetNodeId ?? suggestion.parentId}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-on-surface-variant">
                  {suggestion.operation === 'create' ? `挂到 ${suggestion.parentId ?? '当前节点'}` : `目标 ${suggestion.targetNodeId}`}
                  {' · 置信度 '}{suggestion.confidence}%
                </div>
              </div>
              <span className={`shrink-0 rounded border px-xs py-[2px] font-mono text-[10px] ${sourceTone(sourceKind)}`}>
                {sourceLabel(sourceKind)}
              </span>
            </div>
            <p className="mb-sm line-clamp-2 text-body-sm text-on-surface-variant">{suggestion.rationale}</p>
            <div className="flex justify-end gap-xs">
              <button
                onClick={() => onDismiss(suggestion.id)}
                className="rounded border border-outline-variant px-sm py-xs text-label-sm text-on-surface-variant hover:border-error hover:text-error"
              >
                忽略
              </button>
              <button
                onClick={() => onApply(suggestion.id)}
                className="rounded border border-primary bg-primary-container px-sm py-xs text-label-sm text-on-primary-container hover:opacity-90"
              >
                应用
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
