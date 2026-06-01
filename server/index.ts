import Anthropic from '@anthropic-ai/sdk'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { zipSync } from 'fflate'
import { spawn } from 'node:child_process'
import { applyPrototypeEdit, normalizePrototypeHtml } from '../src/lib/prototypeUtils'
import type { UXRequirementState } from '../src/types/uxRequirement'
import type { PrdNode } from '../src/types/prdNode'
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
const MAX_PARALLEL_DECOMPOSITION_BRANCHES = 3
const DECOMPOSITION_HEARTBEAT_MS = 8000
const DECOMPOSITION_CALL_TIMEOUT_MS = Number.parseInt(process.env.DECOMPOSITION_CALL_TIMEOUT_MS ?? '180000', 10)

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

const decompositionMethodologyGuide = `拆解方法论：
1. 拆分目标不是生成漂亮的功能树，而是把单一 PRD 转成可导航、可维护、可逐篇投喂给 AI Agent 的多文件知识库。
2. 每个叶子节点必须对应一篇未来可导出的 Markdown 文档，而不是一个零散控件、动画片段或标题摘抄。文档粒度以“一个 AI 能拿着它完成一类任务”为准。
3. 先通读全文建立全局认知，再按维度轴拆分：职责维度（client/server）、阶段维度（流程步骤）、功能维度（UI/动画/网络/存储）、数据维度（config/api/埋点）、质量维度（acceptance/测试/风险）。
4. 顶层结构优先贴近 docs/prd/<game>/ 模板：01-overview、02-gameplay-rules、client/、server/、config/、api/、acceptance/、appendix/。00-INDEX.md 由系统导出时生成，不要作为普通叶子反复展开。
5. 客户端文档聚焦视觉、动画、用户交互、状态反馈，并必须列出依赖的服务端字段；服务端文档聚焦计算、RNG、结算、持久化和业务判定；接口/配置/验收文档必须单独成篇。
6. 严禁添加原文没有明确说明的推断或假设。原文明确则直接整理；原文模糊则标注「需澄清」；原文未提及则不要写入。
7. 每个叶子节点都要填 docPath、audience、handoffGoal、qualityGate。content 要按“原文位置、核心规则、详细说明、边界条件、依赖关系、需澄清点、AI 接力提示”组织，确保后续 AI 不需要再吞整篇 PRD。
8. 所有会展示给用户或进入导出文档的生成内容必须使用中文，包括 label、summary、content、techNotes、handoffGoal、qualityGate 以及 Markdown 标题；只有字段名、ID、docPath、代码/API/库名、枚举值和不可翻译产品名可以保留英文。
9. 禁止输出模板化占位内容，例如「原文标题『某标题』下的内容」「本地标题骨架」「需 AI 深度拆解后补齐」。如果原文某节没有足够信息，应在真实文档正文里明确列出已知原文、缺口和需澄清问题。`

