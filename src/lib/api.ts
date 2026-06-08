import type {
  ChatMessage,
  ChatResponse,
  ContentBlock,
  ProxyHealth,
  RagSearchResult,
  ReferenceImageClassificationRequest,
  ReferenceImageClassificationResponse,
} from '../types/chat'
import type { UXRequirementState } from '../types/uxRequirement'
import type { MapAdjustmentOperation, PrdImportPreview, PrdNode, PrdNodeOperationSuggestion, PrdPerformanceSpec } from '../types/prdNode'
import type { QaChatResponse, QaIssue } from '../types/qa'

async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })
  } catch (err) {
    if (err instanceof TypeError) {
      throw new Error(`无法连接本地代理服务（${baseUrl}）。请确认后端服务正在运行后重试。`)
    }
    throw err
  }

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`本地代理返回了非 JSON 响应：${text.slice(0, 120)}`)
    }
  }

  if (!response.ok) {
    const error = typeof data === 'object' && data && 'error' in data ? String(data.error) : `Request failed: ${response.status}`
    throw new Error(error)
  }

  return data as T
}

export function getProxyHealth(baseUrl: string) {
  return requestJson<ProxyHealth>(baseUrl, '/api/health')
}

export function sendChatMessage(baseUrl: string, messages: ChatMessage[], requirementState: UXRequirementState) {
  return requestJson<ChatResponse>(baseUrl, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, requirementState }),
  })
}

export function searchCocosRag(baseUrl: string, query: string) {
  return requestJson<RagSearchResult>(baseUrl, '/api/rag/search', {
    method: 'POST',
    body: JSON.stringify({ query }),
  })
}

export interface PrototypeVariantPayload {
  index: number
  html: string | null
  mode: 'create' | 'update' | 'rewrite'
  status: 'complete' | 'error'
  focus?: string
  appliedEdits: number
  history?: string[]
}

export interface PrototypeResponse {
  variants: PrototypeVariantPayload[]
}

export function generatePrototype(
  baseUrl: string,
  requirementState: UXRequirementState,
  options: {
    currentHtml?: string | null
    instruction?: string
    images?: ContentBlock[]
    numVariants?: number
    variantIndex?: number
    history?: string[]
    stream?: boolean
  } = {},
) {
  const imageBlocks = (options.images ?? []).filter((block) => block.type === 'image')
  return requestJson<PrototypeResponse>(baseUrl, '/api/prototype', {
    method: 'POST',
    body: JSON.stringify({
      requirementState,
      currentHtml: options.currentHtml ?? null,
      instruction: options.instruction ?? null,
      images: imageBlocks,
      numVariants: options.numVariants ?? null,
      variantIndex: options.variantIndex ?? null,
      history: options.history ?? null,
      stream: options.stream ?? null,
    }),
  })
}

export function exportFinalPrompt(baseUrl: string, requirementState: UXRequirementState, conversationSummary: string) {
  return requestJson<{ markdown: string }>(baseUrl, '/api/export-prompt', {
    method: 'POST',
    body: JSON.stringify({ requirementState, conversationSummary }),
  })
}

// ── Decomposition API ────────────────────────────────────────────────────────

export function previewDecomposition(baseUrl: string, mdText: string) {
  return requestJson<PrdImportPreview>(baseUrl, '/api/decompose/preview', {
    method: 'POST',
    body: JSON.stringify({ mdText }),
  })
}

export function startDecomposition(baseUrl: string, mdText: string) {
  return requestJson<{ sessionId: string }>(baseUrl, '/api/decompose/start', {
    method: 'POST',
    body: JSON.stringify({ mdText }),
  })
}

export interface DecompositionPollResult {
  status: 'running' | 'done' | 'error'
  currentStep: string
  nodeCount: number
  nodes: PrdNode[]
  error: string | null
}

export function pollDecomposition(baseUrl: string, sessionId: string) {
  return requestJson<DecompositionPollResult>(baseUrl, `/api/decompose/${sessionId}`)
}

// ── Node Chat API ─────────────────────────────────────────────────────────────

