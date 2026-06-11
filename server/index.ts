import Anthropic from '@anthropic-ai/sdk'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { strFromU8, unzipSync, zipSync } from 'fflate'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { applyPerformanceAnswerFast, formatPerformanceSpecForPrompt, formatPerformanceSpecMarkdown, normalizePerformanceSpec, resolveNodePerformanceSpec } from '../src/lib/performanceOrchestration'
import { defaultAudienceForSpecLens, formatSectionTitle, formatSpecLens, hasNodeSections, normalizeLegacyAudience, normalizeNodeLensFields, normalizeSectionKeyForLens, normalizeSpecLensValue, resolveNodeAudience, resolveNodeSpecLens, specLensFromLegacyAudience } from '../src/lib/prdNodeLens'
import { buildDeliverySections, collectBackendContracts, collectDeliveryEvidence, collectDeliveryNodes } from '../src/lib/prdNodeDelivery'
import { buildUiOnlyPrototypeInstruction, isUiOnlyPrototypeFeedback } from '../src/lib/nodeChatIntent'
import { applyPrototypeEdit, normalizeGeneratedPrototypeHtml, normalizePrototypeHtml } from '../src/lib/prototypeUtils'
import type { UXRequirementState } from '../src/types/uxRequirement'
import type { DocumentKeywordSignal, DocumentSourceIndex, DocumentSourceIssue, DocumentSourceSection, MapAdjustmentOperation, PrdImportCandidateNode, PrdImportPreview, PrdNode, PrdNodeAudience, PrdNodeBackendContractKind, PrdNodeBackendContractRef, PrdNodeEvidenceRef, PrdNodeOperationPatch, PrdNodeOperationSuggestion, PrdNodeReference, PrdNodeSourceKind, PrdNodeStatus } from '../src/types/prdNode'
import type { ReferenceImageClassificationRequest, ReferenceImageClassificationResponse, ReferenceImageRole } from '../src/types/chat'
import type { QaAttachment, QaChatRequest, QaChatResponse, QaIssuePatch, QaIssuePriority, QaIssueSeverity } from '../src/types/qa'
import { contentDispositionHeader } from './exportHeaders'
import { collectFigmaNumericTextSlots, redactNumericTextFromPng } from './figmaNumericText'
import { extractNodeChatSuffix } from './nodeChatResponse'
import { buildVariantConfigs, clampVariantCount, DEFAULT_CREATE_VARIANTS, DEFAULT_UPDATE_VARIANTS } from './prototypePrompts'
import type { FigmaNumericTextSlot } from './figmaNumericText'

dotenv.config()
dotenv.config({ path: 'server/.env' })

const app = express()
const port = Number(process.env.LOCAL_PROXY_PORT ?? 8787)
const ENV_FILE_PATH = path.resolve(process.cwd(), '.env')
const DEFAULT_ENV_CONFIG = {
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_BASE_URL: 'https://litellm.wenext.technology/',
  CLAUDE_MODEL: 'gpt-5.5',
  MOCK_DECOMPOSE: 'false',
  FIGMA_TOKEN: '',
} as const
let model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'
const ragSseUrl = process.env.COCOS_RAG_SSE_URL ?? 'http://43.134.44.85:18000/sse'
const rawRagProxyScript = process.env.COCOS_RAG_PROXY_SCRIPT ?? '%APPDATA%\\cocos-rag\\remote_proxy.py'
const ragProxyScript = rawRagProxyScript.replace('%APPDATA%', process.env.APPDATA ?? '').replace('$env:APPDATA', process.env.APPDATA ?? '')
const MCP_ENDPOINT_TIMEOUT_MS = 8000
const MCP_RPC_TIMEOUT_MS = 12000
const SESSION_CLEANUP_DELAY_MS = 5 * 60 * 1000
const MAX_TOOL_ITERATIONS = 4
const DECOMPOSITION_HEARTBEAT_MS = 8000
const DECOMPOSITION_CALL_TIMEOUT_MS = Number.parseInt(process.env.DECOMPOSITION_CALL_TIMEOUT_MS ?? '180000', 10)
const DECOMPOSITION_BRANCH_CONCURRENCY = 2
const LARGE_PRD_DECOMPOSE_THRESHOLD = 30 * 1024
const LARGE_PRD_SLICE_TARGET_LENGTH = 12 * 1024
const SOURCE_OUTLINE_ROOT_ID = 'SOURCE_OUTLINE_ROOT'
const SPEC_EXPORT_ROOT = path.resolve(process.cwd(), 'generated', 'specs')
const FIGMA_ASSET_CACHE_ROOT = path.resolve(process.cwd(), '.cache', 'figma-assets')
const figmaApiBaseUrl = (process.env.FIGMA_API_BASE_URL ?? 'https://api.figma.com').replace(/\/+$/, '')
const figma2PrefabBaseUrl = (process.env.FIGMA2PREFAB_BASE_URL ?? 'http://43.134.44.85:3000').replace(/\/+$/, '')
const figma2PrefabConvertPath = process.env.FIGMA2PREFAB_CONVERT_PATH ?? '/api/convert'
const figma2PrefabProvider = process.env.FIGMA2PREFAB_PROVIDER?.trim()
let figmaToken = process.env.FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN ?? ''
const FIGMA2PREFAB_POLL_INTERVAL_MS = Number.parseInt(process.env.FIGMA2PREFAB_POLL_INTERVAL_MS ?? '2500', 10)
const FIGMA2PREFAB_TIMEOUT_MS = Number.parseInt(process.env.FIGMA2PREFAB_TIMEOUT_MS ?? '600000', 10)
const FIGMA_ASSET_BUNDLE_TTL_MS = Number.parseInt(process.env.FIGMA_ASSET_BUNDLE_TTL_MS ?? `${30 * 60 * 1000}`, 10)
const FIGMA_EXTRACT_MAX_IMAGES = Math.min(8, Math.max(2, Number.parseInt(process.env.FIGMA_EXTRACT_MAX_IMAGES ?? '4', 10)))
const FIGMA_IMAGE_SCALE = Math.min(3, Math.max(0.5, Number.parseFloat(process.env.FIGMA_IMAGE_SCALE ?? '1.25')))
const FIGMA_MAX_IMAGE_BYTES = Math.max(512 * 1024, Number.parseInt(process.env.FIGMA_MAX_IMAGE_BYTES ?? `${4 * 1024 * 1024}`, 10))

interface FigmaAssetBundle {
  createdAt: number
  files: Record<string, Uint8Array>
  lookup: Map<string, string>
}

const figmaAssetBundles = new Map<string, FigmaAssetBundle>()

let anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })
  : null
let prototypeProviderOverride = (process.env.AI_PROVIDER ?? process.env.LLM_PROVIDER ?? '').toLowerCase()
let usesOpenAiPrototypeProvider = model.toLowerCase().startsWith('gpt-')
  || prototypeProviderOverride === 'openai'
  || prototypeProviderOverride === 'gpt'
let openAiApiKey = process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY
let openAiBaseUrl = (process.env.OPENAI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '')

function reloadAiRuntimeConfig() {
  model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'
  figmaToken = process.env.FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN ?? ''
  anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })
    : null
  prototypeProviderOverride = (process.env.AI_PROVIDER ?? process.env.LLM_PROVIDER ?? '').toLowerCase()
  usesOpenAiPrototypeProvider = model.toLowerCase().startsWith('gpt-')
    || prototypeProviderOverride === 'openai'
    || prototypeProviderOverride === 'gpt'
  openAiApiKey = process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY
  openAiBaseUrl = (process.env.OPENAI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
}

// In-memory decomposition session store.
// Single-user desktop app — no persistence needed between server restarts.
interface DecompositionSession {
  status: 'running' | 'done' | 'error'
  nodes: PrdNode[]
  currentStep: string
  error?: string
  branchErrors?: string[]
  cleanupTimer?: NodeJS.Timeout
}

const decompositionSessions = new Map<string, DecompositionSession>()

function scheduleSessionCleanup(sessionId: string) {
  const session = decompositionSessions.get(sessionId)
  if (!session) return
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer)
  session.cleanupTimer = setTimeout(() => {
    decompositionSessions.delete(sessionId)
  }, SESSION_CLEANUP_DELAY_MS)
}

interface ContentBlock {
  type: 'text' | 'image' | 'document'
  title?: string
  context?: string
  text?: string
  source?: { type: 'base64' | 'text'; media_type: string; data: string }
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content.map((block) => {
    if (block.type === 'text') return block.text ?? ''
    if (block.type === 'document') {
      const title = block.title ? `附件：${block.title}` : '附件'
      const data = block.source?.data ?? ''
      return [title, block.context, data].filter(Boolean).join('\n')
    }
    return ''
  }).filter(Boolean).join('\n')
}

function hasImages(content: string | ContentBlock[]) {
  return typeof content !== 'string' && content.some((b) => b.type === 'image' && b.source)
}

function imageBlocksFromContent(content: string | ContentBlock[]): Anthropic.ImageBlockParam[] {
  if (typeof content === 'string') return []
  return content
    .filter((block): block is ContentBlock & { type: 'image'; source: { type: 'base64'; media_type: string; data: string } } => (
      block.type === 'image' && block.source?.type === 'base64'
    ))
    .map((block) => ({ type: 'image', source: block.source as Anthropic.Base64ImageSource }))
}

function imageBlocksFromMessages(messages: ChatMessage[]): Anthropic.ImageBlockParam[] {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) => imageBlocksFromContent(message.content))
}

function toAnthropicNodeMessage(message: ChatMessage): Anthropic.MessageParam {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content }
  }

  if (message.role === 'assistant') {
    return { role: message.role, content: extractText(message.content) }
  }

  const content = message.content
    .map((block): Anthropic.ContentBlockParam | null => {
      if (block.type === 'text') return { type: 'text', text: block.text ?? '' }
      if (block.type === 'image' && block.source?.type === 'base64') {
        return { type: 'image', source: block.source as Anthropic.Base64ImageSource }
      }
      if (block.type === 'document' && block.source?.type === 'text') {
        return {
          type: 'document',
          title: block.title ?? null,
          context: block.context ?? null,
          source: {
            type: 'text',
            media_type: 'text/plain',
            data: block.source.data,
          },
        }
      }
      return null
    })
    .filter((block): block is Anthropic.ContentBlockParam => Boolean(block))

  return {
    role: message.role,
    content: content.length > 0 ? content : extractText(message.content),
  }
}

function prependTextToUserMessage(message: ChatMessage, prefix: string): ChatMessage {
  if (typeof message.content === 'string') {
    return {
      role: 'user',
      content: `${prefix}\n\n${message.content}`,
    }
  }

  let didPrepend = false
  const content = message.content.map((block) => {
    if (block.type !== 'text' || didPrepend) return block
    didPrepend = true
    return {
      ...block,
      text: `${prefix}\n\n${block.text ?? ''}`,
    }
  })

  return {
    role: 'user',
    content: didPrepend
      ? content
      : [{ type: 'text', text: prefix }, ...content],
  }
}

interface ChatRequest {
  messages: ChatMessage[]
  requirementState: UXRequirementState
}

interface PrototypeRequest {
  requirementState: UXRequirementState
  currentHtml?: string | null
  instruction?: string | null
  images?: ContentBlock[] | null
  numVariants?: number | null
  variantIndex?: number | null
  history?: string[] | null
  stream?: boolean | null
}

interface FigmaFrameRequest {
  url?: string
  token?: string
}

interface FigmaExtractedImage {
  nodeId: string
  name: string
  type: string
  width: number
  height: number
  depth: number
  mediaType: string
  data: string
  assetPath: string
  assetUrl: string
  numericTextSlots: FigmaNumericTextSlot[]
}

interface FigmaFrameResponse {
  fileKey: string
  nodeId: string
  panelName: string
  sourceUrl: string
  summary: string
  images: FigmaExtractedImage[]
  imageCount: number
}

interface FigmaPrefabFrameResponse {
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

type PrototypeVariantMode = 'create' | 'update' | 'rewrite'

interface PrototypeVariantPayload {
  index: number
  html: string | null
  mode: PrototypeVariantMode
  status: 'complete' | 'error'
  focus?: string
  appliedEdits: number
  history?: string[]
  error?: string
}

interface NodeChatRequest {
  nodeId: string
  currentMessage?: ChatMessage
  messages?: ChatMessage[]
  tree: Record<string, PrdNode>
  performancePolishMode?: boolean
}

interface MapAdjustmentRequest {
  messages: ChatMessage[]
  tree: Record<string, PrdNode>
}

interface NodeOperationSourceInput {
  name?: string
  sourceKind?: PrdNodeSourceKind
  text?: string
}

interface PrdNodeSuggestionRequest {
  tree: Record<string, PrdNode>
  selectedNodeId?: string
  supplementText?: string
  sources?: NodeOperationSourceInput[]
}

interface RagSearchRequest {
  query: string
}

interface McpJsonRpcSuccess<T> {
  jsonrpc: '2.0'
  id: number
  result: T
}

interface McpToolCallResult {
  content?: Array<{ type?: string; text?: string }>
  structuredContent?: unknown
  isError?: boolean
}

const systemPrompt = `你是 GameUX PromptForge 的需求质量检查员。
你的任务是把模糊的游戏 UX 交互需求，整理成可直接交给 Cocos Creator 3.8.8 实现的提示词。
每轮最多问一个高价值追问，并且只在它真正阻塞实现时追问。
当 completion_rate 达到 60 或更高时，停止确认式提问，直接在 reply 中输出最终 Cocos Creator 实现提示词草案。
每轮都必须根据最新对话重新评估所有槽位；如果用户新增范围或出现矛盾，要相应降低 completion_rate 和置信度。
重点检查缺失槽位：trigger_condition、sequence_rules、asset_dependencies、engine_constraints。
如果用户提供图片，把它们当作游戏 UI 截图或视觉参考：识别可见功能、布局层级、间距、对齐、导航、主要控件、装饰素材、文本区域，以及哪些图片只是参考、哪些图片应作为资源纳入。
同时提取 ui_components 树：对描述画面中的每个可见 UI 元素，创建包含 name、type、states、animation_in、animation_out、z_order、notes、children 的组件条目。
Component types 和 Component states 可以保留英文枚举值；其他用户可见内容必须使用中文。
只有当 Cocos 引擎行为、Tween、动画、音频、Prefab、资源或实现约束会影响结论时，才调用 query_cocos_knowledge。
如果当前信息已经足够，不要调用工具。
所有生成给用户看的文字必须是中文，包括 reply、state_patch 中的描述性字段、suggested_answers、最终实现提示词、组件 notes。
唯一允许保留英文的是：代码标识、接口字段名、文件路径、库/API 名称、枚举值、专有产品名。
用简洁中文回复，并返回 JSON state_patch 对象。
reply 必须易读：
- 最多 8 行短句。
- 不要长段落。
- 不要在 reply 中暴露原始 JSON、state_patch、大括号或 schema 文本。
- 如果 completion_rate >= 60，reply 必须是最终实现提示词草案，不要再问“是否输出”。
- 如果 completion_rate < 60，只问最阻塞的一个问题。
- 收集缺失信息时使用这个固定风格：
  已确认：...
  还缺：...
  请补充：...
- 不要使用 Markdown 表格或标题。
始终填写 suggested_answers，给出 2-4 个用户可点击的短答案。选项必须具体、自然，不要复述问题。例如追问动画类型时，可给 ["渐显+滑入 300ms", "弹出缩放 200ms", "无动画直接显示", "自定义，我来描述"]。
只写你有把握更新的字段。
不要为已确认值输出 "unknown"、"待定" 或空字符串；未知时用 null。
asset_dependencies 必须始终是包含 type、path、is_ready 的对象数组。
completion_rate 必须始终是 0 到 100 的整数。
不要包含 Markdown 代码围栏。
严格返回这个 JSON 形状：
{
  "reply": "string",
  "state_patch": {
    "trigger_condition": "string or null",
    "sequence_rules": "string or null",
    "asset_dependencies": [{"type":"string","path":"string or null","is_ready":true}],
    "engine_constraints": "string or null",
    "ui_components": [
      {
        "name": "ComponentName",
        "type": "Button",
        "states": ["idle","hover","pressed"],
        "animation_in": "fadeIn 300ms ease-out",
        "animation_out": "fadeOut 200ms",
        "z_order": 1,
        "notes": "string or null",
        "children": []
      }
    ],
    "suggested_answers": ["选项1", "选项2", "选项3"],
    "completion_rate": 0,
    "slot_confidence": {
      "trigger_condition": 0,
      "sequence_rules": 0,
      "asset_dependencies": 0,
      "engine_constraints": 0
    },
    "missing_reasons": {
      "trigger_condition": "string or null",
      "sequence_rules": "string or null",
      "asset_dependencies": "string or null",
      "engine_constraints": "string or null"
    },
    "next_question": "string or null"
  }
}`

const tools: Anthropic.Tool[] = [
  {
    name: 'query_cocos_knowledge',
    description: 'Search Cocos Creator 3.8.8 knowledge when engine constraints or API usage need authoritative support.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The Cocos Creator engine question to search for.',
        },
      },
      required: ['query'],
    },
  },
]

function textFromClaudeContent(content: Anthropic.Messages.ContentBlock[]) {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function safeParseClaudeJson(text: string) {
  const trimmed = text.trim()
  const candidates = [trimmed]
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as { reply?: string; state_patch?: Partial<UXRequirementState> }
    } catch {
      // Try next candidate
    }
  }

  return { reply: stripJsonEcho(trimmed) }
}

function stripJsonEcho(text: string) {
  const jsonStart = text.indexOf('{')
  return (jsonStart === -1 ? text : text.slice(0, jsonStart)).trim()
}

function safeParseMapAdjustmentJson(text: string) {
  const trimmed = text.trim()
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  const candidate = firstBrace !== -1 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed
  try {
    return JSON.parse(candidate) as { reply?: string; operations?: unknown }
  } catch {
    return { reply: stripJsonEcho(trimmed), operations: [] }
  }
}

function safeParseQaChatJson(text: string) {
  const trimmed = text.trim()
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  const candidate = firstBrace !== -1 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed
  try {
    return JSON.parse(candidate) as { reply?: string; readyToConfirm?: unknown; issuePatch?: unknown }
  } catch {
    return { reply: stripJsonEcho(trimmed), readyToConfirm: false, issuePatch: {} }
  }
}

function normalizeQaTextArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  return value.map((item) => normalizeNullableString(item)).filter((item): item is string => Boolean(item))
}

function normalizeQaSeverity(value: unknown): QaIssueSeverity | undefined {
  return value === 'blocker' || value === 'major' || value === 'minor' || value === 'trivial'
    ? value
    : undefined
}

function normalizeQaPriority(value: unknown): QaIssuePriority | undefined {
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined
}

function normalizeQaConfidenceValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)))
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed))
  }
  return undefined
}

function normalizeQaIssuePatch(value: unknown): QaIssuePatch {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const patch: QaIssuePatch = {}
  const title = normalizeNullableString(candidate.title)
  const description = normalizeNullableString(candidate.description)
  const expectedResult = normalizeNullableString(candidate.expectedResult ?? candidate.expected_result)
  const actualResult = normalizeNullableString(candidate.actualResult ?? candidate.actual_result)
  const environment = normalizeNullableString(candidate.environment)
  const aiSummary = normalizeNullableString(candidate.aiSummary ?? candidate.ai_summary)
  const suspectedCause = normalizeNullableString(candidate.suspectedCause ?? candidate.suspected_cause)
  const devSuggestion = normalizeNullableString(candidate.devSuggestion ?? candidate.dev_suggestion)
  const stepsToReproduce = normalizeQaTextArray(candidate.stepsToReproduce ?? candidate.steps_to_reproduce)
  const aiQuestions = normalizeQaTextArray(candidate.aiQuestions ?? candidate.ai_questions)
  const severity = normalizeQaSeverity(candidate.severity)
  const priority = normalizeQaPriority(candidate.priority)
  const aiConfidence = normalizeQaConfidenceValue(candidate.aiConfidence ?? candidate.ai_confidence)

  if (title) patch.title = title
  if (severity) patch.severity = severity
  if (priority) patch.priority = priority
  if (description) patch.description = description
  if (stepsToReproduce) patch.stepsToReproduce = stepsToReproduce
  if (expectedResult) patch.expectedResult = expectedResult
  if (actualResult) patch.actualResult = actualResult
  if (candidate.environment !== undefined) patch.environment = environment
  if (aiSummary) patch.aiSummary = aiSummary
  if (aiQuestions) patch.aiQuestions = aiQuestions
  if (aiConfidence !== undefined) patch.aiConfidence = aiConfidence
  if (candidate.suspectedCause !== undefined || candidate.suspected_cause !== undefined) patch.suspectedCause = suspectedCause
  if (candidate.devSuggestion !== undefined || candidate.dev_suggestion !== undefined) patch.devSuggestion = devSuggestion
  if (typeof candidate.readyToConfirm === 'boolean') patch.readyToConfirm = candidate.readyToConfirm
  if (typeof candidate.ready_to_confirm === 'boolean') patch.readyToConfirm = candidate.ready_to_confirm
  return patch
}

function qaAttachmentToImageBlock(attachment: QaAttachment): Anthropic.ImageBlockParam | null {
  if (attachment.type !== 'image' || !attachment.dataUrl) return null
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/u.exec(attachment.dataUrl)
  const mediaType = attachment.mediaType ?? match?.[1]
  const data = match?.[2] ?? attachment.dataUrl
  if (
    mediaType !== 'image/png'
    && mediaType !== 'image/jpeg'
    && mediaType !== 'image/gif'
    && mediaType !== 'image/webp'
  ) {
    return null
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType,
      data,
    },
  }
}

function formatQaNodeRefs(issue: QaChatRequest['issue']) {
  if (!issue.nodeRefs.length) return '未引用节点'
  return issue.nodeRefs.map((ref, index) => [
    `### 引用 ${index + 1}: ${ref.title}`,
    `- 节点 ID: ${ref.nodeId}`,
    `- 类型: ${ref.nodeType}`,
    `- 导出路径: ${ref.docPath ?? '未指定'}`,
    `- 摘要: ${ref.summary}`,
    ref.snapshot.handoffGoal ? `- AI 接力目标: ${ref.snapshot.handoffGoal}` : null,
    ref.snapshot.qualityGate ? `- 质量门槛: ${ref.snapshot.qualityGate}` : null,
    ref.snapshot.techNotes ? `- 技术备注: ${ref.snapshot.techNotes}` : null,
    `- 内容:\n${ref.content}`,
  ].filter(Boolean).join('\n')).join('\n\n')
}

function formatQaAttachments(issue: QaChatRequest['issue']) {
  if (!issue.attachments.length) return '未上传附件'
  return issue.attachments.map((attachment, index) => {
    if (attachment.type === 'image') {
      return `${index + 1}. 图片：${attachment.name}（${attachment.mediaType ?? '未知类型'}）`
    }
    return `${index + 1}. ${attachment.name}\n${attachment.text ?? '无文本内容'}`
  }).join('\n\n')
}

function formatQaIssueDraft(issue: QaChatRequest['issue']) {
  return [
    `标题: ${issue.title}`,
    `状态: ${issue.status}`,
    `严重程度: ${issue.severity}`,
    `优先级: ${issue.priority}`,
    `描述: ${issue.description || '未填写'}`,
    `复现步骤:\n${issue.stepsToReproduce.length ? issue.stepsToReproduce.map((step, index) => `${index + 1}. ${step}`).join('\n') : '未填写'}`,
    `预期结果: ${issue.expectedResult || '未填写'}`,
    `实际结果: ${issue.actualResult || '未填写'}`,
    `环境: ${issue.environment ?? '未填写'}`,
    `AI 摘要: ${issue.aiSummary || '未生成'}`,
    `疑似原因: ${issue.suspectedCause ?? '未判断'}`,
    `给程序的建议: ${issue.devSuggestion ?? '未生成'}`,
  ].join('\n')
}

function normalizeNullableString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeAssetDependency(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const type = normalizeNullableString(candidate.type) ?? 'unknown'
  const path = normalizeNullableString(candidate.path)
  const isReady = typeof candidate.is_ready === 'boolean' ? candidate.is_ready : Boolean(path)
  return {
    type,
    path,
    is_ready: isReady,
  }
}

function dedupeAssets(assets: Array<{ type: string; path: string | null; is_ready: boolean }>) {
  const seen = new Map<string, { type: string; path: string | null; is_ready: boolean }>()
  for (const asset of assets) {
    const key = `${asset.type}:${asset.path ?? 'missing'}`
    seen.set(key, asset)
  }
  return [...seen.values()]
}

function clampCompletionRate(value: unknown, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(0, Math.min(100, Math.round(value)))
}

function clampConfidence(value: unknown, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeConfidencePatch(value: unknown, current: UXRequirementState['slot_confidence']) {
  if (!value || typeof value !== 'object') return current
  const candidate = value as Record<string, unknown>
  return {
    trigger_condition: clampConfidence(candidate.trigger_condition, current.trigger_condition),
    sequence_rules: clampConfidence(candidate.sequence_rules, current.sequence_rules),
    asset_dependencies: clampConfidence(candidate.asset_dependencies, current.asset_dependencies),
    engine_constraints: clampConfidence(candidate.engine_constraints, current.engine_constraints),
  }
}

function normalizeMissingReasonsPatch(value: unknown, current: UXRequirementState['missing_reasons']) {
  if (!value || typeof value !== 'object') return current
  const candidate = value as Record<string, unknown>
  return {
    trigger_condition: 'trigger_condition' in candidate ? normalizeNullableString(candidate.trigger_condition) : current.trigger_condition,
    sequence_rules: 'sequence_rules' in candidate ? normalizeNullableString(candidate.sequence_rules) : current.sequence_rules,
    asset_dependencies: 'asset_dependencies' in candidate ? normalizeNullableString(candidate.asset_dependencies) : current.asset_dependencies,
    engine_constraints: 'engine_constraints' in candidate ? normalizeNullableString(candidate.engine_constraints) : current.engine_constraints,
  }
}

function normalizeStatePatch(patch: Partial<UXRequirementState> | undefined, current: UXRequirementState): Partial<UXRequirementState> {
  if (!patch) return {}

  const nextPatch: Partial<UXRequirementState> = {}

  if ('trigger_condition' in patch) {
    nextPatch.trigger_condition = normalizeNullableString(patch.trigger_condition)
  }

  if ('sequence_rules' in patch) {
    nextPatch.sequence_rules = normalizeNullableString(patch.sequence_rules)
  }

  if ('engine_constraints' in patch) {
    nextPatch.engine_constraints = normalizeNullableString(patch.engine_constraints)
  }

  if (Array.isArray(patch.asset_dependencies)) {
    nextPatch.asset_dependencies = dedupeAssets(
      patch.asset_dependencies
        .map((asset) => normalizeAssetDependency(asset))
        .filter((asset): asset is NonNullable<ReturnType<typeof normalizeAssetDependency>> => asset !== null),
    )
  }

  if ('slot_confidence' in patch) {
    nextPatch.slot_confidence = normalizeConfidencePatch(patch.slot_confidence, current.slot_confidence)
  }

  if ('missing_reasons' in patch) {
    nextPatch.missing_reasons = normalizeMissingReasonsPatch(patch.missing_reasons, current.missing_reasons)
  }

  if ('next_question' in patch) {
    nextPatch.next_question = normalizeNullableString(patch.next_question)
  }

  if (Array.isArray(patch.ui_components)) {
    nextPatch.ui_components = normalizeUIComponents(patch.ui_components)
  }

  if (Array.isArray(patch.suggested_answers)) {
    nextPatch.suggested_answers = patch.suggested_answers
      .map((s) => (typeof s === 'string' ? s.trim() : null))
      .filter((s): s is string => Boolean(s))
      .slice(0, 4)
  }

  nextPatch.completion_rate = clampCompletionRate(patch.completion_rate, current.completion_rate)

  return nextPatch
}

function normalizeUIComponent(value: unknown): import('../src/types/uxRequirement').UIComponent | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Record<string, unknown>
  const name = normalizeNullableString(c.name) ?? 'Component'
  const type = normalizeNullableString(c.type) ?? 'Node'
  const states = Array.isArray(c.states)
    ? (c.states as unknown[]).filter((s): s is string => typeof s === 'string')
    : ['idle']
  const animIn = normalizeNullableString(c.animation_in)
  const animOut = normalizeNullableString(c.animation_out)
  const zOrder = typeof c.z_order === 'number' ? Math.round(c.z_order) : 0
  const notes = normalizeNullableString(c.notes)
  const children = Array.isArray(c.children)
    ? (c.children as unknown[]).map(normalizeUIComponent).filter((ch): ch is import('../src/types/uxRequirement').UIComponent => ch !== null)
    : []
  return { name, type, states: states as import('../src/types/uxRequirement').UIComponentState[], animation_in: animIn, animation_out: animOut, z_order: zOrder, notes, children }
}

function normalizeUIComponents(value: unknown[]): import('../src/types/uxRequirement').UIComponent[] {
  return value.map(normalizeUIComponent).filter((c): c is import('../src/types/uxRequirement').UIComponent => c !== null)
}

