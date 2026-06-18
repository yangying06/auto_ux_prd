import { useEffect, useState } from 'react'
import { loadEffectAssetRow, openAssetLibraryLocalPath, parseUiFigmaAsset, scanEffectAssetDirectory } from '../../lib/api'
import { useAppStore } from '../../store/appStore'
import type { AssetRowStatus, EffectAssetKind, EffectAssetLoadStatus, EffectAssetRow, UiAssetKind, UiAssetParseResult, UiAssetRow } from '../../types/assetWorkbench'
import type { ProjectSourceDocument } from '../../types/archive'
import type { PrdTree } from '../../types/prdNode'

interface AssetWorkbenchModalProps {
  isOpen: boolean
  baseUrl: string
  onClose: () => void
}

interface UiAssetFormState {
  figmaText: string
  kind: UiAssetKind
}

const DEFAULT_EFFECT_ROOT = '\\\\172.16.10.252\\共享文件夹\\设计文件\\交付产运研\\游戏\\2026年文件汇总\\wyak\\金字塔\\动画-灿斌\\spine输出'

const inputClassName = 'min-h-[36px] w-full min-w-0 rounded-md border border-outline-variant bg-surface px-sm py-xs text-body-sm text-on-surface outline-none focus:border-secondary'
const compactTextareaClassName = 'min-h-[42px] w-full min-w-0 resize-y rounded-md border border-outline-variant bg-surface px-sm py-xs text-body-sm text-on-surface outline-none focus:border-secondary'
const actionButtonClassName = 'inline-flex min-h-[32px] min-w-[72px] items-center justify-center gap-xs whitespace-nowrap rounded-md border px-sm text-label-md transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40'
const toolbarFieldClassName = 'grid min-w-0 gap-xs'
const toolbarLabelClassName = 'whitespace-nowrap text-[11px] leading-4 text-on-surface-variant'
const toolbarSummaryClassName = 'inline-flex min-h-[36px] min-w-0 items-center gap-xs whitespace-nowrap rounded-md border border-outline-variant bg-surface-container-high px-sm text-label-md text-on-surface-variant'
const UI_PARSE_ALL_CONCURRENCY = 2
const UI_PARSE_RETRY_DELAY_MS = 900
const transientFigmaExportErrorText = 'Figma 已返回节点结构，但所有候选图都导出失败'

interface LoadProgressState {
  active: boolean
  done: number
  total: number
  label: string
}

function makeRowId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function parseModeForKind(kind: UiAssetKind) {
  return kind === 'interface' ? 'intermediate' : 'image_set'
}

function emptyUiForm(): UiAssetFormState {
  return {
    figmaText: '',
    kind: 'interface',
  }
}

function uiAssetKindLabel(kind: UiAssetKind) {
  return kind === 'interface' ? '界面' : '散图'
}

function uiAssetNamePlaceholder(kind: UiAssetKind) {
  return kind === 'interface' ? '未命名界面' : '未命名的散图'
}

function isPlaceholderUiAssetName(value: string, kind: UiAssetKind) {
  const trimmed = value.trim()
  return trimmed === uiAssetNamePlaceholder(kind)
    || trimmed === '未命名散图'
    || trimmed === '未命名界面'
}

function derivedParseLabel(kind: UiAssetKind) {
  return kind === 'interface' ? '子图 + JSON' : '图片集'
}

function statusLabel(status: AssetRowStatus) {
  if (status === 'parsing') return '解析中'
  if (status === 'ready') return '已解析'
  if (status === 'error') return '失败'
  return '待解析'
}

function statusTone(status: AssetRowStatus) {
  if (status === 'ready') return 'border-tertiary/50 bg-tertiary/10 text-tertiary'
  if (status === 'error') return 'border-error/50 bg-error/10 text-error'
  if (status === 'parsing') return 'border-secondary/50 bg-secondary/10 text-secondary'
  return 'border-outline-variant bg-surface-container-high text-on-surface-variant'
}

function loadStatusLabel(status: EffectAssetLoadStatus) {
  if (status === 'loading') return '加载中'
  if (status === 'loaded') return '已加载'
  if (status === 'error') return '失败'
  return '未加载'
}

function loadStatusTone(status: EffectAssetLoadStatus) {
  if (status === 'loaded') return 'border-tertiary/50 bg-tertiary/10 text-tertiary'
  if (status === 'error') return 'border-error/50 bg-error/10 text-error'
  if (status === 'loading') return 'border-secondary/50 bg-secondary/10 text-secondary'
  return 'border-outline-variant bg-surface-container-high text-on-surface-variant'
}

function effectKindLabel(kind: EffectAssetKind) {
  const labels: Record<EffectAssetKind, string> = {
    spine: 'Spine',
    particle: '粒子',
    sequence: '序列帧',
    prefab: '预制体',
    audio: '音频',
    texture: '贴图',
    scripted: '脚本',
    unknown: '未知',
  }
  return labels[kind]
}

