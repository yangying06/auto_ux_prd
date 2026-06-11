import { formatPrototypeVersionTime } from '../../lib/prototypeUtils'
import type { PrototypeVersion } from '../../store/appStore'
import { PrototypePreviewSurface } from './PrototypeSandboxPreview'

interface PrototypeBoardProps {
  html: string | null
  history: PrototypeVersion[]
  isLoading: boolean
  singlePrototypeOnly?: boolean
  onSinglePrototypeOnlyChange?: (checked: boolean) => void
  onRestore: (id: string) => void
  onClearHistory: () => void
  canClearHistory?: boolean
}

export function PrototypeBoard({
  html,
  history,
  isLoading,
  singlePrototypeOnly,
  onSinglePrototypeOnlyChange,
  onRestore,
  onClearHistory,
  canClearHistory,
}: PrototypeBoardProps) {
  const clearHistoryEnabled = canClearHistory ?? history.length > 0

  function handleRestore(id: string) {
    if (!id) return
    onRestore(id)
  }

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-outline-variant/30 bg-zinc-950 shadow-inner">
      <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="z-10 flex flex-wrap items-center justify-between gap-sm border-b border-outline-variant/20 bg-zinc-900/80 p-sm backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-sm">
          <span className="font-mono text-code-sm text-on-surface-variant">Sandbox 预览</span>
          <span className="rounded-full bg-outline-variant/10 px-sm py-xs font-mono text-[10px] uppercase text-on-surface-variant">
            {isLoading ? '生成中...' : html ? '原型已就绪' : '等待需求输入'}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-xs">
          <select
            value=""
            onChange={(event) => handleRestore(event.target.value)}
            disabled={history.length === 0 || isLoading}
            title="恢复历史版本"
            className="h-8 max-w-[180px] rounded-md border border-outline-variant/40 bg-surface-container-high px-sm font-mono text-[11px] text-on-surface-variant outline-none disabled:opacity-40"
          >
            <option value="">历史版本</option>
            {history.map((version) => (
              <option key={version.id} value={version.id}>
                {version.label} · {formatPrototypeVersionTime(version.createdAt)}
              </option>
            ))}
          </select>
          <label className="flex h-8 items-center gap-xs rounded-md border border-outline-variant/40 bg-surface-container-high px-sm font-mono text-[11px] text-on-surface-variant">
            <input
              type="checkbox"
              checked={singlePrototypeOnly ?? false}
              onChange={(event) => onSinglePrototypeOnlyChange?.(event.target.checked)}
              disabled={isLoading || !onSinglePrototypeOnlyChange}
              className="h-3.5 w-3.5 accent-secondary"
            />
            快速单稿
          </label>
          <button
            type="button"
            onClick={onClearHistory}
            disabled={!clearHistoryEnabled || isLoading}
            title="清空历史版本"
            className="h-8 rounded-md border border-outline-variant/40 bg-surface-container-high px-sm font-mono text-[11px] text-on-surface-variant transition-colors hover:border-error hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
          >
            清空历史
          </button>
        </div>
      </div>

      <div className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
        <PrototypePreviewSurface
          html={html}
          title="UX prototype preview"
          interactive
          fit="fullPage"
          fallback={(
              <div className="flex h-full items-center justify-center p-md">
                {isLoading ? (
                  <div className="flex flex-col items-center gap-md">
                    <div className="flex gap-xs">
                      <div className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:0ms]" />
                      <div className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:150ms]" />
                      <div className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:300ms]" />
                    </div>
                    <p className="font-mono text-code-sm text-on-surface-variant">正在生成原型...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-md text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-outline-variant/30 bg-surface-container font-mono text-2xl text-on-surface-variant">
                      ◻
                    </div>
                    <p className="font-mono text-code-sm text-on-surface-variant">原型预览将在此生成。</p>
                  </div>
                )}
              </div>
          )}
        />
      </div>

      {history.length > 0 ? (
        <div className="relative z-10 border-t border-outline-variant/20 bg-zinc-900/90 px-sm py-xs">
          <div className="flex gap-xs overflow-hidden">
            {history.slice(0, 3).map((version) => (
              <button
                key={version.id}
                onClick={() => onRestore(version.id)}
                disabled={isLoading}
                title={version.note ?? '恢复此版本'}
                className="min-w-0 rounded border border-outline-variant/30 bg-surface-container-high px-sm py-xs font-mono text-[10px] text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
              >
                <span className="block truncate">{version.label} · {version.mode}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