function mergeRequirementState(current: UXRequirementState, patch?: Partial<UXRequirementState>) {
  const normalizedPatch = normalizeStatePatch(patch, current)
  const mergedAssets = normalizedPatch.asset_dependencies ?? current.asset_dependencies

  return {
    mergedState: {
      ...current,
      ...normalizedPatch,
      asset_dependencies: mergedAssets,
    },
    normalizedPatch: {
      ...normalizedPatch,
      asset_dependencies: mergedAssets,
    },
  }
}

async function runClaudeRequirementLoop(messages: ChatMessage[], requirementState: UXRequirementState) {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const imageBlocks: Anthropic.ImageBlockParam[] = typeof lastUserMsg?.content !== 'string'
    ? (lastUserMsg?.content ?? [])
        .filter((b): b is ContentBlock & { type: 'image'; source: { type: 'base64'; media_type: string; data: string } } => (
          b.type === 'image' && b.source?.type === 'base64'
        ))
        .map((b) => ({ type: 'image', source: b.source as Anthropic.Base64ImageSource }))
    : []

  const contextText = JSON.stringify({
    current_requirement_state: requirementState,
    image_analysis_instruction: imageBlocks.length > 0
      ? 'Analyze every attached image for game UI function, composition, layout, hierarchy, spacing, controls, text areas, visual assets, and implementation implications. If the user distinguishes reference images from assets to include, preserve that distinction.'
      : undefined,
    conversation: messages.map((m) => ({ role: m.role, content: extractText(m.content) })),
  })

  const firstUserContent: Anthropic.ContentBlockParam[] = [
    ...imageBlocks,
    { type: 'text', text: contextText },
  ]

  const conversation: Anthropic.MessageParam[] = [
    { role: 'user', content: firstUserContent },
  ]

  let latestRagResult: Awaited<ReturnType<typeof queryCocosKnowledge>> | undefined

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const response = await anthropic!.messages.create({
      model,
      max_tokens: 16000,
      system: systemPrompt,
      tools,
      messages: conversation,
    })

    if (response.stop_reason === 'end_turn') {
      return {
        response,
        rag: latestRagResult,
      }
    }

    const toolUseBlocks = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
    conversation.push({ role: 'assistant', content: response.content })

    if (!toolUseBlocks.length) {
      return {
        response,
        rag: latestRagResult,
      }
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const toolUse of toolUseBlocks) {
      if (toolUse.name === 'query_cocos_knowledge') {
        const input = (toolUse.input ?? {}) as { query?: unknown }
        const query = typeof input.query === 'string' ? input.query : ''
        latestRagResult = await queryCocosKnowledge(query)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(latestRagResult),
        })
      }
    }

    conversation.push({ role: 'user', content: toolResults })
  }

  throw new Error(`Claude tool loop exceeded ${MAX_TOOL_ITERATIONS} iterations`)
}

function extractToolText(result: McpToolCallResult) {
  const contentText = result.content?.map((item) => item.text).filter(Boolean).join('\n')
  if (contentText) {
    try {
      const parsed = JSON.parse(contentText) as { results?: Array<{ section_title?: string; content?: string; source_url?: string }> }
      if (parsed.results?.length) {
        return parsed.results
          .slice(0, 3)
          .map((item, index) => `${index + 1}. ${item.section_title ?? 'Cocos 文档片段'}\n${item.content ?? ''}\n来源：${item.source_url ?? 'unknown'}`)
          .join('\n\n')
      }
    } catch {
      return contentText
    }
    return contentText
  }
  if (typeof result.structuredContent === 'string') return result.structuredContent
  if (result.structuredContent) return JSON.stringify(result.structuredContent, null, 2)
  return 'Cocos RAG 未返回文本内容。'
}

async function callMcpTool(method: string, params: Record<string, unknown>) {
  const proxyProcess = spawn('uv', ['run', ragProxyScript, ragSseUrl], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  let requestId = 1
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>()
  let stdoutBuffer = ''
  let endpointReady = false
  let stderrLog = ''

  proxyProcess.stderr.setEncoding('utf8')
  proxyProcess.stderr.on('data', (chunk: string) => {
    stderrLog += chunk
    if (chunk.includes('Connected. Post endpoint:')) {
      endpointReady = true
    }
  })

  proxyProcess.stdout.setEncoding('utf8')
  proxyProcess.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const payload = JSON.parse(trimmed) as McpJsonRpcSuccess<unknown> & { error?: { message?: string }; method?: string }
        if ('id' in payload && typeof payload.id === 'number' && pending.has(payload.id)) {
          const deferred = pending.get(payload.id)
          pending.delete(payload.id)
          if (payload.error) {
            deferred?.reject(new Error(payload.error.message ?? 'MCP tool call failed'))
          } else {
            deferred?.resolve(payload.result)
          }
        }
      } catch {
        // ignore non-json lines
      }
    }
  })

  proxyProcess.on('error', (error) => {
    for (const deferred of pending.values()) deferred.reject(error)
    pending.clear()
  })

  proxyProcess.on('exit', () => {
    for (const deferred of pending.values()) deferred.reject(new Error(`MCP proxy exited early. ${stderrLog}`.trim()))
    pending.clear()
  })

  async function waitForEndpoint() {
    const startedAt = Date.now()
    while (!endpointReady) {
      if (Date.now() - startedAt > MCP_ENDPOINT_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for Cocos RAG MCP proxy. ${stderrLog}`.trim())
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  function sendRpc<T>(payload: Record<string, unknown>) {
    const id = requestId++
    const body = JSON.stringify({ jsonrpc: '2.0', id, ...payload })
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Timed out waiting for MCP RPC response: ${String(payload.method ?? 'unknown')}`))
      }, MCP_RPC_TIMEOUT_MS)
      pending.set(id, {
        resolve: (value: unknown) => {
          clearTimeout(timeout)
          resolve(value as T)
        },
        reject: (reason?: unknown) => {
          clearTimeout(timeout)
          reject(reason)
        },
      })
      proxyProcess.stdin.write(`${body}\n`)
    })
  }

  try {
    await waitForEndpoint()
    await sendRpc({ method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gameux-promptforge-proxy', version: '0.1.0' } } })
    proxyProcess.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`)
    await sendRpc({ method: 'tools/list', params: {} })
    return await sendRpc<ToolResultEnvelope>({ method: 'tools/call', params: { name: method, arguments: params } })
  } finally {
    proxyProcess.stdin.end()
    proxyProcess.kill()
  }
}

type ToolResultEnvelope = McpToolCallResult

async function queryCocosKnowledge(query: string) {
  if (!query.trim()) {
    return {
      status: 'error' as const,
      answer: 'Cocos RAG 查询内容为空。',
      references: [],
    }
  }

  try {
    const result = await callMcpTool('search_cocos_docs', {
      query,
      version: '3.8.8',
      top_k: 5,
    })

    return {
      status: result.isError ? ('error' as const) : ('connected' as const),
      answer: extractToolText(result),
      references: [
        {
          title: 'Cocos Creator 3.8.8 RAG MCP SSE',
          source: ragSseUrl,
        },
      ],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Cocos RAG error'
    return {
      status: 'error' as const,
      answer: `Cocos RAG 连接失败：${message}`,
      references: [
        {
          title: 'Cocos Creator 3.8.8 RAG MCP SSE',
          source: ragSseUrl,
        },
      ],
    }
  }
}

// ── Decomposition Tool ──────────────────────────────────────────────────────

const prdNodeSectionSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    title: { type: ['string', 'null'], maxLength: 40 },
    summary: { type: ['string', 'null'], maxLength: 160 },
    content: { type: ['string', 'null'], maxLength: 1200 },
    evidenceRefs: {
      type: ['array', 'null'],
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sourceKind: { type: 'string', enum: ['prd', 'user', 'upload'] },
          sourceLabel: { type: 'string', maxLength: 80 },
          quote: { type: ['string', 'null'], maxLength: 180 },
        },
        required: ['sourceKind', 'sourceLabel'],
      },
    },
    openQuestions: {
      type: ['array', 'null'],
      maxItems: 6,
      items: { type: 'string', maxLength: 140 },
    },
  },
}

const prdNodeSectionsSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    data: prdNodeSectionSchema,
    interaction: prdNodeSectionSchema,
    view: prdNodeSectionSchema,
  },
}

const decomposePrdTool: Anthropic.Tool = {
  name: 'decompose_prd',
  description: '将 PRD 文档拆解为 AI 可接力执行的多文件知识库树。每个叶子节点代表一篇可导出的 Markdown 文档包。',
  input_schema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        minItems: 0,
        maxItems: 6,
        description: '扁平 PrdNode 数组。用于页面下有原文依据的 model、ctrl、view 子节点；没有明确依据的 MVC 类别不要输出。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', maxLength: 40, description: '稳定唯一 ID，例如 "PAGE-MAIN-VIEW"、"PAGE-RANK-CTRL"。ID 可用英文功能缩写 + MVC 类型。' },
            parentId: { type: ['string', 'null'], description: '父页面节点 ID。' },
            label: { type: 'string', maxLength: 32, description: '中文短标题，建议包含 Model、Ctrl 或 View，例如“主界面 View”。' },
            summary: { type: 'string', maxLength: 120, description: '中文一句话摘要，说明该 MVC 子节点覆盖的原文范围。' },
            content: { type: 'string', maxLength: 1200, description: '必须按“原文位置、关键原文摘录、整理说明、需澄清点”组织；关键原文摘录必须来自相关 PRD 片段。' },
            type: { type: 'string', enum: ['module', 'feature', 'ui', 'page'], description: 'view 用 ui；model/ctrl 用 feature。' },
            status: { type: 'string', enum: ['pending_refine', 'pending', 'done'], description: '页面初始必须为 pending_refine。' },
            level: { type: 'integer', description: '树深度。顶层目录为 1，子目录为 2，文档包通常为 2-4。不要为了控件状态无限下钻。' },
            order: { type: 'integer', description: '同父节点内的排序位置，从 0 开始。' },
            needsPolish: { type: 'boolean', description: '该文档是否还需要 Deep Forge 补齐才能直接交给 AI 执行。UI/交互文档通常为 true；配置/API/验收若原文已完整可为 false。' },
            extractedFrom: { type: ['string', 'null'], maxLength: 120, description: '原文位置，例如标题名、章节号或行号范围。无法定位时为 null；若原文标题是中文应保持中文。' },
            techNotes: { type: ['string', 'null'], maxLength: 220, description: '面向开发的中文技术备注，可为空。' },
            docPath: { type: ['string', 'null'], maxLength: 120, description: 'MVC 子文档导出路径，例如 "pages/page-main/model.md"、"pages/page-main/ctrl.md"、"pages/page-main/view.md"。' },
            audience: { type: ['string', 'null'], enum: ['overview', 'client', 'server', 'config', 'api', 'acceptance', 'appendix', 'mixed', 'model', 'ctrl', 'view', null], description: '下游消费角色。优先使用 client/server/config/api/acceptance 等角色；model/ctrl/view 仅用于兼容旧结果，新结果应写入 specLens。' },
            specLens: { type: ['string', 'null'], enum: ['full', 'model', 'control', 'view', null], description: '该节点的规格视角：full=整页规格，model=数据/配置/规则，control=交互流程/校验/状态流转，view=布局/文案/动效/视觉反馈。' },
            sections: prdNodeSectionsSchema,
            handoffGoal: { type: ['string', 'null'], maxLength: 220, description: '中文一句话说明后续 AI 拿到这篇文档应完成什么任务。目录节点可为 null。' },
            qualityGate: { type: ['string', 'null'], maxLength: 220, description: '中文说明该文档可交给 AI 前必须满足的检查点，例如字段完整、验收项可测试、职责边界清晰。' },
            sourceKind: { type: ['string', 'null'], enum: ['prd', 'user', 'upload', null], description: '证据来源；原始 PRD 拆分固定为 prd。' },
            evidenceRefs: {
              type: ['array', 'null'],
              maxItems: 5,
              description: '真实证据引用。原始 PRD 拆分应引用 PRD 章节/标题/短句，不得把用户补充伪装成 PRD。',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  sourceKind: { type: 'string', enum: ['prd', 'user', 'upload'] },
                  sourceLabel: { type: 'string', maxLength: 80 },
                  quote: { type: ['string', 'null'], maxLength: 180 },
                },
                required: ['sourceKind', 'sourceLabel'],
              },
            },
          },
          required: ['id', 'parentId', 'label', 'summary', 'content', 'type', 'level', 'order', 'needsPolish'],
        },
      },
    },
    required: ['nodes'],
  },
}

const decomposePrdTopLevelTool: Anthropic.Tool = {
  name: 'decompose_prd',
  description: '仅输出 PRD 中真实存在或强烈暗示的页面/界面/弹窗节点。不要生成 MVC 子节点，后续会按页面展开。',
  input_schema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        description: '少量页面/界面/弹窗节点；系统会把它们挂到 PRD 原文目录根节点下。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', maxLength: 24, description: '稳定唯一 ID，例如 "OVERVIEW"、"CLIENT"、"RULES"。' },
            parentId: { type: ['string', 'null'], description: '顶层目录必须为 null。' },
            label: { type: 'string', maxLength: 24, description: '中文短标题，3-12 个汉字。' },
            summary: { type: 'string', maxLength: 80, description: '一句中文摘要，说明该目录覆盖范围。' },
            content: { type: 'string', maxLength: 600, description: '按“原文位置、关键原文摘录、整理说明、需澄清点”组织；摘录必须来自原文。' },
            type: { type: 'string', enum: ['module', 'feature', 'ui', 'page'], description: '顶层可以是 module；若是独立页面/界面则用 page。' },
            status: { type: 'string', enum: ['pending_refine', 'pending', 'done'], description: '页面初始必须为 pending_refine。' },
            level: { type: 'integer', enum: [1], description: '顶层目录固定为 1。' },
            order: { type: 'integer', description: '同级排序，从 0 开始。' },
            needsPolish: { type: 'boolean', description: '顶层目录通常为 false；单篇 UI 文档可为 true。' },
            extractedFrom: { type: ['string', 'null'], maxLength: 80, description: '原文章节或标题位置。' },
            techNotes: { type: ['string', 'null'], maxLength: 120, description: '简短技术备注；无则为 null。' },
            docPath: { type: ['null'], description: '顶层目录固定为 null；可导出的 Markdown 路径只在后续分支展开阶段填写。' },
            audience: { type: ['string', 'null'], enum: ['overview', 'client', 'server', 'config', 'api', 'acceptance', 'appendix', 'mixed', 'model', 'ctrl', 'view', null], description: '下游消费角色。优先使用 client/server/config/api/acceptance 等角色；MVC 视角写入 specLens。' },
            specLens: { type: ['string', 'null'], enum: ['full', 'model', 'control', 'view', null], description: '该节点的规格视角；页面节点通常为 full。' },
            sections: prdNodeSectionsSchema,
            handoffGoal: { type: ['string', 'null'], maxLength: 120, description: '一句话说明后续 AI 应如何展开该目录。' },
            qualityGate: { type: ['string', 'null'], maxLength: 120, description: '一句话说明该目录展开时的检查标准。' },
            sourceKind: { type: ['string', 'null'], enum: ['prd', 'user', 'upload', null], description: '证据来源；原始 PRD 拆分固定为 prd。' },
            evidenceRefs: {
              type: ['array', 'null'],
              maxItems: 3,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  sourceKind: { type: 'string', enum: ['prd', 'user', 'upload'] },
                  sourceLabel: { type: 'string', maxLength: 80 },
                  quote: { type: ['string', 'null'], maxLength: 140 },
                },
                required: ['sourceKind', 'sourceLabel'],
              },
            },
          },
          required: ['id', 'parentId', 'label', 'summary', 'content', 'type', 'level', 'order', 'needsPolish'],
        },
      },
    },
    required: ['nodes'],
  },
}

function normalizeTextValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeParentId(value: unknown): string | null {
  const text = normalizeTextValue(value)
  if (!text || text === 'null' || text === 'undefined' || text === '-') return null
  return text
}

function normalizeNumberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function normalizeBooleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', 'yes', '1', '是', '需要'].includes(normalized)) return true
    if (['false', 'no', '0', '否', '不需要'].includes(normalized)) return false
  }
  return fallback
}

function normalizeNodeType(value: unknown): PrdNode['type'] {
  const text = normalizeTextValue(value)?.toLowerCase()
  if (!text) return 'page'
  if (['page', 'screen', '页面', '界面', '弹窗', '模块页'].includes(text)) return 'page'
  if (['module', '模块', 'domain', 'category'].includes(text)) return 'module'
  if (['ui', 'interaction', 'control', '交互', '控件', '状态'].includes(text)) return 'ui'
  return 'feature'
}

function normalizeNodeStatus(value: unknown, fallback: PrdNodeStatus): PrdNodeStatus {
  const text = normalizeTextValue(value)?.toLowerCase()
  if (text === 'done' || text === '已确认' || text === 'completed') return 'done'
  if (text === 'pending_refine' || text === '待打磨' || text === 'refine') return 'pending_refine'
  if (text === 'pending' || text === '可导出') return 'pending'
  return fallback
}

function normalizeNodeReferences(value: unknown): PrdNodeReference[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): PrdNodeReference | null => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const targetNodeId = normalizeTextValue(candidate.targetNodeId ?? candidate.target_node_id ?? candidate.targetId ?? candidate.target_id)
      const label = normalizeTextValue(candidate.label ?? candidate.title ?? candidate.name) ?? '跨页面引用'
      const reason = normalizeTextValue(candidate.reason ?? candidate.note ?? candidate.description)
      const sourceNodeId = normalizeTextValue(candidate.sourceNodeId ?? candidate.source_node_id ?? candidate.sourceId ?? candidate.source_id)
      return { targetNodeId, label, reason, sourceNodeId }
    })
    .filter((item): item is PrdNodeReference => item !== null && Boolean(item.label))
}

function normalizeAudience(value: unknown): PrdNodeAudience | null {
  const text = normalizeTextValue(value)?.toLowerCase()
  if (!text) return null
  if (['overview', 'project', '概览', '总览'].includes(text)) return 'overview'
  if (['client', 'frontend', '客户端', '前端', '表现层'].includes(text)) return 'client'
  if (['server', 'backend', '服务端', '后端'].includes(text)) return 'server'
  if (['config', '配置', '参数'].includes(text)) return 'config'
  if (['api', 'interface', '接口', '字段'].includes(text)) return 'api'
  if (['acceptance', 'qa', 'test', '验收', '测试', '质量'].includes(text)) return 'acceptance'
  if (['appendix', 'risk', 'tracking', '附录', '风险', '埋点'].includes(text)) return 'appendix'
  if (['model', '模型', '数据模型', '领域模型'].includes(text)) return 'model'
  if (['ctrl', 'controller', 'control', '控制', '控制器', '流程控制'].includes(text)) return 'ctrl'
  if (['view', 'ui', 'screen', '界面', '视图', '视觉层'].includes(text)) return 'view'
  return 'mixed'
}

function normalizeSourceKind(value: unknown, fallback: PrdNodeSourceKind = 'prd'): PrdNodeSourceKind {
  const text = normalizeTextValue(value)?.toLowerCase()
  if (['user', '用户', '用户补充'].includes(text ?? '')) return 'user'
  if (['upload', 'file', '上传', '上传资料'].includes(text ?? '')) return 'upload'
  return fallback
}

function normalizeEvidenceRefs(value: unknown, fallbackSourceKind: PrdNodeSourceKind, fallbackLabel: string): PrdNodeEvidenceRef[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 5).flatMap((item): PrdNodeEvidenceRef[] => {
    if (!item || typeof item !== 'object') return []
    const ref = item as Record<string, unknown>
    return [{
      sourceKind: normalizeSourceKind(ref.sourceKind ?? ref.source_kind, fallbackSourceKind),
      sourceLabel: normalizeTextValue(ref.sourceLabel ?? ref.source_label ?? ref.label ?? ref.source) ?? fallbackLabel,
      quote: normalizeTextValue(ref.quote ?? ref.text) ?? null,
    }]
  })
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item) => {
      const text = normalizeTextValue(item)
      return text ? [text] : []
    })
    .slice(0, 6)
}

function normalizeBackendContractKind(value: unknown): PrdNodeBackendContractKind | null {
  if (value === 'api' || value === 'config' || value === 'server' || value === 'data') return value
  return null
}

function normalizeBackendContracts(value: unknown, fallbackSourceKind: PrdNodeSourceKind, fallbackLabel: string): PrdNodeBackendContractRef[] | undefined {
  if (!Array.isArray(value)) return undefined
  const contracts = value.slice(0, 12)
    .map((item): PrdNodeBackendContractRef | null => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const kind = normalizeBackendContractKind(candidate.kind ?? candidate.type)
      const title = normalizeTextValue(candidate.title ?? candidate.label ?? candidate.name)
      if (!kind || !title) return null
      return {
        id: normalizeTextValue(candidate.id),
        title,
        kind,
        summary: normalizeTextValue(candidate.summary ?? candidate.description),
        fields: normalizeStringArray(candidate.fields ?? candidate.params ?? candidate.schema),
        targetNodeId: normalizeTextValue(candidate.targetNodeId ?? candidate.target_node_id),
        evidenceRefs: normalizeEvidenceRefs(
          candidate.evidenceRefs ?? candidate.evidence_refs ?? candidate.sources,
          fallbackSourceKind,
          fallbackLabel,
        ),
      }
    })
    .filter((contract): contract is PrdNodeBackendContractRef => Boolean(contract))
  return contracts.length ? contracts : undefined
}

function normalizeNodeSections(value: unknown, fallbackSourceKind: PrdNodeSourceKind, fallbackLabel: string): PrdNode['sections'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  const sections: PrdNode['sections'] = {}

  for (const key of ['data', 'interaction', 'view'] as const) {
    const raw = source[key]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const candidate = raw as Record<string, unknown>
    const title = normalizeTextValue(candidate.title ?? candidate.label)
    const summary = normalizeTextValue(candidate.summary ?? candidate.description)
    const content = normalizeTextValue(candidate.content ?? candidate.body ?? candidate.detail)
    const evidenceRefs = normalizeEvidenceRefs(candidate.evidenceRefs ?? candidate.evidence_refs ?? candidate.sources, fallbackSourceKind, fallbackLabel)
    const openQuestions = normalizeStringArray(candidate.openQuestions ?? candidate.open_questions ?? candidate.questions)
    if (!title && !summary && !content && !evidenceRefs.length && !openQuestions.length) continue
    sections[key] = {
      title,
      summary,
      content,
      evidenceRefs,
      openQuestions,
    }
  }

  return sections
}

function isTemplateDecompositionNode(node: PrdNode) {
  const text = [
    node.id,
    node.summary,
    node.content,
    node.techNotes,
    node.handoffGoal,
    node.qualityGate,
    node.extractedFrom,
  ].filter(Boolean).join('\n')

  return /原文标题「.+?」下的内容。/.test(text)
    || /本地标题骨架|本地兜底节点|标题骨架兜底/.test(text)
}

function extractRawNodeArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const candidate = raw as Record<string, unknown>
    if (Array.isArray(candidate.nodes)) return candidate.nodes
    if (Array.isArray(candidate.items)) return candidate.items
    if (candidate.tree && typeof candidate.tree === 'object' && Array.isArray((candidate.tree as Record<string, unknown>).nodes)) {
      return (candidate.tree as Record<string, unknown>).nodes as unknown[]
    }
  }
  return []
}

function normalizeDecompositionNodes(raw: unknown): PrdNode[] {
  const rawNodes = extractRawNodeArray(raw)
  if (!rawNodes.length) return []

  const seenIds = new Map<string, number>()
  const nodes = rawNodes
    .map((item: unknown, index: number) => {
      if (!item || typeof item !== 'object') return null
      const n = item as Record<string, unknown>

      const rawId = normalizeTextValue(n.id) ?? normalizeTextValue(n.nodeId) ?? normalizeTextValue(n.node_id) ?? `node-${index}`
      const duplicateCount = seenIds.get(rawId) ?? 0
      seenIds.set(rawId, duplicateCount + 1)
      const id = duplicateCount === 0 ? rawId : `${rawId}-${duplicateCount + 1}`
      const parentId = normalizeParentId(n.parentId ?? n.parent_id ?? n.parent)
      const label = normalizeTextValue(n.label ?? n.title ?? n.name) ?? `节点 ${id}`
      const summary = normalizeTextValue(n.summary ?? n.description) ?? ''
      const content = normalizeTextValue(n.content ?? n.body ?? n.detail) ?? summary
      const type = normalizeNodeType(n.type ?? n.nodeType ?? n.node_type)
      const status = normalizeNodeStatus(n.status, type === 'page' ? 'pending_refine' : 'pending')
      const level = normalizeNumberValue(n.level ?? n.depth, parentId ? 2 : 1)
      const order = normalizeNumberValue(n.order ?? n.sort ?? n.index, index)
      const needsPolish = normalizeBooleanValue(n.needsPolish ?? n.needs_polish, type === 'page' || type === 'ui')
      const extractedFrom = normalizeTextValue(n.extractedFrom ?? n.extracted_from ?? n.source ?? n.sourceRange) ?? null
      const techNotes = normalizeTextValue(n.techNotes ?? n.tech_notes ?? n.notes) ?? null
      const docPath = normalizeTextValue(n.docPath ?? n.doc_path ?? n.path ?? n.filePath ?? n.file_path) ?? (type === 'page' ? `pages/${id}.md` : null)
      const rawAudience = normalizeAudience(n.audience ?? n.targetAudience ?? n.target_audience ?? n.role)
      const rawSpecLens = normalizeSpecLensValue(n.specLens ?? n.spec_lens ?? n.lens ?? n.mvc ?? n.mvcLens ?? n.mvc_lens) ?? specLensFromLegacyAudience(rawAudience)
      const lensFields = normalizeNodeLensFields({ type, audience: rawAudience, specLens: rawSpecLens })
      const handoffGoal = normalizeTextValue(n.handoffGoal ?? n.handoff_goal ?? n.aiHandoff ?? n.ai_handoff) ?? null
      const qualityGate = normalizeTextValue(n.qualityGate ?? n.quality_gate ?? n.acceptanceGate ?? n.acceptance_gate) ?? null
      const references = normalizeNodeReferences(n.references ?? n.crossPageReferences ?? n.cross_page_references)
      const sourceKind = normalizeSourceKind(n.sourceKind ?? n.source_kind, 'prd')
      const evidenceRefs = normalizeEvidenceRefs(
        n.evidenceRefs ?? n.evidence_refs ?? n.sources,
        sourceKind,
        extractedFrom ?? 'PRD 原文',
      )
      const sections = normalizeNodeSections(n.sections ?? n.sectionDrafts ?? n.section_drafts ?? n.lenses, sourceKind, extractedFrom ?? 'PRD 原文')

      return {
        id, parentId, label, summary, content, type,
        status,
        level, order, needsPolish, techNotes,
        extractedFrom,
        docPath,
        audience: lensFields.audience,
        specLens: lensFields.specLens,
        sections,
        backendContracts: normalizeBackendContracts(n.backendContracts ?? n.backend_contracts ?? n.contracts, sourceKind, extractedFrom ?? 'PRD 原文'),
        handoffGoal, qualityGate,
        references,
        sourceKind,
        evidenceRefs,
        children: [] as string[],
      } as PrdNode
    })
    .filter((n): n is PrdNode => n !== null && !isTemplateDecompositionNode(n))

  // Build children arrays from parentId references
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  for (const node of nodes) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node.id)
    }
  }

  // Sort children by order
  for (const node of nodes) {
    node.children.sort((a, b) => (nodeMap.get(a)?.order ?? 0) - (nodeMap.get(b)?.order ?? 0))
  }

  // Warn if any node exceeds the supported prompt depth
  for (const node of nodes) {
    if (node.level > 4) console.warn(`[decompose] node ${node.id} at level ${node.level} — unexpectedly deep`)
  }

  return nodes
}

interface MarkdownHeading {
  rawLevel: number
  level: number
  title: string
  line: number
  id: string
  parentId: string | null
  order: number
  sectionText: string
}

function compactMarkdownTitle(title: string) {
  return title
    .replace(/^#+\s*/, '')
    .replace(/^\d+[\.\、\)]\s*/, '')
    .replace(/^[一二三四五六七八九十]+[、.]\s*/, '')
    .replace(/[：:]\s*$/, '')
    .trim()
}

function idSegmentFromTitle(title: string, fallback: string) {
  const ascii = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/_+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 20)
    .replace(/^-|-$/g, '')
    .toUpperCase()
  return ascii || fallback
}

function extractMarkdownHeadings(mdText: string): MarkdownHeading[] {
  const lines = mdText.split(/\r?\n/)
  const rawHeadings = lines
    .map((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
      if (!match) return null
      const title = compactMarkdownTitle(match[2])
      if (!title) return null
      return { rawLevel: match[1].length, title, line: index + 1 }
    })
    .filter((item): item is { rawLevel: number; title: string; line: number } => item !== null)

  if (!rawHeadings.length) return []

  const minLevel = Math.min(...rawHeadings.map((heading) => heading.rawLevel))
  const stack: MarkdownHeading[] = []
  const orderByParent = new Map<string, number>()

  return rawHeadings.map((heading, index) => {
    const nextRawHeading = rawHeadings[index + 1]
    const level = Math.min(4, Math.max(1, heading.rawLevel - minLevel + 1))
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()

    const parent = stack[stack.length - 1] ?? null
    const parentKey = parent?.id ?? 'root'
    const order = orderByParent.get(parentKey) ?? 0
    orderByParent.set(parentKey, order + 1)

    const id = `OUTLINE-${index + 1}-${idSegmentFromTitle(heading.title, String(index + 1))}`
    const startLine = heading.line
    const endLine = nextRawHeading ? nextRawHeading.line - 1 : lines.length
    const sectionText = lines.slice(startLine, endLine).join('\n').trim()
    const item: MarkdownHeading = {
      rawLevel: heading.rawLevel,
      level,
      title: heading.title,
      line: heading.line,
      id,
      parentId: parent?.id ?? null,
      order,
      sectionText,
    }
    stack.push(item)
    return item
  })
}

function estimateTextTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 2))
}

function compactExcerpt(text: string, maxLength = 180) {
  const excerpt = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter((line) => line && !/^\|?\s*[-:]{3,}/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return excerpt.length > maxLength ? `${excerpt.slice(0, maxLength)}...` : excerpt
}

function countPattern(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}

function countLinesMatching(text: string, pattern: RegExp) {
  return text.split(/\r?\n/).filter((line) => pattern.test(line)).length
}

const keywordSignalDefinitions: Array<{ category: DocumentKeywordSignal['category']; label: string; pattern: RegExp }> = [
  { category: 'pages', label: '页面/界面', pattern: /页面|界面|弹窗|面板|浮层|主界面|详情页|规则页|帮助页|排行榜|商城|背包|任务页|结算页/gu },
  { category: 'states', label: '状态/反馈', pattern: /状态|空状态|加载|Loading|成功|失败|完成|未完成|可领取|已领取|倒计时|冷却|禁用|置灰/gu },
  { category: 'rewards', label: '奖励/资源', pattern: /奖励|道具|金币|钻石|积分|经验|宝箱|货币|体力|奖池|领取/gu },
  { category: 'navigation', label: '入口/跳转', pattern: /入口|跳转|返回|关闭|打开|进入|退出|导航|路由|引导/gu },
  { category: 'apis', label: '接口/请求', pattern: /接口|API|endpoint|请求|响应|返回值|服务端|客户端|协议/giu },
  { category: 'configs', label: '配置/参数', pattern: /配置|参数|开关|阈值|概率|权重|字段|枚举|表格|数值/gu },
]

function buildSectionSignals(text: string) {
  return keywordSignalDefinitions
    .filter((definition) => countPattern(text, definition.pattern) > 0)
    .map((definition) => definition.label)
}

function buildKeywordSignals(mdText: string): DocumentKeywordSignal[] {
  return keywordSignalDefinitions
    .map((definition) => ({
      category: definition.category,
      label: definition.label,
      matches: countPattern(mdText, definition.pattern),
    }))
    .filter((signal) => signal.matches > 0)
    .sort((a, b) => b.matches - a.matches || a.label.localeCompare(b.label))
}

function markdownHeadingTitlePath(heading: MarkdownHeading, headingMap: Map<string, MarkdownHeading>) {
  const titles: string[] = []
  let current: MarkdownHeading | undefined = heading
  while (current) {
    titles.unshift(current.title)
    current = current.parentId ? headingMap.get(current.parentId) : undefined
  }
  return titles.join(' / ')
}

function makeDocumentSourceSection(
  id: string,
  title: string,
  titlePath: string,
  level: number,
  startLine: number,
  endLine: number,
  text: string,
): DocumentSourceSection {
  const normalizedText = text.trim()
  return {
    id,
    title,
    titlePath,
    level,
    startLine,
    endLine,
    charCount: normalizedText.length,
    estimatedTokens: estimateTextTokens(normalizedText),
    excerpt: compactExcerpt(normalizedText),
    signals: buildSectionSignals(`${title}\n${titlePath}\n${normalizedText}`),
  }
}

function buildDocumentSourceSections(mdText: string) {
  const lines = mdText.split(/\r?\n/)
  const headings = extractMarkdownHeadings(mdText)

  if (!headings.length) {
    return splitLongSectionLines(lines, 1, LARGE_PRD_SLICE_TARGET_LENGTH).map((slice, index) =>
      makeDocumentSourceSection(
        `SRC-${String(index + 1).padStart(3, '0')}`,
        `全文片段 ${index + 1}`,
        `全文片段 ${index + 1}`,
        1,
        slice.startLine,
        slice.endLine,
        slice.text,
      )
    )
  }

  const headingMap = new Map(headings.map((heading) => [heading.id, heading]))
  return headings
    .map((heading, index) => {
      const nextHeading = headings[index + 1]
      const endLine = nextHeading ? nextHeading.line - 1 : lines.length
      return makeDocumentSourceSection(
        `SRC-${String(index + 1).padStart(3, '0')}`,
        heading.title,
        markdownHeadingTitlePath(heading, headingMap),
        heading.level,
        heading.line,
        endLine,
        lines.slice(heading.line - 1, endLine).join('\n'),
      )
    })
    .filter((section) => section.charCount > 0)
}

function buildDocumentSourceIssues(mdText: string, sections: DocumentSourceSection[], headingCount: number): DocumentSourceIssue[] {
  const issues: DocumentSourceIssue[] = []
  const imageRefs = countPattern(mdText, /!\[[^\]]*\]\([^)]+\)|\.(png|jpe?g|webp|gif)\b/giu)
  const tableLines = countLinesMatching(mdText, /^\s*\|.+\|\s*$/)
  const largest = sections.reduce<DocumentSourceSection | null>(
    (current, section) => (!current || section.charCount > current.charCount ? section : current),
    null,
  )

  if (!headingCount) {
    issues.push({
      id: 'no-markdown-headings',
      severity: 'warning',
      title: '缺少 Markdown 标题',
      detail: '系统会按长度切片建立索引，页面边界更依赖正文线索，建议确认结构预览后再拆解。',
      sectionId: null,
    })
  }

  if (mdText.length >= LARGE_PRD_DECOMPOSE_THRESHOLD) {
    issues.push({
      id: 'large-document',
      severity: 'info',
      title: '大 PRD 分段分析',
      detail: `文档超过 ${Math.round(LARGE_PRD_DECOMPOSE_THRESHOLD / 1024)}KB，正式拆解会分段识别页面线索后归并。`,
      sectionId: null,
    })
  }

  if (largest && largest.charCount > LARGE_PRD_SLICE_TARGET_LENGTH) {
    issues.push({
      id: 'large-section',
      severity: 'warning',
      title: '存在超长章节',
      detail: `「${largest.titlePath}」约 ${largest.charCount} 字符，后续会切成多个片段，建议检查该章节是否包含多个页面。`,
      sectionId: largest.id,
    })
  }

  if (headingCount > 120) {
    issues.push({
      id: 'many-headings',
      severity: 'info',
      title: '标题数量较多',
      detail: `检测到 ${headingCount} 个标题，预览只展示关键线索，正式导图仍会以页面/弹窗为单位归并。`,
      sectionId: null,
    })
  }

  if (tableLines > 12) {
    issues.push({
      id: 'table-heavy',
      severity: 'info',
      title: '表格内容较多',
      detail: `检测到约 ${tableLines} 行表格，字段/配置更可能进入 model 子节点而不是页面节点。`,
      sectionId: null,
    })
  }

  if (imageRefs > 0) {
    issues.push({
      id: 'image-references',
      severity: 'warning',
      title: '包含图片引用',
      detail: `检测到 ${imageRefs} 处图片引用。当前导入只读取 Markdown 文本，图片细节需要后续在 Deep Forge 中补充。`,
      sectionId: null,
    })
  }

  if (mdText.trim().length < 500) {
    issues.push({
      id: 'short-document',
      severity: 'warning',
      title: '文档内容较短',
      detail: '可读文本较少，AI 可能只能生成少量页面节点，建议确认 PRD 是否完整。',
      sectionId: null,
    })
  }

  return issues
}

function buildDocumentSourceIndex(mdText: string): DocumentSourceIndex {
  const lines = mdText.split(/\r?\n/)
  const headings = extractMarkdownHeadings(mdText)
  const sections = buildDocumentSourceSections(mdText)
  const largestSectionChars = sections.reduce((max, section) => Math.max(max, section.charCount), 0)

  return {
    sourceLabel: '上传 PRD',
    totalLines: lines.length,
    totalChars: mdText.length,
    estimatedTokens: estimateTextTokens(mdText),
    headingCount: headings.length,
    sectionCount: sections.length,
    largestSectionChars,
    sections,
    keywordSignals: buildKeywordSignals(mdText),
    issues: buildDocumentSourceIssues(mdText, sections, headings.length),
  }
}

const candidatePageTitlePattern = /页面|界面|弹窗|面板|浮层|主界面|详情页|规则页|帮助页|排行榜|商城|背包|任务页|结算页|活动页|入口/iu
const candidateContentPattern = /入口|跳转|打开|关闭|展示|按钮|列表|弹窗|页面|界面|空状态|倒计时|领取|返回|结算/giu

function candidateKey(title: string) {
  return title.replace(/[\s《》「」【】\[\]（）()：:，,。.!！?？\-_/\\]/g, '').toLowerCase()
}

function buildCandidateNodesFromIndex(sourceIndex: DocumentSourceIndex): PrdImportCandidateNode[] {
  const candidates = new Map<string, PrdImportCandidateNode>()

  for (const section of sourceIndex.sections) {
    const text = `${section.title}\n${section.titlePath}\n${section.excerpt}`
    const titleHit = candidatePageTitlePattern.test(section.title) || candidatePageTitlePattern.test(section.titlePath)
    const contentHits = countPattern(text, candidateContentPattern)
    const hasPageSignal = section.signals.includes('页面/界面')
    if (!titleHit && !hasPageSignal && contentHits < 2) continue

    const title = compactMarkdownTitle(section.title).slice(0, 24) || `页面线索 ${candidates.size + 1}`
    const key = candidateKey(title)
    if (!key || candidates.has(key)) continue

    const confidence = Math.min(95, 48 + (titleHit ? 24 : 0) + (hasPageSignal ? 16 : 0) + Math.min(contentHits * 4, 16))
    const reasonParts = [
      titleHit ? '标题包含页面/界面线索' : null,
      hasPageSignal ? '正文出现页面级信号' : null,
      contentHits > 0 ? `命中 ${contentHits} 个交互词` : null,
    ].filter(Boolean)

    candidates.set(key, {
      title,
      sectionId: section.id,
      sourceLabel: `${section.titlePath}（第 ${section.startLine}-${section.endLine} 行）`,
      reason: reasonParts.join('；') || '正文出现交互结构线索',
      confidence,
      excerpt: section.excerpt,
    })
  }

  return [...candidates.values()]
    .sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title))
    .slice(0, 12)
}

function buildPrdImportPreview(mdText: string): PrdImportPreview {
  const sourceIndex = buildDocumentSourceIndex(mdText)
  return {
    sourceIndex,
    candidateNodes: buildCandidateNodesFromIndex(sourceIndex),
  }
}

function buildSourceOutlineForPrompt(mdText: string) {
  const headings = extractMarkdownHeadings(mdText)
  if (!headings.length) {
    const sourceIndex = buildDocumentSourceIndex(mdText)
    const sections = sourceIndex.sections.slice(0, 20).map((section) => (
      `- ${section.id}：第 ${section.startLine}-${section.endLine} 行，约 ${section.charCount} 字符`
    ))
    return `原文没有明显 Markdown 标题，已按长度建立 ${sourceIndex.sectionCount} 个索引片段。请直接通读相关片段后按方法论拆分，不要创建“标题骨架”兜底节点。\n${sections.join('\n')}`
  }

  const lines = headings.slice(0, 80).map((heading) => {
    const indent = '  '.repeat(Math.max(0, heading.level - 1))
    return `${indent}- 第 ${heading.line} 行：${heading.title}`
  })
  const omitted = headings.length > 80 ? `\n- 还有 ${headings.length - 80} 个标题未列出，请以完整 PRD 原文为准。` : ''
  return `${lines.join('\n')}${omitted}`
}

function buildSourceOutlineRootNode(mdText: string, sourceIndex = buildDocumentSourceIndex(mdText)): PrdNode {
  const headings = extractMarkdownHeadings(mdText)
  const content = headings.length
    ? headings.map((heading) => `${'  '.repeat(Math.max(0, heading.level - 1))}- 第 ${heading.line} 行：${heading.title}`).join('\n')
    : '原文没有明显 Markdown 标题。后续页面节点仍必须由 AI 根据原文内容识别，不能使用本地标题生成假节点。'
  const issueSummary = sourceIndex.issues.length
    ? sourceIndex.issues.map((issue) => `- ${issue.title}：${issue.detail}`).join('\n')
    : '- 未发现明显导入风险。'
  const signalSummary = sourceIndex.keywordSignals.length
    ? sourceIndex.keywordSignals.slice(0, 8).map((signal) => `- ${signal.label}：${signal.matches} 次`).join('\n')
    : '- 未命中明显主题信号。'

  return {
    id: SOURCE_OUTLINE_ROOT_ID,
    parentId: null,
    label: 'PRD 原文目录',
    summary: headings.length
      ? `原文包含 ${headings.length} 个 Markdown 标题、${sourceIndex.sectionCount} 个索引片段，页面节点均应回溯到这些原文位置。`
      : `原文没有明显 Markdown 标题，已建立 ${sourceIndex.sectionCount} 个索引片段供页面节点回溯。`,
    content: `## 原文目录\n\n${content}\n\n## 导入索引\n\n- 总行数：${sourceIndex.totalLines}\n- 估算 token：${sourceIndex.estimatedTokens}\n- 索引片段：${sourceIndex.sectionCount}\n- 最大片段：${sourceIndex.largestSectionChars} 字符\n\n## 主题信号\n\n${signalSummary}\n\n## 导入风险\n\n${issueSummary}`,
    type: 'module',
    status: 'pending',
    level: 0,
    order: 0,
    needsPolish: false,
    extractedFrom: '原文 Markdown 标题',
    techNotes: null,
    children: [],
    docPath: null,
    audience: 'overview',
    handoffGoal: '作为导图根节点，帮助后续 AI 和用户从原文标题回溯页面拆解依据。',
    qualityGate: '只承载原文标题索引，不作为 AI 伪造页面节点的依据。',
    references: [],
  }
}

function attachPagesToSourceRoot(nodes: PrdNode[]) {
  return nodes.map((node, order): PrdNode => ({
    ...node,
    parentId: SOURCE_OUTLINE_ROOT_ID,
    type: 'page',
    status: 'pending_refine',
    level: 1,
    order,
    needsPolish: true,
    docPath: null,
    children: [],
  }))
}

function pageDocPathSegment(node: PrdNode) {
  return sanitizeDocPathSegment(`${sanitizeNodeId(node.id)}-${sanitizeLabel(node.label)}`)
}

interface PrdSourceSlice {
  label: string
  text: string
  startLine: number
  endLine: number
}

function pushPrdSourceSlice(slices: PrdSourceSlice[], lines: string[], startLine: number) {
  const text = lines.join('\n').trim()
  if (!text) return
  slices.push({
    label: `第 ${startLine}-${startLine + lines.length - 1} 行`,
    text,
    startLine,
    endLine: startLine + lines.length - 1,
  })
}

function splitLongSectionLines(lines: string[], startLine: number, targetLength: number) {
  const slices: PrdSourceSlice[] = []
  let current: string[] = []
  let currentStart = startLine
  let currentLength = 0

  lines.forEach((line, index) => {
    if (current.length && currentLength + line.length > targetLength) {
      pushPrdSourceSlice(slices, current, currentStart)
      current = []
      currentStart = startLine + index
      currentLength = 0
    }
    current.push(line)
    currentLength += line.length + 1
  })

  pushPrdSourceSlice(slices, current, currentStart)
  return slices
}

function buildPrdSourceSlices(mdText: string) {
  const lines = mdText.split(/\r?\n/)
  const headings = extractMarkdownHeadings(mdText)
  if (!headings.length) return splitLongSectionLines(lines, 1, LARGE_PRD_SLICE_TARGET_LENGTH)

  const sections = headings.map((heading, index) => {
    const nextHeading = headings[index + 1]
    const endLine = nextHeading ? nextHeading.line - 1 : lines.length
    return {
      label: `${heading.title}（第 ${heading.line}-${endLine} 行）`,
      startLine: heading.line,
      endLine,
      text: lines.slice(heading.line - 1, endLine).join('\n').trim(),
    }
  }).filter((section) => section.text)

  const slices: PrdSourceSlice[] = []
  let current: PrdSourceSlice[] = []
  let currentLength = 0

  const flush = () => {
    if (!current.length) return
    const startLine = current[0].startLine
    const endLine = current[current.length - 1].endLine
    const labels = current.map((section) => section.label).join('；')
    slices.push({
      label: `${labels}（第 ${startLine}-${endLine} 行）`,
      text: current.map((section) => section.text).join('\n\n'),
      startLine,
      endLine,
    })
    current = []
    currentLength = 0
  }

  for (const section of sections) {
    if (section.text.length > LARGE_PRD_SLICE_TARGET_LENGTH) {
      flush()
      slices.push(...splitLongSectionLines(section.text.split(/\r?\n/), section.startLine, LARGE_PRD_SLICE_TARGET_LENGTH))
      continue
    }
    if (current.length && currentLength + section.text.length > LARGE_PRD_SLICE_TARGET_LENGTH) flush()
    current.push(section)
    currentLength += section.text.length + 2
  }

  flush()
  return slices
}

function normalizedNodeMergeKey(node: PrdNode) {
  return node.label
    .replace(/[\s《》「」【】\[\]（）()：:，,。.!！?？\-_/\\]/g, '')
    .toLowerCase()
}

function mergeTextValues(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? null
}

function mergeLargePrdCandidates(candidates: PrdNode[]) {
  const merged = new Map<string, PrdNode>()

  for (const node of candidates) {
    const key = normalizedNodeMergeKey(node)
    if (!key) continue
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        ...node,
        parentId: null,
        level: 1,
        docPath: null,
        children: [],
        references: node.references ?? [],
      })
      continue
    }

    merged.set(key, {
      ...existing,
      summary: existing.summary.length >= node.summary.length ? existing.summary : node.summary,
      content: existing.content.length >= node.content.length ? existing.content : node.content,
      extractedFrom: [existing.extractedFrom, node.extractedFrom].filter(Boolean).join('；') || null,
      techNotes: mergeTextValues(existing.techNotes, node.techNotes),
      audience: existing.audience ?? node.audience,
      handoffGoal: mergeTextValues(existing.handoffGoal, node.handoffGoal),
      qualityGate: mergeTextValues(existing.qualityGate, node.qualityGate),
      references: [...(existing.references ?? []), ...(node.references ?? [])],
    })
  }

  return attachPagesToSourceRoot([...merged.values()].slice(0, 8).map((node, order) => ({
    ...node,
    id: `PAGE-${String(order + 1).padStart(2, '0')}-${idSegmentFromTitle(node.label, String(order + 1))}`,
    parentId: null,
    type: 'page' as const,
    status: 'pending_refine' as const,
    level: 1,
    order,
    needsPolish: true,
    docPath: null,
    children: [],
  })))
}