function compactPath(value: string | null | undefined) {
  if (!value) return '未解析'
  if (value.length <= 58) return value
  return `${value.slice(0, 24)}...${value.slice(-28)}`
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function compactNotePart(value: string | null | undefined, maxLength = 320) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function joinUniqueNoteParts(parts: Array<string | null | undefined>) {
  const seen = new Set<string>()
  return parts
    .map((part) => compactNotePart(part))
    .filter((part) => {
      if (!part || seen.has(part)) return false
      seen.add(part)
      return true
    })
    .join('\n')
}

function effectRowNote(row: EffectAssetRow) {
  return joinUniqueNoteParts([row.usageNote, row.purpose, row.pageHint, row.implementationHint])
}

function buildEffectSmartNoteContext(prdTree: PrdTree | null, sourceDocument: ProjectSourceDocument | null) {
  const hints: string[] = []
  if (sourceDocument?.text) {
    hints.push(`PRD 原文 ${sourceDocument.filename}: ${compactNotePart(sourceDocument.text, 1200)}`)
  }

  const nodes = Object.values(prdTree ?? {})
    .sort((a, b) => (a.level - b.level) || (a.order - b.order))
    .slice(0, 80)

  for (const node of nodes) {
    const performance = node.performanceSpec
      ? [
          node.performanceSpec.eventTypes.length ? `表现类型:${node.performanceSpec.eventTypes.join('/')}` : null,
          node.performanceSpec.trigger ? `触发:${node.performanceSpec.trigger}` : null,
          node.performanceSpec.assets.length ? `资源:${node.performanceSpec.assets.join('/')}` : null,
          node.performanceSpec.integrationModes?.length ? `接入:${node.performanceSpec.integrationModes.join('/')}` : null,
        ].filter(Boolean).join('；')
      : ''
    const sectionText = Object.values(node.sections ?? {})
      .map((section) => [section.title, section.summary, section.content].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' ')
    const hint = [
      `${node.label}(${node.type})`,
      node.summary,
      node.content,
      node.techNotes,
      sectionText,
      performance,
    ].filter(Boolean).join(' | ')
    if (hint) hints.push(compactNotePart(hint, 520))
  }

  return hints.filter(Boolean)
}

function PathSummaryLine({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid min-w-0 grid-cols-[42px_minmax(0,1fr)] items-center gap-xs text-[11px] leading-5">
      <span className="whitespace-nowrap text-on-surface-variant">{label}</span>
      <span className="min-w-0 truncate font-mono text-on-surface-variant" title={value ?? undefined}>
        {compactPath(value)}
      </span>
    </div>
  )
}

function EffectPreviewCell({ row }: { row: EffectAssetRow }) {
  if (!row.previewUrl || !row.previewType) {
    return <span className="font-mono text-[10px] text-on-surface-variant">无预览</span>
  }

  return (
    <div className="flex items-center gap-xs">
      {row.previewType === 'video' ? (
        <video src={row.previewUrl} className="h-10 w-10 shrink-0 rounded border border-outline-variant/40 object-cover" muted loop />
      ) : row.previewType === 'audio' ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-outline-variant/40 bg-surface-container-high text-on-surface-variant">
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>volume_up</span>
        </span>
      ) : (
        <img src={row.previewUrl} alt={row.name} className="h-10 w-10 shrink-0 rounded border border-outline-variant/40 object-cover" />
      )}
      <span className="min-w-0 truncate font-mono text-[10px] uppercase text-tertiary">{row.previewType}</span>
    </div>
  )
}

