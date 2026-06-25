export type ProjectWorkflowMode = 'new_project' | 'existing_project_iteration'

export type SupportedProjectPlatform =
  | 'android'
  | 'ios'
  | 'h5'
  | 'cocos'
  | 'unity'
  | 'unknown'

export type ProjectCodeEvidenceKind =
  | 'screen'
  | 'component'
  | 'navigation'
  | 'asset'
  | 'text'
  | 'logic'
  | 'config'
  | 'unknown'

export interface ProjectPlatformCandidate {
  platform: SupportedProjectPlatform
  confidence: number
  signals: string[]
  strategy: string
}

export interface ProjectCodebaseEvidence {
  id: string
  title: string
  relativePath: string
  kind: ProjectCodeEvidenceKind
  platform: SupportedProjectPlatform
  reason: string
  matchedTerms: string[]
  confidence: number
  lineStart?: number | null
  snippet?: string | null
}

export interface ProjectBaselineScanPolicy {
  maxFiles: number
  maxBytesPerFile: number
  maxEvidence: number
  fullProjectRead: false
}

export interface ProjectBaselineScan {
  rootPath: string
  scannedAt: string
  queryTerms: string[]
  platforms: ProjectPlatformCandidate[]
  evidence: ProjectCodebaseEvidence[]
  warnings: string[]
  summary: string
  policy: ProjectBaselineScanPolicy
}

export interface ProjectIterationContext {
  codebasePath: string
  focus: string
  baselineScan: ProjectBaselineScan | null
  platformStrategyNotes: string[]
  acceptanceFocus: string[]
}

export interface ProjectWorkflowState {
  mode: ProjectWorkflowMode
  iteration: ProjectIterationContext | null
}

export const defaultProjectWorkflow: ProjectWorkflowState = {
  mode: 'new_project',
  iteration: null,
}