async function decomposeLargeL1(mdText: string, session: DecompositionSession, claude: Anthropic) {
  const slices = buildPrdSourceSlices(mdText)
  const candidates: PrdNode[] = []

  for (const [index, slice] of slices.entries()) {
    const response = await withDecompositionProgress(session, '正在通读原文并建立结构', () =>
      claude.messages.create({
        model,
        max_tokens: 2200,
        system: decompositionL1SystemPrompt,
        tools: [decomposePrdTopLevelTool],
        tool_choice: { type: 'tool', name: 'decompose_prd' },
        messages: [
          {
            role: 'user',
            content: `请从下面这段 PRD 原文中识别页面/界面/弹窗级候选节点。本段只是原文的一部分，只输出本段有明确依据的候选；不要补全没出现的信息，不要输出按钮、字段、奖励条目等内部细节节点。每个节点正文必须很短，只写覆盖范围、关键依据、职责边界和需澄清点。所有展示给用户的文字必须是中文；ID、路径、字段名、枚举值可以保留英文。\n\n原文位置：${slice.label}\n原文阅读进度：${index + 1}/${slices.length}\n\nPRD 原文：\n${slice.text}`,
          },
        ],
      })
    )

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'decompose_prd'
    )
    if (!toolUse) continue

    const raw = (toolUse.input as { nodes?: unknown }).nodes ?? toolUse.input
    candidates.push(...normalizeDecompositionNodes(raw).map((node) => ({
      ...node,
      extractedFrom: node.extractedFrom ?? slice.label,
    })))
  }

  return withDecompositionProgress(session, '正在归并页面线索', async () => mergeLargePrdCandidates(candidates))
}

function sectionTextForHeading(mdText: string, heading: MarkdownHeading, headings: MarkdownHeading[]) {
  const lines = mdText.split(/\r?\n/)
  const nextPeer = headings.find((item) => item.line > heading.line && item.rawLevel <= heading.rawLevel)
  const endLineExclusive = nextPeer ? nextPeer.line - 1 : lines.length
  return lines.slice(heading.line - 1, endLineExclusive).join('\n').trim()
}

function extractRelevantMarkdownForNode(mdText: string, node: PrdNode) {
  const headings = extractMarkdownHeadings(mdText)
  if (!headings.length) return mdText

  const refText = [node.extractedFrom, node.label, node.summary].filter(Boolean).join('\n')
  const lineRefs = [...refText.matchAll(/第\s*(\d+)\s*行/g)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((line) => Number.isFinite(line))

  for (const line of lineRefs) {
    const heading = [...headings].reverse().find((item) => item.line <= line)
    if (heading) {
      const section = sectionTextForHeading(mdText, heading, headings)
      if (section.length > 80) return section
    }
  }

  const titleMatch = headings.find((heading) =>
    refText.includes(heading.title) || heading.title.includes(node.label) || node.label.includes(heading.title)
  )
  if (titleMatch) {
    const section = sectionTextForHeading(mdText, titleMatch, headings)
    if (section.length > 80) return section
  }

  return mdText
}

function rebuildNodeChildren(nodes: PrdNode[]): PrdNode[] {
  const nodeMap = new Map<string, PrdNode>()
  for (const node of nodes) {
    nodeMap.set(node.id, { ...node, children: [] })
  }

  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node.id)
    }
  }

  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => (nodeMap.get(a)?.order ?? 0) - (nodeMap.get(b)?.order ?? 0))
  }

  return [...nodeMap.values()].sort((a, b) => a.level - b.level || a.order - b.order || a.id.localeCompare(b.id))
}

function mergeSessionNodes(session: DecompositionSession, nodes: PrdNode[]) {
  const merged = new Map<string, PrdNode>()
  for (const node of session.nodes) merged.set(node.id, node)
  for (const node of nodes) merged.set(node.id, node)
  session.nodes = rebuildNodeChildren([...merged.values()])
}

function appendBranchErrorNote(session: DecompositionSession, pageNode: PrdNode, errorMessage: string) {
  const warning = `「${pageNode.label}」MVC 子节点展开失败：${errorMessage}`
  session.branchErrors = [...(session.branchErrors ?? []), warning]
  session.error = `部分 MVC 子节点展开失败，但已保留可用导图：${session.branchErrors.join('；')}`

  const pageWarning = `\n\n## 自动拆解提示\n${warning}\n已保留页面级节点，可稍后在导图中手动补充或重新打磨该分支。`
  mergeSessionNodes(session, [{
    ...pageNode,
    content: pageNode.content.includes(warning) ? pageNode.content : `${pageNode.content}${pageWarning}`,
    techNotes: [pageNode.techNotes, warning].filter(Boolean).join('\n'),
  }])
}

function buildPageSectionsFromLensNodes(nodes: PrdNode[]): PrdNode['sections'] {
  const sections: PrdNode['sections'] = {}
  for (const node of nodes) {
    const key = normalizeSectionKeyForLens(resolveNodeSpecLens(node))
    if (!key) continue
    sections[key] = {
      title: node.label,
      summary: node.summary,
      content: node.content,
      evidenceRefs: node.evidenceRefs ?? [],
      openQuestions: [],
    }
  }
  return sections
}

async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let nextIndex = 0
  const workerCount = Math.min(limit, items.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await task(item)
    }
  }))
}

function waitSecondsFromStep(step: string, label: string) {
  if (!step.startsWith(label)) return 0
  const match = /已等待\s+(\d+)\s+秒/.exec(step)
  return match ? Number.parseInt(match[1], 10) : 0
}

async function withDecompositionProgress<T>(
  session: DecompositionSession,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  session.currentStep = label
  const heartbeat = setInterval(() => {
    if (session.status === 'running') {
      const elapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000))
      const currentWait = waitSecondsFromStep(session.currentStep, label)
      if (elapsed >= currentWait) {
        session.currentStep = `${label}（已等待 ${elapsed} 秒，AI 正在分析原文）`
      }
    }
  }, DECOMPOSITION_HEARTBEAT_MS)
  let timeout: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label}超过 ${Math.round(DECOMPOSITION_CALL_TIMEOUT_MS / 1000)} 秒仍未返回，请检查模型服务或缩小 PRD 范围后重试。`))
        }, DECOMPOSITION_CALL_TIMEOUT_MS)
      }),
    ])
  } finally {
    clearInterval(heartbeat)
    if (timeout) clearTimeout(timeout)
  }
}

const decompositionL1SystemPrompt = `你是游戏 UX 架构师，正在分析一份产品需求文档（PRD）。
	任务：识别这份 PRD 中玩家实际会看到、且适合逐个打磨的页面/界面/弹窗节点。
	不要把按钮、字段、奖励条目、动画帧或规则段落单独拆成页面节点；这些内部细节必须放入所属页面节点的 content，并在后续 MVC 子节点中展开。
	优先输出主界面、规则页、帮助页、排行榜、商城页、任务页、结算页、活动详情页、弹窗等页面级节点；只输出原文中确实存在或强烈暗示的页面。
	如果内容涉及页面跳转，源页面只记录入口和跳转关系，目标页面记录完整页面内容；跨页面关系写入 references，不要复制全文。
	每个页面节点 type 必须为 page，status 必须为 pending_refine，needsPolish 必须为 true，docPath 必须为 null。
	content 必须按“原文位置、关键原文摘录、整理说明、需澄清点”组织；引用原文时摘取关键短句，不要脱离原文改写成泛泛总结。
	本轮只返回页面级节点，parentId 可为 null，系统会挂到 PRD 原文目录根节点下；除非原文明确存在父子页面关系，不要制造多层树。
	必须通过工具返回非空 nodes 数组。通常 2-8 个，最多 8 个。
	所有 label、summary、content、techNotes、handoffGoal、qualityGate 必须使用中文；ID、docPath、字段名、枚举值可以使用英文。
	每个页面范围必须清晰、互不重叠。`

function decompositionBranchSystemPrompt(parentLabel: string, parentId: string): string {
  return `你正在展开 PRD 页面节点。
待展开页面：「${parentLabel}」
任务：只生成该页面下有原文依据的 MVC 子节点。

MVC 拆分规则：
- model：页面依赖的数据字段、领域状态、配置、规则参数、存储或依赖数据。判断标准：原文事实回答“页面显示/判断需要哪些数据”。
- ctrl：用户操作、控制流程、跳转、接口调用、校验、业务逻辑、状态流转。判断标准：原文事实回答“用户操作或系统事件触发后发生什么”。
- view：页面布局、视觉层级、控件呈现、文案、动画、状态反馈。判断标准：原文事实回答“用户在屏幕上看到什么样子”。

严禁只因为出现“状态、交互、控件、接口、规则、UI”等关键词就归类；必须先抽取原文事实，再按事实维度归入 model/ctrl/view。
状态反馈、按钮置灰、Loading、空状态等用户可见呈现通常是 view；状态流转、校验、请求响应才是 ctrl；配置、数值、领取状态等领域数据才是 model。
只输出原文明确涉及的类别；不要为了凑齐 model/ctrl/view 而输出空节点或占位节点。
每个子节点 sourceKind 必须为 prd；evidenceRefs 必须引用真实原文标题或短句，不得编造原文证据。
每个子节点 parentId 必须为 "${parentId}"，level 必须为 2。
每个子节点 content 必须按以下结构输出：
## 原文位置
写章节名、标题或行号范围。
## 关键原文摘录
摘取相关原文短句，不要自行扩写。
## 整理说明
把摘录整理成可执行需求。
## 需澄清点
只列原文模糊或缺失的信息；没有则写“无”。

