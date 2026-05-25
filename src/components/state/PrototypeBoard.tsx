interface PrototypeBoardProps {
  html: string | null
  isLoading: boolean
}

export function PrototypeBoard({ html, isLoading }: PrototypeBoardProps) {
  return (
    <section className="relative flex h-[45%] flex-col overflow-hidden rounded-xl border border-outline-variant/30 bg-zinc-900 shadow-inner">
      <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="z-10 flex items-center justify-between border-b border-outline-variant/20 bg-zinc-900/80 p-sm backdrop-blur-sm">
        <span className="font-mono text-code-sm text-on-surface-variant">VIEW · Whitebox Prototype</span>
        <span className="rounded-full bg-outline-variant/10 px-sm py-xs font-mono text-[10px] uppercase text-on-surface-variant">
          {isLoading ? '生成中...' : html ? '原型已就绪' : '等待需求输入'}
        </span>
      </div>

      <div className="relative z-0 flex-1 overflow-hidden">
        {html ? (
          <iframe
            srcDoc={html}
            className="h-full w-full border-none"
            sandbox="allow-scripts"
            title="UX Prototype Preview"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
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
                <p className="font-mono text-code-sm text-on-surface-variant">在左侧描述你的交互需求，原型预览将在此生成。</p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
