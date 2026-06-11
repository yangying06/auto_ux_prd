import type { ChatMessage } from './chat'
import type { PrdNode, PrdNodeType } from './prdNode'

export type QaIssueStatus =
  | 'draft'
  | 'qa_confirmed'
  | 'dev_received'
  | 'dev_triaging'
  | 'fix_proposed'
  | 'fix_applied'
  | 'qa_verifying'
  | 'closed'
  | 'reopened'

export type QaIssueSeverity = 'blocker' | 'major' | 'minor' | 'trivial'
export type QaIssuePriority = 'high' | 'medium' | 'low'

export type QaNodeRefType = PrdNodeType | 'server' | 'test'

export interface QaNodeRef {
  nodeId: string
  nodeType: QaNodeRefType
  title: string
  summary: string
  content: string
  docPath: string | null
  capturedAt: string
  snapshot: Pick<PrdNode, 'id' | 'label' | 'summary' | 'content' | 'type' | 'status' | 'techNotes' | 'docPath' | 'audience' | 'specLens' | 'sections' | 'handoffGoal' | 'qualityGate' | 'backendContracts' | 'evidenceRefs' | 'performanceSpec'>
}

export interface QaAttachment {
  id: string
  type: 'image' | 'text' | 'file'
  name: string
  mediaType?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  dataUrl?: string
  text?: string
  createdAt: string
}

export interface QaIssuePatch {
  title?: string
  severity?: QaIssueSeverity
  priority?: QaIssuePriority
  description?: string
  stepsToReproduce?: string[]
  expectedResult?: string
  actualResult?: string
  environment?: string | null
  aiSummary?: string
  aiQuestions?: string[]
  aiConfidence?: number
  suspectedCause?: string | null
  devSuggestion?: string | null
  readyToConfirm?: boolean
}

export interface QaIssue {
  id: string
  title: string
  status: QaIssueStatus
  severity: QaIssueSeverity
  priority: QaIssuePriority
  nodeRefs: QaNodeRef[]
  attachments: QaAttachment[]
  messages: ChatMessage[]
  description: string
  stepsToReproduce: string[]
  expectedResult: string
  actualResult: string
  environment: string | null
  aiSummary: string
  aiQuestions: string[]
  aiConfidence: number
  suspectedCause: string | null
  devSuggestion: string | null
  readyToConfirm: boolean
  createdAt: string
  updatedAt: string
  qaConfirmedAt: string | null
  devReceivedAt: string | null
  closedAt: string | null
}

export interface QaChatRequest {
  issue: QaIssue
  messages: ChatMessage[]
  tree: Record<string, PrdNode>
}

export interface QaChatResponse {
  reply: string
  issuePatch: QaIssuePatch
  readyToConfirm: boolean
}