docPath 使用 pages/<page-slug>/model.md、pages/<page-slug>/ctrl.md 或 pages/<page-slug>/view.md。
所有 label、summary、content、techNotes、handoffGoal、qualityGate 和 content 内部 Markdown 标题必须使用中文；model、ctrl、view、ID、docPath、字段名、枚举值可以保留英文。`
}

async function decomposeL1(mdText: string, session: DecompositionSession): Promise<PrdNode[]> {
  if (!anthropic) throw new Error('Anthropic 客户端未初始化，请检查 ANTHROPIC_API_KEY')
  const claude = anthropic
  if (mdText.length >= LARGE_PRD_DECOMPOSE_THRESHOLD) return decomposeLargeL1(mdText, session, claude)
  const sourceOutline = buildSourceOutlineForPrompt(mdText)

  async function requestTopLevel(label: string, retry: boolean) {
    const retryInstruction = retry
      ? '上一轮页面级拆分返回了空数组，这是无效结果。请重新通读标题参考和原文，必须返回 2-8 个真实页面/界面节点；如果 PRD 很短，也至少输出一个最核心页面和一个规则/帮助/结算等页面。'
      : '请把下面 PRD 拆解为页面级思维导图节点。'

    const response = await withDecompositionProgress(session, label, () =>
      claude.messages.create({
        model,
        max_tokens: 4000,
        system: decompositionL1SystemPrompt,
        tools: [decomposePrdTopLevelTool],
        tool_choice: { type: 'tool', name: 'decompose_prd' },
        messages: [
          {
            role: 'user',
            content: `${retryInstruction} 本次只输出页面/界面/弹窗级节点，type 必须为 page，status 必须为 pending_refine，needsPolish 必须为 true。不要输出按钮、字段、奖励条目等内部细节节点；这些内容应写入所属页面的 content。拆分目标是后续以单个页面为单位逐个打磨。所有展示给用户的文字必须是中文，包括节点标题、摘要、正文、接力目标、质量门槛；只有 ID、路径、字段名、枚举值可以保留英文。跨页面关系写入 references，不要重复复制全文。\n\n原文标题参考（只作为定位线索，不是输出模板）：\n${sourceOutline}\n\n完整 PRD 原文：\n${mdText}`,
          },
        ],
      })
    )

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'decompose_prd'
    )
    if (!toolUse) throw new Error('Claude 未返回导图节点分析结果')

    const raw = (toolUse.input as { nodes?: unknown }).nodes ?? toolUse.input
    return {
      nodes: normalizeDecompositionNodes(raw),
      stopReason: response.stop_reason,
    }
  }

  const first = await requestTopLevel('正在通读原文并建立结构', false)
  if (first.nodes.length > 0) return attachPagesToSourceRoot(first.nodes)
  if (first.stopReason === 'max_tokens') {
    throw new Error('AI 生成导图节点时输出过长并被截断。请重试，或缩小 PRD 范围后再导入。')
  }

  const retry = await requestTopLevel('正在生成导图节点', true)
  if (!retry.nodes.length && retry.stopReason === 'max_tokens') {
    throw new Error('AI 生成导图节点时输出过长并被截断。请重试，或缩小 PRD 范围后再导入。')
  }
  return attachPagesToSourceRoot(retry.nodes)
}

async function decomposeBranch(mdText: string, parentNode: PrdNode, session: DecompositionSession): Promise<PrdNode[]> {
  if (!anthropic) throw new Error('Anthropic 客户端未初始化，请检查 ANTHROPIC_API_KEY')
  const claude = anthropic
  const branchContext = extractRelevantMarkdownForNode(mdText, parentNode)
  const sourceOutline = buildSourceOutlineForPrompt(branchContext)

  async function requestBranch(label: string, retry: boolean) {
    const retryInstruction = retry
      ? `上一轮「${parentNode.label}」没有返回有原文依据的 MVC 子节点。请重新检查相关原文；如果确实没有 model、ctrl 或 view 信息，可以返回空数组。`
      : `请把「${parentNode.label}」展开为有原文依据的 MVC 子节点。`

    const response = await withDecompositionProgress(session, label, () =>
      claude.messages.create({
        model,
        max_tokens: 8000,
        system: decompositionBranchSystemPrompt(parentNode.label, parentNode.id),
        tools: [decomposePrdTool],
        tool_choice: { type: 'tool', name: 'decompose_prd' },
        messages: [
          {
            role: 'user',
            content: `${retryInstruction} 只输出有原文依据的 model、ctrl、view 子节点；缺失的 MVC 类别不要输出空节点或占位节点。分类必须基于原文事实维度：数据/配置/规则/领域状态归 model，操作流程/接口/校验/状态流转归 ctrl，布局/文案/动画/视觉反馈归 view；禁止按关键词机械归类。每个返回节点 parentId 必须为 "${parentNode.id}"，level 必须为 2，sourceKind 必须为 prd，evidenceRefs 必须引用真实原文，content 必须包含“原文位置 / 关键原文摘录 / 整理说明 / 需澄清点”。所有展示给用户的文字必须是中文；model、ctrl、view、ID、路径、字段名、枚举值可以保留英文。不要输出模板化标题说明，content 必须是你对原文相关内容的引用+整理。\n\n原文标题参考（只作为定位线索，不是输出模板）：\n${sourceOutline}\n\n相关 PRD 原文片段：\n${branchContext}`,
          },
        ],
      })
    )

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'decompose_prd'
    )
    if (!toolUse) throw new Error(`Claude 未返回分支拆解结果：${parentNode.id}`)

    const raw = (toolUse.input as { nodes?: unknown }).nodes ?? toolUse.input
    const pageSegment = pageDocPathSegment(parentNode)
    const lensNodes = normalizeDecompositionNodes(raw)
      .filter((node) => ['model', 'control', 'view'].includes(resolveNodeSpecLens(node)))
      .map((node, index): PrdNode => {
        const lens = resolveNodeSpecLens(node)
        const pathSegment = lens === 'control' ? 'ctrl' : lens
        return {
          ...node,
          id: `${parentNode.id}-${pathSegment.toUpperCase()}`,
          parentId: parentNode.id,
          type: lens === 'view' ? 'ui' : 'feature',
          status: 'pending_refine',
          level: 2,
          order: index,
          needsPolish: true,
          docPath: `pages/${pageSegment}/${pathSegment}.md`,
          audience: normalizeLegacyAudience(node.audience) ?? defaultAudienceForSpecLens(lens),
          specLens: lens,
          sourceKind: 'prd',
          children: [],
        }
      })
    const sections = buildPageSectionsFromLensNodes(lensNodes)
    const pageUpdate = Object.keys(sections ?? {}).length
      ? normalizeNodeLensFields({
          ...parentNode,
          sections: {
            ...(parentNode.sections ?? {}),
            ...sections,
          },
          specLens: 'full',
        })
      : null
    return {
      nodes: pageUpdate ? [pageUpdate] : [],
      stopReason: response.stop_reason,
    }
  }

  const first = await requestBranch('正在展开 MVC 子节点', false)
  if (first.nodes.length > 0) return first.nodes
  if (first.stopReason === 'max_tokens') {
    throw new Error(`AI 展开「${parentNode.label}」时输出过长并被截断。请重试，或缩小 PRD 范围后再导入。`)
  }

  const retry = await requestBranch('正在重新校验文档包分支', true)
  if (!retry.nodes.length && retry.stopReason === 'max_tokens') {
    throw new Error(`AI 展开「${parentNode.label}」时输出过长并被截断。请重试，或缩小 PRD 范围后再导入。`)
  }
  return retry.nodes
}

async function runMockDecompositionJob(sessionId: string): Promise<void> {
  const session = decompositionSessions.get(sessionId)
  if (!session) return

  const mockSteps = [
    { step: '正在生成导图节点', delay: 800 },
  ]

  const mockNodes: PrdNode[] = [
    buildSourceOutlineRootNode('# 示例 PRD\n\n## 主界面\n\n## 规则页\n\n## 排行榜'),
    { id: 'PAGE-MAIN', parentId: SOURCE_OUTLINE_ROOT_ID, label: '主界面', summary: '活动入口、倒计时、核心状态与页面跳转。', content: '## 原文位置\n示例 PRD\n\n## 关键原文摘录\n“展示活动入口、倒计时、当前积分和关键操作。”\n\n## 整理说明\n主界面承载活动入口与关键状态展示。\n\n## 需澄清点\n需确认主按钮状态与空状态。', type: 'page', status: 'pending_refine', level: 1, order: 0, needsPolish: true, extractedFrom: '示例 PRD', techNotes: null, children: [], docPath: null, audience: 'client', handoffGoal: '打磨主界面交互设计规格。', qualityGate: '入口、状态、跳转和验收点清晰。', references: [{ targetNodeId: 'PAGE-RANK', label: '排行榜入口', reason: '主界面点击进入排行榜页', sourceNodeId: 'PAGE-MAIN' }] },
    { id: 'PAGE-MAIN-VIEW', parentId: 'PAGE-MAIN', label: '主界面 View', summary: '主界面的布局、入口和状态展示。', content: '## 原文位置\n示例 PRD\n\n## 关键原文摘录\n“展示活动入口、倒计时、当前积分和关键操作。”\n\n## 整理说明\n需要呈现活动入口、倒计时、积分与关键操作控件。\n\n## 需澄清点\n需确认空状态。', type: 'ui', status: 'pending_refine', level: 2, order: 0, needsPolish: true, extractedFrom: '示例 PRD', techNotes: null, children: [], docPath: 'pages/PAGE-MAIN/view.md', audience: 'client', handoffGoal: '打磨主界面 View 规格。', qualityGate: '原文摘录、布局状态和待确认点清晰。', references: [] },
    { id: 'PAGE-RULES', parentId: SOURCE_OUTLINE_ROOT_ID, label: '规则页', summary: '活动规则、积分规则和奖励说明。', content: '## 原文位置\n示例 PRD\n\n## 关键原文摘录\n“说明活动玩法、积分获取和奖励规则。”\n\n## 整理说明\n规则页承载玩法、积分与奖励说明。\n\n## 需澄清点\n需确认规则文本是否需要分段折叠。', type: 'page', status: 'pending_refine', level: 1, order: 1, needsPolish: true, extractedFrom: '示例 PRD', techNotes: null, children: [], docPath: null, audience: 'client', handoffGoal: '打磨规则页说明和交互规格。', qualityGate: '规则文案、入口和返回行为清晰。', references: [] },
    { id: 'PAGE-RANK', parentId: SOURCE_OUTLINE_ROOT_ID, label: '排行榜', summary: '榜单展示、排名规则和奖励领取说明。', content: '## 原文位置\n示例 PRD\n\n## 关键原文摘录\n“展示玩家排行、排名变化和奖励状态。”\n\n## 整理说明\n排行榜页面承载排名展示和奖励状态。\n\n## 需澄清点\n需确认榜单刷新频率和未上榜状态。', type: 'page', status: 'pending_refine', level: 1, order: 2, needsPolish: true, extractedFrom: '示例 PRD', techNotes: null, children: [], docPath: null, audience: 'client', handoffGoal: '打磨排行榜页面交互设计规格。', qualityGate: '榜单字段、状态和跳转来源清晰。', references: [] },
  ]

  for (const { step, delay } of mockSteps) {
    session.currentStep = step
    await new Promise((r) => setTimeout(r, delay))
    // Push nodes that belong to this step
    const pushed = step === '正在生成导图节点' ? mockNodes : []
    mergeSessionNodes(session, pushed.filter((n) => !session.nodes.find((e) => e.id === n.id)))
  }

  session.status = 'done'
  session.currentStep = '分析完成'
  scheduleSessionCleanup(sessionId)
}

async function runDecompositionJob(sessionId: string, mdText: string): Promise<void> {
  const session = decompositionSessions.get(sessionId)
  if (!session) return
  const activeSession = session

  activeSession.currentStep = '正在建立原文索引'
  activeSession.nodes = []
  const sourceIndex = buildDocumentSourceIndex(mdText)
  const sourceOutlineRoot = buildSourceOutlineRootNode(mdText, sourceIndex)
  mergeSessionNodes(activeSession, [sourceOutlineRoot])

  const pageNodes = await decomposeL1(mdText, activeSession)
  if (pageNodes.length === 0) {
    throw new Error('AI 未返回有效导图节点。已拒绝使用本地标题模板生成假文档，请重试或检查 PRD 是否包含足够可读取文本。')
  }
  mergeSessionNodes(activeSession, pageNodes)

  await runWithConcurrency(pageNodes, DECOMPOSITION_BRANCH_CONCURRENCY, async (pageNode) => {
    try {
      const mvcNodes = await decomposeBranch(mdText, pageNode, activeSession)
      if (mvcNodes.length > 0) mergeSessionNodes(activeSession, mvcNodes)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      appendBranchErrorNote(activeSession, pageNode, message)
    }
  })

  activeSession.status = 'done'
  activeSession.currentStep = activeSession.branchErrors?.length
    ? `分析完成（${activeSession.branchErrors.length} 个分支需手动补充）`
    : '分析完成'
  scheduleSessionCleanup(sessionId)
}

void decomposeBranch

const allowedOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://tauri.localhost',
  'tauri://localhost',
])

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true)
      return
    }
    callback(new Error(`CORS origin not allowed: ${origin}`))
  },
}))
app.use(express.json({ limit: '10mb' }))

type AiEnvironmentUpdate = Partial<Record<keyof typeof DEFAULT_ENV_CONFIG, unknown>>

function readEnvValue(key: keyof typeof DEFAULT_ENV_CONFIG) {
  return process.env[key] ?? DEFAULT_ENV_CONFIG[key]
}

function normalizeEnvField(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback
  return value.trim()
}

function toMockDecomposeValue(value: unknown, fallback: string) {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value !== 'string') return fallback === 'true' ? 'true' : 'false'
  return value.trim().toLowerCase() === 'true' ? 'true' : 'false'
}

function hasOwnEnvField(payload: AiEnvironmentUpdate, key: keyof typeof DEFAULT_ENV_CONFIG) {
  return Object.prototype.hasOwnProperty.call(payload, key)
}

function buildAiEnvironmentStatus() {
  return {
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    envPath: ENV_FILE_PATH,
    values: {
      ANTHROPIC_API_KEY_PRESENT: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
      ANTHROPIC_BASE_URL: readEnvValue('ANTHROPIC_BASE_URL'),
      CLAUDE_MODEL: readEnvValue('CLAUDE_MODEL'),
      MOCK_DECOMPOSE: readEnvValue('MOCK_DECOMPOSE') === 'true',
      FIGMA_TOKEN_PRESENT: Boolean(process.env.FIGMA_TOKEN?.trim()),
    },
  }
}

app.get('/api/environment', (_req, res) => {
  res.json(buildAiEnvironmentStatus())
})

app.post('/api/environment', (req, res) => {
  const payload = (req.body ?? {}) as AiEnvironmentUpdate
  const nextEnv = {
    ANTHROPIC_API_KEY: hasOwnEnvField(payload, 'ANTHROPIC_API_KEY')
      ? normalizeEnvField(payload.ANTHROPIC_API_KEY, '')
      : (process.env.ANTHROPIC_API_KEY ?? ''),
    ANTHROPIC_BASE_URL: hasOwnEnvField(payload, 'ANTHROPIC_BASE_URL')
      ? (normalizeEnvField(payload.ANTHROPIC_BASE_URL, DEFAULT_ENV_CONFIG.ANTHROPIC_BASE_URL) || DEFAULT_ENV_CONFIG.ANTHROPIC_BASE_URL)
      : readEnvValue('ANTHROPIC_BASE_URL'),
    CLAUDE_MODEL: hasOwnEnvField(payload, 'CLAUDE_MODEL')
      ? (normalizeEnvField(payload.CLAUDE_MODEL, DEFAULT_ENV_CONFIG.CLAUDE_MODEL) || DEFAULT_ENV_CONFIG.CLAUDE_MODEL)
      : readEnvValue('CLAUDE_MODEL'),
    MOCK_DECOMPOSE: hasOwnEnvField(payload, 'MOCK_DECOMPOSE')
      ? toMockDecomposeValue(payload.MOCK_DECOMPOSE, DEFAULT_ENV_CONFIG.MOCK_DECOMPOSE)
      : readEnvValue('MOCK_DECOMPOSE'),
    FIGMA_TOKEN: hasOwnEnvField(payload, 'FIGMA_TOKEN')
      ? normalizeEnvField(payload.FIGMA_TOKEN, '')
      : (process.env.FIGMA_TOKEN ?? ''),
  }

  if (!nextEnv.ANTHROPIC_API_KEY) {
    return void res.status(400).json({ error: '请先填写 ANTHROPIC_API_KEY。' })
  }

  for (const [key, value] of Object.entries(nextEnv)) {
    process.env[key] = value
  }
  reloadAiRuntimeConfig()

  const fileBody = [
    `ANTHROPIC_API_KEY=${nextEnv.ANTHROPIC_API_KEY}`,
    `ANTHROPIC_BASE_URL=${nextEnv.ANTHROPIC_BASE_URL}`,
    `CLAUDE_MODEL=${nextEnv.CLAUDE_MODEL}`,
    `MOCK_DECOMPOSE=${nextEnv.MOCK_DECOMPOSE}`,
    `FIGMA_TOKEN=${nextEnv.FIGMA_TOKEN}`,
    '',
  ].join('\n')
  writeFileSync(ENV_FILE_PATH, fileBody, 'utf8')

  res.json(buildAiEnvironmentStatus())
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    claude: {
      provider: usesOpenAiPrototypeProvider ? 'OpenAI-compatible GPT' : 'Anthropic Claude',
      model,
      apiKeyPresent: usesOpenAiPrototypeProvider ? Boolean(openAiApiKey) : Boolean(process.env.ANTHROPIC_API_KEY),
      baseUrl: usesOpenAiPrototypeProvider ? openAiBaseUrl : process.env.ANTHROPIC_BASE_URL,
    },
    cocosRag: {
      mode: 'mcp-sse-proxy',
      sseUrl: ragSseUrl,
      proxyScript: ragProxyScript,
      status: 'configured',
    },
  })
})

app.post('/api/decompose/preview', (req, res) => {
  const { mdText } = req.body as { mdText?: string }
  if (!mdText?.trim()) {
    return void res.status(400).json({ error: '缺少 PRD 文档内容' })
  }

  res.json(buildPrdImportPreview(mdText))
})

app.post('/api/decompose/start', (req, res) => {
  const { mdText } = req.body as { mdText?: string }
  if (!mdText?.trim()) {
    return void res.status(400).json({ error: '缺少 PRD 文档内容' })
  }
  if (!anthropic) {
    return void res.status(503).json({ error: '未配置 ANTHROPIC_API_KEY' })
  }

  const sessionId = crypto.randomUUID()
  decompositionSessions.set(sessionId, {
    status: 'running',
    nodes: [],
    currentStep: '正在建立原文索引',
  })

  // Fire-and-forget: do NOT await. Frontend polls for status.
  const jobFn = process.env.MOCK_DECOMPOSE === 'true'
    ? runMockDecompositionJob(sessionId)
    : runDecompositionJob(sessionId, mdText)
  jobFn.catch((err: unknown) => {
    const session = decompositionSessions.get(sessionId)
    if (session) {
      session.status = 'error'
      session.error = err instanceof Error ? err.message : String(err)
      session.currentStep = '分析失败'
      scheduleSessionCleanup(sessionId)
    }
  })

  res.json({ sessionId })
})

app.get('/api/decompose/:sessionId', (req, res) => {
  const session = decompositionSessions.get(req.params.sessionId)
  if (!session) {
    return void res.status(404).json({ error: '拆解会话不存在或已过期' })
  }

  const nodeCount = session.nodes.length
  session.nodes = rebuildNodeChildren(session.nodes)
  res.json({
    status: session.status,
    currentStep: session.currentStep,
    nodeCount,
    nodes: session.nodes,
    error: session.error ?? null,
  })

  // Clean up completed sessions after returning (prevents unbounded Map growth)
  if (session.status === 'done' || session.status === 'error') {
    // Delay cleanup so client can poll one final time to get full result
    scheduleSessionCleanup(req.params.sessionId)
  }
})

app.post('/api/rag/search', async (req, res) => {
  const { query } = req.body as RagSearchRequest
  if (!query?.trim()) {
    res.status(400).json({ error: '缺少查询内容' })
    return
  }

  res.json(await queryCocosKnowledge(query.trim()))
})

app.post('/api/chat', async (req, res) => {
  const { messages, requirementState } = req.body as ChatRequest

  if (!messages?.length) {
    res.status(400).json({ error: '缺少对话消息' })
    return
  }

  if (!anthropic) {
    res.status(400).json({
      error: '未配置 ANTHROPIC_API_KEY。请复制 .env.example 为 .env，并设置 ANTHROPIC_API_KEY。',
    })
    return
  }

  const latestUserMessage = extractText([...messages].reverse().find((message) => message.role === 'user')?.content ?? '')
  const shouldWarmRag = /cocos|audio|audiosource|tween|动画|引擎|预制体|资源路径/i.test(latestUserMessage)
  const warmedRag = shouldWarmRag ? await queryCocosKnowledge(latestUserMessage) : undefined

  const { response, rag } = await runClaudeRequirementLoop(messages, {
    ...requirementState,
    engine_constraints: requirementState.engine_constraints ?? warmedRag?.answer ?? requirementState.engine_constraints,
  })
  const parsed = safeParseClaudeJson(textFromClaudeContent(response.content))
  const { normalizedPatch } = mergeRequirementState(requirementState, parsed.state_patch)

  res.json({
    reply: parsed.reply ?? '我已经分析了当前需求，请继续补充缺失信息。',
    statePatch: normalizedPatch,
    rag: rag ?? warmedRag,
    usage: response.usage,
  })
})

app.post('/api/map-adjust', async (req, res) => {
  const { messages, tree } = req.body as MapAdjustmentRequest
  if (!messages?.length || !tree) {
    res.status(400).json({ error: '缺少调整对话或导图树数据' })
    return
  }
  if (!anthropic) {
    res.status(400).json({ error: '未配置 ANTHROPIC_API_KEY。' })
    return
  }

  const treeSummary = Object.values(tree)
    .map((node) => `- ${node.id}｜${node.label}｜${node.status}｜lens=${resolveNodeSpecLens(node)}｜audience=${resolveNodeAudience(node) ?? '未定'}｜${node.summary}`)
    .join('\n')

  const imageBlocks = imageBlocksFromMessages(messages).slice(0, 6)

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: `你是 GameUX PromptForge 的页面级导图调整助手。\n只给出建议，不直接修改导图。\n必须返回 JSON：{"reply":"中文说明","operations":[]}。\noperations 只能包含 create_node/update_node/move_content/add_reference，严禁返回 delete_node。\n所有调整必须基于原有文档节点增补或修正：不要删除现有节点，不要用空内容或新内容覆盖原正文；需要拆分时创建新节点并用 move_content 表示“复制/补充到目标节点”的内容，原节点内容必须保留。新增页面默认 status 为 pending_refine；不要拆按钮/字段级节点；跨页面关系用 add_reference。MVC 视角必须写入 specLens；audience 只表示下游角色。\n如果用户上传的是 API 示例、mock 数据、请求/响应字段或服务端结算规则，不要把接口拆成页面节点；应优先对相关业务节点返回 update_node，并把接口契约写入 patch.backendContracts，同时把字段/状态来源补入 patch.sections.data，把调用时机/响应表现补入 patch.sections.interaction。无法可靠匹配节点时，只在 reply 中提示用户选中具体节点后走节点补充资料入口，不要编造节点映射。`,
    messages: [
      { role: 'user', content: buildContentWithImages(`当前导图：\n${treeSummary}\n\n用户对话：\n${messages.map((message) => `${message.role}: ${extractText(message.content)}`).join('\n')}`, imageBlocks) },
    ],
  })
  const parsed = safeParseMapAdjustmentJson(textFromClaudeContent(response.content))
  res.json({
    reply: parsed.reply ?? '我没有找到可安全应用的调整建议。',
    operations: normalizeMapAdjustmentOperations(parsed.operations, tree),
  })
})

app.post('/api/qa/chat', async (req, res) => {
  const { issue, messages, tree } = req.body as QaChatRequest
  if (!issue || !messages?.length || !tree) {
    res.status(400).json({ error: '缺少 QA 缺陷草稿、对话消息或导图树数据' })
    return
  }
  if (!anthropic) {
    res.status(400).json({ error: '未配置 ANTHROPIC_API_KEY。' })
    return
  }

  const treeSummary = Object.values(tree)
    .slice(0, 120)
    .map((node) => `- ${node.id}｜parent=${node.parentId ?? 'ROOT'}｜${node.type}｜${node.label}｜${node.summary}`)
    .join('\n')
  const imageBlocks = [
    ...issue.attachments
      .map(qaAttachmentToImageBlock)
      .filter((block): block is Anthropic.ImageBlockParam => Boolean(block)),
    ...imageBlocksFromMessages(messages),
  ].slice(0, 8)

  const qaPrompt = `当前 PRD 导图摘要：
${treeSummary || '无导图节点'}

当前缺陷草稿：
${formatQaIssueDraft(issue)}

引用节点快照：
${formatQaNodeRefs(issue)}

上传附件：
${formatQaAttachments(issue)}

QA 对话记录：
${messages.map((message) => `${message.role}: ${extractText(message.content)}`).join('\n\n')}

请根据以上上下文继续和 QA 同学确认缺陷，并更新结构化缺陷单。`

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: `你是 GameUX PromptForge 的 QA 缺陷确认助手。
你的目标是通过对话把 QA 的零散描述和引用界面节点整理为可以直接推送给程序同学处理的缺陷单。

