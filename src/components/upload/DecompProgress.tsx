interface DecompProgressProps {
  steps: Array<{ label: string; status: 'pending' | 'active' | 'complete' | 'error' }>
  nodeCount: number
  error?: string | null
}

export function DecompProgress({ steps, nodeCount, error }: DecompProgressProps) {
  return (
    <>
      {/* Header row */}
      <div className="flex items-center gap-2 w-full">
        <span className="pulse-dot bg-secondary-container w-2 h-2 rounded-full flex-shrink-0" />
        <span className="text-headline-sm text-on-surface">正在分析PRD文档...</span>
        <span className="text-label-md text-on-surface-variant ml-auto">
          {nodeCount > 0 ? `${nodeCount} 个节点` : ''}
        </span>
      </div>

      {/* Step list */}
      <div className="w-full flex flex-col gap-1 mt-6">
        {steps.map((step, i) => (
          <div
            key={i}
            className={`flex items-center gap-2 h-10 px-2 rounded ${
              step.status === 'active' ? 'bg-surface-container' : ''
            } ${step.status === 'error' ? 'bg-error-container/10' : ''}`}
          >
            {step.status === 'pending' && (
              <span className="material-symbols-outlined text-outline" style={{ fontSize: '16px' }}>radio_button_unchecked</span>
            )}
            {step.status === 'active' && (
              <span className="material-symbols-outlined text-secondary-container animate-spin" style={{ fontSize: '16px' }}>autorenew</span>
            )}
            {step.status === 'complete' && (
              <span className="material-symbols-outlined text-tertiary" style={{ fontSize: '16px', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            )}
            {step.status === 'error' && (
              <span className="material-symbols-outlined text-error" style={{ fontSize: '16px' }}>error</span>
            )}
            <span className={`text-body-md ${
              step.status === 'active' ? 'text-on-surface' :
              step.status === 'error' ? 'text-error' :
              'text-on-surface-variant'
            }`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="w-full bg-error-container/10 border border-error-container rounded-lg px-4 py-2 flex items-start gap-2 mt-4">
          <span className="material-symbols-outlined text-error flex-shrink-0" style={{ fontSize: '18px' }}>error_outline</span>
          <div>
            <p className="text-body-lg text-error">分析失败</p>
            <p className="text-body-md text-on-surface-variant">{error}</p>
          </div>
        </div>
      )}

      {/* Node count badge */}
      <div className="flex items-center gap-1 border-t border-outline-variant pt-2 mt-4 w-full">
        <span className="material-symbols-outlined text-tertiary" style={{ fontSize: '14px' }}>account_tree</span>
        <span className="text-code-sm text-on-surface-variant">
          已发现 {nodeCount} 个节点
        </span>
      </div>
    </>
  )
}
