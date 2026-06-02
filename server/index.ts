import Anthropic from '@anthropic-ai/sdk'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { zipSync } from 'fflate'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { applyPrototypeEdit, normalizePrototypeHtml } from '../src/lib/prototypeUtils'
import type { UXRequirementState } from '../src/types/uxRequirement'
import type { MapAdjustmentOperation, PrdNode, PrdNodeAudience, PrdNodeEvidenceRef, PrdNodeOperationPatch, PrdNodeOperationSuggestion, PrdNodeReference, PrdNodeSourceKind, PrdNodeStatus } from '../src/types/prdNode'
import { contentDispositionHeader } from './exportHeaders'
import { buildVariantConfigs, clampVariantCount, DEFAULT_CREATE_VARIANTS, DEFAULT_UPDATE_VARIANTS } from './prototypePrompts'

dotenv.config()
dotenv.config({ path: 'server/.env' })

const app = express()
const port = Number(process.env.LOCAL_PROXY_PORT ?? 8787)
const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'
const ragSseUrl = process.env.COCOS_RAG_SSE_URL ?? 'http://43.134.44.85:18000/sse'
const rawRagProxyScript = process.env.COCOS_RAG_PROXY_SCRIPT ?? '%APPDATA%\\cocos-rag\\remote_proxy.py'
const ragProxyScript = rawRagProxyScript.replace('%APPDATA%', process.env.APPDATA ?? '').replace('$env:APPDATA', process.env.APPDATA ?? '')
const MCP_ENDPOINT_TIMEOUT_MS = 8000
const MCP_RPC_TIMEOUT_MS = 12000
const SESSION_CLEANUP_DELAY_MS = 5 * 60 * 1000
const MAX_TOOL_ITERATIONS = 4
const DECOMPOSITION_HEARTBEAT_MS = 8000
const DECOMPOSITION_CALL_TIMEOUT_MS = Number.parseInt(process.env.DECOMPOSITION_CALL_TIMEOUT_MS ?? '180000', 10)
const LARGE_PRD_DECOMPOSE_THRESHOLD = 30 * 1024
const LARGE_PRD_SLICE_TARGET_LENGTH = 12 * 1024
const SOURCE_OUTLINE_ROOT_ID = 'SOURCE_OUTLINE_ROOT'
const SPEC_EXPORT_ROOT = path.resolve(process.cwd(), 'generated', 'specs')

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL })
  : null

// In-memory decomposition session store.
// Single-user desktop app — no persistence needed between server restarts.
interface DecompositionSession {
  status: 'running' | 'done' | 'error'
  nodes: PrdNode[]
  currentStep: string
  error?: string
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
  type: 'text' | 'image'
  text?: string
  source?: { type: 'base64'; media_type: string; data: string }
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n')
}