规则：
- 只用中文回复。
- 先判断是否还缺关键证据；如果缺，只问一个最关键的问题，readyToConfirm 必须为 false。
- 只有当问题现象、复现路径、预期结果、实际结果和关联界面节点都足够清楚时，才把 readyToConfirm 设为 true。
- 如果信息足够，给出可确认的缺陷单摘要；前端会自动把它加入左侧 bug 列表。
- 必须返回严格 JSON，不要 Markdown 代码块，不要在 JSON 外输出文字。
- JSON 格式：
{
  "reply": "给 QA 看的中文回复，最多 8 行",
  "readyToConfirm": false,
  "issuePatch": {
    "title": "缺陷标题",
    "severity": "blocker|major|minor|trivial",
    "priority": "high|medium|low",
    "description": "缺陷描述",
    "stepsToReproduce": ["步骤一"],
    "expectedResult": "预期结果",
    "actualResult": "实际结果",
    "environment": "测试环境或 null",
    "aiSummary": "AI 整理摘要",
    "aiQuestions": ["仍需确认的问题"],
    "aiConfidence": 0,
    "suspectedCause": "疑似原因或 null",
    "devSuggestion": "给程序同学的处理建议或 null",
    "readyToConfirm": false
  }
}
- severity 默认 major；priority 默认 medium；aiConfidence 用 0-100。
- devSuggestion 要结合引用节点说明可能影响的界面、交互、数据或服务端边界。`,
    messages: [
      { role: 'user', content: buildContentWithImages(qaPrompt, imageBlocks) },
    ],
  })

  const parsed = safeParseQaChatJson(textFromClaudeContent(response.content))
  const issuePatch = normalizeQaIssuePatch(parsed.issuePatch)
  const readyToConfirm = typeof parsed.readyToConfirm === 'boolean'
    ? parsed.readyToConfirm
    : issuePatch.readyToConfirm ?? false
  res.json({
    reply: parsed.reply ?? '我已经更新了缺陷草稿，请继续补充复现信息。',
    issuePatch: {
      ...issuePatch,
      readyToConfirm,
    },
    readyToConfirm,
  } satisfies QaChatResponse)
})

function normalizeMapAdjustmentOperations(value: unknown, tree: Record<string, PrdNode>): MapAdjustmentOperation[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): MapAdjustmentOperation | null => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      const type = normalizeTextValue(candidate.type)
      if (type === 'create_node') {
        const title = normalizeTextValue(candidate.title ?? candidate.label ?? candidate.name)
        if (!title) return null
        const parentId = normalizeParentId(candidate.parentId ?? candidate.parent_id)
        return {
          type,
          title,
          parentId: parentId && tree[parentId] ? parentId : null,
          summary: normalizeTextValue(candidate.summary),
          content: normalizeTextValue(candidate.content),
        }
      }
      if (type === 'delete_node') {
        return null
      }
      if (type === 'update_node') {
        const nodeId = normalizeTextValue(candidate.nodeId ?? candidate.node_id)
        const rawPatch = candidate.patch && typeof candidate.patch === 'object' ? candidate.patch as Record<string, unknown> : candidate
        if (!nodeId || !tree[nodeId]) return null
        const rawAudience = normalizeAudience(rawPatch.audience)
        const specLens = normalizeSpecLensValue(rawPatch.specLens ?? rawPatch.spec_lens ?? rawPatch.lens ?? rawPatch.mvc ?? rawPatch.mvcLens ?? rawPatch.mvc_lens) ?? specLensFromLegacyAudience(rawAudience)
        return {
          type,
          nodeId,
          patch: {
            label: normalizeTextValue(rawPatch.label ?? rawPatch.title) ?? undefined,
            summary: normalizeTextValue(rawPatch.summary) ?? undefined,
            content: normalizeTextValue(rawPatch.content) ?? undefined,
            docPath: normalizeTextValue(rawPatch.docPath ?? rawPatch.doc_path) ?? undefined,
            techNotes: normalizeTextValue(rawPatch.techNotes ?? rawPatch.tech_notes) ?? undefined,
            handoffGoal: normalizeTextValue(rawPatch.handoffGoal ?? rawPatch.handoff_goal) ?? undefined,
            qualityGate: normalizeTextValue(rawPatch.qualityGate ?? rawPatch.quality_gate) ?? undefined,
            status: normalizeNodeStatus(rawPatch.status, tree[nodeId].status),
            type: normalizeNodeType(rawPatch.nodeType ?? rawPatch.type),
            audience: normalizeLegacyAudience(rawAudience) ?? defaultAudienceForSpecLens(specLens),
            specLens: specLens ?? undefined,
            sections: normalizeNodeSections(rawPatch.sections ?? rawPatch.sectionDrafts ?? rawPatch.section_drafts ?? rawPatch.lenses, 'user', 'map-adjustment'),
            backendContracts: normalizeBackendContracts(rawPatch.backendContracts ?? rawPatch.backend_contracts ?? rawPatch.contracts, 'user', 'map-adjustment'),
            references: normalizeNodeReferences(rawPatch.references),
            performanceSpec: rawPatch.performanceSpec === undefined && rawPatch.performance_spec === undefined
              ? undefined
              : normalizePerformanceSpec(rawPatch.performanceSpec ?? rawPatch.performance_spec),
          },
        }
      }
      if (type === 'move_content') {
        const fromNodeId = normalizeTextValue(candidate.fromNodeId ?? candidate.from_node_id)
        const toNodeId = normalizeTextValue(candidate.toNodeId ?? candidate.to_node_id)
        const content = normalizeTextValue(candidate.content)
        return fromNodeId && toNodeId && content && tree[fromNodeId] && tree[toNodeId]
          ? { type, fromNodeId, toNodeId, content }
          : null
      }
      if (type === 'add_reference') {
        const sourceNodeId = normalizeTextValue(candidate.sourceNodeId ?? candidate.source_node_id)
        const targetNodeId = normalizeTextValue(candidate.targetNodeId ?? candidate.target_node_id)
        const label = normalizeTextValue(candidate.label)
        if (!sourceNodeId || !targetNodeId || !label || !tree[sourceNodeId] || !tree[targetNodeId]) return null
        return { type, sourceNodeId, targetNodeId, label, reason: normalizeTextValue(candidate.reason) }
      }
      return null
    })
    .filter((operation): operation is MapAdjustmentOperation => operation !== null)
}

function safeParseSuggestionJson(text: string) {
  const trimmed = text.trim()
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  const candidate = firstBrace !== -1 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed
  try {
    return JSON.parse(candidate) as { reply?: string; suggestions?: unknown }
  } catch {
    return { reply: stripJsonEcho(trimmed), suggestions: [] }
  }
}

function normalizeConfidence(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, Math.round(value)))
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed))
  }
  return 60
}

function normalizeOperationPatch(value: unknown, fallbackSourceKind: PrdNodeSourceKind): PrdNodeOperationPatch {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const sourceKind = normalizeSourceKind(candidate.sourceKind ?? candidate.source_kind, fallbackSourceKind)
  const rawAudience = normalizeAudience(candidate.audience)
  const specLens = normalizeSpecLensValue(candidate.specLens ?? candidate.spec_lens ?? candidate.lens ?? candidate.mvc ?? candidate.mvcLens ?? candidate.mvc_lens) ?? specLensFromLegacyAudience(rawAudience)
  const audience = normalizeLegacyAudience(rawAudience) ?? defaultAudienceForSpecLens(specLens) ?? undefined
  const patch: PrdNodeOperationPatch = {
    label: normalizeTextValue(candidate.label ?? candidate.title) ?? undefined,
    summary: normalizeTextValue(candidate.summary) ?? undefined,
    content: normalizeTextValue(candidate.content ?? candidate.body) ?? undefined,
    type: candidate.type === undefined && candidate.nodeType === undefined ? undefined : normalizeNodeType(candidate.type ?? candidate.nodeType),
    needsPolish: candidate.needsPolish === undefined && candidate.needs_polish === undefined ? undefined : normalizeBooleanValue(candidate.needsPolish ?? candidate.needs_polish, true),
    docPath: normalizeTextValue(candidate.docPath ?? candidate.doc_path) ?? undefined,
    audience,
    specLens: specLens ?? undefined,
    sections: normalizeNodeSections(candidate.sections ?? candidate.sectionDrafts ?? candidate.section_drafts ?? candidate.lenses, sourceKind, sourceKind === 'upload' ? 'upload' : 'user'),
    backendContracts: normalizeBackendContracts(candidate.backendContracts ?? candidate.backend_contracts ?? candidate.contracts, sourceKind, sourceKind === 'upload' ? 'upload' : 'user'),
    handoffGoal: normalizeTextValue(candidate.handoffGoal ?? candidate.handoff_goal) ?? undefined,
    qualityGate: normalizeTextValue(candidate.qualityGate ?? candidate.quality_gate) ?? undefined,
    techNotes: normalizeTextValue(candidate.techNotes ?? candidate.tech_notes) ?? undefined,
    sourceKind,
    evidenceRefs: normalizeEvidenceRefs(candidate.evidenceRefs ?? candidate.evidence_refs ?? candidate.sources, sourceKind, sourceKind === 'upload' ? '上传资料' : '用户补充'),
    performanceSpec: candidate.performanceSpec === undefined && candidate.performance_spec === undefined
      ? undefined
      : normalizePerformanceSpec(candidate.performanceSpec ?? candidate.performance_spec),
  }
  return Object.fromEntries(Object.entries(patch).filter(([, item]) => item !== undefined)) as PrdNodeOperationPatch
}

function normalizePrdNodeSuggestions(
  value: unknown,
  tree: Record<string, PrdNode>,
  selectedNodeId: string,
  sources: NodeOperationSourceInput[],
): PrdNodeOperationSuggestion[] {
  if (!Array.isArray(value)) return []
  const fallbackSourceKind: PrdNodeSourceKind = sources.some((source) => source.sourceKind === 'upload') ? 'upload' : 'user'
  return value.slice(0, 5).flatMap((item, index): PrdNodeOperationSuggestion[] => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    const operation = normalizeTextValue(candidate.operation ?? candidate.type)
    if (operation !== 'create' && operation !== 'update') return []
    const targetNodeId = normalizeTextValue(candidate.targetNodeId ?? candidate.target_node_id ?? candidate.nodeId ?? candidate.node_id)
    if (operation === 'update' && (!targetNodeId || !tree[targetNodeId])) return []
    const parentId = normalizeParentId(candidate.parentId ?? candidate.parent_id) ?? selectedNodeId
    if (operation === 'create' && parentId && !tree[parentId]) return []
    const rawPatch = candidate.patch && typeof candidate.patch === 'object' ? candidate.patch : candidate
    const patch = normalizeOperationPatch(rawPatch, fallbackSourceKind)
    if (operation === 'create' && !patch.label) return []
    if (operation === 'update' && Object.keys(patch).length === 0) return []
    const evidenceRefs = normalizeEvidenceRefs(candidate.evidenceRefs ?? candidate.evidence_refs ?? candidate.sources, patch.sourceKind ?? fallbackSourceKind, patch.sourceKind === 'upload' ? '上传资料' : '用户补充')
    return [{
      id: normalizeTextValue(candidate.id) ?? `suggestion-${Date.now()}-${index}`,
      operation,
      targetNodeId: operation === 'update' ? targetNodeId : null,
      parentId: operation === 'create' ? parentId : null,
      patch: evidenceRefs.length && !patch.evidenceRefs ? { ...patch, evidenceRefs } : patch,
      rationale: normalizeTextValue(candidate.rationale ?? candidate.reason) ?? '基于补充资料生成节点调整建议。',
      confidence: normalizeConfidence(candidate.confidence),
      evidenceRefs: evidenceRefs.length ? evidenceRefs : patch.evidenceRefs ?? [],
      status: 'pending',
    }]
  })
}


app.post('/api/prd-node-suggestions', async (req, res) => {
  const { tree, selectedNodeId, supplementText, sources = [] } = req.body as PrdNodeSuggestionRequest
  if (!tree || !selectedNodeId || !tree[selectedNodeId]) {
    res.status(400).json({ error: '缺少导图树或当前节点。' })
    return
  }
  const normalizedSources = sources
    .map((source) => ({
      name: normalizeTextValue(source.name) ?? '上传资料',
      sourceKind: normalizeSourceKind(source.sourceKind, 'upload'),
      text: normalizeTextValue(source.text),
    }))
    .filter((source): source is { name: string; sourceKind: PrdNodeSourceKind; text: string } => Boolean(source.text))
  const userText = normalizeTextValue(supplementText)
  if (!userText && !normalizedSources.length) {
    res.status(400).json({ error: '请先输入补充说明或上传资料。' })
    return
  }
  if (!anthropic) {
    res.status(400).json({ error: '未配置 ANTHROPIC_API_KEY。' })
    return
  }

  const selectedNode = tree[selectedNodeId]
  const treeSummary = Object.values(tree)
    .map((node) => `- ${node.id}｜parent=${node.parentId ?? 'ROOT'}｜lens=${resolveNodeSpecLens(node)}｜audience=${resolveNodeAudience(node) ?? '未定'}｜${node.label}｜${node.summary}`)
    .join('\n')
  const sourceText = [
    userText ? `## 用户补充\n${userText}` : null,
    ...normalizedSources.map((source) => `## ${source.sourceKind === 'upload' ? '上传资料' : '用户补充'}：${source.name}\n${source.text}`),
  ].filter(Boolean).join('\n\n')
  const suggestionSystemPrompt = [
    '你是 GameUX PromptForge 的导图节点补齐助手。你只能生成待用户确认的 create/update 建议，不能声称已经修改导图。',
    '必须返回 JSON：{"reply":"中文说明","suggestions":[]}。suggestions 最多 5 条，每条包含 id、operation(create/update)、targetNodeId、parentId、patch、rationale、confidence、evidenceRefs。',
    'MVC 分类必须按证据维度：model=领域事实/数据/配置/状态/规则；control=流程编排/API/命令/校验/请求响应/状态流转；view=UI 布局/文案/动画/视觉反馈。禁止因为关键词出现就归类。',
    '新增或更新 MVC 视角时，patch.specLens 必须使用 model/control/view；patch.audience 只表示下游角色，优先使用 client/server/config/api/acceptance/mixed，不要再用 audience 承载 MVC。',
    '如果建议只来自用户补充或上传资料，patch.sourceKind 和 evidenceRefs.sourceKind 必须用 user 或 upload，不得写成 prd。只有能从现有节点 content/extractedFrom 明确引用原 PRD 时才能标 prd。',
    '新增 MVC 子节点应挂在当前页面或用户指定页面下，label 使用中文标题并包含 Model/Control/View；如果只是补齐页面章节，可以写入 patch.sections.data、patch.sections.interaction 或 patch.sections.view。',
    '当补充资料是 API 示例、mock 数据、请求/响应字段、服务端状态码、结算规则或配置表时，优先更新当前业务节点的 patch.backendContracts，不要把接口拆成独立页面节点。backendContracts 每项必须包含 title、kind(api/config/server/data)、summary、fields，并用 evidenceRefs 引用上传资料片段。',
    'API 契约和服务端数据应同时按用途补入 patch.sections.data 或 patch.sections.interaction：data 写字段含义/状态来源/数据模型，interaction 写调用时机/请求体/响应后的客户端表现流程。',
  ].join('\n')

  const response = await anthropic.messages.create({
    model,
    max_tokens: 3000,
    system: suggestionSystemPrompt,
    messages: [{
      role: 'user',
      content: `当前选中节点：${selectedNode.id}｜${selectedNode.label}\n\n当前导图：\n${treeSummary}\n\n补充资料：\n${sourceText}`,
    }],
  })

  const parsed = safeParseSuggestionJson(textFromClaudeContent(response.content))
  const suggestions = normalizePrdNodeSuggestions(parsed.suggestions, tree, selectedNodeId, normalizedSources)
  res.json({
    reply: parsed.reply ?? (suggestions.length ? '已生成待确认的节点调整建议。' : '没有找到可安全生成的节点建议。'),
    suggestions,
  })
})

app.post('/api/figma/frame', async (req, res) => {
  try {
    const assetBaseUrl = `${req.protocol}://${req.get('host') ?? `127.0.0.1:${port}`}`
    const result = await importFigmaFrame(req.body as FigmaFrameRequest, assetBaseUrl)
    res.json(result)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '导入 Figma Frame 失败。' })
  }
})

app.post('/api/figma/frame-prefab', async (req, res) => {
  try {
    const assetBaseUrl = `${req.protocol}://${req.get('host') ?? `127.0.0.1:${port}`}`
    const result = await importFigmaFrameFromPrefab(req.body as FigmaFrameRequest, assetBaseUrl)
    res.json(result)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '通过 Figma2Prefab 导入 Figma Frame 失败。' })
  }
})

app.get(/^\/api\/figma\/assets\/([^/]+)\/(.+)$/u, (req, res) => {
  const params = req.params as unknown as { 0?: string; 1?: string }
  const bundleId = params[0]
  const rawAssetPath = params[1]
  if (!bundleId || !rawAssetPath) {
    res.status(400).json({ error: '缺少 Figma 资源路径。' })
    return
  }
  const assetPath = normalizeZipPath(decodeURIComponent(rawAssetPath))
  const bundle = figmaAssetBundles.get(bundleId)
  const bytes = bundle ? findZipFile(bundle.files, bundle.lookup, assetPath) : null
  if (!bytes) {
    const cachedPath = resolveCachedFigmaAssetPath(bundleId, assetPath)
    if (cachedPath && existsSync(cachedPath)) {
      res.setHeader('Content-Type', mimeTypeForPath(assetPath))
      res.setHeader('Cache-Control', 'private, max-age=86400')
      res.end(readFileSync(cachedPath))
      return
    }
    res.status(404).json({ error: '未找到 Figma 资源，请重新导入。' })
    return
  }
  res.setHeader('Content-Type', mimeTypeForPath(assetPath))
  res.setHeader('Cache-Control', 'private, max-age=1800')
  res.end(Buffer.from(bytes))
})

const REFERENCE_IMAGE_ROLES = [
  'layout_reference',
  'asset_reuse',
  'state_screenshot',
  'negative_reference',
] as const satisfies readonly ReferenceImageRole[]

type ReferenceImageMediaType = ReferenceImageClassificationRequest['mediaType']

const SUPPORTED_REFERENCE_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]) as ReadonlySet<ReferenceImageMediaType>

function normalizeReferenceImageRole(value: unknown): ReferenceImageRole | null {
  const text = normalizeTextValue(value)?.toLowerCase()
  return REFERENCE_IMAGE_ROLES.find((role) => role === text) ?? null
}

function normalizeReferenceImageMediaType(value: unknown): ReferenceImageMediaType | null {
  const text = normalizeTextValue(value)
  return text && SUPPORTED_REFERENCE_IMAGE_MEDIA_TYPES.has(text as ReferenceImageMediaType)
    ? text as ReferenceImageMediaType
    : null
}

function safeParseReferenceImageClassificationJson(text: string): { role: ReferenceImageRole | null; reason: string | null } | null {
  const trimmed = text.trim()
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  const candidate = firstBrace !== -1 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>
    return {
      role: normalizeReferenceImageRole(parsed.role),
      reason: normalizeTextValue(parsed.reason),
    }
  } catch {
    return null
  }
}

function isLikelyBase64ImageData(value: string) {
  return value.length > 0 && value.length <= 8 * 1024 * 1024 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value)
}

app.post('/api/reference-image-classification', async (req, res) => {
  const { name, mediaType, data } = req.body as ReferenceImageClassificationRequest
  const imageName = normalizeTextValue(name) ?? '未命名图片'
  const normalizedMediaType = normalizeReferenceImageMediaType(mediaType)
  const normalizedData = normalizeTextValue(data)

  if (!normalizedMediaType) {
    res.status(400).json({ error: '图片类型不受支持。请上传 png、jpg、webp 或 gif。' })
    return
  }

  if (!normalizedData || !isLikelyBase64ImageData(normalizedData)) {
    res.status(400).json({ error: '图片数据无效。' })
    return
  }

  if (!anthropic) {
    res.status(400).json({ error: '未配置 ANTHROPIC_API_KEY。' })
    return
  }

  const response = await anthropic.messages.create({
    model,
    max_tokens: 800,
    system: `你是 GameUX PromptForge 的图片证据分类器。你必须只根据图片内容和文件名，把图片归入且只归入一个类别：
- layout_reference：布局参考，重点是界面结构、层级、排版、控件分组、间距或信息架构。
- asset_reuse：素材复用，重点是可复用的图标、角色、道具、背景、纹理、视觉素材。
- state_screenshot：状态截图，重点是同一界面的特定状态、弹窗、加载、禁用、选中、错误、奖励领取等状态。
- negative_reference：反例参考，重点是用户希望避免、不要复用或作为错误示范的画面。

必须返回 JSON：{"role":"layout_reference|asset_reuse|state_screenshot|negative_reference","reason":"中文短句"}。不要输出 Markdown、解释或额外字段。`,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: normalizedMediaType,
            data: normalizedData,
          },
        },
        {
          type: 'text',
          text: `文件名：${imageName}\n请分类这张图片在 PRD 节点打磨中的用途。`,
        },
      ],
    }],
  })

  const parsed = safeParseReferenceImageClassificationJson(textFromClaudeContent(response.content))
  if (!parsed?.role || !parsed.reason) {
    res.status(502).json({ error: '图片分类模型返回格式无效。' })
    return
  }

  res.json({ role: parsed.role, reason: parsed.reason } satisfies ReferenceImageClassificationResponse)
})

app.post('/api/node-chat', async (req, res) => {
  const { nodeId, currentMessage, messages = [], tree, performancePolishMode = false } = req.body as NodeChatRequest
  const latestUserMessage = currentMessage ?? [...messages].reverse().find((message) => message.role === 'user')
  const isPerformancePolishMode = performancePolishMode === true

  if (!nodeId || !latestUserMessage || !tree) {
    res.status(400).json({ error: '缺少节点 ID、对话消息或导图树数据' })
    return
  }

  const targetNode = tree[nodeId]
  if (!targetNode) {
    res.status(400).json({ error: `导图中找不到节点：${nodeId}` })
    return
  }

  const parentNode = targetNode.parentId ? tree[targetNode.parentId] : null
  const mvcChildren = targetNode.type === 'page'
    ? targetNode.children.map((childId) => tree[childId]).filter((node): node is PrdNode => Boolean(node))
    : []
  const mvcChildContext = mvcChildren.length
    ? `\n\n页面下属 MVC 子节点上下文：\n${mvcChildren.map((child) => [
        `- 编号: ${child.id}`,
        `  类型: ${formatNodeType(child.type)}`,
        `  规格视角: ${formatSpecLens(resolveNodeSpecLens(child))}`,
        `  面向角色: ${formatAudience(resolveNodeAudience(child))}`,
        `  标题: ${child.label}`,
        `  摘要: ${child.summary}`,
        `  导出路径: ${child.docPath ?? '未指定'}`,
        `  内容: ${compactExcerpt(child.content, 800)}`,
        child.techNotes ? `  技术备注: ${child.techNotes}` : null,
      ].filter(Boolean).join('\n')).join('\n\n')}`
    : ''
  const pageSectionContext = hasNodeSections(targetNode.sections)
    ? `\n\n${formatNodeSectionsForContext(targetNode.sections)}`
    : ''
  const performanceSpec = resolveNodePerformanceSpec(targetNode)
  const latestUserText = extractText(latestUserMessage.content)
  const canUseFastPerformancePath = isPerformancePolishMode
    && !hasImages(latestUserMessage.content)
    && latestUserText.trim().length > 0
    && latestUserText.trim().length <= 800
    && !/https?:\/\/|figma|prototype|原型|右侧|截图|图片|上传|生成|修改|替换|颜色|布局/i.test(latestUserText)

  if (canUseFastPerformancePath) {
    const fastResult = applyPerformanceAnswerFast(performanceSpec, latestUserText)
    if (fastResult) {
      res.json({
        reply: fastResult.reply,
        nodeComplete: false,
        nodePatch: { performanceSpec: fastResult.performanceSpec },
        intents: ['document_polish'],
        prototypeInstruction: null,
      })
      return
    }
  }

  if (!anthropic) {
    res.status(400).json({ error: '未配置 ANTHROPIC_API_KEY。' })
    return
  }

  const performanceContext = `\n\n表现编排扫描：\n${formatPerformanceSpecForPrompt(performanceSpec)}`

  const nodeContext = `目标节点：
编号: ${targetNode.id}
类型: ${formatNodeType(targetNode.type)}
标题: ${targetNode.label}
摘要: ${targetNode.summary}
导出路径: ${targetNode.docPath ?? '未指定'}
面向角色: ${formatAudience(resolveNodeAudience(targetNode))}
规格视角: ${formatSpecLens(resolveNodeSpecLens(targetNode))}
AI 接力目标: ${targetNode.handoffGoal ?? '未指定'}
质量门槛: ${targetNode.qualityGate ?? '未指定'}
内容: ${compactExcerpt(targetNode.content, 6000)}${pageSectionContext}${performanceContext}${targetNode.techNotes ? `\n技术备注: ${targetNode.techNotes}` : ''}${parentNode ? `\n\n父节点上下文：\n标题: ${parentNode.label}\n摘要: ${parentNode.summary}` : ''}${mvcChildContext}`

  const hasReferenceImages = hasImages(latestUserMessage.content)
  const conversationText = latestUserText
  const existingNodeVisualText = [
    targetNode.summary,
    targetNode.content,
    targetNode.extractedFrom,
    targetNode.techNotes,
    targetNode.evidenceRefs?.map((ref) => `${ref.sourceLabel}\n${ref.quote ?? ''}`).join('\n'),
    Object.values(targetNode.sections ?? {}).map((section) => [
      section?.title,
      section?.summary,
      section?.content,
      section?.evidenceRefs?.map((ref) => `${ref.sourceLabel}\n${ref.quote ?? ''}`).join('\n'),
    ].filter(Boolean).join('\n')).join('\n'),
  ].filter(Boolean).join('\n')
  const visualResourcePattern = /figma|参考图|截图|原型图|原型图片|视觉稿|设计稿|界面图|UI\s*图|已上传|已导入|图片|image|screenshot|prototype/i
  const mentionsVisualResource = hasReferenceImages
    || visualResourcePattern.test(conversationText)
    || visualResourcePattern.test(existingNodeVisualText)
  const declinedVisualResource = /没有.{0,8}(图|figma|设计稿|原型|截图|视觉稿)|暂无.{0,8}(图|figma|设计稿|原型|截图|视觉稿)|先按文字|没有资源/i.test(conversationText)
  const isVisualNode = resolveNodeAudience(targetNode) === 'client'
    || resolveNodeSpecLens(targetNode) === 'view'
    || targetNode.type === 'page'
    || targetNode.type === 'ui'
  const shouldAskForVisualResource = !isPerformancePolishMode && isVisualNode && !mentionsVisualResource && !declinedVisualResource

  const nodeChatSystemPrompt = `你是游戏需求文档精修顾问，专注于把单个 PRD 拆分节点打磨成可直接交给 AI Agent 使用的 Markdown 文档。

${nodeContext}

你的任务：通过对话补齐这篇文档包的缺口，直到它足够低噪音、可独立、可执行，后续 AI 不需要再阅读整篇 PRD 也能完成对应任务。

规则：
- 用中文回复；所有展示给用户或写入导出文档的生成内容都必须是中文
- 当前工作模式：${isPerformancePolishMode ? 'AI 追问表现（AI 问、用户答）' : '自由迭代（用户主动补充或修改）'}
- 回复正文只写给用户看的简短 Markdown 总结，不要输出整篇重写文档；可用标题、列表、加粗或行内代码，最多8行
- 默认回复必须短：最多 3 行；除非用户要求总结或导出，不要列长清单
- 如果文档还不完整，只问一个最关键的问题
- 追问优先级不可颠倒：
  1. 如果这是客户端/UI/页面节点，且尚未提供原型图片、Figma、参考图或视觉稿，第一优先级必须先询问这些资源；如果用户明确说没有，再继续按文字打磨。
  2. 第二优先级补齐入口、主流程、状态/边界、依赖字段/配置、跨文档关系、可测试验收标准和 AI 接力说明。
  3. 最后才进入表现打磨/表现编排澄清。
- 当前是否应先询问原型/Figma/参考图资源：${shouldAskForVisualResource ? '是' : '否'}
- 当“当前是否应先询问原型/Figma/参考图资源”为“是”时，你的唯一问题应是请用户上传原型截图/参考图或粘贴 Figma 链接；不要在同一轮追问表现编排
- 当“当前是否应先询问原型/Figma/参考图资源”为“是”时，回复必须只包含两层意思：1）先上传原型截图/参考图或粘贴 Figma 链接；2）如果没有就回复“没有原型资源”。禁止同时列原文依据、职责边界、依赖字段、验收标准、表现类型、触发条件或程序员追问清单
- 优先补齐：原文位置、职责边界、核心规则、依赖字段/配置、跨文档关系、边界条件、需澄清点、可测试验收标准、AI 接力说明
- 默认扫描目标节点中的表现编排缺口：结果/奖励表现、金币/数值获得、连线/命中、宝石/图标特效、弹窗揭晓、阶段演出、成功/失败反馈等都算表现编排
- 不要问用户“这个表现重不重要”；这些表现通常是设计师已知但 PRD 未写清。你的角色是代替程序员追问 UI 设计师，把“会播什么、怎么播、播完怎么办”追问成可实现 spec
- 追问表现编排时只围绕 8 类实现缺口：触发条件、分支规则、播放顺序、接入方式、资源清单、层级位置、控制规则、结束状态
- 接入方式必须使用 Cocos 程序能落地的语言：Tween/AnimationClip/Spine/ParticleSystem/Prefab/序列帧/音效联动；不要停留在“更酷一点”“有氛围感”等视觉形容
- 只有在原型/视觉资源问题和主流程问题都不阻塞时，才根据节点内容整理播放流程草案；再问最阻塞实现的 1 个具体问题，例如“连线是逐条亮还是同时亮”“金币飞入用 Tween 走贝塞尔还是复用 prefab 动画”“Spine 播完是否等待回调再开弹窗”“粒子和音效是否跟随跳过一起停止”“弹窗自动关闭还是点击关闭”
- 进入表现追问时，必须明确这个问题卡住了哪个槽位：trigger、branches、sequence、integrationModes、assets、layers、controls、endState；回复正文只问这 1 个问题，不要同轮列多问
- 单个追问必须给出 2-4 个可直接选择的回答方向，写在问题后面，例如“可选：逐段等待 / 并行播放后收尾 / 我来描述”；选项要短、具体、互斥，不要复述问题
- 表现问题是软门槛：如果主文档已经足够交付但表现槽位仍有 AI 推断或缺失，可以 nodeComplete=true，但必须在 performanceSpec.readiness 保留风险，不要假装已经确认
- 未启用表现打磨问答模式时，处于自由迭代：用户主动描述要补充的需求、视觉反馈或原型修改，你自动识别 document_polish、reference_feedback、prototype_update，不要强迫用户按表现槽位回答
- 当表现打磨问答模式为“是”时，进入 AI 问、用户答的表现编排澄清节奏：跳过视觉资源优先级和普通文档长清单，围绕触发条件、分支规则、播放顺序、接入方式、资源清单、层级位置、控制规则、结束状态这 8 个槽位逐项确认
- 当表现打磨问答模式为“是”时，你必须每轮根据当前节点、已有表现编排扫描和用户最新回答重新评估 performanceSpec.slotStatus、confidence、blockingQuestion；nodePatch.performanceSpec 必须写入最新结构化对象，即使本轮只是在继续追问
- 当表现打磨问答模式为“是”时，整体理解度不是只能上涨的进度条：如果用户回答引入矛盾、扩大范围、否定先前假设或暴露未知资源/接入方式，必须把相关槽位从 confirmed 降为 inferred 或 missing，让 readiness 分数和 confidence 下降
- 当表现打磨问答模式为“是”时，回复正文最多 3 行：第一行写“整体理解度：X%”，第二行写“当前卡住：槽位名”并只问当前最阻塞的 1 个表现问题，第三行给 2-4 个短选项；不要输出说明性长清单
- 你必须自己从用户最新一轮输入中识别一个或多个意图，不要要求用户选择模式
- document_polish：用户补充、确认、修正文档内容时，更新 nodePatch
- reference_feedback：用户上传图片、提到参考图/截图/视觉对比时，把图片或视觉评论作为文档证据；通常也要更新 UI/client 文档的 nodePatch
- prototype_update：用户要求生成、修改、对齐、对比或修复右侧原型时，写出可直接传给原型生成器的简短中文 prototypeInstruction
- 重要分流：用户说“换 item 图片 / 替换图片 / 换素材 / 用 Figma 链接 / 按这张图改界面 / 调整按钮颜色位置”等视觉或原型反馈时，默认只属于 prototype_update，不要写 nodePatch，不要把它记录为需求文档迭代；只有用户明确说“写入需求文档/更新 PRD/spec/验收/规则/流程/字段”时才更新 nodePatch
- 一轮输入可以同时包含 document_polish、reference_feedback、prototype_update
- 当用户上传参考图或界面截图时，仅对 client/UI 类文档像 screenshot-to-code 一样提取布局层级、控件分组、间距、对齐、视觉权重、可交互元素、状态反馈和素材/参考图边界，并转化为文档内容
- 本轮是否包含图片参考：${hasReferenceImages ? '是' : '否'}
- 当用户补充或确认的内容应合并进当前文档时，即使文档尚未完成，也要在回复末尾附加 JSON：{"nodeComplete": false, "intents": ["document_polish"], "prototypeInstruction": null, "nodePatch": {"summary": "中文一句话总结当前文档用途或 null", "content": "中文 Markdown 文档正文或本轮已采纳后的当前文档段落", "techNotes": "中文实现/接力注意事项或 null", "performanceSpec": null}}
- 如果本轮补齐或修正了表现编排，nodePatch.performanceSpec 必须写入结构化对象：{"detected": true, "source": "ai", "confidence": 0-100, "eventTypes": ["表现类型"], "integrationModes": ["Cocos Tween 变换 / AnimationClip/cc.Animation / Spine/Skeleton / ParticleSystem 粒子 / Prefab 特效/弹窗 / 序列帧 / 音效联动"], "trigger": "触发条件或 null", "branches": ["分支规则"], "sequence": [{"title":"阶段名","detail":"播放内容","layer":"层级或 null","assets":["资源"],"waitFor":"等待条件或 null"}], "assets": ["资源"], "layers": ["层级"], "controls": ["可跳过/可打断/重复触发规则"], "endState": "播放完成后的状态或 null", "openQuestions": ["仍待确认的问题"], "prototypeNotes": ["原型应模拟的表现重点"], "slotStatus": {"trigger":{"status":"missing/inferred/confirmed/waived","detail":"已知内容或 null","question":"该槽位待问问题或 null"}, "branches":{"status":"missing/inferred/confirmed/waived"}, "sequence":{"status":"missing/inferred/confirmed/waived"}, "integrationModes":{"status":"missing/inferred/confirmed/waived"}, "assets":{"status":"missing/inferred/confirmed/waived"}, "layers":{"status":"missing/inferred/confirmed/waived"}, "controls":{"status":"missing/inferred/confirmed/waived"}, "endState":{"status":"missing/inferred/confirmed/waived"}}, "blockingQuestion":{"slot":"当前最阻塞槽位","question":"只问 1 个问题"}, "readiness":{"score":0-100,"level":"ready/risk/blocked/waived","confirmedSlots":["已确认槽位"],"inferredSlots":["AI 推断槽位"],"missingSlots":["缺失槽位"],"waivedSlots":["豁免槽位"],"riskSummary":"中文风险说明或 null"}, "waivedReason":"豁免原因或 null"}
- 当同一轮还要求更新右侧原型时，把 prototype_update 加入 intents，并填写中文 prototypeInstruction；如果没有原型相关要求，prototypeInstruction 必须为 null
- 如果用户确认了表现流程，且右侧原型需要同步表现顺序，prototypeInstruction 应简短说明要更新的播放阶段、弹窗/特效/数值表现和结束状态
- 当你判断该文档已经足够交给后续 AI 执行时，把同一个 JSON 的 nodeComplete 设为 true，并让 nodePatch 包含最终文档内容
- JSON 只能放在回复末尾；回复正文不能包含 JSON、大括号、schema 说明或原始回包
- nodePatch.content 必须整合当前节点原始内容、用户补充和图片观察结论，写成可导出的当前文档正文；不要只写本轮摘要，也不要重复堆叠旧的 Deep Forge 段落
- nodePatch 可以额外写入 sections.view / sections.interaction / sections.data、handoffGoal、qualityGate、backendContracts、evidenceRefs；页面节点的 View/Flow/Data 细节优先写 sections，接口/配置/服务端规则/数据模型依赖写入 backendContracts，作为页面的服务端交互内容，不要把服务端实现细节堆进页面正文
- nodePatch.summary、nodePatch.content、nodePatch.techNotes、nodePatch.performanceSpec、prototypeInstruction 以及 content 内部 Markdown 标题必须使用中文；只有代码标识、文件路径、接口字段名、库/API 名称、枚举值和专有产品名可以保留英文
- 保持专业、简洁、直接的语气`

  const currentTurnOnlySystemPrompt = [
    '重要：本次只处理当前用户反馈，不要依赖历史聊天记录。',
    isPerformancePolishMode
      ? '回复正文必须遵守表现打磨问答模式：写出最新整体理解度，标明当前卡住的表现槽位，只问一个最阻塞表现问题，并给出 2-4 个短选项。'
      : '回复正文必须极短：只说“已记录这个需求。”、“已完成这次 UI 迭代。”或“已记录这个需求，并完成这次 UI 迭代。”；只有确实缺少必要信息时，才问一个短问题。',
    '不要在回复正文中说明写入了哪些需求文档内容，也不要展示或复述发给 UI 原型迭代器的 prototypeInstruction。',
    nodeChatSystemPrompt,
  ].join('\n\n')
  const currentTurnMessage = prependTextToUserMessage(
    latestUserMessage,
    isPerformancePolishMode
      ? '当前用户正在回答表现打磨问题。请只处理这一轮回答，并重算表现编排的 8 个槽位理解状态：已确认、AI 推断、缺失或豁免。必须写回 nodePatch.performanceSpec，并只问下一条最阻塞的表现问题。'
      : '当前用户反馈如下。请只拆分并处理这一轮：需要更新需求文档的内容写入 nodePatch；需要更新右侧 UI/原型的内容写入 prototypeInstruction。不要读取或总结历史对话。',
  )

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: currentTurnOnlySystemPrompt,
    messages: [toAnthropicNodeMessage(currentTurnMessage)],
  })

  const rawText = textFromClaudeContent(response.content)

  const parsedSuffix = extractNodeChatSuffix(rawText)
  const latestContent = latestUserMessage.content as import('../src/types/chat').ChatMessage['content']
  const finalSuffix = !isPerformancePolishMode && isUiOnlyPrototypeFeedback(latestContent)
    ? {
        ...parsedSuffix,
        reply: '已完成这次 UI 迭代。',
        nodeComplete: false,
        nodePatch: null,
        intents: ['prototype_update' as const],
        prototypeInstruction: parsedSuffix.prototypeInstruction ?? buildUiOnlyPrototypeInstruction(latestContent),
      }
    : parsedSuffix
  res.json({
    reply: finalSuffix.reply || rawText,
    nodeComplete: finalSuffix.nodeComplete,
    nodePatch: finalSuffix.nodePatch,
    intents: finalSuffix.intents,
    prototypeInstruction: finalSuffix.prototypeInstruction,
  })
})

