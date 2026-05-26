import { useParams } from 'wouter'
import { useLocation } from 'wouter'

export function ForgePage() {
  const { nodeId } = useParams<{ nodeId: string }>()
  const [, navigate] = useLocation()

  return (
    <div className="w-full h-screen flex flex-col items-center justify-center bg-background blueprint-grid gap-4">
      <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: '48px' }}>
        construction
      </span>
      <h1 className="text-headline-sm text-on-surface">Deep Forge</h1>
      <p className="text-body-md text-on-surface-variant">
        Node: <span className="text-code-sm text-secondary">{nodeId}</span>
      </p>
      <p className="text-body-md text-on-surface-variant">
        Deep Forge coming in Phase 3
      </p>
      <button
        className="mt-4 flex items-center gap-2 border border-outline-variant rounded-lg px-4 py-2
          text-label-md text-on-surface-variant hover:text-on-surface hover:border-outline
          transition-colors min-h-[44px]"
        onClick={() => navigate('/')}
      >
        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_back</span>
        Back to Map
      </button>
    </div>
  )
}
