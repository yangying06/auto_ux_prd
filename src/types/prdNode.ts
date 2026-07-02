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

export interface PrdNodeFigmaPreview {
  nodeId: string
  name: string
  sourceUrl: string
  imageUrl: string | null
  width: number
  height: number
  originNodeId?: string | null
  originNodeLabel?: string | null
  isPrimary?: boolean
  userAdded?: boolean
  userNote?: string | null
}

export type PrdUiStateKind =
  | 'default'
  | 'overlay'
  | 'loading'
  | 'success'
  | 'error'
  | 'empty'
  | 'disabled'
  | 'expanded'
  | 'collapsed'
  | 'localized'
  | 'mirror'
  | 'selected'
  | 'variant'

export interface PrdUiState {
  id: string
  label: string
  kind: PrdUiStateKind
  figmaNodeId: string
  sourceUrl?: string | null
  previewImageUrl?: string | null
  visibleTexts: string[]
  annotations: string[]
  confidence: number
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

export interface PrdStateTransition {
  id: string
  sourceNodeId: string
  sourceStateId?: string | null
  targetNodeId: string
  targetStateId?: string | null
  trigger?: string | null
  condition?: string | null
  effect?: string | null
  evidence: string[]
  confidence: number
  source?: FigmaUxMapTransitionSource | null
}

export type FigmaUxMapReviewSource = 'heuristic' | 'ai_review' | 'ai_review_fallback'
export type FigmaUxMapStateRole = 'base' | 'variant' | 'overlay' | 'feedback' | 'localized'
export type FigmaUxMapTransitionSource =
  | 'figma_connector'
  | 'figma_prototype'
  | 'frame_title'
  | 'annotation'
  | 'prd_text'
  | 'canvas_order'
  | 'text_entry'
  | 'ai_review'
export type FigmaUxMapAmbiguityKind =
  | 'screen_grouping'
  | 'state_role'
  | 'transition_target'
  | 'missing_trigger'
  | 'prd_conflict'
  | 'low_confidence'

export interface FigmaUxMapState {
  id: string
  screenId: string
  label: string
  role: FigmaUxMapStateRole
  kind: PrdUiStateKind
  figmaNodeId: string
  sourceUrl?: string | null
  previewImageUrl?: string | null
  visibleTexts: string[]
  annotations: string[]
  triggerHints: string[]
  confidence: number
}

export interface FigmaUxMapScreen {
  id: string
  groupKey: string
  label: string
  sourceFrameIds: string[]
  primaryFigmaNodeId?: string | null
  stateIds: string[]
  evidence: string[]
  confidence: number
}

export interface FigmaUxMapTransition {
  id: string
  sourceScreenId: string
  sourceStateId?: string | null
  targetScreenId: string
  targetStateId?: string | null
  trigger?: string | null
  condition?: string | null
  effect?: string | null
  evidence: string[]
  confidence: number
  source: FigmaUxMapTransitionSource
}

export interface FigmaUxMapAmbiguity {
  id: string
  kind: FigmaUxMapAmbiguityKind
  message: string
  screenId?: string | null
  stateId?: string | null
  transitionId?: string | null
  evidence: string[]
  severity: 'info' | 'warning' | 'critical'
}

export interface FigmaUxMap {
  version: 'figma-ux-map.v1'
  review: {
    source: FigmaUxMapReviewSource
    confidence: number
    notes: string[]
  }
  screens: FigmaUxMapScreen[]
  states: FigmaUxMapState[]
  transitions: FigmaUxMapTransition[]
  ambiguities: FigmaUxMapAmbiguity[]
}

export type ProjectUiFlowEvidenceKind = 'figma' | 'prd' | 'ai' | 'heuristic'
export type ProjectUiFlowEdgeSource = FigmaUxMapTransitionSource | 'prd_relation' | 'alignment' | 'visual_order' | 'mixed'
export type ProjectUiFlowAmbiguityKind =
  | 'missing_entry'
  | 'missing_exit'
  | 'disconnected_node'
  | 'cycle_without_exit'
  | 'low_confidence_edge'
  | 'conflicting_direction'

export interface ProjectUiFlowEvidenceRef {
  kind: ProjectUiFlowEvidenceKind
  label: string
  quote?: string | null
}

export interface ProjectUiFlowNode {
  id: string
  screenId?: string | null
  stateId?: string | null
  groupKey?: string | null
  label: string
  role: 'screen' | 'state'
  order: number
  figmaNodeIds: string[]
  evidenceRefs: ProjectUiFlowEvidenceRef[]
  confidence: number
}

export interface ProjectUiFlowEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  trigger?: string | null
  condition?: string | null
  effect?: string | null
  source: ProjectUiFlowEdgeSource
  confidence: number
  evidenceRefs: ProjectUiFlowEvidenceRef[]
}

