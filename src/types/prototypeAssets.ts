export type PrototypeAssetKind = 'interface_html' | 'ui_image' | 'effect_preview'

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
}

export interface PrototypeAssetManifest {
  mode: 'audit'
  assets: PrototypeAllowedAsset[]
  notes: string[]
}

export type PrototypeAssetAuditSeverity = 'warning' | 'error'

export type PrototypeAssetAuditIssueCode =
  | 'external_resource'
  | 'data_url'
  | 'local_path'
  | 'missing_effect_preview'
  | 'empty_manifest'

export interface PrototypeAssetAuditIssue {
  code: PrototypeAssetAuditIssueCode
  severity: PrototypeAssetAuditSeverity
  message: string
  value?: string
}
