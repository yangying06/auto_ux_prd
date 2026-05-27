import type { ChatMessage, ChatResponse, ProxyHealth, RagSearchResult } from '../types/chat'
import type { UXRequirementState } from '../types/uxRequirement'
import type { PrdNode } from '../types/prdNode'

async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

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

export function generatePrototype(baseUrl: string, requirementState: UXRequirementState) {
  return requestJson<{ html: string }>(baseUrl, '/api/prototype', {
    method: 'POST',
    body: JSON.stringify({ requirementState }),
  })
}

export function exportFinalPrompt(baseUrl: string, requirementState: UXRequirementState, conversationSummary: string) {
  return requestJson<{ markdown: string }>(baseUrl, '/api/export-prompt', {
    method: 'POST',
    body: JSON.stringify({ requirementState, conversationSummary }),
  })
}

// ── Decomposition API ────────────────────────────────────────────────────────

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

export interface NodeChatResponse {
  reply: string
  nodeComplete: boolean
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
