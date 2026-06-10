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

export type PrdNodeSpecLens = 'full' | 'model' | 'control' | 'view'
export type PrdNodeSectionKey = 'data' | 'interaction' | 'view'

export type PrdNodeType = 'module' | 'feature' | 'ui' | 'page'
export type PrdNodeStatus = 'pending' | 'pending_refine' | 'done'
export type PrdNodeSourceKind = 'prd' | 'user' | 'upload'

export interface PrdNodeEvidenceRef {
  sourceKind: PrdNodeSourceKind
  sourceLabel: string
  quote?: string | null
}

export interface PrdNodeSection {
  title?: string | null
  summary?: string | null
  content?: string | null
  evidenceRefs?: PrdNodeEvidenceRef[]
  openQuestions?: string[]
}

export type PrdNodeSections = Partial<Record<PrdNodeSectionKey, PrdNodeSection>>

export interface PrdNodeReference {
  targetNodeId: string | null
  label: string
  reason?: string | null
  sourceNodeId?: string | null
}

export type PrdPerformanceSpecSource = 'auto' | 'ai' | 'user'
export type PrdPerformanceSlotKey =
  | 'trigger'
  | 'branches'
  | 'sequence'
  | 'integrationModes'
  | 'assets'
  | 'layers'
  | 'controls'
  | 'endState'
export type PrdPerformanceSlotStatusValue = 'missing' | 'inferred' | 'confirmed' | 'waived'

export interface PrdPerformanceSlotStatus {
  status: PrdPerformanceSlotStatusValue
  detail?: string | null
  question?: string | null
}

export type PrdPerformanceSlotStatusMap = Record<PrdPerformanceSlotKey, PrdPerformanceSlotStatus>

export interface PrdPerformanceBlockingQuestion {
  slot: PrdPerformanceSlotKey
  question: string
}

export interface PrdPerformanceReadiness {
  score: number
  level: 'ready' | 'risk' | 'blocked' | 'waived'
  confirmedSlots: PrdPerformanceSlotKey[]
  inferredSlots: PrdPerformanceSlotKey[]
  missingSlots: PrdPerformanceSlotKey[]
  waivedSlots: PrdPerformanceSlotKey[]
  riskSummary: string | null
}

export interface PrdPerformanceSequenceStep {
  id?: string | null
  title: string
  detail: string
  layer?: string | null
  assets?: string[]
  waitFor?: string | null
}

export interface PrdPerformanceSpec {
  detected: boolean
  disabled?: boolean
  source: PrdPerformanceSpecSource
  confidence: number
  eventTypes: string[]
  integrationModes?: string[]
  trigger: string | null
  branches: string[]
  sequence: PrdPerformanceSequenceStep[]
  assets: string[]
  layers: string[]
  controls: string[]
  endState: string | null
  openQuestions: string[]
  prototypeNotes: string[]
  slotStatus?: PrdPerformanceSlotStatusMap
  blockingQuestion?: PrdPerformanceBlockingQuestion | null
  readiness?: PrdPerformanceReadiness
  waivedReason?: string | null
  updatedAt?: string | null
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
  specLens?: PrdNodeSpecLens | null
  sections?: PrdNodeSections
  handoffGoal?: string | null
  qualityGate?: string | null
  sourceKind?: PrdNodeSourceKind
  evidenceRefs?: PrdNodeEvidenceRef[]
  performanceSpec?: PrdPerformanceSpec | null
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
  | 'specLens'
  | 'sections'
  | 'handoffGoal'
  | 'qualityGate'
  | 'techNotes'
  | 'sourceKind'
  | 'evidenceRefs'
  | 'performanceSpec'
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
  specLens?: PrdNodeSpecLens | null
  sections?: PrdNodeSections
  handoffGoal?: string | null
  qualityGate?: string | null
  references?: PrdNodeReference[]
  sourceKind?: PrdNodeSourceKind
  evidenceRefs?: PrdNodeEvidenceRef[]
  performanceSpec?: PrdPerformanceSpec | null
}

export type PrdTree = Record<string, PrdNode>

export type PrdNodeDocumentField = 'summary' | 'content' | 'techNotes'

export interface PrdNodeDocumentSnapshot {
  summary: string
  content: string
  techNotes: string | null
}

export interface PrdNodePolishRevision {
  id: string
  nodeId: string
  createdAt: string
  before: PrdNodeDocumentSnapshot
  after: PrdNodeDocumentSnapshot
  changedFields: PrdNodeDocumentField[]
  accepted: boolean
}

export type DecompositionStatus = 'idle' | 'decomposing' | 'done' | 'error'

export interface DecompositionStep {
  label: string
  status: 'pending' | 'active' | 'complete' | 'error'
}

export type DocumentSourceIssueSeverity = 'info' | 'warning' | 'critical'

export interface DocumentSourceIssue {
  id: string
  severity: DocumentSourceIssueSeverity
  title: string
  detail: string
  sectionId?: string | null
}

export interface DocumentSourceSection {
  id: string
  title: string
  titlePath: string
  level: number
  startLine: number
  endLine: number
  charCount: number
  estimatedTokens: number
  excerpt: string
  signals: string[]
}

export interface DocumentKeywordSignal {
  category: 'pages' | 'states' | 'rewards' | 'navigation' | 'apis' | 'configs'
  label: string
  matches: number
}

export interface DocumentSourceIndex {
  sourceLabel: string
  totalLines: number
  totalChars: number
  estimatedTokens: number
  headingCount: number
  sectionCount: number
  largestSectionChars: number
  sections: DocumentSourceSection[]
  keywordSignals: DocumentKeywordSignal[]
  issues: DocumentSourceIssue[]
}

export interface PrdImportCandidateNode {
  title: string
  sectionId: string
  sourceLabel: string
  reason: string
  confidence: number
  excerpt: string
}

export interface PrdImportPreview {
  sourceIndex: DocumentSourceIndex
  candidateNodes: PrdImportCandidateNode[]
}
