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

export interface RagReference {
  title: string
  source: string
}

export interface RagSearchResult {
  status: 'mock' | 'connected' | 'error'
  answer: string
  references: RagReference[]
}

export interface ProxyHealth {
  ok: boolean
  claude: {
    provider: string
    model: string
    apiKeyPresent: boolean
  }
  cocosRag: {
    mode: string
    sseUrl: string
    proxyScript: string
    status: string
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
  }
}

export interface AiEnvironmentUpdate {
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_BASE_URL: string
  CLAUDE_MODEL: string
  MOCK_DECOMPOSE: boolean
  FIGMA_TOKEN?: string
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