function extractFigmaUrls(value: string) {
  const matches = value.match(/https?:\/\/[^\s"'<>]+/gu) ?? []
  return matches
    .map((url) => url.replace(/[),，;；。]+$/u, ''))
    .filter((url) => /figma\.com/iu.test(url))
}

function decodeUrlPathSegment(value: string) {
  try {
    return decodeURIComponent(value).trim()
  } catch {
    return value.trim()
  }
}

function figmaUrlTitle(value: string) {
  try {
    const parsed = new URL(value)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const typeIndex = segments.findIndex((segment) => ['file', 'design', 'proto'].includes(segment.toLowerCase()))
    const rawTitle = typeIndex >= 0 ? segments[typeIndex + 2] : segments.at(-1)
    const title = rawTitle ? decodeUrlPathSegment(rawTitle).replace(/\s+/g, ' ').trim() : ''
    return title || ''
  } catch {
    return ''
  }
}

function shouldUseParsedUiAssetTitle(row: UiAssetRow) {
  const current = row.name.trim()
  return !current || isPlaceholderUiAssetName(current, row.kind) || current === figmaUrlTitle(row.figmaUrl)
}

function resolvedUiAssetName(row: UiAssetRow, result?: UiAssetParseResult) {
  const current = row.name.trim()
  if (shouldUseParsedUiAssetTitle(row)) return result?.panelName?.trim() || ''
  return current
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function textIncludesAssetName(text: string | null | undefined, name: string) {
  const term = name.trim()
  if (!term || !text) return false
  if (/^[a-z0-9]{1,2}$/iu.test(term)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}(?=$|[^a-z0-9])`, 'iu').test(text)
  }
  return text.toLowerCase().includes(term.toLowerCase())
}

function prdNodeContextText(node: PrdTree[string]) {
  const sectionsText = Object.values(node.sections ?? {})
    .map((section) => [section.title, section.summary, section.content].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(' ')
  const performanceText = node.performanceSpec
    ? [
        node.performanceSpec.eventTypes.join('/'),
        node.performanceSpec.trigger,
        node.performanceSpec.branches.join('/'),
        node.performanceSpec.assets.join('/'),
        node.performanceSpec.prototypeNotes.join('/'),
      ].filter(Boolean).join(' ')
    : ''
  return [
    node.label,
    node.summary,
    node.content,
    node.techNotes,
    sectionsText,
    performanceText,
  ].filter(Boolean).join(' ')
}

function inferUiAssetPurposeFromTree(name: string, prdTree: PrdTree | null) {
  const nodes = Object.values(prdTree ?? {})
    .filter((node) => textIncludesAssetName(prdNodeContextText(node), name))
    .sort((a, b) => {
      const aLabelMatch = textIncludesAssetName(a.label, name) ? 0 : 1
      const bLabelMatch = textIncludesAssetName(b.label, name) ? 0 : 1
      return aLabelMatch - bLabelMatch || a.level - b.level || a.order - b.order
    })
  const node = nodes[0]
  if (!node) return ''

  const detail = compactNotePart(
    node.summary
      || Object.values(node.sections ?? {}).map((section) => section.summary || section.content).find(Boolean)
      || node.content
      || node.techNotes,
    180,
  )
  return detail ? `用于「${node.label}」：${detail}` : `用于「${node.label}」相关界面素材。`
}

function inferUiAssetPurposeFromSourceDocument(name: string, sourceDocument: ProjectSourceDocument | null) {
  const lines = sourceDocument?.text
    ?.split(/\n+/u)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0 && textIncludesAssetName(line, name))
    .sort((a, b) => a.length - b.length)
  const line = lines?.[0]
  return line ? `PRD 提到「${name}」：${compactNotePart(line, 180)}` : ''
}

function inferUiAssetPurpose(name: string, prdTree: PrdTree | null, sourceDocument: ProjectSourceDocument | null) {
  const trimmedName = name.trim()
  if (!trimmedName) return ''
  return inferUiAssetPurposeFromTree(trimmedName, prdTree)
    || inferUiAssetPurposeFromSourceDocument(trimmedName, sourceDocument)
}

function isTransientFigmaExportError(error: unknown) {
  return error instanceof Error && error.message.includes(transientFigmaExportErrorText)
}

function waitForUiParseRetry() {
  return new Promise((resolve) => setTimeout(resolve, UI_PARSE_RETRY_DELAY_MS))
}

function isPreviewableUiFile(path: string | null | undefined, type: string | null | undefined) {
  const value = `${path ?? ''} ${type ?? ''}`.toLowerCase()
  return /\.(png|jpe?g|webp|gif)(\?|$)/u.test(value) || value.includes('image')
}

function getUiAssetThumbnail(row: UiAssetRow) {
  if (row.result?.thumbnailUrl) {
    return {
      name: `${row.name || row.result.panelName} 缩略图`,
      path: row.figmaUrl,
      url: row.result.thumbnailUrl,
    }
  }
  return row.result?.files.find((file) => file.url && isPreviewableUiFile(file.path, file.type)) ?? null
}

function isUnparsedUiRow(row: UiAssetRow) {
  return row.status === 'idle' && !row.result && row.figmaUrl.trim().length > 0
}

function createUiAssetRow(kind: UiAssetKind, figmaUrl: string): UiAssetRow {
  const now = new Date().toISOString()
  return {
    id: makeRowId('ui-asset'),
    name: '',
    kind,
    figmaUrl,
    parseMode: parseModeForKind(kind),
    purpose: '',
    usageNote: '',
    linkedNodeIds: [],
    status: 'idle',
    error: null,
    result: null,
    createdAt: now,
    updatedAt: now,
  }
}

function UiAssetThumbnail({ row }: { row: UiAssetRow }) {
  const thumbnail = getUiAssetThumbnail(row)

  return (
    <div className="flex h-[76px] w-[116px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-outline-variant/70 bg-surface">
      {thumbnail?.url ? (
        <img
          src={thumbnail.url}
          alt={thumbnail.name || row.name}
          className="h-full w-full object-contain"
          title={thumbnail.path}
        />
      ) : (
        <div className="grid justify-items-center gap-[2px] px-xs text-center text-on-surface-variant">
          <span
            className={['material-symbols-outlined', row.status === 'parsing' ? 'animate-spin text-secondary' : ''].join(' ')}
            style={{ fontSize: '20px' }}
          >
            {row.status === 'parsing'
              ? 'sync'
              : row.status === 'error'
                ? 'broken_image'
                : row.status === 'ready'
                  ? 'image_not_supported'
                  : 'image'}
          </span>
          <span className="text-[10px] leading-4">
            {row.status === 'parsing'
              ? '解析中'
              : row.status === 'ready'
                ? '无缩略图'
                : row.status === 'error'
                  ? '解析失败'
                  : '待解析'}
          </span>
        </div>
      )}
    </div>
  )
}

function uiAssetCellClassName(index: number, edge: 'left' | 'middle' | 'right') {
  const background = index % 2 === 0 ? 'bg-surface-container-low' : 'bg-surface-container-high'
  const edgeClass = edge === 'left'
    ? 'rounded-l-md border-l'
    : edge === 'right'
      ? 'rounded-r-md border-r'
      : ''
  return `border-y border-outline-variant/70 ${background} px-sm py-sm ${edgeClass}`
}

function TypeSegmentedControl({
  value,
  onChange,
  disabled = false,
}: {
  value: UiAssetKind
  onChange: (value: UiAssetKind) => void
  disabled?: boolean
}) {
  return (
    <div className="inline-grid min-h-[36px] w-full grid-cols-2 overflow-hidden rounded-md border border-outline-variant bg-surface">
      {([
        ['interface', '界面'],
        ['image_set', '散图'],
      ] as const).map(([kind, label]) => (
        <button
          key={kind}
          type="button"
          disabled={disabled}
          onClick={() => onChange(kind)}
          className={[
            'whitespace-nowrap px-sm text-label-md transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            value === kind
              ? 'bg-secondary-container text-on-secondary-container'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function AssetWorkbenchModal({ isOpen, baseUrl, onClose }: AssetWorkbenchModalProps) {
  const [activeTab, setActiveTab] = useState<'ui' | 'effect'>('ui')
  const [uiForm, setUiForm] = useState<UiAssetFormState>(() => emptyUiForm())
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiNotice, setUiNotice] = useState<string | null>(null)
  const [parsingUiRowIds, setParsingUiRowIds] = useState<string[]>([])
  const [isParsingAllUiRows, setIsParsingAllUiRows] = useState(false)
  const [effectRoot, setEffectRoot] = useState(() => useAppStore.getState().assetWorkbench.lastEffectScanRoot ?? DEFAULT_EFFECT_ROOT)
  const [effectError, setEffectError] = useState<string | null>(null)
  const [isScanningEffects, setIsScanningEffects] = useState(false)
  const [smartEffectNotes, setSmartEffectNotes] = useState(true)
  const [loadProgress, setLoadProgress] = useState<LoadProgressState>({ active: false, done: 0, total: 0, label: '' })
  const [localPathError, setLocalPathError] = useState<string | null>(null)
  const [localPathMessage, setLocalPathMessage] = useState<string | null>(null)
  const [isOpeningLocalPath, setIsOpeningLocalPath] = useState(false)

  const assetWorkbench = useAppStore((s) => s.assetWorkbench)
  const prdTree = useAppStore((s) => s.prdTree)
  const sourceDocument = useAppStore((s) => s.sourceDocument)
  const addUiAssetRow = useAppStore((s) => s.addUiAssetRow)
  const updateUiAssetRow = useAppStore((s) => s.updateUiAssetRow)
  const removeUiAssetRow = useAppStore((s) => s.removeUiAssetRow)
  const replaceEffectAssetRows = useAppStore((s) => s.replaceEffectAssetRows)
  const updateEffectAssetRow = useAppStore((s) => s.updateEffectAssetRow)
  const removeEffectAssetRow = useAppStore((s) => s.removeEffectAssetRow)

  useEffect(() => {
    if (!isOpen) return
    for (const row of assetWorkbench.uiRows) {
      const nextName = row.result ? resolvedUiAssetName(row, row.result) : ''
      const nextPurpose = !row.purpose.trim()
        ? inferUiAssetPurpose(nextName || row.name, prdTree, sourceDocument)
        : ''
      const patch: Partial<UiAssetRow> = {}
      if (nextName && nextName !== row.name) patch.name = nextName
      if (nextPurpose) patch.purpose = nextPurpose
      if (Object.keys(patch).length > 0) {
        updateUiAssetRow(row.id, patch)
      }
    }
  }, [assetWorkbench.uiRows, isOpen, prdTree, sourceDocument, updateUiAssetRow])

  if (!isOpen) return null

  function handleAddUiRow() {
    setUiError(null)
    setUiNotice(null)
    const urls = extractFigmaUrls(uiForm.figmaText)
    if (!urls.length) {
      setUiError('请先粘贴 Figma 链接。')
      return
    }
    for (const url of [...urls].reverse()) {
      addUiAssetRow(createUiAssetRow(uiForm.kind, url))
    }
    setUiNotice(`已添加 ${urls.length} 条${uiAssetKindLabel(uiForm.kind)}素材，名称和用途可在下方表格补充。`)
    setUiForm(emptyUiForm())
  }

  function setUiRowParsing(rowId: string, parsing: boolean) {
    setParsingUiRowIds((current) => {
      if (parsing) return current.includes(rowId) ? current : [...current, rowId]
      return current.filter((id) => id !== rowId)
    })
  }

  async function parseUiRow(rowId: string) {
    const row = useAppStore.getState().assetWorkbench.uiRows.find((item) => item.id === rowId)
    if (!row) return
    if (!row.figmaUrl.trim()) {
      updateUiAssetRow(rowId, { status: 'error', error: '请先填写 Figma 链接。' })
      return
    }

    setUiError(null)
    setUiRowParsing(rowId, true)
    updateUiAssetRow(rowId, { status: 'parsing', error: null, parseMode: parseModeForKind(row.kind) })
    try {
      let result: UiAssetParseResult
      try {
        result = await parseUiFigmaAsset(baseUrl, {
          url: row.figmaUrl,
          kind: row.kind,
        })
      } catch (error) {
        if (!isTransientFigmaExportError(error)) throw error
        setUiNotice(`Figma 图片导出第一次失败，正在自动重试「${resolvedUiAssetName(row) || row.figmaUrl}」。`)
        await waitForUiParseRetry()
        result = await parseUiFigmaAsset(baseUrl, {
          url: row.figmaUrl,
          kind: row.kind,
        })
      }
      const currentStore = useAppStore.getState()
      const nextName = resolvedUiAssetName(row, result)
      const nextPurpose = row.purpose.trim()
        || inferUiAssetPurpose(nextName || result.panelName, currentStore.prdTree, currentStore.sourceDocument)
      updateUiAssetRow(rowId, {
        status: 'ready',
        error: null,
        name: nextName,
        purpose: nextPurpose,
        parseMode: result.parseMode,
        result,
      })
    } catch (error) {
      updateUiAssetRow(rowId, {
        status: 'error',
        error: error instanceof Error ? error.message : '解析失败，请检查链接、Token 和代理服务。',
      })
    } finally {
      setUiRowParsing(rowId, false)
    }
  }

  async function handleParseUiRow(rowId: string) {
    if (isParsingAllUiRows || parsingUiRowIds.length > 0) return
    await parseUiRow(rowId)
  }

  async function handleChangeUiRowKind(rowId: string, nextKind: UiAssetKind) {
    if (isParsingAllUiRows || parsingUiRowIds.length > 0) return
    const row = useAppStore.getState().assetWorkbench.uiRows.find((item) => item.id === rowId)
    if (!row || row.kind === nextKind) return

    setUiError(null)
    setUiNotice(`已将「${row.name || row.figmaUrl}」切换为${uiAssetKindLabel(nextKind)}，正在重新解析。`)
    updateUiAssetRow(rowId, {
      kind: nextKind,
      parseMode: parseModeForKind(nextKind),
      name: shouldUseParsedUiAssetTitle(row) ? '' : row.name,
      status: 'idle',
      error: null,
      result: null,
    })
    await parseUiRow(rowId)
  }

  async function handleParseAllUiRows() {
    if (isParsingAllUiRows || parsingUiRowIds.length > 0) return
    const rowIds = useAppStore.getState().assetWorkbench.uiRows
      .filter(isUnparsedUiRow)
      .map((row) => row.id)
    if (!rowIds.length) {
      setUiNotice('当前没有未解析的 UI 素材。')
      return
    }
    setIsParsingAllUiRows(true)
    setUiNotice(`正在并行解析 ${rowIds.length} 条 UI 素材，最多同时 ${UI_PARSE_ALL_CONCURRENCY} 条。`)
    let nextIndex = 0
    async function runWorker() {
      while (nextIndex < rowIds.length) {
        const rowId = rowIds[nextIndex]
        nextIndex += 1
        await parseUiRow(rowId)
      }
    }

    try {
      const workerCount = Math.min(UI_PARSE_ALL_CONCURRENCY, rowIds.length)
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
      setUiNotice(`批量解析完成：已处理 ${rowIds.length} 条 UI 素材。`)
    } finally {
      setIsParsingAllUiRows(false)
    }
  }

  async function handleScanEffects() {
    const root = effectRoot.trim()
    if (!root) {
      setEffectError('请填写资源目录。')
      return
    }
    setEffectError(null)
    setIsScanningEffects(true)
    try {
      const result = await scanEffectAssetDirectory(baseUrl, root, {
        smartNotes: smartEffectNotes,
        contextHints: smartEffectNotes ? buildEffectSmartNoteContext(prdTree, sourceDocument) : [],
      })
      replaceEffectAssetRows(result.sourceRoot, result.rows)
      setEffectRoot(result.sourceRoot)
      if (result.truncated) {
        setEffectError(`已达到扫描上限，当前导入 ${result.scannedFileCount} 个文件。`)
      }
    } catch (error) {
      setEffectError(error instanceof Error ? error.message : '扫描失败，请检查路径和权限。')
    } finally {
      setIsScanningEffects(false)
    }
  }

  async function handleLoadEffectRows(rows: EffectAssetRow[]) {
    const targets = rows.filter((row) => row.files.length > 0)
    if (!targets.length || loadProgress.active) return

    setEffectError(null)
    setLoadProgress({ active: true, done: 0, total: targets.length, label: '准备加载资源' })
    for (const [index, row] of targets.entries()) {
      setLoadProgress({ active: true, done: index, total: targets.length, label: row.name })
      updateEffectAssetRow(row.id, { loadStatus: 'loading', loadError: null })
      try {
        const result = await loadEffectAssetRow(baseUrl, row)
        updateEffectAssetRow(row.id, result.row)
      } catch (error) {
        updateEffectAssetRow(row.id, {
          loadStatus: 'error',
          loadError: error instanceof Error ? error.message : '加载失败',
        })
        setEffectError(error instanceof Error ? error.message : '加载失败')
      }
      setLoadProgress({ active: true, done: index + 1, total: targets.length, label: row.name })
    }
    setLoadProgress((current) => ({ ...current, active: false, label: '加载完成' }))
  }

  async function handleOpenLocalPath() {
    if (isOpeningLocalPath) return
    setLocalPathError(null)
    setLocalPathMessage(null)
    setIsOpeningLocalPath(true)
    try {
      const result = await openAssetLibraryLocalPath(baseUrl)
      setLocalPathMessage(`已请求打开本地路径：${result.path}`)
    } catch (error) {
      setLocalPathError(error instanceof Error ? error.message : '打开本地路径失败。')
    } finally {
      setIsOpeningLocalPath(false)
    }
  }

  const effectRowCount = assetWorkbench.effectRows.length
  const loadedEffectRowCount = assetWorkbench.effectRows.filter((row) => row.loadStatus === 'loaded').length
  const loadableEffectRowCount = assetWorkbench.effectRows.filter((row) => row.files.length > 0).length
  const unparsedUiRowCount = assetWorkbench.uiRows.filter(isUnparsedUiRow).length
  const activeUiParseCount = parsingUiRowIds.length
  const effectLoadSummary = loadProgress.active
    ? `加载中 ${loadProgress.done}/${loadProgress.total}`
    : loadProgress.total > 0
      ? `上次加载 ${loadProgress.done}/${loadProgress.total}`
      : `已加载 ${loadedEffectRowCount}/${effectRowCount}`

  return (
    <div className="fixed inset-0 z-[150] bg-surface">
      <section className="flex h-screen w-screen flex-col overflow-hidden bg-surface">
        <header className="flex shrink-0 items-center justify-between gap-md border-b border-outline-variant bg-surface-container-low px-md py-md md:px-lg">
          <div className="min-w-0">
            <div className="flex items-center gap-sm">
              <span className="material-symbols-outlined shrink-0 text-secondary" style={{ fontSize: '20px' }}>inventory_2</span>
              <h2 className="truncate font-title-md text-title-md text-on-surface">资源库</h2>
            </div>
            <p className="mt-xs truncate text-body-sm text-on-surface-variant">
              UI 中间产物、散图和特效资源映射表。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-sm">
            <button
              type="button"
              onClick={() => void handleOpenLocalPath()}
              disabled={isOpeningLocalPath}
              className="flex min-h-[40px] items-center gap-xs whitespace-nowrap rounded-lg border border-outline-variant bg-surface-container-high px-md text-label-md text-on-surface-variant transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className={['material-symbols-outlined', isOpeningLocalPath ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '18px' }}>
                {isOpeningLocalPath ? 'sync' : 'folder_open'}
              </span>
              打开本地路径
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-high text-on-surface-variant transition-colors hover:text-on-surface"
              aria-label="关闭资源库"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
            </button>
          </div>
        </header>

        <div className="flex shrink-0 gap-xs border-b border-outline-variant bg-surface-container-low px-md py-sm md:px-lg">
          <button
            type="button"
            onClick={() => setActiveTab('ui')}
            className={[
              'flex min-h-[36px] items-center gap-xs whitespace-nowrap rounded-lg border px-md text-label-md transition-colors',
              activeTab === 'ui'
                ? 'border-secondary bg-secondary-container text-on-secondary-container'
                : 'border-outline-variant bg-surface-container-high text-on-surface-variant hover:text-on-surface',
            ].join(' ')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>design_services</span>
            UI 素材
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('effect')}
            className={[
              'flex min-h-[36px] items-center gap-xs whitespace-nowrap rounded-lg border px-md text-label-md transition-colors',
              activeTab === 'effect'
                ? 'border-tertiary bg-tertiary-container text-on-tertiary-container'
                : 'border-outline-variant bg-surface-container-high text-on-surface-variant hover:text-on-surface',
            ].join(' ')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>auto_awesome</span>
            特效资源
          </button>
        </div>

        {localPathError ? (
          <div className="shrink-0 border-b border-error/30 bg-error/10 px-lg py-sm text-body-sm text-error">{localPathError}</div>
        ) : null}
        {localPathMessage ? (
          <div className="shrink-0 border-b border-tertiary/30 bg-tertiary/10 px-lg py-sm text-body-sm text-tertiary">{localPathMessage}</div>
        ) : null}

        {activeTab === 'ui' ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-outline-variant bg-surface-container-low px-md py-sm md:px-lg">
              <div className="grid gap-sm md:grid-cols-[150px_minmax(420px,1fr)_auto_auto] md:items-end">
                <div className={toolbarFieldClassName}>
                  <span className={toolbarLabelClassName}>添加类型</span>
                  <TypeSegmentedControl
                    value={uiForm.kind}
                    onChange={(kind) => setUiForm((current) => ({ ...current, kind }))}
                  />
                </div>
                <label className={toolbarFieldClassName}>
                  <span className={toolbarLabelClassName}>Figma 链接</span>
                  <textarea
                    value={uiForm.figmaText}
                    onChange={(event) => setUiForm((current) => ({ ...current, figmaText: event.target.value }))}
                    placeholder="粘贴一个或多个 Figma 链接；散图可按行批量粘贴"
                    className="min-h-[72px] w-full min-w-0 resize-y rounded-md border border-outline-variant bg-surface px-sm py-xs text-body-sm text-on-surface outline-none focus:border-secondary"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleAddUiRow}
                  className="flex min-h-[36px] items-center justify-center gap-xs whitespace-nowrap rounded-md border border-secondary bg-secondary-container px-md text-label-md text-on-secondary-container transition-opacity hover:opacity-90 md:self-end"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
                  添加{uiAssetKindLabel(uiForm.kind)}
                </button>
                <button
                  type="button"
                  onClick={() => void handleParseAllUiRows()}
                  disabled={isParsingAllUiRows || activeUiParseCount > 0 || unparsedUiRowCount === 0}
                  className="flex min-h-[36px] items-center justify-center gap-xs whitespace-nowrap rounded-md border border-outline-variant bg-surface-container-high px-md text-label-md text-on-surface-variant transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 md:self-end"
                  title={unparsedUiRowCount > 0 ? `还有 ${unparsedUiRowCount} 条未解析` : '没有未解析条目'}
                >
                  <span className={['material-symbols-outlined', isParsingAllUiRows ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '16px' }}>
                    {isParsingAllUiRows ? 'sync' : 'download'}
                  </span>
                  解析全部
                </button>
              </div>
            </div>

            {uiError ? (
              <div className="shrink-0 border-b border-error/30 bg-error/10 px-lg py-sm text-body-sm text-error">{uiError}</div>
            ) : null}
            {uiNotice ? (
              <div className="shrink-0 border-b border-tertiary/30 bg-tertiary/10 px-lg py-sm text-body-sm text-tertiary">{uiNotice}</div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              <table className="w-full table-fixed border-separate border-spacing-y-2 px-md text-left">
                <colgroup>
                  <col className="w-[140px]" />
                  <col className="w-[220px]" />
                  <col className="w-[32%]" />
                  <col />
                  <col className="w-[112px]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-surface-container-high text-label-md text-on-surface-variant">
                  <tr>
                    {['缩略图', '名称与类型', '链接与用途', '解析结果', '操作'].map((label) => (
                      <th key={label} className="whitespace-nowrap border-b border-outline-variant px-sm py-sm">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {assetWorkbench.uiRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-lg py-xl text-center text-body-sm text-on-surface-variant">
                        还没有 UI 素材记录。选择界面或散图后粘贴 Figma 链接，名称和用途可在表格中补充。
                      </td>
                    </tr>
                  ) : assetWorkbench.uiRows.map((row, index) => (
                    <tr key={row.id} className="align-top text-body-sm text-on-surface transition-colors hover:[&>td]:bg-surface-container">
                      <td className={uiAssetCellClassName(index, 'left')}>
                        <UiAssetThumbnail row={row} />
                      </td>
                      <td className={uiAssetCellClassName(index, 'middle')}>
                        <div className="grid gap-xs">
                          <div className="grid gap-[2px]" title="切换类型后会自动重新解析">
                            <TypeSegmentedControl
                              value={row.kind}
                              onChange={(kind) => void handleChangeUiRowKind(row.id, kind)}
                              disabled={isParsingAllUiRows || activeUiParseCount > 0}
                            />
                            <span className="font-mono text-[10px] uppercase text-on-surface-variant">
                              {derivedParseLabel(row.kind)}
                            </span>
                          </div>
                          <input
                            value={row.name}
                            onChange={(event) => updateUiAssetRow(row.id, { name: event.target.value })}
                            placeholder={uiAssetNamePlaceholder(row.kind)}
                            className={inputClassName}
                          />
                        </div>
                      </td>
                      <td className={uiAssetCellClassName(index, 'middle')}>
                        <div className="grid gap-xs">
                          <input
                            value={row.figmaUrl}
                            onChange={(event) => updateUiAssetRow(row.id, {
                              figmaUrl: event.target.value,
                              status: 'idle',
                              error: null,
                              result: null,
                              parseMode: parseModeForKind(row.kind),
                            })}
                            title={row.figmaUrl}
                            className={`${inputClassName} font-mono text-[11px]`}
                          />
                          <textarea
                            value={row.purpose}
                            onChange={(event) => updateUiAssetRow(row.id, { purpose: event.target.value })}
                            placeholder="补充素材用途、页面状态或交互节点"
                            className={compactTextareaClassName}
                          />
                        </div>
                      </td>
                      <td className={uiAssetCellClassName(index, 'middle')}>
                        <div className="grid gap-xs">
                          <div className="flex flex-wrap items-center gap-xs">
                            <span className={['inline-flex min-h-[26px] items-center whitespace-nowrap rounded border px-xs text-label-md', statusTone(row.status)].join(' ')}>
                              {statusLabel(row.status)}
                            </span>
                            <span className="whitespace-nowrap font-mono text-[11px] text-on-surface-variant">
                              {row.result?.imageCount ?? row.result?.assetCount ?? 0} 图
                            </span>
                          </div>
                          {row.error ? <div className="text-[11px] leading-4 text-error">{row.error}</div> : null}
                          {row.result?.summary ? <div className="line-clamp-2 text-[11px] leading-4 text-on-surface-variant">{row.result.summary}</div> : null}
                          {row.kind === 'interface' ? (
                            <>
                              <PathSummaryLine label="缓存" value={row.result?.outputDir} />
                              <PathSummaryLine label="JSON" value={row.result?.uiSpecPath} />
                              <PathSummaryLine label="图片" value={row.result?.assetsDir} />
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className={uiAssetCellClassName(index, 'right')}>
                        <div className="flex flex-col gap-xs">
                          <button
                            type="button"
                            onClick={() => void handleParseUiRow(row.id)}
                            disabled={isParsingAllUiRows || activeUiParseCount > 0}
                            className={`${actionButtonClassName} border-secondary/40 bg-secondary/15 text-secondary`}
                          >
                            <span className={['material-symbols-outlined', parsingUiRowIds.includes(row.id) ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '15px' }}>
                              {parsingUiRowIds.includes(row.id) ? 'sync' : row.status === 'ready' ? 'refresh' : 'download'}
                            </span>
                            {row.status === 'ready' ? '重解析' : '解析'}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeUiAssetRow(row.id)}
                            className={`${actionButtonClassName} border-error/40 bg-error/10 text-error`}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>delete</span>
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-outline-variant bg-surface-container-low px-md py-sm md:px-lg">
              <div className="grid gap-sm md:grid-cols-[minmax(340px,1fr)_auto_auto_auto_minmax(180px,auto)] md:items-end">
                <label className={toolbarFieldClassName}>
                  <span className={toolbarLabelClassName}>资源目录</span>
                  <input
                    value={effectRoot}
                    onChange={(event) => setEffectRoot(event.target.value)}
                    placeholder="共享目录或本地特效目录"
                    className={inputClassName}
                  />
                </label>
                <label className="flex min-h-[36px] items-center gap-xs whitespace-nowrap rounded-md border border-outline-variant bg-surface px-sm text-label-md text-on-surface-variant md:self-end">
                  <input
                    type="checkbox"
                    checked={smartEffectNotes}
                    onChange={(event) => setSmartEffectNotes(event.target.checked)}
                    className="h-4 w-4 accent-tertiary"
                  />
                  智能备注
                </label>
                <button
                  type="button"
                  onClick={() => void handleScanEffects()}
                  disabled={isScanningEffects}
                  className="flex min-h-[36px] items-center justify-center gap-xs whitespace-nowrap rounded-md border border-tertiary bg-tertiary-container px-md text-label-md text-on-tertiary-container transition-opacity hover:opacity-90 disabled:opacity-40 md:self-end"
                >
                  <span className={['material-symbols-outlined', isScanningEffects ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '16px' }}>
                    {isScanningEffects ? 'sync' : 'folder_search'}
                  </span>
                  扫描
                </button>
                <button
                  type="button"
                  onClick={() => void handleLoadEffectRows(assetWorkbench.effectRows)}
                  disabled={loadProgress.active || isScanningEffects || loadableEffectRowCount === 0}
                  className="flex min-h-[36px] items-center justify-center gap-xs whitespace-nowrap rounded-md border border-secondary bg-secondary-container px-md text-label-md text-on-secondary-container transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 md:self-end"
                >
                  <span className={['material-symbols-outlined', loadProgress.active ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '16px' }}>
                    {loadProgress.active ? 'sync' : 'download'}
                  </span>
                  Load 全部
                </button>
                <div className={`${toolbarSummaryClassName} md:self-end`} title={loadProgress.active ? loadProgress.label : undefined}>
                  <span className="material-symbols-outlined shrink-0 text-on-surface-variant" style={{ fontSize: '16px' }}>
                    {loadProgress.active ? 'sync' : 'inventory_2'}
                  </span>
                  <span className="min-w-0 truncate">{effectLoadSummary}</span>
                  <span className="font-mono text-[11px] text-on-surface-variant">{effectRowCount} 项</span>
                </div>
              </div>
            </div>

            {effectError ? (
              <div className="shrink-0 border-b border-error/30 bg-error/10 px-lg py-sm text-body-sm text-error">{effectError}</div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              <table className="w-full table-fixed border-collapse text-left">
                <colgroup>
                  <col className="w-[25%]" />
                  <col className="w-[21%]" />
                  <col />
                  <col className="w-[112px]" />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-surface-container-high text-label-md text-on-surface-variant">
                  <tr>
                    {['资源', '加载', '备注', '操作'].map((label) => (
                      <th key={label} className="whitespace-nowrap border-b border-outline-variant px-sm py-sm">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {assetWorkbench.effectRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-lg py-xl text-center text-body-sm text-on-surface-variant">
                        还没有特效资源记录。填写共享目录后扫描。
                      </td>
                    </tr>
                  ) : assetWorkbench.effectRows.map((row) => (
                    <tr key={row.id} className="align-top text-body-sm text-on-surface">
                      <td className="px-sm py-sm">
                        <div className="grid gap-xs">
                          <input
                            value={row.name}
                            onChange={(event) => updateEffectAssetRow(row.id, { name: event.target.value })}
                            className={inputClassName}
                          />
                          <div className="flex flex-wrap items-center gap-xs">
                            <span className="inline-flex whitespace-nowrap rounded border border-tertiary/40 bg-tertiary/10 px-xs py-[2px] text-label-md text-tertiary">
                              {effectKindLabel(row.kind)}
                            </span>
                            <span className="font-mono text-[11px] text-on-surface-variant">{row.fileCount} 文件</span>
                            <EffectPreviewCell row={row} />
                          </div>
                          <PathSummaryLine label="源" value={row.localPath} />
                        </div>
                      </td>
                      <td className="px-sm py-sm">
                        <div className="grid gap-xs">
                          <div className="flex flex-wrap items-center gap-xs">
                            <span className={['inline-flex whitespace-nowrap rounded border px-xs py-[2px] text-label-md', loadStatusTone(row.loadStatus)].join(' ')}>
                              {loadStatusLabel(row.loadStatus)}
                            </span>
                            <span className="whitespace-nowrap font-mono text-code-sm text-on-surface-variant">
                              {row.loadedFileCount}/{row.fileCount}
                            </span>
                            <span className="whitespace-nowrap font-mono text-[11px] text-on-surface-variant">
                              {formatBytes(row.loadedBytes)}
                            </span>
                          </div>
                          {row.loadError ? <div className="text-[11px] leading-4 text-error">{row.loadError}</div> : null}
                          <PathSummaryLine label="缓存" value={row.loadedPath ?? row.loadedRoot} />
                        </div>
                      </td>
                      <td className="px-sm py-sm">
                        <div className="grid gap-xs">
                          <textarea
                            value={effectRowNote(row)}
                            onChange={(event) => updateEffectAssetRow(row.id, {
                              usageNote: event.target.value,
                              purpose: '',
                              pageHint: '',
                              implementationHint: '',
                            })}
                            placeholder="备注"
                            className="min-h-[92px] w-full min-w-0 resize-y rounded-md border border-outline-variant bg-surface px-sm py-xs text-body-sm text-on-surface outline-none focus:border-tertiary"
                          />
                        </div>
                      </td>
                      <td className="px-sm py-sm">
                        <div className="flex flex-col gap-xs">
                          <button
                            type="button"
                            onClick={() => void handleLoadEffectRows([row])}
                            disabled={loadProgress.active || row.files.length === 0}
                            className={`${actionButtonClassName} border-secondary/40 bg-secondary/15 text-secondary`}
                          >
                            <span className={['material-symbols-outlined', row.loadStatus === 'loading' ? 'animate-spin' : ''].join(' ')} style={{ fontSize: '15px' }}>
                              {row.loadStatus === 'loading' ? 'sync' : 'download'}
                            </span>
                            Load
                          </button>
                          <button
                            type="button"
                            onClick={() => removeEffectAssetRow(row.id)}
                            className={`${actionButtonClassName} border-error/40 bg-error/10 text-error`}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>delete</span>
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
