interface FigmaDraftBatchStatusStripProps {
  status: string | null
  isRunning: boolean
}

export function FigmaDraftBatchStatusStrip({ status, isRunning }: FigmaDraftBatchStatusStripProps) {
  if (!status) return null

  return (
    <div className="flex shrink-0 items-center gap-sm border-b border-tertiary/30 bg-tertiary/10 px-lg py-sm text-label-md text-on-surface-variant">
      <span
        className={['material-symbols-outlined text-tertiary', isRunning ? 'animate-spin' : ''].join(' ').trim()}
        style={{ fontSize: '18px' }}
      >
        {isRunning ? 'sync' : 'auto_awesome'}
      </span>
      <span className="font-medium text-tertiary">Figma first drafts</span>
      <span className="truncate">{status}</span>
    </div>
  )
}