export interface ProjectUiFlowPath {
  id: string
  label: string
  nodeIds: string[]
  edgeIds: string[]
  confidence: number
}

export interface ProjectUiFlowAmbiguity {
  id: string
  kind: ProjectUiFlowAmbiguityKind
  message: string
  nodeId?: string | null
  edgeId?: string | null
  evidenceRefs: ProjectUiFlowEvidenceRef[]
  severity: 'info' | 'warning' | 'critical'
}

export interface ProjectUiFlow {
  version: 'project-ui-flow.v1'
  summary: string
  confidence: number
  nodes: ProjectUiFlowNode[]
  edges: ProjectUiFlowEdge[]
  entryNodeIds: string[]
  exitNodeIds: string[]
  happyPathNodeIds: string[]
  alternatePaths: ProjectUiFlowPath[]
  ambiguities: ProjectUiFlowAmbiguity[]
}

export interface PrdNodeFigmaUxMapSlice {
  screenId: string
  screenLabel: string
  sourceFrameIds: string[]
  stateIds: string[]
  transitionIds: string[]
  ambiguityIds: string[]
  reviewSource: FigmaUxMapReviewSource
  reviewConfidence: number
  notes: string[]
}

export type PrdNodeBackendContractKind = 'api' | 'config' | 'server' | 'data'

export interface PrdNodeBackendContractRef {
  id?: string | null
  title: string
  kind: PrdNodeBackendContractKind
  summary?: string | null
  fields?: string[]
  targetNodeId?: string | null
  evidenceRefs?: PrdNodeEvidenceRef[]
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
  backendContracts?: PrdNodeBackendContractRef[]
  sourceKind?: PrdNodeSourceKind
  evidenceRefs?: PrdNodeEvidenceRef[]
  performanceSpec?: PrdPerformanceSpec | null
  figmaPreviews?: PrdNodeFigmaPreview[]
  uiStates?: PrdUiState[]
  stateTransitions?: PrdStateTransition[]
  figmaUxMap?: PrdNodeFigmaUxMapSlice | null
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
  | 'backendContracts'
  | 'techNotes'
  | 'sourceKind'
  | 'evidenceRefs'
  | 'performanceSpec'
  | 'uiStates'
  | 'stateTransitions'
  | 'figmaUxMap'
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
  backendContracts?: PrdNodeBackendContractRef[]
  references?: PrdNodeReference[]
  sourceKind?: PrdNodeSourceKind
  evidenceRefs?: PrdNodeEvidenceRef[]
  performanceSpec?: PrdPerformanceSpec | null
  figmaPreviews?: PrdNodeFigmaPreview[]
  uiStates?: PrdUiState[]
  stateTransitions?: PrdStateTransition[]
  figmaUxMap?: PrdNodeFigmaUxMapSlice | null
}

export type PrdTree = Record<string, PrdNode>

export type PrdNodeDocumentField =
  | 'summary'
  | 'content'
  | 'techNotes'
  | 'sections'
  | 'handoffGoal'
  | 'qualityGate'
  | 'backendContracts'
  | 'evidenceRefs'
  | 'performanceSpec'

export interface PrdNodeDocumentSnapshot {
  summary: string
  content: string
  techNotes: string | null
  sections?: PrdNodeSections
  handoffGoal?: string | null
  qualityGate?: string | null
  backendContracts?: PrdNodeBackendContractRef[]
  evidenceRefs?: PrdNodeEvidenceRef[]
  performanceSpec?: PrdPerformanceSpec | null
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

export interface PrdImportPrdSourceSummary {
  totalChars: number
  headingCount: number
  sectionCount: number
  matchedFigmaGroups: number
  excerpts: Array<{
    titlePath: string
    excerpt: string
    startLine: number
    endLine: number
  }>
}

export interface PrdImportRelationPreview {
  sourceLabel: string
  targetLabel: string
  label: string
  reason: string
  confidence: number
}

export interface PrdImportRelationSummary {
  figmaTransitionCount: number
  prdRelationCount: number
  prdRelations: PrdImportRelationPreview[]
}

export interface PrdImportPreview {
  sourceIndex: DocumentSourceIndex
  candidateNodes: PrdImportCandidateNode[]
  figmaUxMap?: FigmaUxMap | null
  projectUiFlow?: ProjectUiFlow | null
  prdSource?: PrdImportPrdSourceSummary | null
  relationSummary?: PrdImportRelationSummary | null
}
