export type StateCardTone = 'complete' | 'missing' | 'info'

interface StateCardProps {
  title: string
  label: string
  body: string
  tone: StateCardTone
  meta?: string
  inputPlaceholder?: string
  confidence?: number
  missingReason?: string | null
}

const toneStyles: Record<StateCardTone, { card: string; icon: string; label: string; marker: string; symbol: string }> = {
  complete: {
    card: 'border-tertiary bg-surface-container glow-active',
    icon: 'border-tertiary/30 bg-tertiary/20 text-tertiary',
    label: 'text-tertiary',
    marker: 'bg-tertiary',
    symbol: '✓',
  },
  missing: {
    card: 'border-error border-dashed bg-error/5 glow-error',
    icon: 'border-error/30 bg-error/20 text-error animate-pulse',
    label: 'text-error',
    marker: 'bg-error',
    symbol: '!',
  },
  info: {
    card: 'border-secondary bg-surface-container',
    icon: 'border-secondary-container/50 bg-secondary-container text-on-secondary-container',
    label: 'text-secondary',
    marker: 'bg-secondary',
    symbol: 'i',
  },
}

export function StateCard({ title, label, body, tone, meta, inputPlaceholder, confidence, missingReason }: StateCardProps) {
  const styles = toneStyles[tone]

  return (
    <div className={`relative z-10 mt-md w-[300px] max-w-full shrink-0 rounded-xl border p-md transition-transform duration-300 hover:-translate-y-1 ${styles.card}`}>
      <div className={`absolute -top-md left-1/2 h-md w-px ${tone === 'missing' ? 'bg-error/50' : tone === 'info' ? 'bg-secondary/50' : 'bg-tertiary/50'}`} />
      <div className={`absolute -top-[19px] left-1/2 h-2 w-2 -translate-x-1/2 rounded-full ${styles.marker}`} />
      <div className="flex items-start gap-md">
        <div className={`mt-xs flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[14px] ${styles.icon}`}>
          {styles.symbol}
        </div>
        <div className="min-w-0 flex-1">
          <div className={`mb-xs font-mono text-label-md uppercase ${styles.label}`}>{label}</div>
          <h3 className="mb-xs text-headline-sm font-semibold text-on-surface">{title}</h3>
          <p className="text-body-md leading-relaxed text-on-surface-variant">{body}</p>
          {typeof confidence === 'number' ? (
            <div className="mt-sm">
              <div className="mb-xs flex items-center justify-between font-mono text-code-sm text-on-surface-variant">
                <span>confidence</span>
                <span>{confidence}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
                <div className={`h-full rounded-full ${tone === 'missing' ? 'bg-error' : tone === 'info' ? 'bg-secondary' : 'bg-tertiary'}`} style={{ width: `${confidence}%` }} />
              </div>
            </div>
          ) : null}
          {missingReason ? (
            <div className="mt-sm rounded-lg border border-error/20 bg-error/10 p-sm font-mono text-code-sm text-error">
              缺失原因：{missingReason}
            </div>
          ) : null}
          {meta ? (
            <div className="mt-sm border-t border-outline-variant/20 pt-sm font-mono text-code-sm text-on-surface-variant">
              {meta}
            </div>
          ) : null}
          {inputPlaceholder ? (
            <div className="mt-md flex items-center overflow-hidden rounded-lg border border-outline-variant/50 bg-surface-dim focus-within:border-error focus-within:ring-1 focus-within:ring-error/20">
              <span className="pl-sm font-mono text-code-sm text-outline">PATH</span>
              <input
                className="w-full border-none bg-transparent px-sm py-sm font-mono text-code-sm text-on-surface placeholder:text-outline focus:outline-none"
                placeholder={inputPlaceholder}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