const editPrototypeTool: Anthropic.Tool = {
  name: 'edit_prototype',
  description: 'Edit the existing prototype HTML by replacing one exact old_string with new_string.',
  input_schema: {
    type: 'object',
    properties: {
      old_string: {
        type: 'string',
        description: 'Exact substring from the current prototype HTML. Must match character-for-character.',
      },
      new_string: {
        type: 'string',
        description: 'Replacement HTML/CSS/JS substring.',
      },
      rationale: {
        type: 'string',
        description: 'Short explanation of why this replacement satisfies the requested iteration.',
      },
    },
    required: ['old_string', 'new_string'],
  },
}

function buildPrototypeSpec(requirementState: UXRequirementState) {
  const hasComponents = requirementState.ui_components.length > 0
  const componentTree = hasComponents
    ? JSON.stringify(requirementState.ui_components, null, 2)
    : '（暂无组件信息，请根据 trigger_condition 和 sequence_rules 推断界面结构）'
  const assetDependencies = requirementState.asset_dependencies.length > 0
    ? JSON.stringify(requirementState.asset_dependencies, null, 2)
    : '（暂无可用资源）'

  return `## 需求状态
触发条件：${requirementState.trigger_condition ?? '未知'}
执行规则：${requirementState.sequence_rules ?? '未知'}
引擎约束：${requirementState.engine_constraints ?? '无'}
完成度：${requirementState.completion_rate}%

## 可用资源
${assetDependencies}

## 表现编排
${requirementState.performance_spec ? formatPerformanceSpecForPrompt(requirementState.performance_spec) : '未提供单独的表现编排规格；请仅根据执行规则模拟关键状态反馈。'}

## 组件树
${componentTree}`
}

function buildScreenshotFidelitySection() {
  return `## 参考图还原纪律
1. 本次附带了参考图。请严格按照参考图还原界面：布局结构、视觉层级、配色、文案文字、控件位置与间距都要尽量贴合。
2. 文案以参考图中的真实文字为准；参考图中能看清的文字优先照抄，不要凭空臆造或改写。
3. 当参考图与下方需求状态文字描述冲突时，以参考图的视觉呈现为准；需求状态 JSON 仅用于补充交互逻辑、状态流转与引擎约束等图上看不到的信息。
4. 忽略参考图中的采集/评审伪影：例如对比外壳、手机边框/刘海、浏览器窗口、标尺、批注箭头、红框、水印等，这些不属于要还原的界面本身。
`
}

function buildFigmaEvidencePolicySection(hasImages: boolean) {
  if (!hasImages) return ''
  return `
## Figma / 参考图优先级
- 如果附件来自 Figma Frame、布局参考图或界面截图，它是视觉结构的主来源：布局、层级、间距、颜色、控件位置、文字和素材位置都优先按图还原。
- PRD 和节点文档只用于补充交互逻辑、状态流转、数据条件、Cocos 制作约束和图中不可见的异常状态。
- 如果 Figma 证据列出“数值占位”，说明原图中的示例数字已从位图中去除；生成 HTML 时必须在对应坐标叠加真实业务数值或动态占位，不要还原 Figma 示例数字。
- 不要自行发明参考图/Figma 中不存在的装饰图、角色图、背景图或外层设备框。`
}

interface FigmaAssetReference {
  url: string
  label: string
  type: string
}

function extractFigmaAssetReferences(requirementState: UXRequirementState): FigmaAssetReference[] {
  const seen = new Set<string>()
  return requirementState.asset_dependencies
    .map((asset): FigmaAssetReference | null => {
      const rawPath = asset.path ?? ''
      const url = rawPath.split('|')[0]?.trim()
      if (!url || !/^https?:\/\/[^\s]+$/u.test(url)) return null
      if (!asset.type.toLowerCase().includes('figma') && !url.includes('/api/figma/assets/')) return null
      if (seen.has(url)) return null
      seen.add(url)
      return {
        url,
        label: rawPath.split('|').slice(1).join('|').trim() || asset.type,
        type: asset.type,
      }
    })
    .filter((asset): asset is FigmaAssetReference => Boolean(asset))
    .slice(0, 6)
}

function buildFigmaAssetUsageSection(requirementState: UXRequirementState) {
  const assets = extractFigmaAssetReferences(requirementState)
  if (!assets.length) return ''

  return `
## Figma 位图资产使用契约
本次 Figma 子图已经作为可访问图片资源缓存到本地代理。生成 HTML 时必须真实引用这些图片，而不是只按视觉重新绘制。

可用 Figma 图片：
${assets.map((asset, index) => `${index + 1}. ${asset.type}｜${asset.label}\n   URL: ${asset.url}`).join('\n')}

使用要求：
- 至少使用 1 张 Figma 图片作为主视觉图层；如果存在 FigmaFrameImage，优先把它作为底图或首屏主图。
- 对重要子区域，用 FigmaSubImage 作为真实 \`<img src="...">\` 或 \`background-image:url(...)\` 图层，再叠加 HTML 状态、按钮、热点、弹层和流程反馈。
- 不要用纯 CSS/渐变/假卡片替代这些 Figma 图片；CSS 只负责适配、遮罩、交互状态和补充图中不可见的 PRD 逻辑。
- 这些 URL 来自当前本地代理 \`/api/figma/assets/\`，允许在预览 HTML 中直接引用。`
}

function buildCreatePrototypePrompt(requirementState: UXRequirementState, hasImages = false, focus?: string, instruction?: string) {
  const focusSection = focus
    ? `\n## 本变体设计侧重\n${focus}\n（这是同一需求的多个备选方案之一，请在满足上述需求与约束的前提下，按本侧重做出有辨识度的设计。）\n`
    : ''
  const instructionSection = instruction?.trim()
    ? `\n## 本轮原型生成要求\n${instruction.trim()}\n`
    : ''
  return `你是 GameUX PromptForge 的游戏 UX 原型生成专家。根据以下 UX 需求状态${hasImages ? '和参考图' : ''}，生成一个可直接预览的自包含 HTML 原型。

${buildPrototypeSpec(requirementState)}${buildFigmaAssetUsageSection(requirementState)}
${instructionSection}${hasImages ? `\n${buildScreenshotFidelitySection()}` : ''}${buildFigmaEvidencePolicySection(hasImages)}${focusSection}
## 尺寸契约
- 预览沙盒按参考项目的手机适配方式提供 375px CSS 固定宽度；默认验收视口按 375x812 设计。
- html、body 和唯一主根容器必须按移动端视口组织：width: 100vw; min-width: 375px; min-height: 100vh; overflow-x: hidden; overflow-y: auto。
- 主界面内容必须按 375px CSS 宽度设计并优先在 812px 首屏内形成完整可验收画面；不要把所有状态和说明纵向堆成长页。
- 如信息量超过首屏，优先使用弹层、抽屉、折叠区、标签页或状态切换承载次级内容，而不是直接拉长主页面。
- 内容确实超出时允许纵向滚动，但必须保证核心界面、主要按钮和关键状态在首屏可见；不要生成额外的 750px 设计稿容器。
- 禁止使用 max-width、mx-auto、scale()、zoom 或居中 phone/container 把界面缩成中间一条。
- 不要额外绘制手机壳、浏览器壳、设备边框或外层预览框，应用预览已提供外框。

## 输出约束
1. 只输出单个完整 HTML 文件；可以用 \`\`\`html 包裹，但不要解释。
2. 必须是单个 HTML 文件：不需要 npm 或构建步骤；如果上方提供了 Figma 图片 URL，必须直接引用这些 URL 作为真实视觉资产。
3. 可使用 Tailwind CDN（https://cdn.tailwindcss.com）、上方提供的 Figma 图片 URL 和少量内联 CSS/JS；不要引用未提供或不可访问的本地路径。
4. 画面要像游戏交互原型，不要做营销页：包含设备内界面、状态切换、关键按钮反馈、禁用/加载/错误态。
5. 如果需求状态、PRD 或附件里包含多组 mock 数据、多个列表 item、多个奖励档位、多个接口示例或多种服务端返回，原型必须提供可验证的多数据态：用自动循环/轮播/分页展示，或提供一个紧凑的 GM/调试面板让用户切换 mock 数据、状态、奖励档位、错误码和空数据；不要只固定展示第一组 mock 数据。
6. 如果需求状态包含表现编排，必须模拟播放流程的大致顺序：前置特效、命中/高亮、弹窗/揭晓、数值滚动/飞入、收尾关闭等可以用占位特效和中文阶段标签表达；不要只画静态最终态。
7. 不要生成提示性标注、组件标注、注释说明小标签、注释栏、引线或 callout；原型只保留用户真实会看到和操作的界面内容。
8. 未确认资源用占位块，不要伪造真实素材路径。
9. 脚本必须安全自包含，不要访问父窗口、cookie、localStorage 或外部 API。
10. 所有用户可见界面文字、按钮文案和状态提示必须是中文；只有代码标识、CSS 类名、库/API 名称、枚举值、文件路径和专有产品名可以保留英文。`
}

function buildUpdatePrototypePrompt(requirementState: UXRequirementState, currentHtml: string, instruction: string, history: string[] = [], focus?: string, hasImages = false) {
  const historySection = history.length > 0
    ? `\n## 当前变体历史修改指令\n${history.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n`
    : ''
  const focusSection = focus ? `\n## 本次更新侧重\n${focus}\n` : ''
  return `你是 GameUX PromptForge 的原型迭代代理。请根据用户的修改说明，对当前 HTML 原型做最小必要修改。

${buildPrototypeSpec(requirementState)}${buildFigmaAssetUsageSection(requirementState)}${buildFigmaEvidencePolicySection(hasImages)}${historySection}${focusSection}

## 用户修改说明
${instruction}

## 当前原型 HTML
${currentHtml}

## 修改规则
1. 如果当前运行环境提供 edit_prototype 工具，优先调用 edit_prototype 工具，用 old_string/new_string 做精确局部替换；如果没有工具可用，必须直接输出修改后的完整 HTML 文件。
2. old_string 必须逐字符来自当前 HTML，不能概括、不能省略。
3. 如果需要多处修改，可以调用多次 edit_prototype。
4. 如果无法安全定位精确片段，直接输出修改后的完整 HTML 文件。
5. 保持单文件可运行、Tailwind CDN 可用、无构建步骤；如果上方提供了 Figma 图片 URL，继续保留并真实引用这些 URL。
6. 预览 iframe 是 375px CSS 固定宽度；默认验收视口按 375x812 设计，html、body 和唯一主根容器必须使用 width:100vw; min-width:375px; min-height:100vh; overflow-x:hidden; overflow-y:auto。
7. 修改时优先保持核心界面、主要按钮和关键状态在首屏可见；新增内容超过首屏时，用弹层、抽屉、折叠区、标签页或状态切换承载，不要直接把主页面继续拉长。
8. 禁止生成额外的 750px 设计稿容器，禁止 max-width/mx-auto/scale()/zoom 让界面缩在中间，也不要新增手机壳、浏览器壳或外层设备框；内容过长时允许纵向滚动，不要横向溢出。
9. 如果需求状态、PRD 或附件里包含多组 mock 数据、多个列表 item、多个奖励档位、多个接口示例或多种服务端返回，本次更新必须保留或补齐多数据态切换：用自动循环/轮播/分页展示，或提供一个紧凑的 GM/调试面板让用户切换 mock 数据、状态、奖励档位、错误码和空数据；不要把原型退化成只展示第一组 mock 数据。
10. 如果需求状态包含表现编排，本次更新必须优先对齐播放顺序、阶段标签、弹窗/特效/数值表现和结束状态；可以用占位粒子、光效、震屏模拟、音效标签表达尚未接入的资源。
11. 不要新增提示性标注、组件标注、注释说明小标签、注释栏、引线或 callout；需要说明的设计意图只体现在真实界面状态、文案和交互反馈中。
12. 所有用户可见界面文字、按钮文案和状态提示必须是中文；只有代码标识、CSS 类名、库/API 名称、枚举值、文件路径和专有产品名可以保留英文。
13. 最终返回不能是说明、diff、patch、局部片段或 Markdown 清单；非工具路径必须返回以 <!doctype html> 或 <html> 开始、包含 </html> 的完整 HTML 文档。`
}

function applyPrototypeToolUses(currentHtml: string, content: Anthropic.Messages.ContentBlock[]) {
  let html = currentHtml
  let appliedEdits = 0

  for (const block of content) {
    if (block.type !== 'tool_use' || block.name !== 'edit_prototype') continue
    const input = block.input as { old_string?: unknown; new_string?: unknown }
    const oldString = typeof input.old_string === 'string' ? input.old_string : ''
    const newString = typeof input.new_string === 'string' ? input.new_string : ''
    const result = applyPrototypeEdit(html, oldString, newString)
    html = result.html
    if (result.applied) appliedEdits += 1
  }

  return { html, appliedEdits }
}

function parsePrototypeRequest(req: express.Request): PrototypeRequest {
  const body = req.body as PrototypeRequest
  if (body && Object.keys(body).length > 0) return body
  const payload = typeof req.query.payload === 'string' ? req.query.payload : ''
  if (!payload) return body
  try {
    return JSON.parse(payload) as PrototypeRequest
  } catch {
    return body
  }
}

function buildImageBlocks(images: ContentBlock[] | null | undefined): Anthropic.ImageBlockParam[] {
  return Array.isArray(images)
    ? images
        .filter((b): b is ContentBlock & { type: 'image'; source: { type: 'base64'; media_type: string; data: string } } => (
          b?.type === 'image' && b.source?.type === 'base64'
        ))
        .map((b) => ({ type: 'image', source: b.source as Anthropic.Base64ImageSource }))
    : []
}

function buildContentWithImages(prompt: string, imageBlocks: Anthropic.ImageBlockParam[]): Anthropic.ContentBlockParam[] | string {
  return imageBlocks.length > 0 ? [...imageBlocks, { type: 'text', text: prompt }] : prompt
}

function parseFigmaFrameUrl(rawUrl: string) {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Figma 链接格式无效，请粘贴 figma.com 的 frame 链接。')
  }

  const keyMatch = parsed.pathname.match(/\/(?:file|design|proto)\/([A-Za-z0-9]+)/u)
  const fileKey = keyMatch?.[1]
  if (!fileKey) {
    throw new Error('无法从链接中识别 Figma file key，请确认链接来自 figma.com/file、figma.com/design 或 figma.com/proto。')
  }

  const rawNodeId = parsed.searchParams.get('node-id') ?? parsed.searchParams.get('node_id') ?? ''
  const nodeId = rawNodeId.trim().replace(/-/g, ':')
  if (!nodeId) {
    throw new Error('请在 Figma 中选中具体 Frame 后复制链接，链接里需要包含 node-id。')
  }

  return { fileKey, nodeId, sourceUrl: parsed.toString() }
}

interface FigmaApiBounds {
  x?: number
  y?: number
  width?: number
  height?: number
}

interface FigmaApiNode {
  id: string
  name: string
  type: string
  visible?: boolean
  characters?: string
  absoluteBoundingBox?: FigmaApiBounds
  absoluteRenderBounds?: FigmaApiBounds | null
  children?: FigmaApiNode[]
}

interface FigmaFileNodesResponse {
  name?: string
  nodes?: Record<string, { document?: FigmaApiNode | null }>
}

interface FigmaImageRenderResponse {
  err?: string | null
  images?: Record<string, string | null>
  status?: number
}

interface FigmaImageCandidate {
  node: FigmaApiNode
  width: number
  height: number
  area: number
  depth: number
  score: number
  pathIds: string[]
  isRoot: boolean
}

function figmaApiUrl(routePath: string) {
  return `${figmaApiBaseUrl}/${routePath.replace(/^\/+/, '')}`
}

async function fetchFigmaJson<T>(url: string, token: string, label: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'X-Figma-Token': token,
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw new Error(`${label}：HTTP ${response.status}${await readResponseSnippet(response)}`)
  }
  return await response.json() as T
}

function figmaNodeBounds(node: FigmaApiNode): { x: number; y: number; width: number; height: number } | null {
  const bounds = node.absoluteBoundingBox ?? node.absoluteRenderBounds
  const width = typeof bounds?.width === 'number' && Number.isFinite(bounds.width) ? bounds.width : 0
  const height = typeof bounds?.height === 'number' && Number.isFinite(bounds.height) ? bounds.height : 0
  if (width <= 0 || height <= 0) return null
  return {
    x: typeof bounds?.x === 'number' && Number.isFinite(bounds.x) ? bounds.x : 0,
    y: typeof bounds?.y === 'number' && Number.isFinite(bounds.y) ? bounds.y : 0,
    width,
    height,
  }
}

function isFigmaContainerType(type: string) {
  return ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET', 'SECTION'].includes(type)
}

