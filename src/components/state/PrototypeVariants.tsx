import { useEffect } from 'react'
import type { PrototypeVariant } from '../../types/prototypeVariant'
import { PrototypePreviewSurface } from './PrototypeSandboxPreview'

interface PrototypeVariantsProps {
  variants: PrototypeVariant[]
  selectedIndex: number
  onSelect: (index: number) => void
  onRetry?: (index: number) => void
}

function VariantThumbnail({ html }: { html: string }) {
  return <PrototypePreviewSurface html={html} title="Variant preview" />
}

export function PrototypeVariants({ variants, selectedIndex, onSelect, onRetry }: PrototypeVariantsProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.altKey) return
      const match = /^Digit([1-9])$/.exec(event.code)
      if (!match) return
      const position = Number(match[1]) - 1
      const variant = variants[position]
      if (!variant) return
      event.preventDefault()
      onSelect(variant.index)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [variants, onSelect])

  if (variants.length === 0) return null

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-xs">
      <div className="grid grid-cols-2 gap-sm">
        {variants.map((variant, position) => {
        const isSelected = variant.index === selectedIndex
        return (
          <button
            key={variant.index}
            type="button"
            onClick={() => onSelect(variant.index)}
            title={variant.focus ?? `方案 ${position + 1}`}
            className={[
              'group relative flex flex-col overflow-hidden rounded-xl border bg-zinc-950 text-left transition-all',
              isSelected
                ? 'border-secondary ring-2 ring-secondary'
                : 'border-outline-variant/30 hover:border-secondary/50',
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-xs border-b border-outline-variant/20 bg-zinc-900/80 px-sm py-xs">
              <span className="font-mono text-[10px] uppercase text-on-surface-variant">
                <kbd className="rounded bg-outline-variant/20 px-1">Alt+{position + 1}</kbd> 方案 {position + 1}
              </span>
              {isSelected ? (
                <span className="material-symbols-outlined text-secondary" style={{ fontSize: '16px', fontVariationSettings: "'FILL' 1" }}>
                  check_circle
                </span>
              ) : null}
            </div>

            <div>
              {variant.status === 'complete' && variant.html ? (
                <VariantThumbnail html={variant.html} />
              ) : variant.status === 'streaming' && variant.html ? (
                <>
                  <VariantThumbnail html={variant.html} />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60 px-sm py-xs font-mono text-[10px] text-secondary">
                    流式生成中...
                  </div>
                </>
              ) : variant.status === 'error' ? (
                <div className="flex flex-col items-center gap-sm p-md text-center">
                  <span className="material-symbols-outlined text-error" style={{ fontSize: '28px' }}>
                    error
                  </span>
                  <p className="font-mono text-[11px] text-on-surface-variant">该方案生成失败</p>
                  {onRetry ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation()
                        onRetry(variant.index)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.stopPropagation()
                          onRetry(variant.index)
                        }
                      }}
                      className="cursor-pointer rounded border border-secondary/30 bg-secondary/10 px-sm py-xs font-mono text-[10px] uppercase text-secondary transition-colors hover:bg-secondary/20"
                    >
                      重试
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="flex w-full flex-col items-center gap-sm p-md">
                  <div className="h-2 w-2/3 animate-pulse rounded-full bg-outline-variant/30" />
                  <div className="h-2 w-1/2 animate-pulse rounded-full bg-outline-variant/20" />
                  <div className="mt-sm flex gap-xs">
                    <div className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:0ms]" />
                    <div className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:150ms]" />
                    <div className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:300ms]" />
                  </div>
                  <p className="font-mono text-[10px] text-on-surface-variant">生成中...</p>
                </div>
              )}
            </div>

            {variant.focus ? (
              <p className="truncate border-t border-outline-variant/20 bg-zinc-900/60 px-sm py-xs font-mono text-[10px] text-on-surface-variant">
                {variant.focus}
              </p>
            ) : null}
          </button>
        )
      })}
      </div>
    </div>
  )
}