export type NodeChatIntent = 'document_polish' | 'prototype_update' | 'reference_feedback'

export interface NodeChatResponse {
  reply: string
  nodeComplete: boolean
  nodePatch?: {
    summary?: string | null
    content?: string | null
    techNotes?: string | null
    performanceSpec?: PrdPerformanceSpec | null
  } | null
  intents?: NodeChatIntent[]
  prototypeInstruction?: string | null
}

export function sendNodeChatMessage(
  baseUrl: string,
  nodeId: string,
  messages: ChatMessage[],
  tree: Record<string, PrdNode>
) {
  return requestJson<NodeChatResponse>(baseUrl, '/api/node-chat', {
    method: 'POST',
    body: JSON.stringify({ nodeId, messages, tree }),
  })
}

export function classifyReferenceImage(
  baseUrl: string,
  payload: ReferenceImageClassificationRequest,
) {
  return requestJson<ReferenceImageClassificationResponse>(baseUrl, '/api/reference-image-classification', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export interface FigmaFrameImportResponse {
  fileKey: string
  nodeId: string
  panelName: string
  taskId: string | null
  sourceUrl: string
  html: string
  summary: string
  uiSpecPath: string
  assetCount: number
  zipFileCount: number
}

export function importFigmaFrame(
  baseUrl: string,
  payload: { url: string },
) {
  return requestJson<FigmaFrameImportResponse>(baseUrl, '/api/figma/frame', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export interface MapAdjustmentResponse {
  reply: string
  operations: MapAdjustmentOperation[]
}

export function requestMapAdjustment(
  baseUrl: string,
  messages: ChatMessage[],
  tree: Record<string, PrdNode>
) {
  return requestJson<MapAdjustmentResponse>(baseUrl, '/api/map-adjust', {
    method: 'POST',
    body: JSON.stringify({ messages, tree }),
  })
}

export function sendQaChat(
  baseUrl: string,
  issue: QaIssue,
  messages: ChatMessage[],
  tree: Record<string, PrdNode>,
) {
  return requestJson<QaChatResponse>(baseUrl, '/api/qa/chat', {
    method: 'POST',
    body: JSON.stringify({ issue, messages, tree }),
  })
}

export interface NodeOperationSourceInput {
  name: string
  sourceKind: 'user' | 'upload'
  text: string
}

export interface NodeOperationSuggestionPayload {
  tree: Record<string, PrdNode>
  selectedNodeId: string
  supplementText?: string
  sources?: NodeOperationSourceInput[]
}

export interface NodeOperationSuggestionResponse {
  reply: string
  suggestions: PrdNodeOperationSuggestion[]
}

export function suggestPrdNodeOperations(
  baseUrl: string,
  payload: NodeOperationSuggestionPayload,
) {
  return requestJson<NodeOperationSuggestionResponse>(baseUrl, '/api/prd-node-suggestions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ── Export Spec API ──────────────────────────────────────────────────────────

export interface SpecFolderExportResponse {
  exportDir: string
  documents: Array<{ nodeId: string; docPath: string }>
}

export function exportSpecFolder(
  baseUrl: string,
  tree: Record<string, PrdNode>
) {
  return requestJson<SpecFolderExportResponse>(baseUrl, '/api/export-spec-folder', {
    method: 'POST',
    body: JSON.stringify({ tree }),
  })
}

export function openGeneratedDoc(baseUrl: string, docPath: string) {
  return requestJson<{ ok: true }>(baseUrl, '/api/open-doc', {
    method: 'POST',
    body: JSON.stringify({ docPath }),
  })
}

export async function exportNodeMarkdown(
  baseUrl: string,
  tree: Record<string, PrdNode>,
  nodeId: string,
) {
  const response = await fetch(`${baseUrl}/api/export-node`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tree, nodeId }),
  })
  if (!response.ok) {
    let message = `Request failed: ${response.status}`
    try {
      const data = await response.json() as { error?: string }
      if (data.error) message = data.error
    } catch {
      // Keep status message.
    }
    throw new Error(message)
  }
  return response.blob()
}
