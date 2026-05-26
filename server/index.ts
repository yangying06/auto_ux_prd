import Anthropic from '@anthropic-ai/sdk'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { spawn } from 'node:child_process'
import type { UXRequirementState } from '../src/types/uxRequirement'
import type { PrdNode } from '../src/types/prdNode'

dotenv.config()
dotenv.config({ path: 'server/.env' })

const app = express()
const port = Number(process.env.LOCAL_PROXY_PORT ?? 8787)
const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'
const ragSseUrl = process.env.COCOS_RAG_SSE_URL ?? 'http://43.134.44.85:18000/sse'
const rawRagProxyScript = process.env.COCOS_RAG_PROXY_SCRIPT ?? '%APPDATA%\\cocos-rag\\remote_proxy.py'
const ragProxyScript = rawRagProxyScript.replace('%APPDATA%', process.env.APPDATA ?? '').replace('$env:APPDATA', process.env.APPDATA ?? '')

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
}

const decompositionSessions = new Map<string, DecompositionSession>()

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

interface ChatRequest {
  messages: ChatMessage[]
  requirementState: UXRequirementState
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

const systemPrompt = `You are the requirement quality inspector for GameUX PromptForge.
Your job is to turn vague game UX interaction requests into implementation-ready prompts for Cocos Creator 3.8.8.
Ask at most one high-value follow-up question per turn, and only when it blocks implementation.
When completion_rate is 60 or higher, stop asking confirmation questions and directly output the final Cocos Creator implementation prompt in reply.
Every turn must re-evaluate all slots from the latest conversation. If the user adds scope or contradictions, lower completion_rate and confidence accordingly.
Focus on missing slots: trigger_condition, sequence_rules, asset_dependencies, engine_constraints.
When images are provided, analyze them as game UI screenshots or visual references: identify visible functions, layout hierarchy, spacing, alignment, navigation, major controls, decorative assets, text areas, and which images are reference-only versus assets to include when the conversation states that distinction.
Also extract a ui_components tree: for every visible UI element in the described screen, create a component entry with name, type, states, animation_in, animation_out, z_order, notes, and children.
Component types: Button, Panel, Label, Sprite, ScrollView, ProgressBar, Toggle, Slider, EditBox, Layout, Node, Mask.
Component states: idle, hover, pressed, disabled, loading, active, error.
Only call query_cocos_knowledge when Cocos engine behavior, Tween, animation, audio, prefab, asset, or implementation constraints matter.
If the current information is enough, do not call the tool.
Respond in Chinese with a concise assistant message and a JSON state_patch object.
reply must be readable:
- Maximum 8 short lines.
- No long paragraphs.
- Never include raw JSON, state_patch, braces, or quoted schema content in reply.
- If completion_rate >= 60, reply must be the final implementation prompt draft, not a question asking whether to output it.
- If completion_rate < 60, ask only the single most blocking question.
- Use this exact style when collecting missing info:
  已确认：...
  还缺：...
  请补充：...
- Do not use markdown tables or headings.
Always fill suggested_answers with 2-4 short answer options the user can click to respond to the current next_question. These should be concrete, natural answer choices (not re-stating the question). Example: if next_question asks about animation type, suggested_answers might be ["渐显+滑入 300ms", "弹出缩放 200ms", "无动画直接显示", "自定义，我来描述"].
Only write keys that you are confident should be updated.
Never output strings like "unknown", "待定", or empty strings for confirmed values; use null instead.
asset_dependencies must always be an array of objects with type, path, is_ready.
completion_rate must always be an integer from 0 to 100.
Do not include markdown fences.
Return exactly this JSON shape:
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

  while (true) {
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
  return 'Cocos RAG returned no text content.'
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
      if (Date.now() - startedAt > 8000) {
        throw new Error(`Timed out waiting for Cocos RAG MCP proxy. ${stderrLog}`.trim())
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  function sendRpc<T>(payload: Record<string, unknown>) {
    const id = requestId++
    const body = JSON.stringify({ jsonrpc: '2.0', id, ...payload })
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
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
  description: 'Decompose a PRD document into a structured tree of functional nodes. Each node represents a distinct function, module, or UI interaction.',
  input_schema: {
    type: 'object',
    properties: {
      nodes: {
        type: 'array',
        description: 'Flat array of all PrdNodes. Root nodes have parentId: null.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique stable ID, e.g. "CE-01". Use functional abbreviation + index.' },
            parentId: { type: ['string', 'null'], description: 'ID of parent node, or null for root-level nodes.' },
            label: { type: 'string', description: 'Short display name (3-8 words).' },
            summary: { type: 'string', description: 'One sentence summary of what this node covers.' },
            content: { type: 'string', description: 'Full extracted text from the PRD for this node.' },
            type: { type: 'string', enum: ['module', 'feature', 'ui'], description: 'module = top-level functional area; feature = sub-function; ui = UI interaction node' },
            level: { type: 'integer', description: 'Depth in tree. Root children = 1, their children = 2, etc.' },
            order: { type: 'integer', description: 'Sort position among siblings (0-indexed).' },
            needsPolish: { type: 'boolean', description: 'True if this node describes a UI interaction that needs Deep Forge polishing.' },
            techNotes: { type: ['string', 'null'], description: 'Optional implementation notes relevant to engineers.' },
          },
          required: ['id', 'parentId', 'label', 'summary', 'content', 'type', 'level', 'order', 'needsPolish'],
        },
      },
    },
    required: ['nodes'],
  },
}

function normalizeDecompositionNodes(raw: unknown): PrdNode[] {
  if (!Array.isArray(raw)) return []

  const nodes = raw
    .map((item: unknown, index: number) => {
      if (!item || typeof item !== 'object') return null
      const n = item as Record<string, unknown>

      const id = typeof n.id === 'string' && n.id.trim() ? n.id.trim() : `node-${index}`
      const parentId = typeof n.parentId === 'string' ? n.parentId : null
      const label = typeof n.label === 'string' ? n.label : `Node ${id}`
      const summary = typeof n.summary === 'string' ? n.summary : ''
      const content = typeof n.content === 'string' ? n.content : ''
      const type = ['module', 'feature', 'ui'].includes(n.type as string)
        ? (n.type as PrdNode['type'])
        : 'feature'
      const level = typeof n.level === 'number' ? n.level : 0
      const order = typeof n.order === 'number' ? n.order : index
      const needsPolish = typeof n.needsPolish === 'boolean' ? n.needsPolish : false
      const techNotes = typeof n.techNotes === 'string' ? n.techNotes : null

      return {
        id, parentId, label, summary, content, type,
        status: 'pending',
        level, order, needsPolish, techNotes,
        extractedFrom: null,
        children: [] as string[],
      } as PrdNode
    })
    .filter((n): n is PrdNode => n !== null)

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

  // Warn if any node exceeds level 3
  for (const node of nodes) {
    if (node.level > 3) console.warn(`[decompose] node ${node.id} at level ${node.level} — unexpectedly deep`)
  }

  return nodes
}

function normalizeDecompositionTree(raw: unknown): Record<string, PrdNode> {
  const nodes = normalizeDecompositionNodes(raw)
  if (nodes.length === 0) throw new Error('normalizeDecompositionTree: empty result — AI returned no nodes')
  return Object.fromEntries(nodes.map((n) => [n.id, n]))
}

const decompositionL1SystemPrompt = `You are a UX architect analyzing a Product Requirements Document (PRD).
Your task: identify the top-level FUNCTIONAL MODULES in the document.
A module is a distinct user-facing feature area or functional discipline (e.g., "Combat System", "Inventory UI", "Progression Loop").
DO NOT use the document's heading hierarchy — analyze functional scope.
Return ONLY level-1 nodes (parentId: null). Maximum 8 modules. Minimum 2.
Each node must have a clear, distinct functional scope with no overlap.`

function decompositionBranchSystemPrompt(parentLabel: string, parentId: string): string {
  return `You are expanding one module of a PRD tree.
Module to expand: "${parentLabel}"
Extract the specific FEATURES and UI INTERACTIONS within this module.
Level 2 nodes = major features (parentId: "${parentId}"). Level 3 nodes = specific UI interactions (parentId = their level-2 parent's ID).
Do NOT exceed level 3. Maximum 6 children per parent.
Mark needsPolish: true for any node that describes a UI interaction screen or dialog.`
}

async function decomposeL1(mdText: string): Promise<PrdNode[]> {
  if (!anthropic) throw new Error('Anthropic client not initialized — check ANTHROPIC_API_KEY')

  const response = await anthropic.messages.create({
    model,
    max_tokens: 8000,
    system: decompositionL1SystemPrompt,
    tools: [decomposePrdTool],
    tool_choice: { type: 'tool', name: 'decompose_prd' },
    messages: [
      {
        role: 'user',
        content: `Decompose this PRD into top-level functional modules only (level 1 nodes, parentId: null). Do not go deeper than level 1 in this call.\n\n${mdText}`,
      },
    ],
  })

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'decompose_prd'
  )
  if (!toolUse) throw new Error('Claude did not use decompose_prd tool for L1 decomposition')

  const raw = (toolUse.input as { nodes?: unknown }).nodes
  return normalizeDecompositionNodes(raw)
}

async function decomposeBranch(mdText: string, parentNode: PrdNode): Promise<PrdNode[]> {
  if (!anthropic) throw new Error('Anthropic client not initialized — check ANTHROPIC_API_KEY')

  const response = await anthropic.messages.create({
    model,
    max_tokens: 8000,
    system: decompositionBranchSystemPrompt(parentNode.label, parentNode.id),
    tools: [decomposePrdTool],
    tool_choice: { type: 'tool', name: 'decompose_prd' },
    messages: [
      {
        role: 'user',
        content: `Expand the "${parentNode.label}" module into its features and UI interactions.\n\nFull PRD context:\n${mdText}`,
      },
    ],
  })

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'decompose_prd'
  )
  if (!toolUse) throw new Error(`Claude did not use decompose_prd tool for branch: ${parentNode.id}`)

  const raw = (toolUse.input as { nodes?: unknown }).nodes
  return normalizeDecompositionNodes(raw)
}

async function runDecompositionJob(sessionId: string, mdText: string): Promise<void> {
  const session = decompositionSessions.get(sessionId)
  if (!session) return

  // Step 1: L1 nodes
  session.currentStep = 'Decomposing top-level modules'
  const l1Nodes = await decomposeL1(mdText)
  session.nodes.push(...l1Nodes)

  // Step 2: Expand each L1 branch sequentially
  for (const l1 of l1Nodes) {
    session.currentStep = `Expanding: ${l1.label}`
    const branchNodes = await decomposeBranch(mdText, l1)
    session.nodes.push(...branchNodes)
  }

  session.status = 'done'
  session.currentStep = 'Complete'
}

app.use(cors({ origin: ['http://127.0.0.1:5173', 'http://localhost:5173'] }))
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
    return void res.status(400).json({ error: 'mdText is required and must not be empty' })
  }
  if (!anthropic) {
    return void res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' })
  }

  const sessionId = crypto.randomUUID()
  decompositionSessions.set(sessionId, {
    status: 'running',
    nodes: [],
    currentStep: 'Starting',
  })

  // Fire-and-forget: do NOT await. Frontend polls for status.
  runDecompositionJob(sessionId, mdText).catch((err: unknown) => {
    const session = decompositionSessions.get(sessionId)
    if (session) {
      session.status = 'error'
      session.error = err instanceof Error ? err.message : String(err)
      session.currentStep = 'Failed'
    }
  })

  res.json({ sessionId })
})

app.get('/api/decompose/:sessionId', (req, res) => {
  const session = decompositionSessions.get(req.params.sessionId)
  if (!session) {
    return void res.status(404).json({ error: 'Session not found or expired' })
  }

  const nodeCount = session.nodes.length
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
    setTimeout(() => decompositionSessions.delete(req.params.sessionId), 5 * 60 * 1000)
  }
})

app.post('/api/rag/search', async (req, res) => {
  const { query } = req.body as RagSearchRequest
  if (!query?.trim()) {
    res.status(400).json({ error: 'query is required' })
    return
  }

  res.json(await queryCocosKnowledge(query.trim()))
})

app.post('/api/chat', async (req, res) => {
  const { messages, requirementState } = req.body as ChatRequest

  if (!messages?.length) {
    res.status(400).json({ error: 'messages are required' })
    return
  }

  if (!anthropic) {
    res.status(400).json({
      error: 'ANTHROPIC_API_KEY is not configured. Copy .env.example to .env and set ANTHROPIC_API_KEY.',
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

app.post('/api/prototype', async (req, res) => {
  const { requirementState } = req.body as { requirementState: UXRequirementState }

  if (!anthropic) {
    res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured.' })
    return
  }

  const hasComponents = requirementState.ui_components.length > 0
  const componentTree = hasComponents
    ? JSON.stringify(requirementState.ui_components, null, 2)
    : '（暂无组件信息，请根据 trigger_condition 和 sequence_rules 推断界面结构）'

  const prompt = `你是一个游戏 UX 原型生成器。根据以下 UX 需求状态，生成一个自包含的 HTML 原型预览页面。

## 需求状态
触发条件：${requirementState.trigger_condition ?? '未知'}
执行规则：${requirementState.sequence_rules ?? '未知'}
引擎约束：${requirementState.engine_constraints ?? '无'}
完成度：${requirementState.completion_rate}%

## 组件树
${componentTree}

## 输出要求
1. **设备帧**：用一个居中的矩形模拟手机/平板/PC 游戏屏幕（宽高比 16:9 或 9:16，根据场景判断），外围有深色背景
2. **多状态切换**：在设备帧外面顶部放一排 Tab 按钮，每个 Tab 对应一个界面状态（如 idle/hover/pressed/loading/active）。点击 Tab 切换显示该状态下的界面
3. **组件标注**：每个 UI 组件（按钮、面板、列表、文字等）用虚线框标注，角落有小标签显示组件名称和类型，颜色为半透明蓝色
4. **动画预览**：对于有 animation_in 的组件，用 CSS @keyframes 实现入场动画效果，并在该组件的标注角落显示动画参数文字
5. **资源占位符**：对于未确认的图片/音效资源，用灰色矩形 + 文字说明替代
6. **游戏风格**：深色背景（#1a1a2e），蓝/金色为主的界面配色，有科技感/游戏感
7. 输出单个完整的 HTML 文件（包含内联 CSS 和 JS），不要有任何解释文字，只输出 HTML 代码
8. HTML 代码用 \`\`\`html ... \`\`\` 包裹`

  const response = await anthropic.messages.create({
    model,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = textFromClaudeContent(response.content)
  // Strip opening ```html fence; closing fence may be missing if content is long
  const html = raw.replace(/^```html\s*/m, '').replace(/```\s*$/, '').trim()

  res.json({ html })
})

app.post('/api/export-prompt', async (req, res) => {
  const { requirementState, conversationSummary } = req.body as { requirementState: UXRequirementState; conversationSummary: string }

  if (!anthropic) {
    res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured.' })
    return
  }

  const prompt = `你是一位资深游戏 UX 设计师，请根据下面的需求状态和对话摘要，输出一份完整的 Cocos Creator 3.8.8 UX 交互实现设计文档（Markdown 格式）。

## 需求状态
${JSON.stringify(requirementState, null, 2)}

## 对话摘要
${conversationSummary}

## 输出要求
请输出一份完整的 Markdown 文档，包含以下章节：

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

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number' ? error.status : 500
  const message = error instanceof Error ? error.message : 'Local proxy failed.'
  res.status(status).json({ error: message })
})

app.listen(port, '127.0.0.1', () => {
  console.log(`GameUX PromptForge local proxy listening on http://127.0.0.1:${port}`)
})
