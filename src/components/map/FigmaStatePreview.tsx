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
