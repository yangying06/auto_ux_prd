export type NodeChatIntent = 'document_polish' | 'prototype_update' | 'reference_feedback'

export interface NodePolishPatch {
  summary?: string | null
  content?: string | null
  techNotes?: string | null
}

interface NodeChatSuffix {
  nodeComplete?: boolean
  nodePatch?: NodePolishPatch
  intents?: unknown
  prototypeInstruction?: unknown
}

export interface ParsedNodeChatSuffix {
  reply: string
  nodeComplete: boolean
  nodePatch: NodePolishPatch | null
  intents: NodeChatIntent[]
  prototypeInstruction: string | null
}

const NODE_CHAT_INTENTS = new Set<NodeChatIntent>([
  'document_polish',
  'prototype_update',
  'reference_feedback',
])

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

function normalizeIntents(value: unknown): NodeChatIntent[] {
  if (!Array.isArray(value)) return []
  const intents: NodeChatIntent[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    if (!NODE_CHAT_INTENTS.has(item as NodeChatIntent)) continue
    const intent = item as NodeChatIntent
    if (!intents.includes(intent)) intents.push(intent)
  }
  return intents
}

export function extractNodeChatSuffix(rawText: string): ParsedNodeChatSuffix {
  const fallback = {
    reply: rawText,
    nodeComplete: false,
    nodePatch: null,
    intents: [],
    prototypeInstruction: null,
  }

  const lastBrace = rawText.lastIndexOf('}')
  if (lastBrace === -1) return fallback

  for (let index = lastBrace; index >= 0; index -= 1) {
    if (rawText[index] !== '{') continue
    try {
      const suffix = JSON.parse(rawText.slice(index, lastBrace + 1)) as NodeChatSuffix
      if (!suffix || typeof suffix !== 'object' || !('nodeComplete' in suffix)) continue
      return {
        reply: rawText.slice(0, index).trim() || rawText,
        nodeComplete: suffix.nodeComplete === true,
        nodePatch: normalizeNodePolishPatch(suffix.nodePatch),
        intents: normalizeIntents(suffix.intents),
        prototypeInstruction: normalizeNullableString(suffix.prototypeInstruction),
      }
    } catch {
      // Try the previous opening brace. JSON suffixes may contain nested objects.
    }
  }

  return fallback
}
