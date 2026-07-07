/**
 * Asset workbench normalization helpers.
 *
 * Extracted from src/store/appStore.ts. Pure data transforms for UI/effect/
 * audio asset rows and reusable logic assets, with no dependency on the store.
 */
import type {
  AssetWorkbenchState,
  AudioAssetRow,
  EffectAssetRow,
} from '../../types/assetWorkbench'
import { isRecord, normalizeOptionalText } from './text'
import type { ReusableLogicAsset } from '../../types/reusableLogic'

export function emptyAssetWorkbenchState(): AssetWorkbenchState {
  return {
    uiRows: [],
    effectRows: [],
    audioRows: [],
    reusableLogicAssets: [],
    lastEffectScanRoot: null,
    lastAudioScanRoot: null,
  }
}


export function normalizeUiAssetKind(rowOrKind: unknown) {
  const rawKind = isRecord(rowOrKind) ? rowOrKind.kind : rowOrKind
  const rawParseMode = isRecord(rowOrKind) ? rowOrKind.parseMode : undefined
  const rawResult = isRecord(rowOrKind) ? rowOrKind.result : undefined
  const rawResultParseMode = isRecord(rawResult) ? rawResult.parseMode : undefined
  const kindText = String(rawKind ?? '').trim().toLowerCase()

  if (
    kindText === 'image_set'
    || kindText === 'component'
    || kindText === 'image'
    || kindText === 'images'
    || kindText === 'image-set'
    || kindText === '散图'
  ) {
    return 'image_set'
  }

  if (rawParseMode === 'image_set' || rawResultParseMode === 'image_set') {
    return 'image_set'
  }

  return 'interface'
}


export function normalizeUiAssetParseMode(value: unknown, kind: ReturnType<typeof normalizeUiAssetKind>) {
  if (kind === 'image_set') return 'image_set'
  return value === 'image_set' ? 'image_set' : 'intermediate'
}


export function normalizeEffectLoadStatus(value: unknown) {
  return value === 'loading' || value === 'loaded' || value === 'error' ? value : 'not_loaded'
}


export function normalizeAudioLoadStatus(value: unknown) {
  return value === 'loading' || value === 'loaded' || value === 'error' ? value : 'not_loaded'
}


export function normalizeStringArrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}


export function normalizeEffectSpineAsset(value: unknown): EffectAssetRow['spine'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as NonNullable<EffectAssetRow['spine']>
  const atlasUrl = typeof raw.atlasUrl === 'string' && raw.atlasUrl.trim() ? raw.atlasUrl : null
  const textureUrls = normalizeStringArrayValue(raw.textureUrls)
  if (!atlasUrl || textureUrls.length === 0) return null
  return {
    jsonUrl: typeof raw.jsonUrl === 'string' && raw.jsonUrl.trim() ? raw.jsonUrl : null,
    binaryUrl: typeof raw.binaryUrl === 'string' && raw.binaryUrl.trim() ? raw.binaryUrl : null,
    atlasUrl,
    textureUrls,
    animationNames: normalizeStringArrayValue(raw.animationNames),
    skinNames: normalizeStringArrayValue(raw.skinNames),
    defaultAnimation: typeof raw.defaultAnimation === 'string' && raw.defaultAnimation.trim() ? raw.defaultAnimation : null,
    skeletonVersion: typeof raw.skeletonVersion === 'string' && raw.skeletonVersion.trim() ? raw.skeletonVersion : null,
    premultipliedAlpha: typeof raw.premultipliedAlpha === 'boolean' ? raw.premultipliedAlpha : null,
    playerJsUrl: typeof raw.playerJsUrl === 'string' && raw.playerJsUrl.trim() ? raw.playerJsUrl : null,
    playerCssUrl: typeof raw.playerCssUrl === 'string' && raw.playerCssUrl.trim() ? raw.playerCssUrl : null,
  }
}


export function normalizeReusableLogicStatus(value: unknown): ReusableLogicAsset['status'] {
  return value === 'approved' || value === 'ignored' ? value : 'candidate'
}


export function normalizeReusableLogicType(value: unknown): ReusableLogicAsset['type'] {
  if (
    value === 'interaction_state'
    || value === 'animation_rule'
    || value === 'feedback_pattern'
    || value === 'component_pattern'
    || value === 'copywriting_pattern'
  ) {
    return value
  }
  return 'interaction_state'
}