function hasImages(content: string | ContentBlock[]) {
  return typeof content !== 'string' && content.some((b) => b.type === 'image' && b.source)
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
      if (block.type === 'image' && block.source) {
        return { type: 'image', source: block.source as Anthropic.Base64ImageSource }
      }
      return null
    })
    .filter((block): block is Anthropic.ContentBlockParam => Boolean(block))

  return {
    role: message.role,
    content: content.length > 0 ? content : extractText(message.content),
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

type PrototypeVariantMode = 'create' | 'update' | 'rewrite'

interface PrototypeVariantPayload {
  index: number
  html: string | null
  mode: PrototypeVariantMode
  status: 'complete' | 'error'
  focus?: string
  appliedEdits: number
  history?: string[]
}

interface NodeChatRequest {
  nodeId: string
  messages: ChatMessage[]
  tree: Record<string, PrdNode>
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

interface NodePolishPatch {
  summary?: string | null
  content?: string | null
  techNotes?: string | null
}

interface NodeChatSuffix {
  nodeComplete?: boolean
  nodePatch?: NodePolishPatch
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

function normalizeNullableString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeNodePolishPatch(value: unknown): NodePolishPatch | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const patch: NodePolishPatch = {}

  if ('summary' in candidate) patch.summary = normalizeNullableString(candidate.summary)
  if ('content' in candidate) patch.content = normalizeNullableString(candidate.content)
  if ('techNotes' in candidate) patch.techNotes = normalizeNullableString(candidate.techNotes)
  if (!patch.techNotes && 'tech_notes' in candidate) patch.techNotes = normalizeNullableString(candidate.tech_notes)

  return Object.keys(patch).length ? patch : null
}

function extractNodeChatSuffix(rawText: string): { reply: string; nodeComplete: boolean; nodePatch: NodePolishPatch | null } {
  const lastBrace = rawText.lastIndexOf('}')
  if (lastBrace === -1) return { reply: rawText, nodeComplete: false, nodePatch: null }

  for (let index = lastBrace; index >= 0; index -= 1) {
    if (rawText[index] !== '{') continue
    try {
      const suffix = JSON.parse(rawText.slice(index, lastBrace + 1)) as NodeChatSuffix
      if (!suffix || typeof suffix !== 'object' || !('nodeComplete' in suffix)) continue
      return {
        reply: rawText.slice(0, index).trim() || rawText,
        nodeComplete: suffix.nodeComplete === true,
        nodePatch: normalizeNodePolishPatch(suffix.nodePatch),
      }
    } catch {
      // Try the previous opening brace. JSON suffixes may contain nested objects.
    }
  }

  return { reply: rawText, nodeComplete: false, nodePatch: null }
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
        .filter((b): b is ContentBlock & { type: 'image' } => b.type === 'image' && !!b.source)
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
            audience: { type: ['string', 'null'], enum: ['overview', 'client', 'server', 'config', 'api', 'acceptance', 'appendix', 'mixed', 'model', 'ctrl', 'view', null], description: '该文档主要服务的下游角色/AI 上下文类型。MVC 必须按证据维度归类：model=数据/配置/状态/规则，ctrl=流程/接口/命令/校验/状态流转，view=布局/文案/动画/视觉反馈；禁止只按关键词判断。' },
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
            audience: { type: ['string', 'null'], enum: ['overview', 'client', 'server', 'config', 'api', 'acceptance', 'appendix', 'mixed', 'model', 'ctrl', 'view', null], description: '下游消费角色；MVC 必须按证据维度判断，不得关键词归类。' },
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
      const audience = normalizeAudience(n.audience ?? n.targetAudience ?? n.target_audience ?? n.role) ?? (type === 'page' ? 'client' : null)
      const handoffGoal = normalizeTextValue(n.handoffGoal ?? n.handoff_goal ?? n.aiHandoff ?? n.ai_handoff) ?? null
      const qualityGate = normalizeTextValue(n.qualityGate ?? n.quality_gate ?? n.acceptanceGate ?? n.acceptance_gate) ?? null
      const references = normalizeNodeReferences(n.references ?? n.crossPageReferences ?? n.cross_page_references)
      const sourceKind = normalizeSourceKind(n.sourceKind ?? n.source_kind, 'prd')
      const evidenceRefs = normalizeEvidenceRefs(
        n.evidenceRefs ?? n.evidence_refs ?? n.sources,
        sourceKind,
        extractedFrom ?? 'PRD 原文',
      )

      return {
        id, parentId, label, summary, content, type,
        status,
        level, order, needsPolish, techNotes,
        extractedFrom,
        docPath, audience, handoffGoal, qualityGate,
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

function buildSourceOutlineForPrompt(mdText: string) {
  const headings = extractMarkdownHeadings(mdText)
  if (!headings.length) return '原文没有明显 Markdown 标题。请直接通读全文后按方法论拆分，不要创建“标题骨架”兜底节点。'

  const lines = headings.slice(0, 80).map((heading) => {
    const indent = '  '.repeat(Math.max(0, heading.level - 1))
    return `${indent}- 第 ${heading.line} 行：${heading.title}`
  })
  const omitted = headings.length > 80 ? `\n- 还有 ${headings.length - 80} 个标题未列出，请以完整 PRD 原文为准。` : ''
  return `${lines.join('\n')}${omitted}`
}

function buildSourceOutlineRootNode(mdText: string): PrdNode {
  const headings = extractMarkdownHeadings(mdText)
  const content = headings.length
    ? headings.map((heading) => `${'  '.repeat(Math.max(0, heading.level - 1))}- 第 ${heading.line} 行：${heading.title}`).join('\n')
    : '原文没有明显 Markdown 标题。后续页面节点仍必须由 AI 根据原文内容识别，不能使用本地标题生成假节点。'

  return {
    id: SOURCE_OUTLINE_ROOT_ID,
    parentId: null,
    label: 'PRD 原文目录',
    summary: headings.length ? `原文包含 ${headings.length} 个 Markdown 标题，页面节点均应回溯到这些原文位置。` : '原文没有明显 Markdown 标题，页面节点需直接依据正文内容生成。',
    content: `## 原文目录\n\n${content}`,
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
    return {
      nodes: normalizeDecompositionNodes(raw)
        .filter((node) => ['model', 'ctrl', 'view'].includes(node.audience ?? ''))
        .map((node, index): PrdNode => {
          const kind = node.audience === 'model' || node.audience === 'ctrl' || node.audience === 'view' ? node.audience : 'view'
          return {
            ...node,
            id: `${parentNode.id}-${kind.toUpperCase()}`,
            parentId: parentNode.id,
            type: kind === 'view' ? 'ui' : 'feature',
            status: 'pending_refine',
            level: 2,
            order: index,
            needsPolish: true,
            docPath: `pages/${pageSegment}/${kind}.md`,
            audience: kind,
            sourceKind: 'prd',
            children: [],
          }
        }),
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

  activeSession.currentStep = '正在通读原文并建立结构'
  activeSession.nodes = []
  const sourceOutlineRoot = buildSourceOutlineRootNode(mdText)
  mergeSessionNodes(activeSession, [sourceOutlineRoot])

  const pageNodes = await decomposeL1(mdText, activeSession)
  if (pageNodes.length === 0) {
    throw new Error('AI 未返回有效导图节点。已拒绝使用本地标题模板生成假文档，请重试或检查 PRD 是否包含足够可读取文本。')
  }
  mergeSessionNodes(activeSession, pageNodes)

  for (const pageNode of pageNodes) {
    const mvcNodes = await decomposeBranch(mdText, pageNode, activeSession)
    if (mvcNodes.length > 0) mergeSessionNodes(activeSession, mvcNodes)
  }

  activeSession.status = 'done'
  activeSession.currentStep = '分析完成'
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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    claude: {
      provider: 'Anthropic Claude',
      model,
      apiKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    cocosRag: {
      mode: 'mcp-sse-proxy',
      sseUrl: ragSseUrl,
      proxyScript: ragProxyScript,
      status: 'configured',
    },
  })
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
    currentStep: '正在通读原文并建立结构',
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
    .map((node) => `- ${node.id}｜${node.label}｜${node.status}｜${node.summary}`)
    .join('\n')

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: `你是 GameUX PromptForge 的页面级导图调整助手。\n只给出建议，不直接修改导图。\n必须返回 JSON：{"reply":"中文说明","operations":[]}。\noperations 只能包含 create_node/delete_node/update_node/move_content/add_reference。\n新增页面默认 status 为 pending_refine；不要拆按钮/字段级节点；跨页面关系用 add_reference。`,
    messages: [
      { role: 'user', content: `当前导图：\n${treeSummary}\n\n用户对话：\n${messages.map((message) => `${message.role}: ${extractText(message.content)}`).join('\n')}` },
    ],
  })
  const parsed = safeParseMapAdjustmentJson(textFromClaudeContent(response.content))
  res.json({
    reply: parsed.reply ?? '我没有找到可安全应用的调整建议。',
    operations: normalizeMapAdjustmentOperations(parsed.operations, tree),
  })
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
        const nodeId = normalizeTextValue(candidate.nodeId ?? candidate.node_id)
        return nodeId && tree[nodeId] ? { type, nodeId } : null
      }
      if (type === 'update_node') {
        const nodeId = normalizeTextValue(candidate.nodeId ?? candidate.node_id)
        const rawPatch = candidate.patch && typeof candidate.patch === 'object' ? candidate.patch as Record<string, unknown> : candidate
        if (!nodeId || !tree[nodeId]) return null
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
            audience: normalizeAudience(rawPatch.audience),
            references: normalizeNodeReferences(rawPatch.references),
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
  const patch: PrdNodeOperationPatch = {
    label: normalizeTextValue(candidate.label ?? candidate.title) ?? undefined,
    summary: normalizeTextValue(candidate.summary) ?? undefined,
    content: normalizeTextValue(candidate.content ?? candidate.body) ?? undefined,
    type: candidate.type === undefined && candidate.nodeType === undefined ? undefined : normalizeNodeType(candidate.type ?? candidate.nodeType),
    needsPolish: candidate.needsPolish === undefined && candidate.needs_polish === undefined ? undefined : normalizeBooleanValue(candidate.needsPolish ?? candidate.needs_polish, true),
    docPath: normalizeTextValue(candidate.docPath ?? candidate.doc_path) ?? undefined,
    audience: normalizeAudience(candidate.audience) ?? undefined,
    handoffGoal: normalizeTextValue(candidate.handoffGoal ?? candidate.handoff_goal) ?? undefined,
    qualityGate: normalizeTextValue(candidate.qualityGate ?? candidate.quality_gate) ?? undefined,
    techNotes: normalizeTextValue(candidate.techNotes ?? candidate.tech_notes) ?? undefined,
    sourceKind,
    evidenceRefs: normalizeEvidenceRefs(candidate.evidenceRefs ?? candidate.evidence_refs ?? candidate.sources, sourceKind, sourceKind === 'upload' ? '上传资料' : '用户补充'),
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
    .map((node) => `- ${node.id}｜parent=${node.parentId ?? 'ROOT'}｜${node.label}｜audience=${node.audience ?? '未定'}｜${node.summary}`)
    .join('\n')
  const sourceText = [
    userText ? `## 用户补充\n${userText}` : null,
    ...normalizedSources.map((source) => `## ${source.sourceKind === 'upload' ? '上传资料' : '用户补充'}：${source.name}\n${source.text}`),
  ].filter(Boolean).join('\n\n')

  const response = await anthropic.messages.create({
    model,
    max_tokens: 3000,
    system: `你是 GameUX PromptForge 的导图节点补齐助手。你只能生成待用户确认的 create/update 建议，绝不能声称已经修改导图。
返回 JSON：{"reply":"中文说明","suggestions":[]}。
suggestions 最多 5 条，每条包含 id、operation(create/update)、targetNodeId、parentId、patch、rationale、confidence、evidenceRefs。
MVC 分类必须按证据维度：model=领域事实/数据/配置/状态/规则；ctrl=流程编排/API/命令/校验/请求响应/状态流转；view=UI 布局/文案/动画/视觉反馈。禁止因为关键词出现就归类。
如果建议只来自用户补充或上传资料，patch.sourceKind 和 evidenceRefs.sourceKind 必须用 user 或 upload，不得写成 prd。只有能从现有节点 content/extractedFrom 明确引用原 PRD 时才能标 prd。
新增 MVC 子节点应挂在当前页面或用户指定页面下，label 使用中文标题并包含 Model/Ctrl/View，audience 使用 model/ctrl/view。`,
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

app.post('/api/node-chat', async (req, res) => {
  const { nodeId, messages, tree } = req.body as NodeChatRequest

  if (!nodeId || !messages?.length || !tree) {
    res.status(400).json({ error: '缺少节点 ID、对话消息或导图树数据' })
    return
  }

  if (!anthropic) {
    res.status(400).json({ error: '未配置 ANTHROPIC_API_KEY。' })
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
        `  标题: ${child.label}`,
        `  摘要: ${child.summary}`,
        `  导出路径: ${child.docPath ?? '未指定'}`,
        `  内容: ${child.content}`,
        child.techNotes ? `  技术备注: ${child.techNotes}` : null,
      ].filter(Boolean).join('\n')).join('\n\n')}`
    : ''

  const nodeContext = `目标节点：
编号: ${targetNode.id}
类型: ${formatNodeType(targetNode.type)}
标题: ${targetNode.label}
摘要: ${targetNode.summary}
导出路径: ${targetNode.docPath ?? '未指定'}
面向角色: ${formatAudience(targetNode.audience)}
AI 接力目标: ${targetNode.handoffGoal ?? '未指定'}
质量门槛: ${targetNode.qualityGate ?? '未指定'}
内容: ${targetNode.content}${targetNode.techNotes ? `\n技术备注: ${targetNode.techNotes}` : ''}${parentNode ? `\n\n父节点上下文：\n标题: ${parentNode.label}\n摘要: ${parentNode.summary}` : ''}${mvcChildContext}`

  const hasReferenceImages = messages.some((message) => hasImages(message.content))

  const nodeChatSystemPrompt = `你是游戏需求文档精修顾问，专注于把单个 PRD 拆分节点打磨成可直接交给 AI Agent 使用的 Markdown 文档。

${nodeContext}

你的任务：通过对话补齐这篇文档包的缺口，直到它足够低噪音、可独立、可执行，后续 AI 不需要再阅读整篇 PRD 也能完成对应任务。

规则：
- 用中文回复；所有展示给用户或写入导出文档的生成内容都必须是中文
- 回复正文只写给用户看的简短 Markdown 总结，不要输出整篇重写文档；可用标题、列表、加粗或行内代码，最多8行
- 如果文档还不完整，只问一个最关键的问题
- 优先补齐：原文位置、职责边界、核心规则、依赖字段/配置、跨文档关系、边界条件、需澄清点、可测试验收标准、AI 接力说明
- 当用户上传参考图或界面截图时，仅对 client/UI 类文档像 screenshot-to-code 一样提取布局层级、控件分组、间距、对齐、视觉权重、可交互元素、状态反馈和素材/参考图边界，并转化为文档内容
- 本轮是否包含图片参考：${hasReferenceImages ? '是' : '否'}
- 当用户补充或确认的内容应合并进当前文档时，即使文档尚未完成，也要在回复末尾附加 JSON：{"nodeComplete": false, "nodePatch": {"summary": "中文一句话总结当前文档用途或 null", "content": "中文 Markdown 文档正文或本轮已采纳后的当前文档段落", "techNotes": "中文实现/接力注意事项或 null"}}
- 当你判断该文档已经足够交给后续 AI 执行时，把同一个 JSON 的 nodeComplete 设为 true，并让 nodePatch 包含最终文档内容
- JSON 只能放在回复末尾；回复正文不能包含 JSON、大括号、schema 说明或原始回包
- nodePatch.content 必须整合当前节点原始内容、用户补充和图片观察结论，写成可导出的当前文档正文；不要只写本轮摘要，也不要重复堆叠旧的 Deep Forge 段落
- nodePatch.summary、nodePatch.content、nodePatch.techNotes 以及 content 内部 Markdown 标题必须使用中文；只有代码标识、文件路径、接口字段名、库/API 名称、枚举值和专有产品名可以保留英文
- 保持专业、简洁、直接的语气`

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    system: nodeChatSystemPrompt,
    messages: messages.map(toAnthropicNodeMessage),
  })

  const rawText = textFromClaudeContent(response.content)

  const parsedSuffix = extractNodeChatSuffix(rawText)
  res.json({
    reply: parsedSuffix.reply || rawText,
    nodeComplete: parsedSuffix.nodeComplete,
    nodePatch: parsedSuffix.nodePatch,
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

  return `## 需求状态
触发条件：${requirementState.trigger_condition ?? '未知'}
执行规则：${requirementState.sequence_rules ?? '未知'}
引擎约束：${requirementState.engine_constraints ?? '无'}
完成度：${requirementState.completion_rate}%

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

function buildCreatePrototypePrompt(requirementState: UXRequirementState, hasImages = false, focus?: string) {
  const focusSection = focus
    ? `\n## 本变体设计侧重\n${focus}\n（这是同一需求的多个备选方案之一，请在满足上述需求与约束的前提下，按本侧重做出有辨识度的设计。）\n`
    : ''
  return `你是 GameUX PromptForge 的游戏 UX 原型生成专家。根据以下 UX 需求状态${hasImages ? '和参考图' : ''}，生成一个可直接预览的自包含 HTML 原型。

${buildPrototypeSpec(requirementState)}
${hasImages ? `\n${buildScreenshotFidelitySection()}` : ''}${focusSection}
## 尺寸契约
- 预览沙盒提供的设计画布固定为 750×1624 CSS px。
- 原型根节点应适配 100vw × 100vh，不需要页面级纵向或横向滚动。
- 不要额外绘制手机壳、浏览器壳或外层设备框，应用预览已提供外框。

## 输出约束
1. 只输出单个完整 HTML 文件；可以用 \`\`\`html 包裹，但不要解释。
2. 必须是静态单文件可运行：不需要 npm、构建步骤、本地资源或后端服务。
3. 可使用 Tailwind CDN（https://cdn.tailwindcss.com）和少量内联 CSS/JS；不要引用不可访问的本地路径。
4. 画面要像游戏交互原型，不要做营销页：包含设备内界面、状态切换、关键按钮反馈、禁用/加载/错误态。
5. 组件标注要清楚：用小标签标出组件名称、类型、状态或动画参数。
6. 未确认资源用占位块，不要伪造真实素材路径。
7. 脚本必须安全自包含，不要访问父窗口、cookie、localStorage 或外部 API。
8. 所有用户可见界面文字、按钮文案、状态提示、组件标注、注释说明必须是中文；只有代码标识、CSS 类名、库/API 名称、枚举值、文件路径和专有产品名可以保留英文。`
}

function buildUpdatePrototypePrompt(requirementState: UXRequirementState, currentHtml: string, instruction: string, history: string[] = [], focus?: string) {
  const historySection = history.length > 0
    ? `\n## 当前变体历史修改指令\n${history.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n`
    : ''
  const focusSection = focus ? `\n## 本次更新侧重\n${focus}\n` : ''
  return `你是 GameUX PromptForge 的原型迭代代理。请根据用户的修改说明，对当前 HTML 原型做最小必要修改。

${buildPrototypeSpec(requirementState)}${historySection}${focusSection}

## 用户修改说明
${instruction}

## 当前原型 HTML
${currentHtml}

## 修改规则
1. 优先调用 edit_prototype 工具，用 old_string/new_string 做精确局部替换。
2. old_string 必须逐字符来自当前 HTML，不能概括、不能省略。
3. 如果需要多处修改，可以调用多次 edit_prototype。
4. 如果无法安全定位精确片段，直接输出修改后的完整 HTML 文件。
5. 保持单文件可运行、Tailwind CDN 可用、无构建步骤、无本地资源依赖。
6. 保持 750×1624 CSS px 尺寸契约：根节点适配 100vw × 100vh，不引入 body/page 滚动，也不新增手机壳、浏览器壳或外层设备框。
7. 所有用户可见界面文字、按钮文案、状态提示、组件标注、注释说明必须是中文；只有代码标识、CSS 类名、库/API 名称、枚举值、文件路径和专有产品名可以保留英文。`
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
        .filter((b): b is ContentBlock & { type: 'image' } => b?.type === 'image' && !!b.source)
        .map((b) => ({ type: 'image', source: b.source as Anthropic.Base64ImageSource }))
    : []
}

function buildContentWithImages(prompt: string, imageBlocks: Anthropic.ImageBlockParam[]): Anthropic.ContentBlockParam[] | string {
  return imageBlocks.length > 0 ? [...imageBlocks, { type: 'text', text: prompt }] : prompt
}

async function generateUpdateVariant(
  requirementState: UXRequirementState,
  currentHtml: string,
  instruction: string,
  imageBlocks: Anthropic.ImageBlockParam[],
  cfg: { index: number; focus: string; temperature: number },
  history: string[],
): Promise<PrototypeVariantPayload> {
  const prompt = buildUpdatePrototypePrompt(requirementState, currentHtml, instruction, history, cfg.focus)
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
  return {
    index: cfg.index,
    html: raw.trim() ? normalizePrototypeHtml(raw) : currentHtml,
    mode: raw.trim() ? 'rewrite' : 'update',
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
): Promise<PrototypeVariantPayload> {
  const prompt = buildCreatePrototypePrompt(requirementState, imageBlocks.length > 0, cfg.focus)
  const response = await anthropic!.messages.create({
    model,
    max_tokens: 8192,
    temperature: cfg.temperature === 1 ? undefined : cfg.temperature,
    messages: [{ role: 'user', content: buildContentWithImages(prompt, imageBlocks) }],
  })
  return {
    index: cfg.index,
    html: normalizePrototypeHtml(textFromClaudeContent(response.content)),
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

  if (!anthropic) {
    res.status(400).json({ error: '未配置 ANTHROPIC_API_KEY。' })
    return
  }

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
    try {
      if (isUpdate) {
        const variant = await generateUpdateVariant(requirementState, normalizedCurrentHtml!, updateInstruction, imageBlocks, cfg, updateHistory)
        writePrototypeEvent(res, { type: 'setCode', variantIndex: cfg.index, html: variant.html, focus: cfg.focus, history: variant.history })
        writePrototypeEvent(res, { type: 'variantComplete', variantIndex: cfg.index, html: variant.html, focus: cfg.focus, history: variant.history, mode: variant.mode, appliedEdits: variant.appliedEdits })
        return
      }

      const prompt = buildCreatePrototypePrompt(requirementState, imageBlocks.length > 0, cfg.focus)
      const stream = anthropic!.messages.stream({
        model,
        max_tokens: 8192,
        temperature: cfg.temperature === 1 ? undefined : cfg.temperature,
        messages: [{ role: 'user', content: buildContentWithImages(prompt, imageBlocks) }],
      })

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          html += event.delta.text
          writePrototypeEvent(res, { type: 'setCode', variantIndex: cfg.index, html: normalizePrototypeHtml(html), focus: cfg.focus })
        }
      }
      const normalized = normalizePrototypeHtml(html)
      writePrototypeEvent(res, { type: 'variantComplete', variantIndex: cfg.index, html: normalized, focus: cfg.focus, mode: 'create', appliedEdits: 0, history: [] })
    } catch (err) {
      console.error(`[prototype] stream variant ${cfg.index} failed:`, err)
      writePrototypeEvent(res, { type: 'variantError', variantIndex: cfg.index, focus: cfg.focus })
    }
  }))

  writePrototypeEvent(res, { type: 'done' })
  res.end()
}

app.post('/api/prototype/stream', streamPrototype)

app.post('/api/prototype', async (req, res) => {
  const { requirementState, currentHtml, instruction, images } = parsePrototypeRequest(req)

  if (!anthropic) {
    res.status(400).json({ error: '未配置 ANTHROPIC_API_KEY。' })
    return
  }

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
      return { index: cfg.index, html: null, mode: 'update', status: 'error', focus: cfg.focus, appliedEdits: 0, history: updateHistory }
    })

    res.json({ variants })
    return
  }

  // ── Create path: fan out N variants in parallel, isolating per-variant failures ──
  const variantConfigs = buildVariantConfigs(clampVariantCount((req.body as PrototypeRequest).numVariants, DEFAULT_CREATE_VARIANTS))

  const settled = await Promise.allSettled(
    variantConfigs.map((cfg) => generateCreateVariant(requirementState, imageBlocks, cfg)),
  )

  const variants: PrototypeVariantPayload[] = settled.map((result, index) => {
    const focus = variantConfigs[index].focus
    if (result.status === 'fulfilled') return result.value
    console.error(`[prototype] variant ${index} failed:`, result.reason)
    return { index, html: null, mode: 'create', status: 'error', focus, appliedEdits: 0, history: [] }
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

function formatAudience(audience: PrdNode['audience']) {
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

function generateMarkdown(node: PrdNode): string {
  const statusLabel = node.status === 'done' ? '已完成' : node.status === 'pending_refine' || node.needsPolish ? '待打磨' : '无需打磨'
  const lines = [
    `# ${node.label}`,
    '',
    `**节点编号：** ${node.id}`,
    `**节点类型：** ${formatNodeType(node.type)}`,
    `**导出路径：** ${node.docPath ?? '未指定'}`,
    `**面向角色：** ${formatAudience(node.audience)}`,
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
  if (node.references?.length) {
    lines.push('', '## 跨页面引用', '')
    for (const reference of node.references) {
      lines.push(`- ${reference.label}${reference.targetNodeId ? ` → ${reference.targetNodeId}` : ''}${reference.reason ? `：${reference.reason}` : ''}`)
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
    const key = formatAudience(node.audience)
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
  const nodes = Object.values(tree)
  const pageNodes = nodes.filter((node) => node.type === 'page' && node.children.length === 0 && node.status === 'done')
  if (!pageNodes.length) throw new Error('没有找到已确认的页面 spec 节点')
  mkdirSync(SPEC_EXPORT_ROOT, { recursive: true })
  const pathByNodeId = new Map<string, string>()
  const documents: Array<{ nodeId: string; docPath: string }> = []
  for (const node of pageNodes) {
    const relativePath = uniqueExportPath(buildNodePath(node.id, tree), Object.fromEntries(documents.map((doc) => [doc.docPath, new Uint8Array()])))
    const target = resolveGeneratedSpecPath(relativePath)
    mkdirSync(path.dirname(target.resolved), { recursive: true })
    writeFileSync(target.resolved, generateMarkdown({ ...node, docPath: target.relative }), 'utf-8')
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
  res.end(generateMarkdown(node))
})

app.post('/api/export-zip', (req, res) => {
  const { tree } = req.body as ExportZipRequest

  if (!tree || typeof tree !== 'object') {
    res.status(400).json({ error: '缺少导图树数据' })
    return
  }

  const nodes = Object.values(tree)
  const leafNodes = nodes.filter(n => n.children.length === 0 && (n.status === 'done' || !n.needsPolish))

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
    const content = generateMarkdown(node)
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
