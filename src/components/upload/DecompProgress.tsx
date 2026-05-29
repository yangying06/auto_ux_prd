interface DecompProgressProps {
  steps: Array<{ label: string; status: 'pending' | 'active' | 'complete' | 'error' }>
  nodeCount: number
  error?: string | null
}

export function DecompProgress({ steps, nodeCount, error }: DecompProgressProps) {
  const activeStep = steps.find((step) => step.status === 'active')
  const completedSteps = steps.filter((step) => step.status === 'complete').length
  const progressValue = steps.length > 0
    ? Math.min(100, Math.round((completedSteps / steps.length) * 100))
    : 0
  const statusText = error
    ? 'PRD 分析失败'
    : nodeCount > 0
      ? `已生成 ${nodeCount} 个文档节点`
      : activeStep?.label ?? '等待 AI 返回首批文档包'

  return (
    <>
      {/* Header row */}
      <div className="flex items-center gap-2 w-full">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${error ? 'bg-error' : 'pulse-dot bg-secondary-container'}`} />
        <span className="min-w-0 flex-1 text-headline-sm text-on-surface">{statusText}</span>
        <span className="shrink-0 text-label-md text-on-surface-variant">
          {nodeCount > 0 ? `${nodeCount} 个文档节点` : ''}
        </span>
      </div>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
        <div
          className={`h-full rounded-full transition-all duration-500 ${error ? 'bg-error' : 'bg-secondary-container'}`}
          style={{ width: `${error ? 100 : progressValue}%` }}
        />
      </div>

      {/* Step list */}
      <div className="w-full flex flex-col gap-1 mt-6">
        {steps.map((step, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 min-h-10 px-2 py-2 rounded ${
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
            <span className={`min-w-0 break-words text-body-md ${
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
          {nodeCount > 0 ? `已发现 ${nodeCount} 个文档节点` : 'AI 尚未返回可展示的文档包节点'}
        </span>
      </div>
    </>
  )
}
