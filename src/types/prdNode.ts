export type PrdNodeAudience =
  | 'overview'
  | 'client'
  | 'server'
  | 'config'
  | 'api'
  | 'acceptance'
  | 'appendix'
  | 'mixed'
  | 'model'
  | 'ctrl'
  | 'view'

export type PrdNodeType = 'module' | 'feature' | 'ui' | 'page'
export type PrdNodeStatus = 'pending' | 'pending_refine' | 'done'
export type PrdNodeSourceKind = 'prd' | 'user' | 'upload'

export interface PrdNodeEvidenceRef {
  sourceKind: PrdNodeSourceKind
  sourceLabel: string
  quote?: string | null
}

export interface PrdNodeReference {
  targetNodeId: string | null
  label: string
  reason?: string | null
  sourceNodeId?: string | null
}

export interface CreatePageNodeInput {
  title: string
  parentId?: string | null
  summary?: string | null
  content?: string | null
}

export interface UpdateNodePatch {
  label?: string
  summary?: string
  content?: string
  docPath?: string | null
  references?: PrdNodeReference[]
  techNotes?: string | null
  status?: PrdNodeStatus
  type?: PrdNodeType
  audience?: PrdNodeAudience | null
  handoffGoal?: string | null
  qualityGate?: string | null
  sourceKind?: PrdNodeSourceKind
  evidenceRefs?: PrdNodeEvidenceRef[]
}

export type PrdNodeOperationPatch = Partial<Pick<
  PrdNode,
  | 'label'
  | 'summary'
  | 'content'
  | 'type'
  | 'needsPolish'
  | 'docPath'
  | 'audience'
  | 'handoffGoal'
  | 'qualityGate'
  | 'techNotes'
  | 'sourceKind'
  | 'evidenceRefs'
>>

export interface PrdNodeOperationSuggestion {
  id: string
  operation: 'create' | 'update'
  targetNodeId?: string | null
  parentId?: string | null
  patch: PrdNodeOperationPatch
  rationale: string
  confidence: number
  evidenceRefs: PrdNodeEvidenceRef[]
  status?: 'pending' | 'applied' | 'dismissed'
}

export type MapAdjustmentOperation =
  | {
      type: 'create_node'
      title: string
      parentId?: string | null
      summary?: string | null
      content?: string | null
    }
  | {
      type: 'delete_node'
      nodeId: string
    }
  | {
      type: 'update_node'
      nodeId: string
      patch: UpdateNodePatch
    }
  | {
      type: 'move_content'
      fromNodeId: string
      toNodeId: string
      content: string
    }
  | {
      type: 'add_reference'
      sourceNodeId: string
      targetNodeId: string
      label: string
      reason?: string | null
    }

export interface PrdNode {
  id: string
  parentId: string | null
  label: string
  summary: string
  content: string
  type: PrdNodeType
  status: PrdNodeStatus
  level: number
  order: number
  needsPolish: boolean
  extractedFrom: string | null
  techNotes: string | null
  children: string[]
  docPath?: string | null
  audience?: PrdNodeAudience | null
  handoffGoal?: string | null
  qualityGate?: string | null
  references?: PrdNodeReference[]
  sourceKind?: PrdNodeSourceKind
  evidenceRefs?: PrdNodeEvidenceRef[]
}

export type PrdTree = Record<string, PrdNode>

export type DecompositionStatus = 'idle' | 'decomposing' | 'done' | 'error'

export interface DecompositionStep {
  label: string
  status: 'pending' | 'active' | 'complete' | 'error'
}
