export type ReusableLogicAssetType =
  | 'interaction_state'
  | 'animation_rule'
  | 'feedback_pattern'
  | 'component_pattern'
  | 'copywriting_pattern'

export type ReusableLogicAssetStatus = 'candidate' | 'approved' | 'ignored'
export type ReusableLogicReuseMode = 'reference' | 'copy'

export interface ReusableLogicAssetSource {
  nodeId: string
  nodeLabel: string
  field: string
  excerpt?: string | null
}

export interface ReusableLogicAsset {
  id: string
  name: string
  type: ReusableLogicAssetType
  status: ReusableLogicAssetStatus
  reuseMode: ReusableLogicReuseMode
  description: string
  logic: string
  usageGuidance: string
  tags: string[]
  source: ReusableLogicAssetSource
  createdAt: string
  updatedAt: string
}
