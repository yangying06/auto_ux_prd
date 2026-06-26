import type { AppSettings, ChatMessage, RagSearchResult } from './chat'
import type { MapAdjustmentOperation, PrdNodeOperationSuggestion, PrdNodePolishRevision, PrdTree } from './prdNode'
import type { PrototypeVariant } from './prototypeVariant'
import type { QaIssue } from './qa'
import type { UXRequirementState } from './uxRequirement'
import type { AssetWorkbenchState } from './assetWorkbench'
import type { PrototypeSpec } from './prototypeSpec'
import type { ProjectWorkflowState } from './projectWorkflow'

export const PROJECT_ARCHIVE_SCHEMA_VERSION = 1
export const PROJECT_ARCHIVE_EXTENSION = 'gpf'
export const PROJECT_ARCHIVE_MIME = 'application/vnd.gameux.promptforge+zip'

export interface ProjectSourceDocument {
  filename: string
  text: string
  importedAt: string
}

export interface ArchivedPrototypeVersion {
  id: string
  label: string
  html: string
  createdAt: string
  mode: 'create' | 'update' | 'restore'
  note: string | null
  prototypeSpec?: PrototypeSpec | null
}

export interface ArchivedNodePrototypeState {
  prototypeHtml: string | null
  prototypeHistory: ArchivedPrototypeVersion[]
  prototypeVariants: PrototypeVariant[]
  selectedVariantIndex: number
  draftPrototypeSpec?: PrototypeSpec | null
  standardPrototypeSpec?: PrototypeSpec | null
}

export interface ProjectWorkspaceSnapshot {
  requirement: UXRequirementState
  messages: ChatMessage[]
  latestRag: RagSearchResult | null
  prototypeHtml: string | null
  prototypeHistory: ArchivedPrototypeVersion[]
  prototypeVariants: PrototypeVariant[]
  selectedVariantIndex: number
  draftPrototypeSpec?: PrototypeSpec | null
  standardPrototypeSpec?: PrototypeSpec | null
  nodePrototypeStates: Record<string, ArchivedNodePrototypeState>
  settings: AppSettings
  prdTree: PrdTree | null
  selectedNodeId: string | null
  canvasNodePositions?: Record<string, { x: number; y: number }>
  nodeChats: Record<string, ChatMessage[]>
  nodePolishRevisions?: Record<string, PrdNodePolishRevision>
  nodeOperationSuggestions: Record<string, PrdNodeOperationSuggestion[]>
  qaIssues?: Record<string, QaIssue>
  mapAdjustmentMessages?: ChatMessage[]
  pendingMapAdjustmentOperations?: MapAdjustmentOperation[]
  assetWorkbench?: AssetWorkbenchState
  sourceDocument: ProjectSourceDocument | null
  projectWorkflow?: ProjectWorkflowState
}

export interface ProjectArchiveManifest {
  schemaVersion: typeof PROJECT_ARCHIVE_SCHEMA_VERSION
  app: 'GameUX PromptForge'
  projectName: string
  createdAt: string
  savedAt: string
  sourceFilename: string | null
}

export interface ProjectArchiveFile {
  manifest: ProjectArchiveManifest
  workspace: ProjectWorkspaceSnapshot
}

export interface ProjectArchiveOpenResult extends ProjectArchiveFile {
  path: string | null
}

export interface ProjectArchiveSaveResult {
  status: 'saved' | 'cancelled'
  path: string | null
}
