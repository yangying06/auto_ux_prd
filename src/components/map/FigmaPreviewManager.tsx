import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { importFigmaFrame } from '../../lib/api'
import type { PrdNode, PrdNodeFigmaPreview, PrdTree, UpdateNodePatch } from '../../types/prdNode'

type PreviewImage = PrdNodeFigmaPreview

interface FigmaPreviewManagerProps {
  node: PrdNode
  tree?: PrdTree | null
  proxyBaseUrl: string
  onClose: () => void
  onUpdateNode: (nodeId: string, patch: UpdateNodePatch) => void
}

function previewKey(preview: PreviewImage) {
  return `${preview.nodeId}|${preview.imageUrl ?? ''}|${preview.sourceUrl}`
}

function dedupePreviews(previews: PreviewImage[]) {
  const seen = new Set<string>()
  return previews.filter((preview) => {
    const key = previewKey(preview)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizePrimary(previews: PreviewImage[]) {
  const primaryIndex = previews.findIndex((preview) => preview.isPrimary)
  return previews.map((preview, index) => ({
    ...preview,
    isPrimary: primaryIndex >= 0 ? index === primaryIndex : index === 0,
  }))
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  return next
}

function previewFromImport(
  image: Awaited<ReturnType<typeof importFigmaFrame>>['images'][number],
  sourceUrl: string,
  sourceLabel: string,
): PreviewImage {
  return {
    nodeId: image.nodeId,
    name: image.name,
    sourceUrl,
    imageUrl: image.assetUrl,
    width: Math.round(image.width),
    height: Math.round(image.height),
    originNodeId: null,
    originNodeLabel: sourceLabel,
    userAdded: true,
    userNote: '用户从 Figma 链接加入',
  }
}

function PreviewThumb({
  preview,
  index,
  selected,
  footer,
}: {
  preview: PreviewImage
  index: number
  selected?: boolean
  footer: ReactNode
}) {
  return (
    <figure className={[
      'min-w-0 overflow-hidden rounded-lg border bg-surface-container-low',
      selected ? 'border-primary ring-2 ring-primary/35' : 'border-outline-variant',
    ].join(' ')}>
      <div className="flex h-44 items-center justify-center overflow-hidden bg-black">
        {preview.imageUrl ? (
          <img src={preview.imageUrl} alt={preview.name} draggable={false} className="h-full w-full object-contain" />
        ) : (
          <div className="px-sm text-center text-body-sm text-on-surface-variant">暂无图片</div>
        )}
      </div>
      <figcaption className="space-y-xs border-t border-outline-variant/70 p-sm">
        <div className="flex min-w-0 items-center justify-between gap-sm">
          <span className="truncate text-label-md font-medium text-on-surface">{index + 1}. {preview.name}</span>
          {preview.isPrimary ? (
            <span className="shrink-0 rounded bg-primary-container px-xs text-[10px] text-on-primary-container">主预览</span>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center justify-between gap-sm font-code-sm text-code-sm text-on-surface-variant">
          <span className="truncate">{Math.round(preview.width)}x{Math.round(preview.height)}</span>
          <span className="truncate">{preview.nodeId}</span>
        </div>
        {preview.originNodeLabel ? (
          <div className="truncate text-[10px] text-on-surface-variant">来源：{preview.originNodeLabel}</div>
        ) : null}
        {footer}
      </figcaption>
    </figure>
  )
}

export function FigmaPreviewManager({ node, tree, proxyBaseUrl, onClose, onUpdateNode }: FigmaPreviewManagerProps) {
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const [sourceNodeId, setSourceNodeId] = useState('')
  const [figmaUrl, setFigmaUrl] = useState('')
  const [importedPreviews, setImportedPreviews] = useState<PreviewImage[]>([])
  const [importedSourceLabel, setImportedSourceLabel] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentPreviews = node.figmaPreviews ?? []
  const sourceNodes = useMemo(() => (
    Object.values(tree ?? {})
      .filter((item) => item.id !== node.id && (item.figmaPreviews?.length ?? 0) > 0)
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
  ), [node.id, tree])
  const selectedSourceNode = sourceNodes.find((item) => item.id === sourceNodeId) ?? sourceNodes[0] ?? null
  const selectedSourcePreviews = selectedSourceNode?.figmaPreviews ?? []

  useEffect(() => {
    if (!sourceNodeId && sourceNodes[0]) setSourceNodeId(sourceNodes[0].id)
    if (sourceNodeId && !sourceNodes.some((item) => item.id === sourceNodeId)) {
      setSourceNodeId(sourceNodes[0]?.id ?? '')
    }
  }, [sourceNodeId, sourceNodes])

  useEffect(() => {
    setReplaceIndex(null)
    setNotice(null)
    setError(null)
    setImportedPreviews([])
    setImportedSourceLabel(null)
  }, [node.id])

  function commitCurrent(previews: PreviewImage[]) {
    const next = normalizePrimary(dedupePreviews(previews))
    onUpdateNode(node.id, { figmaPreviews: next })
  }

  function removePreview(index: number) {
    commitCurrent(currentPreviews.filter((_preview, previewIndex) => previewIndex !== index))
    if (replaceIndex === index) setReplaceIndex(null)
    setNotice('已删除该预览图。')
  }

  function setPrimary(index: number) {
    onUpdateNode(node.id, {
      figmaPreviews: currentPreviews.map((preview, previewIndex) => ({
        ...preview,
        isPrimary: previewIndex === index,
      })),
    })
    setNotice('已设为节点主预览。')
  }

  function movePreview(index: number, direction: -1 | 1) {
    commitCurrent(moveItem(currentPreviews, index, direction))
  }

  function addOrReplacePreview(preview: PreviewImage) {
    const incoming = { ...preview, isPrimary: false }
    const next = replaceIndex === null
      ? [...currentPreviews, incoming]
      : currentPreviews.map((item, index) => index === replaceIndex ? { ...incoming, isPrimary: item.isPrimary } : item)
    commitCurrent(next)
    setNotice(replaceIndex === null ? '已加入当前界面。' : `已替换第 ${replaceIndex + 1} 张预览图。`)
    setReplaceIndex(null)
  }

  function addAllImportedPreviews() {
    if (!importedPreviews.length) return
    commitCurrent([
      ...currentPreviews,
      ...importedPreviews.map((preview) => ({ ...preview, isPrimary: false })),
    ])
    setNotice(`已加入 ${importedPreviews.length} 张 Figma 预览图。`)
  }

  function previewFromSource(preview: PreviewImage, sourceNode: PrdNode) {
    return {
      ...preview,
      originNodeId: preview.originNodeId ?? sourceNode.id,
      originNodeLabel: preview.originNodeLabel ?? sourceNode.label,
      userAdded: true,
      userNote: preview.userNote ?? `用户从「${sourceNode.label}」加入`,
    }
  }

  function copyFromSource(preview: PreviewImage, sourceNode: PrdNode) {
    addOrReplacePreview(previewFromSource(preview, sourceNode))
  }

  function moveFromSource(preview: PreviewImage, sourceNode: PrdNode) {
    const isReplacing = replaceIndex !== null
    addOrReplacePreview(previewFromSource(preview, sourceNode))
    const remainingSourcePreviews = normalizePrimary(
      (sourceNode.figmaPreviews ?? []).filter((item) => previewKey(item) !== previewKey(preview)),
    )
    onUpdateNode(sourceNode.id, {
      figmaPreviews: remainingSourcePreviews,
    })
    setNotice(isReplacing ? `已用「${sourceNode.label}」中的图替换当前预览。` : `已从「${sourceNode.label}」移动到当前界面。`)
  }

  async function importFromFigma() {
    const url = figmaUrl.trim()
    if (!url) {
      setError('请先粘贴 Figma 节点链接。')
      return
    }

    setIsImporting(true)
    setError(null)
    setNotice(null)
    try {
      const result = await importFigmaFrame(proxyBaseUrl, { url })
      const previews = dedupePreviews(
        result.images.map((image) => previewFromImport(image, result.sourceUrl, result.panelName || 'Figma 链接')),
      )
      if (!previews.length) throw new Error('Figma 未返回可用图片。')
      setImportedPreviews(previews)
      setImportedSourceLabel(result.panelName || 'Figma 链接')
      setNotice(previews.length === 1 ? '已读取 1 张 Figma 图片，可选择加入或替换。' : `已读取 ${previews.length} 张 Figma 图片，请选择要加入/替换的画面。`)
      setFigmaUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入 Figma 图片失败。')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 p-lg backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${node.label} 画面管理`}>
      <section className="flex h-[min(92vh,900px)] w-[min(1320px,96vw)] flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-md border-b border-outline-variant bg-surface-container-low px-lg py-md">
          <div className="min-w-0">
            <div className="flex items-center gap-xs text-tertiary">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>photo_library</span>
              <h2 className="truncate text-headline-sm font-semibold text-on-surface">画面管理</h2>
            </div>
            <p className="mt-xs truncate text-body-sm text-on-surface-variant">{node.label} · {currentPreviews.length} 张预览图</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
            aria-label="关闭画面管理"
            title="关闭"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {(notice || error || replaceIndex !== null) ? (
          <div className="shrink-0 border-b border-outline-variant bg-surface-container px-lg py-sm">
            {replaceIndex !== null ? (
              <div className="mb-xs flex items-center gap-xs text-label-md text-primary">
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>swap_horiz</span>
                正在替换第 {replaceIndex + 1} 张预览。选择右侧图片或粘贴 Figma 链接即可替换。
              </div>
            ) : null}
            {notice ? <div className="text-body-sm text-tertiary">{notice}</div> : null}
            {error ? <div className="text-body-sm text-error">{error}</div> : null}
          </div>
        ) : null}

        <main className="grid min-h-0 flex-1 gap-md bg-surface-container-low p-md lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="custom-scrollbar min-h-0 overflow-y-auto rounded-lg border border-outline-variant bg-surface p-md">
            <div className="mb-md flex items-center justify-between gap-md">
              <div className="min-w-0">
                <h3 className="text-title-md font-semibold text-on-surface">当前界面预览</h3>
                <p className="mt-xs text-body-sm text-on-surface-variant">可删除、排序、设主预览，也可以选中一张后从右侧替换。</p>
              </div>
              {replaceIndex !== null ? (
                <button
                  type="button"
                  onClick={() => setReplaceIndex(null)}
                  className="shrink-0 rounded border border-outline-variant px-sm py-xs text-label-md text-on-surface-variant hover:bg-surface-variant"
                >
                  取消替换
                </button>
              ) : null}
            </div>

            {currentPreviews.length ? (
              <div className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
                {currentPreviews.map((preview, index) => (
                  <PreviewThumb
                    key={`${previewKey(preview)}-${index}`}
                    preview={preview}
                    index={index}
                    selected={replaceIndex === index}
                    footer={(
                      <div className="grid grid-cols-5 gap-xs pt-xs">
                        <button type="button" onClick={() => setPrimary(index)} title="设为主预览" className="rounded border border-outline-variant px-xs py-xs text-label-md hover:bg-surface-variant">
                          <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>star</span>
                        </button>
                        <button type="button" onClick={() => movePreview(index, -1)} disabled={index === 0} title="前移" className="rounded border border-outline-variant px-xs py-xs text-label-md disabled:opacity-35 hover:bg-surface-variant">
                          <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>arrow_upward</span>
                        </button>
                        <button type="button" onClick={() => movePreview(index, 1)} disabled={index === currentPreviews.length - 1} title="后移" className="rounded border border-outline-variant px-xs py-xs text-label-md disabled:opacity-35 hover:bg-surface-variant">
                          <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>arrow_downward</span>
                        </button>
                        <button type="button" onClick={() => setReplaceIndex(index)} title="替换" className="rounded border border-primary/50 px-xs py-xs text-label-md text-primary hover:bg-primary-container/20">
                          <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>swap_horiz</span>
                        </button>
                        <button type="button" onClick={() => removePreview(index)} title="删除" className="rounded border border-error/50 px-xs py-xs text-label-md text-error hover:bg-error/10">
                          <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>delete</span>
                        </button>
                      </div>
                    )}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-outline-variant bg-surface-container-low p-lg text-center text-body-md text-on-surface-variant">
                当前界面还没有预览图。可以从右侧其他界面复制，或粘贴 Figma 节点链接加入。
              </div>
            )}
          </section>

          <aside className="custom-scrollbar min-h-0 overflow-y-auto rounded-lg border border-outline-variant bg-surface p-md">
            <section className="space-y-sm">
              <div>
                <h3 className="text-title-sm font-semibold text-on-surface">从 Figma 链接加入</h3>
                <p className="mt-xs text-body-sm text-on-surface-variant">粘贴具体节点链接，先读取可用图片，再选择加入或替换。</p>
              </div>
              <textarea
                value={figmaUrl}
                onChange={(event) => setFigmaUrl(event.target.value)}
                rows={3}
                placeholder="https://www.figma.com/design/...?...node-id=..."
                className="w-full resize-none rounded border border-outline-variant bg-surface-container-low p-sm font-code-sm text-code-sm text-on-surface outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => void importFromFigma()}
                disabled={isImporting}
                className="flex min-h-[36px] w-full items-center justify-center gap-xs rounded bg-primary px-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <span className={['material-symbols-outlined', isImporting ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '16px' }}>
                  {isImporting ? 'sync' : 'image_search'}
                </span>
                读取 Figma 图片
              </button>
              {importedPreviews.length ? (
                <div className="rounded-lg border border-outline-variant bg-surface-container-low p-sm">
                  <div className="mb-sm flex items-center justify-between gap-sm">
                    <div className="min-w-0">
                      <h4 className="truncate text-label-md font-semibold text-on-surface">
                        最近读取：{importedSourceLabel ?? 'Figma 链接'}
                      </h4>
                      <p className="mt-0.5 text-body-sm text-on-surface-variant">{importedPreviews.length} 张候选图</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setImportedPreviews([])
                        setImportedSourceLabel(null)
                      }}
                      className="shrink-0 rounded border border-outline-variant px-xs py-xs text-label-md text-on-surface-variant hover:bg-surface-variant"
                    >
                      清空
                    </button>
                  </div>
                  {replaceIndex === null ? (
                    <button
                      type="button"
                      onClick={addAllImportedPreviews}
                      className="mb-sm flex min-h-[32px] w-full items-center justify-center gap-xs rounded border border-primary/50 px-sm text-label-md text-primary hover:bg-primary-container/20"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>playlist_add</span>
                      全部加入当前界面
                    </button>
                  ) : null}
                  <div className="space-y-sm">
                    {importedPreviews.map((preview, index) => (
                      <PreviewThumb
                        key={`figma-import-${previewKey(preview)}-${index}`}
                        preview={preview}
                        index={index}
                        footer={(
                          <div className="grid grid-cols-2 gap-xs pt-xs">
                            <button
                              type="button"
                              onClick={() => addOrReplacePreview(preview)}
                              className="rounded border border-primary/50 px-xs py-xs text-label-md text-primary hover:bg-primary-container/20"
                            >
                              {replaceIndex === null ? '加入' : '替换'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setFigmaUrl(preview.sourceUrl)
                                setNotice('已把来源链接放回输入框。')
                              }}
                              className="rounded border border-outline-variant px-xs py-xs text-label-md text-on-surface-variant hover:bg-surface-variant"
                            >
                              链接
                            </button>
                          </div>
                        )}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <div className="my-md border-t border-outline-variant" />

            <section className="space-y-sm">
              <div>
                <h3 className="text-title-sm font-semibold text-on-surface">从其他界面加入</h3>
                <p className="mt-xs text-body-sm text-on-surface-variant">可复制保留原节点，也可移动到当前界面。</p>
              </div>
              {sourceNodes.length ? (
                <>
                  <select
                    value={selectedSourceNode?.id ?? ''}
                    onChange={(event) => setSourceNodeId(event.target.value)}
                    className="w-full rounded border border-outline-variant bg-surface-container-low px-sm py-xs text-body-sm text-on-surface outline-none focus:border-primary"
                  >
                    {sourceNodes.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}（{item.figmaPreviews?.length ?? 0}）</option>
                    ))}
                  </select>
                  <div className="space-y-sm">
                    {selectedSourceNode && selectedSourcePreviews.map((preview, index) => (
                      <PreviewThumb
                        key={`${selectedSourceNode.id}-${previewKey(preview)}-${index}`}
                        preview={preview}
                        index={index}
                        footer={(
                          <div className="grid grid-cols-3 gap-xs pt-xs">
                            <button
                              type="button"
                              onClick={() => copyFromSource(preview, selectedSourceNode)}
                              className="rounded border border-outline-variant px-xs py-xs text-label-md hover:bg-surface-variant"
                            >
                              复制
                            </button>
                            <button
                              type="button"
                              onClick={() => moveFromSource(preview, selectedSourceNode)}
                              className="rounded border border-secondary/50 px-xs py-xs text-label-md text-secondary hover:bg-secondary-container/20"
                            >
                              移动
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (replaceIndex === null) {
                                  setError('请先在左侧选择要替换的预览图。')
                                  return
                                }
                                copyFromSource(preview, selectedSourceNode)
                              }}
                              className="rounded border border-primary/50 px-xs py-xs text-label-md text-primary hover:bg-primary-container/20"
                            >
                              替换
                            </button>
                          </div>
                        )}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded border border-dashed border-outline-variant bg-surface-container-low p-md text-body-sm text-on-surface-variant">
                  暂无其他带预览图的界面节点。
                </div>
              )}
            </section>
          </aside>
        </main>
      </section>
    </div>
  )
}
