import { useEffect, useState } from 'react'
import type { PrdNode, PrdUiStateKind } from '../../types/prdNode'

export type FigmaPreviewWithImage = NonNullable<PrdNode['figmaPreviews']>[number] & { imageUrl: string }

export function figmaPreviewImages(node: PrdNode) {
  return (node.figmaPreviews ?? []).filter((preview): preview is FigmaPreviewWithImage => Boolean(preview.imageUrl))
}

function largestPreview(previews: FigmaPreviewWithImage[]) {
  const primary = previews.find((preview) => preview.isPrimary)
  if (primary) return primary
  return previews.reduce((best, preview) => (
    preview.width * preview.height > best.width * best.height ? preview : best
  ), previews[0])
}

function previewKey(preview: FigmaPreviewWithImage, index: number) {
  return `${preview.nodeId}|${preview.imageUrl}|${preview.sourceUrl}|${index}`
}

const FIGMA_STATE_KIND_LABELS: Record<PrdUiStateKind, string> = {
  default: '默认',
  overlay: '浮层',
  loading: '加载',
  success: '成功',
  error: '错误',
  empty: '空态',
  disabled: '禁用',
  expanded: '展开',
  collapsed: '收起',
  localized: '语言',
  mirror: '镜像',
  selected: '选中',
  variant: '变体',
}

function stateKindLabel(kind: PrdUiStateKind) {
  return FIGMA_STATE_KIND_LABELS[kind] ?? FIGMA_STATE_KIND_LABELS.variant
}

function stateForPreview(node: PrdNode, preview: FigmaPreviewWithImage) {
  return node.uiStates?.find((state) => state.figmaNodeId === preview.nodeId) ?? null
}

