import type { DecompositionStep } from '../../types/prdNode'

interface DecompLiveCanvasProps {
  steps: DecompositionStep[]
  nodeCount: number
}

function stepIcon(status: DecompositionStep['status']) {
  if (status === 'complete') return 'check_circle'
  if (status === 'error') return 'error'
  if (status === 'active') return 'autorenew'
  return 'radio_button_unchecked'
}

function stepColor(status: DecompositionStep['status']) {
  if (status === 'complete') return 'border-tertiary/70 text-tertiary bg-tertiary/5'
  if (status === 'error') return 'border-error/70 text-error bg-error/5'
  if (status === 'active') return 'border-secondary-container text-on-surface bg-secondary-container/15 processing-glow'
  return 'border-outline-variant text-on-surface-variant bg-surface-container'
}

export function DecompLiveCanvas({ steps, nodeCount }: DecompLiveCanvasProps) {
  const visibleSteps = steps.length > 0
    ? steps
    : [{ label: '正在读取 PRD 文档', status: 'active' as const }]

  return (
    <div className="relative h-full overflow-hidden blueprint-grid bg-background">
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-secondary-container/10 to-transparent" />
      <div className="absolute left-10 top-10 flex items-center gap-sm rounded-lg border border-outline-variant bg-surface-container-low px-md py-sm shadow-lg">
        <span className="material-symbols-outlined text-secondary" style={{ fontSize: '18px' }}>neurology</span>
        <div>
          <p className="text-label-md font-semibold uppercase tracking-wider text-on-surface-variant">AI 正在解析</p>
          <p className="text-body-md text-on-surface">
            {nodeCount > 0 ? `已识别 ${nodeCount} 个文档节点` : '等待首批文档节点返回'}
          </p>
        </div>
      </div>

      <div className="absolute left-[12%] top-[22%] w-[300px] rounded-lg border border-outline-variant bg-surface-container p-lg shadow-2xl node-glow">
        <div className="mb-md flex items-center gap-sm text-primary">
          <span className="material-symbols-outlined">description</span>
          <span className="font-label-md text-label-md">PRD 原文</span>
        </div>
        <div className="space-y-sm">
          <span className="block h-3 w-full rounded bg-surface-container-high" />
          <span className="block h-3 w-5/6 rounded bg-surface-container-high" />
          <span className="block h-3 w-2/3 rounded bg-surface-container-high" />
          <span className="block h-3 w-4/5 rounded bg-surface-container-high" />
        </div>
        <div className="scan-line mt-lg h-px w-full bg-secondary" />
      </div>

      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 640" preserveAspectRatio="none">
        <path
          className="svg-line svg-line-live"
          pathLength={1}
          d="M 330 230 C 470 230, 460 180, 600 180"
        />
        <path
          className="svg-line svg-line-live"
          pathLength={1}
          style={{ animationDelay: '120ms' }}
          d="M 330 280 C 470 280, 460 320, 600 320"
        />
      </svg>

      <div className="absolute left-[58%] top-[15%] flex w-[360px] flex-col gap-sm">
        {visibleSteps.slice(-5).map((step, index) => {
          const isActive = step.status === 'active'
          return (
            <div
              key={`${step.label}-${index}`}
              className={[
                'flex items-start gap-sm rounded-lg border px-md py-sm shadow-lg transition-all duration-300',
                stepColor(step.status),
                isActive ? 'translate-x-0 opacity-100' : 'translate-x-3 opacity-80',
              ].join(' ')}
              style={{ animationDelay: `${index * 90}ms` }}
            >
              <span
                className={`material-symbols-outlined shrink-0 ${step.status === 'active' ? 'animate-spin' : ''}`}
                style={{ fontSize: '18px', fontVariationSettings: step.status === 'complete' ? "'FILL' 1" : undefined }}
              >
                {stepIcon(step.status)}
              </span>
              <div className="min-w-0">
                <p className="text-body-md leading-relaxed">{step.label}</p>
                {step.status === 'active' && (
                  <p className="mt-xs text-code-sm text-on-surface-variant">结构、职责和可交接文档包正在生成</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="absolute bottom-10 left-1/2 flex -translate-x-1/2 items-center gap-xs rounded-full border border-outline-variant bg-surface-container-low px-md py-sm text-code-sm text-on-surface-variant">
        <span className="h-2 w-2 rounded-full bg-tertiary pulse-dot" />
        解析结果会直接刷新到导图画布
      </div>
    </div>
  )
}