function isLowSignalFigmaType(type: string) {
  return ['TEXT', 'VECTOR', 'LINE', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON'].includes(type)
}

function figmaNodeScore(node: FigmaApiNode, area: number, depth: number) {
  let score = area
  if (isFigmaContainerType(node.type)) score *= 1.55
  if (['FRAME', 'COMPONENT', 'INSTANCE'].includes(node.type)) score *= 1.2
  if (depth === 1) score *= 1.25
  if (isLowSignalFigmaType(node.type)) score *= 0.28
  return score
}

function collectFigmaImageCandidates(root: FigmaApiNode, rootArea: number) {
  const candidates: FigmaImageCandidate[] = []
  const minContainerArea = Math.max(3600, rootArea * 0.025)
  const minLeafArea = Math.max(7200, rootArea * 0.08)

  function walk(node: FigmaApiNode, depth: number, pathIds: string[]) {
    if (node.visible === false) return
    const bounds = figmaNodeBounds(node)
    if (bounds) {
      const area = bounds.width * bounds.height
      const isContainer = isFigmaContainerType(node.type)
      const minArea = isContainer ? minContainerArea : minLeafArea
      if (depth > 0 && depth <= 4 && bounds.width >= 24 && bounds.height >= 24 && area >= minArea) {
        candidates.push({
          node,
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
          area,
          depth,
          score: figmaNodeScore(node, area, depth),
          pathIds,
          isRoot: false,
        })
      }
    }

    if (depth >= 4) return
    for (const child of node.children ?? []) {
      walk(child, depth + 1, [...pathIds, child.id])
    }
  }

  for (const child of root.children ?? []) {
    walk(child, 1, [root.id, child.id])
  }

  return candidates
}

function candidatesOverlap(a: FigmaImageCandidate, b: FigmaImageCandidate) {
  return a.pathIds.includes(b.node.id) || b.pathIds.includes(a.node.id)
}

function compareFigmaVisualOrder(a: FigmaImageCandidate, b: FigmaImageCandidate) {
  const aBounds = figmaNodeBounds(a.node)
  const bBounds = figmaNodeBounds(b.node)
  return a.depth - b.depth
    || (aBounds?.y ?? 0) - (bBounds?.y ?? 0)
    || (aBounds?.x ?? 0) - (bBounds?.x ?? 0)
}

function selectFigmaExportCandidates(root: FigmaApiNode) {
  const rootBounds = figmaNodeBounds(root)
  if (!rootBounds) throw new Error('Figma Frame 缺少可导出的尺寸信息。请确认链接选中的是 Frame、Component 或可渲染节点。')
  const rootCandidate: FigmaImageCandidate = {
    node: root,
    width: Math.round(rootBounds.width),
    height: Math.round(rootBounds.height),
    area: rootBounds.width * rootBounds.height,
    depth: 0,
    score: rootBounds.width * rootBounds.height,
    pathIds: [root.id],
    isRoot: true,
  }

  const selectedChildren: FigmaImageCandidate[] = []
  const candidates = collectFigmaImageCandidates(root, rootCandidate.area)
    .sort((a, b) => b.score - a.score)

  for (const candidate of candidates) {
    if (selectedChildren.some((selected) => candidatesOverlap(selected, candidate))) continue
    selectedChildren.push(candidate)
    if (selectedChildren.length >= FIGMA_EXTRACT_MAX_IMAGES - 1) break
  }

  return [rootCandidate, ...selectedChildren.sort(compareFigmaVisualOrder)]
}

async function fetchFigmaSelectedNode(fileKey: string, nodeId: string, token: string) {
  const url = new URL(figmaApiUrl(`/v1/files/${encodeURIComponent(fileKey)}/nodes`))
  url.searchParams.set('ids', nodeId)
  url.searchParams.set('depth', '8')
  const data = await fetchFigmaJson<FigmaFileNodesResponse>(url.toString(), token, '读取 Figma 节点失败')
  const entry = data.nodes?.[nodeId] ?? data.nodes?.[nodeId.replace(/:/g, '-')]
  const document = entry?.document
  if (!document) {
    throw new Error('Figma 返回中没有找到选中的节点。请确认 token 有权限访问该文件，且链接包含有效 node-id。')
  }
  return document
}

async function fetchFigmaImageUrl(fileKey: string, token: string, nodeId: string, scale: number) {
  const url = new URL(figmaApiUrl(`/v1/images/${encodeURIComponent(fileKey)}`))
  url.searchParams.set('ids', nodeId)
  url.searchParams.set('format', 'png')
  url.searchParams.set('scale', String(scale))
  url.searchParams.set('use_absolute_bounds', 'true')
  url.searchParams.set('contents_only', 'true')
  const data = await fetchFigmaJson<FigmaImageRenderResponse>(url.toString(), token, '导出 Figma 子图失败')
  if (data.err) throw new Error(`导出 Figma 子图失败：${data.err}`)
  const imageUrl = data.images?.[nodeId] ?? data.images?.[nodeId.replace(/:/g, '-')]
  if (!imageUrl) throw new Error(`Figma 未返回 ${nodeId} 的图片地址。`)
  return imageUrl
}

function uniqueScales(scales: number[]) {
  return Array.from(new Set(scales.map((scale) => Math.max(0.25, Math.min(3, Number(scale.toFixed(2)))))))
}

function figmaExportScales(candidate: FigmaImageCandidate) {
  const maxEdge = Math.max(candidate.width, candidate.height)
  const base = candidate.isRoot ? Math.min(FIGMA_IMAGE_SCALE, 0.75) : FIGMA_IMAGE_SCALE
  if (maxEdge >= 3000) return uniqueScales([Math.min(base, 0.5), 0.35, 0.25])
  if (maxEdge >= 2000) return uniqueScales([Math.min(base, 0.75), 0.5, 0.35])
  if (candidate.isRoot) return uniqueScales([base, 0.5, 0.35])
  return uniqueScales([base, 1, 0.75, 0.5])
}

function extensionForMediaType(mediaType: string) {
  if (mediaType.includes('jpeg')) return 'jpg'
  if (mediaType.includes('webp')) return 'webp'
  if (mediaType.includes('gif')) return 'gif'
  return 'png'
}

function normalizeImageMediaType(mediaType: string | null) {
  const clean = mediaType?.split(';')[0]?.trim().toLowerCase()
  if (clean === 'image/jpeg' || clean === 'image/png' || clean === 'image/gif' || clean === 'image/webp') return clean
  return 'image/png'
}

function sanitizeFigmaAssetName(value: string) {
  const sanitized = value
    .replace(/[<>:"\\|?*\x00-\x1F]/g, '-')
    .replace(/[^\w一-鿿.-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48)
    .replace(/^-|-$/g, '')
  return sanitized || 'figma-node'
}

function figmaAssetPath(candidate: FigmaImageCandidate, index: number, mediaType: string) {
  const order = String(index + 1).padStart(2, '0')
  const nodeId = candidate.node.id.replace(/[^a-z0-9_-]+/giu, '-').replace(/-+/g, '-')
  const ext = extensionForMediaType(mediaType)
  return `figma-export/${order}-${sanitizeFigmaAssetName(candidate.node.name)}-${nodeId}.${ext}`
}

async function downloadFigmaImageBytes(imageUrl: string, label: string) {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error(`${label} 下载失败：HTTP ${response.status}${await readResponseSnippet(response)}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > FIGMA_MAX_IMAGE_BYTES) {
    throw new Error(`${label} 超过 ${Math.round(FIGMA_MAX_IMAGE_BYTES / 1024 / 1024)}MB，已跳过。可降低 FIGMA_IMAGE_SCALE 或提高 FIGMA_MAX_IMAGE_BYTES。`)
  }
  return {
    bytes,
    mediaType: normalizeImageMediaType(response.headers.get('content-type')),
  }
}

async function importFigmaFrame(payload: FigmaFrameRequest, assetBaseUrl: string): Promise<FigmaFrameResponse> {
  const rawUrl = payload.url?.trim()
  if (!rawUrl) throw new Error('请填写 Figma Frame 链接。')
  const token = payload.token?.trim() || figmaToken.trim()
  if (!token) throw new Error('未配置 FIGMA_TOKEN。请在项目 .env 或 server/.env 中配置 Figma token，前端只需要粘贴 Figma 链接。')

  const { fileKey, nodeId, sourceUrl } = parseFigmaFrameUrl(rawUrl)
  const root = await fetchFigmaSelectedNode(fileKey, nodeId, token)
  const candidates = selectFigmaExportCandidates(root)
  const exportCandidates = [
    ...candidates.filter((candidate) => !candidate.isRoot),
    ...candidates.filter((candidate) => candidate.isRoot),
  ]
  const downloaded: Array<{
    candidate: FigmaImageCandidate
    bytes: Uint8Array
    data: string
    mediaType: string
    assetPath: string
    scale: number
    numericTextSlots: FigmaNumericTextSlot[]
  }> = []
  const skipped: string[] = []

  for (const [index, candidate] of exportCandidates.entries()) {
    const label = candidate.isRoot ? 'Figma 整帧' : `Figma 子图 ${index + 1}`
    let exported = false
    for (const scale of figmaExportScales(candidate)) {
      try {
        const url = await fetchFigmaImageUrl(fileKey, token, candidate.node.id, scale)
        const image = await downloadFigmaImageBytes(url, `${label} @${scale}x`)
        const numericTextSlots = collectFigmaNumericTextSlots(candidate.node)
        const bytes = image.mediaType === 'image/png'
          ? redactNumericTextFromPng(image.bytes, numericTextSlots, { width: candidate.width, height: candidate.height })
          : image.bytes
        downloaded.push({
          candidate,
          bytes,
          mediaType: image.mediaType,
          scale,
          numericTextSlots,
          data: Buffer.from(bytes).toString('base64'),
          assetPath: figmaAssetPath(candidate, index, image.mediaType),
        })
        exported = true
        break
      } catch (err) {
        console.warn(`[figma] export ${candidate.node.id} at ${scale}x failed:`, err)
      }
    }

    if (!exported) {
      skipped.push(`${candidate.node.name || candidate.node.id} (${candidate.node.type})`)
    }
  }

  if (!downloaded.length) {
    throw new Error('Figma 已返回节点结构，但所有候选图都导出失败。请选中更小的 Frame，或降低 FIGMA_IMAGE_SCALE / FIGMA_EXTRACT_MAX_IMAGES 后重试。')
  }

  downloaded.sort((a, b) => Number(b.candidate.isRoot) - Number(a.candidate.isRoot) || compareFigmaVisualOrder(a.candidate, b.candidate))

  const files = Object.fromEntries(downloaded.map((image) => [image.assetPath, image.bytes]))
  const bundleId = registerFigmaAssetBundle(files)
  const images = downloaded.map((image): FigmaExtractedImage => ({
    nodeId: image.candidate.node.id,
    name: image.candidate.node.name || (image.candidate.isRoot ? 'Selected Frame' : 'Figma Child'),
    type: image.candidate.node.type,
    width: image.candidate.width,
    height: image.candidate.height,
    depth: image.candidate.depth,
    mediaType: image.mediaType,
    data: image.data,
    assetPath: image.assetPath,
    assetUrl: buildAssetUrl(assetBaseUrl, bundleId, image.assetPath),
    numericTextSlots: image.numericTextSlots,
  }))
  const hasRootImage = images.some((image) => image.depth === 0)
  const childCount = images.filter((image) => image.depth > 0).length
  const numericSlotCount = images.reduce((sum, image) => sum + image.numericTextSlots.length, 0)
  const panelName = root.name || 'Figma Frame'
  const skippedText = skipped.length ? `，另有 ${skipped.length} 个过大/超时节点已跳过` : ''
  const numericText = numericSlotCount ? `，已去除 ${numericSlotCount} 处示例数值并保留真实数值占位坐标` : ''

  return {
    fileKey,
    nodeId,
    panelName,
    sourceUrl,
    images,
    imageCount: images.length,
    summary: `已从 Figma 直接提取「${panelName}」视觉证据：${hasRootImage ? '整帧 1 张、' : ''}子图 ${childCount} 张${skippedText}${numericText}。将结合当前 PRD 节点内容流式生成 HTML 原型。`,
  }
}

interface FigmaConvertTaskResponse {
  taskId?: string
  id?: string
}

interface FigmaTaskProgressResponse {
  status?: string
  progress?: number
  currentStep?: string
  message?: string
  error?: string
}

interface UiSpecRect {
  x: number
  y: number
  width: number
  height: number
}

interface UiSpecAsset {
  name: string
  path: string
  format?: string
}

interface UiSpecNode {
  name: string
  type: string
  rect: UiSpecRect
  asset?: string
  properties?: Record<string, unknown>
  children?: UiSpecNode[]
  visible?: boolean
}

interface UiSpecDocument {
  version?: string
  engine?: string
  designSize?: { width?: number; height?: number }
  root?: UiSpecNode
  assets?: UiSpecAsset[]
}

function joinServiceUrl(baseUrl: string, routePath: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${routePath.replace(/^\/+/, '')}`
}

async function readResponseSnippet(response: Response) {
  const body = await response.text().catch(() => '')
  return body ? `：${body.slice(0, 240)}` : ''
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeZipPath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function safeZipPathSegments(value: string) {
  const normalized = normalizeZipPath(value)
  const segments = normalized.split('/').filter(Boolean)
  return segments.length > 0 && segments.every((segment) => segment !== '.' && segment !== '..') ? segments : null
}

function resolveCachedFigmaAssetPath(bundleId: string, assetPath: string) {
  if (!/^[a-z0-9-]+$/iu.test(bundleId)) return null
  const segments = safeZipPathSegments(assetPath)
  if (!segments) return null
  const resolved = path.resolve(FIGMA_ASSET_CACHE_ROOT, bundleId, ...segments)
  const bundleRoot = path.resolve(FIGMA_ASSET_CACHE_ROOT, bundleId)
  return resolved === bundleRoot || resolved.startsWith(`${bundleRoot}${path.sep}`) ? resolved : null
}

function persistFigmaAssetBundleFiles(bundleId: string, files: Record<string, Uint8Array>) {
  for (const [filePath, bytes] of Object.entries(files)) {
    const resolved = resolveCachedFigmaAssetPath(bundleId, filePath)
    if (!resolved) continue
    mkdirSync(path.dirname(resolved), { recursive: true })
    writeFileSync(resolved, bytes)
  }
}

function buildZipLookup(files: Record<string, Uint8Array>) {
  return new Map(Object.keys(files).map((filePath) => [normalizeZipPath(filePath).toLowerCase(), filePath]))
}

function findZipFile(files: Record<string, Uint8Array>, lookup: Map<string, string>, candidatePath: string) {
  const normalized = normalizeZipPath(candidatePath)
  return files[normalized] ?? files[lookup.get(normalized.toLowerCase()) ?? '']
}

function mimeTypeForPath(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'svg') return 'image/svg+xml'
  return 'image/png'
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(value: unknown) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function cssNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function propString(properties: Record<string, unknown> | undefined, key: string) {
  return normalizeTextValue(properties?.[key])
}

function propNumber(properties: Record<string, unknown> | undefined, key: string) {
  const value = properties?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeTextAlign(value: string | null) {
  const text = value?.toLowerCase()
  if (text === 'left' || text === 'right' || text === 'center') return text
  return 'center'
}

function labelStyleFor(node: UiSpecNode) {
  const props = node.properties
  const fontSize = propNumber(props, 'fontSize') ?? Math.max(10, Math.round(node.rect.height * 0.55))
  const color = propString(props, 'color') ?? '#ffffff'
  const weight = propNumber(props, 'fontWeight') ?? 600
  const align = normalizeTextAlign(propString(props, 'textAlign'))
  const strokeWidth = propNumber(props, 'strokeWidth') ?? 0
  const strokeColor = propString(props, 'strokeColor') ?? 'rgba(0,0,0,0.45)'
  const shadow = strokeWidth > 0
    ? `text-shadow:${Array.from({ length: Math.min(4, Math.max(1, Math.round(strokeWidth))) }, (_, index) => {
        const offset = index + 1
        return `${offset}px ${offset}px 0 ${strokeColor}, -${offset}px ${offset}px 0 ${strokeColor}, ${offset}px -${offset}px 0 ${strokeColor}, -${offset}px -${offset}px 0 ${strokeColor}`
      }).join(',')};`
    : ''
  return [
    `font-size:${fontSize}px`,
    `color:${color}`,
    `font-weight:${weight}`,
    `text-align:${align}`,
    `justify-content:${align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'}`,
    shadow,
  ].filter(Boolean).join(';')
}

function countUiSpecNodes(node: UiSpecNode | undefined): number {
  if (!node) return 0
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countUiSpecNodes(child), 0)
}

function renderUiSpecNode(node: UiSpecNode, assetUrls: Map<string, string>, depth = 0): string {
  const rect = node.rect ?? { x: 0, y: 0, width: 0, height: 0 }
  const type = node.type || 'Node'
  const children = (node.children ?? []).map((child) => renderUiSpecNode(child, assetUrls, depth + 1)).join('\n')
  const visibleStyle = node.visible === false ? 'display:none;' : ''
  const commonStyle = [
    `left:${cssNumber(rect.x)}px`,
    `top:${cssNumber(rect.y)}px`,
    `width:${Math.max(1, cssNumber(rect.width, 1))}px`,
    `height:${Math.max(1, cssNumber(rect.height, 1))}px`,
    `z-index:${depth}`,
    visibleStyle,
  ].filter(Boolean).join(';')
  const assetUrl = node.asset ? assetUrls.get(node.asset) : null
  const safeName = escapeAttr(node.name || type)
  const className = `pf-node pf-${type.toLowerCase()}`
  const imageHtml = assetUrl
    ? `<img class="pf-asset" src="${escapeAttr(assetUrl)}" alt="" draggable="false" />`
    : ''

  if (type === 'Label') {
    const text = propString(node.properties, 'text') ?? node.name ?? ''
    return `<div class="${className}" data-node="${safeName}" style="${commonStyle};${labelStyleFor(node)}">${escapeHtml(text)}</div>`
  }

  const isInteractive = ['Button', 'Toggle', 'TabGroup'].includes(type)
  if (isInteractive) {
    const label = propString(node.properties, 'text') ?? node.name ?? type
    return `<button type="button" class="${className}" data-node="${safeName}" aria-label="${escapeAttr(label)}" style="${commonStyle}">${imageHtml}${children}</button>`
  }

  const overflow = type === 'ScrollView' ? 'overflow:auto;' : 'overflow:visible;'
  return `<div class="${className}" data-node="${safeName}" style="${commonStyle};${overflow}">${imageHtml}${children}</div>`
}

function findPreferredUiSpecPath(files: Record<string, Uint8Array>) {
  const candidates = Object.keys(files).filter((filePath) => /(^|\/)ui_spec\.json$/iu.test(normalizeZipPath(filePath)))
  if (!candidates.length) throw new Error('Figma2Prefab 结果 zip 中未找到 ui_spec.json。')
  return (
    candidates.find((filePath) => /(^|\/)uislots[^/]*\/ui_spec\.json$/iu.test(normalizeZipPath(filePath)))
    ?? candidates.find((filePath) => /(^|\/)ui_slots[^/]*\/ui_spec\.json$/iu.test(normalizeZipPath(filePath)))
    ?? candidates[0]
  )
}

function registerFigmaAssetBundle(files: Record<string, Uint8Array>) {
  const bundleId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const bundle: FigmaAssetBundle = {
    createdAt: Date.now(),
    files,
    lookup: buildZipLookup(files),
  }
  persistFigmaAssetBundleFiles(bundleId, files)
  figmaAssetBundles.set(bundleId, bundle)
  setTimeout(() => {
    const current = figmaAssetBundles.get(bundleId)
    if (current && current.createdAt === bundle.createdAt) figmaAssetBundles.delete(bundleId)
  }, FIGMA_ASSET_BUNDLE_TTL_MS)
  return bundleId
}

function buildAssetUrl(baseUrl: string, bundleId: string, filePath: string) {
  return `${baseUrl.replace(/\/+$/, '')}/api/figma/assets/${encodeURIComponent(bundleId)}/${normalizeZipPath(filePath).split('/').map(encodeURIComponent).join('/')}`
}

function buildFigmaPrototypeHtml(spec: UiSpecDocument, uiSpecPath: string, bundleId: string, assetBaseUrl: string) {
  if (!spec.root?.rect) throw new Error('ui_spec.json 缺少 root.rect，无法生成 HTML 原型。')
  const folder = normalizeZipPath(uiSpecPath).replace(/\/?ui_spec\.json$/iu, '')
  const designWidth = Math.max(1, Math.round(spec.designSize?.width ?? spec.root.rect.width ?? 750))
  const designHeight = Math.max(1, Math.round(spec.designSize?.height ?? spec.root.rect.height ?? 1624))
  const assetUrls = new Map<string, string>()
  for (const asset of spec.assets ?? []) {
    if (!asset.name || !asset.path) continue
    const assetPath = `${folder}/${asset.path}`
    assetUrls.set(asset.name, buildAssetUrl(assetBaseUrl, bundleId, assetPath))
  }
  const body = renderUiSpecNode(spec.root, assetUrls)
  const nodeCount = countUiSpecNodes(spec.root)

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(spec.root.name)} Figma Prototype</title>
  <style>
    :root { --pf-scale: 1; color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-width: 375px; min-height: 100vh; overflow-x: hidden; background: #05070d; font-family: Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
    body { display: flex; justify-content: center; align-items: flex-start; }
    .pf-shell { position: relative; width: ${designWidth}px; height: ${designHeight}px; flex: 0 0 auto; overflow: visible; }
    .pf-stage { position: absolute; left: 0; top: 0; width: ${designWidth}px; height: ${designHeight}px; overflow: hidden; transform: scale(var(--pf-scale)); transform-origin: top left; background: #05070d; }
    .pf-node { position: absolute; margin: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; }
    .pf-node:focus-visible { outline: 3px solid rgba(255,255,255,0.65); outline-offset: 2px; }
    .pf-button, .pf-toggle, .pf-tabgroup { cursor: pointer; transition: filter 120ms ease, transform 120ms ease; }
    .pf-button:active, .pf-toggle:active, .pf-tabgroup:active, .pf-node[data-active="true"] { filter: brightness(1.15) saturate(1.1); transform: scale(0.985); }
    .pf-label { display: flex; align-items: center; white-space: nowrap; line-height: 1; overflow: hidden; pointer-events: none; }
    .pf-asset { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; pointer-events: none; user-select: none; }
  </style>
</head>
<body>
  <main class="pf-shell" aria-label="${escapeAttr(spec.root.name)}">
    <section class="pf-stage" data-generator="figma2prefab" data-node-count="${nodeCount}">
${body}
    </section>
  </main>
  <script>
    (() => {
      const designWidth = ${designWidth};
      const designHeight = ${designHeight};
      const shell = document.querySelector('.pf-shell');
      const resize = () => {
        const scale = Math.max(0.01, Math.min(1, window.innerWidth / designWidth));
        document.documentElement.style.setProperty('--pf-scale', String(scale));
        shell.style.width = Math.round(designWidth * scale) + 'px';
        shell.style.height = Math.round(designHeight * scale) + 'px';
      };
      window.addEventListener('resize', resize);
      resize();
      document.querySelectorAll('.pf-button, .pf-toggle, .pf-tabgroup').forEach((node) => {
        node.addEventListener('click', () => {
          node.dataset.active = 'true';
          window.setTimeout(() => { node.dataset.active = 'false'; }, 180);
        });
      });
    })();
  </script>
</body>
</html>`
}

async function submitFigma2PrefabTask(rawUrl: string, token: string) {
  const response = await fetch(joinServiceUrl(figma2PrefabBaseUrl, figma2PrefabConvertPath), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      figmaUrl: rawUrl,
      figmaToken: token,
      ...(figma2PrefabProvider ? { provider: figma2PrefabProvider } : {}),
    }),
  })

  const contentType = response.headers.get('content-type') ?? ''
  if (!response.ok) {
    throw new Error(`Figma2Prefab 提交失败：HTTP ${response.status}${await readResponseSnippet(response)}`)
  }
  if (contentType.includes('application/zip')) {
    return { taskId: null, zipBytes: new Uint8Array(await response.arrayBuffer()) }
  }
  const data = await response.json() as FigmaConvertTaskResponse
  const taskId = normalizeTextValue(data.taskId ?? data.id)
  if (!taskId) throw new Error('Figma2Prefab 未返回 taskId。')
  return { taskId, zipBytes: null }
}

async function waitForFigma2PrefabTask(taskId: string) {
  const deadline = Date.now() + FIGMA2PREFAB_TIMEOUT_MS
  let lastMessage = '等待执行'
  while (Date.now() < deadline) {
    const response = await fetch(joinServiceUrl(figma2PrefabBaseUrl, `/api/tasks/${encodeURIComponent(taskId)}/progress`))
    if (!response.ok) {
      throw new Error(`Figma2Prefab 进度查询失败：HTTP ${response.status}${await readResponseSnippet(response)}`)
    }
    const progress = await response.json() as FigmaTaskProgressResponse
    lastMessage = [progress.currentStep, progress.message].filter(Boolean).join(' / ') || lastMessage
    if (progress.status === 'completed') return
    if (progress.status === 'failed' || progress.status === 'error') {
      throw new Error(progress.error || progress.message || 'Figma2Prefab 转换失败。')
    }
    await sleep(Math.max(500, FIGMA2PREFAB_POLL_INTERVAL_MS))
  }
  throw new Error(`Figma2Prefab 转换超时：${lastMessage}`)
}

async function downloadFigma2PrefabZip(taskId: string) {
  const response = await fetch(joinServiceUrl(figma2PrefabBaseUrl, `/api/tasks/${encodeURIComponent(taskId)}/result`))
  if (!response.ok) {
    throw new Error(`Figma2Prefab 结果下载失败：HTTP ${response.status}${await readResponseSnippet(response)}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

function decodeUiSpec(files: Record<string, Uint8Array>, uiSpecPath: string) {
  const data = files[uiSpecPath]
  if (!data) throw new Error('无法读取 ui_spec.json。')
  return JSON.parse(strFromU8(data)) as UiSpecDocument
}

async function importFigmaFrameFromPrefab(payload: FigmaFrameRequest, assetBaseUrl: string): Promise<FigmaPrefabFrameResponse> {
  const rawUrl = payload.url?.trim()
  if (!rawUrl) throw new Error('请填写 Figma Frame 链接。')
  const token = payload.token?.trim() || figmaToken.trim()
  if (!token) throw new Error('未配置 FIGMA_TOKEN。请在项目 .env 或 server/.env 中配置 Figma token，前端只需要粘贴 Figma 链接。')

  const { fileKey, nodeId, sourceUrl } = parseFigmaFrameUrl(rawUrl)
  const submitted = await submitFigma2PrefabTask(rawUrl, token)
  let zipBytes = submitted.zipBytes
  if (!zipBytes) {
    if (!submitted.taskId) throw new Error('Figma2Prefab 未返回 taskId 或 zip 数据。')
    await waitForFigma2PrefabTask(submitted.taskId)
    zipBytes = await downloadFigma2PrefabZip(submitted.taskId)
  }
  const files = unzipSync(zipBytes)
  const uiSpecPath = findPreferredUiSpecPath(files)
  const spec = decodeUiSpec(files, uiSpecPath)
  const bundleId = registerFigmaAssetBundle(files)
  const html = buildFigmaPrototypeHtml(spec, uiSpecPath, bundleId, assetBaseUrl)
  const panelName = spec.root?.name ?? normalizeZipPath(uiSpecPath).split('/').slice(-2, -1)[0] ?? 'UISlots'
  const assetCount = spec.assets?.length ?? 0

  return {
    fileKey,
    nodeId,
    panelName,
    taskId: submitted.taskId,
    sourceUrl,
    html,
    summary: `已从 Figma2Prefab 生成 ${panelName} HTML 原型：${assetCount} 个资源、${countUiSpecNodes(spec.root)} 个节点。`,
    uiSpecPath,
    assetCount,
    zipFileCount: Object.keys(files).length,
  }
}

type OpenAiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAiMessageContent = string | OpenAiContentBlock[] | null | undefined

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: OpenAiMessageContent
    }
  }>
}

interface OpenAiChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
    }
  }>
}

function buildOpenAiContentWithImages(prompt: string, imageBlocks: Anthropic.ImageBlockParam[]): string | OpenAiContentBlock[] {
  if (!imageBlocks.length) return prompt
  return [
    ...imageBlocks.map((block): OpenAiContentBlock => {
      const source = block.source as Anthropic.Base64ImageSource
      return {
        type: 'image_url',
        image_url: { url: `data:${source.media_type};base64,${source.data}` },
      }
    }),
    { type: 'text', text: prompt },
  ]
}

function extractOpenAiText(content: OpenAiMessageContent): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
  }
  return ''
}

async function createOpenAiChatCompletionText(prompt: string, imageBlocks: Anthropic.ImageBlockParam[], temperature?: number): Promise<string> {
  if (!openAiApiKey) throw new Error('未配置可用的 GPT API Key。请在 server/.env 中设置 ANTHROPIC_API_KEY，或设置 OPENAI_API_KEY。')

  const response = await fetch(`${openAiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: buildOpenAiContentWithImages(prompt, imageBlocks) }],
      temperature: temperature === 1 ? undefined : temperature,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`GPT 原型生成请求失败：HTTP ${response.status}${body ? `，${body}` : ''}`)
  }

  const data = await response.json() as OpenAiChatCompletionResponse
  const text = extractOpenAiText(data.choices?.[0]?.message?.content).trim()
  if (!text) throw new Error('GPT 原型生成未返回文本内容。')
  return text
}

async function streamOpenAiChatCompletionText(
  prompt: string,
  imageBlocks: Anthropic.ImageBlockParam[],
  temperature: number,
  onDelta: (delta: string) => void,
): Promise<string> {
  if (!openAiApiKey) throw new Error('未配置可用的 GPT API Key。请在 server/.env 中设置 ANTHROPIC_API_KEY，或设置 OPENAI_API_KEY。')

  const response = await fetch(`${openAiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: buildOpenAiContentWithImages(prompt, imageBlocks) }],
      temperature: temperature === 1 ? undefined : temperature,
      stream: true,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`GPT 原型流式生成请求失败：HTTP ${response.status}${body ? `，${body}` : ''}`)
  }
  if (!response.body) throw new Error('GPT 原型流式生成未返回响应流。')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''

  function handleLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice('data:'.length).trim()
    if (!payload || payload === '[DONE]') return
    const chunk = JSON.parse(payload) as OpenAiChatCompletionChunk
    const delta = chunk.choices?.[0]?.delta?.content ?? ''
    if (!delta) return
    accumulated += delta
    onDelta(delta)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(line)
  }

  buffer += decoder.decode()
  if (buffer) handleLine(buffer)
  if (!accumulated.trim()) throw new Error('GPT 原型流式生成未返回文本内容。')
  return accumulated
}

function ensurePrototypeProviderConfigured(res: express.Response) {
  if (usesOpenAiPrototypeProvider) {
    if (!openAiApiKey) {
      res.status(400).json({ error: '未配置可用的 GPT API Key。请在 server/.env 中设置 ANTHROPIC_API_KEY，或设置 OPENAI_API_KEY。' })
      return false
    }
    return true
  }

  if (!anthropic) {
    res.status(400).json({ error: '未配置 ANTHROPIC_API_KEY。' })
    return false
  }
  return true
}

function normalizePrototypeModelResponse(raw: string, label: string) {
  const html = normalizeGeneratedPrototypeHtml(raw)
  if (!html) throw new Error(`${label} 未返回完整 HTML 文档。请重试。`)
  return html
}

function errorMessageFromUnknown(error: unknown, fallback = '原型生成失败。') {
  return error instanceof Error && error.message ? error.message : fallback
}

function truncateForPrototypeRepair(input: string, maxLength = 8000) {
  const trimmed = input.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength)}\n\n<!-- 内容过长，已截断 -->`
}

function buildPrototypeHtmlRepairPrompt(originalPrompt: string, invalidOutput: string, reason: string) {
  return `${originalPrompt}

## 上一次输出不可用于预览
原因：${reason}

上一次输出如下，只用于定位错误，不能照抄其中的说明文字：
${truncateForPrototypeRepair(invalidOutput)}