export function FigmaMiniPreview({ node }: { node: PrdNode }) {
  const previews = figmaPreviewImages(node)
  if (!previews.length) return null
  const primary = largestPreview(previews)
  const secondary = previews.filter((preview) => preview !== primary).slice(0, 3)
  const overflowCount = previews.length - secondary.length - 1

  return (
    <div className="flex h-full min-h-0 gap-xs overflow-hidden">
      <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded bg-black">
        <img
          src={primary.imageUrl}
          alt={primary.name}
          draggable={false}
          className="h-full w-full object-contain"
        />
      </div>
      {previews.length > 1 ? (
        <div className="flex w-[72px] shrink-0 flex-col gap-xs overflow-hidden">
          {secondary.map((preview, index) => (
            <div
              key={previewKey(preview, index)}
              title={preview.name}
              className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded border border-outline-variant/60 bg-black"
            >
              <img
                src={preview.imageUrl}
                alt={preview.name}
                draggable={false}
                className="h-full w-full object-contain"
              />
            </div>
          ))}
          {overflowCount > 0 ? (
            <div className="flex h-7 shrink-0 items-center justify-center rounded border border-outline-variant/60 bg-surface-container-high font-code-sm text-[10px] text-on-surface-variant">
              +{overflowCount}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function FigmaStatePreviewPanel({ node }: { node: PrdNode }) {
  const previews = figmaPreviewImages(node)
  if (!previews.length) return null

  return (
    <section className="rounded-lg border border-outline-variant bg-surface-container-low p-md">
      <div className="mb-sm flex items-center justify-between gap-sm">
        <div className="flex min-w-0 items-center gap-xs text-tertiary">
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>view_carousel</span>
          <h2 className="truncate text-headline-sm font-semibold text-on-surface">Figma 界面状态</h2>
        </div>
        <span className="shrink-0 rounded border border-tertiary/40 bg-tertiary/10 px-sm py-xs font-code-sm text-code-sm text-tertiary">
          {previews.length} 张
        </span>
      </div>
      {node.figmaUxMap ? (
        <div className="mb-sm rounded border border-tertiary/30 bg-tertiary/10 px-sm py-xs text-body-sm text-on-surface-variant">
          UX Map：{node.figmaUxMap.screenLabel} · {node.figmaUxMap.reviewSource} · {node.figmaUxMap.reviewConfidence}%
        </div>
      ) : null}
      <div className="grid gap-sm md:grid-cols-2">
        {previews.map((preview, index) => {
          const state = stateForPreview(node, preview)
          return (
            <figure key={previewKey(preview, index)} className="min-w-0 overflow-hidden rounded border border-outline-variant/70 bg-black">
              <div className="flex h-[320px] items-center justify-center overflow-hidden">
                <img
                  src={preview.imageUrl}
                  alt={preview.name}
                  draggable={false}
                  className="h-full w-full object-contain"
                />
              </div>
              <figcaption className="space-y-xs border-t border-outline-variant/70 bg-surface-container px-sm py-xs text-label-md text-on-surface-variant">
                <div className="flex min-h-[24px] items-center justify-between gap-sm">
                  <span className="truncate text-on-surface">{index + 1}. {state?.label ?? preview.name}</span>
                  <span className="shrink-0 rounded border border-tertiary/40 bg-tertiary/10 px-xs font-code-sm text-code-sm text-tertiary">
                    {state ? stateKindLabel(state.kind) : '截图'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-sm font-code-sm text-code-sm">
                  <span className="truncate">{preview.name}</span>
                  <span className="shrink-0">{Math.round(preview.width)}x{Math.round(preview.height)}</span>
                </div>
                {state?.annotations.length ? (
                  <div className="max-h-10 overflow-hidden text-body-sm leading-snug text-on-surface-variant">
                    注释：{state.annotations.join(' / ')}
                  </div>
                ) : null}
                {state?.visibleTexts.length ? (
                  <div className="truncate text-body-sm text-on-surface-variant">
                    文案：{state.visibleTexts.slice(0, 4).join(' / ')}
                  </div>
                ) : null}
              </figcaption>
            </figure>
          )
        })}
      </div>
    </section>
  )
}

export function FigmaStatePreviewModal({ node, onClose }: { node: PrdNode; onClose: () => void }) {
  const previews = figmaPreviewImages(node)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setActiveIndex(0)
  }, [node.id])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') setActiveIndex((current) => Math.max(0, current - 1))
      if (event.key === 'ArrowRight') setActiveIndex((current) => Math.min(previews.length - 1, current + 1))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, previews.length])

  if (!previews.length) return null
  const active = previews[Math.min(activeIndex, previews.length - 1)]!
  const activeState = stateForPreview(node, active)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-md py-lg" role="dialog" aria-modal="true" aria-label={`${node.label} 界面状态预览`}>
      <section className="flex h-full max-h-[92vh] w-full max-w-[1280px] flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-sm border-b border-outline-variant bg-surface-container-low px-lg py-md">
          <div className="min-w-0">
            <div className="flex items-center gap-xs text-tertiary">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>view_carousel</span>
              <h2 className="truncate text-headline-sm font-semibold text-on-surface">界面状态预览</h2>
            </div>
            <p className="mt-xs truncate text-body-sm text-on-surface-variant">{node.label} · {previews.length} 张 Figma 状态图</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
            aria-label="关闭界面状态预览"
            title="关闭"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>
        <main className="grid min-h-0 flex-1 gap-md bg-zinc-950 p-md lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-outline-variant/50 bg-black">
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-sm">
              <img
                src={active.imageUrl}
                alt={active.name}
                draggable={false}
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-sm border-t border-outline-variant/60 bg-surface-container-low px-md py-sm">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-xs">
                  <div className="truncate text-label-lg font-medium text-on-surface">{activeIndex + 1}. {activeState?.label ?? active.name}</div>
                  {activeState ? (
                    <span className="shrink-0 rounded border border-tertiary/40 bg-tertiary/10 px-xs font-code-sm text-code-sm text-tertiary">
                      {stateKindLabel(activeState.kind)}
                    </span>
                  ) : null}
                </div>
                <div className="font-code-sm text-code-sm text-on-surface-variant">{active.name} · {Math.round(active.width)}x{Math.round(active.height)}</div>
                {activeState?.annotations.length ? (
                  <div className="mt-xs max-w-[760px] text-body-sm text-on-surface-variant">注释：{activeState.annotations.join(' / ')}</div>
                ) : null}
              </div>
              <a
                href={active.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[32px] items-center gap-xs rounded border border-outline-variant px-sm text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>open_in_new</span>
                Figma
              </a>
            </div>
          </div>
          <aside className="custom-scrollbar min-h-0 overflow-y-auto rounded-lg border border-outline-variant/50 bg-surface-container-low p-sm">
            <div className="grid grid-cols-2 gap-sm lg:grid-cols-1">
              {previews.map((preview, index) => {
                const state = stateForPreview(node, preview)
                return (
                  <button
                    key={previewKey(preview, index)}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className={[
                      'min-w-0 overflow-hidden rounded border text-left transition-colors',
                      index === activeIndex
                        ? 'border-tertiary bg-tertiary/10 text-on-surface'
                        : 'border-outline-variant bg-surface-container hover:border-primary',
                    ].join(' ')}
                  >
                    <div className="flex h-36 items-center justify-center overflow-hidden bg-black">
                      <img
                        src={preview.imageUrl}
                        alt={preview.name}
                        draggable={false}
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <div className="space-y-xs border-t border-outline-variant/60 px-sm py-xs">
                      <div className="flex items-center justify-between gap-xs">
                        <div className="truncate text-label-md">{index + 1}. {state?.label ?? preview.name}</div>
                        {state ? <span className="shrink-0 text-code-sm text-tertiary">{stateKindLabel(state.kind)}</span> : null}
                      </div>
                      <div className="truncate font-code-sm text-code-sm text-on-surface-variant">{Math.round(preview.width)}x{Math.round(preview.height)} · {preview.name}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </aside>
        </main>
      </section>
    </div>
  )
}
