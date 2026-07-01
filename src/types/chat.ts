import type { UXRequirementState } from './uxRequirement'

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  source: {
    type: 'base64'
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    data: string
  }
}

export interface DocumentBlock {
  type: 'document'
  title: string
  context?: string
  source: {
    type: 'text'
    media_type: 'text/plain'
    data: string
  }
}

export type ContentBlock = TextBlock | ImageBlock | DocumentBlock

export interface SourceImageInput {
  name: string
  mediaType: ImageBlock['source']['media_type']
  data: string
  sourceUrl?: string | null
  token?: string | null
  size?: number
}

export type ReferenceImageRole =
  | 'layout_reference'
  | 'asset_reuse'
  | 'state_screenshot'
  | 'negative_reference'

export interface ReferenceImageClassificationRequest {
  name: string
  mediaType: ImageBlock['source']['media_type']
  data: string
}

export interface ReferenceImageClassificationResponse {
  role: ReferenceImageRole
  reason: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ProjectKnowledgeReference {
  title: string
  source: string
}

export interface ProjectKnowledgeSearchResult {
  status: 'connected' | 'error'
  answer: string
  references: ProjectKnowledgeReference[]
  indexedDocuments?: number
  hits?: Array<{
    id: string
    type: string
    title: string
    source: string
    text: string
    score: number
    nodeId?: string | null
  }>
}

export type RagReference = ProjectKnowledgeReference
export type RagSearchResult = ProjectKnowledgeSearchResult

export interface ProxyHealth {
  ok: boolean
  claude: {
    provider: string
    model: string
    apiKeyPresent: boolean
  }
  projectKnowledge: {
    mode: string
    status: string
    description: string
  }
}

export interface AiEnvironmentConfig {
  aiConfigured: boolean
  envPath: string
  values: {
    ANTHROPIC_API_KEY_PRESENT: boolean
    ANTHROPIC_BASE_URL: string
    CLAUDE_MODEL: string
    MOCK_DECOMPOSE: boolean
    FIGMA_TOKEN_PRESENT: boolean
    LARK_CLI_BIN: string
    LARK_IDENTITY: string
    LARK_APP_ID_PRESENT: boolean
    LARK_APP_SECRET_PRESENT: boolean
    LARK_TENANT_ACCESS_TOKEN_PRESENT: boolean
    LARK_USER_ACCESS_TOKEN_PRESENT: boolean
  }
}

export interface AiEnvironmentUpdate {
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_BASE_URL: string
  CLAUDE_MODEL: string
  MOCK_DECOMPOSE: boolean
  FIGMA_TOKEN?: string
  LARK_CLI_BIN: string
  LARK_IDENTITY: string
  LARK_APP_ID?: string
  LARK_APP_SECRET?: string
  LARK_TENANT_ACCESS_TOKEN?: string
  LARK_USER_ACCESS_TOKEN?: string
}

export interface AppSettings {
  projectName: string
  proxyBaseUrl: string
  defaultRagQuery: string
}

export interface ChatResponse {
  reply: string
  statePatch: Partial<UXRequirementState>
  rag?: RagSearchResult
  usage?: unknown
}