## 强制修复输出
请重新输出一个完整、可直接预览的 HTML 文档。
- 只输出 HTML，不要解释。
- 必须以 <!doctype html> 或 <html> 开始，并包含 </html>。
- 不能输出 diff、patch、局部片段、Markdown 清单或自然语言说明。
- 必须保留本次用户修改目标，并在完整 HTML 中体现修改结果。`
}

async function createOpenAiPrototypeHtmlWithRepair(
  prompt: string,
  imageBlocks: Anthropic.ImageBlockParam[],
  temperature: number | undefined,
  label: string,
) {
  const raw = await createOpenAiChatCompletionText(prompt, imageBlocks, temperature)
  try {
    return normalizePrototypeModelResponse(raw, label)
  } catch (firstError) {
    console.warn(`[prototype] ${label} invalid HTML, retrying repair:`, firstError)
    const repairPrompt = buildPrototypeHtmlRepairPrompt(prompt, raw, errorMessageFromUnknown(firstError))
    const repairedRaw = await createOpenAiChatCompletionText(repairPrompt, imageBlocks, Math.min(temperature ?? 0.2, 0.2))
    try {
      return normalizePrototypeModelResponse(repairedRaw, `${label} 修复重试`)
    } catch (secondError) {
      throw new Error(`${label} 未生成可用 HTML：${errorMessageFromUnknown(secondError)}`)
    }
  }
}

async function streamOpenAiPrototypeHtmlWithRepair(
  prompt: string,
  imageBlocks: Anthropic.ImageBlockParam[],
  temperature: number | undefined,
  label: string,
  onPreview: (html: string) => void,
) {
  const streamRaw = async (nextPrompt: string, nextTemperature: number | undefined) => {
    let raw = ''
    let lastPreviewHtml = ''
    return await streamOpenAiChatCompletionText(nextPrompt, imageBlocks, nextTemperature ?? 0.2, (delta) => {
      raw += delta
      const previewHtml = normalizeGeneratedPrototypeHtml(raw)
      if (previewHtml && previewHtml !== lastPreviewHtml) {
        lastPreviewHtml = previewHtml
        onPreview(previewHtml)
      }
    })
  }

  const raw = await streamRaw(prompt, temperature)
  try {
    return normalizePrototypeModelResponse(raw, label)
  } catch (firstError) {
    console.warn(`[prototype] ${label} invalid streamed HTML, retrying repair:`, firstError)
    const repairPrompt = buildPrototypeHtmlRepairPrompt(prompt, raw, errorMessageFromUnknown(firstError))
    const repairedRaw = await streamRaw(repairPrompt, Math.min(temperature ?? 0.2, 0.2))
    try {
      return normalizePrototypeModelResponse(repairedRaw, `${label} 修复重试`)
    } catch (secondError) {
      throw new Error(`${label} 未生成可用 HTML：${errorMessageFromUnknown(secondError)}`)
    }
  }
}

async function createClaudePrototypeHtmlWithRepair(
  prompt: string,
  imageBlocks: Anthropic.ImageBlockParam[],
  temperature: number | undefined,
  label: string,
) {
  const createRaw = async (nextPrompt: string, nextTemperature: number | undefined) => {
    const response = await anthropic!.messages.create({
      model,
      max_tokens: 8192,
      temperature: nextTemperature === 1 ? undefined : nextTemperature,
      messages: [{ role: 'user', content: buildContentWithImages(nextPrompt, imageBlocks) }],
    })
    return textFromClaudeContent(response.content)
  }

  const raw = await createRaw(prompt, temperature)
  try {
    return normalizePrototypeModelResponse(raw, label)
  } catch (firstError) {
    console.warn(`[prototype] ${label} invalid HTML, retrying repair:`, firstError)
    const repairPrompt = buildPrototypeHtmlRepairPrompt(prompt, raw, errorMessageFromUnknown(firstError))
    const repairedRaw = await createRaw(repairPrompt, Math.min(temperature ?? 0.2, 0.2))
    try {
      return normalizePrototypeModelResponse(repairedRaw, `${label} 修复重试`)
    } catch (secondError) {
      throw new Error(`${label} 未生成可用 HTML：${errorMessageFromUnknown(secondError)}`)
    }
  }
}

async function generateUpdateVariant(
  requirementState: UXRequirementState,
  currentHtml: string,
  instruction: string,
  imageBlocks: Anthropic.ImageBlockParam[],
  cfg: { index: number; focus: string; temperature: number },
  history: string[],
): Promise<PrototypeVariantPayload> {
  const prompt = buildUpdatePrototypePrompt(requirementState, currentHtml, instruction, history, cfg.focus, imageBlocks.length > 0)
  if (usesOpenAiPrototypeProvider) {
    return {
      index: cfg.index,
      html: await createOpenAiPrototypeHtmlWithRepair(prompt, imageBlocks, cfg.temperature, 'GPT 原型更新'),
      mode: 'rewrite',
      status: 'complete',
      focus: cfg.focus,
      appliedEdits: 0,
      history: [...history, instruction],
    }
  }

  const response = await anthropic!.messages.create({
    model,
    max_tokens: 8192,
    tools: [editPrototypeTool],
    messages: [{ role: 'user', content: buildContentWithImages(prompt, imageBlocks) }],
  })

  const toolResult = applyPrototypeToolUses(currentHtml, response.content)
  const nextHistory = [...history, instruction]
  if (toolResult.appliedEdits > 0) {
    return {
      index: cfg.index,
      html: normalizePrototypeHtml(toolResult.html),
      mode: 'update',
      status: 'complete',
      focus: cfg.focus,
      appliedEdits: toolResult.appliedEdits,
      history: nextHistory,
    }
  }

  const raw = textFromClaudeContent(response.content)
  let normalizedRaw: string
  try {
    normalizedRaw = normalizePrototypeModelResponse(raw, 'Claude 原型更新')
  } catch (firstError) {
    console.warn('[prototype] Claude 原型更新 invalid HTML, retrying repair:', firstError)
    const repairPrompt = buildPrototypeHtmlRepairPrompt(prompt, raw, errorMessageFromUnknown(firstError))
    normalizedRaw = await createClaudePrototypeHtmlWithRepair(repairPrompt, imageBlocks, Math.min(cfg.temperature ?? 0.2, 0.2), 'Claude 原型更新')
  }
  return {
    index: cfg.index,
    html: normalizedRaw,
    mode: 'rewrite',
    status: 'complete',
    focus: cfg.focus,
    appliedEdits: 0,
    history: nextHistory,
  }
}

async function generateCreateVariant(
  requirementState: UXRequirementState,
  imageBlocks: Anthropic.ImageBlockParam[],
  cfg: { index: number; focus: string; temperature: number },
  instruction?: string,
): Promise<PrototypeVariantPayload> {
  const prompt = buildCreatePrototypePrompt(requirementState, imageBlocks.length > 0, cfg.focus, instruction)
  if (usesOpenAiPrototypeProvider) {
    return {
      index: cfg.index,
      html: await createOpenAiPrototypeHtmlWithRepair(prompt, imageBlocks, cfg.temperature, 'GPT 原型生成'),
      mode: 'create',
      status: 'complete',
      focus: cfg.focus,
      appliedEdits: 0,
      history: [],
    }
  }

  return {
    index: cfg.index,
    html: await createClaudePrototypeHtmlWithRepair(prompt, imageBlocks, cfg.temperature, 'Claude 原型生成'),
    mode: 'create',
    status: 'complete',
    focus: cfg.focus,
    appliedEdits: 0,
    history: [],
  }
}

function writePrototypeEvent(res: express.Response, event: unknown) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

async function streamPrototype(req: express.Request, res: express.Response) {
  const { requirementState, currentHtml, instruction, images, numVariants, variantIndex, history } = parsePrototypeRequest(req)

  if (!ensurePrototypeProviderConfigured(res)) return

  if (!requirementState) {
    res.status(400).json({ error: '缺少需求状态' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const imageBlocks = buildImageBlocks(images)
  const normalizedCurrentHtml = currentHtml ? normalizePrototypeHtml(currentHtml) : null
  const updateInstruction = instruction?.trim() ?? ''
  const isUpdate = Boolean(normalizedCurrentHtml && updateInstruction)
  const updateHistory = Array.isArray(history) ? history.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
  const configs = buildVariantConfigs(
    clampVariantCount(numVariants, isUpdate ? DEFAULT_UPDATE_VARIANTS : DEFAULT_CREATE_VARIANTS),
    isUpdate ? Math.max(0, variantIndex ?? 0) : 0,
  ).map((cfg) => ({ ...cfg, index: isUpdate ? (variantIndex ?? 0) + cfg.index : cfg.index }))

  await Promise.allSettled(configs.map(async (cfg) => {
    let html = ''
    let lastPreviewHtml = ''
    try {
      if (isUpdate) {
        if (usesOpenAiPrototypeProvider) {
          const prompt = buildUpdatePrototypePrompt(requirementState, normalizedCurrentHtml!, updateInstruction, updateHistory, cfg.focus, imageBlocks.length > 0)
          const normalized = await streamOpenAiPrototypeHtmlWithRepair(prompt, imageBlocks, cfg.temperature, 'GPT 原型更新', (previewHtml) => {
            writePrototypeEvent(res, { type: 'setCode', variantIndex: cfg.index, html: previewHtml, focus: cfg.focus, history: updateHistory })
          })
          const nextHistory = [...updateHistory, updateInstruction]
          writePrototypeEvent(res, { type: 'setCode', variantIndex: cfg.index, html: normalized, focus: cfg.focus, history: nextHistory })
          writePrototypeEvent(res, { type: 'variantComplete', variantIndex: cfg.index, html: normalized, focus: cfg.focus, history: nextHistory, mode: 'rewrite', appliedEdits: 0 })
          return
        }

        const variant = await generateUpdateVariant(requirementState, normalizedCurrentHtml!, updateInstruction, imageBlocks, cfg, updateHistory)
        writePrototypeEvent(res, { type: 'setCode', variantIndex: cfg.index, html: variant.html, focus: cfg.focus, history: variant.history })
        writePrototypeEvent(res, { type: 'variantComplete', variantIndex: cfg.index, html: variant.html, focus: cfg.focus, history: variant.history, mode: variant.mode, appliedEdits: variant.appliedEdits })
        return
      }

      const prompt = buildCreatePrototypePrompt(requirementState, imageBlocks.length > 0, cfg.focus, updateInstruction)
      if (usesOpenAiPrototypeProvider) {
        const normalized = await streamOpenAiPrototypeHtmlWithRepair(prompt, imageBlocks, cfg.temperature, 'GPT 原型生成', (previewHtml) => {
          writePrototypeEvent(res, { type: 'setCode', variantIndex: cfg.index, html: previewHtml, focus: cfg.focus })
        })
        writePrototypeEvent(res, { type: 'setCode', variantIndex: cfg.index, html: normalized, focus: cfg.focus })
        writePrototypeEvent(res, { type: 'variantComplete', variantIndex: cfg.index, html: normalized, focus: cfg.focus, mode: 'create', appliedEdits: 0, history: [] })
        return
      }

      const stream = anthropic!.messages.stream({
        model,
        max_tokens: 8192,
        temperature: cfg.temperature === 1 ? undefined : cfg.temperature,
        messages: [{ role: 'user', content: buildContentWithImages(prompt, imageBlocks) }],
      })

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          html += event.delta.text
          const previewHtml = normalizeGeneratedPrototypeHtml(html)
          if (previewHtml && previewHtml !== lastPreviewHtml) {
            lastPreviewHtml = previewHtml
            writePrototypeEvent(res, { type: 'setCode', variantIndex: cfg.index, html: previewHtml, focus: cfg.focus })
          }
        }
      }
      const normalized = normalizePrototypeModelResponse(html, 'Claude 原型生成')
      writePrototypeEvent(res, { type: 'variantComplete', variantIndex: cfg.index, html: normalized, focus: cfg.focus, mode: 'create', appliedEdits: 0, history: [] })
    } catch (err) {
      console.error(`[prototype] stream variant ${cfg.index} failed:`, err)
      writePrototypeEvent(res, { type: 'variantError', variantIndex: cfg.index, focus: cfg.focus, message: errorMessageFromUnknown(err) })
    }
  }))

  writePrototypeEvent(res, { type: 'done' })
  res.end()
}

app.post('/api/prototype/stream', streamPrototype)

app.post('/api/prototype', async (req, res) => {
  const { requirementState, currentHtml, instruction, images } = parsePrototypeRequest(req)

  if (!ensurePrototypeProviderConfigured(res)) return

  if (!requirementState) {
    res.status(400).json({ error: '缺少需求状态' })
    return
  }

  const imageBlocks = buildImageBlocks(images)

  const normalizedCurrentHtml = currentHtml ? normalizePrototypeHtml(currentHtml) : null
  const updateInstruction = instruction?.trim() ?? ''
  const isUpdate = Boolean(normalizedCurrentHtml && updateInstruction)

  if (isUpdate) {
    const updateHistory = Array.isArray((req.body as PrototypeRequest).history)
      ? ((req.body as PrototypeRequest).history ?? []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []
    const baseIndex = typeof (req.body as PrototypeRequest).variantIndex === 'number' ? (req.body as PrototypeRequest).variantIndex! : 0
    const variantConfigs = buildVariantConfigs(
      clampVariantCount((req.body as PrototypeRequest).numVariants, DEFAULT_UPDATE_VARIANTS),
      Math.max(0, baseIndex),
    ).map((cfg) => ({ ...cfg, index: baseIndex + cfg.index }))

    const settled = await Promise.allSettled(
      variantConfigs.map((cfg) => generateUpdateVariant(requirementState, normalizedCurrentHtml!, updateInstruction, imageBlocks, cfg, updateHistory)),
    )

    const variants: PrototypeVariantPayload[] = settled.map((result, index) => {
      const cfg = variantConfigs[index]
      if (result.status === 'fulfilled') return result.value
      console.error(`[prototype] update variant ${cfg.index} failed:`, result.reason)
      return { index: cfg.index, html: null, mode: 'update', status: 'error', focus: cfg.focus, appliedEdits: 0, history: updateHistory, error: errorMessageFromUnknown(result.reason) }
    })

    res.json({ variants })
    return
  }

  // ── Create path: fan out N variants in parallel, isolating per-variant failures ──
  const variantConfigs = buildVariantConfigs(clampVariantCount((req.body as PrototypeRequest).numVariants, DEFAULT_CREATE_VARIANTS))

  const settled = await Promise.allSettled(
    variantConfigs.map((cfg) => generateCreateVariant(requirementState, imageBlocks, cfg, updateInstruction)),
  )

  const variants: PrototypeVariantPayload[] = settled.map((result, index) => {
    const focus = variantConfigs[index].focus
    if (result.status === 'fulfilled') return result.value
    console.error(`[prototype] variant ${index} failed:`, result.reason)
    return { index, html: null, mode: 'create', status: 'error', focus, appliedEdits: 0, history: [], error: errorMessageFromUnknown(result.reason) }
  })

  res.json({ variants })
})

app.post('/api/export-prompt', async (req, res) => {
  const { requirementState, conversationSummary } = req.body as { requirementState: UXRequirementState; conversationSummary: string }

  if (!anthropic) {
    res.status(400).json({ error: '未配置 ANTHROPIC_API_KEY。' })
    return
  }

  const prompt = `你是一位资深游戏 UX 设计师，请根据下面的需求状态和对话摘要，输出一份完整的 Cocos Creator 3.8.8 UX 交互实现设计文档（Markdown 格式）。

## 需求状态
${JSON.stringify(requirementState, null, 2)}

## 对话摘要
${conversationSummary}

## 输出要求
请输出一份完整的 Markdown 文档，包含以下章节：

整份文档必须使用中文撰写，包括标题、正文、表格说明、流程图节点文案和时序图说明；只有代码标识、接口字段名、文件路径、库/API 名称、枚举值和专有产品名可以保留英文。

### 1. 概述
简短描述这个交互功能的目的和核心体验。

### 2. 交互流程图
用 Mermaid flowchart 语法画出完整的交互流程（从触发到结束）。
用 \`\`\`mermaid 包裹。

### 3. 时序图
用 Mermaid sequenceDiagram 语法画出各模块之间的调用时序（玩家、UI层、逻辑层、动画系统、音效系统之间的交互）。
用 \`\`\`mermaid 包裹。

### 4. 触发条件详细设计
详细描述触发条件、判断逻辑、边界情况。

### 5. 执行规则与动画序列
详细描述每一步动画/反馈的执行顺序、时间参数、缓动函数建议。

### 6. 资源依赖清单
列出所有需要的资源（Prefab、Spine、纹理、音效等），用表格呈现。

### 7. 引擎实现方案
基于 Cocos Creator 3.8.8 给出具体的实现建议：
- 推荐使用的 API（Tween、Animation、AudioSource 等）
- 节点层级结构建议
- 性能注意事项

### 8. 状态机设计
如果涉及多状态切换，用 Mermaid stateDiagram 画出状态机。

直接输出 Markdown 正文，不要有任何多余的解释或前言。`

  const response = await anthropic.messages.create({
    model,
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  })

  const markdown = textFromClaudeContent(response.content)
  res.json({ markdown })
})

// ── Export Zip ───────────────────────────────────────────────────────────────

function sanitizeLabel(label: string): string {
  const sanitized = label
    .replace(/[^\w一-鿿\-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '')
  return sanitized || 'untitled'
}

function sanitizeNodeId(id: string): string {
  const sanitized = id
    .replace(/[^\w.-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48)
    .replace(/^-|-$/g, '')
  return sanitized || 'node'
}

function sanitizeDocPathSegment(segment: string) {
  const sanitized = segment
    .replace(/[<>:"\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^\.+$/, '')
    .replace(/^-|-$/g, '')
  return sanitized || 'untitled'
}

function normalizeExportDocPath(docPath: string | null | undefined): string | null {
  if (!docPath) return null
  const normalized = docPath
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:\//, '')
    .replace(/^\/+/, '')
    .replace(/^\.\/+/, '')
    .trim()
  const parts = normalized
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map(sanitizeDocPathSegment)
  if (!parts.length) return null
  const last = parts[parts.length - 1]
  parts[parts.length - 1] = last.toLowerCase().endsWith('.md') ? last : `${last}.md`
  return parts.join('/')
}

function buildNodePath(nodeId: string, tree: Record<string, PrdNode>): string {
  const explicitPath = normalizeExportDocPath(tree[nodeId]?.docPath)
  if (explicitPath) return explicitPath

  const parts: string[] = []
  let current: PrdNode | undefined = tree[nodeId]
  while (current) {
    parts.unshift(sanitizeNodeId(current.id))
    current = current.parentId ? tree[current.parentId] : undefined
  }
  // parts = [rootId, ...ancestors, leafId]
  // All segments except the last become folder names; last becomes the filename
  const folders = parts.slice(0, -1)
  const leaf = tree[nodeId]
  const filename = `${sanitizeNodeId(leaf.id)}-${sanitizeLabel(leaf.label)}.md`
  return [...folders, filename].join('/')
}

function formatNodeType(type: PrdNode['type']) {
  if (type === 'module') return '模块'
  if (type === 'page') return '页面'
  if (type === 'ui') return '界面/交互'
  return '功能'
}

function formatAudience(audience: PrdNode['audience'] | null | undefined) {
  if (audience === 'overview') return '项目概览 / 路线规划 AI'
  if (audience === 'client') return '客户端 / UI AI'
  if (audience === 'server') return '服务端 / 业务逻辑 AI'
  if (audience === 'config') return '配置 / 数值 AI'
  if (audience === 'api') return '接口 / 联调 AI'
  if (audience === 'acceptance') return '验收 / 测试 AI'
  if (audience === 'appendix') return '附录 / 风险 AI'
  if (audience === 'mixed') return '跨职责 AI'
  return '未指定'
}

function formatNodeSectionsForContext(sections: PrdNode['sections']) {
  if (!hasNodeSections(sections)) return ''
  return [
    '页面规格视角:',
    ...(['view', 'interaction', 'data'] as const).map((key) => {
      const section = sections?.[key]
      if (!section?.summary && !section?.content) return null
      return [
        `- ${section.title ?? formatSectionTitle(key)}`,
        section.summary ? `  摘要: ${section.summary}` : null,
        section.content ? `  内容: ${section.content}` : null,
      ].filter(Boolean).join('\n')
    }).filter((item): item is string => Boolean(item)),
  ].join('\n')
}

function generateMarkdown(node: PrdNode, tree?: Record<string, PrdNode>): string {
  const statusLabel = node.status === 'done' ? '已完成' : node.status === 'pending_refine' || node.needsPolish ? '待打磨' : '无需打磨'
  const lines = [
    `# ${node.label}`,
    '',
    `**节点编号：** ${node.id}`,
    `**节点类型：** ${formatNodeType(node.type)}`,
    `**导出路径：** ${node.docPath ?? '未指定'}`,
    `**面向角色：** ${formatAudience(resolveNodeAudience(node))}`,
    `**规格视角：** ${formatSpecLens(resolveNodeSpecLens(node))}`,
    `**完成状态：** ${statusLabel}`,
    `**打磨要求：** ${node.needsPolish ? '需要 Deep Forge 确认' : '无需 Deep Forge 确认'}`,
    `**原文位置：** ${node.extractedFrom ?? '未定位'}`,
    '',
    '## AI 接力目标',
    '',
    node.handoffGoal ?? '未指定。请先补齐该文档要交给哪个 AI/角色完成什么任务。',
    '',
    '## 质量门槛',
    '',
    node.qualityGate ?? '未指定。请先补齐职责边界、依赖关系和可测试检查点。',
    '',
    '## 需求摘要',
    '',
    node.summary,
    '',
    '## 详细内容',
    '',
    node.content,
  ]
  if (hasNodeSections(node.sections)) {
    lines.push('', '## 页面规格视角')
    for (const key of ['view', 'interaction', 'data'] as const) {
      const section = node.sections?.[key]
      if (!section?.summary && !section?.content && !section?.evidenceRefs?.length && !section?.openQuestions?.length) continue
      lines.push('', `### ${section.title ?? formatSectionTitle(key)}`)
      if (section.summary) lines.push('', section.summary)
      if (section.content) lines.push('', section.content)
      if (section.evidenceRefs?.length) {
        lines.push('', '#### 证据引用')
        for (const ref of section.evidenceRefs) {
          lines.push(`- [${ref.sourceKind}] ${ref.sourceLabel}${ref.quote ? `：${ref.quote}` : ''}`)
        }
      }
      if (section.openQuestions?.length) {
        lines.push('', '#### 需澄清点', ...section.openQuestions.map((item) => `- ${item}`))
      }
    }
  }
  if (tree) {
    const foldedSections = buildDeliverySections(node, tree).filter((section) => section.sourceNodeIds.length > 0)
    if (foldedSections.length) {
      lines.push('', '## 折叠子节点补充')
      for (const section of foldedSections) {
        lines.push('', `### ${section.title}`, '', `> 来源节点：${section.sourceNodeIds.join(', ')}`)
        if (section.summary) lines.push('', section.summary)
        if (section.content) lines.push('', section.content)
        if (section.evidenceRefs.length) {
          lines.push('', '#### 证据引用')
          for (const ref of section.evidenceRefs) {
            lines.push(`- [${ref.sourceKind}] ${ref.sourceLabel}${ref.quote ? `：${ref.quote}` : ''}`)
          }
        }
        if (section.openQuestions.length) lines.push('', '#### 需澄清点', ...section.openQuestions.map((item) => `- ${item}`))
      }
    }
  }

  const performanceMarkdown = formatPerformanceSpecMarkdown(resolveNodePerformanceSpec(node))
  if (performanceMarkdown) {
    lines.push('', performanceMarkdown)
  }
  if (node.references?.length) {
    lines.push('', '## 跨页面引用', '')
    for (const reference of node.references) {
      lines.push(`- ${reference.label}${reference.targetNodeId ? ` → ${reference.targetNodeId}` : ''}${reference.reason ? `：${reference.reason}` : ''}`)
    }
  }
  const backendContracts = collectBackendContracts(node, tree)
  if (backendContracts.length) {
    lines.push('', '## 服务端交互 / 依赖引用')
    for (const contract of backendContracts) {
      lines.push('', `### ${contract.title}`, '', `- 类型：${contract.kind}`)
      if (contract.targetNodeId) lines.push(`- 目标节点：${contract.targetNodeId}`)
      if (contract.summary) lines.push(`- 说明：${contract.summary}`)
      if (contract.fields?.length) lines.push(`- 字段：${contract.fields.join('、')}`)
      if (contract.evidenceRefs?.length) {
        lines.push('', '#### 证据引用')
        for (const ref of contract.evidenceRefs) {
          lines.push(`- [${ref.sourceKind}] ${ref.sourceLabel}${ref.quote ? `：${ref.quote}` : ''}`)
        }
      }
    }
  }

  const evidenceRefs = collectDeliveryEvidence(node, tree)
  if (evidenceRefs.length) {
    lines.push('', '## 汇总证据')
    for (const ref of evidenceRefs) {
      lines.push(`- [${ref.sourceKind}] ${ref.sourceLabel}${ref.quote ? `：${ref.quote}` : ''}`)
    }
  }

  if (node.techNotes) {
    lines.push('', '## 技术备注', '', node.techNotes)
  }
  return lines.join('\n')
}

function uniqueExportPath(path: string, files: Record<string, Uint8Array>) {
  if (!files[path]) return path
  const dot = path.toLowerCase().endsWith('.md') ? path.length - 3 : path.length
  const base = path.slice(0, dot)
  const ext = path.slice(dot)
  let index = 2
  let candidate = `${base}-${index}${ext}`
  while (files[candidate]) {
    index += 1
    candidate = `${base}-${index}${ext}`
  }
  return candidate
}

function pathDepth(path: string) {
  return path.split('/').length
}

function exportedPathFor(node: PrdNode, tree: Record<string, PrdNode>, pathByNodeId: Map<string, string>) {
  return pathByNodeId.get(node.id) ?? buildNodePath(node.id, tree)
}

function generateIndexMarkdown(exportedNodes: PrdNode[], tree: Record<string, PrdNode>, pathByNodeId: Map<string, string>) {
  const sorted = [...exportedNodes].sort((a, b) => exportedPathFor(a, tree, pathByNodeId).localeCompare(exportedPathFor(b, tree, pathByNodeId)))
  const byAudience = sorted.reduce<Record<string, PrdNode[]>>((groups, node) => {
    const key = formatAudience(resolveNodeAudience(node))
    groups[key] = [...(groups[key] ?? []), node]
    return groups
  }, {})

  const fileTreeLines = sorted.map((node) => {
    const path = exportedPathFor(node, tree, pathByNodeId)
    const indent = '  '.repeat(Math.max(0, pathDepth(path) - 1))
    return `${indent}- [${path}](${path}) - ${node.summary}`
  })

  const audienceLines = Object.entries(byAudience).flatMap(([audience, nodes]) => [
    `### ${audience}`,
    '',
    ...nodes.map((node) => {
      const path = exportedPathFor(node, tree, pathByNodeId)
      return `- [${path}](${path}): ${node.handoffGoal ?? node.summary}`
    }),
    '',
  ])

  const topLevelLines = Object.values(tree)
    .filter((node) => node.parentId === SOURCE_OUTLINE_ROOT_ID || (node.parentId === null && node.id !== SOURCE_OUTLINE_ROOT_ID))
    .sort((a, b) => a.order - b.order)
    .map((node) => `- **${node.label}**：${node.summary}`)

  return [
    '# PRD 文档包索引',
    '',
    '> 本索引由 GameUX PromptForge 自动生成。目标是让后续 AI Agent 按职责读取局部文档，而不是一次性吞下完整 PRD。',
    '',
    '## 文件树',
    '',
    ...fileTreeLines,
    '',
    '## 按角色快速导航',
    '',
    ...audienceLines,
    '## 顶层范围速查',
    '',
    ...topLevelLines,
    '',
    '## 使用方式',
    '',
    '1. 先阅读本索引和 `01-overview.md`（如存在）建立全局认知。',
    '2. 根据任务角色只读取相关目录，例如客户端任务优先读取 `client/` 与相关 `api/` 文档。',
    '3. 发现 `[需澄清]`、`[待验证]` 时先向用户确认，不要自行补规则。',
  ].join('\n')
}

function resolveGeneratedSpecPath(docPath: string) {
  const normalized = docPath.replace(/\\/g, '/').trim()
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || normalized.split('/').some((part) => part === '..')) {
    throw new Error('文档路径不允许访问生成目录之外的位置')
  }
  const safeRelative = normalizeExportDocPath(normalized)
  if (!safeRelative) throw new Error('文档路径无效')
  const resolved = path.resolve(SPEC_EXPORT_ROOT, safeRelative)
  const rootWithSep = SPEC_EXPORT_ROOT.endsWith(path.sep) ? SPEC_EXPORT_ROOT : `${SPEC_EXPORT_ROOT}${path.sep}`
  if (resolved !== SPEC_EXPORT_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error('文档路径越界')
  }
  return { resolved, relative: safeRelative }
}

function writeSpecFolder(tree: Record<string, PrdNode>) {
  const pageNodes = collectDeliveryNodes(tree).filter((node) => node.status === 'done')
  if (!pageNodes.length) throw new Error('没有找到已确认的页面 spec 节点')
  mkdirSync(SPEC_EXPORT_ROOT, { recursive: true })
  const pathByNodeId = new Map<string, string>()
  const documents: Array<{ nodeId: string; docPath: string }> = []
  for (const node of pageNodes) {
    const relativePath = uniqueExportPath(buildNodePath(node.id, tree), Object.fromEntries(documents.map((doc) => [doc.docPath, new Uint8Array()])))
    const target = resolveGeneratedSpecPath(relativePath)
    mkdirSync(path.dirname(target.resolved), { recursive: true })
    writeFileSync(target.resolved, generateMarkdown({ ...node, docPath: target.relative }, tree), 'utf-8')
    pathByNodeId.set(node.id, target.relative)
    documents.push({ nodeId: node.id, docPath: target.relative })
  }
  writeFileSync(path.join(SPEC_EXPORT_ROOT, '00-INDEX.md'), generateIndexMarkdown(pageNodes, tree, pathByNodeId), 'utf-8')
  return { exportDir: SPEC_EXPORT_ROOT, documents }
}

interface ExportZipRequest {
  tree: Record<string, PrdNode>
}

interface ExportNodeRequest {
  tree: Record<string, PrdNode>
  nodeId?: string
}

app.post('/api/export-node', (req, res) => {
  const { tree, nodeId } = req.body as ExportNodeRequest
  if (!tree || typeof tree !== 'object' || !nodeId) {
    res.status(400).json({ error: '缺少导图树数据或节点 ID' })
    return
  }
  const node = tree[nodeId]
  if (!node) {
    res.status(400).json({ error: `导图中找不到节点：${nodeId}` })
    return
  }
  const filename = sanitizeDocPathSegment(`${node.id}-${sanitizeLabel(node.label)}.md`)
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
  res.setHeader('Content-Disposition', contentDispositionHeader('inline', filename))
  res.end(generateMarkdown(node, tree))
})

app.post('/api/export-zip', (req, res) => {
  const { tree } = req.body as ExportZipRequest

  if (!tree || typeof tree !== 'object') {
    res.status(400).json({ error: '缺少导图树数据' })
    return
  }

  const leafNodes = collectDeliveryNodes(tree).filter((node) => node.status === 'done' || !node.needsPolish)

  if (leafNodes.length === 0) {
    res.status(400).json({ error: '没有找到可导出的文档包节点' })
    return
  }

  const files: Record<string, Uint8Array> = {
    '00-INDEX.md': Buffer.from('', 'utf-8'),
  }
  const pathByNodeId = new Map<string, string>()
  for (const node of leafNodes) {
    const path = uniqueExportPath(buildNodePath(node.id, tree), files)
    pathByNodeId.set(node.id, path)
    const content = generateMarkdown(node, tree)
    files[path] = Buffer.from(content, 'utf-8')
  }
  files['00-INDEX.md'] = Buffer.from(generateIndexMarkdown(leafNodes, tree, pathByNodeId), 'utf-8')

  const zipped = zipSync(files)

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', 'attachment; filename="spec-export.zip"')
  res.end(Buffer.from(zipped))
})

app.post('/api/export-spec-folder', (req, res) => {
  const { tree } = req.body as ExportZipRequest
  if (!tree || typeof tree !== 'object') {
    res.status(400).json({ error: '缺少导图树数据' })
    return
  }
  try {
    res.json(writeSpecFolder(tree))
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '导出页面 spec 文件夹失败' })
  }
})

app.post('/api/open-doc', (req, res) => {
  const { docPath } = req.body as { docPath?: string }
  if (!docPath) {
    res.status(400).json({ error: '缺少文档路径' })
    return
  }
  try {
    const { resolved } = resolveGeneratedSpecPath(docPath)
    if (!existsSync(resolved)) {
      res.status(404).json({ error: '文档尚未生成，请先导出 spec 文件夹' })
      return
    }
    const command = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open'
    const child = spawn(command, [resolved], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : '打开文档失败' })
  }
})

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number' ? error.status : 500
  const message = error instanceof Error ? error.message : '本地代理请求失败。'
  res.status(status).json({ error: message })
})

app.listen(port, '127.0.0.1', () => {
  console.log(`GameUX PromptForge local proxy listening on http://127.0.0.1:${port}`)
})
