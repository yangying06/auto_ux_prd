import type {
  ChatMessage,
  ChatResponse,
  ContentBlock,
  ImageBlock,
  AiEnvironmentConfig,
  AiEnvironmentUpdate,
  ProxyHealth,
  ProjectKnowledgeSearchResult,
  ReferenceImageClassificationRequest,
  ReferenceImageClassificationResponse,
} from '../types/chat'
import type { UXRequirementState } from '../types/uxRequirement'
import type { MapAdjustmentOperation, PrdImportPreview, PrdNode, PrdNodeBackendContractRef, PrdNodeEvidenceRef, PrdNodeOperationSuggestion, PrdPerformanceSpec } from '../types/prdNode'
import type { QaChatResponse, QaIssue } from '../types/qa'
import type { AssetWorkbenchState, AudioAssetRow, EffectAssetRow, UiAssetKind, UiAssetParseResult } from '../types/assetWorkbench'
import type { PrototypeAssetAuditIssue, PrototypeAssetManifest } from '../types/prototypeAssets'
import type { ProjectSourceDocument } from '../types/archive'
import type { ProjectBaselineScan, ProjectWorkflowState } from '../types/projectWorkflow'

function apiErrorMessage(data: unknown, status: number) {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    if (typeof record.error === 'string' && record.error.trim()) return record.error
    if (record.error && typeof record.error === 'object') {
      const nested = record.error as Record<string, unknown>
      if (typeof nested.message === 'string' && nested.message.trim()) return nested.message
      if (typeof nested.error === 'string' && nested.error.trim()) return nested.error
    }
    if (typeof record.message === 'string' && record.message.trim()) return record.message
  }
  return `Request failed: ${status}`
}

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
      throw new Error(`无法连接本地代理服务（${baseUrl}）。请确认已运行 npm run dev（同时启动前后端），或单独运行 npm run dev:server 后重试。`)
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
    throw new Error(apiErrorMessage(data, response.status))
  }

  return data as T
}

function compactContentForKnowledge(content: ChatMessage['content']) {
  if (typeof content === 'string') return content
  return content
    .map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'document') return `[附件: ${block.title}]\n${block.context ?? ''}\n${block.source.data}`
      return `[图片: ${block.source.media_type}]`
    })
    .filter(Boolean)
    .join('\n')
}

function compactMessagesForKnowledge(messages: ChatMessage[]) {
  return messages.slice(-16).map((message) => ({
    role: message.role,
    content: compactContentForKnowledge(message.content),
  }))
}

export function getProxyHealth(baseUrl: string) {
  return requestJson<ProxyHealth>(baseUrl, '/api/health')
}

export function getAiEnvironmentConfig(baseUrl: string) {
  return requestJson<AiEnvironmentConfig>(baseUrl, '/api/environment')
}

export function saveAiEnvironmentConfig(baseUrl: string, payload: AiEnvironmentUpdate) {
  return requestJson<AiEnvironmentConfig>(baseUrl, '/api/environment', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function sendChatMessage(baseUrl: string, messages: ChatMessage[], requirementState: UXRequirementState) {
  return requestJson<ChatResponse>(baseUrl, '/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages, requirementState }),
  })
}

export function searchProjectKnowledge(
  baseUrl: string,
  query: string,
  tree?: Record<string, PrdNode> | null,
  sourceDocument?: ProjectSourceDocument | null,
  nodeId?: string | null,
  messages?: ChatMessage[],
) {
  return requestJson<ProjectKnowledgeSearchResult>(baseUrl, '/api/project-knowledge/search', {
    method: 'POST',
    body: JSON.stringify({
      query,
      tree: tree ?? {},
      sourceDocument: sourceDocument ?? null,
      nodeId: nodeId ?? null,
      messages: compactMessagesForKnowledge(messages ?? []),
    }),
  })
}

export function scanProjectBaseline(
  baseUrl: string,
  payload: {
    rootPath: string
    iterationPrd: string
    focus?: string
  },
) {
  return requestJson<ProjectBaselineScan>(baseUrl, '/api/project-baseline/scan', {
    method: 'POST',
    body: JSON.stringify(payload),
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
  error?: string
  assetAudit?: PrototypeAssetAuditIssue[]
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
    assetManifest?: PrototypeAssetManifest
    signal?: AbortSignal
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
      assetManifest: options.assetManifest ?? null,
    }),
    signal: options.signal,
  })
}

export function exportFinalPrompt(baseUrl: string, requirementState: UXRequirementState, conversationSummary: string) {
  return requestJson<{ markdown: string }>(baseUrl, '/api/export-prompt', {
    method: 'POST',
    body: JSON.stringify({ requirementState, conversationSummary }),
  })
}

// ── Decomposition API ────────────────────────────────────────────────────────

export function previewDecomposition(baseUrl: string, mdText: string, projectWorkflow?: ProjectWorkflowState) {
  return requestJson<PrdImportPreview>(baseUrl, '/api/decompose/preview', {
    method: 'POST',
    body: JSON.stringify({ mdText, projectWorkflow }),
  })
}

