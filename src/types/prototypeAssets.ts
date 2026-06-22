import type { ReusableLogicAsset } from './reusableLogic'

export type PrototypeAssetKind = 'interface_html' | 'interface_image' | 'ui_image' | 'effect_preview' | 'effect_spine'
export type PrototypeAssetManifestMode = 'audit' | 'strict'
export type PrototypeGenerationMode = 'draft_preview' | 'resource_standard'

export interface PrototypeInterfaceRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PrototypeInterfaceBlueprintNode {
  path: string
  name: string
  type: string
  rect: PrototypeInterfaceRect
  asset?: string | null
  text?: string | null
  visible?: boolean | null
}

export interface PrototypeInterfaceBlueprint {
  id: string
  name: string
  sourceRowId?: string | null
  sourceUrl?: string | null
  uiSpecPath?: string | null
  uiSpecUrl?: string | null
  manifestPath?: string | null
  manifestUrl?: string | null
  htmlAvailable?: boolean
  designSize?: { width?: number | null; height?: number | null } | null
  root?: PrototypeInterfaceBlueprintNode | null
  nodes: PrototypeInterfaceBlueprintNode[]
  assetNames: string[]
  assetCount?: number | null
  nodeCount?: number | null
}

export interface PrototypeSpineAsset {
  jsonUrl?: string | null
  binaryUrl?: string | null
  atlasUrl: string
  textureUrls: string[]
  animationNames: string[]
  skinNames: string[]
  defaultAnimation?: string | null
  skeletonVersion?: string | null
  premultipliedAlpha?: boolean | null
  playerJsUrl?: string | null
  playerCssUrl?: string | null
}

export interface PrototypeAllowedAsset {
  id: string
  kind: PrototypeAssetKind
  name: string
  url: string
  source: 'ui_asset' | 'effect_asset'
  purpose?: string | null
  usageNote?: string | null
  originalName?: string | null
  assetGroupName?: string | null
  spine?: PrototypeSpineAsset | null
}

export interface PrototypeAssetManifest {
  mode: PrototypeAssetManifestMode
  assets: PrototypeAllowedAsset[]
  notes: string[]
  interfaceBlueprints?: PrototypeInterfaceBlueprint[]
  reusableLogicAssets?: ReusableLogicAsset[]
}

export type PrototypeAssetAuditSeverity = 'warning' | 'error'

export type PrototypeAssetAuditIssueCode =
  | 'external_resource'
  | 'data_url'
  | 'local_path'
  | 'missing_effect_preview'
  | 'empty_manifest'
  | 'missing_interface_asset'

export interface PrototypeAssetAuditIssue {
  code: PrototypeAssetAuditIssueCode
  severity: PrototypeAssetAuditSeverity
  message: string
  value?: string
}