const decomposePrdTool: Anthropic.Tool = {
  name: 'decompose_prd',
  description: '将 PRD 文档拆解为 AI 可接力执行的多文件知识库树。每个叶子节点代表一篇可导出的 Markdown 文档包。',
  input_schema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        description: '扁平 PrdNode 数组。每次最多 6 个直接有价值的目录/文档包节点，叶子节点必须是一篇可导出的 Markdown 文档。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', maxLength: 40, description: '稳定唯一 ID，例如 "CE-01"。ID 可用英文功能缩写 + 序号。' },
            parentId: { type: ['string', 'null'], description: '父节点 ID；顶层目录/主题为 null。' },
            label: { type: 'string', maxLength: 32, description: '中文短标题，建议 3-12 个汉字；叶子节点标题应对应文档主题。' },
            summary: { type: 'string', maxLength: 120, description: '中文一句话摘要，说明该节点覆盖的需求范围。' },
            content: { type: 'string', maxLength: 900, description: '按可交给 AI 的 Markdown 文档包组织的中文内容，保留原文依据、职责边界、依赖、需澄清点和验收线索；不要逐字复述整段 PRD。' },
            type: { type: 'string', enum: ['module', 'feature', 'ui'], description: 'module=目录/主题分组；feature=非 UI 文档包；ui=客户端界面、交互、动画或状态相关文档包。' },
            level: { type: 'integer', description: '树深度。顶层目录为 1，子目录为 2，文档包通常为 2-4。不要为了控件状态无限下钻。' },
            order: { type: 'integer', description: '同父节点内的排序位置，从 0 开始。' },
            needsPolish: { type: 'boolean', description: '该文档是否还需要 Deep Forge 补齐才能直接交给 AI 执行。UI/交互文档通常为 true；配置/API/验收若原文已完整可为 false。' },
            extractedFrom: { type: ['string', 'null'], maxLength: 120, description: '原文位置，例如标题名、章节号或行号范围。无法定位时为 null；若原文标题是中文应保持中文。' },
            techNotes: { type: ['string', 'null'], maxLength: 220, description: '面向开发的中文技术备注，可为空。' },
            docPath: { type: ['string', 'null'], maxLength: 120, description: '叶子文档的导出路径，必须是相对路径，例如 "client/01-ui-layout.md"、"api/01-spin-api.md"。目录节点为 null。' },
            audience: { type: ['string', 'null'], enum: ['overview', 'client', 'server', 'config', 'api', 'acceptance', 'appendix', 'mixed', null], description: '该文档主要服务的下游角色/AI 上下文类型。枚举值可用英文。' },
            handoffGoal: { type: ['string', 'null'], maxLength: 220, description: '中文一句话说明后续 AI 拿到这篇文档应完成什么任务。目录节点可为 null。' },
            qualityGate: { type: ['string', 'null'], maxLength: 220, description: '中文说明该文档可交给 AI 前必须满足的检查点，例如字段完整、验收项可测试、职责边界清晰。' },
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
  description: '仅输出 PRD 的顶层文档包目录/主题。不要生成详细 Markdown 正文，详细文档会在后续分支展开阶段生成。',
  input_schema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        description: '少量顶层目录/主题节点，parentId 必须为 null，level 必须为 1。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', maxLength: 24, description: '稳定唯一 ID，例如 "OVERVIEW"、"CLIENT"、"RULES"。' },
            parentId: { type: ['string', 'null'], description: '顶层目录必须为 null。' },
            label: { type: 'string', maxLength: 24, description: '中文短标题，3-12 个汉字。' },
            summary: { type: 'string', maxLength: 80, description: '一句中文摘要，说明该目录覆盖范围。' },
            content: { type: 'string', maxLength: 240, description: '中文短说明，只写覆盖范围、关键依据、职责边界和需澄清点；不要写 Markdown 长文。' },
            type: { type: 'string', enum: ['module', 'feature', 'ui'], description: '顶层通常为 module；若整份 PRD 只有单个可执行文档可用 feature/ui。' },
            level: { type: 'integer', enum: [1], description: '顶层目录固定为 1。' },
            order: { type: 'integer', description: '同级排序，从 0 开始。' },
            needsPolish: { type: 'boolean', description: '顶层目录通常为 false；单篇 UI 文档可为 true。' },
            extractedFrom: { type: ['string', 'null'], maxLength: 80, description: '原文章节或标题位置。' },
            techNotes: { type: ['string', 'null'], maxLength: 120, description: '简短技术备注；无则为 null。' },
            docPath: { type: ['null'], description: '顶层目录固定为 null；可导出的 Markdown 路径只在后续分支展开阶段填写。' },
            audience: { type: ['string', 'null'], enum: ['overview', 'client', 'server', 'config', 'api', 'acceptance', 'appendix', 'mixed', null], description: '下游消费角色。' },
            handoffGoal: { type: ['string', 'null'], maxLength: 120, description: '一句话说明后续 AI 应如何展开该目录。' },
            qualityGate: { type: ['string', 'null'], maxLength: 120, description: '一句话说明该目录展开时的检查标准。' },
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
  if (!text) return 'feature'
  if (['module', '模块', 'domain', 'category'].includes(text)) return 'module'
  if (['ui', 'interaction', 'screen', 'control', '界面', '交互', '控件', '状态'].includes(text)) return 'ui'
  return 'feature'
}