export function normalizeReusableLogicAssets(value: unknown): ReusableLogicAsset[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ReusableLogicAsset[] => {
    if (!isRecord(item)) return []
    const id = normalizeOptionalText(item.id)
    const name = normalizeOptionalText(item.name)
    const logic = normalizeOptionalText(item.logic)
    const source = isRecord(item.source) ? item.source : {}
    const sourceNodeId = normalizeOptionalText(source.nodeId)
    const sourceNodeLabel = normalizeOptionalText(source.nodeLabel)
    if (!id || !name || !logic || !sourceNodeId || !sourceNodeLabel) return []
    const now = new Date().toISOString()
    return [{
      id,
      name,
      type: normalizeReusableLogicType(item.type),
      status: normalizeReusableLogicStatus(item.status),
      reuseMode: item.reuseMode === 'copy' ? 'copy' : 'reference',
      description: normalizeOptionalText(item.description) ?? logic,
      logic,
      usageGuidance: normalizeOptionalText(item.usageGuidance) ?? '复用前确认当前节点资源、层级和结束状态是否匹配。',
      tags: Array.isArray(item.tags)
        ? item.tags.map((tag) => normalizeOptionalText(tag)).filter((tag): tag is string => Boolean(tag)).slice(0, 10)
        : [],
      source: {
        nodeId: sourceNodeId,
        nodeLabel: sourceNodeLabel,
        field: normalizeOptionalText(source.field) ?? 'performanceSpec',
        excerpt: normalizeOptionalText(source.excerpt),
      },
      createdAt: normalizeOptionalText(item.createdAt) ?? now,
      updatedAt: normalizeOptionalText(item.updatedAt) ?? now,
    }]
  })
}


export function normalizeAudioAssetKind(value: unknown): AudioAssetRow['kind'] {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === 'sfx' || text === 'effect' || text === 'sound_effect') return 'sfx'
  if (text === 'music' || text === 'bgm') return 'music'
  if (text === 'voice' || text === 'vo') return 'voice'
  if (text === 'ambient' || text === 'ambience') return 'ambient'
  return 'unknown'
}


export function normalizeAudioAssetRow(row: Partial<AudioAssetRow> & Record<string, unknown>): AudioAssetRow {
  const now = new Date().toISOString()
  const files = Array.isArray(row.files)
    ? row.files.map((file) => ({
        ...(file as AudioAssetRow['files'][number]),
        loadedPath: typeof (file as { loadedPath?: unknown }).loadedPath === 'string' ? (file as { loadedPath: string }).loadedPath : null,
        previewUrl: typeof (file as { previewUrl?: unknown }).previewUrl === 'string' ? (file as { previewUrl: string }).previewUrl : null,
      }))
    : []
  return {
    id: normalizeOptionalText(row.id) ?? `audio-${now}`,
    name: normalizeOptionalText(row.name) ?? 'Audio asset',
    kind: normalizeAudioAssetKind(row.kind),
    sourceRoot: normalizeOptionalText(row.sourceRoot) ?? '',
    relativePath: normalizeOptionalText(row.relativePath) ?? '',
    localPath: normalizeOptionalText(row.localPath) ?? normalizeOptionalText(row.sourceRoot) ?? '',
    purpose: normalizeOptionalText(row.purpose) ?? '',
    usageNote: normalizeOptionalText(row.usageNote) ?? '',
    triggerHint: normalizeOptionalText(row.triggerHint) ?? normalizeOptionalText((row as { pageHint?: unknown }).pageHint) ?? '',
    playbackHint: normalizeOptionalText(row.playbackHint) ?? normalizeOptionalText((row as { implementationHint?: unknown }).implementationHint) ?? '',
    linkedNodeIds: Array.isArray(row.linkedNodeIds) ? row.linkedNodeIds.filter((id): id is string => typeof id === 'string') : [],
    status: row.status === 'parsing' || row.status === 'error' || row.status === 'idle' ? row.status : 'ready',
    loadStatus: normalizeAudioLoadStatus(row.loadStatus),
    loadError: typeof row.loadError === 'string' ? row.loadError : null,
    loadedRoot: typeof row.loadedRoot === 'string' ? row.loadedRoot : null,
    loadedPath: typeof row.loadedPath === 'string' ? row.loadedPath : null,
    loadedFileCount: typeof row.loadedFileCount === 'number' ? row.loadedFileCount : 0,
    loadedBytes: typeof row.loadedBytes === 'number' ? row.loadedBytes : 0,
    loadedAt: typeof row.loadedAt === 'string' ? row.loadedAt : null,
    previewUrl: typeof row.previewUrl === 'string' ? row.previewUrl : null,
    durationMs: typeof row.durationMs === 'number' ? row.durationMs : null,
    fileCount: typeof row.fileCount === 'number' ? row.fileCount : files.length,
    files,
    createdAt: normalizeOptionalText(row.createdAt) ?? now,
    updatedAt: normalizeOptionalText(row.updatedAt) ?? now,
  }
}


