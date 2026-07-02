import { useEffect, useMemo, useState } from 'react'
import { importFigmaFrame } from '../../lib/api'
import type { PrdNode, PrdNodeFigmaPreview, PrdTree, PrdUiStateKind, UpdateNodePatch } from '../../types/prdNode'

type PreviewImage = PrdNodeFigmaPreview
type PreviewImageWithUrl = PreviewImage & { imageUrl: string }
type AddMode = 'closed' | 'choice' | 'figma' | 'existing'

interface FigmaPreviewManagerProps {
  node: PrdNode
  tree?: PrdTree | null
  proxyBaseUrl: string
  onClose: () => void
  onUpdateNode: (nodeId: string, patch: UpdateNodePatch) => void
}

interface PreviewEntry {
  preview: PreviewImageWithUrl
  previewIndex: number
}

interface SourcePreviewEntry {
  sourceNode: PrdNode
  preview: PreviewImageWithUrl
  previewIndex: number
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

function previewKey(preview: PreviewImage) {
  return `${preview.nodeId}|${preview.imageUrl ?? ''}|${preview.sourceUrl}`
}

function previewEntries(previews: PreviewImage[]): PreviewEntry[] {
  return previews.flatMap((preview, previewIndex) => (
    preview.imageUrl ? [{ preview: preview as PreviewImageWithUrl, previewIndex }] : []
  ))
}

function stateKindLabel(kind: PrdUiStateKind) {
  return FIGMA_STATE_KIND_LABELS[kind] ?? FIGMA_STATE_KIND_LABELS.variant
}

function stateForPreview(node: PrdNode, preview: PreviewImage) {
  return node.uiStates?.find((state) => state.figmaNodeId === preview.nodeId) ?? null
}

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
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

function moveItemTo<T>(items: T[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return items
  const next = [...items]
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item)
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

function sourcePreviewEntries(sourceNodes: PrdNode[]): SourcePreviewEntry[] {
  return sourceNodes.flatMap((sourceNode) => (
    (sourceNode.figmaPreviews ?? []).flatMap((preview, previewIndex) => (
      preview.imageUrl ? [{ sourceNode, preview: preview as PreviewImageWithUrl, previewIndex }] : []
    ))
  ))
}

export function FigmaPreviewManager({ node, tree, proxyBaseUrl, onClose, onUpdateNode }: FigmaPreviewManagerProps) {
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const [activePreviewIndex, setActivePreviewIndex] = useState(0)
  const [dragPreviewIndex, setDragPreviewIndex] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; previewIndex: number } | null>(null)
  const [addMode, setAddMode] = useState<AddMode>('closed')
  const [figmaUrl, setFigmaUrl] = useState('')
  const [importedPreviews, setImportedPreviews] = useState<PreviewImage[]>([])
  const [importedSourceLabel, setImportedSourceLabel] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentPreviews = node.figmaPreviews ?? []
  const currentPreviewEntries = useMemo(() => previewEntries(currentPreviews), [currentPreviews])
  const sourceNodes = useMemo(() => (
    Object.values(tree ?? {})
      .filter((item) => item.id !== node.id && (item.figmaPreviews?.some((preview) => preview.imageUrl) ?? false))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
  ), [node.id, tree])
  const allSourcePreviews = useMemo(() => sourcePreviewEntries(sourceNodes), [sourceNodes])
  const safeActiveIndex = currentPreviewEntries.length ? Math.min(activePreviewIndex, currentPreviewEntries.length - 1) : 0
  const activeEntry = currentPreviewEntries[safeActiveIndex] ?? null
  const activePreview = activeEntry?.preview ?? null
  const activeState = activePreview ? stateForPreview(node, activePreview) : null

  useEffect(() => {
    setReplaceIndex(null)
    setActivePreviewIndex(0)
    setDragPreviewIndex(null)
    setContextMenu(null)
    setAddMode('closed')
    setNotice(null)
    setError(null)
    setImportedPreviews([])
    setImportedSourceLabel(null)
  }, [node.id])

  useEffect(() => {
    if (activePreviewIndex >= currentPreviewEntries.length) {
      setActivePreviewIndex(Math.max(0, currentPreviewEntries.length - 1))
    }
  }, [activePreviewIndex, currentPreviewEntries.length])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTextEditingTarget(event.target)) return
      if (event.key === 'Escape') {
        if (contextMenu) setContextMenu(null)
        else if (addMode !== 'closed') setAddMode('closed')
        else onClose()
      }
      if (event.key === 'ArrowLeft') setActivePreviewIndex((current) => Math.max(0, current - 1))
      if (event.key === 'ArrowRight' && currentPreviewEntries.length > 0) {
        setActivePreviewIndex((current) => Math.min(currentPreviewEntries.length - 1, current + 1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addMode, contextMenu, currentPreviewEntries.length, onClose])

  useEffect(() => {
    if (!contextMenu) return undefined
    function closeMenu() {
      setContextMenu(null)
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [contextMenu])

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
    setNotice('已调整预览顺序。')
  }

  function movePreviewToIndex(fromIndex: number, toIndex: number) {
    commitCurrent(moveItemTo(currentPreviews, fromIndex, toIndex))
    setNotice('已调整预览顺序。')
  }

  function addOrReplacePreview(preview: PreviewImage) {
    const incoming = { ...preview, isPrimary: false }
    const next = replaceIndex === null
      ? [...currentPreviews, incoming]
      : currentPreviews.map((item, index) => index === replaceIndex ? { ...incoming, isPrimary: item.isPrimary } : item)
    commitCurrent(next)
    setNotice(replaceIndex === null ? '已加入当前界面。' : `已替换第 ${replaceIndex + 1} 张预览图。`)
    setReplaceIndex(null)
    setAddMode('closed')
  }

  function addAllImportedPreviews() {
    if (!importedPreviews.length) return
    if (replaceIndex !== null) {
      addOrReplacePreview(importedPreviews[0]!)
      return
    }
    commitCurrent([
      ...currentPreviews,
      ...importedPreviews.map((preview) => ({ ...preview, isPrimary: false })),
    ])
    setNotice(`已加入 ${importedPreviews.length} 张 Figma 预览图。`)
    setAddMode('closed')
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
      setNotice(previews.length === 1 ? '已读取 1 张 Figma 图片。' : `已读取 ${previews.length} 张 Figma 图片。`)
      setFigmaUrl('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入 Figma 图片失败。')
    } finally {
      setIsImporting(false)
    }
  }

  function openContextMenu(event: React.MouseEvent, previewIndex: number) {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY, previewIndex })
  }

  function openReplaceFlow(index: number) {
    setReplaceIndex(index)
    setAddMode('choice')
    setNotice(`选择图片替换第 ${index + 1} 张预览图。`)
  }

  function renderAddPanel() {
    if (addMode === 'closed') return null
    return (
      <div className="absolute inset-x-sm bottom-sm z-20 max-h-[58vh] overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-md py-sm">
          <div className="min-w-0">
            <h3 className="truncate text-title-sm font-semibold text-on-surface">{replaceIndex === null ? '添加状态图' : `替换第 ${replaceIndex + 1} 张`}</h3>
            <p className="mt-[2px] truncate text-body-sm text-on-surface-variant">选择 Figma 链接或已有界面节点。</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setAddMode('closed')
              setReplaceIndex(null)
            }}
            className="rounded p-xs text-on-surface-variant transition-colors hover:bg-surface-variant hover:text-on-surface"
            aria-label="关闭添加面板"
            title="关闭"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
          </button>
        </div>

        {addMode === 'choice' ? (
          <div className="grid gap-sm p-md sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setAddMode('figma')}
              className="flex min-h-[96px] flex-col items-center justify-center gap-xs rounded-lg border border-outline-variant bg-surface-container-low px-md text-center text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>link</span>
              <span className="text-label-md font-medium">从 Figma 链接加入</span>
            </button>
            <button
              type="button"
              onClick={() => setAddMode('existing')}
              className="flex min-h-[96px] flex-col items-center justify-center gap-xs rounded-lg border border-outline-variant bg-surface-container-low px-md text-center text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>collections</span>
              <span className="text-label-md font-medium">从已有界面节点加入</span>
            </button>
          </div>
        ) : null}

        {addMode === 'figma' ? (
          <div className="custom-scrollbar max-h-[calc(58vh-58px)] space-y-sm overflow-y-auto p-md">
            <textarea
              value={figmaUrl}
              onChange={(event) => setFigmaUrl(event.target.value)}
              rows={3}
              placeholder="https://www.figma.com/design/...?...node-id=..."
              className="w-full resize-none rounded border border-outline-variant bg-surface-container-low p-sm font-code-sm text-code-sm text-on-surface outline-none focus:border-primary"
            />
            <div className="flex gap-xs">
              <button
                type="button"
                onClick={() => void importFromFigma()}
                disabled={isImporting}
                className="flex min-h-[34px] flex-1 items-center justify-center gap-xs rounded bg-primary px-md text-label-md text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <span className={['material-symbols-outlined', isImporting ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '16px' }}>
                  {isImporting ? 'sync' : 'image_search'}
                </span>
                读取图片
              </button>
              <button
                type="button"
                onClick={() => setAddMode('choice')}
                className="rounded border border-outline-variant px-sm text-label-md text-on-surface-variant hover:bg-surface-variant"
              >
                返回
              </button>
            </div>
            {importedPreviews.length ? (
              <div className="space-y-sm">
                <div className="flex items-center justify-between gap-sm">
                  <span className="truncate text-label-md font-medium text-on-surface">最近读取：{importedSourceLabel ?? 'Figma 链接'}</span>
                  <button
                    type="button"
                    onClick={addAllImportedPreviews}
                    className="shrink-0 rounded border border-primary/50 px-sm py-xs text-label-md text-primary hover:bg-primary-container/20"
                  >
                    {replaceIndex === null ? '全部加入' : '替换'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-sm">
                  {importedPreviews.map((preview, index) => (
                    <button
                      key={`figma-import-${previewKey(preview)}-${index}`}
                      type="button"
                      onClick={() => addOrReplacePreview(preview)}
                      className="h-[150px] min-w-0 overflow-hidden rounded border border-outline-variant bg-surface-container-low text-left transition-colors hover:border-primary"
                    >
                      <div className="flex h-28 items-center justify-center overflow-hidden bg-black">
                        {preview.imageUrl ? <img src={preview.imageUrl} alt={preview.name} draggable={false} className="h-full w-full object-contain" /> : null}
                      </div>
                      <div className="truncate border-t border-outline-variant/60 px-xs py-[6px] text-label-md text-on-surface">{preview.name}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {addMode === 'existing' ? (
          <div className="custom-scrollbar max-h-[calc(58vh-58px)] overflow-y-auto p-md">
            {allSourcePreviews.length ? (
              <div className="grid grid-cols-2 gap-sm">
                {allSourcePreviews.map((entry) => (
                  <button
                    key={`${entry.sourceNode.id}-${previewKey(entry.preview)}-${entry.previewIndex}`}
                    type="button"
                    onClick={() => addOrReplacePreview(previewFromSource(entry.preview, entry.sourceNode))}
                    className="h-[150px] min-w-0 overflow-hidden rounded border border-outline-variant bg-surface-container-low text-left transition-colors hover:border-primary"
                  >
                    <div className="flex h-28 items-center justify-center overflow-hidden bg-black">
                      <img src={entry.preview.imageUrl} alt={entry.preview.name} draggable={false} className="h-full w-full object-contain" />
                    </div>
                    <div className="space-y-[2px] border-t border-outline-variant/60 px-xs py-[6px]">
                      <div className="truncate text-label-md text-on-surface">{entry.preview.name}</div>
                      <div className="truncate text-code-sm text-on-surface-variant">{entry.sourceNode.label}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded border border-dashed border-outline-variant bg-surface-container-low p-md text-body-sm text-on-surface-variant">
                暂无其他带预览图的界面节点。
              </div>
            )}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-label={`${node.label} 状态预览`} onClick={onClose}>
      <section className="relative flex h-dvh w-full flex-col overflow-hidden border-l border-outline-variant bg-surface shadow-[-12px_0_32px_rgba(0,0,0,0.45)] md:w-1/2" onClick={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-center justify-between gap-md border-b border-outline-variant bg-surface-container-low px-md py-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-xs text-tertiary">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>view_carousel</span>
              <h2 className="truncate text-headline-sm font-semibold text-on-surface">状态预览</h2>
            </div>
            <p className="mt-[2px] truncate text-body-sm text-on-surface-variant">{node.label} · {currentPreviews.length} 张预览图 · {node.uiStates?.length ?? 0} 个状态</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[34px] shrink-0 items-center gap-xs rounded border border-outline-variant bg-surface px-sm text-label-md font-medium text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
            aria-label="关闭退出状态预览"
            title="关闭退出"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
            关闭退出
          </button>
        </header>

        {(notice || error || replaceIndex !== null) ? (
          <div className="shrink-0 border-b border-outline-variant bg-surface-container px-md py-xs">
            {replaceIndex !== null ? (
              <div className="mb-xs flex items-center gap-xs text-label-md text-primary">
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>swap_horiz</span>
                正在替换第 {replaceIndex + 1} 张预览。点击“+”选择来源。
              </div>
            ) : null}
            {notice ? <div className="text-body-sm text-tertiary">{notice}</div> : null}
            {error ? <div className="text-body-sm text-error">{error}</div> : null}
          </div>
        ) : null}

        <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_168px] gap-sm bg-surface-container-low p-sm">
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface">
            {activePreview ? (
              <>
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black p-sm">
                  <img
                    src={activePreview.imageUrl}
                    alt={activePreview.name}
                    draggable={false}
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="shrink-0 space-y-xs border-t border-outline-variant bg-surface-container-low px-sm py-xs">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-xs">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-xs">
                        <span className="truncate text-label-lg font-medium text-on-surface">
                          {safeActiveIndex + 1}. {activeState?.label ?? activePreview.name}
                        </span>
                        {activeState ? (
                          <span className="shrink-0 rounded border border-tertiary/40 bg-tertiary/10 px-xs font-code-sm text-code-sm text-tertiary">
                            {stateKindLabel(activeState.kind)}
                          </span>
                        ) : (
                          <span className="shrink-0 rounded border border-outline-variant px-xs font-code-sm text-code-sm text-on-surface-variant">
                            截图
                          </span>
                        )}
                      </div>
                      <div className="font-code-sm text-code-sm text-on-surface-variant">
                        {activePreview.name} · {Math.round(activePreview.width)}x{Math.round(activePreview.height)}
                      </div>
                    </div>
                    <a
                      href={activePreview.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-[28px] items-center gap-xs rounded border border-outline-variant px-sm text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>open_in_new</span>
                      Figma
                    </a>
                  </div>
                  {activeState?.annotations.length ? (
                    <div className="line-clamp-2 rounded border border-outline-variant/70 bg-surface-container px-sm py-[2px] text-body-sm leading-snug text-on-surface-variant" title={activeState.annotations.join(' / ')}>
                      注释：{activeState.annotations.join(' / ')}
                    </div>
                  ) : null}
                  {activeState?.visibleTexts.length ? (
                    <div className="truncate rounded border border-outline-variant/70 bg-surface-container px-sm py-[2px] text-body-sm leading-snug text-on-surface-variant" title={activeState.visibleTexts.join(' / ')}>
                      可见文案：{activeState.visibleTexts.slice(0, 6).join(' / ')}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="flex min-h-[260px] flex-1 items-center justify-center bg-surface-container-low p-lg text-center text-body-md text-on-surface-variant">
                {currentPreviews.length
                  ? '当前预览记录暂无可浏览图片。'
                  : '当前界面还没有预览图。点击下方“+”加入。'}
              </div>
            )}
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface p-sm">
            <div className="mb-xs flex items-center justify-between gap-sm">
              <span className="text-title-sm font-semibold text-on-surface">状态缩略图</span>
              <span className="font-code-sm text-code-sm text-on-surface-variant">{currentPreviewEntries.length} 张</span>
            </div>
            <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-xs overflow-y-auto pr-xs">
              {currentPreviewEntries.map((entry, entryIndex) => {
                const state = stateForPreview(node, entry.preview)
                return (
                  <div
                    key={`${previewKey(entry.preview)}-${entry.previewIndex}`}
                    role="button"
                    tabIndex={0}
                    draggable
                    onClick={() => setActivePreviewIndex(entryIndex)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') setActivePreviewIndex(entryIndex)
                    }}
                    onContextMenu={(event) => openContextMenu(event, entry.previewIndex)}
                    onDragStart={(event) => {
                      setDragPreviewIndex(entry.previewIndex)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', String(entry.previewIndex))
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      const fromIndex = dragPreviewIndex ?? Number(event.dataTransfer.getData('text/plain'))
                      if (Number.isFinite(fromIndex)) movePreviewToIndex(fromIndex, entry.previewIndex)
                      setDragPreviewIndex(null)
                    }}
                    onDragEnd={() => setDragPreviewIndex(null)}
                    className={[
                      'group relative h-[150px] shrink-0 min-w-0 cursor-grab overflow-hidden rounded border bg-surface-container-low text-left transition-colors active:cursor-grabbing',
                      entryIndex === safeActiveIndex
                        ? 'border-tertiary bg-tertiary/10 text-on-surface'
                        : 'border-outline-variant hover:border-primary',
                    ].join(' ')}
                    title={entry.preview.name}
                  >
                    <div className="flex h-24 items-center justify-center overflow-hidden bg-black">
                      <img src={entry.preview.imageUrl} alt={entry.preview.name} draggable={false} className="h-full w-full object-contain" />
                    </div>
                    <div className="space-y-[2px] border-t border-outline-variant/60 px-xs py-[6px]">
                      <div className="flex min-w-0 items-center justify-between gap-xs">
                        <span className="truncate text-label-md">{entryIndex + 1}. {state?.label ?? entry.preview.name}</span>
                        {entry.preview.isPrimary ? <span className="shrink-0 text-[10px] text-primary">主</span> : null}
                      </div>
                      <div className="truncate font-code-sm text-code-sm text-on-surface-variant">{state ? stateKindLabel(state.kind) : '截图'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        const rect = event.currentTarget.getBoundingClientRect()
                        setContextMenu({ x: rect.right - 156, y: rect.bottom + 4, previewIndex: entry.previewIndex })
                      }}
                      className="absolute right-xs top-xs rounded bg-black/55 p-[2px] text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
                      aria-label="打开缩略图操作"
                      title="操作"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>more_vert</span>
                    </button>
                  </div>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  setReplaceIndex(null)
                  setAddMode('choice')
                }}
                className="flex h-[150px] shrink-0 flex-col items-center justify-center gap-xs rounded border border-dashed border-outline-variant bg-surface-container-low text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                aria-label="添加状态图"
                title="添加状态图"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>add</span>
              </button>
            </div>
          </section>
        </main>

        {renderAddPanel()}

        {contextMenu ? (
          <div
            className="fixed z-[120] w-40 overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-2xl"
            style={{ left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 172)), top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 220)) }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => { setPrimary(contextMenu.previewIndex); setContextMenu(null) }} className="flex w-full items-center gap-xs px-sm py-xs text-left text-label-md text-on-surface-variant hover:bg-surface-variant hover:text-on-surface">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>star</span>
              设为主预览
            </button>
            <button type="button" onClick={() => { openReplaceFlow(contextMenu.previewIndex); setContextMenu(null) }} className="flex w-full items-center gap-xs px-sm py-xs text-left text-label-md text-on-surface-variant hover:bg-surface-variant hover:text-on-surface">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>swap_horiz</span>
              替换
            </button>
            <button type="button" onClick={() => { movePreview(contextMenu.previewIndex, -1); setContextMenu(null) }} disabled={contextMenu.previewIndex === 0} className="flex w-full items-center gap-xs px-sm py-xs text-left text-label-md text-on-surface-variant hover:bg-surface-variant hover:text-on-surface disabled:opacity-40">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_upward</span>
              前移
            </button>
            <button type="button" onClick={() => { movePreview(contextMenu.previewIndex, 1); setContextMenu(null) }} disabled={contextMenu.previewIndex === currentPreviews.length - 1} className="flex w-full items-center gap-xs px-sm py-xs text-left text-label-md text-on-surface-variant hover:bg-surface-variant hover:text-on-surface disabled:opacity-40">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_downward</span>
              后移
            </button>
            <button type="button" onClick={() => { removePreview(contextMenu.previewIndex); setContextMenu(null) }} className="flex w-full items-center gap-xs px-sm py-xs text-left text-label-md text-error hover:bg-error/10">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
              删除
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