function normalizeAudience(value: unknown): PrdNode['audience'] {
  const text = normalizeTextValue(value)?.toLowerCase()
  if (!text) return null
  if (['overview', 'project', '概览', '总览'].includes(text)) return 'overview'
  if (['client', 'frontend', 'ui', '客户端', '前端', '表现层'].includes(text)) return 'client'
  if (['server', 'backend', '服务端', '后端'].includes(text)) return 'server'
  if (['config', '配置', '参数'].includes(text)) return 'config'
  if (['api', 'interface', '接口', '字段'].includes(text)) return 'api'
  if (['acceptance', 'qa', 'test', '验收', '测试', '质量'].includes(text)) return 'acceptance'
  if (['appendix', 'risk', 'tracking', '附录', '风险', '埋点'].includes(text)) return 'appendix'
  return 'mixed'
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
      const level = normalizeNumberValue(n.level ?? n.depth, parentId ? 2 : 1)
      const order = normalizeNumberValue(n.order ?? n.sort ?? n.index, index)
      const needsPolish = normalizeBooleanValue(n.needsPolish ?? n.needs_polish, type === 'ui')
      const extractedFrom = normalizeTextValue(n.extractedFrom ?? n.extracted_from ?? n.source ?? n.sourceRange) ?? null
      const techNotes = normalizeTextValue(n.techNotes ?? n.tech_notes ?? n.notes) ?? null
      const docPath = normalizeTextValue(n.docPath ?? n.doc_path ?? n.path ?? n.filePath ?? n.file_path) ?? null
      const audience = normalizeAudience(n.audience ?? n.targetAudience ?? n.target_audience ?? n.role)
      const handoffGoal = normalizeTextValue(n.handoffGoal ?? n.handoff_goal ?? n.aiHandoff ?? n.ai_handoff) ?? null
      const qualityGate = normalizeTextValue(n.qualityGate ?? n.quality_gate ?? n.acceptanceGate ?? n.acceptance_gate) ?? null

      return {
        id, parentId, label, summary, content, type,
        status: 'pending',
        level, order, needsPolish, techNotes,
        extractedFrom,
        docPath, audience, handoffGoal, qualityGate,
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
任务：只识别这份 PRD 应该被整理成哪些顶层“文档包目录/主题”。
本轮是轻量目录规划，不写叶子文档，不展开详细正文，详细内容会在下一轮逐个目录生成。
顶层节点必须服务于后续多文件知识库，例如「项目概览」「核心玩法规则」「客户端文档」「服务端文档」「配置文档」「接口文档」「验收与测试」「附录与风险」等；只输出原文中确实存在的领域。
不要机械复制文档标题层级，也不要围绕 UI 控件下钻；要按“后续哪个 AI/角色会消费这批文档”来分组。
必须通过工具返回非空 nodes 数组。本轮只返回 level=1 的顶层目录/主题节点，parentId 必须为 null。通常 2-6 个，最多 8 个。
每个顶层节点的 summary 控制在 40 字以内，content 控制在 160 字以内，只概括覆盖范围、关键依据、职责边界和需澄清点，不要写 Markdown 长文。
顶层目录节点 docPath 必须为 null；可导出的 Markdown 路径只在后续分支展开阶段填写。
如果原文标题结构清晰，extractedFrom 写入对应章节/标题；无法定位则为 null。
所有 label、summary、content、techNotes、handoffGoal、qualityGate 必须使用中文；ID、docPath、字段名、枚举值可以使用英文。
每个顶层范围必须清晰、互不重叠。`

function decompositionBranchSystemPrompt(parentLabel: string, parentId: string): string {
  return `你正在展开 PRD 树中的一个模块。
待展开模块：「${parentLabel}」
${decompositionMethodologyGuide}
请把该模块展开为一组“可导出的 Markdown 文档包”，而不是控件清单。
必须返回非空 nodes 数组；如果该模块只需要一篇文档，也要输出 1 个 level=2 叶子文档包，parentId 为 "${parentId}"，不要返回空数组。
level=2：主要子目录或关键文档包，parentId 为 "${parentId}"。
level=3：当一个 level=2 主题仍过粗时，拆成更聚焦的文档包，例如 client/02-board-display.md、api/01-spin-api.md、acceptance/01-client-acceptance.md。
level=4：仅当一篇文档仍无法被单个 AI 接力执行时才继续拆分；不要把按钮、动画帧、状态枚举单独拆成叶子，除非它们独立形成一篇 AI 任务上下文。
每个父节点最多 6 个直接子节点；优先输出后续最值得独立交给 AI 的文档包，不要为了穷举而拉长单次输出。
叶子节点必须填写 docPath、audience、handoffGoal、qualityGate；目录节点 docPath 可以为 null。
客户端/服务端混写的内容必须按职责拆开；接口、配置、验收内容单独成篇，不要塞进 UI 文档。
content 必须保留原文依据、核心规则、边界条件、依赖字段/配置、跨文档关系、验收线索和「需澄清」标注，但每篇控制在 300-900 字内，不要逐字复述整段 PRD。
任何 UI/交互/动画/状态反馈文档，或原文信息不足以直接交给 AI 的文档，都应将 needsPolish 标记为 true。
如果能定位原文位置，extractedFrom 写入章节标题或行号范围。
所有 label、summary、content、techNotes、handoffGoal、qualityGate 和 content 内部 Markdown 标题必须使用中文；ID、docPath、字段名、枚举值可以使用英文。`
}

async function decomposeL1(mdText: string, session: DecompositionSession): Promise<PrdNode[]> {
  if (!anthropic) throw new Error('Anthropic 客户端未初始化，请检查 ANTHROPIC_API_KEY')
  const claude = anthropic
  const sourceOutline = buildSourceOutlineForPrompt(mdText)

  async function requestTopLevel(label: string, retry: boolean) {
    const retryInstruction = retry
      ? '上一轮顶层目录返回了空数组，这是无效结果。请重新通读标题参考和原文，必须返回 2-6 个真实顶层目录；即使 PRD 很短，也至少输出「项目概览」和一个最核心的玩法/客户端/验收目录。'
      : '请把下面 PRD 拆解为顶层文档包目录/主题。'

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
            content: `${retryInstruction} 本次只输出 level=1 节点，parentId 必须为 null，docPath 必须为 null，不要输出更深层级。拆分目标是后续一篇篇交给 AI Agent 使用，不是 UI 控件树。所有展示给用户的文字必须是中文，包括节点标题、摘要、正文、接力目标、质量门槛；只有 ID、字段名、枚举值可以保留英文。不要照抄标题骨架当正文，必须给出你通读原文后的真实整理结果。\n\n原文标题参考（只作为定位线索，不是输出模板）：\n${sourceOutline}\n\n完整 PRD 原文：\n${mdText}`,
          },
        ],
      })
    )

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'decompose_prd'
    )
    if (!toolUse) throw new Error('Claude 未返回顶层文档包目录拆解结果')

    const raw = (toolUse.input as { nodes?: unknown }).nodes ?? toolUse.input
    return {
      nodes: normalizeDecompositionNodes(raw),
      stopReason: response.stop_reason,
    }
  }

  const first = await requestTopLevel('正在识别顶层文档包目录', false)
  if (first.nodes.length > 0) return first.nodes
  if (first.stopReason === 'max_tokens') {
    throw new Error('AI 顶层目录输出过长并被截断。请重试，或缩小 PRD 范围后再导入。')
  }

  const retry = await requestTopLevel('正在重新校验顶层文档包目录', true)
  if (!retry.nodes.length && retry.stopReason === 'max_tokens') {
    throw new Error('AI 顶层目录输出过长并被截断。请重试，或缩小 PRD 范围后再导入。')
  }
  return retry.nodes
}

async function decomposeBranch(mdText: string, parentNode: PrdNode, session: DecompositionSession): Promise<PrdNode[]> {
  if (!anthropic) throw new Error('Anthropic 客户端未初始化，请检查 ANTHROPIC_API_KEY')
  const claude = anthropic
  const branchContext = extractRelevantMarkdownForNode(mdText, parentNode)
  const sourceOutline = buildSourceOutlineForPrompt(branchContext)

  async function requestBranch(label: string, retry: boolean) {
    const retryInstruction = retry
      ? `上一轮「${parentNode.label}」返回了空数组，这是无效结果。请至少输出 1 个 level=2 叶子文档包，parentId 必须为 "${parentNode.id}"，docPath 必须填写。`
      : `请把「${parentNode.label}」展开为可导出的 Markdown 文档包。`

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
            content: `${retryInstruction} 必须至少输出 1 个节点；如果该主题本身已经足够小，就输出 1 个 level=2 叶子文档包，parentId 必须为 "${parentNode.id}"，并填写 docPath。请输出 level=2 到 level=4 的节点，并确保 parentId 指向正确父节点。叶子节点要能单独交给 AI Agent 继续完成 UI、服务端、接口、配置或验收任务。所有展示给用户的文字必须是中文，包括节点标题、摘要、正文、接力目标、质量门槛和 Markdown 标题；只有 ID、路径、字段名、枚举值可以保留英文。不要输出模板化标题说明，content 必须是你对原文相关内容的拆分整理。\n\n原文标题参考（只作为定位线索，不是输出模板）：\n${sourceOutline}\n\n相关 PRD 原文片段：\n${branchContext}`,
          },
        ],
      })
    )

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'decompose_prd'
    )
    if (!toolUse) throw new Error(`Claude 未返回分支拆解结果：${parentNode.id}`)

    const raw = (toolUse.input as { nodes?: unknown }).nodes ?? toolUse.input
    return {
      nodes: normalizeDecompositionNodes(raw),
      stopReason: response.stop_reason,
    }
  }

  const first = await requestBranch('正在展开文档包分支', false)
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
    { step: '正在识别顶层文档包目录', delay: 800 },
    { step: '正在展开：核心玩法系统', delay: 1000 },
    { step: '正在展开：用户界面层', delay: 1000 },
    { step: '正在展开：数据与存档', delay: 800 },
  ]

  const mockNodes: PrdNode[] = [
    { id: 'CORE-01', parentId: null, label: '核心玩法系统', summary: '游戏核心循环与机制', content: 'mock', type: 'module', status: 'pending', level: 1, order: 0, needsPolish: false, extractedFrom: null, techNotes: null, children: ['CORE-02', 'CORE-03'] },
    { id: 'CORE-02', parentId: 'CORE-01', label: '战斗系统', summary: '实时战斗与技能触发', content: 'mock', type: 'feature', status: 'pending', level: 2, order: 0, needsPolish: true, extractedFrom: null, techNotes: null, children: [] },
    { id: 'CORE-03', parentId: 'CORE-01', label: '关卡进程', summary: '关卡解锁与难度曲线', content: 'mock', type: 'feature', status: 'pending', level: 2, order: 1, needsPolish: false, extractedFrom: null, techNotes: null, children: [] },
    { id: 'UI-01', parentId: null, label: '用户界面层', summary: '主界面与导航结构', content: 'mock', type: 'module', status: 'pending', level: 1, order: 1, needsPolish: false, extractedFrom: null, techNotes: null, children: ['UI-02', 'UI-03'] },
    { id: 'UI-02', parentId: 'UI-01', label: '主菜单界面', summary: '游戏入口与模式选择', content: 'mock', type: 'ui', status: 'pending', level: 2, order: 0, needsPolish: true, extractedFrom: null, techNotes: null, children: [] },
    { id: 'UI-03', parentId: 'UI-01', label: 'HUD 战斗界面', summary: '战斗中的信息显示层', content: 'mock', type: 'ui', status: 'pending', level: 2, order: 1, needsPolish: true, extractedFrom: null, techNotes: null, children: [] },
    { id: 'DATA-01', parentId: null, label: '数据与存档', summary: '本地存档与进度同步', content: 'mock', type: 'module', status: 'pending', level: 1, order: 2, needsPolish: false, extractedFrom: null, techNotes: null, children: ['DATA-02'] },
    { id: 'DATA-02', parentId: 'DATA-01', label: '存档管理', summary: '多存档槽与自动存档', content: 'mock', type: 'feature', status: 'pending', level: 2, order: 0, needsPolish: false, extractedFrom: null, techNotes: null, children: [] },
  ]

  for (const { step, delay } of mockSteps) {
    session.currentStep = step
    await new Promise((r) => setTimeout(r, delay))
    // Push nodes that belong to this step
    const pushed = mockNodes.filter((n) =>
      n.parentId === null
        ? step === '正在识别顶层文档包目录'
        : step.includes(n.label) || (n.parentId !== null && mockNodes.find((p) => p.id === n.parentId && step.includes(p.label)))
    )
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

  activeSession.currentStep = '正在通读原文并建立 AI 文档包骨架...'

  // Step 1: L1 nodes
  activeSession.currentStep = '正在识别顶层文档包目录'
  const l1Nodes = await decomposeL1(mdText, activeSession)
  if (l1Nodes.length === 0) {
    throw new Error('AI 未返回有效顶层文档包目录。已拒绝使用本地标题模板生成假文档，请重试或检查 PRD 是否包含足够可读取文本。')
  }
  activeSession.nodes = []
  mergeSessionNodes(activeSession, l1Nodes)

  // Step 2: Expand L1 branches with limited concurrency.
  const expandableL1Nodes = l1Nodes.filter((node) => !node.docPath)
  let nextIndex = 0
  let completed = 0
  const workerCount = Math.min(MAX_PARALLEL_DECOMPOSITION_BRANCHES, expandableL1Nodes.length)

  async function expandNextBranch() {
    while (nextIndex < expandableL1Nodes.length) {
      const l1 = expandableL1Nodes[nextIndex]
      nextIndex += 1
      activeSession.currentStep = `正在展开文档包分支（${completed}/${expandableL1Nodes.length}）`
      const branchNodes = await decomposeBranch(mdText, l1, activeSession)
      if (branchNodes.length === 0) {
        throw new Error(`AI 未返回「${l1.label}」的有效文档包。已拒绝使用本地标题模板生成假文档，请重试或缩小 PRD 范围。`)
      }
      if (branchNodes.length > 0) mergeSessionNodes(activeSession, branchNodes)
      completed += 1
      activeSession.currentStep = `正在展开文档包分支（${completed}/${expandableL1Nodes.length}）`
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => expandNextBranch()))

  activeSession.status = 'done'
  activeSession.currentStep = '分析完成'
  scheduleSessionCleanup(sessionId)
}

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
    currentStep: '正在识别顶层文档包目录',
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

  const nodeContext = `目标节点：
编号: ${targetNode.id}
类型: ${formatNodeType(targetNode.type)}
标题: ${targetNode.label}
摘要: ${targetNode.summary}
导出路径: ${targetNode.docPath ?? '未指定'}
面向角色: ${formatAudience(targetNode.audience)}
AI 接力目标: ${targetNode.handoffGoal ?? '未指定'}
质量门槛: ${targetNode.qualityGate ?? '未指定'}
内容: ${targetNode.content}${targetNode.techNotes ? `\n技术备注: ${targetNode.techNotes}` : ''}${parentNode ? `\n\n父节点上下文：\n标题: ${parentNode.label}\n摘要: ${parentNode.summary}` : ''}`

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
  const statusLabel = node.status === 'done' ? '已完成' : node.needsPolish ? '待打磨' : '无需打磨'
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
    .filter((node) => node.parentId === null)
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

interface ExportZipRequest {
  tree: Record<string, PrdNode>
}

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

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number' ? error.status : 500
  const message = error instanceof Error ? error.message : '本地代理请求失败。'
  res.status(status).json({ error: message })
})

app.listen(port, '127.0.0.1', () => {
  console.log(`GameUX PromptForge local proxy listening on http://127.0.0.1:${port}`)
})