export function audioRowFromLegacyEffectRow(row: EffectAssetRow): AudioAssetRow {
  return normalizeAudioAssetRow({
    ...row,
    id: row.id.replace(/^effect-/u, 'audio-'),
    kind: 'sfx',
    triggerHint: row.pageHint,
    playbackHint: row.implementationHint,
  })
}


export function normalizeAssetWorkbench(value: AssetWorkbenchState | null | undefined): AssetWorkbenchState {
  if (!value || typeof value !== 'object') return emptyAssetWorkbenchState()
  const legacyAudioRows = Array.isArray(value.effectRows)
    ? value.effectRows
        .filter((row) => (row as { kind?: unknown }).kind === 'audio')
        .map((row) => audioRowFromLegacyEffectRow(row as EffectAssetRow))
    : []
  const audioRows = [
    ...(Array.isArray((value as { audioRows?: unknown }).audioRows)
      ? (value as unknown as { audioRows: Array<Partial<AudioAssetRow> & Record<string, unknown>> }).audioRows.map(normalizeAudioAssetRow)
      : []),
    ...legacyAudioRows,
  ]
  return {
    uiRows: Array.isArray(value.uiRows)
      ? value.uiRows.map((row) => {
          const kind = normalizeUiAssetKind(row)
          return {
            ...row,
            kind,
            parseMode: normalizeUiAssetParseMode((row as { parseMode?: unknown }).parseMode, kind),
          }
        })
      : [],
    effectRows: Array.isArray(value.effectRows)
      ? value.effectRows.filter((row) => (row as { kind?: unknown }).kind !== 'audio').map((row) => ({
          ...row,
          loadStatus: normalizeEffectLoadStatus((row as { loadStatus?: unknown }).loadStatus),
          loadError: typeof (row as { loadError?: unknown }).loadError === 'string' ? (row as { loadError: string }).loadError : null,
          loadedRoot: typeof (row as { loadedRoot?: unknown }).loadedRoot === 'string' ? (row as { loadedRoot: string }).loadedRoot : null,
          loadedPath: typeof (row as { loadedPath?: unknown }).loadedPath === 'string' ? (row as { loadedPath: string }).loadedPath : null,
          loadedFileCount: typeof (row as { loadedFileCount?: unknown }).loadedFileCount === 'number' ? (row as { loadedFileCount: number }).loadedFileCount : 0,
          loadedBytes: typeof (row as { loadedBytes?: unknown }).loadedBytes === 'number' ? (row as { loadedBytes: number }).loadedBytes : 0,
          loadedAt: typeof (row as { loadedAt?: unknown }).loadedAt === 'string' ? (row as { loadedAt: string }).loadedAt : null,
          previewType: ['image', 'sequence', 'video', 'audio', 'spine'].includes(String((row as { previewType?: unknown }).previewType))
            ? (row as { previewType: EffectAssetRow['previewType'] }).previewType
            : null,
          previewUrl: typeof (row as { previewUrl?: unknown }).previewUrl === 'string' ? (row as { previewUrl: string }).previewUrl : null,
          previewFiles: Array.isArray((row as { previewFiles?: unknown }).previewFiles)
            ? (row as { previewFiles: EffectAssetRow['previewFiles'] }).previewFiles.filter((file) => (
                file && typeof file.name === 'string' && typeof file.ext === 'string' && typeof file.url === 'string'
              ))
            : [],
          spine: normalizeEffectSpineAsset((row as { spine?: unknown }).spine),
          files: Array.isArray(row.files)
            ? row.files.map((file) => ({
                ...file,
                loadedPath: typeof (file as { loadedPath?: unknown }).loadedPath === 'string' ? (file as { loadedPath: string }).loadedPath : null,
                previewUrl: typeof (file as { previewUrl?: unknown }).previewUrl === 'string' ? (file as { previewUrl: string }).previewUrl : null,
              }))
            : [],
        }))
      : [],
    audioRows,
    reusableLogicAssets: normalizeReusableLogicAssets((value as { reusableLogicAssets?: unknown }).reusableLogicAssets),
    lastEffectScanRoot: typeof value.lastEffectScanRoot === 'string' ? value.lastEffectScanRoot : null,
    lastAudioScanRoot: typeof (value as { lastAudioScanRoot?: unknown }).lastAudioScanRoot === 'string' ? (value as { lastAudioScanRoot: string }).lastAudioScanRoot : null,
  }
}


