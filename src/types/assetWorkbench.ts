import type { PrototypeInterfaceBlueprint, PrototypeSpineAsset } from './prototypeAssets'
import type { ReusableLogicAsset } from './reusableLogic'

export type UiAssetKind = 'interface' | 'image_set'
export type UiAssetParseMode = 'intermediate' | 'image_set'
export type AssetRowStatus = 'idle' | 'parsing' | 'ready' | 'error'
export type EffectAssetLoadStatus = 'not_loaded' | 'loading' | 'loaded' | 'error'
export type EffectAssetPreviewType = 'image' | 'sequence' | 'video' | 'audio' | 'spine'

export interface ParsedFigmaAssetFile {
  name: string
  path: string
  url?: string | null
  width?: number | null
  height?: number | null
  type?: string | null
}

export interface UiAssetParseResult {
  fileKey: string
  nodeId: string
  panelName: string
  sourceUrl: string
  summary: string
  thumbnailUrl?: string | null
  parseMode: UiAssetParseMode
  outputDir?: string | null
  zipPath?: string | null
  uiSpecPath?: string | null
  manifestPath?: string | null
  assetsDir?: string | null
  html?: string | null
  interfaceBlueprint?: PrototypeInterfaceBlueprint | null
  assetCount: number
  zipFileCount?: number | null
  imageCount?: number | null
  files: ParsedFigmaAssetFile[]
}

export interface UiAssetRow {
  id: string
  name: string
  kind: UiAssetKind
  figmaUrl: string
  parseMode: UiAssetParseMode
  purpose: string
  usageNote: string
  linkedNodeIds: string[]
  status: AssetRowStatus
  error: string | null
  result: UiAssetParseResult | null
  createdAt: string
  updatedAt: string
}

export type EffectAssetKind =
  | 'spine'
  | 'particle'
  | 'sequence'
  | 'prefab'
  | 'audio'
  | 'texture'
  | 'scripted'
  | 'unknown'

export interface EffectAssetFile {
  name: string
  path: string
  ext: string
  size: number
  loadedPath?: string | null
  previewUrl?: string | null
}

export interface EffectAssetPreviewFile {
  name: string
  ext: string
  url: string
}

export interface EffectAssetRow {
  id: string
  name: string
  kind: EffectAssetKind
  sourceRoot: string
  relativePath: string
  localPath: string
  purpose: string
  usageNote: string
  pageHint: string
  implementationHint: string
  linkedNodeIds: string[]
  status: AssetRowStatus
  loadStatus: EffectAssetLoadStatus
  loadError: string | null
  loadedRoot: string | null
  loadedPath: string | null
  loadedFileCount: number
  loadedBytes: number
  loadedAt: string | null
  previewType: EffectAssetPreviewType | null
  previewUrl: string | null
  previewFiles: EffectAssetPreviewFile[]
  spine?: PrototypeSpineAsset | null
  fileCount: number
  files: EffectAssetFile[]
  createdAt: string
  updatedAt: string
}

export interface AssetWorkbenchState {
  uiRows: UiAssetRow[]
  effectRows: EffectAssetRow[]
  reusableLogicAssets: ReusableLogicAsset[]
  lastEffectScanRoot: string | null
}

export const emptyAssetWorkbench: AssetWorkbenchState = {
  uiRows: [],
  effectRows: [],
  reusableLogicAssets: [],
  lastEffectScanRoot: null,
}
