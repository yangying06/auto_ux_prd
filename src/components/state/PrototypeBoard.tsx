import { useEffect, useMemo, useRef, useState } from 'react'
import { formatPrototypeVersionTime, normalizePrototypeHtml } from '../../lib/prototypeUtils'
import type { PrototypeVersion } from '../../store/appStore'

interface PrototypeBoardProps {
  html: string | null
  history: PrototypeVersion[]
  isLoading: boolean
  singlePrototypeOnly?: boolean
  onSinglePrototypeOnlyChange?: (checked: boolean) => void
  onIterate: (instruction: string) => void
  onRestore: (id: string) => void
  onClearHistory: () => void
}

export function PrototypeBoard({
  html,
  history,
  isLoading,
  singlePrototypeOnly,
  onSinglePrototypeOnlyChange,
  onIterate,
  onRestore,
  onClearHistory,
}: PrototypeBoardProps) {
  const [draft, setDraft] = useState('')
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const normalizedHtml = useMemo(() => (html ? normalizePrototypeHtml(html) : null), [html])

  function hydrateSandbox() {
    if (!normalizedHtml) return
    iframeRef.current?.contentWindow?.postMessage({ action: 'hydrate', html: normalizedHtml }, '*')
  }

  useEffect(() => {
    hydrateSandbox()
  }, [normalizedHtml])

  function handleIterate() {
    const instruction = draft.trim()
    if (!instruction || isLoading || !html) return
    setDraft('')
    onIterate(instruction)
  }

  function handleRestore(id: string) {
    if (!id) return
    onRestore(id)
  }

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-outline-variant/30 bg-zinc-950 shadow-inner">
      <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="z-10 flex items-center justify-between border-b border-outline-variant/20 bg-zinc-900/80 p-sm backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-sm">
          <span className="font-mono text-code-sm text-on-surface-variant">Sandbox 预览 · 375 × 812</span>
          <span className="rounded-full bg-outline-variant/10 px-sm py-xs font-mono text-[10px] uppercase text-on-surface-variant">
            {isLoading ? '生成中...' : html ? '原型已就绪' : '等待需求输入'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-xs">
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
            只生成一个
          </label>
          <button
            type="button"
            onClick={onClearHistory}
            disabled={history.length === 0 || isLoading}
            title="清空历史版本"
            className="h-8 rounded-md border border-outline-variant/40 bg-surface-container-high px-sm font-mono text-[11px] text-on-surface-variant transition-colors hover:border-error hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
          >
            清空历史
          </button>
        </div>
      </div>

      <div className="relative z-0 flex min-h-0 flex-1 items-center justify-center overflow-hidden p-md">
        <div className="flex h-full max-h-full aspect-[375/812] flex-col overflow-hidden rounded-[2rem] border-[10px] border-zinc-800 bg-black shadow-2xl ring-1 ring-white/10">
          <div className="mx-auto mt-2 h-1.5 w-16 shrink-0 rounded-full bg-zinc-700" />
          <div className="m-2 min-h-0 flex-1 overflow-hidden rounded-[1.25rem] bg-zinc-950">
            {normalizedHtml ? (
              <iframe
                ref={iframeRef}
                src="/sandbox.html"
                className="h-full w-full border-none"
                sandbox={import.meta.env.DEV ? 'allow-scripts allow-same-origin' : 'allow-scripts'}
                onLoad={hydrateSandbox}
                title="UX 原型预览"
              />
            ) : (
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
                    <p className="font-mono text-code-sm text-on-surface-variant">375 × 812 手机预览将在此生成。</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative z-10 border-t border-outline-variant/20 bg-zinc-900/90 p-sm">
        <div className="flex gap-sm">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!html || isLoading}
            rows={2}
            placeholder="输入原型修改说明..."
            className="min-h-[52px] flex-1 resize-none rounded-md border border-outline-variant/30 bg-surface-container px-sm py-xs text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant/60 focus:border-secondary disabled:opacity-40"
          />
          <button
            onClick={handleIterate}
            disabled={!draft.trim() || !html || isLoading}
            title="应用原型修改"
            className="flex w-[92px] shrink-0 items-center justify-center gap-xs rounded-md border border-secondary/30 bg-secondary/10 px-sm py-xs font-mono text-[11px] uppercase text-secondary transition-colors hover:bg-secondary/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
              edit
            </span>
            修改
          </button>
        </div>
        {history.length > 0 ? (
          <div className="mt-xs flex gap-xs overflow-hidden">
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
        ) : null}
      </div>
    </section>
  )
}