export function mergeEffectAssetScanRows(existingRows: EffectAssetRow[], sourceRoot: string, scannedRows: EffectAssetRow[]) {
  const existingById = new Map(existingRows.filter((row) => row.sourceRoot === sourceRoot).map((row) => [row.id, row]))
  const mergedRows = scannedRows.map((row) => {
    const existing = existingById.get(row.id)
    if (!existing) return row
    const loadedPathBySourcePath = new Map(existing.files.map((file) => [file.path, file.loadedPath ?? null]))
    const scannedNote = row.usageNote.trim()
    return {
      ...row,
      name: existing.name,
      purpose: scannedNote ? '' : existing.purpose,
      usageNote: scannedNote || existing.usageNote,
      pageHint: scannedNote ? '' : existing.pageHint,
      implementationHint: scannedNote ? '' : existing.implementationHint,
      linkedNodeIds: existing.linkedNodeIds,
      loadStatus: existing.loadStatus,
      loadError: existing.loadError,
      loadedRoot: existing.loadedRoot,
      loadedPath: existing.loadedPath,
      loadedFileCount: existing.loadedFileCount,
      loadedBytes: existing.loadedBytes,
      loadedAt: existing.loadedAt,
      previewType: existing.previewType,
      previewUrl: existing.previewUrl,
      previewFiles: existing.previewFiles,
      spine: existing.spine,
      files: row.files.map((file) => ({
        ...file,
        loadedPath: loadedPathBySourcePath.get(file.path) ?? null,
        previewUrl: existing.files.find((existingFile) => existingFile.path === file.path)?.previewUrl ?? null,
      })),
      createdAt: existing.createdAt,
      updatedAt: row.updatedAt,
    }
  })
  return [
    ...mergedRows,
    ...existingRows.filter((row) => row.sourceRoot !== sourceRoot),
  ]
}


export function mergeAudioAssetScanRows(existingRows: AudioAssetRow[], sourceRoot: string, scannedRows: AudioAssetRow[]) {
  const existingById = new Map(existingRows.filter((row) => row.sourceRoot === sourceRoot).map((row) => [row.id, row]))
  const mergedRows = scannedRows.map((row) => {
    const existing = existingById.get(row.id)
    if (!existing) return row
    const loadedPathBySourcePath = new Map(existing.files.map((file) => [file.path, file.loadedPath ?? null]))
    return {
      ...row,
      name: existing.name,
      kind: existing.kind,
      purpose: existing.purpose,
      usageNote: existing.usageNote || row.usageNote,
      triggerHint: existing.triggerHint || row.triggerHint,
      playbackHint: existing.playbackHint || row.playbackHint,
      linkedNodeIds: existing.linkedNodeIds,
      loadStatus: existing.loadStatus,
      loadError: existing.loadError,
      loadedRoot: existing.loadedRoot,
      loadedPath: existing.loadedPath,
      loadedFileCount: existing.loadedFileCount,
      loadedBytes: existing.loadedBytes,
      loadedAt: existing.loadedAt,
      previewUrl: existing.previewUrl,
      durationMs: existing.durationMs,
      files: row.files.map((file) => ({
        ...file,
        loadedPath: loadedPathBySourcePath.get(file.path) ?? null,
        previewUrl: existing.files.find((existingFile) => existingFile.path === file.path)?.previewUrl ?? null,
      })),
      createdAt: existing.createdAt,
      updatedAt: row.updatedAt,
    }
  })
  return [
    ...mergedRows,
    ...existingRows.filter((row) => row.sourceRoot !== sourceRoot),
  ]
}