export function startDecomposition(baseUrl: string, mdText: string, projectWorkflow?: ProjectWorkflowState) {
  return requestJson<{ sessionId: string }>(baseUrl, '/api/decompose/start', {
    method: 'POST',
    body: JSON.stringify({ mdText, projectWorkflow }),
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

export interface NodeChatOptions {
  performancePolishMode?: boolean
  sourceDocument?: ProjectSourceDocument | null
  contextMessages?: ChatMessage[]
}

export interface NodeChatResponse {
  reply: string
  nodeComplete: boolean
  nodePatch?: {
    summary?: string | null
    content?: string | null
    techNotes?: string | null
    sections?: PrdNode['sections']
    handoffGoal?: string | null
    qualityGate?: string | null
    backendContracts?: PrdNodeBackendContractRef[]
    evidenceRefs?: PrdNodeEvidenceRef[]
    performanceSpec?: PrdPerformanceSpec | null
  } | null
  intents?: NodeChatIntent[]
  prototypeInstruction?: string | null
}

export function sendNodeChatMessage(
  baseUrl: string,
  nodeId: string,
  currentMessage: ChatMessage,
  tree: Record<string, PrdNode>,
  options: NodeChatOptions = {},
) {
  return requestJson<NodeChatResponse>(baseUrl, '/api/node-chat', {
    method: 'POST',
    body: JSON.stringify({
      nodeId,
      currentMessage,
      tree,
      sourceDocument: options.sourceDocument ?? null,
      messages: compactMessagesForKnowledge(options.contextMessages ?? []),
      performancePolishMode: options.performancePolishMode === true,
    }),
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
  sourceUrl: string
  summary: string
  imageCount: number
  images: Array<{
    nodeId: string
    name: string
    type: string
    width: number
    height: number
    depth: number
    mediaType: ImageBlock['source']['media_type']
    data: string
    assetPath: string
    assetUrl: string
    numericTextSlots: Array<{
      slotId: string
      nodeId: string
      name: string
      x: number
      y: number
      width: number
      height: number
      centerX: number
      centerY: number
    }>
  }>
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

export function parseUiFigmaAsset(
  baseUrl: string,
  payload: {
    url: string
    kind: UiAssetKind
  },
) {
  return requestJson<UiAssetParseResult>(baseUrl, '/api/assets/ui/figma', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export interface EffectAssetScanResponse {
  sourceRoot: string
  scannedFileCount: number
  truncated: boolean
  rows: EffectAssetRow[]
}

export interface EffectAssetScanOptions {
  smartNotes?: boolean
  contextHints?: string[]
}

export function scanEffectAssetDirectory(baseUrl: string, rootPath: string, options: EffectAssetScanOptions = {}) {
  return requestJson<EffectAssetScanResponse>(baseUrl, '/api/assets/effects/scan', {
    method: 'POST',
    body: JSON.stringify({
      rootPath,
      smartNotes: options.smartNotes ?? false,
      contextHints: options.contextHints ?? [],
    }),
  })
}

export interface EffectAssetLoadResponse {
  row: EffectAssetRow
}

export function loadEffectAssetRow(baseUrl: string, row: EffectAssetRow) {
  return requestJson<EffectAssetLoadResponse>(baseUrl, '/api/assets/effects/load', {
    method: 'POST',
    body: JSON.stringify({ row }),
  })
}

export interface AudioAssetScanResponse {
  sourceRoot: string
  scannedFileCount: number
  truncated: boolean
  rows: AudioAssetRow[]
}

export interface AudioAssetScanOptions {
  smartNotes?: boolean
  contextHints?: string[]
}

export function scanAudioAssetDirectory(baseUrl: string, rootPath: string, options: AudioAssetScanOptions = {}) {
  return requestJson<AudioAssetScanResponse>(baseUrl, '/api/assets/audio/scan', {
    method: 'POST',
    body: JSON.stringify({
      rootPath,
      smartNotes: options.smartNotes ?? false,
      contextHints: options.contextHints ?? [],
    }),
  })
}

export interface AudioAssetLoadResponse {
  row: AudioAssetRow
}

export function loadAudioAssetRow(baseUrl: string, row: AudioAssetRow) {
  return requestJson<AudioAssetLoadResponse>(baseUrl, '/api/assets/audio/load', {
    method: 'POST',
    body: JSON.stringify({ row }),
  })
}

export interface OpenAssetLocalPathResponse {
  ok: true
  path: string
}

export function openAssetLibraryLocalPath(baseUrl: string) {
  return requestJson<OpenAssetLocalPathResponse>(baseUrl, '/api/assets/open-local-path', {
    method: 'POST',
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
  assets?: {
    exportDir: string
    manifestPath: string
    copiedFiles: number
    copiedBytes: number
    skippedItems: number
  } | null
}

export function exportSpecFolder(
  baseUrl: string,
  tree: Record<string, PrdNode>,
  options: { includeAssets?: boolean; assetWorkbench?: AssetWorkbenchState | null } = {},
) {
  return requestJson<SpecFolderExportResponse>(baseUrl, '/api/export-spec-folder', {
    method: 'POST',
    body: JSON.stringify({
      tree,
      includeAssets: options.includeAssets === true,
      assetWorkbench: options.includeAssets ? options.assetWorkbench ?? null : undefined,
    }),
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
      message = apiErrorMessage(await response.json(), response.status)
    } catch {
      // Keep status message.
    }
    throw new Error(message)
  }
  return response.blob()
}
